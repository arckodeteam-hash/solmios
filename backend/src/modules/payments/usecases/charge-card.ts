// payments/usecases/charge-card.ts — Cobro con tarjeta vía Stripe Checkout.
//
// Orden que importa: el payment se asienta ANTES de abrir la sesión de Stripe, así el cobro
// queda registrado aunque el huésped abandone el checkout (el estado 'processing' lo refleja).
// Si Stripe no está configurado, falla explícito: cobrar con tarjeta sin proveedor no es un
// caso silencioso.
//
// RTC-8.1: antes de la sesión, el TECHO. Este usecase era la octava puerta del mismo bug: abría
// Checkout Sessions por el saldo completo sin que `assertChargeableAmount` lo viera (cero callers
// en `modules/payments`), y como `committedPending` sólo sumaba `payment_requests`, N llamadas
// dejaban N sesiones vivas por el saldo completo. Ahora el cobro con reserva valida contra el
// MISMO techo agregado que los links — saldo real menos TODO lo comprometido (links `pending` de
// `payment-requests` + sesiones vivas de esta vía, RTC-8.2) — y lo re-verifica DESPUÉS de abrir
// la sesión, con compensación si la carrera lo pasó (el par de COR-3).
//
// Por qué SIN `withReservationLock` (a diferencia del alta de links, `charge-ceiling.ts` COR-3):
// `createPayment` emite `onPaymentCreated` → `syncPendingAfterPayment` → `clampRequestsToCeiling`,
// que toma el MISMO lock por la MISMA clave. Con el lock acá adentro, el socket esperaría el lock
// que este frame todavía tiene: `withLock` no es reentrante, es un deadlock prometido. La garantía
// queda en la re-verificación post-commit — puede fallar de más (dos cobros simultáneos, se
// compensa el segundo), nunca de menos (jamás quedan dos sesiones vivas por encima del saldo).

import { ValidationError } from 'arckode-framework'
import type { ChargeCardDTO, CreatePaymentDTO, PaymentDTO } from '../types'
import type { StripeUseCase } from './stripe'
import type { PaymentCrudUseCase } from './payment-crud'
import { StripeService } from '../../../services/stripe-service'

/**
 * El techo del cobro, contestado por `payment-requests` (connector `payments-ceiling`).
 * `excludePaymentId` es para la re-verificación post-commit: el cobro recién creado no se cuenta
 * a sí mismo (simétrico de `excludeRequestId` en `assertCeilingAfterCommit`).
 */
export interface ChargeCeilingPort {
  assertChargeable(params: {
    hotelId: string
    reservationId: string
    amount: number
    excludePaymentId?: string
  }): Promise<void>
}

export interface ChargeCardDeps {
  stripe: StripeUseCase
  crud: PaymentCrudUseCase
  createPayment: (dto: CreatePaymentDTO) => Promise<PaymentDTO>
  /** RTC-8.1 — obligatorio cuando el cobro cuelga de una reserva (fail-closed en el usecase). */
  ceiling?: ChargeCeilingPort
}

export async function chargeCard(
  deps: ChargeCardDeps,
  dto: ChargeCardDTO,
): Promise<{ payment: PaymentDTO; checkoutUrl: string }> {
  const amount = Number(dto.amount)

  // RTC-8.1: sin reserva no hay saldo contra el cual toparse (POS suelto) — el monto positivo lo
  // valida el schema. Con reserva, el techo es obligatorio: un guard ausente era el bypass.
  if (dto.reservationId) {
    if (!deps.ceiling) {
      throw new Error('payments: falta el puerto del techo de cobro (connectors/payments-ceiling no cableado) — no se abre una sesión de reserva sin techo')
    }
    await deps.ceiling.assertChargeable({ hotelId: dto.hotelId, reservationId: dto.reservationId, amount })
  }

  const payment = await deps.createPayment({
    hotelId: dto.hotelId,
    type: 'charge',
    method: 'card',
    amount: dto.amount,
    currency: dto.currency,
    description: dto.description,
    folioId: dto.folioId,
    // Sin esto el cobro con tarjeta de una reprogramación queda sin vínculo con la reserva y es
    // invisible para el techo de `payment-requests` (BUG-ceiling-bypass).
    reservationId: dto.reservationId,
    guestId: dto.guestId,
    // fix-refund-pos-card: `reference`/`metadata` viajaban perdidos — sin ellos, el POS no podía
    // reclamar la idempotencia de idempotencia-settlement-pos ('pos:'+orderId) ni el conector
    // reconocer de qué módulo es el cobro al escuchar onPaymentCompleted/onPaymentExpired.
    reference: dto.reference,
    metadata: dto.metadata,
  } as CreatePaymentDTO)

  // La pasarela se resuelve para ESTE hotel: cobra contra su cuenta, no contra una global.
  if (!(await deps.stripe.isConfigured(dto.hotelId))) {
    throw new ValidationError('El hotel no tiene pasarela de pago configurada — usá efectivo o transferencia')
  }

  const session = await deps.stripe.createCheckoutSession({
    hotelId: dto.hotelId,
    amount: dto.amount,
    currency: dto.currency ?? 'USD',
    description: dto.description,
    // El client_reference_id de la sesión SIEMPRE es el payment.id — es lo que settle-webhook.ts usa
    // para encontrar el payment a confirmar/expirar. dto.reference (ej. 'pos:'+orderId) es la
    // idempotency key del payment en SÍ, un concepto distinto.
    reference: payment.id,
    // RTC-8.4: `reservationId` en la metadata — sin él, la sesión no se puede atribuir a la
    // reserva desde el objeto de Stripe (el alta de links de `payment-requests` sí lo manda).
    metadata: {
      paymentId: payment.id, hotelId: dto.hotelId,
      ...(dto.reservationId ? { reservationId: dto.reservationId } : {}),
      ...(dto.metadata || {}),
    },
    successUrl: dto.successUrl,
    cancelUrl: dto.cancelUrl,
    expiresInMinutes: dto.expiresInMinutes,
  })

  await deps.crud.updateStatus(payment.id, 'processing')
  // RTC-8.3: sin el id de sesión en la fila, el clamp del techo no puede expirarla al recortar.
  await deps.crud.attachSession(payment.id, session.id)

  // RTC-8.1/COR-3: re-verificación con la sesión YA abierta. Si otra vía comprometió el saldo en
  // la carrera, la compensación mata la sesión recién creada y cancela el asiento: la URL que
  // recibió el staff queda muerta en vez de quedar un cobro por encima del saldo.
  if (dto.reservationId && deps.ceiling) {
    try {
      await deps.ceiling.assertChargeable({
        hotelId: dto.hotelId, reservationId: dto.reservationId, amount, excludePaymentId: payment.id,
      })
    } catch (e) {
      await StripeService.expireCheckoutSession(session.id, dto.hotelId)
      await deps.crud.updateStatus(payment.id, 'cancelled')
      throw e
    }
  }

  return { payment, checkoutUrl: session.url }
}
