// pricing/tests/update-rates-base.test.ts — Qué precio se guarda en cada una de las dos capas.
//
// El bug original: `updateRates` tomaba `basePrice` del payload y lo grababa tal cual en cada fila
// (tipo × ocupación × temporada × canal). El editor del canal mandaba el suyo, la grilla base
// mandaba otro, y ninguno tenía que ver con el precio de la habitación. En producción la misma suite
// terminó con 120 / 250 / 220 según por dónde se mirara, sin ninguna señal de error.
//
// Encima de eso, las dos capas guardan cosas distintas (ver shared/utils/season-price.ts):
// la grilla GLOBAL lleva el IMPORTE de cada temporada, y la de CANAL un porcentaje sobre ese
// importe. `basePrice` sigue siendo, en las dos, el precio del tipo — un espejo.

import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { PricingService } from '../service'
import { PricingQueries } from '../usecases/pricing-queries'

const log = silentLogger()

interface Saved { id: string; roomType: string; occupancy: number; season: string; channel: string; basePrice: number; percentage: number; price: number }

/** ORM mínimo con una suite de capacidad 2 a $120 y una temporada. Las tarifas guardadas se
 *  acumulan en `saved` para poder mirar exactamente qué se persistió. */
function makeOrm(roomBasePrice: number, existing: Saved[] = []) {
  const saved: Saved[] = [...existing]
  const orm = {
    saved,
    findMany: async (table: string, filter: any) => {
      if (table === 'Seasons') return [{ id: 's1', hotelId: 'h1', name: 'alta', label: 'Alta', startDate: '2026-01-01', endDate: '2026-03-31', sortOrder: 0 }]
      if (table === 'Rooms') return [{ id: 'rm1', hotelId: 'h1', type: 'suite', capacity: 2, basePrice: roomBasePrice }]
      if (table === 'RoomRates') {
        return saved.filter((r) => Object.entries(filter || {})
          .every(([k, v]) => k === 'hotelId' || (r as any)[k] === v))
      }
      return []
    },
    create: async (_t: string, data: any) => { saved.push(data); return data },
    update: async (_t: string, id: string, data: any) => {
      const row = saved.find((r) => r.id === id)
      if (row) Object.assign(row, data)
      return row
    },
    delete: async () => {},
  }
  return orm
}

function makeService(orm: any, basePricePort?: any) {
  const repo = (table: string) => ({
    findMany: async (f: any) => orm.findMany(table, f),
    findById: async () => null,
    findOne: async (f: any) => (await orm.findMany(table, f))[0] || null,
    create: async (d: any) => orm.create(table, d),
    update: async (id: string, d: any) => orm.update(table, id, d),
    delete: async (id: string) => orm.delete(table, id),
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  })
  const svc = new PricingService(
    repo('Seasons') as any, repo('RoomRates') as any, repo('RoomBlocks') as any,
    repo('RateRestrictions') as any, log, new PricingQueries(orm) as any,
  )
  if (basePricePort) svc.setBasePriceDeps(basePricePort)
  return svc
}

