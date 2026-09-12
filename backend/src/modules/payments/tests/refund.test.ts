// payments/tests/refund.test.ts — Devolución de un cobro con tarjeta.
import { describe, it, expect } from 'bun:test'
import { refundPayment } from '../usecases/refund'
import type { CreatePaymentDTO, PaymentDTO } from '../types'
import { StripeGateway } from '../../../services/payment-gateway/stripe-gateway'

describe('payments — refund (devolución)', () => {
  it('crea el payment de reembolso con status completed (no pending) para que cashFlow y reportes lo resten', async () => {
    // FIX refund-status-cashflow: el documento de reembolso nace `completed` porque Stripe confirma
    // la devolución de forma síncrona. Si cayera al default (`pending` por method=card) nunca llegaría
    // a `completed` — el webhook sólo actúa en `paid` — y treasury.cashFlow / reports.sumCollected
    // (ambos filtran status==='completed') no lo restarían, inflando los ingresos.
    let captured: CreatePaymentDTO | null = null
    const deps = {
      crud: {
        getById: async () => ({
          id: 'p1', hotelId: 'h1', status: 'completed', method: 'card',
          amount: 1000, currency: 'USD', folioId: 'f1', guestId: 'g1', stripePaymentId: 'pi_1',
        }),
        updateStatus: async () => ({}) as PaymentDTO,
      } as any,
      stripe: {
        isConfigured: async () => true,
        refund: async () => ({ id: 're_1' }) as any,
      } as any,
      createPayment: async (dto: CreatePaymentDTO) => { captured = dto; return { id: 'p2', ...dto } as PaymentDTO },
    }

    await refundPayment(deps as any, 'p1', 1000, { id: 'u1', role: 'hotel_admin' })

    expect(captured).not.toBeNull()
    expect((captured as any).type).toBe('refund')
    expect((captured as any).status).toBe('completed')
  })

  // ── COR-2: la devolución hereda los DOS vínculos del cobro original ──────────────────────────
  it('un cobro de FACTURA devuelve un refund con invoiceId (si no, queda huérfano)', async () => {
    // Los cobros de factura nacen con `invoiceId` y SIN `folioId` (connectors/facturas-payments.ts).
    // `shared/usecases/reservation-paid` llega a `payments` por folioId Y por invoiceId: un refund
    // sin ninguno de los dos no lo ve nadie, el cargo original sigue sumando (`refunded` cuenta) y
    // el saldo de la reserva queda con plata que ya se devolvió.
    let captured: CreatePaymentDTO | null = null
    const deps = {
      crud: {
        getById: async () => ({
          id: 'p1', hotelId: 'h1', status: 'completed', method: 'card',
          amount: 400, currency: 'USD', folioId: null, invoiceId: 'inv-1', guestId: 'g1', stripePaymentId: 'pi_1',
        }),
        updateStatus: async () => ({}) as PaymentDTO,
      } as any,
      stripe: { isConfigured: async () => true, refund: async () => ({ id: 're_1' }) as any } as any,
      createPayment: async (dto: CreatePaymentDTO) => { captured = dto; return { id: 'p2', ...dto } as PaymentDTO },
    }

    await refundPayment(deps as any, 'p1', 400, { id: 'u1', role: 'hotel_admin' })

    expect((captured as any).invoiceId).toBe('inv-1')
    expect((captured as any).folioId).toBeNull()
  })

  it('un cobro de FOLIO sigue heredando folioId', async () => {
    let captured: CreatePaymentDTO | null = null
    const deps = {
      crud: {
        getById: async () => ({
          id: 'p1', hotelId: 'h1', status: 'completed', method: 'card',
          amount: 300, currency: 'USD', folioId: 'f1', invoiceId: null, guestId: 'g1', stripePaymentId: 'pi_1',
        }),
        updateStatus: async () => ({}) as PaymentDTO,
      } as any,
      stripe: { isConfigured: async () => true, refund: async () => ({ id: 're_1' }) as any } as any,
      createPayment: async (dto: CreatePaymentDTO) => { captured = dto; return { id: 'p2', ...dto } as PaymentDTO },
    }

    await refundPayment(deps as any, 'p1', 300, { id: 'u1', role: 'hotel_admin' })

    expect((captured as any).folioId).toBe('f1')
    expect((captured as any).invoiceId).toBeNull()
  })

  it('un cobro de REPROGRAMACIÓN (sólo reservationId) devuelve un refund con reservationId', async () => {
    // BUG-R2-1: la diferencia de un reagendado cobrada con tarjeta nace SIN folio y SIN factura
    // (shared/usecases/charge-reschedule-diff.ts) — sólo con `payments.reservationId`. Si el
    // refund no hereda ese vínculo, `paidForReservation` no lo recolecta por ningún camino: el
    // cargo original sigue sumando, la devolución no resta y `paid` queda inflado.
    let captured: CreatePaymentDTO | null = null
    const deps = {
      crud: {
        getById: async () => ({
          id: 'p1', hotelId: 'h1', status: 'completed', method: 'card',
          amount: 150, currency: 'USD', folioId: null, invoiceId: null, reservationId: 'r1', guestId: 'g1', stripePaymentId: 'pi_1',
        }),
        updateStatus: async () => ({}) as PaymentDTO,
      } as any,
      stripe: { isConfigured: async () => true, refund: async () => ({ id: 're_1' }) as any } as any,
      createPayment: async (dto: CreatePaymentDTO) => { captured = dto; return { id: 'p2', ...dto } as PaymentDTO },
    }

    await refundPayment(deps as any, 'p1', 150, { id: 'u1', role: 'hotel_admin' })

    expect((captured as any).reservationId).toBe('r1')
    expect((captured as any).folioId).toBeNull()
    expect((captured as any).invoiceId).toBeNull()
  })

  it('rechaza con ConflictError un cobro card SIN stripePaymentId (deuda refund-orden-pos)', async () => {
    // Los cobros POS con tarjeta se registran manuales (sin cargo Stripe). Sin este guard, stripe.refund
    // recibe payment_intent='' y Stripe tira error críptico. El guard devuelve 409 claro con workaround.
    let stripeCalled = false
    const deps = {
      crud: {
        getById: async () => ({
          id: 'p1', hotelId: 'h1', status: 'completed', method: 'card',
          amount: 1000, currency: 'USD', folioId: null, guestId: null, stripePaymentId: '',
        }),
        updateStatus: async () => ({}) as PaymentDTO,
      } as any,
      stripe: {
        isConfigured: async () => true,
        refund: async () => { stripeCalled = true; return { id: 're_1' } as any },
      } as any,
      createPayment: async () => { throw new Error('NO debió crear payment') },
    }

    await expect(refundPayment(deps as any, 'p1', undefined, { id: 'u1', role: 'hotel_admin' }))
      .rejects.toThrow(/sin un cargo de Stripe asociado|fix-refund-pos-card/)
    expect(stripeCalled).toBe(false)
  })

  // ── #271 MR-06: el cobro del motor web (`method:'link'`, referencia = Checkout Session) ──
  it('un cobro LINK con stripeSessionId se reembolsa por Stripe con la sesión como referencia y crea la fila refund completa', async () => {
    // post-booking-payment.ts asienta el cobro web con method 'link' y SOLO `stripeSessionId` (cs_...).
    // Antes el guard `method !== 'card'` lo rechazaba y el rechazo de una reserva pendiente de
    // aprobación no tenía por dónde devolver la plata.
    let captured: CreatePaymentDTO | null = null
    let stripeArgs: any = null
    const statuses: string[] = []
    const deps = {
      crud: {
        getById: async () => ({
          id: 'p1', hotelId: 'h1', status: 'completed', method: 'link',
          amount: 100, currency: 'USD', folioId: null, invoiceId: null, reservationId: 'r1', guestId: 'g1',
          stripePaymentId: '', stripeSessionId: 'cs_test_123',
        }),
        updateStatus: async (_id: string, status: string) => { statuses.push(status); return {} as PaymentDTO },
      } as any,
      stripe: {
        isConfigured: async () => true,
        refund: async (args: any) => { stripeArgs = args; return { id: 're_1' } as any },
      } as any,
      createPayment: async (dto: CreatePaymentDTO) => { captured = dto; return { id: 'p2', ...dto } as PaymentDTO },
    }

    await refundPayment(deps as any, 'p1', 100, { id: 'u1', role: 'hotel_admin' })

    expect(stripeArgs.paymentId).toBe('cs_test_123')
    expect((captured as any).type).toBe('refund')
    expect((captured as any).method).toBe('link')
    expect((captured as any).amount).toBe(100)
    expect((captured as any).reservationId).toBe('r1')
    expect(statuses).toEqual(['refunded'])
  })

  it('un cobro CASH sigue rechazado (no pasa por Stripe)', async () => {
    let stripeCalled = false
    const deps = {
      crud: {
        getById: async () => ({
          id: 'p1', hotelId: 'h1', status: 'completed', method: 'cash',
          amount: 100, currency: 'USD', stripePaymentId: '', stripeSessionId: '',
        }),
        updateStatus: async () => ({}) as PaymentDTO,
      } as any,
      stripe: {
        isConfigured: async () => true,
        refund: async () => { stripeCalled = true; return { id: 're_1' } as any },
      } as any,
      createPayment: async () => { throw new Error('NO debió crear payment') },
    }

    await expect(refundPayment(deps as any, 'p1', undefined, { id: 'u1', role: 'hotel_admin' }))
      .rejects.toThrow(/Only card or checkout-link/)
    expect(stripeCalled).toBe(false)
  })
})

