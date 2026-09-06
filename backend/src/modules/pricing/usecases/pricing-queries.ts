import { readRatePlans, type RatePlanDef } from '../../../shared/utils/rate-plans'
import { resolveSeasonPrice } from '../../../shared/utils/season-price'
// El hotel tarifa SIEMPRE por persona (ocupación). Existió un modo 'per_room' (un precio por
// habitación sin importar cuánta gente entre) con un switch en la UI, y se sacó: era la fuente de
// una clase entera de confusiones — la grilla mostraba una sola fila por tipo, el precio de "1
// persona" se podía editar pero NUNCA se publicaba (el push se quedaba con la ocupación más alta),
// y cambiar el switch no tenía efecto real hasta re-sincronizar la propiedad en Channex, porque el
// `sell_mode` de los rate plans se fija al crearlos. Un solo modo elimina las tres.

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

/** El precio de una fila GLOBAL: el importe que el hotel cargó, con los fallbacks (fila vieja
 *  guardada como porcentaje, celda nunca cargada) que documenta `resolveSeasonPrice`. */
const seasonPriceOf = (row: any, typeBasePrice: number): number => resolveSeasonPrice(row, typeBasePrice)

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
      this.roomTypesFor(hotelId),
    ])
    return { plans, roomTypes: [...new Set(types.map((t) => String(t.type)).filter(Boolean))] }
  }

  constructor(private readonly orm: any) {}

  /**
   * Tipos de habitación del hotel expandidos por ocupación: una fila por cada ocupación
   * 1..capacidad. El hotel tarifa SIEMPRE por persona — ver la nota del encabezado.
   */
  async roomTypesFor(hotelId: string): Promise<{ type: string; occupancy: number; basePrice: number }[]> {
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
      for (let occ = 1; occ <= t.capacity; occ++) out.push({ type: t.type, occupancy: occ, basePrice: t.basePrice })
    }
    return out
  }

  /**
   * Todas las combinaciones (tipo × ocupación × temporada) que el hotel PUEDE tarifar hoy:
   * una fila por cada ocupación 1..capacidad de cada tipo, por cada temporada del catálogo.
   */
  private async rateGridCells(hotelId: string): Promise<RateGridCell[]> {
    const seasons = await this.orm.findMany('Seasons', { hotelId }) as any[]
    const seasonNames = seasons.length ? seasons.map((s: any) => String(s.name)) : DEFAULT_SEASON_NAMES
    const roomTypes = await this.roomTypesFor(hotelId)
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
      // El base de una fila guardada NO es el que tiene grabado, es el del tipo de habitación:
      // uno solo para todas las temporadas, ocupaciones y canales (ver shared/utils/base-price.ts).
      // Devolver el grabado es lo que dejaba que el editor mostrara 220 mientras el hotel tenía
      // 120 cargado en la habitación. `c.basePrice` sale de `roomTypesFor`; si el tipo ya no
      // existe vale 0 y se respeta lo grabado, que es lo que se está publicando.
      if (real) {
        // El PRECIO de una fila global es el importe que el hotel cargó para esa temporada, no
        // `basePrice × porcentaje`: desde que la grilla se edita en pesos, derivarlo volvería a
        // mostrar un número distinto del que se guardó (y del que se cobra).
        const base = c.basePrice || Number(real.basePrice) || 0
        return { ...real, basePrice: base, price: seasonPriceOf(real, base) }
      }
      const group = byGroup.get(`${c.roomType}|${c.occupancy}`) ?? byType.get(c.roomType)
      const sameSeason = bySeasonOfType.get(`${c.roomType}|${c.season}`)
      const basePrice = c.basePrice || Number(group?.basePrice) || 0
      // Una celda que el hotel todavía no cargó arranca con el PRECIO que ya tiene esa temporada en
      // el mismo tipo (otra ocupación), y recién si no hay ninguno cae al base del tipo. Antes se
      // heredaba el porcentaje; con la grilla en pesos se hereda el importe, que es el mismo criterio
      // traducido: la ocupación nueva no debería aparecer más barata que la que ya estaba cargada.
      const percentage = Number(sameSeason?.percentage) || 0
      const price = Number(sameSeason?.price) || basePrice
      return {
        hotelId, roomType: c.roomType, occupancy: c.occupancy, season: c.season, channel,
        basePrice, percentage, price,
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
    const cells = await this.rateGridCells(hotelId)
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
    const cells = await this.rateGridCells(hotelId)
    const base = this.fillRateGrid(hotelId, cells, all.filter((r) => !r.channel), '')
    const overrides = new Map(
      all.filter((r) => r.channel === channel).map((o) => [rateKey(o.roomType, o.occupancy, o.season), o]),
    )
    const out = base.map((b) => {
      const override = overrides.get(rateKey(b.roomType, b.occupancy, b.season))
      // El override del canal aporta el PORCENTAJE y los cierres, nunca el precio base: ese es uno
      // solo por tipo de habitación y ya viene derivado en la celda base (ver shared/utils/base-price.ts). Antes
      // se devolvía la fila cruda, y era el camino por el que el editor del canal mostraba 220
      // mientras la habitación tenía 120 cargado.
      if (override) {
        const base = Number(b.basePrice) || Number(override.basePrice) || 0
        // El porcentaje del canal se aplica sobre el PRECIO DE LA TEMPORADA (`b.price`, la celda
        // global de esta misma combinación), no sobre el precio base del tipo. Es lo que hace el
        // guardado (`shared/utils/season-price.ts`) y lo que se publica: derivarlo del base acá hacía
        // que el editor del canal anunciara un precio y la OTA vendiera otro.
        const seasonPrice = Number(b.price) || base
        return {
          ...override, basePrice: base, seasonPrice,
          price: effectivePrice(seasonPrice, Number(override.percentage) || 0),
        }
      }
      // Sin `id`: es una celda del CANAL derivada de la base, no la fila base — devolver su id
      // invitaría a que un guardado la pisara.
      const { id: _id, ...cell } = b
      // Sin override, el canal vende el precio de la temporada tal cual (0% de recargo).
      return { ...cell, channel, seasonPrice: Number(b.price) || 0, percentage: 0, _inherited: true }
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
