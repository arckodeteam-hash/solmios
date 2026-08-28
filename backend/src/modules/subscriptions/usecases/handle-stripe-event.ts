// subscriptions/usecases/handle-stripe-event.ts — Webhook de la cuenta de PLATAFORMA.
//
// Distinto de payment-requests/usecases/stripe-webhook.ts: ese verifica con el secret
// POR HOTEL (`/api/stripe/webhook/:hotelId`, cobros a huéspedes). Este verifica con
// `STRIPE_WEBHOOK_SECRET_PLATFORM` (`/api/stripe/webhook/platform`, el hotel pagándole a
// la plataforma) — cuentas y secrets separados a propósito, no se pueden mezclar.
//
// `handleStripeEvent` queda separado de la verificación de firma para poder testearlo con
// payloads de Stripe.Event construidos a mano, sin tener que fabricar una firma HMAC válida.
import type Stripe from 'stripe'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { StripeService } from '../../../services/stripe-service'
import { compareSubscriptions } from './resolve-plan'

/** Stripe expresa los epochs en SEGUNDOS; `Date` los quiere en milisegundos. */
const MS_PER_SECOND = 1000

export interface HandleStripeEventDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  /** Para resolver el email del hotel al mandar los correos de pago/cancelación (#platform-emails). */
  hotelsRepo: RepositoryAdapter<any>
  /**
   * `plans` — para sincronizar el espejo `hotels.plan` al plan PAGADO en checkout.session.completed.
   * Opcional/best-effort: la FUENTE DE VERDAD es la fila de `subscriptions` (que sí se parchea
   * SIEMPRE con el planId pagado); sin esto solo queda desactualizado el espejo legacy.
   */
  plansRepo?: RepositoryAdapter<any>
  logger: Logger
  /** Cliente Stripe ya resuelto (cuenta de plataforma) — usado para retrieve() de la subscription. */
  stripe: Stripe
  /** Envío de los correos de PLATAFORMA (payment_succeeded/payment_failed/subscription_canceled).
   *  Opcional y best-effort: un fallo acá NUNCA puede tumbar el webhook — el dinero ya se cobró. */
  sendPlatformEmail?: (event: string, to: string, hotelId: string, vars: Record<string, string>) => Promise<{ sent: boolean }>
  /**
   * ORM crudo, mismo motivo que admin/usecases/special-conditions.ts: liberar el cupo de
   * Fundador/Pionero en `customer.subscription.deleted` necesita el CAS de `orm.updateMany`
   * (compare-and-swap por `occupiedCount`), no expuesto por RepositoryAdapter. Opcional y
   * best-effort — si no viene, la cancelación igual marca `status:'canceled'`, solo no libera
   * el cupo ni deja rastro en `founder_history` (mejor que tumbar el webhook de Stripe).
   */
  orm?: any
}

// Solo Fundador Uno/Dos dejan rastro anti-recuperación al perderse (PLAN-SUSCRIPCIONES.md §5/§9).
// Pionero libera cupo igual, pero sin founder_history (no tiene esa restricción).
const FOUNDER_KEYS = new Set(['founder_one', 'founder_two'])

/** Mismo CAS que subscription-suspension-cron.ts:releaseSlot — no leer-luego-escribir. */
async function releaseCategorySlot(orm: any, categoryKey: string): Promise<void> {
  const row = (await orm.findMany('SpecialCategoryConfig', { key: categoryKey }))[0]
  if (!row || row.occupiedCount <= 0) return
  await orm.updateMany(
    'SpecialCategoryConfig',
    { key: categoryKey, occupiedCount: row.occupiedCount },
    { occupiedCount: row.occupiedCount - 1, status: row.status === 'full' ? 'open' : row.status },
  )
}

/**
 * Cierra la categoría especial de un hotel que canceló su suscripción por completo (§4: "cancela
 * suscripción o queda suspended → none + founder_history{reason} + libera 1 cupo"). El caso
 * "queda suspended por mora" ya lo cubre subscription-suspension-cron.ts — esta es la otra mitad
 * del diagrama, la cancelación explícita (customer.subscription.deleted), que antes no tocaba
 * `specialCategory` ni liberaba el cupo: un Fundador que cancelaba se quedaba "ocupando" su cupo
 * para siempre y sin founder_history, permitiendo re-calificar más tarde sin haber perdido nada.
 */
