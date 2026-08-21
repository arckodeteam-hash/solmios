// payment-requests/usecases/stripe-webhook.ts — El webhook de Stripe, de punta a punta.
//
// CLN-4: el encabezado decía sólo "extraído del service para mantenerlo <200 líneas". Eso ya no
// describe el archivo: acá vive el BRIDGE completo del cobro — verificar la firma, cotejar el
// hotel, marcar el PaymentRequest, asentar el dinero en `payments` por el puerto, postear el cargo
// al folio, recalcular el saldo persistido de la reserva y dejar el rastro de auditoría.
//
// Es un endpoint público: la autoridad es la FIRMA de Stripe (no un JWT/user), verificada con el
// secreto DEL HOTEL que viene en la ruta. Por eso no hay `assertOwnership`: el hotel dueño se
// resuelve desde el PaymentRequest y se coteja contra el de la ruta antes de tocar nada.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { StripeService } from '../../../services/stripe-service'
import type { PaymentRequestDTO, WebhookResult } from '../types'
import type { PaymentRequestsSockets } from '../sockets'
import { recordStripePayment, type StripePaymentPort } from './payment-port'
import type { PaymentEventStore } from '../../../services/payment-gateway/payment-events'
import { webhookPaidEntry, webhookFailedEntry, type AuditEntry } from './audit'
import { pendingBalance } from '../../../shared/utils/reservation-balance'
import { paidForReservation, type ReservationPaidRepos } from '../../../shared/usecases/reservation-paid'
import { round2, BALANCE_EPSILON } from '../../../shared/utils/money'

export interface WebhookDeps {
  repo: RepositoryAdapter<PaymentRequestDTO>
  reservationRepo: RepositoryAdapter<any>
  folioRepo: RepositoryAdapter<any>
  folioChargeRepo: RepositoryAdapter<any>
  /** `reservation_addons` — OBLIGATORIO: sin él el pendiente de la reserva se recalcula sin los
   *  extras y vuelve el bug que este flujo arregla, en silencio y sin error. */
  addonRepo: RepositoryAdapter<any>
  /** Camino reserva → dinero cobrado (`shared/usecases/reservation-paid`), servido por los módulos
   *  dueños vía el connector `payment-requests-money` (STR-A). OBLIGATORIO: sin él el
   *  `pendingAmount` que persiste el bridge vuelve a salir de `reservations.deposit` y contradice
   *  al techo del cobro (GH-0.2). */
  paidRepos: ReservationPaidRepos
  logger: Logger
  sockets: PaymentRequestsSockets
  paymentPort: StripePaymentPort | null
  /** BUG-1: barrera atómica del settle — claim-first sobre `payment_events` (clave
   *  `stripe:{sessionId}`), la MISMA tienda que usan `payments` y `bookingengine`. Hace que
   *  asiento + bridge corran como UN efecto: un reintento tras fallo parcial lo completa y un
   *  webhook concurrente con el mismo sessionId no toca nada. Nullable por wiring: si falta,
   *  el settle corta fuerte. */
  events: PaymentEventStore | null
  /** SC-05: registra el cobro en el audit log. Lo pasa el service (`auditSafely` absorbe fallos). */
  audit?: (entry: AuditEntry) => Promise<void>
}

/**
 * `checkout.session.completed`: marca el PaymentRequest pagado y aplica el cobro a reserva y folio.
 *
 * Devuelve `null` cuando terminó bien (o cuando no había nada que hacer) y un `WebhookResult` sólo
 * para cortar con un error HTTP — hoy el único caso es el cobro de otro hotel.
 *
 * Idempotencia: TRIPLE barrera — el chequeo de estado (`pr.status !== 'paid'`) corta la reentrega
 * ya resuelta; `settleOnce` (PaymentEventStore, clave `stripe:{sessionId}`) corre asiento + bridge
 * como UN efecto, también contra webhooks concurrentes; y `recordStripePayment` no asienta dos
 * veces el mismo sessionId (`providerRef`), última línea si un crash dejó el claim huérfano
 * (ventana de milisegundos documentada y aceptada en `PaymentEventStore`).
 */
/** Fila de `folios` en lo que el bridge necesita: identificarlo y saber si sigue abierto. */
export interface OpenFolio {
  id: string
  status?: string | null
}

