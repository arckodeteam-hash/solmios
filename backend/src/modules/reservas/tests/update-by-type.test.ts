// reservas/tests/update-by-type.test.ts — revisión #260: PUT sobre una reserva vendida por TIPO.
//
// `updateReservation` revalidaba capacidad contra `roomRepo.findOne({id: effectiveRoomId})`; con
// `roomId: null` (alta por tipo) eso era null y `assertReservationFitsCapacity` un no-op: un PUT
// de sólo `adults` subía la ocupación por encima de cualquier unidad del tipo sin 409. Ahora la
// "habitación" efectiva es el perfil del tipo (mismo helper que `createReservation`).

import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { updateReservation } from '../usecases/crud'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopSockets = {} as any
const HOTEL = 'h1'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

/** Reserva vendida por tipo (sin unidad). `updates` registra lo que se persistió. `others`: el
 *  resto de reservas del hotel (para la disponibilidad por tipo); `findMany` filtra por roomType. */
function resRepo(existing: any, others: any[] = []) {
  const updates: any[] = []
  const rows = [existing, ...others]
  return {
    updates,
    findById: async (id: string) => (existing.id === id ? existing : null),
    findMany: async (q: any = {}) => rows.filter((r) =>
      (q.roomType == null || r.roomType === q.roomType) && (q.hotelId == null || r.hotelId === q.hotelId)),
    create: async (data: any) => ({ id: 'r-new', ...data }),
    update: async (id: string, data: any) => { updates.push(data); return { ...existing, ...data, id } },
  } as any
}

/** Unidades del hotel; `findMany({hotelId,type})` filtra como el ORM. */
function roomRepo(rooms: any[]) {
  return {
    findOne: async (f: { id: string }) => rooms.find((r) => r.id === f.id) ?? null,
    findById: async (id: string) => rooms.find((r) => r.id === id) ?? null,
    findMany: async (q: any = {}) => rooms.filter((r) =>
      (q.hotelId == null || r.hotelId === q.hotelId) && (q.type == null || r.type === q.type)),
  } as any
}

const configRepo = { findOne: async () => null } as any

/** Tipo "double" cuya capacidad MÁXIMA entre unidades vendibles es 2. */
const doubles = [
  { id: 'd-1', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, basePrice: 120, number: '101' },
  { id: 'd-2', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, basePrice: 100, number: '102' },
]

const byType = () => ({
  id: 'r1', hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed', guestId: 'g1',
  checkIn: '2026-07-20', checkOut: '2026-07-22', adults: 2, children: 0, totalAmount: 200,
})

const put = (repo: any, rooms: any, dto: any, hooks?: any) =>
  updateReservation(repo, noopLogger, noopCache, noopSockets, 'r1', dto, user, rooms, undefined, undefined, undefined, hooks, configRepo)

