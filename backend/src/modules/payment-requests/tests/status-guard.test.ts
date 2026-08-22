// payment-requests/tests/status-guard.test.ts — SEC-1: el estado de un cobro es un enum cerrado
// y TODO cambio manual deja rastro.
//
// Antes: `UpdatePaymentRequestSchema.status` era `{type:'string'}` a secas. Un usuario con
// `billing:edit` mandaba `PUT /api/payment-requests/:id {"status":"x"}` y el link dejaba de contar
// como `pending` en `committedPending` (usecases/charge-ceiling.ts:49): el techo AGREGADO quedaba
// burlado, la sesión de Stripe ya emitida seguía viva y pagable, y se podía crear otro link por el
// saldo completo. Encima `isSensitiveStatus` sólo auditaba paid/cancelled/expired/refunded, así que
// el estado arbitrario no dejaba una línea en el audit log.
//
// OJO — el enum tapa los strings basura y NADA MÁS. El escenario de saldo (`'cancelled'`/`'expired'`
// son valores VÁLIDOS que igual sacan la fila del techo agregado) lo cierra
// `usecases/live-session.ts` y lo cubre `tests/live-session.test.ts`. Este archivo prueba el enum y
// la auditoría; no pretende cubrir el techo.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentRequestsService } from '../service'
import { UpdatePaymentRequestSchema } from '../validators/schema'
import { PAYMENT_REQUEST_STATUSES } from '../types'
import type { PaymentRequestDTO, CurrentUser } from '../types'
import type { AuditEntry } from '../usecases/audit'

const log = silentLogger()
const currentUser: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const permissiveAuth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth

function makeRepo<T extends object>(ov: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (d: any) => ({ id: 'x1', ...d } as T),
    update: async (id: any, d: any) => ({ id, ...d } as T),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...ov,
  } as RepositoryAdapter<T>
}

/** Servicio con un PaymentRequest en el estado pedido y el audit log capturado. */
function makeService(prStatus: string) {
  const pr: PaymentRequestDTO = {
    id: 'pr1', hotelId: 'h1', reservationId: 'r1', amount: 100,
    currency: 'USD', status: prStatus, sentTo: 'g@x.com', sentVia: 'email',
  }
  const repo = makeRepo<PaymentRequestDTO>({
    findById: async () => pr,
    update: async (id: any, d: any) => ({ ...pr, id, ...d }),
  })
  const audited: AuditEntry[] = []
  const s = new PaymentRequestsService(
    repo,
    makeRepo<any>({ findById: async () => ({ id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 200, otherCharges: 0 }) }),
    makeRepo<any>(), makeRepo<any>(),
    makeRepo<any>({ findById: async () => ({ id: 'u1', hotelId: 'h1' }) }),
    log, permissiveAuth, makeRepo<any>(),
  )
  // STR-A: puerto de dinero del connector payment-requests-money (sin folios/facturas/pagos: paid=deposit).
  s.setMoneyDeps({ paidRepos: { folioRepo: makeRepo<any>(), invoiceRepo: makeRepo<any>(), paymentRepo: makeRepo<any>() }, settledNet: async () => 0, liveCharges: async () => 0, liveChargeRows: async () => [], cancelLiveCharge: async () => 'cancelled' as const })
  s.setAuditDeps({ record: async (e) => { audited.push(e) } })
  return { s, audited }
}

describe('SEC-1 · estado de un cobro', () => {
  it('el schema rechaza un estado fuera del enum', () => {
    expect(() => validateSchema(UpdatePaymentRequestSchema, { status: 'x' })).toThrow()
    // El mensaje del framework enumera los válidos: sirve de contrato para el frontend.
    expect(() => validateSchema(UpdatePaymentRequestSchema, { status: 'refunded' })).toThrow()
  })

  it('el schema acepta cada estado declarado en PAYMENT_REQUEST_STATUSES', () => {
    for (const st of PAYMENT_REQUEST_STATUSES) {
      expect(validateSchema(UpdatePaymentRequestSchema, { status: st })).toEqual({ status: st })
    }
  })

  it('revivir un link cancelado a "pending" queda auditado', async () => {
    // Este es el agujero que dejaba la whitelist vieja: 'pending' no estaba en SENSITIVE_STATUS,
    // y volver a 'pending' vuelve a comprometer saldo en el techo agregado sin dejar rastro.
    const { s, audited } = makeService('cancelled')
    await s.update('pr1', { status: 'pending' }, currentUser)
    expect(audited).toHaveLength(1)
    expect(audited[0].action).toBe('payment_request.pending')
    expect(audited[0].entityId).toBe('pr1')
    expect(audited[0].userId).toBe('u1')
  })

  it('un update sin cambio de estado no ensucia el audit log', async () => {
    const { s, audited } = makeService('pending')
    await s.update('pr1', { status: 'pending', sentTo: 'otro@x.com' }, currentUser)
    expect(audited).toHaveLength(0)
  })
})