/**
 * DEBT-2: lo que este módulo LEE de los objetos de Stripe, tipado a mano.
 *
 * No se usa `Stripe.Checkout.Session` del SDK a propósito: el objeto llega de un webhook ya
 * verificado por firma pero deserializado como JSON suelto, y declarar el tipo completo del SDK
 * mentiría sobre lo que realmente está garantizado en el payload. Estas interfaces dicen
 * exactamente qué campos se leen — que es lo que un `any` escondía.
 */
export interface StripeCheckoutSessionEvent {
  id?: string
  /** Importe cobrado en la unidad MÍNIMA de la moneda (centavos). Ver `amountOf`. */
  amount_total?: number | null
  payment_intent?: string | null
  metadata?: Record<string, string | undefined> | null
}

/** Id de la sesión, ya normalizado: el payload es JSON suelto y `id` no está garantizado. */
function sessionIdOf(session: StripeCheckoutSessionEvent): string {
  return String(session?.id ?? '')
}

/** `payment_intent.payment_failed`: sólo se leen los campos que van al log. */
export interface StripePaymentIntentEvent {
  id?: string
  metadata?: Record<string, string | undefined> | null
  last_payment_error?: { code?: string } | null
  cancellation_reason?: string | null
}

async function handleCheckoutCompleted(
  deps: WebhookDeps,
  session: StripeCheckoutSessionEvent,
  /** Hotel de la RUTA: el que autenticó la firma. */
  hotelId: string,
): Promise<WebhookResult | null> {
  const { repo, logger, sockets, audit } = deps

  const paymentRequestId = session.metadata?.paymentRequestId
  if (!paymentRequestId) return null

  const pr = await repo.findById(paymentRequestId)
  if (!pr) return null
  // El webhook del Hotel A no puede marcar como pagado un cobro del Hotel B.
  if (pr.hotelId !== hotelId) {
    logger.error(`Webhook del hotel ${hotelId} quiso pagar el request ${paymentRequestId}, que no es suyo`)
    return { status: 403, error: 'El cobro no pertenece a este hotel' } as any
  }
  if (pr.status === 'paid') return null

  const amountPaid = await settleCompletedSession(deps, pr, session, hotelId)

  await repo.update(paymentRequestId, {
    status: 'paid', stripeSessionId: sessionIdOf(session), paidAt: new Date().toISOString(),
  } as Partial<PaymentRequestDTO>)
  const updated = await repo.findById(paymentRequestId) as PaymentRequestDTO
  await sockets.onPaymentRequestPaid?.(updated)
  await audit?.(webhookPaidEntry(updated, amountPaid))
  logger.info('Stripe payment completed + applied', { paymentRequestId, amountPaid })
  return null
}

/**
 * Asienta la plata del cobro y la propaga a reserva y folio, como UN efecto tras la barrera atómica
 * de `settleOnce`. Devuelve el monto cobrado.
 *
 * BUG-1: antes el bridge se gatedaba en `!alreadyRecorded` del asiento. Si fallaba DESPUÉS de que
 * `recordStripePayment` persistió, el reintento de Stripe encontraba el cobro asentado, saltaba el
 * bridge y el PaymentRequest se marcaba `paid` con la reserva sin `deposit`/`pendingAmount` ni
 * cargo de folio — la plata ya estaba en `payments`. Ahora:
 *   · el efecto que FALLA libera la reserva del evento (`settleOnce` release-on-failure) y el
 *     reintento lo corre completo: el asiento se deduplica solo (por `providerRef`) y el bridge,
 *     reentrante (ver `applyPaymentBridge`), completa reserva y folio exactamente una vez;
 *   · un webhook CONCURRENTE con el mismo sessionId pierde el claim y no toca nada — el chequeo
 *     `pr.status !== 'paid'` solo no frena dos entregas simultáneas;
 *   · si el efecto terminó pero el `repo.update(paid)` falló, el claim queda tomado y el reintento
 *     sólo remarca el estado, sin re-correr el bridge.
 */