describe('updateRates — el base sale de la habitación, no del payload', () => {
  it('descarta el basePrice del payload y usa el del tipo', async () => {
    const orm = makeOrm(120)
    const svc = makeService(orm)
    // 220 es exactamente lo que el editor de canal mandaba en producción.
    await svc.updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: 'OpenChannel', basePrice: 220, percentage: 70 },
    ])
    expect(orm.saved).toHaveLength(1)
    expect(orm.saved[0]!.basePrice).toBe(120)
  })

  // ── Capa GLOBAL: el importe manda ──────────────────────────────────────────
  it('la grilla global guarda el IMPORTE que escribió el hotel', async () => {
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '', price: 200 },
    ])
    expect(orm.saved[0]!.price).toBe(200)
    expect(orm.saved[0]!.basePrice).toBe(120)   // el espejo del tipo, no el precio de la temporada
  })

  it('el porcentaje del payload NO decide el precio global', async () => {
    // Antes esta misma fila guardaba 204 (120 × 1,70). Ahora el % de la grilla global es un espejo:
    // el hotel escribe pesos, no porcentajes.
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '', price: 200, percentage: 70 },
    ])
    expect(orm.saved[0]!.price).toBe(200)
  })

  it('el porcentaje que se guarda en la fila global es el que representa ese importe', async () => {
    // Espejo para los lectores que recomponen desde basePrice + percentage cuando `price` es 0
    // (shared/utils/rate-resolution.ts:ratePrice).
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '', price: 180 },
    ])
    expect(orm.saved[0]!.percentage).toBe(50)   // 180 = 120 × 1,50
  })

  it('una celda global sin importe cae al precio base del tipo', async () => {
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '' },
    ])
    expect(orm.saved[0]!.price).toBe(120)
  })

  // ── Capa CANAL: el porcentaje manda, sobre el precio de la temporada ────────
  it('el canal aplica su porcentaje sobre el PRECIO DE LA TEMPORADA, no sobre el base del tipo', async () => {
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '', price: 200 },
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: 'OpenChannel', percentage: 50 },
    ])
    expect(orm.saved.map((r) => r.price)).toEqual([200, 300])   // 300 = 200 × 1,50 — NO 180
    expect(orm.saved.map((r) => r.basePrice)).toEqual([120, 120])
  })

  it('el orden de las filas del payload no cambia el resultado del canal', async () => {
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: 'OpenChannel', percentage: 50 },
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '', price: 200 },
    ])
    expect(orm.saved.find((r) => r.channel === 'OpenChannel')!.price).toBe(300)
  })

  it('un porcentaje negativo del canal BAJA el precio de la temporada', async () => {
    const orm = makeOrm(200)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '', price: 200 },
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: 'OpenChannel', percentage: -25 },
    ])
    expect(orm.saved.find((r) => r.channel === 'OpenChannel')!.price).toBe(150)
  })

  it('un canal sobre una temporada que el hotel no cargó usa el precio base del tipo', async () => {
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: 'OpenChannel', percentage: 10 },
    ])
    expect(orm.saved[0]!.price).toBe(132)
  })

  it('una fila de un tipo que ya no existe conserva su base grabado', async () => {
    // Sigue siendo lo que la OTA vende: derivarla a 0 la publicaría gratis.
    const orm = makeOrm(120)
    await makeService(orm).updateRates('h1', [
      { roomType: 'fantasma', occupancy: 2, season: 'alta', channel: '', basePrice: 175, percentage: 0 },
    ])
    expect(orm.saved[0]!.basePrice).toBe(175)
  })

  it('los precios base del payload se escriben ANTES de derivar', async () => {
    // Si se aplicaran después, la fila guardaría el base viejo y el hotel vería el precio anterior
    // hasta volver a guardar.
    const orm = makeOrm(120)
    let roomPrice = 120
    const port = {
      setTypeBasePrice: async (_h: string, _t: string, price: unknown) => {
        roomPrice = Number(price)
        orm.findMany = (async (table: string, filter: any) => {
          if (table === 'Rooms') return [{ id: 'rm1', hotelId: 'h1', type: 'suite', capacity: 2, basePrice: roomPrice }]
          return makeOrm(roomPrice, orm.saved).findMany(table, filter)
        }) as any
        return 1
      },
    }
    const svc = makeService(orm, port)
    await svc.updateRates('h1', [
      { roomType: 'suite', occupancy: 2, season: 'alta', channel: '' },
    ], undefined, [{ roomType: 'suite', basePrice: 150 }])
    expect(roomPrice).toBe(150)
    expect(orm.saved[0]!.basePrice).toBe(150)
    expect(orm.saved[0]!.price).toBe(150)   // celda vacía → el base nuevo, no el viejo
  })
})
