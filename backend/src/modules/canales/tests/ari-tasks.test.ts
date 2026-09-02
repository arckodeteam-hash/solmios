// ari-tasks.test.ts — El rastro de los ARI updates: los task ids que devuelve Channex quedan
// asentados en sync_log, un push rechazado no pasa como exitoso, y el historial del panel los
// muestra. Es lo que la certificación PMS pide entregar por cada uno de los tests 1 a 10.
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { extractTaskIds, buildAriTrailRow, withAriTrail } from '../usecases/ari-tasks'
import { getSyncLog, formatSyncDetails, syncTaskIds } from '../usecases/sync-log'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const CFG = { id: 'cfg-1', hotelId: 'h1', channexPropertyId: 'prop-1', channexApiKey: 'key-1' } as any
const log = silentLogger()
const RANGES = [{ dateFrom: '2099-11-01', dateTo: '2099-11-03', availability: 2 }]

/** Respuesta real de Channex a un ARI update: crea una tarea por llamada. */
const TASK_RESPONSE = { data: [{ id: 'task-uuid-1', type: 'task' }], meta: { message: 'Success' } }

function installFetch(onAri: (body: any) => Response) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, opts: any) => {
    const u = String(url)
    const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
    if (u.includes('/room_types') && opts?.method !== 'POST') return json({ data: [{ id: 'rt-twin', attributes: { title: 'Twin Room' } }] })
    if (u.includes('/rate_plans') && opts?.method !== 'POST') return json({ data: [{ id: 'rp-bar', attributes: { room_type_id: 'rt-twin', title: 'Twin Room Best Available Rate' } }] })
    if ((u.includes('/availability') || u.includes('/restrictions')) && opts?.method === 'POST') return onAri(JSON.parse(opts.body))
    return json({ data: [] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(log as any, async () => ({ apiKey: 'key-1', environment: 'staging' }) as any)
let restore: (() => void) | undefined
beforeEach(() => resetChannexHttpForTests())
afterEach(() => { restore?.(); restore = undefined; resetChannexHttpForTests() })

describe('extractTaskIds', () => {
  it('lee los ids de la lista de tareas que devuelve Channex', () => {
    expect(extractTaskIds(TASK_RESPONSE)).toEqual(['task-uuid-1'])
  })
  it('tolera tarea suelta, body vacío y formas inesperadas sin romper', () => {
    expect(extractTaskIds({ data: { id: 't1', type: 'task' } })).toEqual(['t1'])
    expect(extractTaskIds({ meta: { message: 'Success' } })).toEqual([])
    expect(extractTaskIds(null)).toEqual([])
    expect(extractTaskIds({ data: [{ type: 'task' }] })).toEqual([])
  })
})

describe('buildAriTrailRow', () => {
  const now = () => '2026-09-01T10:00:00.000Z'
  const id = () => 'row-1'

  it('arma la fila con task ids, entradas y llamadas', () => {
    const row = buildAriTrailRow('h1', 'push_rates', { taskIds: ['t1'], values: 8, calls: 1 }, now, id)
    expect(row).toEqual({
      id: 'row-1', hotelId: 'h1', channel: 'channex', action: 'push_rates', status: 'success',
      details: { taskIds: ['t1'], entries: 8, calls: 1 }, createdAt: '2026-09-01T10:00:00.000Z',
    })
  })

  it('un push fallido queda como error con el motivo', () => {
    const row = buildAriTrailRow('h1', 'push_availability', { error: 'Channex rechazó la disponibilidad: 422' }, now, id)
    expect(row?.status).toBe('error')
    expect(String(row?.details.error)).toContain('422')
  })

  it('un push que no mandó nada NO ensucia el historial', () => {
    expect(buildAriTrailRow('h1', 'push_availability', { taskIds: [], calls: 0 }, now, id)).toBeNull()
  })
})

describe('withAriTrail', () => {
  it('asienta el rastro y devuelve el resultado tal cual', async () => {
    const rows: any[] = []
    const res = await withAriTrail({ create: async (r) => rows.push(r) }, 'h1', 'push_rates',
      async () => ({ pushed: 3, taskIds: ['t9'] }), (r) => ({ taskIds: r.taskIds, values: r.pushed, calls: 1 }))
    expect(res.pushed).toBe(3)
    expect(rows).toHaveLength(1)
    expect(rows[0].details.taskIds).toEqual(['t9'])
  })

  it('un push que explota deja la fila de error y RE-LANZA', async () => {
    const rows: any[] = []
    const run = withAriTrail({ create: async (r) => rows.push(r) }, 'h1', 'push_availability',
      async () => { throw new Error('Channex rechazó la disponibilidad: 422') }, () => ({}))
    await expect(run).rejects.toThrow('422')
    expect(rows[0].status).toBe('error')
  })

  it('si el repo de auditoría falla, el push sigue siendo exitoso', async () => {
    const res = await withAriTrail({ create: async () => { throw new Error('db caída') } }, 'h1', 'push_rates',
      async () => ({ pushed: 1, taskIds: ['t1'] }), (r) => ({ taskIds: r.taskIds, values: r.pushed }))
    expect(res.pushed).toBe(1)
  })
})

describe('pushes ARI de Channex', () => {
  it('pushAvailability devuelve los task ids de la respuesta', async () => {
    restore = installFetch(() => new Response(JSON.stringify(TASK_RESPONSE), { status: 200 }))
    const res = await uc().pushAvailability(CFG, 'Twin Room', RANGES)
    expect(res).toEqual({ pushed: true, taskIds: ['task-uuid-1'] })
  })

  it('un 422 de availability YA NO pasa como éxito', async () => {
    restore = installFetch(() => new Response(JSON.stringify({ errors: { details: 'invalid date range' } }), { status: 422 }))
    await expect(uc().pushAvailability(CFG, 'Twin Room', RANGES)).rejects.toThrow('Channex rechazó la disponibilidad')
  })

  it('pushAllAvailability devuelve los task ids del consolidado', async () => {
    restore = installFetch(() => new Response(JSON.stringify(TASK_RESPONSE), { status: 200 }))
    const res = await uc().pushAllAvailability(CFG, [{ roomType: 'Twin Room', ranges: RANGES }])
    expect(res.taskIds).toEqual(['task-uuid-1'])
  })

  it('pushRateOverrides devuelve los task ids de la única llamada', async () => {
    restore = installFetch(() => new Response(JSON.stringify(TASK_RESPONSE), { status: 200 }))
    const res = await uc().pushRateOverrides(CFG, [
      { roomType: 'Twin Room', ratePlan: 'bar', dateFrom: '2099-11-22', dateTo: '2099-11-22', rate: 333 },
    ])
    expect(res).toMatchObject({ pushed: 1, calls: 1, taskIds: ['task-uuid-1'] })
  })
})

describe('historial del panel', () => {
  it('muestra las tareas con nombre legible y las devuelve sueltas para copiar', async () => {
    const repo = {
      findMany: async () => [{
        id: 'r1', hotelId: 'h1', channel: 'channex', action: 'push_rate_overrides', status: 'success',
        details: JSON.stringify({ taskIds: ['t1', 't2'], entries: 3, calls: 1 }), createdAt: '2026-09-01T10:00:00.000Z',
      }],
    }
    const [row] = await getSyncLog(repo, 'h1')
    expect(row.action).toBe('Tarifas por fecha enviadas')
    expect(row.details).toBe('tareas: t1, t2 · entradas: 3 · llamadas: 1')
    expect(row.taskIds).toEqual(['t1', 't2'])
  })

  it('formatSyncDetails omite las listas vacías y syncTaskIds tolera details sin tareas', () => {
    expect(formatSyncDetails({ taskIds: [], entries: 2 })).toBe('entradas: 2')
    expect(syncTaskIds({ entries: 2 })).toEqual([])
    expect(syncTaskIds('no-json')).toEqual([])
  })
})