async function settleCompletedSession(
  deps: WebhookDeps,
  pr: PaymentRequestDTO,
  session: StripeCheckoutSessionEvent,
  hotelId: string,
): Promise<number> {
  const { reservationRepo, folioRepo, folioChargeRepo, addonRepo, paidRepos, logger, paymentPort, events } = deps
  if (!events) throw new Error('stripe-webhook: event store de idempotencia sin cablear (payment_events)')
  const amountPaid = amountOf(session, pr)
  // SEC-2: la reserva es la del PaymentRequest, NO `session.metadata.reservationId`. La metadata la
  // mandamos nosotros pero llega como payload: si el payload ganara, dentro del mismo hotel el cobro
  // de la reserva X se aplicaría al folio de la reserva que eligiera la metadata. Es el mismo
  // criterio por el que ya se descartó `metadata.hotelId`.
  const openFolio = await findOpenFolio(folioRepo, hotelId, pr.reservationId)

  await events.settleOnce(
    hotelId, 'stripe', sessionIdOf(session),
    {
      providerRef: sessionIdOf(session),
      reference: session.payment_intent || '',
      status: 'paid',
      amountMinor: session.amount_total ?? undefined,
      currency: (pr.currency || 'USD').toUpperCase(),
    },
    async () => {
      await recordStripePayment(paymentPort, logger, {
        hotelId,
        amount: amountPaid,
        currency: (pr.currency || 'USD').toUpperCase(),
        stripeSessionId: sessionIdOf(session),
        stripePaymentId: session.payment_intent || '',
        folioId: openFolio?.id,
        description: `Pago Stripe · Reserva ${String(pr.reservationId || '').slice(0, 8)}`,
        reference: session.payment_intent || sessionIdOf(session),
      })
      await applyPaymentBridge(
        { reservationRepo, folioChargeRepo, addonRepo, folioRepo, paidRepos },
        pr, session, openFolio, logger, hotelId,
      )
    },
  )
  return amountPaid
}

/**
 * `checkout.session.expired`: el link caducó sin pagarse.
 *
 * MISMO cotejo de tenant que la rama `completed`: el `paymentRequestId` viene de la metadata de la
 * sesión (payload), así que sin este chequeo el webhook del hotel A podía expirar el cobro del
 * hotel B — un cobro vivo cancelado desde afuera (GH-0.3).
 */
async function handleCheckoutExpired(
  deps: WebhookDeps,
  session: StripeCheckoutSessionEvent,
  hotelId: string,
): Promise<WebhookResult | null> {
  const { repo, logger } = deps
  const paymentRequestId = session.metadata?.paymentRequestId
  if (!paymentRequestId) return null
  const pr = await repo.findById(paymentRequestId)
  if (!pr) return null
  if (pr.hotelId !== hotelId) {
    logger.error(`Webhook del hotel ${hotelId} quiso expirar el request ${paymentRequestId}, que no es suyo`)
    return { status: 403, error: 'El cobro no pertenece a este hotel' } as any
  }
  // GH-0.3: cancelar/borrar un cobro desde el panel ahora EXPIRA la sesión en Stripe, y Stripe
  // devuelve el `checkout.session.expired` de vuelta. Sin este guard ese eco pisaba el `cancelled`
  // (o un `paid` asentado por otra vía) con `expired` y borraba el motivo real del audit log.
  if (pr.status !== 'pending') return null
  await repo.update(paymentRequestId, { status: 'expired' } as Partial<PaymentRequestDTO>)
  return null
}

/** `payment_intent.payment_failed`: sólo deja rastro; no toca plata ni estado del cobro. */
async function handlePaymentFailed(deps: WebhookDeps, intent: StripePaymentIntentEvent, hotelId: string): Promise<void> {
  // SEC-3: NO se loguea el evento entero — `payment_intent` trae `charges.payment_method_details`
  // con los últimos 4, marca, país y nombre del titular. Sólo lo que hace falta para operar.
  deps.logger.warn('Stripe payment failed', {
    intentId: intent?.id,
    paymentRequestId: intent?.metadata?.paymentRequestId,
    reason: intent?.last_payment_error?.code || intent?.cancellation_reason || 'unknown',
  })
  // Rastro de auditoría del cobro fallido (append-only, vía el connector payment-requests-auditlog).
  await deps.audit?.(webhookFailedEntry(hotelId, intent))
}

