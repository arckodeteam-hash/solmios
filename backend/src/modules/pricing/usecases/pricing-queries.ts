import { readRatePlans, type RatePlanDef } from '../../../shared/utils/rate-plans'
export type PricingMode = 'per_room' | 'per_person'

/** Temporadas de arranque cuando el hotel todavía no tiene catálogo propio. */
const DEFAULT_SEASON_NAMES = ['baja', 'media', 'alta', 'especial']

/** Una celda de la grilla de tarifas. La clave natural de `room_rates` sin el canal. */
interface RateGridCell {
  roomType: string
  occupancy: number
  season: string
  basePrice: number
}

const rateKey = (roomType: string, occupancy: number, season: string): string =>
  `${roomType}|${occupancy}|${season}`

const effectivePrice = (basePrice: number, percentage: number): number =>
  Math.round(basePrice * (1 + percentage / 100) * 100) / 100

export class PricingQueries {
  /**
   * Los dos EJES de la grilla de tarifas por fecha: los planes del hotel (BAR, B&B, … — catálogo y
   * default en shared/utils/rate-plans.ts) y sus tipos de habitación REALES.
   *
   * Los tipos salen de `Rooms`, no de `listBaseRates`: ese devuelve solo las filas de `room_rates`
   * que existen, así que un hotel que tarifó `double` por temporada perdería `single`/`suite`/
   * `triple` — y son justamente los que hay que poder tarifar para una fecha puntual.
   */
  async rateGridAxes(hotelId: string): Promise<{ plans: RatePlanDef[]; roomTypes: string[] }> {
    const [plans, types] = await Promise.all([
      readRatePlans((m, q) => this.orm.findMany(m, q) as Promise<any[]>, hotelId),
      this.roomTypesFor(hotelId, 'per_room'),
    ])
    return { plans, roomTypes: [...new Set(types.map((t) => String(t.type)).filter(Boolean))] }
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
   * Todas las combinaciones (tipo × ocupación × temporada) que el hotel PUEDE tarifar hoy.
   * `per_room` da una ocupación por tipo (la capacidad); `per_person`, una por cada ocupación.
   */
  private async rateGridCells(hotelId: string, mode: PricingMode): Promise<RateGridCell[]> {
    const seasons = await this.orm.findMany('Seasons', { hotelId }) as any[]
    const seasonNames = seasons.length ? seasons.map((s: any) => String(s.name)) : DEFAULT_SEASON_NAMES
    const roomTypes = await this.roomTypesFor(hotelId, mode)
    const out: RateGridCell[] = []
    for (const rt of roomTypes) {
      for (const season of seasonNames) {
        out.push({ roomType: rt.type, occupancy: rt.occupancy, season, basePrice: rt.basePrice })
      }
    }
    return out
  }

  /**
   * Completa la grilla: cada celda con fila guardada devuelve la fila REAL (con su id y todo lo
   * que el hotel cargó); las que faltan se generan heredando de las vecinas.
   *
   * Por qué la unión y no "si hay filas guardadas, devolver solo esas" (que es lo que hacía antes):
   * apenas el hotel guardaba UNA tarifa, el editor dejaba de mostrar el resto de la grilla. En el
   * hotel de certificación eso se veía como tres bugs distintos que en realidad eran el mismo —
   * aparecía un solo tipo de habitación (`double`), dos temporadas de cuatro (las que tenían fila)
   * y una sola ocupación — y el switch "Por persona" no hacía nada visible, porque las filas
   * guardadas tapaban las ocupaciones derivadas. Todo lo que el hotel no tarifó todavía quedaba
   * inalcanzable desde la UI, sin ninguna señal de por qué.
   *
   * Qué hereda una celda nueva, y de dónde:
   *  - `basePrice`, `minStay`, `maxStay` son del GRUPO (tipo × ocupación) — es como los agrupa la UI;
   *  - `percentage` y `closed` son de la TEMPORADA de ese tipo, así una ocupación nueva arranca con
   *    la misma curva de recargos que la que ya estaba cargada, en vez de en cero.
   */
  private fillRateGrid(hotelId: string, cells: RateGridCell[], saved: any[], channel: string): any[] {
    const byKey = new Map(saved.map((r) => [rateKey(r.roomType, r.occupancy, r.season), r]))
    const byGroup = new Map<string, any>()
    const bySeasonOfType = new Map<string, any>()
    const byType = new Map<string, any>()
    for (const r of saved) {
      const group = `${r.roomType}|${r.occupancy}`
      if (!byGroup.has(group)) byGroup.set(group, r)
      const seasonOfType = `${r.roomType}|${r.season}`
      if (!bySeasonOfType.has(seasonOfType)) bySeasonOfType.set(seasonOfType, r)
      if (!byType.has(r.roomType)) byType.set(r.roomType, r)
    }

    const filled = cells.map((c) => {
      const real = byKey.get(rateKey(c.roomType, c.occupancy, c.season))
      if (real) return real
      const group = byGroup.get(`${c.roomType}|${c.occupancy}`) ?? byType.get(c.roomType)
      const sameSeason = bySeasonOfType.get(`${c.roomType}|${c.season}`)
      const basePrice = Number(group?.basePrice) || c.basePrice || 0
      const percentage = Number(sameSeason?.percentage) || 0
      return {
        hotelId, roomType: c.roomType, occupancy: c.occupancy, season: c.season, channel,
        basePrice, percentage, price: effectivePrice(basePrice, percentage),
        closed: Number(sameSeason?.closed) || 0,
        minStay: Number(group?.minStay) || 0,
        maxStay: Number(group?.maxStay) || 0,
        _inherited: true,
      }
    })

    // Filas guardadas que ya no entran en la grilla (tipo de habitación borrado, temporada sacada
    // del catálogo, ocupación por encima de la capacidad actual). Se devuelven igual: esconderlas
    // las haría desaparecer del editor sin borrarlas de la base, y seguirían publicándose.
    const inGrid = new Set(cells.map((c) => rateKey(c.roomType, c.occupancy, c.season)))
    const orphans = saved.filter((r) => !inGrid.has(rateKey(r.roomType, r.occupancy, r.season)))
    return [...filled, ...orphans]
  }

  /** Grilla de tarifas BASE (channel=''): la grilla completa, con las filas reales donde existen. */
  async listBaseRates(hotelId: string, allRates?: any[]): Promise<any[]> {
    const all = allRates ?? (await this.orm.findMany('RoomRates', { hotelId }) as any[])
    const mode = await this.getPricingMode(hotelId)
    const cells = await this.rateGridCells(hotelId, mode)
    return this.fillRateGrid(hotelId, cells, all.filter((r) => !r.channel), '')
  }

  /**
   * Grilla de tarifas de un CANAL: la misma grilla, con el override del canal donde exista.
   *
   * Una celda sin override hereda la tarifa base COMPLETA (incluido el % de temporada y los
   * cierres), no solo el precio base con 0%. Eso es lo que el push publica realmente para esa
   * celda (`canales/usecases/push-rates.ts` usa la fila base cuando el canal no tiene override),
   * así que mostrar 0% hacía que el editor anunciara un precio distinto al que ve la OTA.
   */
  async listChannelRates(hotelId: string, channel: string, allRates?: any[]): Promise<any[]> {
    const all = allRates ?? (await this.orm.findMany('RoomRates', { hotelId }) as any[])
    const mode = await this.getPricingMode(hotelId)
    const cells = await this.rateGridCells(hotelId, mode)
    const base = this.fillRateGrid(hotelId, cells, all.filter((r) => !r.channel), '')
    const overrides = new Map(
      all.filter((r) => r.channel === channel).map((o) => [rateKey(o.roomType, o.occupancy, o.season), o]),
    )
    const out = base.map((b) => {
      const override = overrides.get(rateKey(b.roomType, b.occupancy, b.season))
      if (override) return override
      // Sin `id`: es una celda del CANAL derivada de la base, no la fila base — devolver su id
      // invitaría a que un guardado la pisara.
      const { id: _id, ...cell } = b
      return { ...cell, channel, _inherited: true }
    })
    const inOut = new Set(out.map((r) => rateKey(r.roomType, r.occupancy, r.season)))
    return [...out, ...[...overrides.values()].filter((o) => !inOut.has(rateKey(o.roomType, o.occupancy, o.season)))]
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
