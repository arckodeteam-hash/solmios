// subscriptions/usecases/upgrade-plan.ts — El HOTEL cambia su plan pagando SOLO la diferencia.
//
// #46: hasta acá el hotel no podía cambiar su plan por su cuenta. Con una suscripción viva,
// `create-checkout-session.ts` corta con 409 a propósito (BUG-9: un Checkout `mode:'subscription'`
// nuevo crea una SEGUNDA suscripción en Stripe que cobra en paralelo y huérfana la vieja), y el
// Billing Portal cambia el plan pero no es el flujo que pide el issue. El camino correcto es
// `stripe.subscriptions.update()` sobre el ÍTEM que ya existe: es la API que prorratea y factura
// exactamente la diferencia — "pagando lo que falta de su suscripción", textual del issue.
//
// #84: el destino es CUALQUIER plan activo distinto del actual, más caro o más barato (CA 2/25), y
// el plan sólo se activa si el prorrateo quedó cobrado (CA 4/5). Los nombres `previewUpgrade` /
// `applyUpgrade` / `UpgradePlanDeps` se conservan a propósito: renombrarlos arrastraría controller,
// index, types y frontend sin cambiar una sola regla.
//
// #92: "cobrado" lo dice la FACTURA, no el update. `error_if_incomplete` cubre el rechazo
// sincrónico de tarjeta (Stripe revierte y lanza), pero con ACH/SEPA el update vuelve con el ítem
// movido y el cobro en `processing`. El plan local se refleja SÓLO con `latest_invoice` en `paid`;
// si no, lo aplica el webhook `invoice.paid` cuando Stripe confirma (ver handle-stripe-event.ts).
//
// Cuenta de PLATAFORMA: `StripeService.getClient()` SIN hotelId, mismo criterio que el checkout —
// con hotelId resolvería las keys DEL HOTEL, que son las que cobran a sus huéspedes.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ErrorContract, ValidationError, NotFoundError, ConflictError } from 'arckode-framework'
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

/**
 * Stripe no respondió como debía (price inexistente, timeout, rate limit, caída de la API) y por
 * eso el cambio de plan no se pudo cotizar ni aplicar. #339: hasta acá estos errores subían crudos
 * y el router —que sólo mapea `ErrorContract`— los convertía en un 500 "Error interno del servidor"
 * sin motivo, sin log con contexto y sin decirle a la persona que su plan siguió intacto.
 *
 * 502 y no 400/409: el pedido del hotel estaba bien, lo que falló es el proveedor de atrás.
 * `canRetry: true` porque casi siempre es transitorio o se arregla del lado de la plataforma
 * (un `stripePriceId` mal cargado) sin que la persona cambie nada de lo que mandó.
 */
export class PaymentProviderError extends ErrorContract {
  readonly httpStatus = 502
  readonly isExpected = true
  readonly canRetry = true
  readonly errorCode = 'PAYMENT_PROVIDER_ERROR'
}

const MS_PER_SECOND = 1000
/** Bucket de tiempo de la clave de idempotencia, usado SÓLO como fallback cuando la fila no trae
 *  `updatedAt`. Cubre la ráfaga de pedidos concurrentes (dos pestañas, un doble clic) sin congelar
 *  la operación: las claves de idempotencia de Stripe viven 24h y un reintento legítimo no puede
 *  esperar tanto. Achicarlo NO arregla nada y abre el doble cobro (dos pestañas separadas por
 *  segundos estrenarían clave y facturarían dos prorrateos); el reintento lo resuelve el
 *  `updatedAt`, que todo intento —cobrado o rechazado— deja movido. */
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
 * Cuánto pagaría HOY el hotel por cambiar de plan. No cobra ni cambia nada: es la cifra que el
 * panel muestra antes de que la persona confirme. Al bajar de plan el prorrateo va a favor del
 * hotel y el monto sale 0: no se cobra nada y queda crédito para la próxima factura.
 */