/**
 * Procesa el webhook Stripe: rutea el evento y traduce el corte de tenant a HTTP.
 *
 * CLN-1/CLN-3: cada `case` delega en su handler. Antes el cuerpo de `completed` vivía inline y
 * dejaba 7 niveles de anidamiento (function > try > switch > case > if > if > if) con el corte de
 * tenant enterrado en el medio. Los handlers devuelven `null` cuando no hay nada que reportar y un
 * `WebhookResult` sólo para cortar con un error HTTP.
 */
export async function processStripeWebhook(
  deps: WebhookDeps,
  hotelId: string,
  rawBody: string | Buffer,
  signature: string,
): Promise<WebhookResult> {
  // Sólo lo que usa el ruteo: cada `case` toma sus repos de `deps`.
  const { logger } = deps

  if (!hotelId) return { status: 400, error: 'Falta el hotel en la ruta del webhook' } as any
  if (!(await StripeService.isConfigured(hotelId))) return { status: 503, error: 'El hotel no tiene Stripe configurado' } as any
  if (!signature) return { status: 400, error: 'Falta stripe-signature' } as any

  let event: any
  try {
    // La firma se verifica contra el secreto DE ESTE HOTEL (antes: uno global para todos).
    event = await StripeService.verifyWebhook(hotelId, rawBody, signature)
  } catch (e: any) {
    logger.warn('Stripe webhook signature failed', { error: e.message })
    return { status: 400, error: 'Firma inválida', detail: e.message } as any
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const denied = await handleCheckoutCompleted(deps, event.data.object as any, hotelId)
        if (denied) return denied
        break
      }
      case 'checkout.session.expired': {
        const denied = await handleCheckoutExpired(deps, event.data.object as any, hotelId)
        if (denied) return denied
        break
      }
      case 'payment_intent.payment_failed': {
        await handlePaymentFailed(deps, event.data.object as any, hotelId)
        break
      }
      default:
        break
    }
    return { received: true }
  } catch (e: any) {
    logger.error('Stripe webhook handler failed', e)
    return { status: 500, error: 'Internal error' } as any
  }
}

/**
 * Monto realmente cobrado, en unidades de la moneda.
 *
 * Stripe cotiza en la unidad MÍNIMA (centavos): `session.amount_total` se divide por 100.
 * `payment_requests.amount`, en cambio, se persiste en UNIDADES (`service.create` guarda el monto
 * validado contra el saldo de la reserva, que está en unidades). El fallback dividía igual por 100
 * y convertía un cobro de $300 en $3: ese número alimenta el asiento en `payments`, el `deposit` de
 * la reserva, el cargo del folio y el `applied`/`excess` del guardián de saldo.
 */
function amountOf(session: StripeCheckoutSessionEvent, pr: PaymentRequestDTO): number {
  const minor = session?.amount_total
  if (minor !== undefined && minor !== null && Number.isFinite(Number(minor))) {
    return round2(Math.abs(Number(minor)) / 100)
  }
  return round2(Math.abs(Number(pr?.amount) || 0))
}

/**
 * Folio abierto de la reserva, DENTRO del hotel que firmó el webhook.
 *
 * El `reservationId` sale de `session.metadata`, o sea del payload. Sin el filtro por `hotelId`
 * un webhook firmado con el secreto del hotel A resolvía el folio abierto de una reserva del
 * hotel B y le escribía un `folio_charges` negativo con el `hotelId` del A (GH-0.3). La query
 * hermana del bridge ya llevaba el hotel; ésta no.
 */
async function findOpenFolio(
  folioRepo: RepositoryAdapter<any>,
  hotelId: string,
  reservationId?: string,
): Promise<OpenFolio | null> {
  if (!reservationId || !hotelId) return null
  const folios = await folioRepo.findMany({ reservationId, hotelId }) as OpenFolio[]
  return folios.find((f) => f.status === 'open') ?? null
}

/**
 * Suma las líneas del folio y devuelve el saldo pendiente. Espejo de `folio-math.computeTotals`
 * (no se puede importar cross-módulo). Los pagos tienen `total` negativo, por eso se suman sus
 * valores absolutos.
 */
function computeFolioBalance(charges: any[]): number {
  const cargos = charges.filter((c) => c.kind === 'charge')
  const pagos = charges.filter((c) => c.kind === 'payment')
  const chargesTotal = round2(cargos.reduce((s, c) => s + Number(c.total || 0), 0))
  const paymentsTotal = round2(pagos.reduce((s, c) => s + Math.abs(Number(c.total || 0)), 0))
  return round2(chargesTotal - paymentsTotal)
}

