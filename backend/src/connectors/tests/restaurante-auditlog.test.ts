// connectors/tests/restaurante-auditlog.test.ts — #207: el conector solo DELEGA en auditlog.create.
// Se verifica el cableado (setAuditDeps) y el mapeo de la entrada al DTO de auditlog.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { restauranteAuditlogConnector } from '../restaurante-auditlog'

function makeCtx() {
  const created: any[] = []
  let port: any = null
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'restaurant') return { setAuditDeps: (p: any) => { port = p } }
      if (name === 'auditlog') return { create: async (dto: any) => { created.push(dto); return dto } }
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, created, port: () => port }
}

describe('restauranteAuditlogConnector', () => {
  it('inyecta el puerto en restaurant y cada record() termina en auditlog.create con hotel/usuario/acción/detalle', async () => {
    const { ctx, created, port } = makeCtx()
    restauranteAuditlogConnector(ctx)
    expect(port()).not.toBeNull()
    await port().record({
      hotelId: 'h1', userId: 'u1', action: 'restaurant.line.voided', entity: 'restaurant_order_item', entityId: 'l1',
      detail: '{"amount":20,"reason":"Sin stock"}',
    })
    expect(created).toEqual([{
      hotelId: 'h1', userId: 'u1', action: 'restaurant.line.voided', entity: 'restaurant_order_item', entityId: 'l1',
      detail: '{"amount":20,"reason":"Sin stock"}',
    }])
  })

  it('sin entity explícita cae a restaurant_order', async () => {
    const { ctx, created, port } = makeCtx()
    restauranteAuditlogConnector(ctx)
    await port().record({ hotelId: 'h1', userId: 'u1', action: 'restaurant.order.cancelled', entityId: 'o1' })
    expect(created[0].entity).toBe('restaurant_order')
  })
})
