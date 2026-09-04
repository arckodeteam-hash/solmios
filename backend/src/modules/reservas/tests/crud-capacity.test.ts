// reservas/tests/crud-capacity.test.ts — Auditoría de integridad (cierre, 2026-09-04).
//
// Decisión de producto: las reservas creadas o editadas desde Administración (`POST`/`PUT
// /api/reservas`) NO pueden exceder silenciosamente la capacidad de la habitación. Mismo criterio
// (`fitsRoomCapacity`/`room_type_capacity`) que ya usan el motor público y `reschedule.ts` — sin
// override/overbooking manual (fuera de alcance a propósito, ver `shared/usecases/
// reservation-capacity.ts`).
//
// Reservas de panel pueden traer `children` (conteo) SIN `childrenAges` — la excepción de
// `child_policy` del formulario administrativo SIGUE vigente (no se migra `ReservationWizardModal.vue`
// en esta tarea). Sin edades, `resolveAdminCapacityComposition` asume CONSERVADOR: cada niño
// declarado consume plaza (nunca se asume libre).

import { describe, it, expect } from 'bun:test'
import { createReservation, updateReservation } from '../usecases/crud'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopSockets = {} as any
const HOTEL = 'h1'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

function resRepo(existing?: any) {
  return {
    findById: async (id: string) => (existing && existing.id === id ? existing : null),
    findMany: async () => [],
    create: async (data: any) => ({ id: 'r-new', ...data }),
    update: async (id: string, data: any) => ({ ...existing, ...data, id }),
  } as any
}

function roomRepo(rooms: Record<string, any>) {
  return { findOne: async (f: { id: string }) => rooms[f.id] ?? null } as any
}

/** `Configuration` — `child_policy` y/o `room_type_capacity`, según lo que pase el test. */
function configRepo(rows: { childPolicy?: any; roomTypeCapacity?: Record<string, any> } = {}) {
  return {
    findOne: async (f: { hotelId: string; key: string }) => {
      if (f.key === 'child_policy' && rows.childPolicy) return { hotelId: HOTEL, key: 'child_policy', value: rows.childPolicy }
      if (f.key === 'room_type_capacity' && rows.roomTypeCapacity) return { hotelId: HOTEL, key: 'room_type_capacity', value: rows.roomTypeCapacity }
      return null
    },
  } as any
}

const baseDto = (over: Record<string, any> = {}) => ({
  hotelId: HOTEL, roomId: 'room-1', guestId: 'g1', checkIn: '2026-07-20', checkOut: '2026-07-22',
  status: 'confirmed', totalAmount: 200, adults: 2, children: 0, ...over,
}) as any

describe('createReservation — capacidad (auditoría de integridad, cierre)', () => {
  it('rechaza adultos que exceden la capacidad total de la habitación', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2 } }
    const call = createReservation(resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ adults: 4 }), user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    await expect(call).rejects.toThrow(/admite hasta 2/)
  })

  it('acepta dentro de la capacidad', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2 } }
    const item = await createReservation(resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ adults: 2 }), user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    expect(item.id).toBe('r-new')
  })

  // El caso central del pedido: `children` SIN `childrenAges` (formulario admin no migrado) — no
  // se puede saber si están libres, así que se asume CONSERVADOR (consumen plaza), nunca libre.
  it('reserva legacy de panel (children sin childrenAges): cada niño declarado consume plaza — rechaza si excede', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2 } }
    const call = createReservation(resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ adults: 2, children: 2 }), user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    await expect(call).rejects.toThrow(/admite hasta 2/)
  })

  it('reserva legacy de panel: 1 adulto + 1 niño (conservador) SÍ entra en capacidad 2', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2 } }
    const item = await createReservation(resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ adults: 1, children: 1 }), user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    expect(item.id).toBe('r-new')
  })

  // Con `childrenAges` SÍ declaradas (el panel puede recibirlas — Requerimiento 11), se usa la
  // composición REAL, no el conservador: un niño libre no bloquea aunque el conteo crudo sí lo haría.
  it('con childrenAges declaradas: usa la composición REAL (niño libre no cuenta), no el conservador', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2 } }
    const policy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 5 }
    const item = await createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {},
      baseDto({ adults: 2, children: 1, childrenAges: [3] }), user, roomRepo(rooms), undefined, undefined, undefined, undefined,
      configRepo({ childPolicy: policy }),
    )
    expect(item.id).toBe('r-new') // niño de 3 (libre, ≤5) no suma → chargeable=2, entra en capacity=2
  })

  it('rechaza por maxAdults del tipo aunque la capacidad total alcance', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 4, maxAdults: 1 } }
    const call = createReservation(resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ adults: 2 }), user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    await expect(call).rejects.toThrow(/admite hasta 4/)
  })

  it('rechaza por maxChildren del tipo (con childrenAges reales, niño con plaza)', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 4, maxChildren: 0 } }
    const policy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0 }
    const call = createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {},
      baseDto({ adults: 1, children: 1, childrenAges: [5] }), user, roomRepo(rooms), undefined, undefined, undefined, undefined,
      configRepo({ childPolicy: policy }),
    )
    await expect(call).rejects.toThrow(/admite hasta 4/)
  })

  it('respeta la capacidad configurada POR TIPO (room_type_capacity), no la física de la habitación', async () => {
    // La habitación física dice capacity=6 (sobra), pero el TIPO "double" está configurado a 2.
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 6 } }
    const call = createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {},
      baseDto({ adults: 4 }), user, roomRepo(rooms), undefined, undefined, undefined, undefined,
      configRepo({ roomTypeCapacity: { double: { capacity: 2, maxAdults: 2, maxChildren: 0 } } }),
    )
    await expect(call).rejects.toThrow(/admite hasta 2/)
  })

  it('sin roomRepo cableado: no valida capacidad (retrocompatible, no revienta)', async () => {
    const item = await createReservation(resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ adults: 20 }), user)
    expect(item.id).toBe('r-new')
  })
})

