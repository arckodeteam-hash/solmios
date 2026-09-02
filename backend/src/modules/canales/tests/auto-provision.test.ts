// auto-provision.test.ts — Alta automática del hotel en el channel manager, y el GRUPO por hotel.
//
// Dos cosas que hacen al SaaS: que un hotel nuevo quede publicando sin que nadie apriete nada, y
// que cada hotel viva en su propio grupo dentro de la cuenta de plataforma (la property se creaba
// sin `group_id`, y la doc de Channex dice que entonces cae en el "Default User Group" — todos
// los hoteles en la misma bolsa).
import { describe, it, expect, afterEach } from 'bun:test'
import { autoProvisionChannex, type AutoProvisionDeps } from '../usecases/auto-provision'
import { summarizeRoomTypes } from '../usecases/sync-property'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { DEFAULT_RATE_PLANS } from '../usecases/rate-plans'
import { silentLogger } from 'arckode-framework/testing'

function makeDeps(over: Partial<AutoProvisionDeps> = {}) {
  const calls: string[] = []
  const deps: AutoProvisionDeps = {
    getConfig: async () => ({}),
    findMany: async () => [{ id: 'rm1', type: 'double' }],
    readMappings: async () => [{ kind: 'room_type', localId: 'double' }],
    hasPlatformKey: async () => true,
    isModuleEnabled: async () => true,
    sync: async (hotelId) => { calls.push(hotelId); return {} },
    logger: silentLogger() as any,
    ...over,
  }
  return { deps, calls }
}

describe('autoProvisionChannex — cuándo SÍ y cuándo NO se da de alta', () => {
  it('hotel nuevo con habitaciones: sincroniza', async () => {
    const { deps, calls } = makeDeps()
    expect(await autoProvisionChannex(deps, 'h1')).toBe('provisioned')
    expect(calls).toEqual(['h1'])
  })

  it('hotel YA sincronizado y sin tipos nuevos: no toca nada', async () => {
    const { deps, calls } = makeDeps({ getConfig: async () => ({ channexPropertyId: 'p1' }) })
    expect(await autoProvisionChannex(deps, 'h1')).toBe('already-synced')
    expect(calls).toEqual([])   // el catálogo no cambió: cargar más dobles no republica nada
  })

  // El hotel que carga su inventario en tandas: 4 dobles, y después 2 twin. Las twin quedaban
  // SIN publicar y sin venderse, con el panel diciendo "Conectado" (visto en producción).
  it('hotel YA sincronizado con un TIPO nuevo: re-publica la estructura', async () => {
    const { deps, calls } = makeDeps({
      getConfig: async () => ({ channexPropertyId: 'p1' }),
      findMany: async () => [{ id: 'rm1', type: 'double' }, { id: 'rm2', type: 'twin' }],
      readMappings: async () => [{ kind: 'room_type', localId: 'double' }],
    })
    expect(await autoProvisionChannex(deps, 'h1')).toBe('restructured')
    expect(calls).toEqual(['h1'])
  })

  it('property sin mapping (sincronizada antes de P6): no se re-sincroniza a ciegas', async () => {
    const { deps, calls } = makeDeps({
      getConfig: async () => ({ channexPropertyId: 'p1' }),
      findMany: async () => [{ id: 'rm1', type: 'double' }, { id: 'rm2', type: 'twin' }],
      readMappings: async () => [],
    })
    expect(await autoProvisionChannex(deps, 'h1')).toBe('already-synced')
    expect(calls).toEqual([])
  })

  it('sin habitaciones no crea una property vacía', async () => {
    const { deps, calls } = makeDeps({ findMany: async () => [] })
    expect(await autoProvisionChannex(deps, 'h1')).toBe('no-rooms')
    expect(calls).toEqual([])
  })

  it('sin credencial de plataforma no intenta', async () => {
    const { deps, calls } = makeDeps({ hasPlatformKey: async () => false })
    expect(await autoProvisionChannex(deps, 'h1')).toBe('no-platform-key')
    expect(calls).toEqual([])
  })

  it('si el plan del hotel no incluye el channel manager, no le crea property', async () => {
    const { deps, calls } = makeDeps({ isModuleEnabled: async () => false })
    expect(await autoProvisionChannex(deps, 'h1')).toBe('module-disabled')
    expect(calls).toEqual([])
  })

  it('un fallo del sync NO se propaga: cargar una habitación no puede romperse por Channex', async () => {
    const { deps } = makeDeps({ sync: async () => { throw new Error('Channex caído') } })
    expect(await autoProvisionChannex(deps, 'h1')).toBe('failed')
  })
})

