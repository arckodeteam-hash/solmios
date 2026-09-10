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
import { upsertPlatformInvoice, type PlatformInvoiceStatus } from './upsert-platform-invoice'

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
  /**
   * `platform_invoices` — el historial de cobros de la plataforma (REQ-BIL-02). Opcional y
   * best-effort a propósito: lo que no puede fallar acá es el status de la suscripción y el
   * correo. Si la escritura del historial rompe, se loguea y el webhook igual devuelve 200 —
   * un 500 haría que Stripe reintente y el hotel reciba el mismo correo de cobro otra vez.
   */
  platformInvoicesRepo?: RepositoryAdapter<any>
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

/**
 * Guarda/actualiza la fila de `platform_invoices` de esta factura. Best-effort: ver el comentario
 * de `platformInvoicesRepo`. El dueño (hotel/suscripción) sale de la fila local ya resuelta por
 * `stripeSubscriptionId`, nunca del payload de Stripe.
 */
async function persistPlatformInvoice(
  deps: HandleStripeEventDeps, invoice: Stripe.Invoice, sub: any, status: PlatformInvoiceStatus,
): Promise<void> {
  if (!deps.platformInvoicesRepo) return
  try {
    await upsertPlatformInvoice(
      { platformInvoicesRepo: deps.platformInvoicesRepo, plansRepo: deps.plansRepo, logger: deps.logger },
      invoice,
      { hotelId: sub.hotelId, subscriptionId: sub.id },
      status,
    )
  } catch (e) {
    deps.logger.warn('platform_invoices: no se pudo registrar la factura', {
      stripeInvoiceId: invoice.id, status, error: (e as Error).message,
    })
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

/**
 * El plan local sigue al price del ítem de Stripe SOLO cuando ese ítem está PAGADO (#92).
 *
 * Con un método de pago de confirmación diferida (ACH/SEPA Direct Debit) `subscriptions.update`
 * con `error_if_incomplete` vuelve con el ítem ya movido y el PaymentIntent en `processing`: la
 * factura del prorrateo queda `open` durante días. Si ese cobro después falla, Stripe anula la
 * factura pero NO devuelve el ítem al price viejo. Sincronizar `planId` desde el ítem sin mirar
 * la factura —lo que hacía `customer.subscription.updated` hasta #92— le daba al hotel el plan
 * caro sin haberlo pagado, y `invoice.payment_failed` sólo movía el status a `past_due`.
 *
 * `pending_if_incomplete` (los "pending updates" de Stripe) NO resuelve este caso: Stripe los
 * soporta sólo para tarjeta, Link y billeteras — ACH y SEPA quedan explícitamente afuera
 * (docs.stripe.com/billing/subscriptions/pending-updates, "Before you begin"). Por eso el
 * modelo es el otro que proponía #92: el ítem se mueve en Stripe, pero **el plan local recién
 * cambia cuando la factura que lo paga está `paid`**. Tres escritores, una sola regla:
 *
 *  - `upgrade-plan.ts` refleja el plan sólo si `latest_invoice.status === 'paid'`.
 *  - `customer.subscription.updated` sincroniza sólo si `latest_invoice` está paga (o no hay
 *    factura que pagar: un cambio desde el Billing Portal con `create_prorations` no emite
 *    factura y la última sigue siendo la renovación ya cobrada).
 *  - `invoice.paid` sincroniza el plan del ítem cuando la factura pagada es la última de la
 *    suscripción: es la puerta por la que entra el ACH/SEPA que se confirmó días después.
 *
 * Un cobro que falla deja el ítem donde Stripe lo dejó y el plan local donde estaba (el hotel
 * sigue gateado con lo que pagó). No se revierte el ítem en Stripe desde el webhook: Stripe
 * reintenta esa factura con su dunning y, si al final entra, `invoice.paid` aplica el plan; si
 * la próxima renovación sale al price nuevo y se paga, también. Devolver el ítem a mano
 * competiría con esos reintentos y podría dejar un cobro sin plan. Queda un WARN con la
 * divergencia para que el super-admin la vea (`invoice.payment_failed`).
 */
async function planOfStripeItem(
  deps: HandleStripeEventDeps, stripeSub: Stripe.Subscription, origin: string,
): Promise<any | null> {
  const priceId = stripeSub.items?.data?.[0]?.price?.id
  // R3-4b: ítem sin price (o price sin id) no se puede mapear a plan — antes cortaba en
  // silencio y el plan local dejaba de sincronizarse sin que quede rastro. WARN antes de cortar.
  if (typeof priceId !== 'string') {
    deps.logger.warn(`${origin}: el ítem no trae price — no se puede sincronizar el plan local`, {
      stripeSubscriptionId: stripeSub.id, priceId: priceId ?? null,
    })
    return null
  }
  if (!deps.plansRepo) return null
  const plan = ((await deps.plansRepo.findMany({ stripePriceId: priceId })) as any[])?.[0]
  if (!plan) {
    deps.logger.warn(`${origin}: el price de Stripe no matchea ningún plan local`, {
      stripeSubscriptionId: stripeSub.id, priceId,
    })
    return null
  }
  return plan
}

/** Escribe `planId` (fuente de verdad) y el espejo legacy `hotels.plan`. Idempotente. */
async function reflectPaidPlan(
  deps: HandleStripeEventDeps, sub: any, plan: any, origin: string,
): Promise<void> {
  if (String(plan.id) === sub.planId) return // ya apunta al plan pagado: nada que sincronizar
  await deps.subscriptionsRepo.update(sub.id, { planId: String(plan.id) })
  deps.logger.info('Plan de la suscripción actualizado desde Stripe', { hotelId: sub.hotelId, planId: plan.id, origin })
  // Espejo legacy, mismo best-effort que checkout.session.completed: la fuente de verdad
  // (la suscripción) ya quedó bien; si esto falla solo el espejo queda viejo.
  try {
    if (plan.slug) await deps.hotelsRepo.update(sub.hotelId, { plan: String(plan.slug) })
  } catch (e) {
    deps.logger.warn(`No se pudo sincronizar hotels.plan tras ${origin}`, { hotelId: sub.hotelId, error: (e as Error).message })
  }
}

/** Id de `latest_invoice` tal como viene (string en los webhooks, objeto si se expandió). */
function latestInvoiceIdOf(stripeSub: Stripe.Subscription): string | null {
  const latest = stripeSub.latest_invoice
  if (!latest) return null
  return typeof latest === 'string' ? latest : latest.id
}

/**
 * ¿La última factura de la suscripción está paga? Sin factura no hay nada que pagar (`true`).
 * Lee la factura de Stripe: en los webhooks `latest_invoice` viene como id. Si la lectura falla
 * LANZA — el handler devuelve 500 y Stripe reintenta el evento; dar el plan por pagado ante un
 * timeout sería justo el hueco que #92 cierra, y dar por no pagado lo dejaría sin sincronizar
 * hasta la próxima factura.
 */
async function latestInvoiceIsPaid(stripe: Stripe, stripeSub: Stripe.Subscription): Promise<boolean> {
  const latest = stripeSub.latest_invoice
  if (!latest) return true
  const invoice = typeof latest === 'string' ? await stripe.invoices.retrieve(latest) : latest
  return invoice.status === 'paid'
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
      // Si Stripe no responde, se LANZA antes de escribir nada: el 500 hace que Stripe reintente
      // el evento (misma política que `latestInvoiceIsPaid`). Antes se tragaba con un WARN y
      // seguía — con #92 eso dejaba sin plan a un ACH confirmado días después: no hay ningún
      // evento posterior que lo repare hasta la próxima renovación. Reintentar es seguro: todo lo
      // de abajo es idempotente y todavía no salió ningún correo.
      let stripeSub: Stripe.Subscription
      try {
        stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
      } catch (e) {
        logger.warn('invoice.paid: no se pudo leer la Subscription de Stripe — se devuelve error para que Stripe reintente', {
          stripeSubscriptionId, error: (e as Error).message,
        })
        throw e
      }
      const periodEnd = currentPeriodEndOf(stripeSub)
      if (periodEnd) patch.currentPeriodEnd = periodEnd
      await subscriptionsRepo.update(sub.id, patch)
      logger.info('Suscripción renovada', { stripeSubscriptionId })
      // #92: la factura pagada es la que habilita el plan del ítem. Es la puerta por la que entra
      // un cambio de plan cobrado por ACH/SEPA (confirmado días después del update) y el cambio
      // desde el portal de un hotel que estaba `past_due`. Sólo si esta factura es la ÚLTIMA de la
      // suscripción: pagar una factura vieja mientras el prorrateo nuevo sigue `open` no confirma
      // nada. Va ANTES del correo: si la escritura falla, el 500 hace que Stripe reintente el
      // evento sin haber mandado el mail de cobro dos veces.
      const latestId = latestInvoiceIdOf(stripeSub)
      if (!latestId || latestId === invoice.id) {
        const plan = await planOfStripeItem(deps, stripeSub, event.type)
        if (plan) await reflectPaidPlan(deps, sub, plan, event.type)
      }
      // REQ-BIL-02: el cobro queda en el historial. Si `invoice.finalized` no llegó (o el endpoint
      // de Stripe no lo tiene habilitado), el UPSERT crea la fila directamente en `paid`.
      await persistPlatformInvoice(deps, invoice, sub, 'paid')
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
      // #92: si lo que falló fue el prorrateo de un cambio de plan (ACH/SEPA que rebotó días
      // después), Stripe dejó el ítem en el price nuevo y el plan local sigue en el pagado. No se
      // revierte nada acá (ver planOfStripeItem): se deja la divergencia a la vista. Best-effort,
      // una lectura más a Stripe que no puede tumbar el webhook.
      try {
        const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
        const plan = await planOfStripeItem(deps, stripeSub, event.type)
        if (plan && String(plan.id) !== sub.planId) {
          logger.warn('invoice.payment_failed: el cobro del cambio de plan falló — Stripe quedó en el plan nuevo y el hotel sigue con el que pagó', {
            hotelId: sub.hotelId, stripeSubscriptionId, stripePlanId: String(plan.id), localPlanId: sub.planId ?? null,
            invoiceId: invoice.id,
          })
        }
      } catch (e) {
        logger.warn('invoice.payment_failed: no se pudo comparar el plan de Stripe con el local', { stripeSubscriptionId, error: (e as Error).message })
      }
      // `failed` es nuestro, no de Stripe (allá la factura sigue `open`): es lo que el super-admin
      // necesita ver para poder reclamarlo (REQ-BIL-05).
      await persistPlatformInvoice(deps, invoice, sub, 'failed')
      await notifyPlatformEmail(deps, 'payment_failed', sub.hotelId, { plan_name: '', amount: '', link: subscriptionLink() })
      break
    }

    case 'invoice.finalized':
    case 'invoice.voided': {
      // Estos dos eventos NO mueven el status de la suscripción ni mandan correos: existen solo
      // para que el historial de `/admin/billing` tenga la factura desde que se emite (y no
      // recién cuando se paga) y para que una anulada deje de figurar como pendiente.
      const invoice = event.data.object as Stripe.Invoice
      const stripeSubscriptionId = subscriptionIdOfInvoice(invoice)
      if (!stripeSubscriptionId) break

      const sub = (await subscriptionsRepo.findMany({ stripeSubscriptionId }))[0] as any
      if (!sub) {
        logger.warn(`${event.type}: no hay Subscription local para ${stripeSubscriptionId}`)
        break
      }
      await persistPlatformInvoice(deps, invoice, sub, event.type === 'invoice.voided' ? 'void' : 'open')
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
      const plan = await planOfStripeItem(deps, stripeSub, event.type)
      if (!plan) break
      if (String(plan.id) === sub.planId) break // ya apunta al plan pagado: nada que sincronizar
      // #92: el ítem movido no alcanza — la factura que lo paga tiene que estar `paid`. Con
      // ACH/SEPA el prorrateo queda `open` días; hasta que entre (`invoice.paid`) el hotel sigue
      // con el plan que sí pagó. Se lee la factura SÓLO cuando hay un cambio de plan que aplicar.
      if (!(await latestInvoiceIsPaid(stripe, stripeSub))) {
        logger.info('customer.subscription.updated: cambio de plan con cobro sin confirmar — el plan local espera invoice.paid', {
          hotelId: sub.hotelId, planId: String(plan.id), currentPlanId: sub.planId ?? null,
          stripeSubscriptionId: stripeSub.id, latestInvoiceId: latestInvoiceIdOf(stripeSub),
        })
        break
      }
      await reflectPaidPlan(deps, sub, plan, event.type)
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
