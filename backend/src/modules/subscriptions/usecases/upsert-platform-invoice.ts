// subscriptions/usecases/upsert-platform-invoice.ts — de `Stripe.Invoice` a fila de
// `platform_invoices` (REQ-BIL-01/02/03).
//
// Una sola puerta de escritura para los dos orígenes automáticos (el webhook de plataforma y el
// backfill), porque los dos tienen que respetar exactamente las mismas reglas:
//
//  1. UPSERT por `stripeInvoiceId` — Stripe reintenta sus webhooks y el backfill se corre más de
//     una vez; dos filas del mismo `in_...` serían dos cobros en la pantalla del super-admin.
//  2. Una fila `method:'manual'` NO se toca jamás. La cargó una persona con un comprobante en la
//     mano: ningún proceso automático la pisa (REQ-BIL-03).
//  3. Un `open` que llega tarde no degrada un estado terminal (`paid`/`void`/`uncollectible`).
//     Los webhooks no llegan ordenados: sin esta regla un `invoice.finalized` reintentado
//     después del `invoice.paid` dejaría una factura cobrada figurando como pendiente.
//
// El mapeo vive acá y no en el handler del webhook para poder testearlo con `Stripe.Invoice`
// armadas a mano, sin repos ni firma HMAC.
import type Stripe from 'stripe'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { round2 } from '../../../shared/utils/money'

/** Stripe expresa los epochs en SEGUNDOS y los importes en CENTAVOS. */
const MS_PER_SECOND = 1000
const CENTS_PER_UNIT = 100

/**
 * `failed` no existe en Stripe: una factura cuyo cobro rebotó sigue `open` allá. Acá se distingue
 * porque es lo que el super-admin necesita ver (y lo que dispara el recordatorio de REQ-BIL-05).
 */
export type PlatformInvoiceStatus = 'open' | 'paid' | 'void' | 'uncollectible' | 'failed'

/** Estados de los que un `open` tardío NO puede sacar a la factura (ver regla 3 del encabezado). */
const TERMINAL_STATUSES = new Set<PlatformInvoiceStatus>(['paid', 'void', 'uncollectible'])

export interface UpsertPlatformInvoiceDeps {
  platformInvoicesRepo: RepositoryAdapter<any>
  /** `plans` — para resolver el plan cobrado desde el price del `line_items[0]`. Opcional: sin
   *  esto la fila queda con el `description` de la línea como `planName` y sin `planId`. */
  plansRepo?: RepositoryAdapter<any>
  logger: Logger
}

/** Dueño de la factura: sale SIEMPRE de la suscripción local ya resuelta, nunca del payload. */
export interface PlatformInvoiceOwner {
  hotelId: string
  subscriptionId?: string
}

export type UpsertPlatformInvoiceResult =
  | { action: 'created' | 'updated'; id: string }
  | { action: 'skipped'; reason: 'manual' | 'no-id' }

const iso = (epochSeconds: number | null | undefined): string | undefined =>
  typeof epochSeconds === 'number' && epochSeconds > 0 ? new Date(epochSeconds * MS_PER_SECOND).toISOString() : undefined

/** Centavos → unidades. La plataforma cobra en monedas de 2 decimales (USD/EUR/DOP). */
const fromCents = (cents: number | null | undefined): number => round2((Number(cents) || 0) / CENTS_PER_UNIT)

/**
 * El estado de Stripe traducido al nuestro. `draft` devuelve `null`: una factura en borrador se
 * puede borrar en Stripe y todavía no le cobró nada a nadie — no entra al historial (el backfill
 * la saltea).
 */
export function statusFromStripeInvoice(invoice: Stripe.Invoice): PlatformInvoiceStatus | null {
  switch (invoice.status) {
    case 'paid': return 'paid'
    case 'void': return 'void'
    case 'uncollectible': return 'uncollectible'
    case 'open': return 'open'
    default: return null // draft (o un estado nuevo que Stripe agregue): no se persiste
  }
}

/**
 * El id del price del primer ítem. En la API 2025-08-27 (la que usa StripeService) el price dejó
 * de colgar de la línea y vive en `pricing.price_details.price` — se tolera igual la forma vieja
 * (`line.price`) por si una factura histórica del backfill vuelve con ella.
 */
function priceIdOfInvoice(invoice: Stripe.Invoice): string | undefined {
  const line = invoice.lines?.data?.[0] as any
  const price = line?.pricing?.price_details?.price ?? line?.price
  if (!price) return undefined
  return typeof price === 'string' ? price : typeof price.id === 'string' ? price.id : undefined
}

