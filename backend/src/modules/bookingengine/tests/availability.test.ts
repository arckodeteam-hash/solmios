// El motor leía una tabla de stock que nadie llenaba (0 filas en toda la base):
// un hotel con 54 habitaciones libres respondía "no hay disponibilidad" a todos
// los clientes, con HTTP 200 y sin que nadie se enterara.
import { describe, it, expect } from 'bun:test'
import { AvailabilityUseCase } from '../usecases/availability'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'

const noCache = { get: async () => null, set: async () => {} } as unknown as CacheAdapter

const ROOMS = [
  { id: 'r1', hotelId: 'h1', type: 'double', capacity: 2, surfaceArea: 22, basePrice: 80, status: 'available' },
  { id: 'r2', hotelId: 'h1', type: 'double', capacity: 2, surfaceArea: 25, basePrice: 90, status: 'available' },
  { id: 'r3', hotelId: 'h1', type: 'suite', capacity: 4, surfaceArea: 40, basePrice: 150, status: 'available' },
  { id: 'r4', hotelId: 'h1', type: 'double', capacity: 2, surfaceArea: 22, basePrice: 80, status: 'out_of_order' },
]

function setup(reservations: any[] = [], rooms = ROOMS) {
  const repo = (rows: any[]): RepositoryAdapter<any> => ({
    findMany: async () => rows,
    findOne: async () => ({ id: 'h1', name: 'Hotel Prueba' }),
  } as unknown as RepositoryAdapter<any>)
  return new AvailabilityUseCase(noCache, repo(rooms), repo(reservations), repo([]))
}

const totalOf = (r: any) => r.roomTypes.reduce((s: number, t: any) => s + t.available, 0)

describe('Disponibilidad del motor de reservas', () => {
  it('ofrece las habitaciones reales del hotel', async () => {
    const r = await setup().check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    expect(r.hotelName).toBe('Hotel Prueba')  // viajaba vacío
    expect(r.nights).toBe(2)
    // r1 + r2 (double) + r3 (suite): una suite de 4 también sirve para 2.
    // r4 no cuenta: está fuera de servicio.
    expect(totalOf(r)).toBe(3)
  })

  it('no vende una habitación fuera de servicio', async () => {
    const r = await setup().check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    const double = r.roomTypes.find(t => t.roomType === 'double')!
    expect(double.available).toBe(2) // de 3 doubles, una está out_of_order
  })

  it('descuenta la habitación ya reservada en esas fechas', async () => {
    const r = await setup([
      { roomId: 'r1', status: 'confirmed', checkIn: '2026-08-09', checkOut: '2026-08-11' },
    ]).check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    expect(totalOf(r)).toBe(2) // de 3 vendibles, r1 quedó ocupada
  })

  it('una reserva CANCELADA libera la habitación', async () => {
    const r = await setup([
      { roomId: 'r1', status: 'cancelled', checkIn: '2026-08-09', checkOut: '2026-08-11' },
    ]).check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    expect(totalOf(r)).toBe(3)
  })

  it('el día de salida no bloquea: quien se va el 10 libera esa noche', async () => {
    const r = await setup([
      { roomId: 'r1', status: 'confirmed', checkIn: '2026-08-08', checkOut: '2026-08-10' },
    ]).check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    expect(totalOf(r)).toBe(3) // r1 se liberó ese mismo día
  })

  it('una reserva de otras fechas no afecta', async () => {
    const r = await setup([
      { roomId: 'r1', status: 'confirmed', checkIn: '2026-09-01', checkOut: '2026-09-05' },
    ]).check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    expect(totalOf(r)).toBe(3)
  })

  it('no ofrece habitaciones donde no entra el grupo', async () => {
    const r = await setup().check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 4 } as any)
    expect(r.roomTypes.map(t => t.roomType)).toEqual(['suite'])
  })

  it('publica el precio más barato de cada tipo', async () => {
    const r = await setup().check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    expect(r.roomTypes.find(t => t.roomType === 'double')!.price).toBe(80)
  })

  it('publica el surfaceArea máximo de cada tipo (m²)', async () => {
    const r = await setup().check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    // double: r1=22, r2=25, r4(out_of_order)=22 → máximo 25.
    expect(r.roomTypes.find(t => t.roomType === 'double')!.surfaceArea).toBe(25)
    // suite: única room, r3=40.
    expect(r.roomTypes.find(t => t.roomType === 'suite')!.surfaceArea).toBe(40)
  })

  it('rechaza un rango inválido', async () => {
    await expect(
      setup().check({ hotelId: 'h1', checkIn: '2026-08-12', checkOut: '2026-08-10', adults: 2 } as any),
    ).rejects.toThrow('checkOut must be after checkIn')
  })
})