async function releaseSpecialCategoryOnCancel(
  orm: any, hotelId: string, subscriptionId: string, category: string, now: Date,
): Promise<void> {
  if (FOUNDER_KEYS.has(category)) {
    await orm.create('FounderHistory', {
      hotelId, category, lostAt: now.toISOString(), reason: 'canceled',
    })
  }
  await releaseCategorySlot(orm, category)
  const activeDiscounts = (await orm.findMany('SubscriptionDiscounts', {
    subscriptionId, type: 'category_bonus', status: 'active',
  })) as any[]
  for (const d of activeDiscounts) {
    await orm.update('SubscriptionDiscounts', d.id, { status: 'revoked', endsAt: d.endsAt ?? now.toISOString() })
  }
}

/** Link a la pantalla de suscripción del panel, mismo patrón que create-checkout-session.ts. */
function subscriptionLink(): string {
  return `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/panel/suscripcion`
}

/**
 * Manda el correo de PLATAFORMA best-effort: resuelve el hotel, y si tiene email, dispara el
 * evento. Cualquier error (hotel no encontrado, sender caído) se loguea y se descarta — el
 * webhook de Stripe ya hizo lo importante (mover el status de la suscripción).
 */
async function notifyPlatformEmail(
  deps: HandleStripeEventDeps,
  event: string,
  hotelId: string,
  vars: Record<string, string>,
): Promise<void> {
  if (!deps.sendPlatformEmail) return
  try {
    // @ignore IDOR_RISK — hotelId sale de la Subscription local ya resuelta por stripeSubscriptionId,
    // no de un parámetro de request del cliente.
    const hotel = await deps.hotelsRepo.findById(hotelId)
    if (!hotel?.email) return
    await deps.sendPlatformEmail(event, hotel.email, hotel.id, { hotel_name: hotel.name, ...vars })
  } catch (e) {
    deps.logger.warn(`platform-emails: no se pudo enviar "${event}"`, { hotelId, error: (e as Error).message })
  }
}

/**
 * `Subscription.current_period_end` ya no es un campo de la Subscription: la API version
 * 2025-08-27 (la que usa StripeService, ver stripe-service.ts) lo movió a cada
 * SubscriptionItem — una suscripción puede tener ítems con períodos de facturación
 * distintos. Este proyecto vende un plan = un ítem, así que el primero alcanza.
 */
function currentPeriodEndOf(sub: Stripe.Subscription): string | undefined {
  const end = sub.items?.data?.[0]?.current_period_end
  return typeof end === 'number' ? new Date(end * MS_PER_SECOND).toISOString() : undefined
}

/**
 * Misma migración de API version: `Invoice.subscription` ya no existe — el vínculo vive en
 * `invoice.parent.subscription_details.subscription` cuando el parent es una suscripción.
 */
function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | undefined {
  const sub = invoice.parent?.subscription_details?.subscription
  if (!sub) return undefined
  return typeof sub === 'string' ? sub : sub.id
}

