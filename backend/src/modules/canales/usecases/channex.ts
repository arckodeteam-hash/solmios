// canales/usecases/channex.ts — Cliente y operaciones de Channex
// Responsabilidad ÚNICA: hablar con la API de Channex (channel manager).
// NO toca la base de datos — recibe la config y devuelve resultados.
// El service decide qué persistir. Así el service se mantiene < 200 líneas.

import type { Logger } from 'arckode-framework'
import type { CanalesDTO, ChannelDTO, ChannelsResultDTO, RoomTypeSummary, SyncResultDTO, TestConnectionDTO, TestConnectionResultDTO, MappingDetailDTO, OTAChannelCreateDTO, OTAChannelResultDTO, GroupDTO, OTAChannelMeta, BookingRevisionDTO, PushRatesResultDTO, DateRange } from '../types'
import { sharedChannexHttp } from './channex-http'
import { DEFAULT_RATE_PLANS, planPrice, matchRatePlan, type RatePlanDef } from './rate-plans'
import { targetsFromMappings, type ChannelMappingStore, type MappingEntry, type AriTargets } from './channex-mapping'
import { FULL_SYNC_HORIZON_DAYS, MS_PER_DAY } from './availability'
import { buildOverrideValues, type OverridePushItem, type OverridePushSkips } from './push-overrides'

const STAGING_BASE = process.env.CHANNEX_BASE_URL || 'https://staging.channex.io/api/v1'
const PROD_BASE = 'https://api.channex.io/api/v1'
const CHANNEX_KEY = process.env.CHANNEX_API_KEY || ''

/** Resolver de credenciales de PLATAFORMA (una cuenta Channex white-label para todos los hoteles). */
export type PlatformCredsResolver = () => Promise<{ apiKey?: string; environment?: string } | null>

export class ChannexUseCase {
  constructor(
    private readonly logger: Logger,
    private readonly getPlatformCreds?: PlatformCredsResolver,
    /** Mapping persistente local↔Channex (P6): sin él, los pushes resuelven por GET+título. */
    private readonly mappingStore?: ChannelMappingStore,
  ) {}

  /**
   * UUIDs de Channex para los pushes de ARI (P6): primero por mapping persistido (sin GETs,
   * inmune a renombres de tipos); fallback a GET + match por título para hoteles sin mapping.
   */
  private async resolveAriTargets(cfg: CanalesDTO): Promise<AriTargets> {
    if (this.mappingStore && cfg.hotelId) {
      try {
        const mappings = (await this.mappingStore.read(cfg.hotelId)) as MappingEntry[]
        if (mappings?.length) return targetsFromMappings(mappings)
      } catch { /* store caído → fallback a GETs */ }
    }
    const key = this.resolveKey(cfg)
    const pid = cfg.channexPropertyId!
    const rts = ((await this.channexReq(key, 'GET', `/room_types?filter[property_id]=${pid}`)).data as any)?.data || []
    const rps = ((await this.channexReq(key, 'GET', `/rate_plans?filter[property_id]=${pid}`)).data as any)?.data || []
    const rtIdByTitle = new Map<string, string>(rts.map((rt: any) => [String(rt.attributes?.title || '').toLowerCase(), rt.id]))
    const rpsByRt = new Map<string, Array<{ id: string; title?: string }>>()
    for (const rp of rps) {
      const rtid = rp.attributes?.room_type_id || rp.relationships?.room_type?.data?.id
      if (!rtid) continue
      const list = rpsByRt.get(rtid) ?? []
      list.push({ id: rp.id, title: rp.attributes?.title })
      rpsByRt.set(rtid, list)
    }
    return { rtIdByTitle, rpsByRt }
  }

  /** Credenciales efectivas: la cuenta de PLATAFORMA manda (admin > env); el entorno define staging/prod. */
  private async platform(): Promise<{ key: string; base: string }> {
    const p = this.getPlatformCreds ? await this.getPlatformCreds().catch(() => null) : null
    const base = p?.environment === 'production' ? PROD_BASE : STAGING_BASE
    return { key: p?.apiKey || CHANNEX_KEY, base }
  }

  // Fallback para el key por-hotel (legacy). La plataforma tiene prioridad en channexReq.
  private resolveKey(cfg?: CanalesDTO | null): string {
    return cfg?.channexApiKey || CHANNEX_KEY
  }

  private async channexReq(apiKeyOverride: string, method: string, path: string, body?: any): Promise<{ ok: boolean; data: any }> {
    const plat = await this.platform()
    const apiKey = plat.key || apiKeyOverride   // plataforma primero; el por-hotel es último recurso
    if (!apiKey) throw new Error('Channex API key no configurada (configurala en Admin → Integraciones)')
    const url = `${plat.base}${path}`
    const headers: any = { 'Content-Type': 'application/json', 'user-api-key': apiKey }
    const init: RequestInit = method === 'GET' || !body
      ? { method, headers }
      : { method, headers, body: JSON.stringify(body) }
    // Transport compartido (channex-http): rate limit ~18/min + backoff en 429/5xx + timeout.
    // Es lo que responde el test 12 de la certificación ("can you stay in rate limits?").
    const r = await sharedChannexHttp.request<unknown>(url, init)
    return { ok: r.ok, data: r.data }
  }

  /** ¿Hay credencial de plataforma configurada? Sin ella no hay nada que sincronizar. */
  async hasPlatformKey(): Promise<boolean> {
    return !!(await this.platform()).key
  }

  /** Prueba la credencial de plataforma con un GET liviano a Channex. Para el botón "Probar conexión" del admin. */
  async testApiKey(): Promise<{ success: boolean; message: string; environment: string }> {
    const plat = await this.platform()
    const environment = plat.base === PROD_BASE ? 'production' : 'staging'
    if (!plat.key) return { success: false, message: 'No hay API key configurada', environment }
    try {
      const res = await this.channexReq('', 'GET', '/properties?limit=1')
      if (res.ok) return { success: true, message: 'Conexión con Channex OK', environment }
      const err = (res.data as any)?.errors
      return { success: false, message: err?.title || err?.code || 'La API key fue rechazada por Channex', environment }
    } catch (e: any) {
      return { success: false, message: e?.message || 'Error de red al contactar Channex', environment }
    }
  }

