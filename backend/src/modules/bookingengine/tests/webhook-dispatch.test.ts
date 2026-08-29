// webhook-dispatch.test.ts — El lado espejo: un link de pago que entra por la URL del motor.
//
// Mismo principio que `payment-requests/tests/webhook-dispatch.test.ts`: el hotel configura UNA
// sola URL en Stripe y por ahí llegan los eventos de los DOS flujos de cobro. Da igual cuál de las
// dos URLs haya puesto — el evento tiene que terminar en su dueño, nunca descartado con un 200.
import { describe, it, expect } from 'bun:test'
import { BookingengineService } from '../service'

function recordingLogger() {
  const warns: string[] = []
  const infos: string[] = []
  const logger = {
    info: (msg: string) => { infos.push(msg) },
    warn: (msg: string) => { warns.push(msg) },
    error: () => {},
    child() { return logger },
  } as any
  return { logger, warns, infos }
}

/** Sólo se ejercita el ruteo: `stripe.handleWebhook` no debe llegar a correr en estos casos. */
function serviceWith(logger: any) {
  const svc = Object.create(BookingengineService.prototype) as any
  svc.logger = logger
  svc.stripe = { handleWebhook: async () => { throw new Error('no debería llegar acá') } }
  return svc as BookingengineService
}

const event = (metadata: Record<string, string>) =>
  JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', metadata } } })

describe('webhook del motor — evento de un link de pago', () => {
  it('lo reenvía a payment-requests en vez de tratarlo como reserva ajena', async () => {
    const { logger, infos } = recordingLogger()
    const svc = serviceWith(logger)
    const reenviados: any[] = []
    svc.setPaymentRequestWebhookPort(async (h, b, s) => { reenviados.push({ h, b, s }); return null })

    const r: any = await svc.handleStripeWebhook('h1', event({ paymentRequestId: 'pr-1' }), 'sig')

    expect(reenviados).toHaveLength(1)
    expect(reenviados[0].h).toBe('h1')
    expect(r).toMatchObject({ type: 'forwarded_to_payment_requests' })
    expect(infos.some(m => /reenviado a su dueño/i.test(m))).toBe(true)
  })

  it('sin el puerto cableado avisa en vez de callarse', async () => {
    const { logger, warns } = recordingLogger()
    const svc = serviceWith(logger)
    // Sin puerto: no rutea, y el flujo normal sigue (que acá tira, y eso es lo esperado).
    await svc.handleStripeWebhook('h1', event({ paymentRequestId: 'pr-1' }), 'sig').catch(() => {})
    expect(warns.some(m => /sin puerto/i.test(m))).toBe(true)
  })

  it('un evento PROPIO (reservationId) no se reenvía', async () => {
    const { logger } = recordingLogger()
    const svc = serviceWith(logger)
    let reenviado = false
    svc.setPaymentRequestWebhookPort(async () => { reenviado = true })

    await svc.handleStripeWebhook('h1', event({ reservationId: 'res-1' }), 'sig').catch(() => {})
    expect(reenviado).toBe(false)
  })

  it('un body ilegible no rutea ni explota: sigue el curso normal', async () => {
    const { logger } = recordingLogger()
    const svc = serviceWith(logger)
    let reenviado = false
    svc.setPaymentRequestWebhookPort(async () => { reenviado = true })

    await svc.handleStripeWebhook('h1', 'no-es-json', 'sig').catch(() => {})
    expect(reenviado).toBe(false)
  })
})
