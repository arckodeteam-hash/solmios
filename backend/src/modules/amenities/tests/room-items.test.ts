// #290 — amenidades personalizadas por habitación: key custom:<slug> derivada del nombre,
// name/price/isActive por fila, inactivas conservadas (y devueltas en GET), price negativo rechazado.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { AmenitiesService } from '../service'
import { AmenitiesController } from '../controller'
import { normalizeRoomAmenityItems, planRoomAmenityUpsert, slugifyAmenityName } from '../usecases/room-amenity-items'

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as any

function fakeRepo(rows: any[]): RepositoryAdapter<any> {
  return {
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findMany: async (filter: any = {}) => rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)),
    create: async (row: any) => { rows.push(row); return row },
    update: async (id: string, patch: any) => { const row = rows.find((r) => r.id === id); if (row) Object.assign(row, patch); return row },
  } as unknown as RepositoryAdapter<any>
}

function setup(roomRows: any[] = []) {
  const rooms = fakeRepo([{ id: 'rm1', hotelId: 'h1' }])
  const service = new AmenitiesService(fakeRepo([]), fakeRepo(roomRows), silentLog, rooms, fakeRepo([]))
  return { service, controller: new AmenitiesController(service, silentLog), rows: roomRows }
}

const ok = (r: ReturnType<typeof normalizeRoomAmenityItems>) => { if ('error' in r) throw new Error(r.error); return r.items }
const err = (r: ReturnType<typeof normalizeRoomAmenityItems>) => ('error' in r ? r.error : '')

describe('normalizeRoomAmenityItems', () => {
  it('deriva la key del nombre y aplica defaults (price 0, isActive true)', () => {
    expect(ok(normalizeRoomAmenityItems([{ name: 'Cuna' }]))).toEqual([{ key: 'custom:cuna', name: 'Cuna', price: 0, isActive: true }])
    expect(ok(normalizeRoomAmenityItems([{ name: ' Cama extra ' }]))[0].key).toBe('custom:cama_extra')
    expect(slugifyAmenityName('Desayuno à la habitación!')).toBe('desayuno_a_la_habitacion')
  })

  it('respeta key explícita, redondea price a 2 decimales y acepta price 0 (gratis)', () => {
    const items = ok(normalizeRoomAmenityItems([{ key: 'custom:crib', name: 'Cuna', price: 15.005, isActive: false }, { name: 'Gratis', price: 0 }]))
    expect(items[0]).toEqual({ key: 'custom:crib', name: 'Cuna', price: 15.01, isActive: false })
    expect(items[1].price).toBe(0)
  })

  it('rechaza price negativo o no numérico', () => {
    expect(err(normalizeRoomAmenityItems([{ name: 'Cuna', price: -5 }]))).toBe('price debe ser un número >= 0')
    expect(err(normalizeRoomAmenityItems([{ name: 'Cuna', price: 'abc' }]))).toBe('price debe ser un número >= 0')
    expect(err(normalizeRoomAmenityItems([{ name: 'Cuna', price: NaN }]))).toBe('price debe ser un número >= 0')
  })

  it('rechaza key inválida, nombre vacío, duplicados y no-array', () => {
    expect(err(normalizeRoomAmenityItems([{ key: 'wifi', name: 'Wifi' }]))).toContain('key inválida')
    expect(err(normalizeRoomAmenityItems([{ key: 'custom:Con Espacios', name: 'x' }]))).toContain('key inválida')
    expect(err(normalizeRoomAmenityItems([{ name: '   ' }]))).toBe('name es requerido')
    expect(err(normalizeRoomAmenityItems([{ name: 'Cuna' }, { key: 'custom:cuna', name: 'Otra' }]))).toBe('key duplicada: custom:cuna')
    expect(err(normalizeRoomAmenityItems({ name: 'Cuna' }))).toBe('items debe ser un array')
  })
})

describe('planRoomAmenityUpsert', () => {
  it('ignora keys custom en fixedKeys y conserva custom inactivas que vienen en items', () => {
    const existing = [{ id: 'a', amenityKey: 'wifi', isActive: 1 }, { id: 'b', amenityKey: 'custom:cuna', isActive: 1 }, { id: 'c', amenityKey: 'custom:vieja', isActive: 1 }]
    const plan = planRoomAmenityUpsert(existing, ['wifi', 'custom:cuna', 'tv'], [{ key: 'custom:cuna', name: 'Cuna', price: 20, isActive: false }])
    expect(plan.reactivate).toEqual(['a'])
    expect(plan.create).toEqual([{ amenityKey: 'tv', name: '', price: 0, isActive: true }])
    expect(plan.update).toEqual([{ id: 'b', patch: { name: 'Cuna', price: 20, isActive: false } }])
    expect(plan.deactivate).toEqual(['c'])
    expect(plan.activeKeys).toEqual(['wifi', 'tv'])
  })

  it('con items undefined (cliente viejo) no toca las custom y las activas cuentan en activeKeys', () => {
    const existing = [{ id: 'b', amenityKey: 'custom:cuna', isActive: 1 }, { id: 'c', amenityKey: 'custom:off', isActive: 0 }]
    const plan = planRoomAmenityUpsert(existing, ['wifi'])
    expect(plan.deactivate).toEqual([])
    expect(plan.update).toEqual([])
    expect(plan.activeKeys).toEqual(['custom:cuna', 'wifi'])
  })
})

