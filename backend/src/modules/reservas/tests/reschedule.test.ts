// reservas/tests/reschedule.test.ts — IDOR #668 en el flujo de reagendado (planning).
//
// buildQuote() (usado por quoteReschedule y commitReschedule) lee `input.roomId` directo del
// body sin validar hotel — mismo patrón de IDOR que ya se había fixeado en `create` (crud.ts)
// pero que faltaba acá y en `validate-update.ts`. Sin el guard, un hotel_admin podía:
//   1) via quoteReschedule (GET dry-run): ver basePrice/disponibilidad de una room de OTRO hotel.
//   2) via commitReschedule: mover su reserva a esa room ajena (además de la fuga de datos).
// Regresión: cualquier refactor de buildQuote que borre el check de `room.hotelId !== existing.hotelId`
// reintroduce el IDOR en silencio.

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
const OTRO_HOTEL = 'hotel-b'

const hotelAdmin = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

function makeReservation(over: Record<string, any> = {}) {
  return {
    id: 'r1', hotelId: HOTEL, roomId: 'room-1', checkIn: '2030-01-10', checkOut: '2030-01-12',
    totalAmount: 200, currency: 'USD', status: 'confirmed', ...over,
  }
}

function makeRepo(reserva: any, overrides: Record<string, any> = {}) {
  return {
    findById: async () => reserva,
    findMany: async () => [],
    update: async (id: string, data: any) => ({ ...reserva, ...data, id }),
    ...overrides,
  }
}

// buildQuote() (reschedule.ts) lee por findById; assertUpdateValidations (validate-update.ts,
// vía commitReschedule → updateReservation) lee la MISMA room por findOne({id}) — igual que
// createReservation. El mock necesita ambos métodos.
function makeRoomRepo(rooms: Record<string, any>) {
  return {
    findById: async (id: string) => rooms[id] ?? null,
    findOne: async (query: { id: string }) => rooms[query.id] ?? null,
  }
}

function makeDeps(reserva: any, rooms: Record<string, any>, repoOverrides: Record<string, any> = {}): RescheduleDeps {
  return {
    repo: makeRepo(reserva, repoOverrides),
    roomRepo: makeRoomRepo(rooms),
    logger: noopLogger,
    cache: silentCache,
    paidOf,
    sockets: {},
    // STR-2: el commit reprecia y el saldo persistido tiene que moverse con el total nuevo.
    addonsOf: async () => [],
  }
}

describe('quoteReschedule — IDOR #668 (dry-run, no debe escribir ni filtrar la room ajena)', () => {
  it('rechaza cotizar el cambio a una habitación de otro hotel', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: OTRO_HOTEL, basePrice: 999 } })
    const call = quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    await expect(call).rejects.toThrow('La habitación no pertenece a este hotel')
  })

  it('el error de la room ajena no filtra su basePrice ni sus datos', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: OTRO_HOTEL, basePrice: 999 } })
    try {
      await quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
      throw new Error('no debería llegar acá — se esperaba ConflictError')
    } catch (e: any) {
      expect(e.message).not.toContain('999')
      expect(JSON.stringify(e)).not.toContain('999')
    }
  })

  it('acepta cotizar el cambio a otra habitación del MISMO hotel (control)', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } })
    const quote = await quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(quote.roomId).toBe('room-2')
    expect(quote.basePrice).toBe(120)
    expect(quote.available).toBe(true)
  })
})

