// reservas/tests/in-house.test.ts — #209 (REST-07): buscador "quién está alojado" para el POS.
//   - Reservas `checked_in` del hotel + `confirmed` VIGENTES (llegada ≤ hoy ≤ salida, sin check-in: REG-1).
//     Las confirmadas futuras, las checked_out y las de otro hotel nunca aparecen, ni por id.
//   - Coincide por prefijo del número de habitación o por substring del nombre (sin acentos/mayúsculas).
//   - Sin término → todos, ordenados por habitación. Sin match → lista vacía. `total` real aunque se recorte.
//   - `id` → esa reserva del hotel en cualquier estado (lookup de Cobrar); de otro hotel → vacío.
//   - El hotel sale del token o de la BD; nadie (ni super_admin) puede pedir otro hotel por query.
//   - Un huésped de OTRO hotel en una reserva del hotel (dato inconsistente) → nombre vacío, no se filtra.
//   - "Hoy" es el del hotel (`hotels.timezone`): a las 20:00 de Santo Domingo (00:00 UTC del día
//     siguiente) la que llega hoy sigue siendo de hoy. Las `confirmed` se piden por llegada hoy/ayer,
//     nunca la tabla entera de confirmadas.
import { describe, it, expect } from 'bun:test'
import { AuthError, ValidationError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { searchInHouse, matchesInHouse, normalizeQuery, isCurrentConfirmed, confirmedArrivalDates, IN_HOUSE_LIMIT, CONFIRMED_LOOKBACK_DAYS, type InHouseDeps } from '../usecases/in-house'

function backed<T extends object>(store: any[]): RepositoryAdapter<T> {
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
  } as unknown as RepositoryAdapter<T>
}

const TODAY = '2026-09-11'
// 20:00 del 11/09 en Santo Domingo (UTC-4) = 00:00 UTC del 12/09. En UTC ya sería "mañana".
const NOW_LOCAL_NIGHT = new Date('2026-09-12T00:00:00.000Z')
const hotels = [{ id: 'h1', timezone: 'America/Santo_Domingo' }, { id: 'h2', timezone: 'America/Santo_Domingo' }]
const reservations = [
  { id: 'r-204', hotelId: 'h1', roomId: 'room-204', guestId: 'g-perez', status: 'checked_in', checkIn: '2026-09-10', checkOut: '2026-09-12', pendingAmount: 150 },
  { id: 'r-201', hotelId: 'h1', roomId: 'room-201', guestId: 'g-garcia', status: 'checked_in', checkIn: '2026-09-11', checkOut: '2026-09-14', pendingAmount: 0 },
  // confirmada que llega HOY y todavía no hizo check-in → aparece marcada `confirmed` (REG-1)
  { id: 'r-today', hotelId: 'h1', roomId: 'room-203', guestId: 'g-lopez', status: 'confirmed', checkIn: TODAY, checkOut: '2026-09-13' },
  // confirmada que llega MAÑANA → no aparece
  { id: 'r-conf', hotelId: 'h1', roomId: 'room-205', guestId: 'g-lopez', status: 'confirmed', checkIn: '2026-09-12', checkOut: '2026-09-13' },
  // confirmada con estadía ya pasada (nunca llegó) → no aparece
  { id: 'r-stale', hotelId: 'h1', roomId: 'room-207', guestId: 'g-lopez', status: 'confirmed', checkIn: '2026-09-01', checkOut: '2026-09-03' },
  { id: 'r-out', hotelId: 'h1', roomId: 'room-206', guestId: 'g-perez', status: 'checked_out', checkIn: '2026-09-01', checkOut: '2026-09-03' },
  // reserva del hotel cuyo huésped es de OTRO hotel (dato inconsistente) → nombre vacío
  { id: 'r-weird', hotelId: 'h1', roomId: 'room-208', guestId: 'g-h2', status: 'checked_in', checkIn: '2026-09-10', checkOut: '2026-09-12' },
  { id: 'r-h2', hotelId: 'h2', roomId: 'room-h2-204', guestId: 'g-h2', status: 'checked_in', checkIn: '2026-09-10', checkOut: '2026-09-12' },
]
const rooms = [
  { id: 'room-204', hotelId: 'h1', number: '204' }, { id: 'room-201', hotelId: 'h1', number: '201' },
  { id: 'room-203', hotelId: 'h1', number: '203' }, { id: 'room-205', hotelId: 'h1', number: '205' },
  { id: 'room-206', hotelId: 'h1', number: '206' }, { id: 'room-207', hotelId: 'h1', number: '207' },
  { id: 'room-208', hotelId: 'h1', number: '208' }, { id: 'room-h2-204', hotelId: 'h2', number: '204' },
]
const guests = [
  { id: 'g-perez', hotelId: 'h1', name: 'Juan Pérez' }, { id: 'g-garcia', hotelId: 'h1', name: 'Ana García' },
  { id: 'g-lopez', hotelId: 'h1', name: 'Luis López' }, { id: 'g-h2', hotelId: 'h2', name: 'Pedro Pérez' },
]
const users = [{ id: 'u1', hotelId: 'h1' }, { id: 'u-sa', hotelId: null }]

