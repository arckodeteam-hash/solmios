// reservas/tests/reschedule-pricing.test.ts — Precio del reagendado desde el planning.
//
// El bug que reportó el dueño: al arrastrar una reserva a otra habitación "siempre se queda con
// el mismo precio". Era cierto — `buildQuote` cobraba `basePrice × (noches nuevas - noches viejas)`,
// así que mover SIN cambiar las noches daba diferencia 0 aunque el cuarto destino valiera el doble,
// y nunca pasaba por temporadas.
//
// Ahora el quote devuelve SIEMPRE las dos opciones (`keepTotal` / `repricedTotal`) y `pricingMode`
// decide cuál se aplica en el commit. Regresión a cuidar: si el reprice vuelve a calcularse como
// "noches agregadas × basePrice", el primer test de acá (mover a suite sin cambiar fechas) vuelve
// a dar 0 en `repricedDifference`.

import { describe, it, expect } from 'bun:test'
import { quoteReschedule, commitReschedule, type RescheduleDeps } from '../usecases/reschedule'
import { paidSourceFrom } from '../../../shared/usecases/reservation-paid'

// Lo cobrado real (GH-0.2). Repos vacíos ⇒ la implementación REAL cae al `deposit` de la reserva,
// que es lo que estos tests modelan (sin folio ni factura de por medio).
const noMoneyRows = { findMany: async () => [] as any[] }
const paidOf = paidSourceFrom({ folioRepo: noMoneyRows, invoiceRepo: noMoneyRows, paymentRepo: noMoneyRows })

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const silentCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any

const HOTEL = 'hotel-a'
const hotelAdmin = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

// Reserva base: 2 noches (10 y 11 de enero), pactada en 200 (100/noche en la standard).
function makeReservation(over: Record<string, any> = {}) {
  return {
    id: 'r1', hotelId: HOTEL, roomId: 'room-1', checkIn: '2030-01-10', checkOut: '2030-01-12',
    totalAmount: 200, currency: 'USD', status: 'confirmed', adults: 2, children: 0, ...over,
  }
}

const ROOMS: Record<string, any> = {
  'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, type: 'standard' },
  'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 200, type: 'suite' },
}

// 10/01 = temporada baja · 11/01 y 12/01 = temporada alta (la estadía base cruza las dos).
const SEASON_ASSIGNMENTS = [
  { hotelId: HOTEL, date: '2030-01-10', season: 'low' },
  { hotelId: HOTEL, date: '2030-01-11', season: 'high' },
  { hotelId: HOTEL, date: '2030-01-12', season: 'high' },
]

const ROOM_RATES = [
  { hotelId: HOTEL, roomType: 'standard', season: 'low', occupancy: 2, price: 80, channel: '' },
  { hotelId: HOTEL, roomType: 'standard', season: 'high', occupancy: 2, price: 90, channel: '' },
  { hotelId: HOTEL, roomType: 'suite', season: 'low', occupancy: 2, price: 150, channel: '' },
  { hotelId: HOTEL, roomType: 'suite', season: 'high', occupancy: 2, price: 250, channel: '' },
  { hotelId: HOTEL, roomType: 'suite', season: 'high', occupancy: 4, price: 400, channel: '' },
  // Override de canal OTA: NO debe filtrarse al precio del panel (solo tarifas BASE).
  { hotelId: HOTEL, roomType: 'suite', season: 'high', occupancy: 2, price: 9999, channel: 'airbnb' },
]

function makeRepo(reserva: any) {
  return {
    findById: async () => reserva,
    findMany: async () => [],
    update: async (id: string, data: any) => ({ ...reserva, ...data, id }),
  }
}

function makeRoomRepo() {
  return {
    findById: async (id: string) => ROOMS[id] ?? null,
    findOne: async (q: { id: string }) => ROOMS[q.id] ?? null,
  }
}

const listRepo = (rows: any[]) => ({ findMany: async () => rows })

/** `withRates: false` = sin repos de temporadas → el reprice debe degradar a `rooms.basePrice`. */
function makeDeps(reserva: any, withRates = true): RescheduleDeps {
  return {
    repo: makeRepo(reserva),
    roomRepo: makeRoomRepo(),
    logger: noopLogger,
    cache: silentCache,
    paidOf,
    sockets: {},
    // STR-2: el commit reprecia y el saldo persistido tiene que moverse con el total nuevo.
    addonsOf: async () => [],
    ...(withRates
      ? { seasonAssignmentRepo: listRepo(SEASON_ASSIGNMENTS), roomRateRepo: listRepo(ROOM_RATES) }
      : {}),
  }
}