describe('AmenitiesService.updateRoomAmenities con items custom', () => {
  it('crea, conserva inactivas, las devuelve en GET y desactiva al quitarlas', async () => {
    const { service, rows } = setup()
    let keys: string[] = []
    service.setSockets({ onRoomAmenitiesUpdated: async (_roomId, k) => { keys = k } })

    const cuna = { key: 'custom:cuna', name: 'Cuna', price: 15, isActive: true }
    expect(await service.updateRoomAmenities('rm1', ['wifi'], [cuna])).toBe(2)
    expect(rows).toHaveLength(2)
    const row = rows.find((r) => r.amenityKey === 'custom:cuna')!
    expect(row).toMatchObject({ roomId: 'rm1', name: 'Cuna', price: 15, isActive: 1 })
    expect(keys).toEqual(['wifi', 'custom:cuna'])

    // Desactivar: la fila se CONSERVA (isActive 0, price actualizado) y el GET la sigue devolviendo.
    expect(await service.updateRoomAmenities('rm1', ['wifi'], [{ ...cuna, isActive: false, price: 20 }])).toBe(1)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.amenityKey === 'custom:cuna')).toMatchObject({ id: row.id, isActive: 0, price: 20 })
    expect(keys).toEqual(['wifi'])
    const listed = await service.listRoomAmenities('rm1')
    expect(listed.map((r) => r.amenityKey).sort()).toEqual(['custom:cuna', 'wifi'])

    // Reactivar desde el form.
    await service.updateRoomAmenities('rm1', ['wifi'], [{ ...cuna, price: 20 }])
    expect(rows.find((r) => r.amenityKey === 'custom:cuna')!.isActive).toBe(1)

    // items [] → el hotel la quitó: se desactiva. amenities [] → wifi también.
    await service.updateRoomAmenities('rm1', ['wifi'], [])
    expect(rows.find((r) => r.amenityKey === 'custom:cuna')!.isActive).toBe(0)
    expect(await service.updateRoomAmenities('rm1', [], [])).toBe(0)
    expect(rows.find((r) => r.amenityKey === 'wifi')!.isActive).toBe(0)
    expect(await service.listRoomAmenities('rm1')).toHaveLength(1) // sólo la custom (inactiva); la fija inactiva no
    expect(keys).toEqual([])
  })

  it('llamada vieja sólo con amenities no borra las custom', async () => {
    const { service, rows } = setup([{ id: 'x', roomId: 'rm1', amenityKey: 'custom:cuna', name: 'Cuna', price: 5, isActive: 1 }])
    expect(await service.updateRoomAmenities('rm1', ['wifi'])).toBe(2)
    expect(rows.find((r) => r.amenityKey === 'custom:cuna')!.isActive).toBe(1)
  })
})

describe('AmenitiesController.updateRoom con items', () => {
  const req = (body: any) => ({ user: { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }, query: {}, params: { roomId: 'rm1' }, body }) as any

  it('400 con items inválidos (price negativo) y con items que no son array', async () => {
    const { controller, rows } = setup()
    const res = await controller.updateRoom(req({ amenities: ['wifi'], items: [{ name: 'Cuna', price: -1 }] }))
    expect(res.status).toBe(400)
    expect((res.body as any).error).toBe('price debe ser un número >= 0')
    expect(rows).toHaveLength(0)
    expect((await controller.updateRoom(req({ amenities: [], items: 'nope' }))).status).toBe(400)
  })

  it('200: guarda fijas + custom e ignora keys custom coladas en amenities', async () => {
    const { controller, rows } = setup()
    const res = await controller.updateRoom(req({ amenities: ['wifi', 'custom:fantasma'], items: [{ name: 'Cuna', price: 15 }] }))
    expect(res.status).toBe(200)
    expect((res.body as any).count).toBe(2)
    expect(rows.map((r) => r.amenityKey).sort()).toEqual(['custom:cuna', 'wifi'])
  })
})