describe('updateReservation — capacidad: NO debe existir una segunda puerta (cierre PUT /api/reservas/:id)', () => {
  function existingReservation(over: Record<string, any> = {}) {
    return { id: 'r1', hotelId: HOTEL, roomId: 'room-1', checkIn: '2026-07-20', checkOut: '2026-07-22', totalAmount: 200, adults: 2, children: 0, status: 'confirmed', ...over }
  }

  it('mover a una habitación más chica vía PUT plano: rechaza — mismo criterio que reschedule.ts', async () => {
    const existing = existingReservation()
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 4 }, 'room-2': { id: 'room-2', hotelId: HOTEL, type: 'standard', capacity: 1 } }
    const call = updateReservation(resRepo(existing), noopLogger, noopCache, noopSockets, 'r1', { roomId: 'room-2' } as any, user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    await expect(call).rejects.toThrow(/admite hasta 1/)
  })

  it('subir adultos por encima de la capacidad ACTUAL (sin cambiar de habitación): rechaza', async () => {
    const existing = existingReservation({ adults: 2 })
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2 } }
    const call = updateReservation(resRepo(existing), noopLogger, noopCache, noopSockets, 'r1', { adults: 4 } as any, user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    await expect(call).rejects.toThrow(/admite hasta 2/)
  })

  it('editar un campo que NO toca ocupación (notes): no revalida, no requiere roomRepo/configRepo', async () => {
    const existing = existingReservation()
    const item = await updateReservation(resRepo(existing), noopLogger, noopCache, noopSockets, 'r1', { notes: 'Llega tarde' } as any, user)
    expect(item.notes).toBe('Llega tarde')
  })

  it('mover a una habitación que SÍ entra: acepta', async () => {
    const existing = existingReservation({ adults: 2 })
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2 }, 'room-2': { id: 'room-2', hotelId: HOTEL, type: 'suite', capacity: 4 } }
    const item = await updateReservation(resRepo(existing), noopLogger, noopCache, noopSockets, 'r1', { roomId: 'room-2' } as any, user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    expect(item.roomId).toBe('room-2')
  })
})

describe('updateReservation — childrenAgesAsOf se resincroniza al editar childrenAges (auditoría de integridad)', () => {
  function existingWithAges(over: Record<string, any> = {}) {
    return { id: 'r1', hotelId: HOTEL, roomId: 'room-1', checkIn: '2026-07-20', checkOut: '2026-07-22', totalAmount: 200, adults: 2, children: 1, childrenAges: [5], childrenAgesAsOf: '2026-01-10', status: 'confirmed', ...over }
  }
  const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 6 } }

  it('editar childrenAges: childrenAgesAsOf se actualiza al checkIn EFECTIVO (el actual, si no cambia)', async () => {
    const existing = existingWithAges()
    const item: any = await updateReservation(resRepo(existing), noopLogger, noopCache, noopSockets, 'r1', { childrenAges: [7] } as any, user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    expect(item.childrenAges).toEqual([7])
    expect(item.childrenAgesAsOf).toBe('2026-07-20') // el checkIn ACTUAL de la reserva, no el 2026-01-10 viejo
  })

  it('editar childrenAges Y checkIn a la vez: usa el checkIn NUEVO como referencia, no el viejo', async () => {
    const existing = existingWithAges()
    const item: any = await updateReservation(
      resRepo(existing), noopLogger, noopCache, noopSockets, 'r1',
      { childrenAges: [7], checkIn: '2027-03-01', checkOut: '2027-03-03' } as any, user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo(),
    )
    expect(item.childrenAgesAsOf).toBe('2027-03-01')
  })

  it('vaciar childrenAges (sin niños): limpia childrenAgesAsOf, no deja una fecha ancla sin edades', async () => {
    const existing = existingWithAges()
    const item: any = await updateReservation(resRepo(existing), noopLogger, noopCache, noopSockets, 'r1', { childrenAges: [] } as any, user, roomRepo(rooms), undefined, undefined, undefined, undefined, configRepo())
    expect(item.childrenAges).toEqual([])
    expect(item.childrenAgesAsOf).toBeNull()
  })

  it('NO tocar childrenAges: childrenAgesAsOf queda intacto (update parcial, sin reescribir por omisión)', async () => {
    const existing = existingWithAges()
    const item: any = await updateReservation(resRepo(existing), noopLogger, noopCache, noopSockets, 'r1', { notes: 'x' } as any, user)
    expect(item.childrenAgesAsOf).toBe('2026-01-10')
  })
})