/** Procesa UN evento ya verificado. No lanza para eventos desconocidos: los ignora (200 OK). */
export async function handleStripeEvent(deps: HandleStripeEventDeps, event: Stripe.Event): Promise<void> {
  const { subscriptionsRepo, logger, stripe } = deps

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== 'subscription') break // one-off payments no son de este módulo

      const hotelId = session.metadata?.hotelId
      if (!hotelId) {
        logger.warn('checkout.session.completed sin hotelId en metadata', { sessionId: session.id })
        break
      }
      // R3-4a: MISMO orden determinista que resolve-plan (compareSubscriptions). Antes
      // `findMany({hotelId})[0]` tomaba la primera que devolvía la base: con varias filas
      // (doble alta / migración) el pago parcheaba una fila distinta de la que el gate
      // resuelve — el hotel pagaba y seguía gateado con la matriz de la otra.
      const rows = ((await subscriptionsRepo.findMany({ hotelId })) as any[]) ?? []
      const sub = [...rows].sort(compareSubscriptions)[0]
      if (!sub) {
        logger.warn(`checkout.session.completed: no hay Subscription local para el hotel ${hotelId}`)
        break
      }

      // #28: con el alta que exige tarjeta, el Checkout arranca la prueba EN Stripe
      // (`trial_period_days`), así que la suscripción vuelve en `trialing`, no en `active`.
      // Forzar 'active' acá le daba al hotel un período pago que nadie cobró todavía y borraba
      // el trial local. El status real lo dice Stripe más abajo, cuando se lee la Subscription;
      // 'active' queda solo como valor por defecto para el Checkout sin prueba de siempre.
      const patch: Record<string, any> = { status: 'active' }
      // El plan PAGADO manda. El trial pudo arrancar con un plan y pagar OTRO (el Checkout
      // se arma contra el plan elegido al pagar): recién acá, con el pago confirmado, la
      // suscripción queda apuntando al plan real. create-checkout-session no lo toca antes
      // a propósito — hasta el cobro el trial sigue probando lo que probaba.
      const paidPlanId = String(session.metadata?.planId ?? '') || sub.planId
      if (paidPlanId && paidPlanId !== sub.planId) patch.planId = paidPlanId
      if (session.customer) {
        patch.stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer.id
      }
      const stripeSubscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id
      if (stripeSubscriptionId) {
        patch.stripeSubscriptionId = stripeSubscriptionId
        // Checkout Session mode:'subscription' = el hotel autorizó el cobro automático con
        // tarjeta (es lo único que create-checkout-session.ts ofrece hoy, no hay un flujo de
        // "pago manual" separado). Sin esto `isRecurring` quedaba en `false` para siempre
        // (default del modelo) y subscription-suspension-cron.ts mandaba SIEMPRE el mensaje de
        // "pagá vos" (#540) en vez de "se cobrará solo" (#539) aunque la tarjeta estuviera cargada.
        patch.isRecurring = true
        // La tarjeta quedó guardada: es lo que `access.ts` mira para dejar correr la prueba
        // cuando la plataforma la exige (#28). Se sella acá y no en el alta porque el alta
        // todavía no vio ninguna tarjeta — recién Stripe confirma que existe.
        patch.paymentMethodAddedAt = new Date().toISOString()
        try {
          const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
          const periodEnd = currentPeriodEndOf(stripeSub)
          if (periodEnd) patch.currentPeriodEnd = periodEnd
          // Checkout con prueba: Stripe devuelve `trialing` y la fecha real de fin. Se copian
          // los dos, para que el corte local (access.ts) y el de Stripe digan lo mismo.
          if (stripeSub.status === 'trialing') {
            patch.status = 'trialing'
            if (stripeSub.trial_end) patch.trialEndsAt = new Date(stripeSub.trial_end * 1000).toISOString()
          }
        } catch (e) {
          logger.warn('No se pudo leer current_period_end de la Subscription de Stripe', { error: (e as Error).message })
        }
      }

      await subscriptionsRepo.update(sub.id, patch)
      logger.info('Suscripción activada por checkout', { hotelId, stripeSubscriptionId })

      // Espejo legacy: `hotels.plan` se sincroniza al plan pagado. El gate de módulos ya lee
      // la suscripción (resolve-plan.ts), pero dashboards y lectores viejos siguen mirando el
      // espejo — dos lectores no pueden discrepar sobre el plan del hotel. Best-effort: si
      // falla, la suscripción (fuente de verdad) ya quedó bien y solo el espejo queda viejo.
      if (deps.plansRepo && paidPlanId) {
        try {
          const plan = ((await deps.plansRepo.findMany({ id: paidPlanId })) as any[])?.[0]
          if (plan?.slug) await deps.hotelsRepo.update(hotelId, { plan: String(plan.slug) })
        } catch (e) {
          logger.warn('No se pudo sincronizar hotels.plan tras el checkout', { hotelId, error: (e as Error).message })
        }
      }
      break
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const stripeSubscriptionId = subscriptionIdOfInvoice(invoice)
      if (!stripeSubscriptionId) break

      const sub = (await subscriptionsRepo.findMany({ stripeSubscriptionId }))[0] as any
      if (!sub) {
        logger.warn(`invoice.paid: no hay Subscription local para ${stripeSubscriptionId}`)
        break
      }

      // Limpia gracia/suspensión: es la única puerta de reactivación real (pago confirmado).
      // Sin esto, un hotel que paga tras quedar `suspended` vuelve a `active` con basura en
      // graceEndsAt/suspendedAt/suspendedReason — subscription-suspension-cron los ignora
      // porque solo mira status, pero quedan mintiendo en el detalle admin.
      const wasBlocked = sub.status === 'past_due' || sub.status === 'suspended'
      const patch: Record<string, any> = {
        status: 'active',
        ...(wasBlocked ? { graceEndsAt: null, suspendedAt: null, suspendedReason: null } : {}),
      }
      try {
        const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
        const periodEnd = currentPeriodEndOf(stripeSub)
        if (periodEnd) patch.currentPeriodEnd = periodEnd
      } catch (e) {
        logger.warn('No se pudo leer current_period_end tras invoice.paid', { error: (e as Error).message })
      }
      await subscriptionsRepo.update(sub.id, patch)
      logger.info('Suscripción renovada', { stripeSubscriptionId })
      // plan_name/amount no tienen dato fácil acá sin otro fetch a Stripe (line_items del invoice):
      // se dejan vacíos a propósito, sin agregar complejidad (ver instrucciones de la tarea).
      await notifyPlatformEmail(deps, 'payment_succeeded', sub.hotelId, { plan_name: '', amount: '', link: subscriptionLink() })
      if (wasBlocked) await notifyPlatformEmail(deps, 'subscription_reactivated', sub.hotelId, { link: subscriptionLink() })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const stripeSubscriptionId = subscriptionIdOfInvoice(invoice)
      if (!stripeSubscriptionId) break

      const sub = (await subscriptionsRepo.findMany({ stripeSubscriptionId }))[0] as any
      if (!sub) {
        logger.warn(`invoice.payment_failed: no hay Subscription local para ${stripeSubscriptionId}`)
        break
      }
      await subscriptionsRepo.update(sub.id, { status: 'past_due' })
      logger.warn('Cobro de suscripción falló', { stripeSubscriptionId })
      await notifyPlatformEmail(deps, 'payment_failed', sub.hotelId, { plan_name: '', amount: '', link: subscriptionLink() })
      break
    }

    case 'customer.subscription.updated': {
      const stripeSub = event.data.object as Stripe.Subscription
      const sub = (await subscriptionsRepo.findMany({ stripeSubscriptionId: stripeSub.id }))[0] as any
      if (!sub) {
        logger.warn(`customer.subscription.updated: no hay Subscription local para ${stripeSub.id}`)
        break
      }
      // Upgrade/downgrade desde el portal de Stripe cambia el price del ítem: la fila local
      // y el espejo tienen que seguir al plan PAGADO o el hotel queda gateado con el plan
      // viejo para siempre (nadie más vuelve a tocar planId). Los cambios de ESTADO no se
      // sincronizan acá: trialing/active/past_due/canceled llegan por invoice.paid /
      // invoice.payment_failed / customer.subscription.deleted, que además mandan los mails.
      const priceId = stripeSub.items?.data?.[0]?.price?.id
      // R3-4b: ítem sin price (o price sin id) no se puede mapear a plan — antes cortaba en
      // silencio y el plan local dejaba de sincronizarse sin que quede rastro. WARN antes de cortar.
      if (typeof priceId !== 'string') {
        logger.warn('customer.subscription.updated: el ítem no trae price — no se puede sincronizar el plan local', {
          stripeSubscriptionId: stripeSub.id, priceId: priceId ?? null,
        })
        break
      }
      if (!deps.plansRepo) break
      const plan = ((await deps.plansRepo.findMany({ stripePriceId: priceId })) as any[])?.[0]
      if (!plan) {
        logger.warn('customer.subscription.updated: el price de Stripe no matchea ningún plan local', {
          stripeSubscriptionId: stripeSub.id, priceId,
        })
        break
      }
      if (String(plan.id) === sub.planId) break // ya apunta al plan pagado: nada que sincronizar
      await subscriptionsRepo.update(sub.id, { planId: String(plan.id) })
      logger.info('Plan de la suscripción actualizado desde Stripe', { hotelId: sub.hotelId, planId: plan.id })
      // Espejo legacy, mismo best-effort que checkout.session.completed: la fuente de verdad
      // (la suscripción) ya quedó bien; si esto falla solo el espejo queda viejo.
      try {
        if (plan.slug) await deps.hotelsRepo.update(sub.hotelId, { plan: String(plan.slug) })
      } catch (e) {
        logger.warn('No se pudo sincronizar hotels.plan tras customer.subscription.updated', { hotelId: sub.hotelId, error: (e as Error).message })
      }
      break
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as Stripe.Subscription
      const sub = (await subscriptionsRepo.findMany({ stripeSubscriptionId: stripeSub.id }))[0] as any
      if (!sub) {
        logger.warn(`customer.subscription.deleted: no hay Subscription local para ${stripeSub.id}`)
        break
      }
      const now = new Date()
      const patch: Record<string, any> = { status: 'canceled', canceledAt: now.toISOString() }
      if (sub.specialCategory) {
        patch.specialCategory = null
        patch.specialCategoryGrantedAt = null
      }
      await subscriptionsRepo.update(sub.id, patch)
      logger.info('Suscripción cancelada', { stripeSubscriptionId: stripeSub.id })

      // Best-effort: si no hay `orm` cableado, la cancelación igual quedó registrada arriba —
      // solo no se libera el cupo ni se deja rastro anti-recuperación (ver comment del dep).
      if (sub.specialCategory && deps.orm) {
        try {
          await releaseSpecialCategoryOnCancel(deps.orm, sub.hotelId, sub.id, sub.specialCategory, now)
        } catch (e: any) {
          logger.warn('No se pudo liberar la categoría especial al cancelar', { hotelId: sub.hotelId, error: e.message })
        }
      }

      await notifyPlatformEmail(deps, 'subscription_canceled', sub.hotelId, { link: subscriptionLink() })
      break
    }

    default:
      break // evento no manejado: se ignora, 200 OK igual (patrón estándar de webhooks)
  }
}

