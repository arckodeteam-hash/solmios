import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { PricingService } from '../service'
import { PricingQueries } from '../usecases/pricing-queries'

const log = silentLogger()

function makeOrm(overrides: Partial<Record<string, any>> = {}) {
  return {
    findMany: async (table: string, _filter: any) => {
      if (table === 'Seasons') return [{ id: 's1', hotelId: 'h1', name: 'Summer', startDate: '2026-06-01', endDate: '2026-08-31', sortOrder: 0 }]
      if (table === 'RoomRates') return [{ id: 'r1', hotelId: 'h1', roomType: 'standard', season: 'Summer', occupancy: 2, basePrice: 100, price: 120 }]
      if (table === 'RoomBlocks') return []
      if (table === 'RateRestrictions') return []
      if (table === 'Reservations') return [{ id: 'res1', channel: 'booking', totalAmount: 200, checkIn: '2026-06-01', checkOut: '2026-06-03' }]
      if (table === 'Rooms') return [{ id: 'rm1', type: 'standard' }]
      return []
    },
    create: async (_table: string, data: any) => data,
    update: async (_table: string, _id: string, _data: any) => {},
    delete: async (_table: string, _id: string) => {},
    ...overrides,
  }
}

function makeRepo(orm: any, table: string) {
  return {
    findMany: async (filter: any) => orm.findMany(table, filter),
    findById: async (id: string) => orm.findById?.(table, id),
    findOne: async (filter: any) => { const rows = await orm.findMany(table, filter); return rows[0] || null },
    create: async (data: any) => orm.create(table, data),
    update: async (id: string, data: any) => orm.update(table, id, data),
    delete: async (id: string) => orm.delete(table, id),
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }
}

function makeService(ormOverride?: any) {
  const orm = ormOverride || makeOrm()
  const seasonsRepo = makeRepo(orm, 'Seasons')
  const ratesRepo = makeRepo(orm, 'RoomRates')
  const blocksRepo = makeRepo(orm, 'RoomBlocks')
  const restrictionsRepo = makeRepo(orm, 'RateRestrictions')
  const queries = new PricingQueries(orm)
  return new PricingService(seasonsRepo, ratesRepo, blocksRepo, restrictionsRepo, log, queries)
}

