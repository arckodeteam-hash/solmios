// connectors/tests/reservas-payment-gateways.test.ts — REQ-RWP-02: el detalle de la reserva lee
// `payment_attempts` por el puerto de payment-gateways (dueño de la tabla), no por import directo.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { reservasPaymentGatewaysConnector } from '../reservas-payment-gateways'

function makeCtx(modules: Record<string, any>) {
  const captured: any = { deps: {} }
  const resolved: string[] = []
  const reservasStub = {
    setOrchestrationDeps: (d: any) => Object.assign(captured.deps, d),
  }
  const ctx = {
    resolveModule: (name: string) => {
      resolved.push(name)
      if (name === 'reservas') return reservasStub
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured, resolved }
}

describe('reservasPaymentGatewaysConnector (REQ-RWP-02)', () => {
  it('cablea listPaymentAttempts y delega en payment-gateways.listAttempts(hotelId, reservationId)', async () => {
    const calls: any[] = []
    const rows = [{ id: 'pa1', kind: 'paid', provider: 'stripe' }]
    const { ctx, captured } = makeCtx({
      'payment-gateways': {
        listAttempts: async (hotelId: string, reservationId: string) => { calls.push([hotelId, reservationId]); return rows },
      },
    })
    reservasPaymentGatewaysConnector(ctx)

    expect(typeof captured.deps.listPaymentAttempts).toBe('function')
    await expect(captured.deps.listPaymentAttempts('h1', 'r1')).resolves.toEqual(rows)
    expect(calls).toEqual([['h1', 'r1']])
  })

  it('resuelve payment-gateways de forma lazy: al registrar sólo toca reservas', () => {
    const { ctx, resolved } = makeCtx({ 'payment-gateways': { listAttempts: async () => [] } })
    reservasPaymentGatewaysConnector(ctx)
    expect(resolved).toEqual(['reservas'])
  })

  it('el puerto propaga el error del módulo: el best-effort vive en reservas (detail.ts), no acá', async () => {
    const { ctx, captured } = makeCtx({
      'payment-gateways': { listAttempts: async () => { throw new Error('gateways caído') } },
    })
    reservasPaymentGatewaysConnector(ctx)
    await expect(captured.deps.listPaymentAttempts('h1', 'r1')).rejects.toThrow('gateways caído')
  })
})
