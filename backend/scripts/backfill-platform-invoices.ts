// scripts/backfill-platform-invoices.ts — BIL-1 / REQ-BIL-03.
//
// El historial de cobros de la plataforma (`platform_invoices`) nace vacío: los webhooks solo
// pueden registrar lo que pase de ahora en adelante. Todo lo que Stripe ya cobró —meses de
// facturas con su número, su monto y su PDF— está allá y no acá, así que `/admin/billing`
// arrancaría mostrando una pantalla en blanco para hoteles que vienen pagando desde hace rato.
// Esto lo trae.
//
// Reusa `upsertPlatformInvoice` (el mismo camino que el webhook), así que hereda sus tres
// reglas: UPSERT por `stripeInvoiceId`, jamás pisa una fila `method:'manual'`, y un `open`
// tardío no degrada un estado terminal. Correrlo dos veces no duplica nada.
//
// Las facturas en `draft` NO se traen: en Stripe se pueden borrar y todavía no le cobraron nada
// a nadie.
//
// Uso:
//   DB_PATH=data/managerhotel.db bun run scripts/backfill-platform-invoices.ts --dry
//   DATABASE_URL=postgres://... bun run scripts/backfill-platform-invoices.ts
//   ... --hotel <hotelId>    # un solo hotel
import type Stripe from 'stripe'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import {
  upsertPlatformInvoice, statusFromStripeInvoice, type UpsertPlatformInvoiceDeps,
} from '../src/modules/subscriptions/usecases/upsert-platform-invoice'

/** Página de Stripe: 100 es el máximo que acepta `invoices.list`. */
const PAGE_SIZE = 100

export interface BackfillDeps extends UpsertPlatformInvoiceDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  /** Solo se usa `invoices.list` — el tipo completo de Stripe no hace falta para testear. */
  stripe: Pick<Stripe, 'invoices'>
  logger: Logger
}

export interface BackfillOptions {
  /** Limita a un hotel (para probar en prod sin tocar el resto). */
  hotelId?: string
  /** Recorre y cuenta, sin escribir una sola fila. */
  dryRun?: boolean
}

export interface BackfillSummary {
  customers: number
  invoices: number
  created: number
  updated: number
  skipped: number
}

/**
 * Recorre las suscripciones con `stripeCustomerId` y trae sus facturas de Stripe, paginando con
 * `starting_after` (el cursor de Stripe: pedir por página numerada no existe). Devuelve el
 * resumen; no imprime nada — eso es del CLI.
 */
export async function backfillPlatformInvoices(
  deps: BackfillDeps, options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const { subscriptionsRepo, stripe, logger } = deps
  const summary: BackfillSummary = { customers: 0, invoices: 0, created: 0, updated: 0, skipped: 0 }

  const filter = options.hotelId ? { hotelId: options.hotelId } : {}
  const subs = ((await subscriptionsRepo.findMany(filter)) as any[]) ?? []

  for (const sub of subs) {
    const customerId = sub.stripeCustomerId
    if (!customerId) continue // nunca pasó por Stripe: no hay nada que traer
    summary.customers++

    let startingAfter: string | undefined
    // `while (true)` con corte por `has_more`: Stripe no dice cuántas páginas hay de antemano.
    for (;;) {
      const page = await stripe.invoices.list({
        customer: customerId,
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      const invoices = page.data ?? []
      for (const invoice of invoices) {
        const status = statusFromStripeInvoice(invoice)
        if (!status) { summary.skipped++; continue } // draft
        summary.invoices++
        if (options.dryRun) continue
        const result = await upsertPlatformInvoice(
          deps, invoice, { hotelId: sub.hotelId, subscriptionId: sub.id }, status,
        )
        if (result.action === 'created') summary.created++
        else if (result.action === 'updated') summary.updated++
        else summary.skipped++
      }
      if (!page.has_more || invoices.length === 0) break
      startingAfter = invoices[invoices.length - 1]!.id
    }
  }

  logger.info('backfill platform_invoices: terminado', { ...summary })
  return summary
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// Solo cuando se ejecuta como script: importarlo desde el test NO conecta ninguna base.
if (import.meta.main) {
  const { ORM, OrmRepository } = await import('arckode-framework')
  const { SqliteAdapter } = await import('arckode-framework/adapters/sqlite')
  const { PostgresAdapter } = await import('arckode-framework/adapters/postgres')
  const { registerSharedModels } = await import('../src/shared/models')
  const { registerSubscriptionModels } = await import('../src/modules/subscriptions/model')
  const { StripeService } = await import('../src/services/stripe-service')

  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry')
  const hi = argv.indexOf('--hotel')
  const hotelId = hi >= 0 ? argv[hi + 1] : undefined

  const DATABASE_URL = process.env.DATABASE_URL
  const db = DATABASE_URL
    ? new PostgresAdapter({ connectionString: DATABASE_URL })
    : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })
  await db.connect()
  const orm = new ORM(db)
  registerSharedModels(orm)
  registerSubscriptionModels(orm)

  // Cuenta de PLATAFORMA (sin hotelId): es la que emitió estas facturas.
  const stripe = await StripeService.getClient()
  if (!stripe) {
    console.error('Stripe no está configurado en la plataforma (falta la API key) — nada que traer.')
    process.exit(1)
  }

  // Logger mínimo: el script no levanta el System, así que no hay logger del framework.
  const logger = {
    info: (msg: string, meta?: unknown) => console.log(msg, meta ?? ''),
    warn: (msg: string, meta?: unknown) => console.warn(msg, meta ?? ''),
    error: (msg: string, meta?: unknown) => console.error(msg, meta ?? ''),
    debug: () => {},
    child: () => logger,
  } as unknown as Logger

  try {
    const summary = await backfillPlatformInvoices(
      {
        subscriptionsRepo: new OrmRepository<any>(orm, 'Subscriptions'),
        platformInvoicesRepo: new OrmRepository<any>(orm, 'PlatformInvoices'),
        plansRepo: new OrmRepository<any>(orm, 'Plans'),
        stripe,
        logger,
      },
      { hotelId, dryRun },
    )
    console.log(
      `\nplatform_invoices${dryRun ? ' (DRY RUN, no se escribió nada)' : ''}: ` +
      `${summary.customers} cliente(s) de Stripe · ${summary.invoices} factura(s) · ` +
      `${summary.created} nueva(s) · ${summary.updated} actualizada(s) · ${summary.skipped} saltada(s) (draft o manual).`,
    )
  } finally {
    await db.close()
  }
}
