// arrival-setup-unassigned.test.ts — #262 REQ-HAC-07: con HAC-01 la reserva nace con roomId = null
// hasta el check-in. La tarea arrival_setup necesita habitación para existir: sin ella no se crea,
// si la reserva se desasigna la pending se borra, y al reasignar se vuelve a crear en la nueva.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { syncArrivalSetup, ARRIVAL_SETUP_TYPE, type ArrivalReservationRef } from '../usecases/arrival-setup'

/** Repo en memoria que respeta los filtros por igualdad, como el ORM real. */
function memoryRepo(rows: any[] = []) {
  const repo = {
    rows,
    findMany: async (filters: any = {}) => rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    create: async (dto: any) => { const row = { ...dto }; rows.push(row); return row },
    update: async (id: string, patch: any) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return null
      rows[i] = { ...rows[i], ...patch }
      return rows[i]
    },
    delete: async (id: string) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
  }
  return repo as unknown as RepositoryAdapter<any> & { rows: any[] }
}

function deps(repo: RepositoryAdapter<any>) {
  const invalidated: string[] = []
  return { deps: { repo, invalidate: async (h: string) => { invalidated.push(h) } }, invalidated }
}

const today = new Date().toISOString().slice(0, 10)

/** Reserva confirmada de hoy con cuna (setupItems no vacíos) y SIN habitación asignada. */
const unassigned: ArrivalReservationRef = {
  id: 'res1', hotelId: 'h1', roomId: null, status: 'confirmed', checkIn: today,
  needsCrib: true, cribCount: 1,
  childAmenities: [{ id: 'a1', name: 'Bañera', price: 5, quantity: 1, total: 5 }],
  regime: 'room_only',
}

describe('#262 REQ-HAC-07 — housekeeping arrival_setup tolera roomId nulo', () => {
  it('reserva confirmed con cuna y roomId null → action none, sin excepción y sin tarea', async () => {
    const repo = memoryRepo()
    const { deps: d, invalidated } = deps(repo)

    const res = await syncArrivalSetup(d, unassigned)

    expect(res.action).toBe('none')
    expect(repo.rows).toHaveLength(0)
    expect(invalidated).toHaveLength(0)
  })

  it('tarea pending en r1 y la reserva se desasigna (roomId null) → la borra', async () => {
    const repo = memoryRepo()
    const { deps: d, invalidated } = deps(repo)
    await syncArrivalSetup(d, { ...unassigned, roomId: 'r1' })
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].roomId).toBe('r1')

    const res = await syncArrivalSetup(d, { ...unassigned, roomId: null })

    expect(res.action).toBe('deleted')
    expect(res.task?.roomId).toBe('r1')
    expect(repo.rows).toHaveLength(0)
    expect(invalidated).toEqual(['h1', 'h1'])
  })

  it('al volver a asignar roomId r2 → crea la tarea en r2 con los ítems de la reserva', async () => {
    const repo = memoryRepo()
    const { deps: d } = deps(repo)
    await syncArrivalSetup(d, { ...unassigned, roomId: 'r1' })
    await syncArrivalSetup(d, { ...unassigned, roomId: null })
    expect(repo.rows).toHaveLength(0)

    const res = await syncArrivalSetup(d, { ...unassigned, roomId: 'r2' })

    expect(res.action).toBe('created')
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0]).toMatchObject({
      type: ARRIVAL_SETUP_TYPE, reservationId: 'res1', roomId: 'r2', status: 'pending', assignedDate: today,
    })
    expect(repo.rows[0].setupItems).toEqual([{ type: 'crib', qty: 1 }, { type: 'amenity', name: 'Bañera', qty: 1 }])
  })

  it('roomId undefined (registro sin la columna) se trata igual que null: none, idempotente', async () => {
    const repo = memoryRepo()
    const { deps: d } = deps(repo)

    const { roomId: _omit, ...withoutRoom } = unassigned
    expect((await syncArrivalSetup(d, withoutRoom)).action).toBe('none')
    expect((await syncArrivalSetup(d, withoutRoom)).action).toBe('none')
    expect(repo.rows).toHaveLength(0)
  })
})