describe('commitReschedule — IDOR #668 (aplica el cambio real)', () => {
  it('rechaza mover la reserva a una habitación de otro hotel, sin mutar la reserva', async () => {
    const reserva = makeReservation()
    let updateCalled = false
    const deps = makeDeps(
      reserva,
      { 'room-2': { id: 'room-2', hotelId: OTRO_HOTEL, basePrice: 999 } },
      { update: async (id: string, data: any) => { updateCalled = true; return { ...reserva, ...data, id } } },
    )
    const call = commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    await expect(call).rejects.toThrow('La habitación no pertenece a este hotel')
    expect(updateCalled).toBe(false)
  })

  it('acepta reagendar (commit) a otra habitación del MISMO hotel (control)', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } })
    const result = await commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(result.reservation.roomId).toBe('room-2')
    expect(result.quote.roomId).toBe('room-2')
  })

  // Requerimiento 11 (Persistencia de la composición, 2026-09-03) — reagendar SOLO escribe
  // `{roomId, checkIn, checkOut, totalAmount}` (ver `buildQuote`/`commitReschedule`): nunca toca
  // `adults`/`children`/`childrenAges`, así que un UPDATE parcial no puede corromperlos ni
  // borrarlos por omisión. Regresión a cuidar: si `commitReschedule` alguna vez empieza a mandar
  // esos campos en el dto sin incluir explícitamente `childrenAges`, este test lo detecta.
  it('reagendar (mover de habitación) NO toca adults/children/childrenAges de la reserva', async () => {
    const reserva = makeReservation({ adults: 2, children: 1, childrenAges: [8] })
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } })
    const result = await commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(result.reservation.adults).toBe(2)
    expect(result.reservation.children).toBe(1)
    expect(result.reservation.childrenAges).toEqual([8])
  })

  it('SEC3-2: el commit dispara ceilingGuard al escribir totalAmount (un reprice que BAJA deja links vivos si no)', async () => {
    // El commit escribe `totalAmount:newTotal` vía updateReservation → crud dispara `afterCeilingDrop`
    // (crud.ts:286). Si el hook no se cablea, el callback es undefined y una reprogramación que
    // abarata deja Checkout Sessions abiertas por el saldo VIEJO.
    const reserva = makeReservation()
    const clamped: Array<{ hotelId: string; reservationId: string }> = []
    const deps: RescheduleDeps = {
      ...makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } }),
      ceilingGuard: async (hotelId, reservationId) => { clamped.push({ hotelId, reservationId }) },
    }
    // reprice a una room más barata y menos noches: baja el total → creditAmount > 0.
    await commitReschedule(deps, 'r1', { roomId: 'room-2', checkIn: '2030-01-10', checkOut: '2030-01-11', pricingMode: 'reprice' }, hotelAdmin)
    expect(clamped).toEqual([{ hotelId: HOTEL, reservationId: 'r1' }])
  })
})

// ── Estado de la reserva: qué se puede reprogramar y qué ya ocurrió ────────────────────────
//
// No había NINGUNA comprobación de estado: se le podía correr la fecha de ENTRADA a un huésped
// que ya había hecho check-in, o reprogramar una estadía ya cerrada, y el sistema lo aceptaba.
// La entrada de alguien que ya llegó es un hecho ocurrido, no un campo editable. Reportado
// desde el planning: al arrastrar esas reservas se corrían solas y "se alargaban" en pantalla.

describe('reschedule — respeta el estado de la reserva', () => {
  const ROOMS = { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100 }, 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 100 } }

  it('con el huésped ADENTRO no se le corre la fecha de entrada', async () => {
    const reserva = makeReservation({ status: 'checked_in' })
    const deps = makeDeps(reserva, ROOMS)
    const call = quoteReschedule(deps, 'r1', { checkIn: '2030-01-11', checkOut: '2030-01-13' }, hotelAdmin)
    await expect(call).rejects.toThrow('ya hizo check-in')
  })

  it('pero SÍ se lo puede trasladar de habitación', async () => {
    const reserva = makeReservation({ status: 'checked_in' })
    const deps = makeDeps(reserva, ROOMS)
    const quote = await quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(quote.roomId).toBe('room-2')
    expect(quote.checkIn).toBe('2030-01-10')
  })

  it('y SÍ se le puede extender la salida', async () => {
    const reserva = makeReservation({ status: 'checked_in' })
    const deps = makeDeps(reserva, ROOMS)
    const quote = await quoteReschedule(deps, 'r1', { checkOut: '2030-01-15' }, hotelAdmin)
    expect(quote.checkOut).toBe('2030-01-15')
    expect(quote.newNights).toBe(5)
  })

  it('una estadía ya cerrada no se reprograma de ninguna forma', async () => {
    const reserva = makeReservation({ status: 'checked_out' })
    const deps = makeDeps(reserva, ROOMS)
    await expect(quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)).rejects.toThrow('ya está cerrada')
    await expect(quoteReschedule(deps, 'r1', { checkOut: '2030-01-15' }, hotelAdmin)).rejects.toThrow('ya está cerrada')
  })

  it('una reserva que todavía no llegó se mueve entera, como siempre', async () => {
    const reserva = makeReservation({ status: 'confirmed' })
    const deps = makeDeps(reserva, ROOMS)
    const quote = await quoteReschedule(deps, 'r1', { checkIn: '2030-01-20', checkOut: '2030-01-22' }, hotelAdmin)
    expect(quote.checkIn).toBe('2030-01-20')
  })

  // El commit pasa por el MISMO buildQuote: si alguien saltea el dry-run, igual rebota.
  it('el commit tampoco deja correr la entrada de un huésped alojado', async () => {
    const reserva = makeReservation({ status: 'checked_in' })
    const deps = makeDeps(reserva, ROOMS)
    const call = commitReschedule(deps, 'r1', { checkIn: '2030-01-11', checkOut: '2030-01-13', pricingMode: 'keep' } as any, hotelAdmin)
    await expect(call).rejects.toThrow('ya hizo check-in')
  })
})

