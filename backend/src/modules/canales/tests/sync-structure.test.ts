// sync-structure.test.ts — Re-sincronizar NO puede romper el mapeo del canal.
//
// El sync borraba y recreaba todos los room types y rate plans de una property que ya existía.
// Como el mapeo de un canal referencia el UUID del rate plan, cada sync lo dejaba en cero con el
// canal todavía marcado "activo" — verificado contra staging el 2026-09-02 sobre la property de
// certificación (4 mapeos → 0 tras un `POST /api/channels/sync`). Es un veto para la
// certificación: el test 1 ES un full sync.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { planStructure, parseRoomTypes, parseRatePlans, optionsChanged } from '../usecases/sync-structure'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const log = silentLogger()

describe('planStructure', () => {
  const existing = [{ id: 'a', title: 'Twin Room' }, { id: 'b', title: 'Double Room' }]

  it('lo que ya está se actualiza en su lugar (mismo UUID)', () => {
    const plan = planStructure([{ title: 'Twin Room' }, { title: 'Double Room' }], existing)
    expect(plan.create).toHaveLength(0)
    expect(plan.remove).toHaveLength(0)
    expect(plan.update.map((u) => u.id).sort()).toEqual(['a', 'b'])
  })

  it('lo que falta se crea y lo que sobra se borra', () => {
    const plan = planStructure([{ title: 'Twin Room' }, { title: 'Suite' }], existing)
    expect(plan.update.map((u) => u.id)).toEqual(['a'])
    expect(plan.create.map((c) => c.title)).toEqual(['Suite'])
    expect(plan.remove.map((r) => r.id)).toEqual(['b'])
  })

  it('el título matchea sin importar mayúsculas ni espacios de más', () => {
    const plan = planStructure([{ title: '  twin room ' }], [{ id: 'a', title: 'Twin Room' }])
    expect(plan.update.map((u) => u.id)).toEqual(['a'])
    expect(plan.remove).toHaveLength(0)
  })

  it('un título duplicado en Channex resuelve al primero y manda el resto a borrar', () => {
    const plan = planStructure([{ title: 'Twin Room' }], [
      { id: 'a', title: 'Twin Room' }, { id: 'dup', title: 'Twin Room' },
    ])
    expect(plan.update.map((u) => u.id)).toEqual(['a'])
    expect(plan.remove.map((r) => r.id)).toEqual(['dup'])
  })
})

describe('parseRatePlans', () => {
  it('marca como derivadas las copias de canal (el flag vive en relationships, no en attributes)', () => {
    const parsed = parseRatePlans([
      { id: 'own', attributes: { title: 'Twin Room BAR', parent_rate_plan_id: null }, relationships: { room_type: { data: { id: 'rt' } } } },
      { id: 'copy', attributes: { title: 'Twin Room BAR - OpenChannel SolmiOS Open', parent_rate_plan_id: null }, relationships: { room_type: { data: { id: 'rt' } }, parent_rate_plan: { data: { id: 'own' } } } },
    ])
    expect(parsed.map((p) => [p.id, p.derived])).toEqual([['own', false], ['copy', true]])
  })

  it('el precio de las options vuelve en centavos', () => {
    const [rp] = parseRatePlans([{ id: 'x', attributes: { title: 'T', options: [{ occupancy: 2, rate: '120.00' }] } }])
    expect(rp!.options).toEqual([{ occupancy: 2, rate: 12000 }])
  })
})

describe('optionsChanged', () => {
  it('no toca las options si son las mismas (aunque vengan en otro orden)', () => {
    const desired = [{ occupancy: 1, rate: 10000 }, { occupancy: 2, rate: 10000 }]
    expect(optionsChanged([{ occupancy: 2, rate: 10000 }, { occupancy: 1, rate: 10000 }], desired)).toBe(false)
  })

  it('detecta cambio de precio y cambio de capacidad', () => {
    expect(optionsChanged([{ occupancy: 2, rate: 10000 }], [{ occupancy: 2, rate: 12000 }])).toBe(true)
    expect(optionsChanged([{ occupancy: 2, rate: 10000 }], [{ occupancy: 1, rate: 10000 }, { occupancy: 2, rate: 10000 }])).toBe(true)
  })
})