// Requerimiento 2 (capacidad por tipo de habitación, 2026-09-03) — `/rates` y el buscador público
// tienen que anunciar la MISMA capacidad que después valida `fitsRoomCapacity` al reservar. Antes
// de esto, `capacity`/`maxAdults`/`maxChildren` por tipo eran un agregado por MÁXIMO entre
// habitaciones físicas (una foto aproximada); acá se reemplaza por la política real cuando el
// hotel la configuró.
describe('Disponibilidad — Requerimiento 2: capacidad por tipo (room_type_capacity)', () => {
  function setupWithTypeCapacity(rooms: any[], typeCapacityValue?: unknown) {
    const repo = (rows: any[]): RepositoryAdapter<any> => ({
      findMany: async () => rows,
      findOne: async () => ({ id: 'h1', name: 'Hotel Prueba' }),
    } as unknown as RepositoryAdapter<any>)
    const configurationRepo = {
      findMany: async () => [],
      findOne: async (f: any) => (f.key === 'room_type_capacity' ? { hotelId: 'h1', key: 'room_type_capacity', value: typeCapacityValue } : null),
    } as unknown as RepositoryAdapter<any>
    return new AvailabilityUseCase(noCache, repo(rooms), repo([]), repo([]), undefined, undefined, undefined, configurationRepo)
  }

  it('la política del tipo reemplaza el agregado por MÁXIMO entre habitaciones físicas', async () => {
    const rooms = [
      { id: 'r1', hotelId: 'h1', type: 'double', capacity: 6, maxAdults: 6, maxChildren: 6, basePrice: 80, status: 'available' },
      { id: 'r2', hotelId: 'h1', type: 'double', capacity: 2, maxAdults: 2, maxChildren: 0, basePrice: 90, status: 'available' },
    ]
    const r = await setupWithTypeCapacity(rooms, { double: { capacity: 2, maxAdults: 2, maxChildren: 1 } })
      .check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    const double = r.roomTypes.find(t => t.roomType === 'double')!
    // Sin política, el MÁXIMO entre r1(6) y r2(2) publicaría capacity=6 — la política dice 2.
    expect(double.capacity).toBe(2)
    expect(double.maxAdults).toBe(2)
    expect(double.maxChildren).toBe(1)
  })

  it('sin política para el tipo: sigue el agregado por MÁXIMO de siempre (retrocompatible)', async () => {
    const rooms = [
      { id: 'r1', hotelId: 'h1', type: 'suite', capacity: 4, maxAdults: 3, maxChildren: 2, basePrice: 150, status: 'available' },
      { id: 'r2', hotelId: 'h1', type: 'suite', capacity: 6, maxAdults: null, maxChildren: null, basePrice: 160, status: 'available' },
    ]
    // La config existe pero solo trae "double" — "suite" no está configurado.
    const r = await setupWithTypeCapacity(rooms, { double: { capacity: 2, maxAdults: 2, maxChildren: 1 } })
      .check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    const suite = r.roomTypes.find(t => t.roomType === 'suite')!
    expect(suite.capacity).toBe(6) // máximo entre 4 y 6, como antes
    expect(suite.maxAdults).toBe(3) // máximo entre 3 y null→ignorado
  })

  it('sin configurationRepo cableado: comportamiento previo intacto (Map vacío)', async () => {
    const rooms = [{ id: 'r1', hotelId: 'h1', type: 'double', capacity: 2, basePrice: 80, status: 'available' }]
    const repo = (rows: any[]): RepositoryAdapter<any> => ({ findMany: async () => rows, findOne: async () => ({ id: 'h1', name: 'H' }) } as unknown as RepositoryAdapter<any>)
    const uc = new AvailabilityUseCase(noCache, repo(rooms), repo([]), repo([]))
    const r = await uc.check({ hotelId: 'h1', checkIn: '2026-08-10', checkOut: '2026-08-12', adults: 2 } as any)
    expect(r.roomTypes.find(t => t.roomType === 'double')!.capacity).toBe(2)
  })
})
