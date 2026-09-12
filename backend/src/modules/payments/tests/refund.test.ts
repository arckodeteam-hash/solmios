// payments/tests/refund.test.ts — Devolución de un cobro con tarjeta.
import { describe, it, expect } from 'bun:test'
import { refundPayment } from '../usecases/refund'
import type { CreatePaymentDTO, PaymentDTO } from '../types'

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