// ─── El sync completo sobre una property que ya existe ──────────────────────────────────────

interface Call { method: string; url: string; body: any }

/** Property con Twin+Double, sus 4 rate plans propios y 1 copia derivada de un canal mapeado. */
function installFetch(calls: Call[]) {
  const orig = globalThis.fetch
  const roomTypes = [
    { id: 'rt-twin', attributes: { title: 'Twin Room', count_of_rooms: 2 } },
    { id: 'rt-double', attributes: { title: 'Double Room', count_of_rooms: 2 } },
  ]
  const ratePlans = [
    { id: 'rp-twin-bar', attributes: { title: 'Twin Room BAR', room_type_id: 'rt-twin', options: [{ occupancy: 1, rate: '100.00' }, { occupancy: 2, rate: '100.00' }] } },
    { id: 'rp-twin-bb', attributes: { title: 'Twin Room Bed & Breakfast', room_type_id: 'rt-twin', options: [{ occupancy: 1, rate: '120.00' }, { occupancy: 2, rate: '120.00' }] } },
    { id: 'rp-double-bar', attributes: { title: 'Double Room BAR', room_type_id: 'rt-double', options: [{ occupancy: 1, rate: '100.00' }, { occupancy: 2, rate: '100.00' }] } },
    { id: 'rp-double-bb', attributes: { title: 'Double Room Bed & Breakfast', room_type_id: 'rt-double', options: [{ occupancy: 1, rate: '120.00' }, { occupancy: 2, rate: '120.00' }] } },
    { id: 'rp-derived', attributes: { title: 'Twin Room BAR - OpenChannel SolmiOS Open' }, relationships: { room_type: { data: { id: 'rt-twin' } }, parent_rate_plan: { data: { id: 'rp-twin-bar' } } } },
  ]
  globalThis.fetch = (async (url: string, opts: any) => {
    const u = String(url)
    const method = opts?.method || 'GET'
    calls.push({ method, url: u, body: opts?.body ? JSON.parse(opts.body) : undefined })
    const json = (d: any) => new Response(JSON.stringify(d), { status: 200 })
    if (method === 'GET' && u.includes('/room_types')) return json({ data: roomTypes, meta: { total: roomTypes.length } })
    if (method === 'GET' && u.includes('/rate_plans')) return json({ data: ratePlans, meta: { total: ratePlans.length } })
    return json({ data: { id: 'x' } })
  }) as any
  return () => { globalThis.fetch = orig }
}

const ROOMS = [
  { type: 'twin', basePrice: 100, capacity: 2, cnt: 2 },
  { type: 'double', basePrice: 100, capacity: 2, cnt: 2 },
]
const CFG = { id: 'c1', hotelId: 'h1', channexPropertyId: 'prop-1', syncEnabled: 1 } as any
const PLANS = [
  { code: 'bar', label: 'BAR', markupPct: 0, keywords: ['bar'] },
  { code: 'bb', label: 'Bed & Breakfast', markupPct: 20, keywords: ['breakfast'] },
]

let restore: (() => void) | undefined
beforeEach(() => resetChannexHttpForTests())
afterEach(() => { restore?.(); restore = undefined; resetChannexHttpForTests() })

