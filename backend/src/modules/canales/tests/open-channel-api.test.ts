// canales/tests/open-channel-api.test.ts — Lado servidor de Open Channel (Channex).
//
// Bug que motivó esto: un hotel ya tenía un canal "Open Channel" configurado en Channex apuntando
// a /api/channels/open-ari, pero esa ruta no existía en el backend → 404 en cada llamada, canal
// nunca activo. Estos tests cubren la lógica de las 3 rutas que Channex llama (test_connection,
// mapping_details, changes) y la que genera/valida la clave por hotel.
import { describe, it, expect } from 'bun:test'
import {
  getOrCreateOpenChannelKey,
  verifyOpenChannelKey,
  buildMappingDetails,
  applyChanges,
  logOpenChannelCall,
  buildEndpointUrl,
} from '../usecases/open-channel-api'
import type { RepositoryAdapter } from 'arckode-framework'

function fakeCanalesRepo(rows: any[]): RepositoryAdapter<any> {
  return {
    findOne: async (filter: any) => rows.find((r) =>
      Object.entries(filter).every(([k, v]) => r[k] === v)) ?? null,
    create: async (row: any) => { rows.push(row); return row },
    update: async (id: string, patch: any) => {
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row
    },
  } as unknown as RepositoryAdapter<any>
}

function fakeSyncLogRepo(): { repo: RepositoryAdapter<any>; rows: any[] } {
  const rows: any[] = []
  const repo = {
    create: async (row: any) => { rows.push(row); return row },
  } as unknown as RepositoryAdapter<any>
  return { repo, rows }
}

describe('getOrCreateOpenChannelKey', () => {
  it('genera una clave nueva cuando el hotel no tiene channel_config', async () => {
    const canalesRepo = fakeCanalesRepo([])
    const key = await getOrCreateOpenChannelKey({ canalesRepo }, 'h1')
    expect(key).toBeTruthy()
    expect(typeof key).toBe('string')
  })

  it('devuelve SIEMPRE la misma clave en llamadas siguientes (idempotente)', async () => {
    const canalesRepo = fakeCanalesRepo([])
    const first = await getOrCreateOpenChannelKey({ canalesRepo }, 'h1')
    const second = await getOrCreateOpenChannelKey({ canalesRepo }, 'h1')
    expect(second).toBe(first)
  })

  it('no pisa otras claves ya guardadas en config (json) al agregar la propia', async () => {
    const canalesRepo = fakeCanalesRepo([
      { id: 'c1', hotelId: 'h1', config: { channexApiKeyNote: 'algo previo' } },
    ])
    await getOrCreateOpenChannelKey({ canalesRepo }, 'h1')
    const cfg = await canalesRepo.findOne({ hotelId: 'h1' } as any) as any
    expect(cfg.config.channexApiKeyNote).toBe('algo previo')
    expect(cfg.config.openChannelApiKey).toBeTruthy()
  })

  it('dos hoteles distintos reciben claves distintas', async () => {
    const canalesRepo = fakeCanalesRepo([])
    const k1 = await getOrCreateOpenChannelKey({ canalesRepo }, 'h1')
    const k2 = await getOrCreateOpenChannelKey({ canalesRepo }, 'h2')
    expect(k1).not.toBe(k2)
  })
})