// ─── Requerimiento 12 (Edad de referencia, 2026-09-03) — FIX encontrado en la auditoría ─────
// `assertRoomAvailable` solo valida solape de FECHAS: antes de este fix, reagendar una reserva a
// una habitación donde la composición NO entra se aceptaba igual mientras no hubiera otra
// reserva esas fechas — "deja de caber por el cambio de habitación" nunca se rechazaba.
describe('reschedule — Requerimiento 12: revalida capacidad de la habitación DESTINO', () => {
  it('mover a una habitación más chica que la composición: rechaza (quote Y commit), no escribe nada', async () => {
    const reserva = makeReservation({ adults: 4 })
    const deps = makeDeps(reserva, {
      'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 4 },
      'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120, capacity: 2 },
    })
    await expect(quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin))
      .rejects.toThrow('admite hasta 2 huésped')
    await expect(commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin))
      .rejects.toThrow('admite hasta 2 huésped')
  })

  it('mover a una habitación que SÍ entra: acepta normalmente (control)', async () => {
    const reserva = makeReservation({ adults: 2 })
    const deps = makeDeps(reserva, {
      'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 2 },
      'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120, capacity: 4 },
    })
    const result = await commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(result.reservation.roomId).toBe('room-2')
  })

  it('extender fechas en la MISMA habitación: si ya no entra, también se rechaza (no solo al cambiar de cuarto)', async () => {
    const reserva = makeReservation({ adults: 3 })
    const deps = makeDeps(reserva, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 2 } })
    // La reserva YA tenía 3 adultos en una room de capacity=2 (dato inconsistente heredado, o la
    // capacidad se ajustó después de crearla) — reagendar la reexpone al chequeo, no la deja pasar.
    await expect(commitReschedule(deps, 'r1', { checkOut: '2030-01-13' }, hotelAdmin))
      .rejects.toThrow('admite hasta 2 huésped')
  })

  it('composición con niños: la capacidad se revalida contra la MISMA composición persistida (sin niños libres de más)', async () => {
    const reserva = makeReservation({ adults: 2, children: 1, childrenAges: [8] }) // niño con plaza → ocupación 3
    const deps: RescheduleDeps = {
      ...makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120, capacity: 2 } }),
      configRepo: { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } } : null) },
    }
    await expect(commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin))
      .rejects.toThrow('admite hasta 2 huésped')
  })

  it('sin `capacity` en la fila (dato viejo/incompleto): no bloquea — mismo criterio que el resto del sistema', async () => {
    const reserva = makeReservation({ adults: 6 })
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } }) // sin capacity
    const result = await commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(result.reservation.roomId).toBe('room-2')
  })
})

