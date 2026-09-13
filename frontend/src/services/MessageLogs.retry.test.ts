import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./http', () => ({
  http: { post: vi.fn(), get: vi.fn() },
}))

import { MessageLogsService, isRoomInfoRetryable, MSG_STATUS_META, msgStatusMeta } from './MessageLogs.service'
import { http } from './http'

// CA19 (#338): si el aviso de habitación falla, el operador puede pedir un reintento desde
// Comunicaciones. El backend crea un marcador `retry_requested`; el cron reenvía en el próximo tick.
describe('MessageLogs.service — reintento del aviso de habitación', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retry(id) hace POST a /message-logs/:id/retry y devuelve el marcador', async () => {
    const marker = { id: 'm2', status: 'retry_requested', response: 'auto:room_info:r1:101' }
    vi.mocked(http.post).mockResolvedValue({ data: marker } as any)
    const r = await MessageLogsService.retry('abc')
    expect(http.post).toHaveBeenCalledTimes(1)
    expect(http.post).toHaveBeenCalledWith('/message-logs/abc/retry')
    expect(r.data).toEqual(marker)
  })

  it('retry codifica el id en la URL', async () => {
    vi.mocked(http.post).mockResolvedValue({ data: {} } as any)
    await MessageLogsService.retry('a/b')
    expect(http.post).toHaveBeenCalledWith('/message-logs/a%2Fb/retry')
  })

  it('isRoomInfoRetryable: sólo failed con response auto:room_info:', () => {
    expect(isRoomInfoRetryable({ status: 'failed', response: 'auto:room_info:r1:101' })).toBe(true)
    expect(isRoomInfoRetryable({ status: 'sent', response: 'auto:room_info:r1:101' })).toBe(false)
    expect(isRoomInfoRetryable({ status: 'failed', response: 'auto:checkin_day:r1' })).toBe(false)
    expect(isRoomInfoRetryable({ status: 'failed', response: undefined })).toBe(false)
    expect(isRoomInfoRetryable({ status: 'retry_requested', response: 'auto:room_info:r1:101' })).toBe(false)
  })

  it('MSG_STATUS_META.retry_requested existe con etiqueta y msgStatusMeta la resuelve', () => {
    expect(MSG_STATUS_META.retry_requested).toBeDefined()
    expect(MSG_STATUS_META.retry_requested.label).toBe('Reintento pedido')
    expect(MSG_STATUS_META.retry_requested.icon).toContain('<svg')
    expect(msgStatusMeta('retry_requested').label).toBe('Reintento pedido')
  })
})