describe('verifyOpenChannelKey', () => {
  it('true cuando la clave coincide', async () => {
    const canalesRepo = fakeCanalesRepo([{ id: 'c1', hotelId: 'h1', config: { openChannelApiKey: 'secreto123' } }])
    expect(await verifyOpenChannelKey({ canalesRepo }, 'h1', 'secreto123')).toBe(true)
  })

  it('false cuando la clave no coincide (no filtra si el hotel existe o no)', async () => {
    const canalesRepo = fakeCanalesRepo([{ id: 'c1', hotelId: 'h1', config: { openChannelApiKey: 'secreto123' } }])
    expect(await verifyOpenChannelKey({ canalesRepo }, 'h1', 'otra-clave')).toBe(false)
  })

  it('false sin hotelId o sin clave provista, sin explotar', async () => {
    const canalesRepo = fakeCanalesRepo([])
    expect(await verifyOpenChannelKey({ canalesRepo }, undefined, 'x')).toBe(false)
    expect(await verifyOpenChannelKey({ canalesRepo }, 'h1', undefined)).toBe(false)
  })

  it('false si el hotel no tiene ninguna config guardada', async () => {
    const canalesRepo = fakeCanalesRepo([])
    expect(await verifyOpenChannelKey({ canalesRepo }, 'h-inexistente', 'cualquiera')).toBe(false)
  })

  it('la clave de un hotel no sirve para otro (aislamiento)', async () => {
    const canalesRepo = fakeCanalesRepo([
      { id: 'c1', hotelId: 'h1', config: { openChannelApiKey: 'clave-de-h1' } },
      { id: 'c2', hotelId: 'h2', config: { openChannelApiKey: 'clave-de-h2' } },
    ])
    expect(await verifyOpenChannelKey({ canalesRepo }, 'h2', 'clave-de-h1')).toBe(false)
  })
})

describe('buildMappingDetails', () => {
  // Lo que se declara acá tiene que ser lo que el hotel VENDE. Antes se exponía un solo plan
  // "X Standard" en per_room: la mitad de los planes del hotel no tenía contraparte que mapear
  // (de ahí los canales con "Rate Plans Mapeados (0)") y Channex mandaba solo la ocupación máxima.
  it('arma un rate plan por cada (tipo × plan del hotel), en per_person', async () => {
    const findMany = async (model: string) => {
      if (model === 'Rooms') return [
        { type: 'double', capacity: 2 },
        { type: 'double', capacity: 2 },
        { type: 'suite', capacity: 4 },
      ]
      if (model === 'Hotels') return [{ id: 'h1', currency: 'USD' }]
      return []   // sin Configuration → planes por defecto: BAR + Bed & Breakfast
    }
    const result = await buildMappingDetails({ findMany }, 'h1')
    const types = result.data.attributes.room_types as any[]
    expect(types).toHaveLength(2)
    const double = types.find((t) => t.id === 'double')
    expect(double.title).toBe('Double')
    expect(double.rate_plans.map((p: any) => p.id)).toEqual(['double-bar', 'double-bb'])
    expect(double.rate_plans[0]).toMatchObject({
      id: 'double-bar', title: 'Double BAR', sell_mode: 'per_person', max_persons: 2, currency: 'USD', read_only: false,
    })
    expect(double.rate_plans[1].title).toBe('Double Bed & Breakfast')
  })

  it('usa la capacidad MÁXIMA encontrada entre habitaciones del mismo tipo', async () => {
    const findMany = async (model: string) => {
      if (model === 'Rooms') return [{ type: 'suite', capacity: 2 }, { type: 'suite', capacity: 6 }]
      if (model === 'Hotels') return [{ id: 'h1', currency: 'EUR' }]
      return []
    }
    const result = await buildMappingDetails({ findMany }, 'h1')
    const types = result.data.attributes.room_types as any[]
    expect(types[0].rate_plans[0].max_persons).toBe(6)
  })

  it('sin habitaciones: room_types vacío, no explota', async () => {
    const findMany = async () => []
    const result = await buildMappingDetails({ findMany }, 'h1')
    expect(result.data.attributes.room_types).toEqual([])
  })

  it('sin moneda configurada en el hotel: cae a USD', async () => {
    const findMany = async (model: string) => {
      if (model === 'Rooms') return [{ type: 'double', capacity: 2 }]
      return []
    }
    const result = await buildMappingDetails({ findMany }, 'h1')
    expect((result.data.attributes.room_types as any[])[0].rate_plans[0].currency).toBe('USD')
  })
})

