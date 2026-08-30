// webhook-dispatch.test.ts — Un cobro confirmado no puede morir en el handler equivocado.
//
// El incidente: el panel publicaba UNA sola URL de webhook (`pages/pagos/index.vue` → la de este
// módulo) y el hotel la configuró. Todo evento del MOTOR DE RESERVAS aterrizaba acá, salía por un
// `if (!paymentRequestId) return null` sin log y respondía 200. Stripe da el 200 por entregado y
// NO reintenta: el huésped pagaba, se le cobraba, y la reserva quedaba `pending` para siempre.
// Verificado en producción el 2026-08-28 con un pago real (`payment_status: paid`, reserva
// `pending`, 0 filas en `payments`, cero líneas de log).
import { describe, it, expect } from 'bun:test'
import { processStripeWebhook } from '../usecases/stripe-webhook'
import { StripeService } from '../../../services/stripe-service'

function recordingLogger() {
  const warns: Array<{ msg: string; meta: any }> = []
  const infos: string[] = []
  const logger = {
    info: (msg: string) => { infos.push(msg) },
    warn: (msg: string, meta?: any) => { warns.push({ msg, meta }) },
    error: () => {},
    child() { return logger },
  } as any
  return { logger, warns, infos }
}

/** Evento ya verificado por Stripe: lo que importa acá es su `metadata`. */
function sessionEvent(metadata: Record<string, string>) {
  return { type: 'checkout.session.completed', data: { object: { id: 'cs_test_x', metadata } } }
}

/** Fuerza el camino "firma OK" sin tocar Stripe: el ruteo es lo que se prueba. */
function stubStripe(event: any) {
  const origConfigured = StripeService.isConfigured
  const origVerify = (StripeService as any).verifyWebhook
  ;(StripeService as any).isConfigured = async () => true
  ;(StripeService as any).verifyWebhook = async () => event
  return () => {
    StripeService.isConfigured = origConfigured
    ;(StripeService as any).verifyWebhook = origVerify
  }
}

const baseDeps = (logger: any, extra: any = {}) => ({
  repo: { findById: async () => null } as any,
  reservationRepo: {} as any, folioRepo: {} as any, folioChargeRepo: {} as any,
  addonRepo: {} as any, paidRepos: {} as any,
  logger, sockets: {}, paymentPort: null, events: null,
  ...extra,
})

describe('webhook de links de pago — evento del motor de reservas', () => {
  it('lo reenvía al motor en vez de descartarlo', async () => {
    const restore = stubStripe(sessionEvent({ reservationId: 'res-1' }))
    const { logger, infos } = recordingLogger()
    const reenviados: any[] = []
    const deps = baseDeps(logger, {
      bookingWebhook: async (h: string, b: any, s: string) => { reenviados.push({ h, b, s }); return null },
    })

    const r = await processStripeWebhook(deps as any, 'h1', '{"raw":true}', 'sig')
    restore()

    expect(reenviados).toHaveLength(1)
    expect(reenviados[0]).toMatchObject({ h: 'h1', b: '{"raw":true}', s: 'sig' })
    expect(r).toMatchObject({ received: true })
    expect(infos.some(m => /reenviado a su dueño/i.test(m))).toBe(true)
  })

  it('si el reenvío falla devuelve 500 para que Stripe REINTENTE (no da el cobro por bueno)', async () => {
    const restore = stubStripe(sessionEvent({ reservationId: 'res-1' }))
    const { logger } = recordingLogger()
    const deps = baseDeps(logger, {
      bookingWebhook: async () => { throw new Error('motor caído') },
    })

    const r: any = await processStripeWebhook(deps as any, 'h1', '{}', 'sig')
    restore()

    expect(r.status).toBe(500)
  })

  it('sin el puerto cableado avisa fuerte en vez de callarse', async () => {
    const restore = stubStripe(sessionEvent({ reservationId: 'res-1' }))
    const { logger, warns } = recordingLogger()

    await processStripeWebhook(baseDeps(logger) as any, 'h1', '{}', 'sig')
    restore()

    expect(warns.some(w => /sin puerto al motor/i.test(w.msg))).toBe(true)
  })

  it('evento sin ningún identificador conocido: se avisa que el cobro NO se aplicó', async () => {
    const restore = stubStripe(sessionEvent({}))
    const { logger, warns } = recordingLogger()

    await processStripeWebhook(baseDeps(logger) as any, 'h1', '{}', 'sig')
    restore()

    const w = warns.find(x => /NO aplicado/i.test(x.msg))
    expect(w).toBeDefined()
    expect(w!.meta).toMatchObject({ hotelId: 'h1', sessionId: 'cs_test_x' })
  })

  it('un evento PROPIO no se reenvía a nadie', async () => {
    const restore = stubStripe(sessionEvent({ paymentRequestId: 'pr-1' }))
    const { logger } = recordingLogger()
    let reenviado = false
    const deps = baseDeps(logger, { bookingWebhook: async () => { reenviado = true } })

    await processStripeWebhook(deps as any, 'h1', '{}', 'sig')
    restore()

    expect(reenviado).toBe(false)
  })
})