  // ─── Canales conectados (Channex real + catálogo de la DB) ──────────
  async listChannels(cfg: CanalesDTO | undefined, catalog: OTAChannelMeta[]): Promise<ChannelsResultDTO> {
    const channels: ChannelDTO[] = []
    let connectedCount = 0
    const key = this.resolveKey(cfg)

    const matchCatalog = (otaCode: string, name: string): OTAChannelMeta | undefined => {
      const code = otaCode.toLowerCase()
      const n = name.toLowerCase()
      return catalog.find(item => {
        if (item.channexCode.toLowerCase() === code) return true
        return (item.aliases || []).some(a => a.toLowerCase() === code) || item.name.toLowerCase() === n
      })
    }

    if (cfg?.channexPropertyId) {
      try {
        const res = await this.channexReq(key, 'GET', `/channels?filter[property_id]=${cfg.channexPropertyId}`)
        const raw = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : [])
        for (const ch of raw) {
          const a = ch.attributes || ch
          const otaCode = a.channel || ''
          const name = a.title || a.name || otaCode || 'OTA'
          const meta = matchCatalog(otaCode, name)
          channels.push({
            id: ch.id, name: meta?.name || name, type: meta?.type || 'ota',
            conectado: true, bookings: a.bookings_count || 0, lastSync: a.updated_at || cfg.lastSync || null,
            otaCode: meta?.channexCode || otaCode, active: a.is_active || false,
            icon: meta?.icon, color: meta?.color, description: meta?.description,
          })
        }
        connectedCount = channels.filter(c => c.conectado).length
      } catch (e) { this.logger.warn('Channex channels falló, usando catálogo', { error: String(e) }) }
    }

    for (const item of catalog) {
      const alreadyExists = channels.some(c =>
        (c.otaCode || '').toLowerCase() === item.channexCode.toLowerCase() ||
        (item.aliases || []).some(a => a.toLowerCase() === (c.id || c.name || '').toLowerCase())
      )
      if (!alreadyExists) {
        channels.push({
          name: item.name, type: item.type, otaCode: item.channexCode, conectado: false,
          icon: item.icon, color: item.color, description: item.description,
        })
      }
    }

    let pendingBookings = 0
    try {
      const feed = await this.channexReq(key, 'GET', '/booking_revisions/feed?limit=10')
      pendingBookings = feed.data?.meta?.total || 0
    } catch { /* feed opcional */ }

