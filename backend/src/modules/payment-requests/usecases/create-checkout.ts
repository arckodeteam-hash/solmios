// payment-requests/usecases/create-checkout.ts — Genera la Checkout Session de Stripe para un
// PaymentRequest, asienta el link, audita, y (si el request lo pide) envía el link por email.
// Extraído del service para no pasar de 200 líneas (gate arckode).
//
// GH-0.3: un cobro tiene A LO SUMO UNA sesión viva. Antes esta función pisaba `stripeSessionId` con
// la sesión nueva y NUNCA expiraba la anterior, así que cada click del botón del modal dejaba otro
// link pagable por el mismo importe — invisibles al techo agregado, que cuenta filas `pending` y no
// sesiones. Ahora: si la sesión previa sigue abierta por el MISMO monto se devuelve esa (el
// "mismo cobro, misma sesión" que el modal promete); si cambió el monto, se expira antes de emitir
// la nueva. Ver `usecases/live-session.ts`.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { StripeService } from '../../../services/stripe-service'
import type { EmailSender } from '../../../services/email-sender'
import { sendPaymentLinkEmail } from './payment-link-email'
import { reusableSession } from './live-session'
import { checkoutSessionCreatedEntry, type AuditEntry } from './audit'
import type { PaymentRequestDTO, CheckoutResult, CurrentUser } from '../types'

const DEFAULT_PORT = 3000

export interface CreateCheckoutDeps {
  repo: RepositoryAdapter<PaymentRequestDTO>
  reservationRepo: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  hotelRepoForEmail: RepositoryAdapter<any> | null
  emailSender: EmailSender | null
  audit: (entry: AuditEntry) => Promise<void>
  logger: Logger
}

/**
 * El caller ya validó Stripe configurado, ownership y que no esté pagado.
 *
 * GH-0.4: el tenant es UNO y sale de la fila — `pr.hotelId`. Antes `service.createCheckout`
 * mezclaba dos: `hotelOfUser(user)` (el hotel del JWT) para `isConfigured` y para la cuenta Stripe
 * con la que se emitía la sesión, y `pr.hotelId` para el techo del monto y para `metadata.hotelId`.
 * Un `super_admin` con `hotelId` propio distinto pasa `assertOwnership`, así que emitía la sesión
 * contra las llaves del hotel equivocado; el webhook llega por `/api/stripe/webhook/:hotelId` a ESE
 * hotel y `stripe-webhook.ts` lo rechaza con 403 comparando `pr.hotelId`. Resultado: el huésped
 * pagaba y el cobro no se asentaba en ningún lado.
 */
export async function createCheckoutForRequest(
  deps: CreateCheckoutDeps, pr: PaymentRequestDTO, id: string, origin: string, user: CurrentUser,
): Promise<CheckoutResult | { status: number; body: any }> {
  const hotelId = pr.hotelId
  const fallbackOrigin = `http://localhost:${process.env.PORT || DEFAULT_PORT}`
  const guestEmail = pr.sentTo?.includes('@') ? pr.sentTo : undefined
  try {
    // Una sola sesión viva por cobro: reutilizar la abierta o matarla antes de crear otra.
    const reusable = await reusableSession(pr)
    if (reusable) return reusable
    const result = await StripeService.createCheckoutSession({
      hotelId, paymentRequestId: id, amount: Number(pr.amount), currency: pr.currency || 'usd',
      description: `Reserva ${String(pr.reservationId || '').slice(0, 8)}`,
      successUrl: `${origin || fallbackOrigin}/panel/finanzas/links-pago?status=paid&id=${id}`,
      cancelUrl: `${origin || fallbackOrigin}/panel/finanzas/links-pago?status=cancelled&id=${id}`,
      customerEmail: guestEmail, metadata: { hotelId, reservationId: pr.reservationId || '' },
    })
    await deps.repo.update(id, { stripeSessionId: result.sessionId, stripePaymentUrl: result.sessionUrl } as Partial<PaymentRequestDTO>)
    await deps.audit(checkoutSessionCreatedEntry(pr, result.sessionId, user))
    // Link por email si el request lo pide (sentVia='email') y es la 1ª generación (no re-spamear al
    // regenerar). Fire-and-forget: un fallo de correo no tumba la creación del checkout.
    if (deps.emailSender && deps.hotelRepoForEmail && !pr.stripePaymentUrl) {
      sendPaymentLinkEmail(
        { emailSender: deps.emailSender, hotelRepo: deps.hotelRepoForEmail, reservationRepo: deps.reservationRepo, guestRepo: deps.userRepo, logger: deps.logger },
        pr, result.sessionUrl,
      ).catch((e) => deps.logger.warn('payment-link email', { error: (e as Error).message }))
    }
    return { url: result.sessionUrl, sessionId: result.sessionId }
  } catch (e: any) {
    deps.logger.error('Stripe create checkout failed', e)
    return { status: 500, body: { error: 'Error al crear sesión de pago', detail: e.message } }
  }
}
