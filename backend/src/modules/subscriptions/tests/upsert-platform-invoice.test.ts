// REQ-BIL-01/02/03 — el mapeo de `Stripe.Invoice` a fila de `platform_invoices` y las tres reglas
// del UPSERT (idempotencia por `stripeInvoiceId`, la fila manual es intocable, un `open` tardío
// no degrada un estado terminal).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { RepositoryAdapter } from 'arckode-framework'
import { upsertPlatformInvoice, statusFromStripeInvoice, mapStripeInvoice } from '../usecases/upsert-platform-invoice'

const PERIOD_START = 1_767_225_600 // 2026-01-01T00:00:00Z
const PERIOD_END = 1_769_904_000 // 2026-02-01T00:00:00Z
const FINALIZED_AT = 1_767_226_000
const PAID_AT = 1_767_226_500
const DUE_DATE = 1_767_830_400

/** Repo en memoria con create/update REALES: la idempotencia no se puede testear con un mock mudo. */
function makeInvoicesRepo(rows: any[] = []): { repo: RepositoryAdapter<any>; rows: any[] } {
  const store = [...rows]
  const repo = {
    findMany: async (filter: Record<string, unknown> = {}) =>
      store.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => store.find((r) => r.id === id) ?? null,
    findOne: async () => null,
    create: async (d: any) => { store.push({ ...d }); return { ...d } },
    update: async (id: string, patch: any) => {
      const row = store.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row ?? null
    },
    delete: async () => true,
    count: async () => store.length,
    paginate: async () => ({ data: store, total: store.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<any>
  return { repo, rows: store }
}

function makePlansRepo(rows: any[] = [{ id: 'plan-pro', name: 'Professional', stripePriceId: 'price_pro' }]): RepositoryAdapter<any> {
  return {
    findMany: async (filter: Record<string, unknown> = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
  } as unknown as RepositoryAdapter<any>
}

/** Factura de Stripe con la forma REAL de la API 2025-08-27 (price dentro de `pricing.price_details`). */
function stripeInvoice(overrides: Record<string, any> = {}): any {
  return {
    id: 'in_1',
    number: 'SOLM-0001',
    status: 'paid',
    amount_due: 4900,
    amount_paid: 4900,
    currency: 'usd',
    created: FINALIZED_AT,
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    due_date: DUE_DATE,
    hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
    invoice_pdf: 'https://pay.stripe.com/invoice/in_1/pdf',
    status_transitions: { finalized_at: FINALIZED_AT, paid_at: PAID_AT, voided_at: null, marked_uncollectible_at: null },
    lines: {
      data: [{
        description: 'Professional (mensual)',
        period: { start: PERIOD_START, end: PERIOD_END },
        pricing: { type: 'price_details', price_details: { price: 'price_pro', product: 'prod_1' }, unit_amount_decimal: '4900' },
      }],
    },
    ...overrides,
  }
}

const OWNER = { hotelId: 'h1', subscriptionId: 'sub1' }

describe('mapStripeInvoice — mapeo del payload de Stripe', () => {
  it('traduce montos (centavos → unidades), fechas (epoch → ISO), moneda y links', () => {
    const row = mapStripeInvoice(stripeInvoice(), 'paid', OWNER)

    expect(row.stripeInvoiceId).toBe('in_1')
    expect(row.number).toBe('SOLM-0001')
    expect(row.amountDue).toBe(49)
    expect(row.amountPaid).toBe(49)
    expect(row.currency).toBe('USD')
    expect(row.periodStart).toBe(new Date(PERIOD_START * 1000).toISOString())
    expect(row.periodEnd).toBe(new Date(PERIOD_END * 1000).toISOString())
    expect(row.issuedAt).toBe(new Date(FINALIZED_AT * 1000).toISOString())
    expect(row.dueAt).toBe(new Date(DUE_DATE * 1000).toISOString())
    expect(row.paidAt).toBe(new Date(PAID_AT * 1000).toISOString())
    expect(row.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/in_1')
    expect(row.invoicePdfUrl).toBe('https://pay.stripe.com/invoice/in_1/pdf')
    expect(row.method).toBe('card')
    expect(row.hotelId).toBe('h1')
    expect(row.subscriptionId).toBe('sub1')
  })

  it('sin `finalized_at` (todavía no emitida) la emisión cae en `created`, y sin pagar no hay `paidAt`', () => {
    const row = mapStripeInvoice(
      stripeInvoice({ status: 'open', amount_paid: 0, status_transitions: { finalized_at: null, paid_at: null } }),
      'open', OWNER,
    )
    expect(row.issuedAt).toBe(new Date(FINALIZED_AT * 1000).toISOString()) // `created`
    expect(row.paidAt).toBeUndefined()
    expect(row.amountPaid).toBe(0)
  })

  it('`invoice.paid` sin `paid_at` en el payload igual queda pagada: la hora es la del evento', () => {
    const now = new Date('2026-03-01T10:00:00.000Z')
    const row = mapStripeInvoice(stripeInvoice({ status_transitions: { finalized_at: FINALIZED_AT, paid_at: null } }), 'paid', OWNER, now)
    expect(row.paidAt).toBe(now.toISOString())
  })

  it('sin `period_*` de la factura, el período sale de la primera línea', () => {
    const row = mapStripeInvoice(stripeInvoice({ period_start: undefined, period_end: undefined }), 'paid', OWNER)
    expect(row.periodStart).toBe(new Date(PERIOD_START * 1000).toISOString())
    expect(row.periodEnd).toBe(new Date(PERIOD_END * 1000).toISOString())
  })
})

describe('statusFromStripeInvoice', () => {
  it('traduce los estados de Stripe', () => {
    expect(statusFromStripeInvoice(stripeInvoice({ status: 'paid' }))).toBe('paid')
    expect(statusFromStripeInvoice(stripeInvoice({ status: 'open' }))).toBe('open')
    expect(statusFromStripeInvoice(stripeInvoice({ status: 'void' }))).toBe('void')
    expect(statusFromStripeInvoice(stripeInvoice({ status: 'uncollectible' }))).toBe('uncollectible')
  })

  it('un borrador NO entra al historial (en Stripe todavía se puede borrar y no cobró nada)', () => {
    expect(statusFromStripeInvoice(stripeInvoice({ status: 'draft' }))).toBeNull()
  })
})

describe('upsertPlatformInvoice', () => {
  it('resuelve el plan desde el price del primer ítem', async () => {
    const { repo, rows } = makeInvoicesRepo()
    await upsertPlatformInvoice({ platformInvoicesRepo: repo, plansRepo: makePlansRepo(), logger: silentLogger() }, stripeInvoice(), OWNER, 'paid')

    expect(rows).toHaveLength(1)
    expect(rows[0].planId).toBe('plan-pro')
    expect(rows[0].planName).toBe('Professional')
  })

  it('sin plan local que matchee el price, guarda igual la factura con la descripción de la línea', async () => {
    const { repo, rows } = makeInvoicesRepo()
    await upsertPlatformInvoice(
      { platformInvoicesRepo: repo, plansRepo: makePlansRepo([]), logger: silentLogger() },
      stripeInvoice(), OWNER, 'paid',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].planId).toBeUndefined()
    expect(rows[0].planName).toBe('Professional (mensual)')
  })

  it('el MISMO id dos veces deja UNA fila (Stripe reintenta sus webhooks)', async () => {
    const { repo, rows } = makeInvoicesRepo()
    const deps = { platformInvoicesRepo: repo, plansRepo: makePlansRepo(), logger: silentLogger() }

    const first = await upsertPlatformInvoice(deps, stripeInvoice({ status: 'open', amount_paid: 0 }), OWNER, 'open')
    const second = await upsertPlatformInvoice(deps, stripeInvoice(), OWNER, 'paid')

    expect(first.action).toBe('created')
    expect(second.action).toBe('updated')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('paid')
    expect(rows[0].amountPaid).toBe(49)
  })

  it('NO pisa una fila manual: la cargó una persona con un comprobante', async () => {
    const { repo, rows } = makeInvoicesRepo([{
      id: 'pi-manual', stripeInvoiceId: 'in_1', method: 'manual', status: 'paid',
      amountPaid: 49, reference: 'TRF-1234',
    }])
    const result = await upsertPlatformInvoice(
      { platformInvoicesRepo: repo, logger: silentLogger() },
      stripeInvoice({ status: 'void' }), OWNER, 'void',
    )

    expect(result).toEqual({ action: 'skipped', reason: 'manual' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ method: 'manual', status: 'paid', reference: 'TRF-1234' })
  })

  it('un `open` que llega tarde NO saca a la factura de `paid` (los webhooks no llegan en orden)', async () => {
    const { repo, rows } = makeInvoicesRepo()
    const deps = { platformInvoicesRepo: repo, plansRepo: makePlansRepo(), logger: silentLogger() }

    await upsertPlatformInvoice(deps, stripeInvoice(), OWNER, 'paid')
    await upsertPlatformInvoice(deps, stripeInvoice({ status: 'open' }), OWNER, 'open')

    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('paid')
    expect(rows[0].paidAt).toBe(new Date(PAID_AT * 1000).toISOString())
    // El resto del payload sí se refresca: es la misma factura, mejor descrita.
    expect(rows[0].number).toBe('SOLM-0001')
  })

  it('una factura sin id no se persiste (no hay clave por la cual deduplicar)', async () => {
    const { repo, rows } = makeInvoicesRepo()
    const result = await upsertPlatformInvoice(
      { platformInvoicesRepo: repo, logger: silentLogger() },
      stripeInvoice({ id: undefined }), OWNER, 'paid',
    )
    expect(result).toEqual({ action: 'skipped', reason: 'no-id' })
    expect(rows).toHaveLength(0)
  })
})
