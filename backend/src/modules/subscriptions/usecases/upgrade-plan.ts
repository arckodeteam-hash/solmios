// subscriptions/usecases/upgrade-plan.ts — El HOTEL mejora su plan pagando SOLO la diferencia.
//
// #46: hasta acá el hotel no podía mejorar su plan por su cuenta. Con una suscripción viva,
// `create-checkout-session.ts` corta con 409 a propósito (BUG-9: un Checkout `mode:'subscription'`
// nuevo crea una SEGUNDA suscripción en Stripe que cobra en paralelo y huérfana la vieja), y el
// Billing Portal cambia el plan pero no es el flujo que pide el issue. El camino correcto es
// `stripe.subscriptions.update()` sobre el ÍTEM que ya existe: es la API que prorratea y factura
// exactamente la diferencia — "pagando lo que falta de su suscripción", textual del issue.
//
// Cuenta de PLATAFORMA: `StripeService.getClient()` SIN hotelId, mismo criterio que el checkout —
// con hotelId resolvería las keys DEL HOTEL, que son las que cobran a sus huéspedes.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ValidationError, NotFoundError, ConflictError } from 'arckode-framework'
import type Stripe from 'stripe'
import { StripeService } from '../../../services/stripe-service'
import { WORKING_STATUSES } from './access'
import { compareSubscriptions } from './resolve-plan'
import { changeHotelPlan } from './change-plan'
import type { UpgradePreviewDTO, UpgradeResultDTO } from '../types'

export interface UpgradePlanDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  hotelsRepo: RepositoryAdapter<any>
  plansRepo: RepositoryAdapter<any>
  logger: Logger
}

const MS_PER_SECOND = 1000
/** Ventana de deduplicación cuando la fila no trae `updatedAt`. Corta a propósito: sólo tiene que
 *  cubrir la ráfaga de pedidos concurrentes (dos pestañas, un doble clic), no congelar la
 *  operación — las claves de idempotencia de Stripe viven 24h y no queremos bloquear tanto. */
const VENTANA_DEDUP_MS = 60_000

/** Todo lo que las dos operaciones necesitan resolver ANTES de tocar plata. */
interface UpgradeContext {
  stripe: Stripe
  /** Fila local de `subscriptions` elegida con el MISMO criterio que el gate. */
  active: any
  /** La suscripción tal como está HOY en Stripe: de acá sale el ítem a mover. */
  stripeSub: Stripe.Subscription
  itemId: string
  plan: any
  currentPlan: any
}

/**
 * Cuánto pagaría HOY el hotel por mejorar su plan. No cobra ni cambia nada: es la cifra que el
 * panel muestra antes de que la persona confirme.
 */
export async function previewUpgrade(
  deps: UpgradePlanDeps, hotelId: string, planId: string,
): Promise<UpgradePreviewDTO> {
  const { stripe, active, stripeSub, itemId, plan, currentPlan } = await loadUpgrade(deps, hotelId, planId)

  // `invoices.createPreview` = la factura que Stripe EMITIRÍA con este cambio, sin emitirla.
  // Ojo con la versión: en stripe-node v22 `invoices.retrieveUpcoming` YA NO EXISTE, esta es su
  // reemplazante. El `proration_behavior` tiene que ser el MISMO que usa `applyUpgrade` o el
  // número que se muestra no sería el que después se cobra.
  const preview = await stripe.invoices.createPreview({
    subscription: String(active.stripeSubscriptionId),
    subscription_details: {
      items: [{ id: itemId, price: String(plan.stripePriceId) }],
      proration_behavior: 'always_invoice',
    },
  })

  return {
    planId: String(plan.id),
    planName: String(plan.name ?? ''),
    amountDue: Number(preview.amount_due ?? 0),
    currency: currencyOf(preview.currency, plan),
    currentPlanId: String(currentPlan.id),
    currentPlanName: String(currentPlan.name ?? ''),
    periodEnd: periodEndOf(stripeSub, active),
  }
}

/**
 * Aplica la mejora y cobra la diferencia en el acto. Devuelve el estado REAL de la factura: el
 * cobro puede fallar y este resultado no lo tapa (ver el comentario del `payment_behavior`).
 */
