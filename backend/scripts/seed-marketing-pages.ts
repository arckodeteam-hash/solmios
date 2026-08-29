// seed-marketing-pages.ts — UNIVERSAL (PostgreSQL + SQLite vía DbAdapter del framework).
// Crea o REEMPLAZA las páginas "producto"/"empresa" del sitio público (que-es-solmios,
// integraciones, sobre-nosotros, contacto) con el contenido de
// scripts/marketing-pages-content.ts. Mismo patrón que seed-legal-pages.ts: usa
// SitePagesService (el mecanismo real detrás de Panel › Sitio público), no SQL crudo.
//
// A diferencia de migrate-db.ts (insert-only, nunca pisa lo que el CMS ya tiene), este
// script SIEMPRE sincroniza estas páginas con el contenido vigente — correr tras editar
// marketing-pages-content.ts, o para empujar texto corregido (auditoría Meta 2026-08-26:
// voseo, correo/teléfono de contacto ausentes) a un entorno donde ya existían.
//
// Local (SQLite):   DB_PATH=data/managerhotel.db bun run scripts/seed-marketing-pages.ts
// Prod (Postgres):  DATABASE_URL=postgres://... bun run scripts/seed-marketing-pages.ts
import { ORM, Logger, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import { registerSitePagesModels, SitePagesService } from '../src/modules/site-pages'
import type { SitePageDTO } from '../src/modules/site-pages'
import { MARKETING_PAGES_SEED } from './marketing-pages-content'

const DATABASE_URL = process.env.DATABASE_URL
const db = DATABASE_URL
  ? new PostgresAdapter({ connectionString: DATABASE_URL })
  : new SqliteAdapter({
      path: process.env.DB_PATH || './data/managerhotel.db',
      wal: true,
      foreignKeys: true,
    })

async function main(): Promise<void> {
  await db.connect()

  const orm = new ORM(db as never)
  registerSitePagesModels(orm)
  const repo = new OrmRepository<SitePageDTO>(orm, 'SitePages')
  const service = new SitePagesService(repo, new Logger('seed-marketing-pages', 'info'))

  const existingPages = (await service.list()).data

  let created = 0
  let replaced = 0

  for (const page of MARKETING_PAGES_SEED) {
    const existing = existingPages.find((p) => p.slug === page.slug)
    if (existing) {
      await service.update(existing.id, {
        title: page.title,
        metaDescription: page.metaDescription,
        contentHtml: page.contentHtml,
        category: page.category,
        status: 'published',
        sortOrder: page.sortOrder,
      })
      replaced++
      console.log(`  ↻ ${page.slug} — reemplazada`)
    } else {
      await service.create({
        slug: page.slug,
        title: page.title,
        metaDescription: page.metaDescription,
        contentHtml: page.contentHtml,
        category: page.category,
        status: 'published',
        sortOrder: page.sortOrder,
      })
      created++
      console.log(`  + ${page.slug} — creada`)
    }
  }

  console.log(`\nseed-marketing-pages: ${created} creadas, ${replaced} reemplazadas`)
}

main()
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('seed-marketing-pages falló:', msg)
    process.exitCode = 1
  })
  .finally(async () => {
    try { await db.close() } catch { /* ignore close errors on shutdown */ }
    process.exit(process.exitCode ?? 0)
  })
