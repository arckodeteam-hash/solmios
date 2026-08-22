// payment-requests/tests/ceiling-payments-via.test.ts — RTC-8: la vía charge-card, bajo techo.
//
// El hallazgo (2026-08-21, dos auditores independientes — la octava puerta del mismo bug, y la
// primera FUERA de `payment-requests`):
//
//     requerir-pago($400)  → exposición $400 / saldo $400   ok
//     + chargeCard($400)   → exposición $800 / saldo $400   ROTO
//     payments: [{ status: "processing", amount: 400, reservationId: "r1" }]
//
// `chargeCard` abría Checkout Sessions reales sin pasar por ningún techo, la sesión era invisible
// para los DOS lados de la desigualdad, y nadie la expiraba jamás. Acá se ejercita la vía completa
// contra el banco real de `ceiling-world.ts`: el guard que la niega, el FIFO combinado que la
// recorta, el 409 del borrado con sesión pagada y la expiración de la cancelación.
//
// Lo único fingido es el CHECKOUT (el ledger de sesiones, igual que el resto de la suite): el
// techo, el clamp, el service de `payments` y el guard entre módulos son los REALES, cableados
// como en producción (`connectors/payments-ceiling` / `connectors/payment-requests-money`).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { StripeUseCase } from '../../payments/usecases/stripe'
import { chargeCard as chargeCardUsecase } from '../../payments/usecases/charge-card'
import {
  makeWorld, installStripe, HOTEL, RESERVATION, USER, type World,
} from './ceiling-world'

let world: World
let restoreStripe: () => void
let restoreUseCase: () => void
let seq = 0

beforeAll(async () => {
  world = await makeWorld()
  restoreStripe = installStripe(world.ledger)
  // El módulo `payments` resuelve la pasarela por registry (tabla `payment_gateways`): en este
  // world no hay ninguna cargada. Se finge SOLO el paso por el proveedor — el techo que se prueba
  // es el real, cableado por el world igual que `connectors/payments-ceiling`.
  const U = StripeUseCase.prototype as unknown as Record<string, unknown>
  const real = { isConfigured: U.isConfigured, createCheckoutSession: U.createCheckoutSession }
  U.isConfigured = async function () { return true }
  U.createCheckoutSession = async function (params: { hotelId: string; amount: number; metadata?: Record<string, string> }) {
    const s = world.ledger.open(String(params.hotelId), Math.round(Number(params.amount) * 100), { ...(params.metadata || {}) })
    return { id: s.id, url: `https://pay.test/${s.id}` }
  }
  restoreUseCase = () => Object.assign(U, real)
})
afterAll(() => { restoreStripe(); restoreUseCase() })
beforeEach(async () => { await world.reset(); seq++ })

/** Cobro con tarjeta sobre la reserva del escenario, como lo pide `POST /api/payments/charge`. */
async function chargeCard(amount: number) {
  return world.payments.chargeCard({
    hotelId: HOTEL, type: 'charge', method: 'card', amount, currency: 'USD',
    description: `cobro ${seq}`, reservationId: RESERVATION,
  } as any)
}

/** La última sesión abierta en el ledger (la de charge-card bajo test). */
function lastSession() {
  return [...world.ledger.sessions.values()].at(-1)!
}

async function paymentsOfReservation() {
  return world.paymentRepo.findMany({ hotelId: HOTEL, reservationId: RESERVATION } as any)
}

