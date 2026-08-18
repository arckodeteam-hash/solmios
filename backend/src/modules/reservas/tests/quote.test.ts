// reservas/tests/quote.test.ts
//
// El quote del panel (`usecases/quote.ts`) y el recálculo server-side del alta
// (`crud.ts`, `priceFrom:'rates'`) tienen que usar la MISMA cadena de precio que el motor
// público: season_assignments (fecha → temporada) → room_rates (roomType × occupancy ×
// season, BASE) → fallback rooms.basePrice.
//
// Casos:
//  (a) Sin temporadas asignadas → TODO a rooms.basePrice, fromRates=false (regresión: el
//      hotel sin temporadas cotiza exactamente igual que el wizard viejo).
//  (b) Noche con temporada + fila en la grilla → precio de la grilla, fromRates=true.
//  (c) Estadía que CRUZA dos temporadas → suma noche a noche; pricePerNight=null (no hay
//      un solo precio para mostrar "N × $X").
//  (d) Temporada asignada pero SIN fila para el tipo → esa noche cae a basePrice.
//  (e) Ocupación: sin fila exacta usa la MENOR que cubre al grupo.
//  (f) `closed`: la fila cerrada cotiza igual (no bloquea) pero se informa closedNights.
//  (g) Errores: fechas invertidas, habitación de otro hotel, habitación inexistente.
//  (h) Alta `priceFrom:'rates'` → totalAmount recalculado server-side (+taxes −promo).
//  (i) Alta sin priceFrom (OTA/móvil/connectors) → totalAmount tal cual llega (compat).
import { describe, it, expect } from 'bun:test'
import { quoteStay } from '../usecases/quote'
import { createReservation } from '../usecases/crud'

const HOTEL_ID = 'h1'
const OTHER_HOTEL = 'h2'
const ROOM_ID = 'room-1'
const ROOM_TYPE = 'standard'
const BASE_PRICE = 100

const room = { id: ROOM_ID, hotelId: HOTEL_ID, type: ROOM_TYPE, basePrice: BASE_PRICE, number: '101' }
const roomRepo = { findOne: async (f: any) => (f?.id === ROOM_ID ? room : null) } as any

const seasonAssignmentRepo = (rows: any[]) => ({
  findMany: async (f: any) => (f?.hotelId === HOTEL_ID ? rows : []),
}) as any

const roomRateRepo = (rows: any[]) => ({
  findMany: async (f: any) => (f?.hotelId === HOTEL_ID ? rows : []),
}) as any

const seasonsRepo = (rows: any[]) => ({ findMany: async () => rows }) as any

const rate = (season: string, price: number, occ = 2, extra: Partial<any> = {}) => ({
  id: `${season}-${occ}`, hotelId: HOTEL_ID, roomType: ROOM_TYPE, occupancy: occ, season,
  channel: '', price, basePrice: price, percentage: 0, closed: 0, ...extra,
})

const assignment = (date: string, season: string) => ({ id: `${date}`, hotelId: HOTEL_ID, date, season })

