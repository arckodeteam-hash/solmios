// full-sync.test.ts — Test 1 de la certificación PMS de Channex: el full sync manda el ARI
// completo en EXACTAMENTE 2 llamadas (1 availability consolidado de 500 días con reservas
// descontadas + 1 restrictions consolidado por temporada), y el sync de estructura (property,
// room types, rate plans) NO pushea ARI por su cuenta.
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { pushAllRoomTypesAvailability } from '../usecases/availability'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { CanalesService } from '../service'
import { CanalesQueries } from '../usecases/canales-queries'
import { silentLogger } from 'arckode-framework/testing'
import type { CacheAdapter, Auth } from 'arckode-framework'

const CFG = { id: 'cfg-1', channexPropertyId: 'prop-1', channexApiKey: 'key-1' } as any
const log = silentLogger()
const MS_DAY = 86_400_000
// Fecha relativa (dentro del horizonte de 500 días desde cualquier "hoy" del test).
const rel = (days: number) => new Date(Date.now() + days * MS_DAY).toISOString().slice(0, 10)

interface HttpLog { availability: any[]; restrictions: any[] }

function installFetch(captured: HttpLog) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, opts: any) => {
    const u = String(url)
    const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.includes('/room_types') && opts?.method !== 'POST') return json({ data: [{ id: 'rt-double', attributes: { title: 'Double' } }, { id: 'rt-suite', attributes: { title: 'Suite' } }] })
    if (u.includes('/rate_plans') && opts?.method !== 'POST') return json({ data: [{ id: 'rp-double', attributes: { room_type_id: 'rt-double' } }, { id: 'rp-suite', attributes: { room_type_id: 'rt-suite' } }] })
    if (u.includes('/availability') && opts?.method === 'POST') { captured.availability.push(JSON.parse(opts.body)); return json({ data: [] }) }
    if (u.includes('/restrictions') && opts?.method === 'POST') { captured.restrictions.push(JSON.parse(opts.body)); return json({ data: [] }) }
    return json({ data: [] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(log as any, async () => ({ apiKey: 'key-1', environment: 'staging' }) as any)
let restore: () => void
// bun corre TODOS los archivos de test en un mismo proceso: el budget del limiter lo
// comparte todo el run. Reset antes (herencia de archivos previos) y después (cortesía).
beforeEach(() => resetChannexHttpForTests())
afterEach(() => { restore?.(); resetChannexHttpForTests() })

describe('Test 1 — sync de estructura NO pushea ARI', () => {
  it('syncProperty crea room types/rate plans sin POST de availability ni restrictions', async () => {
    const captured: HttpLog = { availability: [], restrictions: [] }
    restore = installFetch(captured)
    await uc().syncProperty('h1', { name: 'H1' }, [{ type: 'Double', cnt: 2, capacity: 2, basePrice: 100 }], CFG, 'per_room')
    expect(captured.availability).toHaveLength(0)   // el ARI lo manda el service en 2 llamadas
    expect(captured.restrictions).toHaveLength(0)
  })
})

describe('Test 1 — availability consolidado (500 días, reservas descontadas)', () => {
  it('pushAllRoomTypesAvailability arma todos los tipos del hotel y sale en 1 llamada', async () => {
    const captured: HttpLog = { availability: [], restrictions: [] }
    restore = installFetch(captured)
    const deps = {
      findMany: async (model: string, _q: any) => {
        if (model === 'Rooms') return [
          { id: 'rm1', type: 'double' },
          { id: 'rm2', type: 'double' },
          { id: 'rm3', type: 'suite' },
        ]
        if (model === 'Reservations') return [{ roomId: 'rm1', status: 'confirmed', checkIn: rel(10), checkOut: rel(12) }]
        return [] // RoomBlocks
      },
      getConfig: async () => CFG,
      pushToChannex: async () => ({ pushed: true }) as any,
      pushAllToChannex: async (_c: any, list: any[]) => {
        // Delegación real al usecase Channex: así verificamos el POST consolidado de verdad.
        const res = await uc().pushAllAvailability(CFG, list)
        return res
      },
    }
    const res = await pushAllRoomTypesAvailability(deps as any, 'h1')
    expect(res.pushed).toBeGreaterThan(0)
    expect(captured.availability).toHaveLength(1)              // UNA sola llamada
    const values = captured.availability[0].values
    const rtIds = [...new Set(values.map((v: any) => v.room_type_id))]
    expect(rtIds.sort()).toEqual(['rt-double', 'rt-suite'])    // todos los room types
    // La reserva de rm1 baja la disponibilidad del double en su rango: valores VARIADOS.
    const doubleValues = values.filter((v: any) => v.room_type_id === 'rt-double')
    expect(new Set(doubleValues.map((v: any) => v.availability)).size).toBeGreaterThan(1)
    // Horizonte 500 días: el último rango llega a ~+500d desde hoy.
    const maxTo = values.reduce((m: string, v: any) => (v.date_to > m ? v.date_to : m), '0')
    expect(Date.parse(maxTo)).toBeGreaterThan(Date.now() + 480 * MS_DAY)
  })

  it('pushAllAvailability omite tipos sin counterpart en Channex sin romper la llamada', async () => {
    const captured: HttpLog = { availability: [], restrictions: [] }
    restore = installFetch(captured)
    const res = await uc().pushAllAvailability(CFG, [
      { roomType: 'Double', ranges: [{ dateFrom: rel(0), dateTo: rel(5), availability: 2 }] },
      { roomType: 'Inexistente', ranges: [{ dateFrom: rel(0), dateTo: rel(5), availability: 9 }] },
    ])
    expect(res.pushed).toBe(1)                                  // solo el tipo que existe
    expect(captured.availability[0].values).toHaveLength(1)
    expect(captured.availability[0].values[0].room_type_id).toBe('rt-double')
  })
})

describe('Test 1 — service.syncProperty: el ARI completo sale en exactamente 2 llamadas', () => {
  it('tras sincronizar estructura, dispara 1 availability + 1 restrictions consolidados', async () => {
    const captured: HttpLog = { availability: [], restrictions: [] }
    restore = installFetch(captured)

    const repo: any = {
      findMany: async () => [],
      findById: async () => null,
      findOne: async () => CFG,
      create: async (d: any) => ({ id: 'new', ...d }),
      update: async (_id: string, d: any) => d,
      delete: async () => true,
      count: async () => 0,
      paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    }
    const queries = new CanalesQueries({
      findMany: async (model: string, _q: any) => {
        if (model === 'Rooms') return [{ id: 'rm1', type: 'Double', capacity: 2, basePrice: 100 }, { id: 'rm2', type: 'Suite', capacity: 4, basePrice: 200 }]
        if (model === 'Reservations') return []
        if (model === 'RoomBlocks') return []
        if (model === 'RoomRates') return [
          { roomType: 'Double', season: 'media', occupancy: 2, channel: '', basePrice: 100, percentage: 10, closed: 0 },
          { roomType: 'Suite', season: 'media', occupancy: 4, channel: '', basePrice: 200, percentage: 0, closed: 0 },
        ]
        if (model === 'Seasons') return [{ name: 'media', label: 'Media', startDate: rel(5), endDate: rel(60) }]
        if (model === 'SeasonAssignments') return []
        return []
      },
      findById: async () => null,
      create: async (d: any) => d,
      update: async () => {},
    })
    const service = new CanalesService(repo, {} as any, log, { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as CacheAdapter, {} as unknown as Auth, queries)
    await service.syncProperty('h1', { name: 'H1' }, [{ type: 'Double', cnt: 2, capacity: 2, basePrice: 100 }, { type: 'Suite', cnt: 1, capacity: 4, basePrice: 200 }])

    expect(captured.availability).toHaveLength(1)               // llamada ARI 1
    expect(captured.restrictions).toHaveLength(1)               // llamada ARI 2
    const rtIds = [...new Set(captured.availability[0].values.map((v: any) => v.room_type_id))]
    expect(rtIds.sort()).toEqual(['rt-double', 'rt-suite'])
    const rpIds = [...new Set(captured.restrictions[0].values.map((v: any) => v.rate_plan_id))]
    expect(rpIds.sort()).toEqual(['rp-double', 'rp-suite'])
    // Valores variados: el Double lleva el % de la temporada (110), el Suite queda plano (200→20000).
    const byRp = Object.fromEntries(captured.restrictions[0].values.map((v: any) => [v.rate_plan_id, v.rate]))
    expect(byRp['rp-double']).toBe(11000)
    expect(byRp['rp-suite']).toBe(20000)
  })
})
