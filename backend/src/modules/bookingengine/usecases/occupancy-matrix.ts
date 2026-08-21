// bookingengine/usecases/occupancy-matrix.ts — Matriz de OCUPACIONES por tipo de habitación.
//
// Lógica PURA (sin DB ni HTTP). La consume `public-rates.ts` para que
// `GET /api/public/hotels/:slug/rates` devuelva, por cada tipo, UNA FILA POR OCUPACIÓN en vez de
// un único precio — el mismo despliegue que muestra la competencia (MisterPlan):
//
//   Habitación Familiar                       Sólo 1 Disponible
//    👤     para 1   Sólo alojamiento   Precio 1 noches USD $70   [0 ▾]
//    👥     para 2   Sólo alojamiento   Precio 1 noches USD $70   [0 ▾]
//    👥👥   para 4   Sólo alojamiento   Precio 1 noches USD $70   [0 ▾]
//
// ─── La regla que define este archivo ───────────────────────────────────────────────────────
// Las ocupaciones que el hotel NO puede vender **NO se ocultan**: viajan igual, con
// `available: false` y un `unavailableReason` estable, para que el frontend las pinte en gris.
// El huésped tiene que ver que la opción EXISTE y no está disponible — no que falte del todo,
// que es indistinguible de "este hotel no ofrece habitaciones para 4".
//
// ─── Precedencia de los motivos (el orden importa) ──────────────────────────────────────────
//   1. `over_capacity`   — en la habitación no entran. Es físico: gana sobre todo lo demás.
//   2. `no_rate`         — no hay tarifa cargada que cubra esa ocupación. VA ANTES que el
//      stop-sell a propósito: sin fila propia, `pickRate` cae a la fila de mayor ocupación
//      disponible, y si ESA está cerrada reportaríamos "stop-sell" de una tarifa que ni siquiera
//      es la de esta fila. Primero decidimos si el producto existe, después si está abierto.
//      ⚠️ Se decide contra las TEMPORADAS DE ESAS NOCHES (`isOccupancyQuotable`), no contra la
//      grilla global del tipo: ver el bloque de abajo.
//   3. `stop_sell`       — el producto existe y el hotel lo cerró (`room_rates.closed`).
//   4. `no_availability` — existe, está abierto y con precio, pero no quedan unidades.
//
// ─── Qué NO se reimplementa acá ─────────────────────────────────────────────────────────────
//  - El precio sale de `sumStayPrice` (`shared/utils/rate-resolution.ts`), el MISMO resolver que
//    ya usan `/rates`, `/calendar` y el reprice del panel, invocado con `guests = occupancy`.
//    Eso arrastra gratis las temporadas, el fallback por noche a `rooms.basePrice` y la regla de
//    "solo tarifas BASE" (un override de Airbnb no se filtra al canal directo).
//  - El stop-sell sale de `isClosedForOccupancy` (`stay-restrictions.ts`), la misma función de la
//    que ya depende `closedRoomTypes` — es decir, el mismo criterio que decide si el tipo entero
//    se saca del motor y que `/calendar` usa para pintar la noche cerrada.
//  - Los `room_blocks` y las reservas ya vienen descontados en `availableByOccupancy`, que lo
//    calcula `AvailabilityUseCase` con `blockedRoomIds`.
//
// ─── FIX — `no_rate` se decide por FECHA, no contra la grilla global del tipo ────────────────
// Antes la grilla de ocupaciones salía de TODAS las filas de `room_rates` del tipo, sin filtrar
// por temporada, mientras el PRECIO se resolvía por temporada (con fallback a `rooms.basePrice`
// para la noche sin `season_assignment`). Las dos mitades se contradecían en el mismo body: un
// tipo con una única fila `occupancy:2` de temporada 'alta', consultado para fechas SIN
// temporada asignada y `guests=3`, devolvía `fromPrice: 160, availableCount: 2` junto a
// `{occupancy:3, price:0, unavailableReason:'no_rate'}` — y `POST /api/public/booking` aceptaba
// esa reserva. La fila gris era una venta que el motor sí podía servir.
// Ahora `covered` sale de `isOccupancyQuotable`, que recorre las noches REALES con la misma
// cadena de precio que `sumStayPrice`: solo es `no_rate` lo que de verdad no se puede cotizar.
import { occupanciesForStay, isOccupancyQuotable, sumStayPrice } from './rate-resolution'
import { round2 } from '../../../shared/utils/money'
import { isClosedForOccupancy } from './stay-restrictions'
import type { OccupancyUnavailableReason } from '../types'

/**
 * Tope de filas de la matriz. Un tipo de habitación de hotel no pasa de acá ni contando dormis
 * compartidos; el límite protege de un `capacity` corrupto en la base (un número absurdo tipeado
 * a mano) que haría iterar y serializar miles de filas en una ruta PÚBLICA sin auth.
 */
export const MAX_OCCUPANCY_ROWS = 30

export interface OccupancyMatrixInput {
  roomType: string
  /** Capacidad del tipo (máxima entre sus habitaciones reales). */
  capacity: number
  /** Índice `i - 1` → unidades libres que aceptan `i` huéspedes (de `AvailabilityUseCase`). */
  availableByOccupancy?: number[]
  /** Fallback de disponibilidad si no vino la matriz de arriba (callers viejos / caché previa). */
  availableCount: number
  /** Noches REALES de la estadía (`[checkIn, checkOut)`). */
  nightDates: string[]
  /** Cantidad de noches, para el caso degenerado en que `nightDates` no se pudo construir. */
  nights: number
  /** Tarifas BASE del hotel (ya pasadas por `baseRatesOnly`). */
  baseRates: any[]
  seasonByDate: Map<string, string>
  /** Precio por noche del tipo sin temporadas (`rooms.basePrice`, el más bajo del tipo). */
  fallbackNightly: number
  /** Huéspedes consultados: garantiza que la fila que el usuario pidió siempre exista. */
  guests: number
}