/**
 * Bridge: aplicar el pago a la reserva (deposit/pendingAmount/status) + folio (cargo payment).
 *
 * GUARDIÁN DE SALDO: el folio nunca puede quedar en negativo (regla del módulo folios,
 * `folio-entries.ts:124`). El Checkout de Stripe fija el monto al crear la sesión, pero al llegar
 * el webhook el folio puede tener menos saldo del que se cobró, por dos motivos distintos:
 *   1. pagos parciales previos (efectivo, transferencia) → sobrepago real, hay que devolver plata;
 *   2. el folio todavía no devengó todo lo que se cobró — el check-in postea SOLO la primera noche
 *      (`reservas/usecases/checkin.ts`) y los extras/`otherCharges` nunca llegan al folio, mientras
 *      que el link de pago cobra el total cobrable de la reserva (extras incluidos).
 *
 * Antes se descartaba el cargo ENTERO en los dos casos: el huésped pagaba y el folio seguía
 * mostrando la deuda ya cobrada. Ahora se aplica al folio la porción que cubre su saldo
 * (`min(amountPaid, balance)`) y el excedente se registra en el log con todos los datos para
 * reconciliar — ese excedente NO se pierde: ya está asentado en `payments` (vía
 * `recordStripePayment`) y sumado a `reservations.deposit`. La descripción del cargo deja escrito
 * cuánto se aplicó de cuánto, así el folio y `payments` se pueden cruzar.
 *
 * NO se puede rutear por `FoliosService.applyPayment` porque (a) duplica el asiento en `payments`
 * (el webhook ya lo hizo) y (b) exige un `CurrentUser` que no existe en un endpoint público
 * firmado por Stripe. El tope se aplica inline, con el `BALANCE_EPSILON` COMPARTIDO
 * (`shared/utils/money.ts`, el mismo que usa `folio-entries.ts`) y la misma matemática.
 */
interface BridgeRepos {
  reservationRepo: RepositoryAdapter<any>
  folioChargeRepo: RepositoryAdapter<any>
  addonRepo: RepositoryAdapter<any>
  folioRepo: RepositoryAdapter<any>
  /** Camino reserva → dinero, por los módulos dueños (STR-A — ver `WebhookDeps.paidRepos`). */
  paidRepos: ReservationPaidRepos
}

async function applyPaymentBridge(
  repos: BridgeRepos,
  pr: PaymentRequestDTO,
  session: StripeCheckoutSessionEvent,
  openFolio: OpenFolio | null,
  logger: Logger,
  /** Hotel de la RUTA del webhook — el que autenticó la firma y ya se cotejó contra `pr.hotelId`. */
  hotelId: string,
): Promise<void> {
  // SEC-2: la reserva sale del registro del SERVIDOR (`pr`), no del payload de Stripe. Ver la
  // rama `checkout.session.completed`.
  const reservationId = pr.reservationId
  if (!reservationId) return
  const amountPaid = amountOf(session, pr)
  // CLN-2: las dos mitades del bridge son independientes (una toca `reservations`, la otra
  // `folio_charges`) y cada una tiene su propia regla de negocio: viven separadas.
  //
  // ORDEN reentrante (BUG-1): el cargo foliar va PRIMERO y se deduplica por ref (ver
  // `applyToFolio`); la reserva va ÚLTIMA y de una sola escritura. Si la mitad de reserva falla,
  // el reintento re-corre el bridge: el folio ya aplicado se detecta y se salta, y
  // `applyToReservation` — que en su intento fallido no escribió nada — corre la única vez que
  // cuenta. En el orden inverso (reserva primero) ese mismo fallo duplicaba el `deposit`.
  await applyToFolio(repos, pr, session, openFolio, logger, hotelId, amountPaid)
  await applyToReservation(repos, reservationId, hotelId, amountPaid)
}