describe('quoteReschedule — mover de habitación SIN cambiar las noches (el bug reportado)', () => {
  it('keep da 0 de diferencia, reprice cobra la suite a tarifa vigente', async () => {
    const quote = await quoteReschedule(makeDeps(makeReservation()), 'r1', { roomId: 'room-2' }, hotelAdmin)

    expect(quote.roomChanged).toBe(true)
    expect(quote.datesChanged).toBe(false)
    expect(quote.oldNights).toBe(2)
    expect(quote.newNights).toBe(2)

    // Opción 1 — precio pactado: nada cambia (es EXACTAMENTE el comportamiento histórico).
    expect(quote.keepDifference).toBe(0)
    expect(quote.keepTotal).toBe(200)

    // Opción 2 — repreciar: 10/01 baja (150) + 11/01 alta (250) = 400, +200 sobre lo pactado.
    expect(quote.repricedTotal).toBe(400)
    expect(quote.repricedDifference).toBe(200)
    expect(quote.repricedFromRates).toBe(true)

    // Sin `pricingMode` explícito, lo aplicado sigue siendo `keep` (no rompe callers viejos).
    expect(quote.pricingMode).toBe('keep')
    expect(quote.quotedNewPrice).toBe(200)
    expect(quote.difference).toBe(0)
  })

  it('con pricingMode reprice, quotedNewPrice/difference reflejan el reprice', async () => {
    const quote = await quoteReschedule(makeDeps(makeReservation()), 'r1', { roomId: 'room-2', pricingMode: 'reprice' }, hotelAdmin)
    expect(quote.pricingMode).toBe('reprice')
    expect(quote.quotedNewPrice).toBe(400)
    expect(quote.difference).toBe(200)
  })

  it('ignora el override de canal OTA (solo tarifas BASE)', async () => {
    const quote = await quoteReschedule(makeDeps(makeReservation()), 'r1', { roomId: 'room-2', pricingMode: 'reprice' }, hotelAdmin)
    expect(quote.repricedTotal).not.toBe(9999 + 150)
    expect(quote.repricedTotal).toBe(400)
  })

  it('elige la fila de room_rates por ocupación de la reserva (adults)', async () => {
    const cuatro = makeReservation({ adults: 4 })
    const quote = await quoteReschedule(makeDeps(cuatro), 'r1', { roomId: 'room-2', pricingMode: 'reprice' }, hotelAdmin)
    // 10/01 baja: no hay fila occupancy 4 → cae a la mayor disponible (150).
    // 11/01 alta: fila exacta occupancy 4 → 400.
    expect(quote.repricedTotal).toBe(550)
  })
})

describe('quoteReschedule — estadía que cruza dos temporadas', () => {
  it('suma noche a noche, no precio fijo × noches', async () => {
    // Extiende a 3 noches en la MISMA habitación: 10/01 baja 80 + 11/01 alta 90 + 12/01 alta 90.
    const quote = await quoteReschedule(makeDeps(makeReservation()), 'r1', { checkOut: '2030-01-13', pricingMode: 'reprice' }, hotelAdmin)
    expect(quote.newNights).toBe(3)
    expect(quote.repricedTotal).toBe(260)
    expect(quote.repricedDifference).toBe(60)
    // `keep` cobraría la noche extra a tarifa base (100), ignorando las temporadas.
    expect(quote.keepTotal).toBe(300)
    expect(quote.keepDifference).toBe(100)
    // Y NO es `precio de la primera noche × 3` (80 × 3 = 240): cada noche vale lo suyo.
    expect(quote.repricedTotal).not.toBe(240)
  })
})

describe('quoteReschedule — acortar la estadía (diferencia NEGATIVA)', () => {
  it('el reprice puede dar menos que lo pactado: saldo a favor del huésped', async () => {
    // De 2 noches a 1: solo queda el 10/01 en temporada baja (80).
    const quote = await quoteReschedule(makeDeps(makeReservation()), 'r1', { checkOut: '2030-01-11', pricingMode: 'reprice' }, hotelAdmin)
    expect(quote.newNights).toBe(1)
    expect(quote.repricedTotal).toBe(80)
    expect(quote.repricedDifference).toBe(-120)
    expect(quote.difference).toBeLessThan(0)
  })

  it('mover a una habitación MÁS BARATA también puede dar negativo', async () => {
    // Reserva pactada en la suite a 500 y se la mueve a la standard: 80 + 90 = 170.
    const cara = makeReservation({ roomId: 'room-2', totalAmount: 500 })
    const quote = await quoteReschedule(makeDeps(cara), 'r1', { roomId: 'room-1', pricingMode: 'reprice' }, hotelAdmin)
    expect(quote.repricedTotal).toBe(170)
    expect(quote.repricedDifference).toBe(-330)
  })
})