describe('syncProperty sobre una property que ya existe', () => {
  it('no borra nada: actualiza en su lugar y deja intacta la copia derivada del canal', async () => {
    const calls: Call[] = []
    restore = installFetch(calls)
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)

    const { result } = await uc.syncProperty('h1', { name: 'Test Property - SolmiOS', currency: 'USD' }, ROOMS, CFG, PLANS as any)

    expect(result.success).toBe(true)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    // 2 room types + 4 rate plans propios, cada uno en su UUID.
    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts.map((c) => c.url.split('/api/v1')[1]).sort()).toEqual([
      '/rate_plans/rp-double-bar', '/rate_plans/rp-double-bb', '/rate_plans/rp-twin-bar', '/rate_plans/rp-twin-bb',
      '/room_types/rt-double', '/room_types/rt-twin',
    ])
    // La copia del canal no se toca ni para actualizarla.
    expect(puts.some((c) => c.url.includes('rp-derived'))).toBe(false)
    // Precios sin cambios → no se reescriben las options (de ellas cuelgan las del canal).
    expect(puts.filter((c) => c.url.includes('/rate_plans/')).every((c) => !c.body?.rate_plan?.options)).toBe(true)
  })

  it('si cambió el precio base, el update sí reescribe las options', async () => {
    const calls: Call[] = []
    restore = installFetch(calls)
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)

    await uc.syncProperty('h1', { name: 'Test', currency: 'USD' },
      ROOMS.map((r) => ({ ...r, basePrice: 150 })), CFG, PLANS as any)

    const bar = calls.find((c) => c.method === 'PUT' && c.url.includes('rp-twin-bar'))
    expect(bar?.body?.rate_plan?.options).toEqual([
      { occupancy: 1, is_primary: false, rate: 15000 },
      { occupancy: 2, is_primary: true, rate: 15000 },
    ])
  })

  it('un tipo que el hotel ya no tiene se borra', async () => {
    const calls: Call[] = []
    restore = installFetch(calls)
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)

    await uc.syncProperty('h1', { name: 'Test', currency: 'USD' }, [ROOMS[0]!], CFG, PLANS as any)

    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/api/v1')[1])
    expect(deletes).toContain('/room_types/rt-double')
    expect(deletes.some((d) => d!.includes('rp-derived'))).toBe(false)
  })
})

// ─── Reconectar un canal que ya existe ──────────────────────────────────────────────────────
//
// Channex rechaza el alta de un segundo canal del mismo tipo sobre la property ("Validation
// Error"), así que apretar "Conectar" otra vez —para reintentar, o para recuperar un mapeo que se
// había perdido— fallaba sin decir nada útil.

describe('createOTAChannel sobre una property que ya tiene ese canal', () => {
  it('re-mapea y reactiva el canal existente en vez de crear otro', async () => {
    const calls: Call[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      const method = opts?.method || 'GET'
      calls.push({ method, url: u, body: opts?.body ? JSON.parse(opts.body) : undefined })
      const json = (d: any) => new Response(JSON.stringify(d), { status: 200 })
      if (method === 'GET' && u.includes('/channels')) {
        return json({ data: [{ id: 'ch-1', attributes: { channel: 'OpenChannel', title: 'SolmiOS Open' } }], meta: { total: 1 } })
      }
      if (u.includes('check_readiness')) return json({ data: { attributes: { errors: [] } } })
      return json({ data: { id: 'ch-1' } })
    }) as any
    try {
      const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
      const res = await uc.createOTAChannel(CFG, {
        channel: 'OpenChannel', title: 'SolmiOS Open', groupId: 'g1', propertyId: 'prop-1',
        ratePlans: [{ ratePlanId: 'rp-twin-bar', roomTypeCode: 'twin', ratePlanCode: 'twin-bar', occupancy: 2, pricingType: 'per_person', primaryOcc: true }],
        settings: { endpoint: 'https://solmios.com/api/channels/open-ari/', api_key: 'k', hotel_code: 'h1' },
      } as any)

      expect(res.success).toBe(true)
      expect(res.channelId).toBe('ch-1')
      expect(res.steps).toMatchObject({ mapping: true, create: false, activate: true })
      expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/channels'))).toHaveLength(0)
      const remap = calls.find((c) => c.method === 'PUT' && c.url.includes('/channels/ch-1') && c.body?.channel?.rate_plans)
      expect(remap?.body.channel.rate_plans[0].settings.rate_plan_code).toBe('twin-bar')
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/channels/ch-1/activate'))).toBe(true)
    } finally { globalThis.fetch = orig; resetChannexHttpForTests() }
  })
})