// ─── Requerimiento 12 (Edad de referencia, 2026-09-03) — proyección al reagendar ───────────────
// Con `childrenAgesAsOf` persistido, reagendar a un check-in que cruza un año completo desde la
// declaración proyecta las edades y puede reclasificar (libre→con plaza, o niño→adulto por edad),
// lo que a su vez puede: (a) rechazar el reagendado si ya no entra en la habitación destino,
// (b) escribir `adults`/`children` recalculados si sí entra.
describe('reschedule — Requerimiento 12: proyección de edades al check-in nuevo', () => {
  const childPolicyDeps = { configRepo: { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } } : null) } }

  it('reagendar dentro del mismo año: NO reclasifica, adults/children quedan igual', async () => {
    const reserva = makeReservation({ adults: 2, children: 1, childrenAges: [3], childrenAgesAsOf: '2030-01-10' })
    const deps: RescheduleDeps = { ...makeDeps(reserva, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 4 } }), ...childPolicyDeps }
    const result = await commitReschedule(deps, 'r1', { checkIn: '2030-11-10', checkOut: '2030-11-12' }, hotelAdmin)
    expect(result.reservation.adults).toBe(2)
    expect(result.reservation.children).toBe(1)
  })

  it('niño libre (3) reagendado 1+ año después cruza a "con plaza": se persiste el nuevo children si entra', async () => {
    const reserva = makeReservation({ adults: 2, children: 1, childrenAges: [3], childrenAgesAsOf: '2030-01-10' })
    const deps: RescheduleDeps = { ...makeDeps(reserva, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 4 } }), ...childPolicyDeps }
    const result = await commitReschedule(deps, 'r1', { checkIn: '2031-06-01', checkOut: '2031-06-03' }, hotelAdmin)
    // El niño de 3 (libre) proyecta a 4 (con plaza): sigue siendo "children" (no cruza maxChildAge=12),
    // pero ahora consume plaza — chargeableOccupancy sube de 2 a 3. adults no cambia.
    expect(result.reservation.adults).toBe(2)
    expect(result.reservation.children).toBe(1)
    expect(result.quote.projectedChildren).toBe(1)
  })

  it('niño (12, límite) reagendado varios años después cruza a adulto: rechaza si la habitación ya no entra', async () => {
    const reserva = makeReservation({ adults: 2, children: 1, childrenAges: [12], childrenAgesAsOf: '2030-01-10' })
    const deps: RescheduleDeps = { ...makeDeps(reserva, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 3 } }), ...childPolicyDeps }
    // +4 años → 16, supera maxChildAge=12 → se trata como adulto → chargeableOccupancy sigue en 3,
    // pero ahora es 3 ADULTOS: si la room tuviera maxAdults:2 ya no entraría. Probamos ese caso.
    const deps2: RescheduleDeps = {
      ...deps,
      roomRepo: { findById: async (id: string) => (id === 'room-1' ? { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 3, maxAdults: 2 } : null), findOne: async (q: any) => (q.id === 'room-1' ? { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 3, maxAdults: 2 } : null) },
    }
    await expect(commitReschedule(deps2, 'r1', { checkIn: '2034-01-10', checkOut: '2034-01-12' }, hotelAdmin))
      .rejects.toThrow('admite hasta')
  })

  it('niño (12, límite) reagendado varios años después cruza a adulto: si SÍ entra, persiste adults/children recalculados', async () => {
    const reserva = makeReservation({ adults: 2, children: 1, childrenAges: [12], childrenAgesAsOf: '2030-01-10' })
    const deps: RescheduleDeps = { ...makeDeps(reserva, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 4 } }), ...childPolicyDeps }
    const result = await commitReschedule(deps, 'r1', { checkIn: '2034-01-10', checkOut: '2034-01-12' }, hotelAdmin)
    expect(result.reservation.adults).toBe(3) // el niño ahora cuenta como adulto
    expect(result.reservation.children).toBe(0)
    // childrenAges (la edad declarada tal cual) NUNCA se toca — sigue siendo la auditoría original.
    expect(result.reservation.childrenAges).toEqual([12])
  })

  it('reserva legacy sin childrenAgesAsOf: reagendar NO proyecta, cae al comportamiento previo (sin cambios)', async () => {
    const reserva = makeReservation({ adults: 2, children: 1, childrenAges: [12] }) // sin childrenAgesAsOf
    const deps: RescheduleDeps = { ...makeDeps(reserva, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 4 } }), ...childPolicyDeps }
    const result = await commitReschedule(deps, 'r1', { checkIn: '2034-01-10', checkOut: '2034-01-12' }, hotelAdmin)
    expect(result.reservation.adults).toBe(2)
    expect(result.reservation.children).toBe(1)
  })

  it('multi-habitación: cada reserva se proyecta independientemente con SU propio childrenAgesAsOf', async () => {
    // Simula 2 reservas de un mismo grupo, cada una reagendada por separado (el reagendado del
    // planning es por reserva individual, no por grupo) con distinta fecha de declaración.
    const r1 = makeReservation({ id: 'r1', adults: 2, children: 1, childrenAges: [12], childrenAgesAsOf: '2030-01-10' })
    const r2 = makeReservation({ id: 'r2', adults: 2, children: 1, childrenAges: [12], childrenAgesAsOf: '2033-06-01' }) // declarado más tarde

    const deps1: RescheduleDeps = { ...makeDeps(r1, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 4 } }), ...childPolicyDeps }
    const result1 = await commitReschedule(deps1, 'r1', { checkIn: '2034-01-10', checkOut: '2034-01-12' }, hotelAdmin)
    expect(result1.reservation.adults).toBe(3) // +4 años desde 2030 → cruza a adulto

    const deps2: RescheduleDeps = { ...makeDeps(r2, { 'room-1': { id: 'room-1', hotelId: HOTEL, basePrice: 100, capacity: 4 } }), ...childPolicyDeps }
    const result2 = await commitReschedule(deps2, 'r2', { checkIn: '2034-01-10', checkOut: '2034-01-12' }, hotelAdmin)
    expect(result2.reservation.adults).toBe(2) // menos de 1 año desde 2033-06-01 → no cruza
    expect(result2.reservation.children).toBe(1)
  })
})