export interface OccupancyPricing {
  occupancy: number
  /** Total de la estadía en la moneda BASE del hotel (sin convertir). 0 si no hay tarifa. */
  stayTotal: number
  available: boolean
  unavailableReason: OccupancyUnavailableReason | null
}

/**
 * Una entrada por ocupación, de 1 hasta la capacidad del tipo.
 *
 * El rango se estira más allá de `capacity` en dos casos, para no esconderle al huésped una
 * opción que él o el hotel nombraron:
 *  - el hotel cargó una tarifa para MÁS gente de la que entra (fila "para 6" en una habitación
 *    de 4): la opción existe en la grilla, así que se muestra — desactivada, `over_capacity`;
 *  - el huésped buscó para más gente de la que entra: ve su propia consulta en gris en vez de
 *    una lista donde su número no aparece.
 */
export function buildOccupancyMatrix(input: OccupancyMatrixInput): OccupancyPricing[] {
  const {
    roomType, nightDates, nights, baseRates, seasonByDate, fallbackNightly,
  } = input

  const capacity = Math.max(1, Math.floor(Number(input.capacity) || 1))
  const guests = Math.max(1, Math.floor(Number(input.guests) || 1))

  // Ocupaciones con fila propia en `room_rates` PARA LAS TEMPORADAS DE ESTAS NOCHES. Vacío = en
  // estas fechas el tipo no usa la grilla por ocupación (sin temporada asignada, sin tarifas, o
  // modo `per_room`): entonces NINGUNA fila puede reclamar "falta mi tarifa", porque todas
  // cotizan por la misma vía (fallback `rooms.basePrice` / precio único del tipo).
  // Solo se usa para ESTIRAR el rango de filas (una tarifa "para 6" cargada para estas fechas se
  // muestra aunque no entre en la habitación); el motivo `no_rate` lo decide `isOccupancyQuotable`.
  const rateOccupancies = occupanciesForStay(baseRates, roomType, nightDates, seasonByDate)
  const maxRateOccupancy = rateOccupancies.length > 0 ? rateOccupancies[rateOccupancies.length - 1]! : 0

  const maxOccupancy = Math.min(
    MAX_OCCUPANCY_ROWS,
    Math.max(capacity, maxRateOccupancy, guests, 1),
  )

  const availableFor = (occupancy: number): number => {
    const byOcc = input.availableByOccupancy
    if (Array.isArray(byOcc) && byOcc.length > 0) {
      return occupancy <= byOcc.length ? (Number(byOcc[occupancy - 1]) || 0) : 0
    }
    // Degradación: sin la matriz de disponibilidad, se asume que las unidades libres del tipo
    // sirven para cualquier ocupación que la capacidad admita. Es exactamente lo que el endpoint
    // podía afirmar antes de este cambio — no se inventa un cierre que no consta.
    return occupancy <= capacity ? Math.max(0, Number(input.availableCount) || 0) : 0
  }

  const rows: OccupancyPricing[] = []
  for (let occupancy = 1; occupancy <= maxOccupancy; occupancy++) {
    // MISMO resolver que `fromPrice`, solo que cotizando para `occupancy` en vez de `guests`.
    const stayTotal = nightDates.length > 0
      ? sumStayPrice(nightDates, baseRates, roomType, seasonByDate, occupancy, fallbackNightly)
      : round2(fallbackNightly * Math.max(1, nights))

    const reason = resolveReason({
      occupancy, capacity, stayTotal,
      baseRates, seasonByDate, roomType, nightDates,
      availableUnits: availableFor(occupancy),
    })

    rows.push({
      occupancy,
      // Sin tarifa que cubra la ocupación, el precio que devolvería el resolver es el de OTRA
      // fila (la de menos gente): mostrarlo sería cotizar algo que el hotel no puso en venta.
      stayTotal: reason === 'no_rate' ? 0 : stayTotal,
      available: reason === null,
      unavailableReason: reason,
    })
  }
  return rows
}

interface ReasonInput {
  occupancy: number
  capacity: number
  stayTotal: number
  baseRates: any[]
  seasonByDate: Map<string, string>
  roomType: string
  nightDates: string[]
  availableUnits: number
}

/** `null` = se puede vender. Ver la precedencia documentada en la cabecera del archivo. */
function resolveReason(i: ReasonInput): OccupancyUnavailableReason | null {
  if (i.occupancy > i.capacity) return 'over_capacity'

  // "Cubrir" = para CADA noche del rango, o la temporada de esa noche tiene una fila con
  // ocupación >= la pedida, o esa noche no tiene grilla y cotiza por el fallback
  // `rooms.basePrice` (que no distingue ocupaciones). Una habitación con tarifa "para 4" cotiza
  // a 1, 2 y 3 huéspedes: es el mismo producto con menos gente adentro. Lo que NO cubre es al
  // revés: cargar 1 y 2 no habilita "para 3" — pero solo en las noches donde esa grilla rige.
  if (!isOccupancyQuotable(i.baseRates, i.roomType, i.nightDates, i.seasonByDate, i.occupancy)) {
    return 'no_rate'
  }
  // Sin grilla y sin `rooms.basePrice`: no hay ningún precio que mostrar.
  if (i.stayTotal <= 0) return 'no_rate'

  if (isClosedForOccupancy(i.baseRates, i.seasonByDate, i.roomType, i.nightDates, i.occupancy)) {
    return 'stop_sell'
  }
  if (i.availableUnits <= 0) return 'no_availability'
  return null
}