export async function previewUpgrade(
  deps: UpgradePlanDeps, hotelId: string, planId: string,
): Promise<UpgradePreviewDTO> {
  const { stripe, active, stripeSub, itemId, plan, currentPlan } = await loadUpgrade(deps, hotelId, planId)

  // `invoices.createPreview` = la factura que Stripe EMITIRÍA con este cambio, sin emitirla.
  // Ojo con la versión: en stripe-node v22 `invoices.retrieveUpcoming` YA NO EXISTE, esta es su
  // reemplazante. El `proration_behavior` tiene que ser el MISMO que usa `applyUpgrade` o el
  // número que se muestra no sería el que después se cobra.
  let preview: Stripe.Invoice
  try {
    preview = await stripe.invoices.createPreview({
      subscription: String(active.stripeSubscriptionId),
      subscription_details: {
        items: [{ id: itemId, price: String(plan.stripePriceId) }],
        proration_behavior: 'always_invoice',
      },
    })
  } catch (e) {
    // #339: acá no hay plata en juego —el preview no cobra ni escribe— pero un price que Stripe no
    // conoce o una caída de su API salían como 500 sin motivo. Sube como 502 con lo que dijo Stripe.
    throw fallaDelProveedor(deps.logger, 'calcular el cambio de plan', e, {
      hotelId, planId: String(plan.id), stripeSubscriptionId: String(active.stripeSubscriptionId),
    })
  }

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
 * Aplica el cambio de plan y cobra la diferencia en el acto. Si el cobro no se completa, LANZA y no
 * cambia nada: el plan sólo rige cuando el prorrateo se pudo cobrar (ver `payment_behavior`).
 */
export async function applyUpgrade(
  deps: UpgradePlanDeps, hotelId: string, planId: string,
): Promise<UpgradeResultDTO> {
  const { logger, subscriptionsRepo } = deps
  const { stripe, active, itemId, plan } = await loadUpgrade(deps, hotelId, planId)

  // `proration_behavior: 'always_invoice'` emite la factura del prorrateo YA y la cobra con el
  // método guardado: es lo que hace que el hotel pague "lo que falta" hoy y no en la próxima
  // renovación. `payment_behavior: 'error_if_incomplete'` (#84, CA 4 y 5): el plan nuevo se activa
  // SÓLO si esa factura quedó pagada. Si la tarjeta rechaza, Stripe REVIERTE el ítem al plan viejo
  // y esta llamada LANZA, así que nada de lo que sigue corre —ni el reflejo local de
  // `changeHotelPlan`— y el hotel se queda con el plan que sí está pagando. Antes iba
  // `allow_incomplete`, que aplicaba el cambio igual y dejaba al hotel con un plan que nunca se le
  // cobró, esperando al dunning: un pago fallido NO puede cambiar el plan actual.
  //
  // CLAVE DE IDEMPOTENCIA: sin ella, dos pedidos CONCURRENTES del mismo hotel (doble clic, dos
  // pestañas, un reintento que se superpone) leen los dos el mismo estado local viejo, los dos
  // pasan el chequeo de "ya estás en ese plan" —que todavía no se escribió— y los dos facturan
  // su propio prorrateo: dos cobros reales en la tarjeta. El flag de loading de la UI no alcanza,
  // porque no cruza pestañas. Con la clave, Stripe colapsa el segundo pedido idéntico en la misma
  // operación y devuelve el mismo resultado, sin cobrar de nuevo.
  //
  // La clave identifica EL INTENTO, no la transición. Atarla sólo a origen→destino sería un bug:
  // Stripe cachea la respuesta de una clave repetida durante 24h y la devuelve SIN re-ejecutar
  // nada, así que un hotel que mejora A→B, baja a A desde el Billing Portal y vuelve a mejorar a B
  // el mismo día recibiría el response viejo — sin cobro y sin cambio real en Stripe.
  //
  // Lo que distingue un intento del siguiente es el `updatedAt` del snapshot leído, y alcanza
  // porque TODO intento deja escrita la fila: el que cobra, con el reflejo del plan nuevo; el que
  // la tarjeta rechaza, con la escritura no-op del `catch` de acá abajo (el ORM pisa `updatedAt`
  // en cada escritura). Sin esa marca, un cobro rechazado —que con `error_if_incomplete` no
  // escribe nada— dejaba el `updatedAt` quieto: el reintento reusaba la MISMA clave y Stripe le
  // devolvía el ERROR cacheado por hasta 24h, así que el hotel corregía su tarjeta y seguía
  // recibiendo el mismo rechazo, justo lo contrario del "intentá de nuevo" que este código muestra.
  //
  // La ráfaga CONCURRENTE sigue deduplicada sin ayuda del reloj: los pedidos simultáneos leyeron
  // el MISMO snapshot antes de que ninguno tocara la fila, comparten `updatedAt` y Stripe los
  // colapsa en una sola operación.
  //
  // El bucket de `VENTANA_DEDUP_MS` queda SÓLO de fallback para la fila que no trae `updatedAt`
  // (base vieja, doble de test): ahí no hay nada que distinga un intento de otro y lo único que se
  // puede sostener es la dedup de la ráfaga.
  const tokenIntento = active.updatedAt
    ? String(active.updatedAt)
    : `t${Math.floor(Date.now() / VENTANA_DEDUP_MS)}`
  const claveIdempotencia = `upgrade:${hotelId}:${active.stripeSubscriptionId}:${plan.id}:${tokenIntento}`
  // El rechazo de la tarjeta llega acá como error de Stripe. Sube traducido (#84, CA 29): un
  // "card_declined" crudo no le dice a nadie que su plan siguió intacto. El motivo de Stripe NO se
  // tapa —es lo único que explica QUÉ falló— y queda además en el log con hotel y plan.
  //
  // SÓLO el error de cobro se traduce a problema de tarjeta. Un price inválido, un timeout, un
  // rate limit o una caída de la API no son problemas de la tarjeta del hotel: disfrazarlos de
  // "revisá tu método de pago" manda a la persona a revisar una tarjeta que está bien y esconde un
  // fallo de infraestructura detrás de un `warn`. Esos salen como `PaymentProviderError` (502) con
  // el motivo de Stripe y se loguean en `error` con hotel, plan y el `type`/`code` del error
  // (#339: antes subían crudos y el router los tapaba con un 500 "Error interno del servidor" que
  // no decía qué pasó ni que el plan siguió intacto). Mismo criterio de detección que
  // `payment-requests/usecases/live-session.ts`: el `type` del error de Stripe; acá el caso de
  // cobro es `StripeCardError`.
  let updated: Stripe.Subscription
  try {
    updated = await stripe.subscriptions.update(String(active.stripeSubscriptionId), {
      items: [{ id: itemId, price: String(plan.stripePriceId) }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
      expand: ['latest_invoice'],
    }, { idempotencyKey: claveIdempotencia })
  } catch (e) {
    const motivo = (e as Error)?.message ?? 'error desconocido'
    const contexto = {
      hotelId, planId: String(plan.id), currentPlanId: active.planId ? String(active.planId) : null,
      stripeSubscriptionId: String(active.stripeSubscriptionId), error: motivo,
    }
    // Todo intento que llegó a Stripe tiene que dejar rastro en la fila, haya fallado por la
    // tarjeta o por el sistema: es lo que hace que el reintento estrene clave de idempotencia y
    // Stripe lo ejecute de verdad, en vez de devolverle el error cacheado de este intento. Stripe
    // guarda la respuesta de CUALQUIER error una vez que el endpoint empezó a ejecutarse, así que
    // un `StripeAPIError` transitorio o un `stripePriceId` mal configurado envenenan la clave
    // igual que un rechazo: sin la marca, el hotel corrige el problema y sigue recibiendo el mismo
    // error cacheado por hasta 24h. Es lo que `allow_incomplete` daba gratis, cuando todo intento
    // escribía la fila.
    //
    // El patch va VACÍO a propósito. Reescribir un campo leído antes del `await` a Stripe —que es
    // una llamada de red que puede tardar (3DS, reintentos de la red de tarjetas)— sería un
    // leer-modificar-escribir sin CAS: si en esa ventana el webhook movió la fila a `past_due` o a
    // `canceled` (handle-stripe-event.ts), este `catch` la devolvería al valor viejo, y una
    // suscripción recién cancelada volvería a figurar activa por un cobro que ni siquiera pasó.
    // Con el patch vacío el ORM emite `UPDATE subscriptions SET updatedAt = ? WHERE id = ?`
    // (orm.ts: filtra el patch contra los campos del modelo y agrega `updatedAt` si el modelo
    // lleva timestamps, que `SubscriptionsModel` sí lleva): mueve la marca de tiempo y no pisa un
    // solo dato del negocio.
    //
    // BEST-EFFORT, mismo criterio que el reflejo local de más abajo: si esta escritura falla NO
    // puede tapar el rechazo del cobro, que es lo único que la persona necesita leer. Se avisa
    // fuerte y se sigue lanzando el motivo real.
    try {
      await subscriptionsRepo.update(String(active.id), {})
    } catch (errorAlMarcar) {
      logger.warn('No se pudo marcar el intento fallido: el reintento podría chocar con el caché de Stripe', {
        ...contexto, errorAlMarcar: (errorAlMarcar as Error)?.message ?? 'error desconocido',
      })
    }
    // Sólo el error de COBRO se traduce a tarjeta; el del sistema sale como error del proveedor
    // (ver el comentario de arriba). La marca de más arriba ya se hizo para los dos.
    if (!isStripeCardError(e)) {
      throw fallaDelProveedor(logger, 'aplicar el cambio de plan', e, {
        hotelId, planId: String(plan.id), currentPlanId: contexto.currentPlanId,
        stripeSubscriptionId: contexto.stripeSubscriptionId,
      })
    }
    logger.warn('No se pudo cobrar el prorrateo del cambio de plan: el plan actual queda intacto', contexto)
    throw new ValidationError(
      `No pudimos cobrar el cambio de plan: ${motivo}. `
      + 'Tu plan actual no cambió — revisá tu método de pago e intentá de nuevo.',
    )
  }

  // A PARTIR DE ACÁ EL ÍTEM YA SE MOVIÓ EN STRIPE: nada de lo que sigue puede lanzar. Leer la
  // factura es una llamada de RED más (`latest_invoice` puede venir sin expandir y obligar a un
  // `invoices.retrieve`), y si fallara, la excepción dejaría al hotel cobrado mirando un error,
  // sin reflejo del plan y sin un solo log del cobro. Se degrada a "no pude determinarlo": el
  // resultado sale con `paid:false`, que la UI traduce en "el cambio queda pendiente hasta que
  // se confirme el cobro" — y el webhook (`invoice.paid`) lo aplica cuando Stripe lo confirma.
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

  // ¿Stripe quedó DE VERDAD en el plan destino? Con `payment_behavior:'error_if_incomplete'` un
  // cobro fallido ya no llega hasta acá —lanza arriba y revierte el ítem—, así que normalmente sí.
  // Pero reflejar el plan en local por el solo hecho de que el update no tiró es una suposición, y
  // acá una suposición equivocada deja al hotel con un plan pago que Stripe nunca le cobró. Se
  // confirma contra el price que volvió.
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

  const paid = invoiceStatus === 'paid'

  // Reflejo local inmediato para que el panel del hotel cambie sin esperar el webhook
  // `customer.subscription.updated`, que igual va a llegar y hace exactamente esto — es
  // idempotente: si `planId` ya apunta al plan nuevo, corta sin escribir.
  //
  // SÓLO CON LA FACTURA PAGA (#92). Que el update haya vuelto dice que el ítem se movió en
  // Stripe, no que se cobró: con un método de confirmación diferida (ACH/SEPA Direct Debit)
  // `error_if_incomplete` no lanza —el PaymentIntent queda `processing`, no fallido— y la factura
  // del prorrateo sigue `open` durante días. Si ese cobro después rebota, Stripe anula la factura
  // y NO devuelve el ítem al price viejo. Reflejar acá por el solo hecho de que el update volvió
  // dejaba al hotel con un plan que nunca pagó. Con `paid:false` el plan local se queda donde
  // está y lo aplica el webhook `invoice.paid` cuando Stripe confirma el cobro (o nunca, si
  // rebota) — misma regla en handle-stripe-event.ts. Una factura que no se pudo leer entra por
  // la misma puerta: no se sabe, no se refleja, el webhook lo resuelve.
  //
  // BEST-EFFORT A PROPÓSITO: acá la tarjeta YA se cobró. Si esta escritura fallara y el error
  // subiera, el hotel vería un 500 sobre un cobro que sí ocurrió — el peor final posible. El
  // webhook de Stripe hace exactamente este mismo reflejo y es idempotente, así que ante un
  // fallo local se avisa fuerte y se devuelve el resultado real del cobro.
  let previousPlanId: string | null = active.planId ? String(active.planId) : null
  if (paid) {
    try {
      previousPlanId = (await changeHotelPlan(deps, hotelId, String(plan.id))).previousPlanId
    } catch (e) {
      logger.error('Upgrade cobrado pero no se pudo reflejar el plan local — lo sincroniza el webhook', {
        hotelId, planId: String(plan.id), error: (e as Error).message,
      })
    }
  } else {
    logger.warn('Cambio de plan aplicado en Stripe con cobro sin confirmar: el plan local espera invoice.paid', {
      hotelId, planId: String(plan.id), currentPlanId: previousPlanId, invoiceId: invoice?.id ?? null,
      invoiceStatus, amountCharged, stripeSubscriptionId: String(active.stripeSubscriptionId),
    })
  }

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
  // CUALQUIER DIRECCIÓN (#84, CA 2/25): antes acá se cortaba todo lo que no fuera un plan más caro
  // y se mandaba a la persona al Billing Portal. No hacía falta: con `always_invoice` un downgrade
  // no cobra, genera CRÉDITO a favor del hotel para las próximas facturas —`amount_due` 0— y la
  // factura sale `paid`, así que este mismo camino sirve para las dos direcciones y devuelve un
  // resultado honesto en ambas. El Billing Portal sigue disponible en `/api/subscriptions/portal`
  // para quien prefiera gestionarlo ahí; sólo dejó de ser el ÚNICO camino para bajar de plan.
  // `currentPlan` se sigue resolviendo porque el preview muestra de qué plan se sale.

  const stripe = await StripeService.getClient()
  if (!stripe) throw new ValidationError('Stripe no está configurado en la plataforma')

  let stripeSub: Stripe.Subscription
  try {
    stripeSub = await stripe.subscriptions.retrieve(String(active.stripeSubscriptionId))
  } catch (e) {
    throw fallaDelProveedor(deps.logger, 'leer tu suscripción en Stripe', e, {
      hotelId, planId: String(plan.id), stripeSubscriptionId: String(active.stripeSubscriptionId),
    })
  }
  const itemId = stripeSub.items?.data?.[0]?.id
  // Este producto vende un plan = un ítem. Sin ítem no hay nada que reemplazar y mandar el update
  // igual crearía una línea nueva en vez de migrar el plan.
  if (!itemId) throw new ConflictError('Tu suscripción en Stripe no tiene ítems: escribinos para migrarla')

  return { stripe, active, stripeSub, itemId: String(itemId), plan, currentPlan }
}

/** El único error de Stripe que SÍ es del método de pago del hotel (tarjeta rechazada, expirada,
 *  fondos insuficientes). El resto —`StripeInvalidRequestError`, `StripeAPIError`,
 *  `StripeConnectionError`, `StripeRateLimitError`— es un fallo del sistema. */
function isStripeCardError(e: unknown): boolean {
  return (e as { type?: string } | null)?.type === 'StripeCardError'
}

/**
 * Traduce un fallo de Stripe (no de la tarjeta) al error que se le devuelve al hotel, y lo deja en
 * el log con el contexto que hace falta para investigarlo. DEVUELVE el error en vez de lanzarlo
 * para que el `throw` quede visible en cada call site (y TypeScript sepa que ahí no se sigue).
 *
 * Un `ErrorContract` propio (ValidationError, ConflictError…) se devuelve tal cual: ya viene con
 * su status y su mensaje y envolverlo lo convertiría en un 502 que no es. `etapa` va en infinitivo
 * porque completa la frase "No pudimos …".
 */
function fallaDelProveedor(
  logger: Logger, etapa: string, e: unknown, contexto: Record<string, unknown>,
): Error {
  if (e instanceof ErrorContract) return e
  const err = e as { type?: string, code?: string, message?: string } | null
  const motivo = err?.message ?? 'error desconocido'
  logger.error(`${etapa} falló por un error de Stripe, no del método de pago`, {
    ...contexto, stripeType: err?.type ?? null, stripeCode: err?.code ?? null, error: motivo,
  })
  return new PaymentProviderError(
    `No pudimos ${etapa}: ${motivo}. `
    + 'Tu plan actual no cambió — probá de nuevo en un momento y, si sigue, escribinos.',
  )
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