function deps(store: any[] = reservations, hotelStore: any[] = hotels): InHouseDeps {
  return { repo: backed(store), roomRepo: backed(rooms), guestRepo: backed(guests), userRepo: backed(users), hotelRepo: backed(hotelStore), now: () => NOW_LOCAL_NIGHT }
}
const admin = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const ids = (res: { data: { id: string }[] }) => res.data.map((r) => r.id)

describe('#209 — searchInHouse (reservas)', () => {
  it('sin término lista checked_in + confirmadas vigentes del hotel, ordenadas por habitación, sin saldo', async () => {
    const res = await searchInHouse(deps(), { q: '' }, admin)
    expect(ids(res)).toEqual(['r-201', 'r-today', 'r-204', 'r-weird'])
    expect(res.total).toBe(4)
    expect(res.data[2]).toEqual({
      id: 'r-204', hotelId: 'h1', roomId: 'room-204', roomNumber: '204', guestId: 'g-perez', guestName: 'Juan Pérez',
      checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, status: 'checked_in',
    })
    expect('balance' in res.data[2]).toBe(false)
  })

  it('REG-1: la confirmada que llega hoy aparece con status confirmed; la de mañana y la vencida no', async () => {
    const res = await searchInHouse(deps(), { q: '' }, admin)
    expect(res.data.find((r) => r.id === 'r-today')?.status).toBe('confirmed')
    expect(ids(res)).not.toContain('r-conf')
    expect(ids(res)).not.toContain('r-stale')
    expect(isCurrentConfirmed({ status: 'confirmed', checkIn: '2026-09-11T00:00:00.000Z', checkOut: '2026-09-11' }, TODAY)).toBe(true)
    expect(isCurrentConfirmed({ status: 'checked_out', checkIn: TODAY, checkOut: '2026-09-12' }, TODAY)).toBe(false)
  })

  it('"hoy" es el del HOTEL: a las 20:00 de Santo Domingo (00:00 UTC del 12) la que llega el 11 sigue siendo de hoy', async () => {
    expect(NOW_LOCAL_NIGHT.toISOString().slice(0, 10)).toBe('2026-09-12')   // en UTC ya es mañana
    const res = await searchInHouse(deps(), { q: '' }, admin)
    expect(ids(res)).toContain('r-today')
    expect(ids(res)).not.toContain('r-conf')   // llega el 12: mañana para el hotel, aunque UTC diga hoy
    // El mismo instante en un hotel de Madrid (UTC+2) ya es el 12: r-conf pasa a ser "llega hoy".
    const madrid = await searchInHouse(deps(reservations, [{ id: 'h1', timezone: 'Europe/Madrid' }]), { q: '' }, admin)
    expect(ids(madrid)).toContain('r-conf')
    // Sin timezone cargada cae al default del modelo (Santo Domingo), no a UTC.
    const noTz = await searchInHouse(deps(reservations, [{ id: 'h1' }]), { q: '' }, admin)
    expect(ids(noTz)).toEqual(ids(res))
  })

  it('las confirmed se piden por llegada hoy y ayer (igualdad), nunca la tabla entera de confirmadas', async () => {
    const queries: any[] = []
    const spyRepo = backed<any>(reservations)
    const original = spyRepo.findMany.bind(spyRepo)
    spyRepo.findMany = async (q: any = {}) => { queries.push(q); return original(q) }
    const d = { ...deps(), repo: spyRepo }
    const res = await searchInHouse(d, { q: '' }, admin)
    expect(ids(res)).toEqual(['r-201', 'r-today', 'r-204', 'r-weird'])
    const confirmedQueries = queries.filter((q) => q.status === 'confirmed')
    expect(confirmedQueries).toHaveLength(CONFIRMED_LOOKBACK_DAYS + 1)
    expect(confirmedQueries.map((q) => q.checkIn).sort()).toEqual(['2026-09-10', '2026-09-11'])
    expect(confirmedQueries.every((q) => q.hotelId === 'h1')).toBe(true)
    expect(confirmedArrivalDates('2026-03-01')).toEqual(['2026-03-01', '2026-02-28'])
  })

  it('confirmada que llegó AYER sin check-in y sale hoy o después → vigente; la que ya salió, no', async () => {
    const store = [
      ...reservations,
      { id: 'r-yesterday', hotelId: 'h1', roomId: 'room-205', guestId: 'g-lopez', status: 'confirmed', checkIn: '2026-09-10', checkOut: '2026-09-12' },
      { id: 'r-yesterday-gone', hotelId: 'h1', roomId: 'room-206', guestId: 'g-lopez', status: 'confirmed', checkIn: '2026-09-10', checkOut: '2026-09-10' },
    ]
    const res = await searchInHouse(deps(store), { q: '' }, admin)
    expect(ids(res)).toContain('r-yesterday')
    expect(ids(res)).not.toContain('r-yesterday-gone')
  })

  it('"204" encuentra la habitación 204 (y no la 204 de OTRO hotel)', async () => {
    const res = await searchInHouse(deps(), { q: '204' }, admin)
    expect(ids(res)).toEqual(['r-204'])
    expect(res.data.every((r) => r.hotelId === 'h1')).toBe(true)
  })

  it('"20" lista por prefijo; "4" no (no es substring del número)', async () => {
    expect((await searchInHouse(deps(), { q: '20' }, admin)).data.map((r) => r.roomNumber)).toEqual(['201', '203', '204', '208'])
    expect((await searchInHouse(deps(), { q: '4' }, admin)).data).toEqual([])
  })

  it('apellido sin acento ni mayúscula: "perez" → Pérez; el Pérez checked_out y el de otro hotel NO', async () => {
    const res = await searchInHouse(deps(), { q: 'perez' }, admin)
    expect(ids(res)).toEqual(['r-204'])
  })

  it('huésped de OTRO hotel en una reserva del hotel → nombre vacío (no se resuelve), la fila sigue', async () => {
    const res = await searchInHouse(deps(), { q: '208' }, admin)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].guestName).toBe('')
    expect(res.data[0].guestId).toBe('g-h2')
  })

  it('habitación sin huésped alojado ni por llegar (205 llega mañana, 206 hizo checkout) → vacío', async () => {
    expect((await searchInHouse(deps(), { q: '205' }, admin)).data).toEqual([])
    expect((await searchInHouse(deps(), { q: '206' }, admin)).data).toEqual([])
  })

  it('`id`: devuelve esa reserva del hotel en cualquier estado (checked_out incluida); de otro hotel → vacío', async () => {
    const out = await searchInHouse(deps(), { id: 'r-out' }, admin)
    expect(ids(out)).toEqual(['r-out'])
    expect(out.data[0].status).toBe('checked_out')
    expect(out.data[0].roomNumber).toBe('206')
    expect((await searchInHouse(deps(), { id: 'r-h2' }, admin)).data).toEqual([])
    expect((await searchInHouse(deps(), { id: 'nope' }, admin)).data).toEqual([])
  })

  it('el hotel sale del token o de la BD; nadie mira otro hotel por query (ni super_admin sin hotel → 401)', async () => {
    const fromDb = await searchInHouse(deps(), { q: '' }, { id: 'u1', role: 'hotel_admin' })
    expect(ids(fromDb)).toContain('r-204')
    const sneaky = await searchInHouse(deps(), { q: '', hotelId: 'h2' } as any, admin)
    expect(sneaky.data.every((r) => r.hotelId === 'h1')).toBe(true)
    await expect(searchInHouse(deps(), { q: '' }, { id: 'u-sa', role: 'super_admin' })).rejects.toBeInstanceOf(AuthError)
  })

  it('más de IN_HOUSE_LIMIT coincidencias: data recortada, total real', async () => {
    const many = Array.from({ length: IN_HOUSE_LIMIT + 7 }, (_, i) => ({
      id: `r-${i}`, hotelId: 'h1', roomId: 'room-204', guestId: 'g-perez', status: 'checked_in', checkIn: '2026-09-10', checkOut: '2026-09-12',
    }))
    const res = await searchInHouse(deps(many), { q: '' }, admin)
    expect(res.data).toHaveLength(IN_HOUSE_LIMIT)
    expect(res.total).toBe(IN_HOUSE_LIMIT + 7)
  })

  it('término más largo que el tope → 400 sin consultar', async () => {
    await expect(searchInHouse(deps(), { q: 'x'.repeat(61) }, admin)).rejects.toBeInstanceOf(ValidationError)
  })

  it('helpers puros: normalizeQuery quita acentos/mayúsculas; matchesInHouse por prefijo de habitación o substring de nombre', () => {
    expect(normalizeQuery('  PÉREZ ')).toBe('perez')
    expect(matchesInHouse({ roomNumber: '204', guestName: 'Juan Pérez' }, '20')).toBe(true)
    expect(matchesInHouse({ roomNumber: '204', guestName: 'Juan Pérez' }, 'rez')).toBe(true)
    expect(matchesInHouse({ roomNumber: '204', guestName: 'Juan Pérez' }, '04')).toBe(false)
  })
})
