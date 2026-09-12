// arrival-setup.test.ts — La tarea `arrival_setup` nace de la reserva y la sigue (#274).

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { buildSetupItems, syncArrivalSetup, ARRIVAL_SETUP_TYPE, type ArrivalReservationRef } from '../usecases/arrival-setup'

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
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const withBaby: ArrivalReservationRef = {
  id: 'res1', hotelId: 'h1', roomId: 'r1', status: 'confirmed', checkIn: today,
  needsCrib: true, cribCount: 1,
  childAmenities: [{ id: 'a1', name: 'Bañera', price: 5, quantity: 1, total: 5 }],
  regime: 'room_only',
}

describe('buildSetupItems', () => {
  it('cuna + amenidad infantil → ítems estructurados', () => {
    expect(buildSetupItems(withBaby)).toEqual([
      { type: 'crib', qty: 1 },
      { type: 'amenity', name: 'Bañera', qty: 1 },
    ])
  })

  it('sin bebé → []', () => {
    expect(buildSetupItems({ ...withBaby, needsCrib: false, childAmenities: [] })).toEqual([])
  })

  it('régimen distinto de room_only y pedido especial dentro de las notas', () => {
    const items = buildSetupItems({
      ...withBaby, needsCrib: false, childAmenities: [], regime: 'breakfast',
      notes: 'Llegada estimada: 18:00 | Pedido especial: cuna cerca de la ventana | Promo: X',
    })
    expect(items).toEqual([
      { type: 'regime', name: 'breakfast' },
      { type: 'request', text: 'cuna cerca de la ventana' },
    ])
  })

  // El driver puede devolver el snapshot json como string.
  it('acepta childAmenities como string JSON', () => {
    const items = buildSetupItems({ ...withBaby, needsCrib: false, childAmenities: JSON.stringify([{ name: 'Silla alta', quantity: 2 }]) })
    expect(items).toEqual([{ type: 'amenity', name: 'Silla alta', qty: 2 }])
  })
})

describe('syncArrivalSetup', () => {
  it('reserva confirmada con bebé en ventana → crea la tarea arrival_setup', async () => {
    const repo = memoryRepo()
    const { deps: d, invalidated } = deps(repo)

    const res = await syncArrivalSetup(d, withBaby)

    expect(res.action).toBe('created')
    expect(repo.rows).toHaveLength(1)
    const task = repo.rows[0]
    expect(task.type).toBe(ARRIVAL_SETUP_TYPE)
    expect(task.reservationId).toBe('res1')
    expect(task.roomId).toBe('r1')
    expect(task.status).toBe('pending')
    expect(task.hotelId).toBe('h1')
    expect(task.assignedDate).toBe(today)
    expect(task.setupItems).toEqual([{ type: 'crib', qty: 1 }, { type: 'amenity', name: 'Bañera', qty: 1 }])
    expect(invalidated).toEqual(['h1'])
  })

  it('sin bebé → no crea nada', async () => {
    const repo = memoryRepo()
    const { deps: d } = deps(repo)

    const res = await syncArrivalSetup(d, { ...withBaby, needsCrib: false, childAmenities: [] })

    expect(res.action).toBe('none')
    expect(repo.rows).toHaveLength(0)
  })

  it('reasignación antes del check-in: la tarea pasa a la habitación nueva', async () => {
    const repo = memoryRepo()
    const { deps: d } = deps(repo)
    await syncArrivalSetup(d, withBaby)
    const id = repo.rows[0].id

    const res = await syncArrivalSetup(d, { ...withBaby, roomId: 'r2' })

    expect(res.action).toBe('updated')
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].id).toBe(id)
    expect(repo.rows[0].roomId).toBe('r2')
    expect(repo.rows[0].setupItems).toEqual([{ type: 'crib', qty: 1 }, { type: 'amenity', name: 'Bañera', qty: 1 }])
    expect(repo.rows.filter((t) => t.roomId === 'r1')).toHaveLength(0)
  })

  it('es idempotente: repetir sin cambios no escribe ni duplica', async () => {
    const repo = memoryRepo()
    const { deps: d, invalidated } = deps(repo)
    await syncArrivalSetup(d, withBaby)

    const res = await syncArrivalSetup(d, withBaby)

    expect(res.action).toBe('none')
    expect(repo.rows).toHaveLength(1)
    expect(invalidated).toHaveLength(1)
  })

  it('cancelada → borra la pending; una completed no se toca', async () => {
    const repo = memoryRepo()
    const { deps: d } = deps(repo)
    await syncArrivalSetup(d, withBaby)
    repo.rows.push({ id: 'done', hotelId: 'h1', roomId: 'r1', reservationId: 'res1', type: ARRIVAL_SETUP_TYPE, status: 'completed', setupItems: [] })

    const res = await syncArrivalSetup(d, { ...withBaby, status: 'cancelled' })

    expect(res.action).toBe('deleted')
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].id).toBe('done')

    // Volver a sincronizar con la completed sola: nada que hacer, no se recrea.
    expect((await syncArrivalSetup(d, { ...withBaby, status: 'cancelled' })).action).toBe('none')
  })

  it('check-in fuera de la ventana → no crea', async () => {
    const repo = memoryRepo()
    const { deps: d } = deps(repo)

    const res = await syncArrivalSetup(d, { ...withBaby, checkIn: plusDays(10) })

    expect(res.action).toBe('none')
    expect(repo.rows).toHaveLength(0)
  })

  it('régimen + pedido especial llegan a la tarea', async () => {
    const repo = memoryRepo()
    const { deps: d } = deps(repo)

    await syncArrivalSetup(d, {
      ...withBaby, regime: 'breakfast',
      notes: 'Llegada estimada: 18:00 | Pedido especial: cuna cerca de la ventana | Promo: X',
    })

    expect(repo.rows[0].setupItems).toEqual([
      { type: 'crib', qty: 1 },
      { type: 'amenity', name: 'Bañera', qty: 1 },
      { type: 'regime', name: 'breakfast' },
      { type: 'request', text: 'cuna cerca de la ventana' },
    ])
  })
})
