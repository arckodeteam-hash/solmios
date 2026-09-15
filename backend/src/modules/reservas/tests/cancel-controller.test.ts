// reservas/tests/cancel-controller.test.ts — POST /api/reservas/:id/cancel: el motivo es obligatorio.
import { describe, it, expect } from 'bun:test'
import { ReservasController } from '../controller'

function controllerWith(calls: unknown[][]) {
  const service = { cancel: async (...a: unknown[]) => { calls.push(a); return { id: 'r1', status: 'cancelled' } } }
  return new ReservasController(service as any, { info() {}, warn() {}, error() {}, debug() {} } as any, {} as any, {} as any, {} as any, {} as any, {} as any)
}
const req = (body: unknown) => ({ params: { id: 'r1' }, body, user: { id: 'u1', role: 'hotel_admin', hotelId: 'h1' } }) as any

describe('POST /api/reservas/:id/cancel — motivo', () => {
  it('sin body, sin motivo o con motivo en blanco: 400 y no cancela', async () => {
    const calls: unknown[][] = []
    const c = controllerWith(calls)
    for (const body of [undefined, {}, { reason: '' }, { reason: '   ' }]) {
      const res = await c.cancel(req(body))
      expect(res.status).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })

  it('con motivo: cancela con el motivo recortado y pasa notifyGuest', async () => {
    const calls: unknown[][] = []
    const res = await controllerWith(calls).cancel(req({ reason: '  Sobreventa ', notifyGuest: true }))
    expect(res.status).toBe(200)
    expect(calls[0][1]).toMatchObject({ reason: 'Sobreventa', notifyGuest: true })
  })

  it('motivo de más de 500 caracteres: 400, no 500', async () => {
    const res = await controllerWith([]).cancel(req({ reason: 'x'.repeat(501) }))
    expect(res.status).toBe(400)
  })
})