describe('PricingService', () => {
  describe('listSeasons', () => {
    it('returns seasons sorted by sortOrder', async () => {
      const svc = makeService()
      const result = await svc.listSeasons('h1')
      expect(result).toHaveLength(1)
    })
  })

  describe('listRates', () => {
    it('returns room rates', async () => {
      const svc = makeService()
      const result = await svc.listRates('h1')
      // La grilla abre una fila por ocupación 1..capacidad (capacidad default 2) × 1 temporada.
      expect(result).toHaveLength(2)
      expect(result.find((r: any) => r.id === 'r1')).toBeTruthy()   // la fila REAL, sin pisar
    })

    // Tarea 2 QA (2026-08-20): un hotel sin tarifas base guardadas todavía tiene que ver una
    // grilla derivada de sus room types (no una pantalla vacía) — mismo criterio "nunca vacío"
    // que ya usaba `listChannelRates` para las vistas por canal, ahora también para la base.
    it('sin tarifas base guardadas, deriva la grilla de los room types (nunca vacío)', async () => {
      const orm = makeOrm({
        findMany: async (table: string, _filter: any) => {
          if (table === 'RoomRates') return []
          if (table === 'Seasons') return [{ id: 's1', hotelId: 'h1', name: 'baja', sortOrder: 0 }]
          if (table === 'Rooms') return [
            { id: 'rm1', hotelId: 'h1', type: 'double', capacity: 2, basePrice: 100 },
            { id: 'rm2', hotelId: 'h1', type: 'suite', capacity: 4, basePrice: 200 },
          ]
          return []
        },
      })
      const svc = makeService(orm)
      const result = await svc.listRates('h1')
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((r: any) => r._inherited)).toBe(true)
      // Una fila por ocupación 1..capacidad de cada tipo (el hotel tarifa siempre por persona).
      const double = result.filter((r: any) => r.roomType === 'double')
      expect(double.map((r: any) => r.occupancy).sort()).toEqual([1, 2])
      expect(double.find((r: any) => r.occupancy === 2)).toMatchObject({ basePrice: 100, price: 100, channel: '' })
    })

    // Revisión post-implementación (2026-08-20): un tipo puede agrupar varias habitaciones
    // físicas con capacidad/basePrice distintos. Antes se quedaba con los valores de la
    // PRIMERA que apareciera en la query — con capacidad, esto subgeneraba filas de ocupación
    // (perdía la unidad más grande entera). Mismo criterio que el motor público
    // (`AvailabilityUseCase.aggregate`): capacidad MÁXIMA, precio MÍNIMO positivo.
    it('2 habitaciones del mismo tipo con capacidad/precio distintos: usa capacidad MÁXIMA y precio MÍNIMO', async () => {
      const orm = makeOrm({
        findMany: async (table: string, _filter: any) => {
          if (table === 'RoomRates') return []
          if (table === 'Seasons') return [{ id: 's1', hotelId: 'h1', name: 'baja', sortOrder: 0 }]
          if (table === 'Rooms') return [
            { id: 'rm1', hotelId: 'h1', type: 'familiar', capacity: 2, basePrice: 150 },
            { id: 'rm2', hotelId: 'h1', type: 'familiar', capacity: 4, basePrice: 120 },
          ]
          if (table === 'Configuration') return [{ id: 'c1', hotelId: 'h1', key: 'pricing_mode', value: { mode: 'per_person' } }]
          return []
        },
      })
      const svc = makeService(orm)
      const result = await svc.listRates('h1')
      const occupancies = [...new Set(result.map((r: any) => r.occupancy))].sort()
      // Capacidad máxima (4): genera las 4 filas, no solo las 2 de la primera habitación.
      expect(occupancies).toEqual([1, 2, 3, 4])
      // Precio mínimo positivo (120) entre las 2 unidades, no el de la primera que apareció (150).
      expect(result.every((r: any) => r.basePrice === 120)).toBe(true)
    })

    // Mismo caso que arriba con el ORDEN de las habitaciones invertido: la fila de mayor
    // capacidad/menor precio llega PRIMERO acá. El resultado tiene que ser idéntico — si no,
    // "capacidad máxima / precio mínimo" en realidad seguiría siendo "gana la última que
    // aparece", solo que ahora en la posición opuesta.
    it('mismo resultado sin importar el ORDEN en que la query devuelva las habitaciones', async () => {
      const orm = makeOrm({
        findMany: async (table: string, _filter: any) => {
          if (table === 'RoomRates') return []
          if (table === 'Seasons') return [{ id: 's1', hotelId: 'h1', name: 'baja', sortOrder: 0 }]
          if (table === 'Rooms') return [
            { id: 'rm2', hotelId: 'h1', type: 'familiar', capacity: 4, basePrice: 120 },
            { id: 'rm1', hotelId: 'h1', type: 'familiar', capacity: 2, basePrice: 150 },
          ]
          if (table === 'Configuration') return [{ id: 'c1', hotelId: 'h1', key: 'pricing_mode', value: { mode: 'per_person' } }]
          return []
        },
      })
      const svc = makeService(orm)
      const result = await svc.listRates('h1')
      const occupancies = [...new Set(result.map((r: any) => r.occupancy))].sort()
      expect(occupancies).toEqual([1, 2, 3, 4])
      expect(result.every((r: any) => r.basePrice === 120)).toBe(true)
    })

    it('en modo per_person, deriva UNA fila por ocupación 1..capacidad', async () => {
      const orm = makeOrm({
        findMany: async (table: string, _filter: any) => {
          if (table === 'RoomRates') return []
          if (table === 'Seasons') return [{ id: 's1', hotelId: 'h1', name: 'baja', sortOrder: 0 }]
          if (table === 'Rooms') return [{ id: 'rm1', hotelId: 'h1', type: 'suite', capacity: 3, basePrice: 200 }]
          if (table === 'Configuration') return [{ id: 'c1', hotelId: 'h1', key: 'pricing_mode', value: { mode: 'per_person' } }]
          return []
        },
      })
      const svc = makeService(orm)
      const result = await svc.listRates('h1')
      const occupancies = [...new Set(result.map((r: any) => r.occupancy))].sort()
      expect(occupancies).toEqual([1, 2, 3])
    })

    it('con tarifas base ya guardadas, NO las pisa con la grilla derivada', async () => {
      // makeOrm() default ya trae 1 fila real de RoomRates — debe devolverse tal cual (id, price
      // ya calculado), no la celda genérica derivada.
      const svc = makeService()
      const result = await svc.listRates('h1')
      const real = result.find((r: any) => r.id === 'r1')
      expect(real).toBeTruthy()
      expect(real).not.toHaveProperty('_inherited')
    })
  })

  describe('getChannelMetrics', () => {
    it('returns grouped metrics', async () => {
      const svc = makeService()
      const result = await svc.getChannelMetrics('h1')
      expect(result).toHaveLength(1)
      expect(result[0].channel).toBe('booking')
    })
  })

  // ─── Filter-aware ORM with in-memory store (for upsert/dedup tests) ───
  function makeRatesStoreOrm(initial: any[]) {
    const store: any[] = [...initial]
    const created: any[] = []
    const updated: any[] = []
    return {
      store, created, updated,
      orm: {
        findMany: async (_table: string, filter: any) => {
          if (!filter || _table !== 'RoomRates') return [...store]
          return store.filter((r) =>
            (filter.hotelId === undefined || r.hotelId === filter.hotelId) &&
            (filter.roomType === undefined || r.roomType === filter.roomType) &&
            (filter.occupancy === undefined || r.occupancy === filter.occupancy) &&
            (filter.season === undefined || r.season === filter.season),
          )
        },
        create: async (_table: string, data: any) => { store.push(data); created.push(data); return data },
        update: async (_table: string, id: string, data: any) => {
          const r = store.find((x) => x.id === id)
          if (r) Object.assign(r, data)
          updated.push({ id, data })
        },
        delete: async () => {},
      },
    }
  }

  function makeServiceFromOrm(orm: any) {
    const mk = (table: string) => ({
      findMany: async (filter: any) => orm.findMany(table, filter),
      findById: async () => null,
      findOne: async (filter: any) => { const rows = await orm.findMany(table, filter); return rows[0] || null },
      create: async (data: any) => orm.create(table, data),
      update: async (id: string, data: any) => orm.update(table, id, data),
      delete: async () => true,
      count: async () => 0,
      paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    })
    return new PricingService(mk('Seasons'), mk('RoomRates'), mk('RoomBlocks'), mk('RateRestrictions'), log)
  }

  describe('updateRates', () => {
    it('calculates price = basePrice * (1 + percentage/100) and updates existing', async () => {
      const { orm, updated } = makeRatesStoreOrm([
        { id: 'r1', hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'Summer', basePrice: 100, percentage: 0, price: 100, closed: 0 },
      ])
      const svc = makeServiceFromOrm(orm)
      const count = await svc.updateRates('h1', [
        { roomType: 'standard', occupancy: 2, season: 'Summer', basePrice: 100, percentage: 20, closed: false },
      ])
      expect(count).toBe(1)
      expect(updated).toHaveLength(1)
      expect(updated[0].id).toBe('r1')
      expect(updated[0].data.price).toBe(120)
      expect(updated[0].data.basePrice).toBe(100)
      expect(updated[0].data.percentage).toBe(20)
      expect(updated[0].data.closed).toBe(0)
    })

    it('creates a new rate when combination does not exist', async () => {
      const { orm, store, created } = makeRatesStoreOrm([])
      const svc = makeServiceFromOrm(orm)
      const count = await svc.updateRates('h1', [
        { roomType: 'suite', occupancy: 1, season: 'Winter', basePrice: 80, percentage: 0, closed: true },
      ])
      expect(count).toBe(1)
      expect(created).toHaveLength(1)
      const created0 = created[0]
      expect(created0.roomType).toBe('suite')
      expect(created0.season).toBe('Winter')
      expect(created0.price).toBe(80)
      expect(created0.closed).toBe(1)
      expect(store.find((r) => r.roomType === 'suite' && r.season === 'Winter')).toBeTruthy()
    })

    it('skips rates missing roomType/season/occupancy', async () => {
      const { orm } = makeRatesStoreOrm([])
      const svc = makeServiceFromOrm(orm)
      const count = await svc.updateRates('h1', [
        { occupancy: 2, season: 'Summer', basePrice: 100, percentage: 0 } as any, // missing roomType
      ])
      expect(count).toBe(0)
    })
  })

  describe('copyRatesNextYear', () => {
    it('copies rates to next year when target does not exist', async () => {
      const nextYear = new Date().getFullYear() + 1
      const { orm, store } = makeRatesStoreOrm([
        { id: 'r1', hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'Summer2026', basePrice: 100, percentage: 0, price: 100 },
      ])
      const svc = makeServiceFromOrm(orm)
      const result = await svc.copyRatesNextYear('h1')
      expect(result.total).toBe(1)
      expect(result.copied).toBe(1)
      expect(store.find((r) => r.season === `Summer${nextYear}`)).toBeTruthy()
    })

    it('skips when target year already exists (no duplicate)', async () => {
      const nextYear = new Date().getFullYear() + 1
      const { orm, store } = makeRatesStoreOrm([
        { id: 'r1', hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'Summer2026', basePrice: 100, percentage: 0, price: 100 },
        { id: 'r2', hotelId: 'h1', roomType: 'standard', occupancy: 2, season: `Summer${nextYear}`, basePrice: 100, percentage: 0, price: 100 },
      ])
      const svc = makeServiceFromOrm(orm)
      const result = await svc.copyRatesNextYear('h1')
      expect(result.total).toBe(2)
      expect(result.copied).toBe(0)
      expect(store.filter((r) => r.season === `Summer${nextYear}`)).toHaveLength(1)
    })
  })
})