/** Campos de la fila que se leen del payload de Stripe (sin tocar la base). */
export function mapStripeInvoice(
  invoice: Stripe.Invoice,
  status: PlatformInvoiceStatus,
  owner: PlatformInvoiceOwner,
  now: Date = new Date(),
): Record<string, any> {
  const nowIso = now.toISOString()
  const line = invoice.lines?.data?.[0]
  return {
    hotelId: owner.hotelId,
    subscriptionId: owner.subscriptionId,
    stripeInvoiceId: invoice.id,
    number: invoice.number ?? undefined,
    status,
    amountDue: fromCents(invoice.amount_due),
    amountPaid: fromCents(invoice.amount_paid),
    currency: (invoice.currency || 'usd').toUpperCase(),
    // `period_start/end` de la factura; si no vinieran, el período de la primera línea.
    periodStart: iso(invoice.period_start) ?? iso(line?.period?.start),
    periodEnd: iso(invoice.period_end) ?? iso(line?.period?.end),
    // Emisión = cuándo se finalizó. Una factura recién creada todavía no tiene `finalized_at`.
    issuedAt: iso(invoice.status_transitions?.finalized_at) ?? iso(invoice.created) ?? nowIso,
    dueAt: iso(invoice.due_date),
    // Un `invoice.paid` sin `paid_at` (payload recortado) igual se pagó: la hora es ahora.
    paidAt: status === 'paid' ? (iso(invoice.status_transitions?.paid_at) ?? nowIso) : undefined,
    method: 'card',
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
    invoicePdfUrl: invoice.invoice_pdf ?? undefined,
    planName: line?.description ?? undefined,
  }
}

/** Resuelve `planId`/`planName` desde el price del primer ítem. Best-effort: nunca lanza. */
async function resolvePlan(
  deps: UpsertPlatformInvoiceDeps, invoice: Stripe.Invoice,
): Promise<{ planId?: string; planName?: string }> {
  const priceId = priceIdOfInvoice(invoice)
  if (!priceId || !deps.plansRepo) return {}
  try {
    const plan = ((await deps.plansRepo.findMany({ stripePriceId: priceId })) as any[])?.[0]
    if (!plan) {
      deps.logger.warn('platform_invoices: el price de la factura no matchea ningún plan local', { priceId })
      return {}
    }
    return { planId: String(plan.id), planName: plan.name ? String(plan.name) : undefined }
  } catch (e) {
    deps.logger.warn('platform_invoices: no se pudo resolver el plan de la factura', { priceId, error: (e as Error).message })
    return {}
  }
}

/** Quita las claves sin valor para no pisar con `undefined` lo que la fila ya tenía. */
function defined(patch: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
}

/**
 * Crea o actualiza la fila de `platform_invoices` que corresponde a esta factura de Stripe.
 * Devuelve qué hizo — el backfill lo usa para su resumen y los tests para no adivinar.
 */
export async function upsertPlatformInvoice(
  deps: UpsertPlatformInvoiceDeps,
  invoice: Stripe.Invoice,
  owner: PlatformInvoiceOwner,
  status: PlatformInvoiceStatus,
  now: Date = new Date(),
): Promise<UpsertPlatformInvoiceResult> {
  const { platformInvoicesRepo, logger } = deps
  const stripeInvoiceId = invoice.id
  if (!stripeInvoiceId) {
    logger.warn('platform_invoices: factura de Stripe sin id — no se persiste')
    return { action: 'skipped', reason: 'no-id' }
  }

  const existing = ((await platformInvoicesRepo.findMany({ stripeInvoiceId })) as any[])?.[0]
  if (existing?.method === 'manual') {
    logger.info('platform_invoices: fila manual, no se pisa desde Stripe', { stripeInvoiceId, id: existing.id })
    return { action: 'skipped', reason: 'manual' }
  }

  const plan = await resolvePlan(deps, invoice)
  const row = defined({ ...mapStripeInvoice(invoice, status, owner, now), ...defined(plan) })

  if (!existing) {
    const id = crypto.randomUUID()
    const created = await platformInvoicesRepo.create({ id, ...row })
    logger.info('platform_invoices: factura registrada', { stripeInvoiceId, status })
    return { action: 'created', id: String((created as any)?.id ?? id) }
  }

  // Regla 3: un `open` tardío no saca a la factura de un estado terminal (el resto del payload
  // —número, PDF, montos— sí se actualiza: es la misma factura, mejor descrita).
  if (status === 'open' && TERMINAL_STATUSES.has(existing.status)) {
    row.status = existing.status
    delete row.paidAt
  }
  await platformInvoicesRepo.update(existing.id, row)
  return { action: 'updated', id: String(existing.id) }
}