describe('quoteStay — cadena de precio por temporada', () => {
  it('(a) sin temporadas asignadas: todo a rooms.basePrice, fromRates=false', async () => {
    const q = await quoteStay(
      { roomRepo, seasonAssignmentRepo: seasonAssignmentRepo([]), roomRateRepo: roomRateRepo([]), seasonsRepo: seasonsRepo([]) },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-04', guests: 2 },
    )
    expect(q.subtotal).toBe(300) // 3 noches × 100
    expect(q.fromRates).toBe(false)
    expect(q.pricePerNight).toBe(100)
    expect(q.nights.every((n) => n.season === null && n.price === BASE_PRICE)).toBe(true)
  })

  it('(b) noche con temporada y fila en la grilla: precio de la grilla + label/color', async () => {
    const q = await quoteStay(
      {
        roomRepo,
        seasonAssignmentRepo: seasonAssignmentRepo([assignment('2026-09-01', 'alta'), assignment('2026-09-02', 'alta')]),
        roomRateRepo: roomRateRepo([rate('alta', 180)]),
        seasonsRepo: seasonsRepo([{ name: 'alta', label: 'Alta', color: '#ef4444' }]),
      },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-03', guests: 2 },
    )
    expect(q.subtotal).toBe(360) // 2 × 180
    expect(q.fromRates).toBe(true)
    expect(q.nights[0].seasonLabel).toBe('Alta')
    expect(q.nights[0].seasonColor).toBe('#ef4444')
  })

  it('(c) estadía que cruza dos temporadas: suma noche a noche y pricePerNight=null', async () => {
    const q = await quoteStay(
      {
        roomRepo,
        seasonAssignmentRepo: seasonAssignmentRepo([assignment('2026-09-01', 'media'), assignment('2026-09-02', 'alta')]),
        roomRateRepo: roomRateRepo([rate('media', 120), rate('alta', 200)]),
        seasonsRepo: seasonsRepo([]),
      },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-03', guests: 2 },
    )
    expect(q.subtotal).toBe(320) // 120 + 200, NO promedio ni basePrice × 2
    expect(q.pricePerNight).toBeNull()
    expect(q.nights.map((n) => n.price)).toEqual([120, 200])
  })

  it('(d) temporada asignada sin fila para el tipo: esa noche cae a basePrice', async () => {
    const q = await quoteStay(
      {
        roomRepo,
        seasonAssignmentRepo: seasonAssignmentRepo([assignment('2026-09-01', 'alta')]),
        roomRateRepo: roomRateRepo([]), // grilla vacía
        seasonsRepo: seasonsRepo([]),
      },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-02', guests: 2 },
    )
    expect(q.subtotal).toBe(BASE_PRICE)
    expect(q.nights[0].season).toBe('alta') // la noche SABE su temporada…
    expect(q.nights[0].fromRate).toBe(false) // …pero cotizó por fallback
  })

  it('(e) ocupación: sin fila exacta usa la menor que cubre al grupo', async () => {
    const q = await quoteStay(
      {
        roomRepo,
        seasonAssignmentRepo: seasonAssignmentRepo([assignment('2026-09-01', 'media')]),
        roomRateRepo: roomRateRepo([rate('media', 150, 2), rate('media', 210, 4)]),
        seasonsRepo: seasonsRepo([]),
      },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-02', guests: 3 },
    )
    expect(q.subtotal).toBe(210) // fila de 4 (la menor >= 3), no la de 2
  })

  it('(f) fila closed=1: cotiza igual pero informa closedNights', async () => {
    const q = await quoteStay(
      {
        roomRepo,
        seasonAssignmentRepo: seasonAssignmentRepo([assignment('2026-09-01', 'alta')]),
        roomRateRepo: roomRateRepo([rate('alta', 180, 2, { closed: 1 })]),
        seasonsRepo: seasonsRepo([]),
      },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-02', guests: 2 },
    )
    expect(q.subtotal).toBe(180)
    expect(q.closedNights).toBe(1)
  })

  it('(g) checkIn >= checkOut → ConflictError', async () => {
    await expect(quoteStay(
      { roomRepo, seasonAssignmentRepo: seasonAssignmentRepo([]), roomRateRepo: roomRateRepo([]) },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-03', checkOut: '2026-09-01', guests: 2 },
    )).rejects.toThrow('checkIn debe ser anterior a checkOut')
  })

  it('(g) habitación de otro hotel → ConflictError (IDOR cross-tenant)', async () => {
    await expect(quoteStay(
      { roomRepo, seasonAssignmentRepo: seasonAssignmentRepo([]), roomRateRepo: roomRateRepo([]) },
      { hotelId: OTHER_HOTEL, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-02', guests: 2 },
    )).rejects.toThrow('no pertenece a este hotel')
  })

  it('(g) habitación inexistente → NotFoundError', async () => {
    await expect(quoteStay(
      { roomRepo, seasonAssignmentRepo: seasonAssignmentRepo([]), roomRateRepo: roomRateRepo([]) },
      { hotelId: HOTEL_ID, roomId: 'no-existe', checkIn: '2026-09-01', checkOut: '2026-09-02', guests: 2 },
    )).rejects.toThrow('Habitación no encontrada')
  })

  it('degradación: sin repos de tarifas → todo basePrice sin reventar', async () => {
    const q = await quoteStay(
      { roomRepo },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-03', guests: 2 },
    )
    expect(q.subtotal).toBe(200)
    expect(q.fromRates).toBe(false)
  })
})

// ── Recálculo server-side del alta (crud.ts) ────────────────────────────────────────────────

const created: any[] = []
const reservasRepo = {
  findMany: async () => [],
  findOne: async () => null,
  create: async (dto: any) => { created.push(dto); return dto },
} as any
const logger = { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }), info: () => {}, warn: () => {}, error: () => {} } as any
const cache = { get: async () => null, set: async () => {}, delete: async () => {} } as any

const dto = (extra: Partial<any> = {}) => ({
  hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2026-09-01', checkOut: '2026-09-03',
  totalAmount: 999, adults: 2, ...extra,
})

describe('createReservation — priceFrom rates vs manual', () => {
  it('(h) priceFrom=rates: totalAmount sale de la grilla (server-side) + taxes − promo', async () => {
    created.length = 0
    const pricing = {
      seasonAssignmentRepo: seasonAssignmentRepo([assignment('2026-09-01', 'alta'), assignment('2026-09-02', 'alta')]),
      roomRateRepo: roomRateRepo([rate('alta', 180)]),
    }
    await createReservation(reservasRepo, undefined, logger, cache, {}, () => ({}), dto({ priceFrom: 'rates', taxesAmount: 36, promoDiscountAmount: 20 }), { id: 'u1', role: 'hotel_admin', hotelId: HOTEL_ID }, roomRepo, undefined, undefined, undefined, pricing)
    // 2 noches × 180 = 360; +36 impuestos; −20 promo → 376 (NO el 999 que mandó el cliente).
    expect(created[0].totalAmount).toBe(376)
  })

  it('(i) sin priceFrom: totalAmount tal cual (compat OTA/móvil/connectors)', async () => {
    created.length = 0
    await createReservation(reservasRepo, undefined, logger, cache, {}, () => ({}), dto({ totalAmount: 555 }), { id: 'u1', role: 'hotel_admin', hotelId: HOTEL_ID }, roomRepo)
    expect(created[0].totalAmount).toBe(555)
  })
})