// ── #271 MR-06: StripeGateway.refund resuelve `cs_...` → payment_intent antes de refunds.create ──
// Patrón de payment-gateways/tests/stripe-gateway-confirm.test.ts: gateway REAL, cliente interno
// de Stripe stubeado. Cualquier llamada no stubeada rompería el test (no hay red).
describe('StripeGateway.refund (#271)', () => {
  function makeGateway() {
    return new StripeGateway({ secretKey: 'sk_test_x', currency: 'usd' }, 'test')
  }

  /** Stubea sessions.retrieve y refunds.create; registra las llamadas. */
  function stubStripe(gw: StripeGateway, session: any | (() => Promise<any>)) {
    const calls = { retrieve: [] as any[], create: [] as any[], options: [] as any[] }
    const stripe = (gw as any).stripe
    stripe.checkout.sessions.retrieve = async (id: string) => {
      calls.retrieve.push(id)
      return typeof session === 'function' ? session() : session
    }
    stripe.refunds.create = async (params: any, options?: any) => {
      calls.create.push(params)
      calls.options.push(options)
      return { id: 're_1', status: 'succeeded' }
    }
    return calls
  }

  it('providerRef cs_x → retrieve(cs_x) y refunds.create({ payment_intent: pi_y, amount }) con payment_intent string', async () => {
    const gw = makeGateway()
    const calls = stubStripe(gw, { id: 'cs_x', payment_intent: 'pi_y' })

    const out = await gw.refund('cs_x', 10000)

    expect(calls.retrieve).toEqual(['cs_x'])
    expect(calls.create).toEqual([{ payment_intent: 'pi_y', amount: 10000 }])
    expect(out).toEqual({ refundId: 're_1', status: 'succeeded' })
  })

  it('payment_intent expandido como objeto { id } también sirve', async () => {
    const gw = makeGateway()
    const calls = stubStripe(gw, { id: 'cs_x', payment_intent: { id: 'pi_obj', status: 'succeeded' } })

    await gw.refund('cs_x', 500)

    expect(calls.create).toEqual([{ payment_intent: 'pi_obj', amount: 500 }])
  })

  it('sesión sin payment_intent → lanza con el id de la sesión en el mensaje y NO llama a refunds.create', async () => {
    const gw = makeGateway()
    const calls = stubStripe(gw, { id: 'cs_x', payment_intent: null })

    await expect(gw.refund('cs_x', 500)).rejects.toThrow(/cs_x/)
    expect(calls.create).toHaveLength(0)
  })

  it('providerRef pi_z → NO llama a sessions.retrieve y va directo a refunds.create', async () => {
    const gw = makeGateway()
    const calls = stubStripe(gw, async () => { throw new Error('no debió consultar la sesión') })

    await gw.refund('pi_z', 700)

    expect(calls.retrieve).toHaveLength(0)
    expect(calls.create).toEqual([{ payment_intent: 'pi_z', amount: 700 }])
  })

  it('sin amountMinor → refund total (sin `amount` en los params)', async () => {
    const gw = makeGateway()
    const calls = stubStripe(gw, { id: 'cs_x', payment_intent: 'pi_y' })

    await gw.refund('pi_y')

    expect(calls.create).toEqual([{ payment_intent: 'pi_y' }])
  })

  // #272: la clave de idempotencia viaja como request option (header `Idempotency-Key`), no en los params.
  it('con idempotencyKey → refunds.create recibe { idempotencyKey } como opción y dos llamadas iguales mandan la misma', async () => {
    const gw = makeGateway()
    const calls = stubStripe(gw, { id: 'cs_x', payment_intent: 'pi_y' })

    await gw.refund('cs_x', 700, 'web-refund:p1:70000')
    await gw.refund('cs_x', 700, 'web-refund:p1:70000')

    expect(calls.create).toEqual([{ payment_intent: 'pi_y', amount: 700 }, { payment_intent: 'pi_y', amount: 700 }])
    expect(calls.options).toEqual([{ idempotencyKey: 'web-refund:p1:70000' }, { idempotencyKey: 'web-refund:p1:70000' }])
  })

  it('sin idempotencyKey → refunds.create sin opciones (comportamiento previo intacto)', async () => {
    const gw = makeGateway()
    const calls = stubStripe(gw, { id: 'cs_x', payment_intent: 'pi_y' })

    await gw.refund('pi_y', 700)

    expect(calls.options).toEqual([undefined])
  })
})
