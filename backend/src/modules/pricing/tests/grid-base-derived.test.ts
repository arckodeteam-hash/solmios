// pricing/tests/grid-base-derived.test.ts — Leer la grilla también deriva el base de la habitación.
//
// Guardar bien no alcanza: las filas que YA estaban en la base traen su propio `basePrice` grabado, y
// devolverlo tal cual es lo que hacía que el editor mostrara 220 mientras la habitación tenía 120.
// Mientras el hotel no volviera a guardar, seguía viendo —y publicando— el número viejo.

import { describe, it, expect } from 'bun:test'
import { PricingQueries } from '../usecases/pricing-queries'

/** Una suite de capacidad 2 a $120, una temporada, y filas guardadas con el base divergente. */
function makeOrm(saved: any[]) {
  return {
    findMany: async (table: string) => {
      if (table === 'Seasons') return [{ id: 's1', hotelId: 'h1', name: 'alta', label: 'Alta', sortOrder: 0 }]
      if (table === 'Rooms') return [{ id: 'rm1', hotelId: 'h1', type: 'suite', capacity: 2, basePrice: 120 }]
      if (table === 'RoomRates') return saved
      return []
    },
  } as any
}

const savedRow = (channel: string, basePrice: number, percentage: number, price: number) => ({
  id: `r-${channel || 'base'}`, hotelId: 'h1', roomType: 'suite', occupancy: 2,
  season: 'alta', channel, basePrice, percentage, price,
})

describe('grilla de tarifas — el base leído es el de la habitación', () => {
  it('una fila guardada con base divergente se lee con el base del tipo', async () => {
    const q = new PricingQueries(makeOrm([savedRow('', 220, 70, 374)]))
    const rows = await q.listBaseRates('h1')
    const suite = rows.find((r: any) => r.roomType === 'suite' && r.occupancy === 2)
    expect(suite.basePrice).toBe(120)
  })

  it('el precio mostrado se recalcula sobre el base derivado', async () => {
    const q = new PricingQueries(makeOrm([savedRow('', 220, 70, 374)]))
    const rows = await q.listBaseRates('h1')
    const suite = rows.find((r: any) => r.roomType === 'suite' && r.occupancy === 2)
    expect(suite.price).toBe(204)   // 120 × 1,70 — el 374 venía del base viejo
  })

  it('conserva el id de la fila real (sigue siendo un UPDATE, no un alta)', async () => {
    const q = new PricingQueries(makeOrm([savedRow('', 220, 70, 374)]))
    const rows = await q.listBaseRates('h1')
    const suite = rows.find((r: any) => r.roomType === 'suite' && r.occupancy === 2)
    expect(suite.id).toBe('r-base')
    expect(suite.percentage).toBe(70)
  })

  it('la grilla del canal usa el mismo base que la del hotel', async () => {
    const orm = makeOrm([savedRow('', 120, 0, 120), savedRow('OpenChannel', 220, 70, 374)])
    const q = new PricingQueries(orm)
    const base = (await q.listBaseRates('h1')).find((r: any) => r.occupancy === 2)
    const canal = (await q.listChannelRates('h1', 'OpenChannel')).find((r: any) => r.occupancy === 2)
    expect(canal.basePrice).toBe(base.basePrice)
    expect(canal.basePrice).toBe(120)
  })

  it('una fila de un tipo borrado conserva su base (la OTA la sigue vendiendo)', async () => {
    const huerfana = { ...savedRow('', 175, 0, 175), roomType: 'fantasma' }
    const q = new PricingQueries(makeOrm([huerfana]))
    const rows = await q.listBaseRates('h1')
    const orphan = rows.find((r: any) => r.roomType === 'fantasma')
    expect(orphan.basePrice).toBe(175)
  })
})
