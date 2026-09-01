import { readRatePlans, type RatePlanDef } from '../../../shared/utils/rate-plans'
export type PricingMode = 'per_room' | 'per_person'

export class PricingQueries {
  /** Planes del hotel (BAR, B&B, …). La lógica y el default viven en shared/utils/rate-plans.ts. */
  ratePlans(hotelId: string): Promise<RatePlanDef[]> {
    return readRatePlans((m, q) => this.orm.findMany(m, q) as Promise<any[]>, hotelId)
  }

  constructor(private readonly orm: any) {}

  /**
   * Modo de tarificación del hotel (config PMS por cliente):
   *  - 'per_room'   → un precio por habitación sin importar huéspedes (default).
   *  - 'per_person' → precio distinto por cantidad de personas (occupancy-based).
   * Guardado en configuration(hotelId, key='pricing_mode') = { mode }.
   */
  async getPricingMode(hotelId: string): Promise<PricingMode> {
    try {
      const rows = await this.orm.findMany('Configuration', { hotelId, key: 'pricing_mode' }) as any[]
      const raw = rows[0]?.value
      const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return raw } })() : raw
      const mode = (v && typeof v === 'object') ? v.mode : v
      return mode === 'per_person' ? 'per_person' : 'per_room'
    } catch { return 'per_room' }
  }

  async setPricingMode(hotelId: string, mode: PricingMode): Promise<PricingMode> {
    const value = { mode: mode === 'per_person' ? 'per_person' : 'per_room' }
    const rows = await this.orm.findMany('Configuration', { hotelId, key: 'pricing_mode' }) as any[]
    if (rows[0]) await this.orm.update('Configuration', rows[0].id, { value })
    else await this.orm.create('Configuration', { id: crypto.randomUUID(), hotelId, key: 'pricing_mode', value })
    return value.mode as PricingMode
  }

  /**
   * Tipos de habitación del hotel expandidos por ocupación según el modo:
   *  - per_room   → una fila por tipo (ocupación = capacidad).
   *  - per_person → una fila por cada ocupación 1..capacidad (para precio por persona).
   */
  async roomTypesFor(hotelId: string, mode: PricingMode = 'per_room'): Promise<{ type: string; occupancy: number; basePrice: number }[]> {
    const rooms = await this.orm.findMany('Rooms', { hotelId }) as any[]
    // Un tipo agrupa VARIAS habitaciones físicas, que pueden tener capacidad y basePrice
    // distintos entre sí. FIX (revisión Tarea 2, 2026-08-20): antes se quedaba con los valores
    // de la PRIMERA habitación de ese tipo que apareciera en la query (orden no garantizado),
    // ignorando al resto — con capacidad, esto directamente SUBGENERABA filas de ocupación (una
    // suite de 2 y otra de 4 del mismo tipo derivaban solo occupancy 1-2, aunque exista una
    // unidad real que aloja 4). Mismo criterio que ya usa el motor público para publicar "desde
    // $X" y la capacidad del tipo (`bookingengine/usecases/availability.ts:aggregate` — capacidad
    // MÁXIMA entre las unidades, precio MÍNIMO positivo) — consistente con lo que el huésped ya ve.
    const byType = new Map<string, { type: string; capacity: number; basePrice: number }>()
    for (const r of rooms) {
      const type = r.type || 'standard'
      const capacity = Math.max(1, Number(r.capacity) || 2)
      const price = Number(r.basePrice) || 0
      const existing = byType.get(type)
      if (!existing) {
        byType.set(type, { type, capacity, basePrice: price })
      } else {
        existing.capacity = Math.max(existing.capacity, capacity)
        if (price > 0 && (existing.basePrice === 0 || price < existing.basePrice)) existing.basePrice = price
      }
    }
    const out: { type: string; occupancy: number; basePrice: number }[] = []
    for (const t of byType.values()) {
      if (mode === 'per_person') {
        for (let occ = 1; occ <= t.capacity; occ++) out.push({ type: t.type, occupancy: occ, basePrice: t.basePrice })
      } else {
        out.push({ type: t.type, occupancy: t.capacity, basePrice: t.basePrice })
      }
    }
    return out
  }

  /**
   * Grilla de tarifas BASE (channel=''): las reales si existen, o derivadas de los tipos de
   * habitación × temporadas si el hotel todavía no guardó ninguna — mismo criterio "nunca vacío"
   * que ya usa `listChannelRates` para las vistas por canal, pero escrito aparte (no reusando esa
   * función con channel='') porque su merge con `overrides` compara `r.channel === channel` contra
   * `!r.channel`: una fila real con `channel: undefined` matchea el segundo pero no el primero, y
   * reusarla ahí devolvería la celda GENERADA en vez de la real (perdiendo su `id`/percentage/
   * closed ya guardados) para cualquier fila cuyo `channel` no sea el string `''` exacto.
   *
   * Bug real que esto cierra (Tarea 2, QA 2026-08-20): sin esto, un hotel que nunca guardó una
   * tarifa base veía "Temporadas y Tarifas" vacío y no tenía forma de configurar precio por
   * ocupación salvo entrando a Channel Manager → un canal OTA ya conectado (donde
   * `listChannelRates` sí generaba el esqueleto) — inalcanzable para un hotel sin canales.
   */
  async listBaseRates(hotelId: string, allRates?: any[]): Promise<any[]> {
    const all = allRates ?? (await this.orm.findMany('RoomRates', { hotelId }) as any[])
    const base = all.filter((r) => !r.channel)
    if (base.length) return base

    const mode = await this.getPricingMode(hotelId)
    const seasons = await this.orm.findMany('Seasons', { hotelId }) as any[]
    const seasonNames = seasons.length ? seasons.map((s: any) => s.name) : ['baja', 'media', 'alta', 'especial']
    const roomTypes = await this.roomTypesFor(hotelId, mode)
    const out: any[] = []
    for (const rt of roomTypes) {
      for (const season of seasonNames) {
        out.push({
          hotelId, roomType: rt.type, occupancy: rt.occupancy, season, channel: '',
          basePrice: rt.basePrice, percentage: 0, price: rt.basePrice, closed: 0, minStay: 0, maxStay: 0,
          _inherited: true,
        })
      }
    }
    return out
  }

  /**
   * Grilla de tarifas para un canal: una fila por (roomType × occupancy × season). La base sale de las
   * tarifas base (channel='') si existen; si no, se deriva de los tipos de habitación + temporadas para
   * que el editor nunca aparezca vacío (estilo MisterPlan). Aplica el override del canal donde exista;
   * las demás filas van marcadas `_inherited` (aún sin override propio, precio = base).
   */
  async listChannelRates(hotelId: string, channel: string, allRates?: any[]): Promise<any[]> {
    const all = allRates ?? (await this.orm.findMany('RoomRates', { hotelId }) as any[])
    const base = all.filter((r) => !r.channel)
    const key = (rt: string, occ: number, s: string) => `${rt}|${occ}|${s}`
    const overrides = new Map(all.filter((r) => r.channel === channel).map((o) => [key(o.roomType, o.occupancy, o.season), o]))
    const baseByKey = new Map(base.map((b) => [key(b.roomType, b.occupancy, b.season), b]))

    // Celdas base: las tarifas base existentes, o derivadas de room types × temporadas si no hay ninguna.
    // Con per_person se expanden por cada ocupación; con per_room, una por tipo.
    const mode = await this.getPricingMode(hotelId)
    let cells: { roomType: string; occupancy: number; season: string; basePrice: number }[]
    if (base.length) {
      cells = base.map((b) => ({ roomType: b.roomType, occupancy: b.occupancy, season: b.season, basePrice: b.basePrice ?? 0 }))
    } else {
      const seasons = await this.orm.findMany('Seasons', { hotelId }) as any[]
      const seasonNames = seasons.length ? seasons.map((s: any) => s.name) : ['baja', 'media', 'alta', 'especial']
      const roomTypes = await this.roomTypesFor(hotelId, mode)
      cells = []
      for (const rt of roomTypes) for (const season of seasonNames) cells.push({ roomType: rt.type, occupancy: rt.occupancy, season, basePrice: rt.basePrice })
    }

    return cells.map((c) => {
      const ov = overrides.get(key(c.roomType, c.occupancy, c.season))
      if (ov) return ov
      const b = baseByKey.get(key(c.roomType, c.occupancy, c.season))
      const basePrice = (b?.basePrice ?? c.basePrice) || 0
      return { hotelId, roomType: c.roomType, occupancy: c.occupancy, season: c.season, channel, basePrice, percentage: 0, price: basePrice, closed: 0, minStay: 0, maxStay: 0, _inherited: true }
    })
  }

  async getChannelMetrics(hotelId: string): Promise<any[]> {
    const reservations = await this.orm.findMany('Reservations', { hotelId }) as any[]
    const rooms = await this.orm.findMany('Rooms', { hotelId }) as any[]
    const byChannel: Record<string, { count: number; revenue: number; nights: number }> = {}
    for (const r of reservations) {
      const ch = r.channel || 'direct'
      if (!byChannel[ch]) byChannel[ch] = { count: 0, revenue: 0, nights: 0 }
      byChannel[ch].count++; byChannel[ch].revenue += r.totalAmount || 0
      const ci = new Date(String(r.checkIn).slice(0, 10)).getTime()
      const co = new Date(String(r.checkOut).slice(0, 10)).getTime()
      byChannel[ch].nights += co > ci ? Math.round((co - ci) / 86400000) : 0
    }
    return Object.entries(byChannel).map(([channel, data]) => ({
      channel, bookings: data.count, revenue: data.revenue,
      adr: data.nights > 0 ? Math.round(data.revenue / data.nights) : 0,
      revpar: rooms.length > 0 ? Math.round(data.revenue / rooms.length) : 0,
      avgStay: data.count > 0 ? (data.nights / data.count).toFixed(1) : '0',
    }))
  }
}