// SEC-2.2 — regresión IDOR: deleteBlock solo borra bloqueos del hotel del token.
describe('PricingService — tenancy (SEC-2.2)', () => {
  function ormWithBlock(blockHotelId: string) {
    let deleted = false
    const orm: any = {
      ...makeOrm(),
      findById: async (table: string, id: string) =>
        table === 'RoomBlocks' && id === 'b1' ? { id: 'b1', hotelId: blockHotelId } : null,
      delete: async (_table: string, _id: string) => { deleted = true },
    }
    return { orm, wasDeleted: () => deleted }
  }

  it('borra el bloqueo si es del hotel del token', async () => {
    const { orm, wasDeleted } = ormWithBlock('h1')
    await makeService(orm).deleteBlock('b1', 'h1')
    expect(wasDeleted()).toBe(true)
  })

  it('NO borra un bloqueo de otro hotel (lanza)', async () => {
    const { orm, wasDeleted } = ormWithBlock('h2')
    await expect(makeService(orm).deleteBlock('b1', 'h1')).rejects.toThrow()
    expect(wasDeleted()).toBe(false)
  })

  describe('temporada activa (#148)', () => {
    function seasonsSvc() {
      const store: any[] = []
      const orm = {
        findMany: async (table: string, filter: any) =>
          table === 'Seasons' ? store.filter((s) => !filter?.hotelId || s.hotelId === filter.hotelId) : [],
        create: async (_t: string, data: any) => { store.push({ ...data }); return data },
        update: async (_t: string, id: string, data: any) => { const r = store.find((s) => s.id === id); if (r) Object.assign(r, data) },
        delete: async (_t: string, id: string) => { const i = store.findIndex((s) => s.id === id); if (i >= 0) store.splice(i, 1) },
      }
      const mk = (table: string) => ({
        findMany: async (f: any) => orm.findMany(table, f),
        findById: async () => null,
        findOne: async (f: any) => { const rows = await orm.findMany(table, f); return rows[0] || null },
        create: async (d: any) => orm.create(table, d),
        update: async (id: string, d: any) => orm.update(table, id, d),
        delete: async (id: string) => orm.delete(table, id),
        count: async () => 0,
        paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
      })
      return new PricingService(mk('Seasons') as any, mk('RoomRates') as any, mk('RoomBlocks') as any, mk('RateRestrictions') as any, log)
    }

    it('siembra temporadas por defecto con exactamente una activa', async () => {
      const svc = seasonsSvc()
      const seasons = await svc.listSeasons('h1')
      expect(seasons.length).toBeGreaterThanOrEqual(3)
      expect(seasons.filter((s: any) => s.active).length).toBe(1)
    })

    it('activateSeason deja activa solo la elegida', async () => {
      const svc = seasonsSvc()
      await svc.listSeasons('h1')
      const result = await svc.activateSeason('h1', 'media')
      const active = result.filter((s: any) => s.active)
      expect(active).toHaveLength(1)
      expect(active[0].name).toBe('media')
    })

    it('activateSeason lanza si la temporada no existe', async () => {
      const svc = seasonsSvc()
      await svc.listSeasons('h1')
      await expect(svc.activateSeason('h1', 'inexistente')).rejects.toThrow()
    })
  })

  describe('updateRates → onRatesUpdated (push a OTAs)', () => {
    it('emite onRatesUpdated con el hotelId cuando una tarifa cambia', async () => {
      const svc = makeService()
      let emitted: { hotelId: string; count: number } | null = null
      svc.setSockets({ onRatesUpdated: async (hotelId, count) => { emitted = { hotelId, count } } })
      // La tarifa existente (r1) tiene price 120; basePrice 100 + 0% → price 100 ≠ 120 → cambió.
      await svc.updateRates('h1', [{ roomType: 'standard', season: 'Summer', occupancy: 2, basePrice: 100, percentage: 0 }])
      expect(emitted).not.toBeNull()
      expect(emitted!.hotelId).toBe('h1')
    })

    it('NO emite si ninguna tarifa cambió', async () => {
      // El grid manda todas las celdas; si el precio computado coincide con el guardado, no hay cambio.
      const svc = makeService()
      let calls = 0
      svc.setSockets({ onRatesUpdated: async () => { calls++ } })
      // basePrice 100 + 20% → price 120 == existing.price 120 → sin cambio.
      await svc.updateRates('h1', [{ roomType: 'standard', season: 'Summer', occupancy: 2, basePrice: 100, percentage: 20 }])
      expect(calls).toBe(0)
    })

    // Bug "cambiar el precio en el editor de un canal y no pasa nada": el guardado con override
    // de canal persistía, pero el push automático iba SIN canal → solo publicaba la base. El
    // evento ahora lleva los canales tocados para que el connector publique el override.
    it('emite con los canales cuando el guardado trae override de canal', async () => {
      const svc = makeService()
      let emitted: { hotelId: string; channels?: string[] } | null = null
      svc.setSockets({ onRatesUpdated: async (hotelId, _count, channels) => { emitted = { hotelId, channels } } })
      await svc.updateRates('h1', [{ roomType: 'standard', season: 'Summer', occupancy: 2, basePrice: 110, percentage: 0, channel: 'OpenChannel' }])
      expect(emitted).not.toBeNull()
      expect(emitted!.channels).toEqual(['OpenChannel'])
    })

    it('emite con lista vacía de canales cuando el guardado es solo base', async () => {
      const svc = makeService()
      let emitted: { channels?: string[] } | null = null
      svc.setSockets({ onRatesUpdated: async (_hotelId, _count, channels) => { emitted = { channels } } })
      await svc.updateRates('h1', [{ roomType: 'standard', season: 'Summer', occupancy: 2, basePrice: 100, percentage: 0 }])
      expect(emitted).not.toBeNull()
      expect(emitted!.channels).toEqual([])
    })
  })

  describe('updateRateRestrictions (P4 — CTA/CTD/through)', () => {
    it('persiste minStayThrough y emite onRateRestrictionsUpdated para el push', async () => {
      const saved: any[] = []
      const orm = makeOrm({
        findMany: async (table: string) => (table === 'RateRestrictions' ? [] : []),
        update: async () => {},
      })
      const repo = { findMany: async () => [], update: async (_id: string, d: any) => { saved.push(d) }, create: async (d: any) => { saved.push(d) }, findById: async () => null, findOne: async () => null, delete: async () => true, count: async () => 0, paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }) }
      const svc = new PricingService(makeRepo(orm, 'Seasons'), makeRepo(orm, 'RoomRates'), makeRepo(orm, 'RoomBlocks'), repo as any, log, new PricingQueries(orm))
      let emitted = 0
      svc.setSockets({ onRateRestrictionsUpdated: async () => { emitted++ } })

      await svc.updateRateRestrictions('h1', [{ roomType: 'double', season: 'media', closedToArrival: 1, minStayThrough: 3 }])

      expect(saved).toHaveLength(1)
      expect(saved[0].minStayThrough).toBe(3)
      expect(saved[0].closedToArrival).toBe(1)
      expect(emitted).toBe(1)
    })
  })
})