export interface WebhookErrorResult {
  status: number
  body: { error: string; detail?: string }
}

/** Verifica la firma contra el secret de PLATAFORMA y despacha el evento. */
export async function processSubscriptionWebhook(
  deps: Omit<HandleStripeEventDeps, 'stripe'>,
  rawBody: string | Buffer,
  signature: string,
): Promise<{ received: true } | WebhookErrorResult> {
  const { logger } = deps
  const secret = process.env.STRIPE_WEBHOOK_SECRET_PLATFORM
  if (!secret) return { status: 503, body: { error: 'Webhook de plataforma no configurado (falta STRIPE_WEBHOOK_SECRET_PLATFORM)' } }
  if (!signature) return { status: 400, body: { error: 'Falta stripe-signature' } }

  const stripe = await StripeService.getClient()
  if (!stripe) return { status: 503, body: { error: 'Stripe no está configurado en la plataforma' } }

  let event: Stripe.Event
  try {
    // `constructEventAsync`, NO `constructEvent`: bajo Bun el sincrónico lanza
    // "SubtleCryptoProvider cannot be used in a synchronous context" — mismo motivo que
    // payment-requests/usecases/stripe-webhook.ts.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret)
  } catch (e: any) {
    logger.warn('Stripe platform webhook signature failed', { error: e.message })
    return { status: 400, body: { error: 'Firma inválida', detail: e.message } }
  }

  try {
    await handleStripeEvent({ ...deps, stripe }, event)
    return { received: true }
  } catch (e: any) {
    logger.error('Stripe platform webhook handler failed', e)
    return { status: 500, body: { error: 'Internal error' } }
  }
}