describe('updateReservation — reserva por TIPO (roomId null): la capacidad se valida contra el perfil del tipo', () => {
  it('PUT adults:5 sobre tipo de capacidad 2 → 409 (capacidad) y la fila queda igual', async () => {
    const repo = resRepo(byType())
    let err: any = null
    try { await put(repo, roomRepo(doubles), { adults: 5 } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)
    expect(err.message).toMatch(/admite hasta 2/)
    expect(repo.updates).toHaveLength(0)
  })

  it('PUT adults:2 → 200: se persiste', async () => {
    const repo = resRepo(byType())
    const item = await put(repo, roomRepo(doubles), { adults: 2 } as any)
    expect(item.adults).toBe(2)
    expect(item.roomId).toBeNull()
    expect(repo.updates).toHaveLength(1)
  })

  it('children también mueve ocupación: adults:2 + children:1 en tipo de 2 → 409', async () => {
    const repo = resRepo(byType())
    let err: any = null
    try { await put(repo, roomRepo(doubles), { children: 1, childrenAges: [5] } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(repo.updates).toHaveLength(0)
  })

  it('entra si entra en ALGUNA unidad vendible del tipo; una en mantenimiento no aporta capacidad', async () => {
    const withTriple = [...doubles, { id: 'd-3', hotelId: HOTEL, type: 'double', status: 'available', capacity: 3, basePrice: 90 }]
    const ok = await put(resRepo(byType()), roomRepo(withTriple), { adults: 3 } as any)
    expect(ok.adults).toBe(3)
    const maint = withTriple.map((r) => (r.id === 'd-3' ? { ...r, status: 'maintenance' } : r))
    let err: any = null
    try { await put(resRepo(byType()), roomRepo(maint), { adults: 3 } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toMatch(/admite hasta 2/)
  })

  it('capacidad sólo sobre unidades LIBRES en las fechas: la grande ocupada por otra reserva asignada → adults:5 → 409; libre → 200', async () => {
    const mixed = [...doubles, { id: 'd-6', hotelId: HOTEL, type: 'double', status: 'available', capacity: 6, basePrice: 90 }]
    const other = { id: 'r2', hotelId: HOTEL, roomId: 'd-6', roomType: 'double', status: 'confirmed', checkIn: '2026-07-20', checkOut: '2026-07-22' }
    let err: any = null
    const busy = resRepo(byType(), [other])
    try { await put(busy, roomRepo(mixed), { adults: 5 } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toMatch(/admite hasta 2/)
    expect(busy.updates).toHaveLength(0)
    // Bloqueada en una noche (RoomBlocks vía hooks.roomAssignment.blockRepo): ídem.
    const blockRepo = { findMany: async () => [{ id: 'b1', hotelId: HOTEL, roomId: 'd-6', startDate: '2026-07-21', endDate: '2026-07-21' }] } as any
    err = null
    try { await put(resRepo(byType()), roomRepo(mixed), { adults: 5 } as any, { roomAssignment: { blockRepo } }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    // La otra reserva no solapa → la grande está libre → se persiste.
    const ok = await put(resRepo(byType(), [{ ...other, checkIn: '2026-07-22', checkOut: '2026-07-24' }]), roomRepo(mixed), { adults: 5 } as any)
    expect(ok.adults).toBe(5)
    expect(ok.roomId).toBeNull()
  })

  it('la propia reserva no se cuenta: con 1 sola unidad del tipo, PUT adults:2 → 200', async () => {
    const one = [doubles[0]]
    const ok = await put(resRepo(byType()), roomRepo(one), { adults: 2 } as any)
    expect(ok.adults).toBe(2)
  })

  it('la composición entra sólo si ALGUNA unidad libre la admite: "adultos-solo" {6,6,0} + "familiar chica" {2,1,1} → PUT adults:5+children:1 → 409; adults:1+children:1 → 200', async () => {
    const mixedLimits = [
      { id: 'f-adultos', hotelId: HOTEL, type: 'familiar', status: 'available', capacity: 6, maxAdults: 6, maxChildren: 0, basePrice: 100 },
      { id: 'f-chica', hotelId: HOTEL, type: 'familiar', status: 'available', capacity: 2, maxAdults: 1, maxChildren: 1, basePrice: 80 },
    ]
    const fam = () => ({ ...byType(), roomType: 'familiar', adults: 1, children: 0 })
    const repo = resRepo(fam())
    let err: any = null
    try { await put(repo, roomRepo(mixedLimits), { adults: 5, children: 1, childrenAges: [8] } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)
    expect(err.message).toMatch(/Ninguna habitación de tipo "familiar"/)
    expect(repo.updates).toHaveLength(0)
    const ok = await put(resRepo(fam()), roomRepo(mixedLimits), { adults: 1, children: 1, childrenAges: [8] } as any)
    expect(ok.adults).toBe(1)
    expect(ok.children).toBe(1)
  })

  it('ninguna unidad del tipo libre toda la ventana (unidades distintas tomadas en noches distintas) → 409 type_sold_out available 0', async () => {
    const other = { id: 'r2', hotelId: HOTEL, roomId: 'd-1', roomType: 'double', status: 'confirmed', checkIn: '2026-07-20', checkOut: '2026-07-21' }
    const blockRepo = { findMany: async () => [{ id: 'b1', hotelId: HOTEL, roomId: 'd-2', startDate: '2026-07-21', endDate: '2026-07-21' }] } as any
    const repo = resRepo(byType(), [other])
    let err: any = null
    try { await put(repo, roomRepo(doubles), { adults: 1 } as any, { roomAssignment: { blockRepo } }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)
    expect(err.details?.reason).toBe('type_sold_out')
    expect(err.details?.available).toBe(0)
    expect(err.message).not.toContain('hasta 0')
    expect(repo.updates).toHaveLength(0)
  })
})

describe('updateReservation — reserva por TIPO (roomId null): cambiar SÓLO las fechas re-valida disponibilidad por tipo', () => {
  // Revisión #260 (3ª pasada): `touchesOccupancy` no miraba checkIn/checkOut y validate-update.ts
  // sólo re-chequea solape con `existing.roomId` → un PUT de sólo fechas sobre una reserva por
  // tipo pasaba sin mirar nada y dejaba dos confirmadas del tipo en la misma ventana con UNA unidad.
  const one = [{ id: 'd-1', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, basePrice: 120, number: '101' }]
  const r1 = () => ({ ...byType(), checkIn: '2026-07-01', checkOut: '2026-07-03' })
  const r2 = { id: 'r2', hotelId: HOTEL, roomId: 'd-1', roomType: 'double', status: 'confirmed', checkIn: '2026-08-01', checkOut: '2026-08-03' }

  it('mover r1 (sin unidad) a la ventana de r2 (asignada a la única unidad) → 409 type_sold_out, la fila queda igual', async () => {
    const repo = resRepo(r1(), [r2])
    let err: any = null
    try { await put(repo, roomRepo(one), { checkIn: '2026-08-01', checkOut: '2026-08-03' } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)
    expect(err.details?.reason).toBe('type_sold_out')
    expect(err.details?.available).toBe(0)
    expect(repo.updates).toHaveLength(0)
  })

  it('la otra reserva del tipo también SIN unidad consume inventario: mover r1 encima → 409 type_sold_out', async () => {
    const repo = resRepo(r1(), [{ ...r2, roomId: null }])
    let err: any = null
    try { await put(repo, roomRepo(one), { checkIn: '2026-08-01', checkOut: '2026-08-03' } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.details?.reason).toBe('type_sold_out')
    expect(repo.updates).toHaveLength(0)
  })

  it('mover a fechas libres → 200 (la propia reserva no se cuenta); sólo checkOut también re-valida', async () => {
    const ok = await put(resRepo(r1(), [r2]), roomRepo(one), { checkIn: '2026-07-10', checkOut: '2026-07-12' } as any)
    expect(ok.checkIn).toBe('2026-07-10')
    expect(ok.roomId).toBeNull()
    // Extender r1 hasta solapar con r2 (sólo checkOut): 409.
    const repo = resRepo({ ...r1(), checkIn: '2026-07-30', checkOut: '2026-08-01' }, [r2])
    let err: any = null
    try { await put(repo, roomRepo(one), { checkOut: '2026-08-02' } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.details?.reason).toBe('type_sold_out')
    expect(repo.updates).toHaveLength(0)
  })

  it('capacidad sobre las unidades libres en las NUEVAS fechas: la grande ocupada ahí → adults:5 no entra al mover; en la ventana original sí', async () => {
    const mixed = [...one, { id: 'd-6', hotelId: HOTEL, type: 'double', status: 'available', capacity: 6, basePrice: 90 }]
    const big = { ...r1(), adults: 5 }
    const other = { ...r2, roomId: 'd-6' }
    const repo = resRepo(big, [other])
    let err: any = null
    try { await put(repo, roomRepo(mixed), { checkIn: '2026-08-01', checkOut: '2026-08-03' } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toMatch(/admite hasta 2/)
    expect(repo.updates).toHaveLength(0)
    const ok = await put(resRepo(big, [other]), roomRepo(mixed), { checkIn: '2026-07-10', checkOut: '2026-07-12' } as any)
    expect(ok.checkIn).toBe('2026-07-10')
  })

  it('con unidad asignada el PUT de fechas sigue por validate-update.ts (solape por unidad), no por el tipo', async () => {
    const assigned = { ...r1(), roomId: 'd-1' }
    const repo = resRepo(assigned, [r2])
    let err: any = null
    try { await put(repo, roomRepo(one), { checkIn: '2026-08-01', checkOut: '2026-08-03' } as any) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.details?.reason).toBe('room_overlap')
  })
})