describe('commitReschedule — aplica el modo pedido', () => {
  it('modo keep (default) deja el total intacto al mover de habitación', async () => {
    const result = await commitReschedule(makeDeps(makeReservation()), 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(result.reservation.roomId).toBe('room-2')
    expect(result.reservation.totalAmount).toBe(200)
    expect(result.quote.newTotal).toBe(200)
    expect(result.quote.creditAmount).toBe(0)
  })

  it('modo reprice persiste el total repreciado de la habitación destino', async () => {
    const result = await commitReschedule(makeDeps(makeReservation()), 'r1', { roomId: 'room-2', pricingMode: 'reprice' }, hotelAdmin)
    expect(result.reservation.totalAmount).toBe(400)
    expect(result.quote.newTotal).toBe(400)
    expect(result.quote.repricedDifference).toBe(200)
    expect(result.quote.creditAmount).toBe(0)
  })

  it('con diferencia negativa baja el total, informa el saldo y NO devuelve plata', async () => {
    let chargeCalls = 0
    const deps = { ...makeDeps(makeReservation()), chargePort: async () => { chargeCalls++; return { method: 'cash' as const, applied: true, target: 'x' } } }
    const result = await commitReschedule(deps, 'r1', { checkOut: '2030-01-11', pricingMode: 'reprice', charge: { method: 'cash' } }, hotelAdmin)

    expect(result.reservation.totalAmount).toBe(80)
    expect(result.quote.chargeAmount).toBe(0)
    expect(result.quote.creditAmount).toBe(120) // 200 pactado - 80 repreciado
    expect(chargeCalls).toBe(0)                 // no se cobra…
    expect(result.charge).toBeNull()            // …ni se devuelve: lo decide el usuario aparte
  })

  it('el monto fijado a mano por el recepcionista sigue mandando sobre el modo', async () => {
    const result = await commitReschedule(makeDeps(makeReservation()), 'r1', { roomId: 'room-2', pricingMode: 'reprice', charge: { method: 'cash', amount: 50 } }, hotelAdmin)
    expect(result.quote.chargeAmount).toBe(50)
    expect(result.reservation.totalAmount).toBe(250) // 200 pactado + 50 cobrado, no los 400 de rack
  })

  // ── STR-2: el reprice cambia `totalAmount` → el saldo PERSISTIDO tiene que moverse con él ──
  // El commit llamaba al `updateReservation` crudo, así que `reservations.pendingAmount` (lo que
  // lee el listado y el planning) se quedaba con el saldo del precio viejo mientras el detalle,
  // que lo recalcula al vuelo, mostraba otro número.
  it('persiste el pendiente del total NUEVO, extras incluidos', async () => {
    const reserva = makeReservation({ deposit: 50, otherCharges: 0, pendingAmount: 150 })
    const writes: any[] = []
    const repo = {
      findById: async () => reserva,
      findMany: async () => [],
      update: async (id: string, data: any) => { writes.push(data); Object.assign(reserva, data); return { ...reserva, id } },
    }
    const deps: RescheduleDeps = {
      ...makeDeps(reserva),
      repo,
      addonsOf: async () => [{ amount: 30, quantity: 1, kind: 'service' }],
    }

    const result = await commitReschedule(deps, 'r1', { roomId: 'room-2', pricingMode: 'reprice' }, hotelAdmin)

    // 400 (repreciado) + 30 (extra) − 50 (pagado) = 380. Antes quedaba 150 en la columna.
    expect(result.reservation.totalAmount).toBe(400)
    expect(result.reservation.pendingAmount).toBe(380)
    expect(writes.at(-1)).toEqual({ pendingAmount: 380 })
  })
})

describe('reprice sin repos de temporadas — degradación EXPLÍCITA a rooms.basePrice', () => {
  it('cae a basePrice × noches y lo declara en repricedFromRates', async () => {
    const quote = await quoteReschedule(makeDeps(makeReservation(), false), 'r1', { roomId: 'room-2', pricingMode: 'reprice' }, hotelAdmin)
    expect(quote.repricedFromRates).toBe(false)
    expect(quote.repricedTotal).toBe(400) // 200 de basePrice × 2 noches
    expect(quote.repricedDifference).toBe(200)
    // Aun degradado, sigue viendo el cambio de habitación (que es el bug original).
    expect(quote.keepDifference).toBe(0)
  })

  it('si la lectura de tarifas explota, el reagendado no se cae: degrada al fallback', async () => {
    const rotos = {
      ...makeDeps(makeReservation()),
      roomRateRepo: { findMany: async () => { throw new Error('DB caída') } },
    }
    const quote = await quoteReschedule(rotos, 'r1', { roomId: 'room-2', pricingMode: 'reprice' }, hotelAdmin)
    expect(quote.repricedFromRates).toBe(false)
    expect(quote.repricedTotal).toBe(400)
  })
})