export async function applyUpgrade(
  deps: UpgradePlanDeps, hotelId: string, planId: string,
): Promise<UpgradeResultDTO> {
  const { logger } = deps
  const { stripe, active, itemId, plan } = await loadUpgrade(deps, hotelId, planId)

  // `proration_behavior: 'always_invoice'` emite la factura del prorrateo YA y la cobra con el
  // método guardado: es lo que hace que el hotel pague "lo que falta" hoy y no en la próxima
  // renovación. `payment_behavior: 'allow_incomplete'`: si la tarjeta rechaza, el cambio de plan
  // queda hecho, la factura queda ABIERTA y Stripe manda `invoice.payment_failed` → el webhook ya
  // mueve la fila a `past_due` y arranca la gracia (handle-stripe-event.ts). Se prefiere a
  // `error_if_incomplete` —que revierte el ítem y tira un card error— para no perder la factura
  // emitida ni el reintento del dunning de Stripe. Contrapartida: NO se puede asumir éxito, por
  // eso abajo se lee la factura de verdad en vez de devolver un "listo" a ciegas.
  //
  // CLAVE DE IDEMPOTENCIA: sin ella, dos pedidos CONCURRENTES del mismo hotel (doble clic, dos
  // pestañas, un reintento que se superpone) leen los dos el mismo estado local viejo, los dos
  // pasan el chequeo de "ya estás en ese plan" —que todavía no se escribió— y los dos facturan
  // su propio prorrateo: dos cobros reales en la tarjeta. El flag de loading de la UI no alcanza,
  // porque no cruza pestañas. Con la clave, Stripe colapsa el segundo pedido idéntico en la misma
  // operación y devuelve el mismo resultado, sin cobrar de nuevo.
  //
  // La clave identifica EL INTENTO, no la transición, y por eso incluye `updatedAt` de la fila
  // leída. Atarla sólo a origen→destino sería un bug: Stripe cachea la respuesta de una clave
  // repetida durante 24h y la devuelve SIN re-ejecutar nada, así que un hotel que mejora A→B, baja
  // a A desde el Billing Portal y vuelve a mejorar a B el mismo día recibiría el response viejo —
  // sin cobro y sin cambio real en Stripe. `updatedAt` cambia con cada escritura sobre la fila
  // (incluida la del webhook al bajar de plan), así que dos pedidos CONCURRENTES —que leen el
  // mismo snapshot— comparten clave y se deduplican, mientras que un intento posterior legítimo
  // —que lee un snapshot distinto— estrena clave. Sin `updatedAt` se cae a una ventana de tiempo
  // corta, que conserva la deduplicación de la ráfaga concurrente sin congelar nada por 24h.
  const tokenIntento = active.updatedAt
    ? String(active.updatedAt)
    : `t${Math.floor(Date.now() / VENTANA_DEDUP_MS)}`
  const claveIdempotencia = `upgrade:${hotelId}:${active.stripeSubscriptionId}:${plan.id}:${tokenIntento}`
  const updated = await stripe.subscriptions.update(String(active.stripeSubscriptionId), {
    items: [{ id: itemId, price: String(plan.stripePriceId) }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'allow_incomplete',
    expand: ['latest_invoice'],
  }, { idempotencyKey: claveIdempotencia })

  // A PARTIR DE ACÁ LA TARJETA YA SE COBRÓ: nada de lo que sigue puede lanzar. Leer la factura
  // es una llamada de RED más (`latest_invoice` puede venir sin expandir y obligar a un
  // `invoices.retrieve`), y si fallara, la excepción dejaría al hotel cobrado mirando un error,
  // sin reflejo del plan y sin un solo log del cobro. Se degrada a "no pude determinarlo": el
  // resultado sale con `paid:false`, que la UI ya traduce en "el plan quedó aplicado, revisá el
  // estado del pago en el portal" — y el portal muestra la verdad de Stripe.
  let invoice: Stripe.Invoice | null = null
  try {
    invoice = await latestInvoiceOf(stripe, updated)
  } catch (e) {
    logger.error('Upgrade cobrado pero no se pudo leer la factura del prorrateo', {
      hotelId, planId: String(plan.id), error: (e as Error).message,
    })
  }
  const invoiceStatus = invoice?.status ? String(invoice.status) : null
  const amountCharged = Number(invoice?.amount_due ?? 0)
  const currency = currencyOf(invoice?.currency, plan)

  // ¿Stripe quedó DE VERDAD en el plan destino? Con `payment_behavior:'allow_incomplete'` el
  // cambio de ítem se aplica aunque el cobro falle, así que normalmente sí. Pero reflejar el plan
  // en local por el solo hecho de que el update no tiró es una suposición, y acá una suposición
  // equivocada deja al hotel con un plan pago que Stripe nunca le cobró. Se confirma contra el
  // price que volvió.
  //
  // OJO con el alcance: esto NO cubre la respuesta cacheada por idempotencia — una respuesta
  // cacheada es la de la operación original, que traía el price nuevo, así que pasaría este
  // chequeo. De ese caso se ocupa la clave, que incluye `updatedAt` y por eso no se repite entre
  // intentos distintos. Esta guarda cubre lo otro: que el ítem devuelto no sea el que se mandó a
  // cambiar (ítem inesperado, respuesta parcial).
  const priceAplicado = updated.items?.data?.find((i) => i.id === itemId)?.price?.id
  const aplicado = priceAplicado === String(plan.stripePriceId)
  if (!aplicado) {
    logger.error('El upgrade NO quedó aplicado en Stripe: no se refleja el plan local', {
      hotelId, planId: String(plan.id), priceEsperado: String(plan.stripePriceId),
      priceAplicado: priceAplicado ?? null, stripeSubscriptionId: String(active.stripeSubscriptionId),
    })
    return {
      applied: false,
      paid: false,
      planId: String(plan.id),
      planName: String(plan.name ?? ''),
      previousPlanId: active.planId ? String(active.planId) : null,
      amountCharged: 0,
      currency: currencyOf(invoice?.currency, plan),
      invoiceStatus,
    }
  }

  // Reflejo local inmediato para que el panel del hotel cambie sin esperar el webhook
  // `customer.subscription.updated`, que igual va a llegar y hace exactamente esto — es
  // idempotente: si `planId` ya apunta al plan nuevo, corta sin escribir. Se espeja también
  // cuando la factura quedó impaga, porque en Stripe el plan nuevo YA rige: la fila local tiene
  // que decir la verdad de Stripe, y del impago se ocupa el dunning.
  //
  // BEST-EFFORT A PROPÓSITO: acá la tarjeta YA se cobró. Si esta escritura fallara y el error
  // subiera, el hotel vería un 500 sobre un cobro que sí ocurrió — el peor final posible. El
  // webhook de Stripe hace exactamente este mismo reflejo y es idempotente, así que ante un
  // fallo local se avisa fuerte y se devuelve el resultado real del cobro.
  let previousPlanId: string | null = active.planId ? String(active.planId) : null
  try {
    previousPlanId = (await changeHotelPlan(deps, hotelId, String(plan.id))).previousPlanId
  } catch (e) {
    logger.error('Upgrade cobrado pero no se pudo reflejar el plan local — lo sincroniza el webhook', {
      hotelId, planId: String(plan.id), error: (e as Error).message,
    })
  }

  const paid = invoiceStatus === 'paid'
  logger.info('Upgrade de plan con prorrateo', {
    hotelId, previousPlanId, planId: String(plan.id),
    amountCharged, currency, invoiceStatus, paid,
  })

  return {
    applied: true,
    paid,
    planId: String(plan.id),
    planName: String(plan.name ?? ''),
    previousPlanId,
    amountCharged,
    currency,
    invoiceStatus,
  }
}

/**
 * Reglas comunes a preview y cobro. Todo lo que puede decir que NO se valida acá, ANTES de tocar
 * Stripe: un rechazo después del `update` sería una factura emitida por una operación que el
 * backend igual iba a rechazar.
 */
async function loadUpgrade(deps: UpgradePlanDeps, hotelId: string, planId: string): Promise<UpgradeContext> {
  const { subscriptionsRepo, plansRepo } = deps
  if (!hotelId) throw new ValidationError('Falta el hotel')
  if (!planId) throw new ValidationError('Falta el plan')

  // @ignore IDOR_RISK — `plans` es el catálogo global de la plataforma, no un recurso del hotel:
  // no hay ownership que verificar. El hotel sale del JWT (ver contract.rules), nunca del body.
  const plan = (await plansRepo.findById(planId)) as any
  if (!plan) throw new NotFoundError('Plan no encontrado')
  if (!plan.stripePriceId) throw new ValidationError('Plan sin precio configurado en Stripe')
  // Un plan retirado del catálogo no se vende solo: lo mismo que `changeHotelPlan` sin
  // `allowInactive` (que es la vía del super admin). Se corta ACÁ para no cobrar y fallar después.
  if (plan.isActive === false || plan.isActive === 0) throw new ValidationError('Ese plan está desactivado')

  // MISMO criterio que el gate, importado (WORKING_STATUSES + compareSubscriptions): si acá se
  // eligiera otra fila, se cobraría el prorrateo de una suscripción distinta de la que decide
  // qué módulos ve el hotel. Ver resolve-plan.ts (CS-7).
  const subs = ((await subscriptionsRepo.findMany({ hotelId })) as any[]) ?? []
  const active = subs.filter((s) => WORKING_STATUSES.has(s?.status)).sort(compareSubscriptions)[0]
  // Sin `stripeSubscriptionId` no hay ítem que mover: es el hotel en prueba, que todavía no tiene
  // suscripción en Stripe. Ese camino es el Checkout normal y ya funciona — se lo manda ahí.
  if (!active?.stripeSubscriptionId) {
    throw new ConflictError('Todavía no tenés una suscripción activa: elegí tu plan y suscribite desde el checkout.')
  }
  if (String(active.planId ?? '') === String(plan.id)) throw new ValidationError('Ya estás en ese plan')

  const currentPlan = ((await plansRepo.findById(String(active.planId ?? ''))) as any) ?? null
  if (!currentPlan) {
    throw new ValidationError('No pudimos identificar tu plan actual: escribinos para migrar tu suscripción')
  }
  // SOLO UPGRADES. Con `always_invoice` un downgrade NO cobra: genera CRÉDITO a favor del hotel
  // para las próximas facturas, y el issue pide explícitamente "pagando lo que falta". Bajar de
  // plan (y el prorrateo a favor, que es una decisión comercial) se gestiona desde el Billing
  // Portal, que ya está cableado en `/api/subscriptions/portal`.
  if (!(Number(plan.price) > Number(currentPlan.price))) {
    throw new ValidationError('Ese plan no es una mejora del actual. Para bajar de plan usá el portal de facturación.')
  }

  const stripe = await StripeService.getClient()
  if (!stripe) throw new ValidationError('Stripe no está configurado en la plataforma')

  const stripeSub = await stripe.subscriptions.retrieve(String(active.stripeSubscriptionId))
  const itemId = stripeSub.items?.data?.[0]?.id
  // Este producto vende un plan = un ítem. Sin ítem no hay nada que reemplazar y mandar el update
  // igual crearía una línea nueva en vez de migrar el plan.
  if (!itemId) throw new ConflictError('Tu suscripción en Stripe no tiene ítems: escribinos para migrarla')

  return { stripe, active, stripeSub, itemId: String(itemId), plan, currentPlan }
}

/** La factura del prorrateo. `expand` normalmente la trae entera; el retrieve es el defensivo. */
async function latestInvoiceOf(stripe: Stripe, sub: Stripe.Subscription): Promise<Stripe.Invoice | null> {
  const latest = sub.latest_invoice
  if (!latest) return null
  return typeof latest === 'string' ? await stripe.invoices.retrieve(latest) : latest
}

/**
 * Fin del ciclo vigente (ISO). Misma migración de API version que `handle-stripe-event.ts`:
 * `current_period_end` ya no vive en la Subscription sino en cada ítem. Fallback a la fila local,
 * que el webhook mantiene al día.
 */
function periodEndOf(sub: Stripe.Subscription, active: any): string | null {
  const end = sub.items?.data?.[0]?.current_period_end
  if (typeof end === 'number') return new Date(end * MS_PER_SECOND).toISOString()
  return active?.currentPeriodEnd ? String(active.currentPeriodEnd) : null
}

/** Moneda en minúsculas, como la devuelve Stripe; si no vino, la del plan. */
function currencyOf(fromStripe: string | null | undefined, plan: any): string {
  return String(fromStripe || plan?.currency || 'usd').toLowerCase()
}