    return { data: channels, connectedCount, pendingBookings, syncEnabled: (cfg?.syncEnabled ?? 1) === 1, lastSync: cfg?.lastSync || null, channexPropertyId: cfg?.channexPropertyId || null }
  }

  async getFeed(): Promise<{ pendingBookings: number }> {
    try {
      // channexReq resuelve la key de plataforma; el override queda vacío.
      const feed = await this.channexReq('', 'GET', '/booking_revisions/feed?limit=10')
      return { pendingBookings: feed.data?.meta?.total || 0 }
    } catch { return { pendingBookings: 0 } }
  }

  // ─── Sincronización: crea propiedad + room types + rate plans + ARI ──
  // Si ya existe channexPropertyId → limpia datos viejos y resincroniza.
  // Un rate plan de Channex por (room type × plan del hotel): BAR + Bed & Breakfast por
  // defecto (P5). Al terminar persiste el mapping local↔UUID (P6) para que los pushes
  // resuelvan sin GETs ni match por título.
  async syncProperty(hotelId: string, hotel: { name: string; currency?: string; email?: string; address?: string; timezone?: string }, rooms: RoomTypeSummary[], cfg: CanalesDTO | undefined, ratePlans: RatePlanDef[] = DEFAULT_RATE_PLANS): Promise<{ result: SyncResultDTO; newPropertyId: string | null; newGroupId: string | null }> {
    const key = this.resolveKey(cfg)

    let channexPId: string | undefined = cfg?.channexPropertyId || undefined
    let newGroupId: string | null = null

    if (!channexPId) {
      // Un GRUPO por hotel. La cuenta de Channex es de la plataforma (white-label) y todos los
      // hoteles viven adentro; el grupo es lo que los separa. Sin `group_id` la doc dice que la
      // property cae en el "Default User Group" — es decir, todos los hoteles en la misma bolsa.
      const groupId = cfg?.channexGroupId || await this.ensureGroup(key, hotel.name)
      if (!cfg?.channexGroupId) newGroupId = groupId ?? null
      const propRes = await this.channexReq(key, 'POST', '/properties', {
        property: { title: hotel.name, currency: hotel.currency || 'USD', email: hotel.email, address: hotel.address, timezone: hotel.timezone || 'America/Santo_Domingo', group_id: groupId },
      })
      if (!propRes.ok || !propRes.data?.data) throw new Error('No se pudo crear la propiedad en Channex')
      channexPId = propRes.data.data.id
    } else {
      try {
        const oldRPs = await this.channexReq(key, 'GET', `/rate_plans?filter[property_id]=${channexPId}`)
        for (const rp of (oldRPs.data?.data || [])) {
          await this.channexReq(key, 'DELETE', `/rate_plans/${rp.id}`).catch(() => {})
        }
      } catch {}
      try {
        const oldRTs = await this.channexReq(key, 'GET', `/room_types?filter[property_id]=${channexPId}`)
        for (const rt of (oldRTs.data?.data || [])) {
          await this.channexReq(key, 'DELETE', `/room_types/${rt.id}`).catch(() => {})
        }
      } catch {}
    }

    const createdRTs: any[] = []
    const rtResults = await Promise.all(rooms.map((rt: RoomTypeSummary) =>
      this.channexReq(key, 'POST', '/room_types', { room_type: { property_id: channexPId, title: rt.type, count_of_rooms: rt.cnt, occ_adults: rt.capacity, occ_children: 1, occ_infants: 1 } })
    ))
    rtResults.filter(r => r.ok && r.data?.data).forEach(r => createdRTs.push(r.data.data))

    const rtList = (await this.channexReq(key, 'GET', `/room_types?filter[property_id]=${channexPId}`)).data?.data || []

    // Batch rate plan creation — UNO POR PLAN (P5): "Double BAR", "Double Bed & Breakfast"…
    const rpCreated = await Promise.all(createdRTs.flatMap(rt => {
      const title = rt.attributes?.title || rt.title
      const roomData = rooms.find(rm => rm.type === title)
      const basePrice = Math.round((roomData?.basePrice || 100) * 100)
      const cap = Math.max(1, roomData?.capacity || 2)
      return ratePlans.map(plan => {
        const price = planPrice(basePrice, plan.markupPct)
        // Una option por ocupación 1..capacidad (la máxima is_primary). Los precios reales por
        // ocupación los pone el push de tarifas; acá se crea la ESTRUCTURA (#404).
        //
        // `sell_mode` se fija ACÁ, al crear el rate plan, y no se puede cambiar después con un
        // push: por eso el hotel tarifa siempre por persona y no hay switch. Una propiedad creada
        // con `per_room` necesita re-sincronizarse para aceptar precios por ocupación.
        const options = Array.from({ length: cap }, (_, i) => ({ occupancy: i + 1, is_primary: i + 1 === cap, rate: price }))
        return this.channexReq(key, 'POST', '/rate_plans', { rate_plan: { property_id: channexPId, room_type_id: rt.id, title: `${title} ${plan.label}`, currency: hotel.currency || 'USD', sell_mode: 'per_person', rate_mode: 'manual', options } })
      })
    }))
    // Rate plans: releer DESPUÉS de crear (rpList alimenta el reporte).
    // Antes se leía antes de crear → siempre 0 y sin restrictions iniciales.
    const rpList = (await this.channexReq(key, 'GET', `/rate_plans?filter[property_id]=${channexPId}`)).data?.data || []

    // ARI del full sync: NO se empuja acá. El service lo manda al terminar en EXACTAMENTE 2
    // llamadas (1 availability consolidado de 500 días con reservas descontadas + 1 restrictions
    // consolidado por temporada) — es lo que exige el test 1 de la certificación PMS de Channex.

    // P6: persistir (kind, localId) → channexId. El label del plan se deriva del título del RP
    // ("Double Bed & Breakfast" → "Bed & Breakfast"; títulos de terceros quedan completos y el
    // matcheo por keywords los resuelve igual).
    if (this.mappingStore && hotelId) {
      try {
        const entries: MappingEntry[] = [{ kind: 'property', localId: 'default', channexId: channexPId! }]
        for (const rt of rtList) {
          entries.push({ kind: 'room_type', localId: String(rt.attributes?.title || ''), channexId: rt.id })
        }
        for (const rp of rpList) {
          const rt = rtList.find((r: any) => r.id === (rp.attributes?.room_type_id || rp.relationships?.room_type?.data?.id))
          const rtTitle = String(rt?.attributes?.title || '')
          const rpTitle = String(rp.attributes?.title || '')
          const planLabel = rtTitle && rpTitle.startsWith(`${rtTitle} `) ? rpTitle.slice(rtTitle.length + 1) : rpTitle
          if (rtTitle && planLabel) entries.push({ kind: 'rate_plan', localId: `${rtTitle}|${planLabel}`, channexId: rp.id })
        }
        await this.mappingStore.upsert(hotelId, entries)
      } catch (e) {
        this.logger.error('No se pudo persistir el mapping Channex', { hotelId, error: e instanceof Error ? e.message : String(e) })
      }
    }

    this.logger.info('Sync Channex OK', { channexPropertyId: channexPId, roomTypes: rtList.length, ratePlans: rpList.length })
    return { result: { success: true, message: `Sincronización completa: ${rtList.length} room types, ${rpList.length} rate plans`, channexPropertyId: channexPId || '', roomTypes: rtList.length, ratePlans: rpList.length }, newPropertyId: channexPId || null, newGroupId }
  }

  /**
   * Grupo de Channex del hotel, creándolo si hace falta.
   *
   * Reusa un grupo existente con el MISMO título antes de crear otro: re-sincronizar un hotel que
   * perdió su `channexGroupId` no debe dejar grupos huérfanos acumulándose en la cuenta.
   * Si Channex rechaza la creación se devuelve `undefined` y la property se crea sin grupo — el
   * sync no se cae por esto, pero el hotel queda en el grupo por defecto (queda en el log).
   */
  private async ensureGroup(key: string, hotelName: string): Promise<string | undefined> {
    const title = String(hotelName || '').trim() || 'Hotel'
    try {
      const list = await this.channexReq(key, 'GET', '/groups')
      const existing = ((list.data as any)?.data || []).find(
        (g: any) => String(g.attributes?.title ?? g.title ?? '').toLowerCase() === title.toLowerCase())
      if (existing?.id) return existing.id
    } catch { /* no poder listar no impide intentar crear */ }
    const res = await this.channexReq(key, 'POST', '/groups', { group: { title } })
    const id = (res.data as any)?.data?.id
    if (!res.ok || !id) {
      this.logger.error('No se pudo crear el grupo del hotel en Channex — la propiedad queda en el grupo por defecto', { hotelName: title })
      return undefined
    }
    return id
  }

  // pushRate (precio plano 30d) fue ELIMINADO: pisaba los precios por temporada ya publicados
  // (dos fuentes de verdad). El push por cambio de basePrice va por pushSeasonalRates.

  /**
   * Etapa 2 — Push de tarifas POR TEMPORADA a Channex. Para cada tarifa (roomType, season) empuja al
   * rate plan del room type el precio calculado (base×(1+%/100)) por el rango de fechas de la temporada,
   * junto con cerrar ventas (stop_sell) y min/max stay. Nunca fechas pasadas. Devuelve cuántas empujó.
   */
  async pushSeasonalRates(
    cfg: CanalesDTO | undefined,
    rates: Array<{ roomType: string; season: string; occupancy?: number; basePrice: number; percentage: number; closed?: number; minStay?: number; maxStay?: number }>,
    seasons: Array<{ name: string; label?: string; startDate?: string; endDate?: string }>,
    assignedRanges: Map<string, DateRange[]> = new Map(),
    ratePlans: RatePlanDef[] = DEFAULT_RATE_PLANS,
    restrictions: Array<{ roomType: string; season: string; cta?: number; ctd?: number; closedToArrival?: number; closedToDeparture?: number; minStayThrough?: number }> = [],
    /**
     * Tarifas por FECHA (`rate_overrides`). Van en el MISMO payload y AL FINAL, después de la
     * línea base y de las temporadas: Channex aplica los entries FIFO y gana el último.
     *
     * Sin esto el push consolidado revertía en Channex todo override ya publicado — el hotel
     * cargaba 333 el 22/11, lo veía en el panel, y el siguiente cambio de temporada lo devolvía
     * al precio de temporada en la OTA sin que nada lo avisara. Dos fuentes de verdad.
     */
    overrides: OverridePushItem[] = [],
  ): Promise<PushRatesResultDTO> {
    const empty = (): PushRatesResultDTO => ({ pushed: 0, skipped: 0, notConnected: false, seasonsWithoutDates: [], expiredSeasons: [], roomTypesWithoutRatePlan: [] })
    if (!cfg?.channexPropertyId) return { ...empty(), skipped: rates.length, notConnected: true }
    const key = this.resolveKey(cfg)
    const pid = cfg.channexPropertyId
    // UUIDs por mapping persistido si existe (P6, sin GETs); si no, GET + match por título.
    const targets = await this.resolveAriTargets(cfg)
    const { rtIdByTitle, rpsByRt } = targets
    const seasonByName = new Map(seasons.map((s) => [s.name, s]))
    // Closures/through por (roomType|season) — la capa que edita PUT /api/rate-restrictions (P4).
    const restrictionBy = new Map(restrictions.map((r) => [`${String(r.roomType).toLowerCase()}|${r.season}`, r]))
    const today = new Date().toISOString().slice(0, 10)
    const values: any[] = []
    let skipped = 0
    // Se acumulan los MOTIVOS, no solo el contador: un skip mudo hacía que la tarifa nunca
    // llegara a la OTA sin que nadie se enterara. Set = un nombre por temporada aunque falle
    // en varios room types.
    const seasonsWithoutDates = new Set<string>()
    const expiredSeasons = new Set<string>()
    const roomTypesWithoutRatePlan = new Set<string>()
    // Nombre visible de la temporada: el label si lo tiene, si no el name técnico.
    const seasonLabel = (name: string): string => seasonByName.get(name)?.label || name
    // Se agrupan las filas por room type + temporada para juntar las ocupaciones: un rate plan
    // lleva TODAS las ocupaciones en un mismo entry (`rates: [{occupancy, rate}]`). Antes se
    // empujaba fila por fila con un rate plano → el precio por persona no salía.
    const groups = new Map<string, typeof rates>()
    for (const r of rates) {
      const k = `${r.roomType}|${r.season}`
      const arr = groups.get(k) ?? []
      arr.push(r)
      groups.set(k, arr)
    }
    // Channex aplica los entries FIFO ("last win"): si una temporada por DÍAS PINTADOS solapa
    // el rango del catálogo de otra (p.ej. 3 días de "especial" dentro de "media"), el específico
    // tiene que salir DESPUÉS o el rango general lo pisa. Catálogo primero, días pintados al final.
    const groupList = [...groups.values()].sort((a, b) => {
      const aFixed = seasonByName.get(a[0]!.season)?.startDate ? 0 : 1
      const bFixed = seasonByName.get(b[0]!.season)?.startDate ? 0 : 1
      return aFixed - bFixed
    })
    const priceOf = (r: { basePrice: number; percentage: number }) =>
      Math.round((r.basePrice || 0) * (1 + (r.percentage || 0) / 100) * 100)  // centavos

    // ── Línea base de 500 días (test 1 de la certificación) ────────────────────────────────
    // Las temporadas cubren solo sus rangos: fuera de ellos Channex se quedaba SIN tarifa, así que
    // el "full sync de 500 días" solo lo era para availability. Se emite primero un tramo que cubre
    // todo el horizonte con la tarifa base del tipo (percentage 0) y las temporadas caen encima:
    // Channex aplica los entries FIFO y el último gana, que es el mismo criterio del orden de
    // `groupList` (catálogo → días pintados). Los overrides por fecha van después, en su propio push.
    const horizonEnd = new Date(Date.parse(`${today}T00:00:00Z`) + (FULL_SYNC_HORIZON_DAYS - 1) * MS_PER_DAY)
      .toISOString().slice(0, 10)
    const baselineByRoomType = new Map<string, typeof rates>()
    for (const group of groupList) {
      const rt = String(group[0]!.roomType)
      if (!baselineByRoomType.has(rt)) baselineByRoomType.set(rt, group)
    }
    for (const [roomType, group] of baselineByRoomType) {
      const rtId = rtIdByTitle.get(roomType.toLowerCase())
      const rtRps = rtId ? rpsByRt.get(rtId) : undefined
      if (!rtRps?.length) continue   // el motivo ya lo reporta el loop de temporadas de abajo
      const flat = group.map((r) => ({ occupancy: Number(r.occupancy) || 0, rate: priceOf({ basePrice: r.basePrice, percentage: 0 }) }))
        .filter((x) => x.occupancy > 0)
      const head = group[0]!
      for (const plan of ratePlans) {
        const rpId = matchRatePlan(rtRps, plan)
        if (!rpId) continue
        const entry: any = { property_id: pid, rate_plan_id: rpId, date_from: today, date_to: horizonEnd }
        if (flat.length > 0) {
          entry.rates = flat.map((o) => ({ occupancy: o.occupancy, rate: planPrice(o.rate, plan.markupPct) }))
        } else {
          entry.rate = planPrice(priceOf({ basePrice: head.basePrice, percentage: 0 }), plan.markupPct)
        }
        values.push(entry)
      }
    }

    for (const group of groupList) {
      const head = group[0]!
      const s = seasonByName.get(head.season)
      // Dos orígenes de rango, en orden de prioridad:
      //  1) las fechas propias de la temporada (catálogo Seasons), si las tiene;
      //  2) los días pintados en el planning (season_assignments), agrupados en tramos contiguos.
      const ranges: DateRange[] = (s?.startDate && s?.endDate)
        ? [{ startDate: s.startDate, endDate: s.endDate }]
        : (assignedRanges.get(head.season) || [])
      if (ranges.length === 0) { skipped++; seasonsWithoutDates.add(seasonLabel(head.season)); continue }
      const rtId = rtIdByTitle.get(String(head.roomType).toLowerCase())
      const rtRps = rtId ? rpsByRt.get(rtId) : undefined
      if (!rtRps?.length) { skipped++; roomTypesWithoutRatePlan.add(String(head.roomType)); continue }
      // Precio por ocupación (per_person) o precio único del grupo (per_room), ANTES del markup del plan.
      const perOcc = group.map((r) => ({ occupancy: Number(r.occupancy) || 0, rate: priceOf(r) })).filter((x) => x.occupancy > 0)
      let queued = 0
      for (const plan of ratePlans) {
        const rpId = matchRatePlan(rtRps, plan)
        if (!rpId) continue   // plan sin counterpart en ese room type: no se publica, sin romper el resto
        for (const rg of ranges) {
          const from = rg.startDate < today ? today : rg.startDate   // nunca fechas pasadas
          if (rg.endDate < from) continue                            // tramo ya terminó
          const entry: any = { property_id: pid, rate_plan_id: rpId, date_from: from, date_to: rg.endDate, stop_sell: !!head.closed }
          if (perOcc.length > 0) {
            entry.rates = perOcc.map((o) => ({ occupancy: o.occupancy, rate: planPrice(o.rate, plan.markupPct) }))  // OBP × plan
          } else {
            // Defensa para filas legacy sin `occupancy` (< 1): sin ellas el entry saldría sin precio.
            entry.rate = planPrice(priceOf(head), plan.markupPct)
          }
          if (Number(head.minStay) > 0) entry.min_stay_arrival = Number(head.minStay)
          if (Number(head.maxStay) > 0) entry.max_stay = Number(head.maxStay)
          // CTA/CTD/through (P4): los closures aceptan ambos campos históricos (cta/ctd o closedToX).
          const restriction = restrictionBy.get(`${String(head.roomType).toLowerCase()}|${head.season}`)
          if (restriction) {
            if (Number(restriction.closedToArrival) || Number(restriction.cta)) entry.closed_to_arrival = true
            if (Number(restriction.closedToDeparture) || Number(restriction.ctd)) entry.closed_to_departure = true
            if (Number(restriction.minStayThrough) > 0) entry.min_stay_through = Number(restriction.minStayThrough)
          }
          values.push(entry)
          queued++
        }
      }
      if (queued === 0) { skipped++; expiredSeasons.add(seasonLabel(head.season)) }
    }
    // Las tarifas por fecha, al final del payload: son la capa más específica y tienen que ganar.
    if (overrides.length) {
      values.push(...buildOverrideValues(overrides, pid, targets, ratePlans, today).values)
    }

    const reasons = {
      seasonsWithoutDates: [...seasonsWithoutDates],
      expiredSeasons: [...expiredSeasons],
      roomTypesWithoutRatePlan: [...roomTypesWithoutRatePlan],
    }
    if (values.length === 0) return { ...empty(), skipped, ...reasons }
    const res = await this.channexReq(key, 'POST', '/restrictions', { values })
    if (!res.ok) throw new Error('Channex rechazó las tarifas: ' + JSON.stringify((res.data as any)?.errors || '').slice(0, 200))
    this.logger.info('Tarifas por temporada empujadas a Channex', { pushed: values.length, skipped, ...reasons })
    return { ...empty(), pushed: values.length, skipped, ...reasons }
  }

  /**
   * Push DELTA de la grilla de tarifas por fecha: SOLO las celdas que el usuario acaba de guardar,
   * en UNA sola llamada a `POST /restrictions`. Es el camino que ejercitan los tests 2 a 8 de la
   * certificación PMS (un precio en una fecha, varios precios en varias fechas, min stay, stop
   * sell, CTA/CTD, medio año) y el que responde el test 13 ("solo mandás lo que cambió").
   *
   * La construcción del payload vive en `push-overrides.ts` (pura, testeable sin red); acá solo se
   * resuelven los UUIDs y se manda.
   */
  async pushRateOverrides(
    cfg: CanalesDTO | undefined,
    items: OverridePushItem[],
    ratePlans: RatePlanDef[] = DEFAULT_RATE_PLANS,
  ): Promise<{ pushed: number; calls: number; skips: OverridePushSkips }> {
    const noSkips: OverridePushSkips = { roomTypesWithoutRatePlan: [], ratePlansUnknown: [], expiredRanges: 0 }
    if (!cfg?.channexPropertyId || !items?.length) return { pushed: 0, calls: 0, skips: noSkips }
    const key = this.resolveKey(cfg)
    const targets = await this.resolveAriTargets(cfg)
    const today = new Date().toISOString().slice(0, 10)
    const { values, skips } = buildOverrideValues(items, cfg.channexPropertyId, targets, ratePlans, today)
    if (!values.length) return { pushed: 0, calls: 0, skips }
    const res = await this.channexReq(key, 'POST', '/restrictions', { values })
    if (!res.ok) throw new Error('Channex rechazó los overrides: ' + JSON.stringify((res.data as any)?.errors || '').slice(0, 200))
    this.logger.info('Overrides de tarifa empujados a Channex (1 llamada)', { pushed: values.length, ...skips })
    return { pushed: values.length, calls: 1, skips }
  }

  // ─── Push de availability (reservas/checkin/checkout/bloqueos) ───────
  // Recibe los rangos YA calculados y comprimidos por el service (que lee DB).
  // El usecase solo resuelve el room_type_id de Channex (por title) y empuja.
  // Nunca fechas pasadas: el service acota el rango desde hoy.
  async pushAvailability(
    cfg: CanalesDTO | undefined,
    roomType: string,
    ranges: { dateFrom: string; dateTo: string; availability: number }[],
  ): Promise<{ pushed: boolean }> {
    if (!cfg?.channexPropertyId || ranges.length === 0) return { pushed: false }
    const key = this.resolveKey(cfg)
    const rtId = await this.resolveChannexRoomTypeId(key, cfg.channexPropertyId, roomType)
    if (!rtId) return { pushed: false }
    const values = ranges.map(r => ({
      property_id: cfg.channexPropertyId,
      room_type_id: rtId,
      date_from: r.dateFrom,
      date_to: r.dateTo,
      availability: r.availability,
    }))
    await this.channexReq(key, 'POST', '/availability', { values })
    this.logger.info('Availability Channex actualizada', { roomType, rangos: ranges.length })
    return { pushed: true }
  }

  /**
   * Full sync de availability (test 1 de certificación): TODOS los room types en UNA sola
   * llamada POST /availability. Los rangos ya vienen comprimidos y con reservas/bloques
   * descontados (los arma availability.ts); acá solo se resuelve el mapa título→UUID.
   */
  async pushAllAvailability(
    cfg: CanalesDTO | undefined,
    list: Array<{ roomType: string; ranges: Array<{ dateFrom: string; dateTo: string; availability: number }> }>,
  ): Promise<{ pushed: number }> {
    if (!cfg?.channexPropertyId || !list.length) return { pushed: 0 }
    const key = this.resolveKey(cfg)
    const { rtIdByTitle } = await this.resolveAriTargets(cfg)
    const values: any[] = []
    for (const { roomType, ranges } of list) {
      const rtId = rtIdByTitle.get(String(roomType).toLowerCase())
      if (!rtId) continue // tipo sin counterpart en Channex: el sync de estructura lo crea
      for (const r of ranges) {
        values.push({ property_id: cfg.channexPropertyId, room_type_id: rtId, date_from: r.dateFrom, date_to: r.dateTo, availability: r.availability })
      }
    }
    if (!values.length) return { pushed: 0 }
    await this.channexReq(key, 'POST', '/availability', { values })
    this.logger.info('Full availability Channex empujada (1 llamada)', { roomTypes: list.length, rangos: values.length })
    return { pushed: values.length }
  }

  // Resuelve el room_type_id de Channex por title (rt.type == room_type title).
  // Mismo criterio que pushRate/sync usan para matchear tipo local → Channex.
  private async resolveChannexRoomTypeId(apiKey: string, propertyId: string, roomType: string): Promise<string | null> {
    const rts = await this.channexReq(apiKey, 'GET', `/room_types?filter[property_id]=${propertyId}`)
    const rtList: any[] = rts.data?.data || []
    const target = rtList.find(rt => String(rt.attributes?.title || '').toLowerCase() === roomType.toLowerCase())
    return target?.id || null
  }

  // ─── Channel API (conexión OTA) ──────────────────────────────────────
  async testConnection(cfg: CanalesDTO | undefined, dto: TestConnectionDTO): Promise<TestConnectionResultDTO> {
    const key = this.resolveKey(cfg)
    const res = await this.channexReq(key, 'POST', '/channels/test_connection', {
      channel: dto.channel,
      settings: { hotel_id: dto.hotel_id },
    })
    if (!res.ok) {
      const err = res.data?.errors
      return { success: false, message: err?.title || err?.details?.join(', ') || 'Error de conexión con la OTA', details: res.data }
    }
    return { success: true, message: 'Conexión exitosa', details: res.data }
  }

  async getMappingDetails(cfg: CanalesDTO | undefined, channel: string, hotelId: string): Promise<{ success: boolean; rooms: MappingDetailDTO[]; error?: string }> {
    const key = this.resolveKey(cfg)
    const res = await this.channexReq(key, 'POST', '/channels/mapping_details', {
      channel,
      settings: { hotel_id: hotelId },
    })
    if (!res.ok) return { success: false, rooms: [], error: res.data?.errors?.title || 'Error al obtener mapping details' }
    const data = res.data?.data || res.data || {}
    return { success: true, rooms: Array.isArray(data.rooms) ? data.rooms : [] }
  }

  async listGroups(cfg: CanalesDTO | undefined): Promise<GroupDTO[]> {
    const key = this.resolveKey(cfg)
    const res = await this.channexReq(key, 'GET', '/groups')
    if (!res.ok) return []
    const data = res.data?.data || res.data || []
    return Array.isArray(data) ? data.map((g: any) => ({ id: g.id, name: g.attributes?.name || g.name || g.id })) : []
  }

  /**
   * Reemplaza el mapeo de rate plans de un canal YA CREADO (`PUT /channels/:id`).
   *
   * Es lo que faltaba para que un canal con "Rate Plans Mapeados (0)" se pudiera arreglar desde
   * el panel: hasta ahora solo se podía crear un canal NUEVO con su mapeo, y un canal existente
   * (creado a mano en Channex, o al que se le agregaron rate plans después) no tenía arreglo.
   *
   * Ojo con la semántica de Channex, que es de REEMPLAZO: el array que se manda pasa a ser el
   * mapeo completo — lo que no esté en él se borra. Por eso el caller manda SIEMPRE la lista
   * entera, no un delta.
   */
  async updateChannelMapping(
    cfg: CanalesDTO | undefined,
    channelId: string,
    ratePlans: Array<{ ratePlanId: string; roomTypeCode: string | number; ratePlanCode: string | number; occupancy?: number; pricingType?: string; primaryOcc?: boolean }>,
  ): Promise<{ success: boolean; mapped: number; message: string }> {
    const key = this.resolveKey(cfg)
    const res = await this.channexReq(key, 'PUT', `/channels/${channelId}`, {
      channel: {
        rate_plans: ratePlans.map((rp) => ({
          rate_plan_id: rp.ratePlanId,
          settings: {
            room_type_code: rp.roomTypeCode,
            rate_plan_code: rp.ratePlanCode,
            ...(rp.occupancy ? { occupancy: rp.occupancy } : {}),
            ...(rp.pricingType ? { pricing_type: rp.pricingType } : {}),
            ...(rp.primaryOcc !== undefined ? { primary_occ: rp.primaryOcc } : {}),
          },
        })),
      },
    })
    if (!res.ok) {
      const err = (res.data as any)?.errors
      return { success: false, mapped: 0, message: err?.title || err?.details?.join(', ') || 'Channex rechazó el mapeo' }
    }
    return { success: true, mapped: ratePlans.length, message: `${ratePlans.length} rate plan(s) mapeados` }
  }

  /**
   * `POST /channels/:id/check_readiness` — qué falta para poder activar el canal.
   *
   * La doc lo pone ANTES de `activate`. Sin esto el activate salía a ciegas y, si fallaba, el
   * usuario solo veía "pendiente de activación" sin ningún motivo.
   */
  async checkChannelReadiness(cfg: CanalesDTO | undefined, channelId: string): Promise<{ ready: boolean; issues: string[] }> {
    const key = this.resolveKey(cfg)
    const res = await this.channexReq(key, 'POST', `/channels/${channelId}/check_readiness`, {})
    const payload = (res.data as any)?.data?.attributes ?? (res.data as any)?.data ?? res.data
    // Channex devuelve la lista de problemas; su forma exacta varía por adaptador, así que se
    // normaliza a strings sin asumir una estructura fija.
    const raw = payload?.errors ?? payload?.issues ?? payload?.problems ?? []
    const issues = (Array.isArray(raw) ? raw : [raw])
      .filter(Boolean)
      .map((i: any) => typeof i === 'string' ? i : (i?.title || i?.message || JSON.stringify(i)))
    if (!res.ok) {
      const err = (res.data as any)?.errors
      return { ready: false, issues: issues.length ? issues : [err?.title || 'Channex no pudo verificar el canal'] }
    }
    return { ready: issues.length === 0, issues }
  }

  /** `POST /channels/:id/activate`. Verifica primero: un activate a ciegas no dice por qué falla. */
  async activateChannel(cfg: CanalesDTO | undefined, channelId: string): Promise<{ success: boolean; message: string; issues: string[] }> {
    const readiness = await this.checkChannelReadiness(cfg, channelId)
    if (!readiness.ready) {
      return { success: false, message: 'El canal todavía no puede activarse', issues: readiness.issues }
    }
    const key = this.resolveKey(cfg)
    const res = await this.channexReq(key, 'POST', `/channels/${channelId}/activate`, {})
    if (!res.ok) {
      const err = (res.data as any)?.errors
      return { success: false, message: err?.title || 'Channex rechazó la activación', issues: [] }
    }
    return { success: true, message: 'Canal activado', issues: [] }
  }

  async createOTAChannel(cfg: CanalesDTO | undefined, dto: OTAChannelCreateDTO): Promise<OTAChannelResultDTO> {
    const key = this.resolveKey(cfg)
    const steps = { test: false, mapping: false, create: false, activate: false }

    let ratePlansData = dto.ratePlans
    if (ratePlansData.length === 0 && dto.propertyId) {
      const rps = await this.channexReq(key, 'GET', `/rate_plans?filter[property_id]=${dto.propertyId}`)
      const rpList: any[] = rps.data?.data || []
      ratePlansData = rpList.map((rp: any, i: number) => {
        const a = rp.attributes || rp
        const opts = a.options || []
        return {
          ratePlanId: rp.id || a.id,
          roomTypeCode: i + 1,
          ratePlanCode: i + 1,
          occupancy: opts[0]?.occupancy || 2,
          pricingType: 'per_room',
          primaryOcc: true,
        }
      })
      steps.mapping = ratePlansData.length > 0
    }

    const createRes = await this.channexReq(key, 'POST', '/channels', {
      channel: {
        channel: dto.channel,
        group_id: dto.groupId,
        is_active: true,
        title: dto.title,
        properties: [dto.propertyId],
        rate_plans: ratePlansData.map(rp => ({
          rate_plan_id: rp.ratePlanId,
          settings: {
            room_type_code: Number(rp.roomTypeCode),
            rate_plan_code: Number(rp.ratePlanCode),
            occupancy: rp.occupancy,
            pricing_type: rp.pricingType,
            primary_occ: rp.primaryOcc ?? true,
          },
        })),
        settings: dto.settings || {},
      },
    })

    if (!createRes.ok) {
      const err = createRes.data?.errors
      return { success: false, message: err?.title || err?.details?.join(', ') || 'Error al crear canal OTA', steps }
    }
    steps.create = true
    const channelId = createRes.data?.data?.id

    const actRes = await this.channexReq(key, 'POST', `/channels/${channelId}/activate`, {})
    if (actRes.ok) steps.activate = true

    this.logger.info('Canal OTA creado', { channel: dto.channel, channelId })
    return {
      success: true,
      message: `Canal ${dto.channel} creado y ${steps.activate ? 'activado' : 'pendiente de activación'}`,
      channelId,
      steps,
    }
  }

  async deactivateChannel(cfg: CanalesDTO | undefined, channelId: string): Promise<{ success: boolean; message: string }> {
    const key = this.resolveKey(cfg)
    const res = await this.channexReq(key, 'POST', `/channels/${channelId}/deactivate`, {})
    if (!res.ok) return { success: false, message: res.data?.errors?.title || 'Error al desactivar canal' }
    return { success: true, message: 'Canal desactivado' }
  }

  // ─── Channel detail ──────────────────────────────────────────────────
  async getChannelDetail(cfg: CanalesDTO | undefined, channelId: string): Promise<any | null> {
    const key = this.resolveKey(cfg)
    const ch = await this.channexReq(key, 'GET', `/channels/${channelId}`)
    if (!ch.ok || !ch.data?.data) return null
    const channel = ch.data.data.attributes || ch.data.data

    const rps: any[] = []
    if (cfg?.channexPropertyId) {
      try {
        const rpRes = await this.channexReq(key, 'GET', `/rate_plans?filter[property_id]=${cfg.channexPropertyId}`)
        rps.push(...(rpRes.data?.data || []))
      } catch {}
      try {
        const rtRes = await this.channexReq(key, 'GET', `/room_types?filter[property_id]=${cfg.channexPropertyId}`)
        rps.forEach((rp: any) => {
          const a = rp.attributes || rp
          // DOS correcciones sobre el lookup viejo, que dejaba el título siempre en '—':
          //  - el id del room type puede venir en `attributes.room_type_id` O en
          //    `relationships.room_type.data.id` (mismo fallback que usa `resolveAriTargets`);
          //  - el id del recurso destino está al NIVEL RAÍZ, no dentro de `attributes`.
          const rtId = a.room_type_id || rp.relationships?.room_type?.data?.id
          const rt = (rtRes.data?.data || []).find((r: any) => r.id === rtId)
          a.room_type_title = (rt?.attributes || rt)?.title || '—'
        })
      } catch {}
    }

    return {
      id: channel.id || channelId,
      title: channel.title,
      channel: channel.channel,
      isActive: channel.is_active,
      ratePlans: channel.rate_plans || [],
      settings: channel.settings || {},
      allRatePlans: rps.map((rp: any) => {
        const a = rp.attributes || rp
        const opts = a.options || []
        // Ocupación PRIMARIA (la que el canal usa de referencia), no la primera del array: en
        // per_person `options[0]` es la de 1 persona.
        const primary = opts.find((o: any) => o.is_primary) ?? opts[opts.length - 1] ?? opts[0]
        return {
          id: rp.id, title: a.title, roomTypeId: a.room_type_id,
          roomTypeTitle: a.room_type_title || '—', occupancy: primary?.occupancy || 2,
          sellMode: a.sell_mode || 'per_person',
        }
      }),
    }
  }

  // ─── iFrame ───────────────────────────────────────────────────────────
  async generateIframeToken(cfg: CanalesDTO | undefined, username: string): Promise<string | null> {
    const key = this.resolveKey(cfg)
    if (!cfg?.channexPropertyId) return null
    const res = await this.channexReq(key, 'POST', '/auth/one_time_token', {
      one_time_token: {
        property_id: cfg.channexPropertyId,
        group_id: cfg.channexGroupId || undefined,
        username,
      },
    })
    return res.data?.data?.token || null
  }

  // ─── Bookings ─────────────────────────────────────────────────────────
  async fetchBookingFeed(key: string): Promise<BookingRevisionDTO[]> {
    const res = await this.channexReq(key, 'GET', '/booking_revisions/feed?limit=50')
    const raw = res.data?.data || []
    if (!Array.isArray(raw)) return []
    return raw.map((r: any) => {
      const a = r.attributes || r
      return {
        id: r.id || a.id,
        propertyId: a.property_id,
        bookingId: a.booking_id,
        uniqueId: a.unique_id,
        otaReservationCode: a.ota_reservation_code,
        otaName: a.ota_name,
        status: a.status,
        arrivalDate: a.arrival_date,
        departureDate: a.departure_date,
        amount: a.amount,
        currency: a.currency,
        customer: a.customer || {},
        rooms: (a.rooms || []).map((rm: any) => ({
          roomTypeId: rm.room_type_id || null,
          ratePlanId: rm.rate_plan_id || null,
          checkinDate: rm.checkin_date,
          checkoutDate: rm.checkout_date,
          amount: rm.amount,
          occupancy: rm.occupancy || { adults: 1, children: 0, infants: 0 },
        })),
        insertedAt: a.inserted_at,
      }
    })
  }

  async ackBooking(key: string, revisionId: string): Promise<boolean> {
    const res = await this.channexReq(key, 'POST', `/booking_revisions/${revisionId}/ack`, {})
    return res.ok
  }

  // Resolve el title de un room type de Channex por su UUID.
  // Necesario para mapear bookings OTA (que referencian roomTypeId) a habitaciones locales.
  async getRoomTypeById(key: string, roomTypeId: string): Promise<{ id: string; title: string } | null> {
    try {
      const res = await this.channexReq(key, 'GET', `/room_types/${roomTypeId}`)
      const rt = res.data?.data
      if (!rt) return null
      return { id: rt.id, title: String(rt.attributes?.title || rt.title || '') }
    } catch { return null }
  }
}
