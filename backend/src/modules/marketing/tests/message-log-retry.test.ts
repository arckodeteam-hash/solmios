// marketing/tests/message-log-retry.test.ts — Reintento manual del aviso de habitación (#338, CA19).
//
// POST /api/message-logs/:id/retry no reenvía nada: escribe un MARCADOR `retry_requested` con la
// misma clave de dedup (`auto:room_info:<huella>`) y el mismo canal. `roomInfoSendState` (shared)
// cuenta sólo los failed posteriores al marcador → el cron reenvía en el próximo tick. Acá se
// clava el contrato del service (qué fila se persiste, 404/409) y del controller (hotelId del token).

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { NotFoundError, ConflictError } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { MarketingService } from '../service'
import { MarketingController } from '../controller'
import { ROOM_INFO_RETRY_STATUS, roomInfoDedupKey, roomInfoSendState } from '../../../shared/usecases/room-info-notice'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

function makeRepo(overrides: Partial<RepositoryAdapter<any>> = {}): RepositoryAdapter<any> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (data) => ({ id: 'test-id', ...data }),
    update: async (id, data) => ({ id, ...data }),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

const DEDUP = roomInfoDedupKey('abc123')

const failedLog = (over: Record<string, unknown> = {}) => ({
  id: 'log-1', hotelId: 'h1', reservationId: 'r1', guestId: 'g1', messageId: null,
  messageType: 'whatsapp', channel: 'whatsapp_api', status: 'failed', recipient: '+5491111111111',
  response: DEDUP, sentAt: '2026-09-10T10:00:00.000Z', errorMessage: 'Meta 131026', createdAt: '2026-09-10T10:00:00.000Z',
  ...over,
})

/** Service con logRepo espía: `rows` es lo que hay en la tabla, `created` lo que persistió el retry. */
function makeService(rows: any[]) {
  const created: any[] = []
  const logRepo = makeRepo({
    findById: async (id) => rows.find(r => r.id === id) ?? null,
    create: async (data: any) => { const row = { id: `new-${created.length + 1}`, ...data }; created.push(row); return row },
  })
  const svc = new MarketingService(makeRepo(), logRepo, makeRepo(), log, silentCache)
  return { svc, created }
}

describe('MarketingService.retryMessageLog', () => {
  it('failed de room-info del hotel → crea marcador retry_requested con misma response/channel/reservationId y sentAt ISO', async () => {
    const { svc, created } = makeService([failedLog()])
    const before = Date.now()
    const marker = await svc.retryMessageLog('h1', 'log-1')

    expect(created).toHaveLength(1)
    expect(marker.status).toBe(ROOM_INFO_RETRY_STATUS)
    expect(marker.status).toBe('retry_requested')
    expect(marker.response).toBe(DEDUP)
    expect(marker.channel).toBe('whatsapp_api')
    expect(marker.reservationId).toBe('r1')
    expect((marker as any).guestId).toBe('g1')
    expect(marker.recipient).toBe('+5491111111111')
    expect(marker.messageType).toBe('whatsapp')
    expect(marker.hotelId).toBe('h1')
    expect(marker.errorMessage).toBe('')
    // sentAt ISO reciente: es el piso desde el que el cron vuelve a contar failed.
    expect(typeof marker.sentAt).toBe('string')
    expect(new Date(marker.sentAt as string).toISOString()).toBe(marker.sentAt as string)
    expect(new Date(marker.sentAt as string).getTime()).toBeGreaterThanOrEqual(before)
    // No pisa la fila original: es una fila NUEVA (el historial de fallos queda).
    expect(marker.id).not.toBe('log-1')
  })

  it('el marcador reabre los intentos para roomInfoSendState (integración con shared)', async () => {
    const exhausted = [1, 2, 3].map(i => failedLog({ id: `log-${i}`, sentAt: `2026-09-10T0${i}:00:00.000Z` }))
    expect(roomInfoSendState(exhausted, DEDUP, 'whatsapp_api')).toBe('exhausted')
    const { svc } = makeService(exhausted)
    const marker = await svc.retryMessageLog('h1', 'log-3')
    expect(roomInfoSendState([...exhausted, marker], DEDUP, 'whatsapp_api')).toBe('pending')
  })

  it('log de OTRO hotel → 404 y no crea nada (no revela que existe)', async () => {
    const { svc, created } = makeService([failedLog({ hotelId: 'h2-ajeno' })])
    await expect(svc.retryMessageLog('h1', 'log-1')).rejects.toBeInstanceOf(NotFoundError)
    expect(created).toHaveLength(0)
  })

  it('log inexistente → 404', async () => {
    const { svc, created } = makeService([])
    await expect(svc.retryMessageLog('h1', 'nope')).rejects.toBeInstanceOf(NotFoundError)
    expect(created).toHaveLength(0)
  })

  it("status 'sent' → 409 (no hay nada que reintentar)", async () => {
    const { svc, created } = makeService([failedLog({ status: 'sent', errorMessage: '' })])
    await expect(svc.retryMessageLog('h1', 'log-1')).rejects.toBeInstanceOf(ConflictError)
    expect(created).toHaveLength(0)
  })

  it("failed pero response 'auto:checkin_day:x' (no es room-info) → 409", async () => {
    const { svc, created } = makeService([failedLog({ response: 'auto:checkin_day:x' })])
    await expect(svc.retryMessageLog('h1', 'log-1')).rejects.toBeInstanceOf(ConflictError)
    expect(created).toHaveLength(0)
  })

  it('failed sin response → 409', async () => {
    const { svc, created } = makeService([failedLog({ response: null })])
    await expect(svc.retryMessageLog('h1', 'log-1')).rejects.toBeInstanceOf(ConflictError)
    expect(created).toHaveLength(0)
  })
})

describe('MarketingController.retryMessageLog', () => {
  const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as any
  const merchant = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }

  function makeController() {
    const calls: unknown[][] = []
    const service = {
      retryMessageLog: async (hotelId: string, id: string, user: unknown) => { calls.push([hotelId, id, user]); return { id: 'new-1', status: 'retry_requested' } },
    } as any
    return { controller: new MarketingController(service, silentLog), calls }
  }

  it('usa el hotelId del TOKEN (ignora query/body) y devuelve 200 {data}', async () => {
    const { controller, calls } = makeController()
    const req = { user: merchant, params: { id: 'log-1' }, query: { hotelId: 'h2-victima' }, body: { hotelId: 'h2-victima' } } as any
    const res = await controller.retryMessageLog(req)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { id: 'new-1', status: 'retry_requested' } } as any)
    expect(calls).toEqual([['h1', 'log-1', merchant]])
  })

  it('token legacy sin hotelId → __none__ (no cae en otro hotel)', async () => {
    const { controller, calls } = makeController()
    await controller.retryMessageLog({ user: { id: 'u9', role: 'hotel_admin' }, params: { id: 'log-1' }, query: {}, body: {} } as any)
    expect(calls[0][0]).toBe('__none__')
  })
})