describe('summarizeRoomTypes — las unidades físicas se agrupan en los tipos que vende Channex', () => {
  it('cuenta las unidades y toma capacidad MÁXIMA y precio MÍNIMO positivo del tipo', () => {
    const out = summarizeRoomTypes([
      { type: 'suite', capacity: 2, basePrice: 200 },
      { type: 'suite', capacity: 4, basePrice: 120 },
      { type: 'double', capacity: 2, basePrice: 110 },
    ])
    expect(out.find((r) => r.type === 'suite')).toEqual({ type: 'suite', cnt: 2, capacity: 4, basePrice: 120 })
    expect(out.find((r) => r.type === 'double')).toEqual({ type: 'double', cnt: 1, capacity: 2, basePrice: 110 })
  })

  it('ignora habitaciones sin tipo y un precio 0 no pisa a uno real', () => {
    const out = summarizeRoomTypes([
      { type: '', capacity: 2, basePrice: 50 },
      { type: 'double', capacity: 2, basePrice: 0 },
      { type: 'double', capacity: 2, basePrice: 110 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'double', cnt: 2, basePrice: 110 })
  })
})

describe('syncProperty — un GRUPO por hotel dentro de la cuenta de plataforma', () => {
  let restore: (() => void) | undefined
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  function installFetch(captured: { groups: any[]; properties: any[]; existingGroups?: any[] }) {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/groups') && opts?.method === 'POST') { captured.groups.push(JSON.parse(opts.body)); return json({ data: { id: 'grp-nuevo' } }) }
      if (u.includes('/groups')) return json({ data: captured.existingGroups ?? [] })
      if (u.includes('/properties') && opts?.method === 'POST') { captured.properties.push(JSON.parse(opts.body)); return json({ data: { id: 'prop-1' } }) }
      if (u.includes('/room_types') && opts?.method === 'POST') return json({ data: { id: 'rt-1', attributes: { title: 'Double' } } })
      if (u.includes('/rate_plans') && opts?.method === 'POST') return json({ data: { id: crypto.randomUUID() } })
      return json({ data: [] })
    }) as any
    return () => { globalThis.fetch = orig }
  }

  const uc = () => new ChannexUseCase(silentLogger() as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
  const ROOMS = [{ type: 'Double', cnt: 2, capacity: 2, basePrice: 100 }]

  it('hotel sin grupo: crea el grupo con su nombre y la property ADENTRO', async () => {
    const captured = { groups: [] as any[], properties: [] as any[] }
    restore = installFetch(captured)
    const res = await uc().syncProperty('h1', { name: 'Hotel Boutique Palma' }, ROOMS, undefined, DEFAULT_RATE_PLANS)

    expect(captured.groups).toEqual([{ group: { title: 'Hotel Boutique Palma' } }])
    expect(captured.properties[0].property.group_id).toBe('grp-nuevo')
    expect(res.newGroupId).toBe('grp-nuevo')   // el service lo persiste en channel_config
  })

  it('reusa un grupo existente con el mismo nombre en vez de acumular duplicados', async () => {
    const captured = { groups: [] as any[], properties: [] as any[], existingGroups: [{ id: 'grp-viejo', attributes: { title: 'Hotel Boutique Palma' } }] }
    restore = installFetch(captured)
    const res = await uc().syncProperty('h1', { name: 'Hotel Boutique Palma' }, ROOMS, undefined, DEFAULT_RATE_PLANS)

    expect(captured.groups).toEqual([])        // no creó ninguno
    expect(captured.properties[0].property.group_id).toBe('grp-viejo')
    expect(res.newGroupId).toBe('grp-viejo')
  })

  it('hotel que YA tiene grupo guardado: no vuelve a tocar /groups', async () => {
    const captured = { groups: [] as any[], properties: [] as any[] }
    restore = installFetch(captured)
    const res = await uc().syncProperty('h1', { name: 'H' }, ROOMS, { channexGroupId: 'grp-mio' } as any, DEFAULT_RATE_PLANS)

    expect(captured.groups).toEqual([])
    expect(captured.properties[0].property.group_id).toBe('grp-mio')
    expect(res.newGroupId).toBeNull()          // nada nuevo que persistir
  })
})
