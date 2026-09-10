// REQ-BIL-03 — el backfill trae lo que Stripe ya cobró antes de que existiera la tabla.
// Escenario del spec: un hotel con 3 facturas en Stripe + 1 manual local; corrido dos veces
// tiene que dejar exactamente 4 filas y la manual intacta.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { RepositoryAdapter } from 'arckode-framework'
import { backfillPlatformInvoices } from '../../../../scripts/backfill-platform-invoices'

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

function makeSubsRepo(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (filter: Record<string, unknown> = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
  } as unknown as RepositoryAdapter<any>
}

function invoice(id: string, status: string, amount = 4900): any {
  return {
    id,
    number: `SOLM-${id}`,
    status,
    amount_due: amount,
    amount_paid: status === 'paid' ? amount : 0,
    currency: 'usd',
    created: 1_767_225_600,
    period_start: 1_767_225_600,
    period_end: 1_769_904_000,
    status_transitions: { finalized_at: 1_767_225_600, paid_at: status === 'paid' ? 1_767_226_000 : null },
    lines: { data: [{ description: 'Professional (mensual)' }] },
  }
}

/**
 * Stripe falso que pagina de verdad (`has_more` + `starting_after`), porque la paginación es
 * justamente lo que el script tiene que hacer bien: con `pageSize: 1` y 3 facturas, un script que
 * no siga el cursor se trae una sola.
 */
function fakeStripe(invoices: any[], pageSize = 100): { stripe: any; calls: number } {
  const state = { calls: 0 }
  return {
    get calls() { return state.calls },
    stripe: {
      invoices: {
        list: async (params: any) => {
          state.calls++
          const start = params.starting_after ? invoices.findIndex((i) => i.id === params.starting_after) + 1 : 0
          const data = invoices.slice(start, start + Math.min(pageSize, params.limit ?? pageSize))
          return { data, has_more: start + data.length < invoices.length }
        },
      },
    },
  } as any
}

const SUBS = [{ id: 'sub1', hotelId: 'h1', stripeCustomerId: 'cus_1' }]

describe('backfillPlatformInvoices', () => {
  it('trae las 3 facturas de Stripe, respeta la manual local y correrlo DOS veces deja 4 filas', async () => {
    const manual = {
      id: 'pi-manual', hotelId: 'h1', stripeInvoiceId: null, method: 'manual', status: 'paid',
      amountDue: 49, amountPaid: 49, reference: 'TRF-1234', issuedAt: '2026-01-15T00:00:00.000Z',
    }
    const invoices = makeInvoicesRepo([manual])
    const { stripe } = fakeStripe([invoice('in_1', 'paid'), invoice('in_2', 'paid'), invoice('in_3', 'open')])
    const deps = {
      subscriptionsRepo: makeSubsRepo(SUBS), platformInvoicesRepo: invoices.repo, stripe, logger: silentLogger(),
    }

    const first = await backfillPlatformInvoices(deps)
    const second = await backfillPlatformInvoices(deps)

    expect(first).toMatchObject({ customers: 1, invoices: 3, created: 3, updated: 0 })
    expect(second).toMatchObject({ customers: 1, invoices: 3, created: 0, updated: 3 })
    expect(invoices.rows).toHaveLength(4)
    expect(invoices.rows.find((r) => r.id === 'pi-manual')).toEqual(manual)
    expect(invoices.rows.filter((r) => r.method === 'card')).toHaveLength(3)
    expect(invoices.rows.find((r) => r.stripeInvoiceId === 'in_3')!.status).toBe('open')
  })

  it('pagina con el cursor de Stripe: 3 facturas en páginas de 1 se traen las 3', async () => {
    const invoices = makeInvoicesRepo()
    const fake = fakeStripe([invoice('in_1', 'paid'), invoice('in_2', 'paid'), invoice('in_3', 'paid')], 1)

    const summary = await backfillPlatformInvoices({
      subscriptionsRepo: makeSubsRepo(SUBS), platformInvoicesRepo: invoices.repo, stripe: fake.stripe, logger: silentLogger(),
    })

    expect(summary.created).toBe(3)
    expect(invoices.rows).toHaveLength(3)
    expect(fake.calls).toBe(3)
  })

  it('saltea los borradores de Stripe (se pueden borrar allá y no cobraron nada)', async () => {
    const invoices = makeInvoicesRepo()
    const { stripe } = fakeStripe([invoice('in_1', 'paid'), invoice('in_draft', 'draft')])

    const summary = await backfillPlatformInvoices({
      subscriptionsRepo: makeSubsRepo(SUBS), platformInvoicesRepo: invoices.repo, stripe, logger: silentLogger(),
    })

    expect(summary).toMatchObject({ invoices: 1, created: 1, skipped: 1 })
    expect(invoices.rows).toHaveLength(1)
  })

  it('`--dry` recorre y cuenta sin escribir una sola fila', async () => {
    const invoices = makeInvoicesRepo()
    const { stripe } = fakeStripe([invoice('in_1', 'paid'), invoice('in_2', 'open')])

    const summary = await backfillPlatformInvoices(
      { subscriptionsRepo: makeSubsRepo(SUBS), platformInvoicesRepo: invoices.repo, stripe, logger: silentLogger() },
      { dryRun: true },
    )

    expect(summary).toMatchObject({ invoices: 2, created: 0, updated: 0 })
    expect(invoices.rows).toHaveLength(0)
  })

  it('una suscripción sin `stripeCustomerId` no se consulta (nunca pasó por Stripe)', async () => {
    const invoices = makeInvoicesRepo()
    const fake = fakeStripe([invoice('in_1', 'paid')])

    const summary = await backfillPlatformInvoices({
      subscriptionsRepo: makeSubsRepo([{ id: 'sub2', hotelId: 'h2' }]),
      platformInvoicesRepo: invoices.repo, stripe: fake.stripe, logger: silentLogger(),
    })

    expect(summary).toMatchObject({ customers: 0, invoices: 0, created: 0 })
    expect(fake.calls).toBe(0)
  })

  it('`--hotel` limita el recorrido a ese hotel', async () => {
    const invoices = makeInvoicesRepo()
    const { stripe } = fakeStripe([invoice('in_1', 'paid')])

    const summary = await backfillPlatformInvoices(
      {
        subscriptionsRepo: makeSubsRepo([...SUBS, { id: 'sub2', hotelId: 'h2', stripeCustomerId: 'cus_2' }]),
        platformInvoicesRepo: invoices.repo, stripe, logger: silentLogger(),
      },
      { hotelId: 'h1' },
    )

    expect(summary.customers).toBe(1)
    expect(invoices.rows.every((r) => r.hotelId === 'h1')).toBe(true)
  })
})