describe('applyChanges', () => {
  it('registra cada cambio en sync_log y cuenta cuántos procesó', async () => {
    const { repo: syncLogRepo, rows } = fakeSyncLogRepo()
    const result = await applyChanges({ syncLogRepo }, 'h1', [
      { type: 'availability_changes', attributes: { room_type_id: 'double', availability: 5 } },
      { type: 'restriction_changes', attributes: { room_type_id: 'double', rates: [{ rate: '100.00' }] } },
    ])
    expect(result.recorded).toBe(2)
    expect(rows).toHaveLength(2)
    expect(rows[0].hotelId).toBe('h1')
    expect(rows[0].channel).toBe('open_channel')
    expect(rows[0].details.changeType).toBe('availability_changes')
    expect(rows[0].details.availability).toBe(5)
  })

  it('descarta entradas que no son objetos, sin explotar', async () => {
    const { repo: syncLogRepo, rows } = fakeSyncLogRepo()
    const result = await applyChanges({ syncLogRepo }, 'h1', [null, undefined, 'texto', 42] as any)
    expect(result.recorded).toBe(0)
    expect(rows).toHaveLength(0)
  })

  it('con lista vacía: 0 registrados, no falla', async () => {
    const { repo: syncLogRepo, rows } = fakeSyncLogRepo()
    const result = await applyChanges({ syncLogRepo }, 'h1', [])
    expect(result.recorded).toBe(0)
    expect(rows).toHaveLength(0)
  })
})

describe('logOpenChannelCall', () => {
  it('escribe la acción indicada para el hotel correcto', async () => {
    const { repo: syncLogRepo, rows } = fakeSyncLogRepo()
    await logOpenChannelCall({ syncLogRepo }, 'h1', 'open_channel_test')
    expect(rows[0]).toMatchObject({ hotelId: 'h1', channel: 'open_channel', action: 'open_channel_test', status: 'success' })
  })
})

describe('buildEndpointUrl', () => {
  it('arma la URL desde el host del request, sin hardcodear dominio', () => {
    const req = { headers: { host: 'hotel.zx89.site', 'x-forwarded-proto': 'https' } }
    expect(buildEndpointUrl(req)).toBe('https://hotel.zx89.site/api/channels/open-ari/')
  })

  it('cae a https si no viene x-forwarded-proto (caso típico detrás de nginx/Cloudflare)', () => {
    const req = { headers: { host: 'hotel.zx89.site' } }
    expect(buildEndpointUrl(req)).toBe('https://hotel.zx89.site/api/channels/open-ari/')
  })

  it('funciona con localhost para desarrollo', () => {
    const req = { headers: { host: 'localhost:3001', 'x-forwarded-proto': 'http' } }
    expect(buildEndpointUrl(req)).toBe('http://localhost:3001/api/channels/open-ari/')
  })

  it('prioriza cf-visitor sobre x-forwarded-proto (Cloudflare Flexible reenvía http al origen)', () => {
    const req = { headers: { host: 'hotel.zx89.site', 'x-forwarded-proto': 'http', 'cf-visitor': '{"scheme":"https"}' } }
    expect(buildEndpointUrl(req)).toBe('https://hotel.zx89.site/api/channels/open-ari/')
  })

  it('cf-visitor malformado no explota, cae a x-forwarded-proto', () => {
    const req = { headers: { host: 'hotel.zx89.site', 'x-forwarded-proto': 'https', 'cf-visitor': 'no-es-json' } }
    expect(buildEndpointUrl(req)).toBe('https://hotel.zx89.site/api/channels/open-ari/')
  })

  it('trailing slash SIEMPRE: Channex concatena {endpoint}test_connection/ sin insertar barra propia (#241, bug real 404 confirmado en logs)', () => {
    const req = { headers: { host: 'hotel.zx89.site', 'x-forwarded-proto': 'https' } }
    expect(buildEndpointUrl(req).endsWith('/')).toBe(true)
  })
})