/** Sube el `deposit`, recalcula el saldo persistido y confirma la reserva si el hospedaje quedó saldado. */
async function applyToReservation(
  repos: BridgeRepos,
  reservationId: string,
  hotelId: string,
  amountPaid: number,
): Promise<void> {
  const { reservationRepo, addonRepo } = repos
  // Multi-tenancy: TODA query lleva el hotel (misma regla que `reservas-queries.getMessageLogs`).
  const [res] = await reservationRepo.findMany({ id: reservationId, hotelId })
  if (!res) return

  const newDeposit = Number(res.deposit || 0) + amountPaid
  // El total cobrable incluye extras y otros cobros (shared/utils/reservation-balance): antes acá se
  // usaba `totalAmount` pelado y el `pendingAmount` persistido quedaba corto cuando había addons.
  const addons = await addonRepo.findMany({ reservationId, hotelId })
  const paidReservation = { ...res, deposit: newDeposit }
  // Lo cobrado sale de `payments` (GH-0.2): el `deposit` recién bumpeado es sólo el piso, y un
  // pago en efectivo por folio o factura no lo mueve. Mismo criterio que el techo del cobro, si
  // no el listado (que lee esta columna) y el techo dirían números distintos.
  const paid = await paidForReservation(repos.paidRepos, hotelId, reservationId, paidReservation)
  const update: Record<string, unknown> = {
    deposit: newDeposit,
    paymentMethod: 'stripe',
    pendingAmount: pendingBalance(paidReservation, addons as any[], paid),
  }
  // Confirmar la reserva depende SOLO del alojamiento: si dependiera del total cobrable, cargar
  // un extra en recepción desconfirmaría una reserva con el hospedaje 100% pagado. Los extras
  // se cobran, pero no deciden si hay habitación reservada.
  if (res.status === 'pending' && newDeposit >= Number(res.totalAmount || 0)) update.status = 'confirmed'
  await reservationRepo.update(reservationId, update as any)
}

/**
 * Postea el pago al folio abierto, topeado a su saldo. Ver el encabezado de `applyPaymentBridge`
 * para el porqué del tope y del excedente.
 */
async function applyToFolio(
  repos: BridgeRepos,
  pr: PaymentRequestDTO,
  session: StripeCheckoutSessionEvent,
  openFolio: OpenFolio | null,
  logger: Logger,
  hotelId: string,
  amountPaid: number,
): Promise<void> {
  if (!openFolio || amountPaid <= 0) return
  const { folioChargeRepo } = repos
  // Tope de saldo: espejo de folios/usecases/folio-entries.ts:124.
  const charges = await folioChargeRepo.findMany({ folioId: openFolio.id })
  const ref = session.payment_intent || sessionIdOf(session)
  // BUG-1 (reentrancia): si este ref ya dejó su cargo en el folio — un reintento tras un fallo de
  // la mitad de reserva del bridge — no se postea otro. La fila del puente carga `source:'stripe'`
  // y el `Ref ${ref}` en la descripción (ref único por sesión de Checkout), así que es el marcador
  // natural de "esta sesión ya aplicó su folio".
  const alreadyApplied = charges.some(
    (c: any) => c?.source === 'stripe' && c?.kind === 'payment' && String(c?.description || '').includes(`Ref ${ref}`),
  )
  if (alreadyApplied) return
  const balance = computeFolioBalance(charges as any[])
  // Dentro de epsilon se aplica el monto completo (diferencias de redondeo de centavos).
  const applied = amountPaid <= balance + BALANCE_EPSILON ? amountPaid : Math.max(0, balance)
  const excess = round2(amountPaid - applied)
  if (excess > 0) {
    logger.warn(
      'Stripe webhook: el cobro excede el saldo del folio; se aplica hasta el saldo y el resto queda para reconciliar',
      {
        folioId: openFolio.id, paymentRequestId: pr.id,
        amountPaid, balance, applied, excess, stripeSessionId: sessionIdOf(session),
      },
    )
  }
  if (applied <= 0) return
  await folioChargeRepo.create({
    folioId: openFolio.id, hotelId,
    description: excess > 0
      ? `Pago Stripe · Ref ${ref} (aplicado ${applied} de ${amountPaid})`
      : `Pago Stripe · Ref ${ref}`,
    category: 'payment', kind: 'payment', quantity: 1,
    amount: -applied, taxes: 0, total: -applied, source: 'stripe',
    postedAt: new Date().toISOString(),
  } as any)
}