describe('RTC-8.1/8.2 — charge-card pasa por el techo y la sesión cuenta como comprometida', () => {
  it('el escenario del hallazgo: link de $400 + chargeCard de $400 ya no dejan exposición $800', async () => {
    // requerir-pago($400): crear + emitir, como el botón del modal.
    const item = await world.service.create({ reservationId: RESERVATION, amount: 400 } as any, USER)
    await world.service.createCheckout(item.id, USER, 'https://panel.test')
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(400)

    // + chargeCard($400): ANTES abría la segunda sesión por el saldo completo (exposición $800
    // sobre saldo $400). Ahora se niega — el techo ve las sesiones de esta vía (RTC-8.2).
    await expect(chargeCard(400)).rejects.toThrow('cobros pendientes')
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(400)
  })

  it('en el orden inverso: chargeCard compromete el techo de los links', async () => {
    await chargeCard(250)
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(250)
    // saldo $400 − $250 comprometidos = $150 libres: un link de $300 no entra.
    await expect(world.service.create({ reservationId: RESERVATION, amount: 300 } as any, USER))
      .rejects.toThrow('supera el saldo cobrable')
  })

  it('chargeCard por el saldo justo pasa, lleva reservationId en la metadata (RTC-8.4) y persiste la sesión', async () => {
    const { checkoutUrl } = await chargeCard(400)
    expect(checkoutUrl).toMatch(/^https:\/\/pay\.test\//)
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(400)
    expect(lastSession().metadata.reservationId).toBe(RESERVATION)
    // RTC-8.3 (prefacio): sin el id persistido, el clamp no tendría qué expirar.
    const rows = await paymentsOfReservation()
    expect(rows[0].stripeSessionId).toBe(lastSession().id)
    expect(rows[0].status).toBe('processing')
  })

  it('sin el puerto del techo cableado, un cobro con reserva tira fuerte (fail-closed)', async () => {
    const boom = () => { throw new Error('no debía llegar acá') }
    await expect(chargeCardUsecase(
      { stripe: { isConfigured: boom, createCheckoutSession: boom } as any,
        crud: { updateStatus: boom, attachSession: boom } as any, createPayment: boom },
      { hotelId: HOTEL, reservationId: RESERVATION, amount: 100 } as any,
    )).rejects.toThrow('falta el puerto del techo')
  })
})

describe('RTC-8.3 — el clamp recorta también las sesiones de la vía charge-card', () => {
  it('bajar el total mata la sesión de Stripe, no sólo la fila', async () => {
    await chargeCard(400) // saldo $400: justo
    // totalAmount 500→300 baja el saldo cobrable a $200: la sesión de $400 ya no entra.
    await world.reservationRepo.update(RESERVATION, { totalAmount: 300 } as any)
    await world.service.clampRequestsToCeiling(HOTEL, RESERVATION, USER)

    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(0) // murió EN STRIPE, no sólo acá
    const rows = await paymentsOfReservation()
    expect(rows[0].status).toBe('cancelled')
  })

  it('el FIFO es combinado: el link más viejo se respeta, la sesión más nueva se recorta', async () => {
    // Link de $200 (más viejo) + sesión de $200 (más nueva) = $400 = saldo justo.
    const item = await world.service.create({ reservationId: RESERVATION, amount: 200 } as any, USER)
    await world.service.createCheckout(item.id, USER, 'https://panel.test')
    await chargeCard(200)

    await world.reservationRepo.update(RESERVATION, { totalAmount: 350 } as any) // saldo → $250
    await world.service.clampRequestsToCeiling(HOTEL, RESERVATION, USER)

    // El link de $200 sigue vivo; la sesión de $200 ($200+$200 > $250) murió.
    const link = await world.requestRepo.findById(item.id)
    expect(link?.status).toBe('pending')
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(200)
    expect((await paymentsOfReservation())[0].status).toBe('cancelled')
  })
})

describe('RTC-8.6 — el borrado no deja pasar una sesión de charge-card', () => {
  it('sesión ABIERTA: se expira y cancela antes de borrar', async () => {
    await chargeCard(400)
    const released = await world.service.releaseRequestsOfReservation(HOTEL, RESERVATION, USER)
    expect(released).toBe(1)
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(0)
    expect((await paymentsOfReservation())[0].status).toBe('cancelled')
  })

  it('sesión YA PAGADA sin webhook: 409 — el cobro huérfano de RTC-0.5, por esta puerta', async () => {
    await chargeCard(400)
    lastSession().status = 'complete' // el huésped pagó; el webhook todavía no llegó
    await expect(world.service.releaseRequestsOfReservation(HOTEL, RESERVATION, USER))
      .rejects.toThrow('ya abonó un cobro con tarjeta')
    expect((await paymentsOfReservation())[0].status).toBe('processing') // intacta: la plata está en camino
  })
})

describe('RTC-8.7 — la cancelación expira las sesiones abiertas (sin el 409 del borrado)', () => {
  it('reserva cancelada no deja links ni sesiones pagables', async () => {
    await chargeCard(400)
    const released = await world.service.releaseRequestsForCancellation(HOTEL, RESERVATION, USER)
    expect(released).toBe(1)
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(0)
    expect((await paymentsOfReservation())[0].status).toBe('cancelled')
  })

  it('una sesión ya pagada NO bloquea la cancelación (la OTA no puede recibir 409)', async () => {
    await chargeCard(400)
    lastSession().status = 'complete'
    const released = await world.service.releaseRequestsForCancellation(HOTEL, RESERVATION, USER)
    expect(released).toBe(0) // no se cuenta como liberada: sigue `processing` hasta el webhook
    expect((await paymentsOfReservation())[0].status).toBe('processing')
  })
})
