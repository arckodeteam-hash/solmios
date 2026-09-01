// channex-mapping.test.ts — P6: mapping persistente local↔Channex. Los pushes resuelven
// UUIDs por mapping SIN los 2 GETs por push (y sin el match frágil por título), y el sync
// persiste los mappings al crear la estructura.
import { describe, it, expect, afterEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { targetsFromMappings, type MappingEntry } from '../usecases/channex-mapping'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { DEFAULT_RATE_PLANS } from '../usecases/rate-plans'
import { silentLogger } from 'arckode-framework/testing'

const log = silentLogger()

describe('targetsFromMappings (pura)', () => {
  it('arma rtIdByTitle y rpsByRt con el label del plan como título', () => {
    const mappings: MappingEntry[] = [
      { kind: 'room_type', localId: 'Double', channexId: 'rt-1' },
      { kind: 'room_type', localId: 'Suite', channexId: 'rt-2' },
      { kind: 'rate_plan', localId: 'Double|BAR', channexId: 'rp-bar' },
      { kind: 'rate_plan', localId: 'Double|Bed & Breakfast', channexId: 'rp-bb' },
      { kind: 'rate_plan', localId: 'Huérfano|BAR', channexId: 'rp-x' },  // sin room type: se ignora
    ]
    const { rtIdByTitle, rpsByRt } = targetsFromMappings(mappings)
    expect(rtIdByTitle.get('double')).toBe('rt-1')
    expect(rtIdByTitle.get('suite')).toBe('rt-2')
    expect(rpsByRt.get('rt-1')!.map((r) => r.id).sort()).toEqual(['rp-bar', 'rp-bb'])
    expect(rpsByRt.has('rt-2')).toBe(false)   // suite sin planes
    expect(rpsByRt.size).toBe(1)              // el huérfano no entró
  })
})

describe('push con mappingStore (P6)', () => {
  let restore: () => void
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  it('resuelve UUIDs por mapping SIN ningún GET a /room_types ni /rate_plans', async () => {
    const captured: { restrictions?: any; gets: number } = { gets: 0 }
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      if (u.includes('/room_types') || u.includes('/rate_plans')) { captured.gets++; }
      if (u.includes('/restrictions')) { captured.restrictions = JSON.parse(opts.body); return new Response(JSON.stringify({ data: [] }), { status: 200 }) }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as any
    restore = () => { globalThis.fetch = orig }

    const store = {
      read: async () => [
        { kind: 'room_type', localId: 'Double', channexId: 'rt-mapped' },
        { kind: 'rate_plan', localId: 'Double|BAR', channexId: 'rp-bar-mapped' },
        { kind: 'rate_plan', localId: 'Double|Bed & Breakfast', channexId: 'rp-bb-mapped' },
      ] as MappingEntry[],
      upsert: async () => {},
    }
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any, store)
    const res = await uc.pushSeasonalRates({ hotelId: 'h1', channexPropertyId: 'p1', channexApiKey: 'k' } as any,
      [{ roomType: 'Double', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }],
      [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }], new Map(), 'per_room', DEFAULT_RATE_PLANS)

    expect(captured.gets).toBe(0)   // cero GETs: todo vino del mapping
    // 4 entries: la línea base de 500 días (BAR + B&B) y encima la temporada (BAR + B&B).
    expect(res.pushed).toBe(4)
    const rpIds = [...new Set(captured.restrictions!.values.map((v: any) => v.rate_plan_id))].sort()
    expect(rpIds).toEqual(['rp-bar-mapped', 'rp-bb-mapped'])
    const seasonIds = captured.restrictions!.values
      .filter((v: any) => v.date_from === '2099-06-01').map((v: any) => v.rate_plan_id).sort()
    expect(seasonIds).toEqual(['rp-bar-mapped', 'rp-bb-mapped'])
  })

  it('sin mappings persistidos cae al fallback GET + título (comportamiento viejo)', async () => {
    const captured: { gets: number } = { gets: 0 }
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      const u = String(url)
      const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/room_types') || u.includes('/rate_plans')) { captured.gets++; return json({ data: [{ id: 'rt-1', attributes: { title: 'Double', room_type_id: undefined } }] }) }
      return json({ data: [] })
    }) as any
    restore = () => { globalThis.fetch = orig }

    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any, { read: async () => [], upsert: async () => {} })
    await uc.pushSeasonalRates({ hotelId: 'h1', channexPropertyId: 'p1', channexApiKey: 'k' } as any,
      [{ roomType: 'Double', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }],
      [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }], new Map(), 'per_room', DEFAULT_RATE_PLANS)

    expect(captured.gets).toBe(2)   // volvió a los GETs
  })
})

describe('syncProperty persiste mappings (P6)', () => {
  it('tras crear la estructura guarda property + room types + rate plans', async () => {
    const saved: MappingEntry[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/rate_plans') && opts?.method === 'POST') return json({ data: { id: `rp-${JSON.parse(opts.body).rate_plan.title.split(' ').pop()?.toLowerCase()}` } })
      if (u.includes('/room_types') && opts?.method === 'POST') return json({ data: { id: 'rt-created', attributes: { title: 'Double' } } })
      if (u.includes('/rate_plans')) return json({ data: [
        { id: 'rp-bar', attributes: { title: 'Double BAR', room_type_id: 'rt-created' } },
        { id: 'rp-bb', attributes: { title: 'Double Bed & Breakfast', room_type_id: 'rt-created' } },
      ] })
      if (u.includes('/room_types')) return json({ data: [{ id: 'rt-created', attributes: { title: 'Double' } }] })
      return json({ data: [] })
    }) as any
    const restore = () => { globalThis.fetch = orig }
    try {
      const store = { read: async () => [] as MappingEntry[], upsert: async (_h: string, entries: MappingEntry[]) => { saved.push(...entries) } }
      const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any, store)
      await uc.syncProperty('h1', { name: 'H' }, [{ type: 'Double', cnt: 2, capacity: 2, basePrice: 100 }],
        { channexPropertyId: 'p1', channexApiKey: 'k' } as any, 'per_room', DEFAULT_RATE_PLANS)

      expect(saved.find((e) => e.kind === 'room_type')).toEqual({ kind: 'room_type', localId: 'Double', channexId: 'rt-created' })
      expect(saved.filter((e) => e.kind === 'rate_plan').map((e) => e.localId).sort())
        .toEqual(['Double|BAR', 'Double|Bed & Breakfast'])
    } finally { restore(); resetChannexHttpForTests() }
  })
})
