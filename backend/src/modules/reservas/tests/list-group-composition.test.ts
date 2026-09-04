// reservas/tests/list-group-composition.test.ts — Requerimiento 13 (Administración | Composición
// de huéspedes, 2026-09-03).
//
// El panel no tenía forma de traer TODAS las habitaciones de una reserva de varias habitaciones
// (mismo `groupId`) para mostrar la composición de cada una — `ReservationModal.vue` solo mostraba
// la reserva individual que abría. `listReservations` (`usecases/crud.ts`) no aceptaba `groupId`
// como filtro; se agregó junto al resto (`status`/`channel`/`roomId`/`guestId`), scoped por
// `hotelId` con el MISMO criterio que el resto del listado (sin IDOR nuevo).
//
// Además: `listReservations`/`getReservationById` no tienen allow-list (devuelven la fila ORM tal
// cual — ver `crud.ts`), así que `childrenAges`/`childrenAgesAsOf` de CADA habitación del grupo
// viajan gratis. Este test lo prueba explícito para que un allow-list agregado después no los
// descarte en silencio.

import { describe, it, expect } from 'bun:test'
import { listReservations, getReservationById } from '../usecases/crud'

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any

function makeRepo(rows: any[]) {
  return {
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    // Doble mínimo de `paginate`: aplica el WHERE real (los tests fallan si algún filtro no se lee).
    paginate: async (filters: Record<string, unknown>, opts: { offset: number; limit: number }) => {
      const data = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
      return { data: data.slice(opts.offset, opts.offset + opts.limit), total: data.length }
    },
  }
}

function room(over: Record<string, any>) {
  return { id: 'x', hotelId: HOTEL, roomId: 'x', checkIn: '2030-01-10', checkOut: '2030-01-12', totalAmount: 100, status: 'confirmed', ...over }
}

const hotelAdmin = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

describe('listReservations — filtro groupId (Requerimiento 13, varias habitaciones)', () => {
  it('trae SOLO las reservas del mismo groupId, cada una con su propia composición', async () => {
    const rows = [
      room({ id: 'r-a', groupId: 'g1', roomId: 'room-a', adults: 2, children: 1, childrenAges: [2] }), // niño libre
      room({ id: 'r-b', groupId: 'g1', roomId: 'room-b', adults: 2, children: 1, childrenAges: [8] }), // niño con plaza
      room({ id: 'r-c', groupId: 'g2', roomId: 'room-c', adults: 3, children: 0 }), // otro grupo, no debe aparecer
      room({ id: 'r-d', roomId: 'room-d', adults: 2, children: 0 }), // reserva individual, no debe aparecer
    ]
    const repo = makeRepo(rows)
    const result = await listReservations(repo, {} as any, noopCache, noopLogger, { groupId: 'g1' } as any, hotelAdmin)
    expect(result.data.map((r: any) => r.id).sort()).toEqual(['r-a', 'r-b'])
    const byId = Object.fromEntries(result.data.map((r: any) => [r.id, r]))
    expect(byId['r-a'].childrenAges).toEqual([2])
    expect(byId['r-a'].adults).toBe(2)
    expect(byId['r-a'].children).toBe(1)
    expect(byId['r-b'].childrenAges).toEqual([8])
  })

  it('scoped por hotelId: no filtra reservas de otro hotel aunque compartan groupId (IDOR)', async () => {
    const rows = [
      room({ id: 'r-a', hotelId: HOTEL, groupId: 'g1' }),
      room({ id: 'r-b', hotelId: OTRO_HOTEL, groupId: 'g1' }),
    ]
    const repo = makeRepo(rows)
    const result = await listReservations(repo, {} as any, noopCache, noopLogger, { groupId: 'g1' } as any, hotelAdmin)
    expect(result.data.map((r: any) => r.id)).toEqual(['r-a'])
  })

  it('reserva individual (sin groupId): getReservationById expone childrenAges/childrenAgesAsOf sin allow-list', async () => {
    const rows = [room({ id: 'r-a', adults: 2, children: 1, childrenAges: [8], childrenAgesAsOf: '2030-01-10' })]
    const repo = makeRepo(rows)
    const item: any = await getReservationById(repo, 'r-a', hotelAdmin)
    expect(item.childrenAges).toEqual([8])
    expect(item.childrenAgesAsOf).toBe('2030-01-10')
  })
})
