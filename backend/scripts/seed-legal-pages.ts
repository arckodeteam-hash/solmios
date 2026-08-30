// seed-legal-pages.ts — UNIVERSAL (PostgreSQL + SQLite vía DbAdapter del framework).
// Crea o REEMPLAZA las 3 páginas legales del sitio público (Términos, Privacidad,
// Eliminación de Datos) con el contenido fuente de scripts/legal-pages-content.ts
// (transcripto de los .docx en frontend/).
//
// A diferencia del script anterior (SQL crudo), este usa el MISMO mecanismo que el
// mantenimiento del sitio público: `SitePagesService` (módulo site-pages, el service
// detrás de Panel › Sitio público y de GET/POST/PUT /api/site-pages). service.create()
// valida slug/categoría igual que el admin, y service.update() pasa por el mismo
// OrmRepository — nada de columnas fantasma ni de bypassear el modelo ORM.
//
// A diferencia de migrate-db.ts (insert-only, nunca pisa lo que el CMS ya tiene), este
// script SIEMPRE sincroniza estas 3 páginas con el contenido legal vigente: si el slug
// ya existe, actualiza title/metaDescription/contentHtml/category/sortOrder; si no
// existe, lo crea. Uso: correr después de editar legal-pages-content.ts, o para empujar
// el texto legal a un entorno donde estas páginas ya se crearon con contenido viejo.
//
// Local (SQLite):   DB_PATH=data/managerhotel.db bun run scripts/seed-legal-pages.ts
// Prod (Postgres):  DATABASE_URL=postgres://... bun run scripts/seed-legal-pages.ts
import { ORM, Logger, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import { registerSitePagesModels, SitePagesService } from '../src/modules/site-pages'
import type { SitePageDTO } from '../src/modules/site-pages'
import { LEGAL_PAGES_SEED } from './legal-pages-content'

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
  const service = new SitePagesService(repo, new Logger('seed-legal-pages', 'info'))

  const existingPages = (await service.list()).data

  let created = 0
  let replaced = 0

  for (const page of LEGAL_PAGES_SEED) {
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

  console.log(`\nseed-legal-pages: ${created} creadas, ${replaced} reemplazadas`)
}

main()
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('seed-legal-pages falló:', msg)
    process.exitCode = 1
  })
  .finally(async () => {
    try { await db.close() } catch { /* ignore close errors on shutdown */ }
    // ORM/Logger del framework dejan un handle abierto que impide salir solo: forzamos
    // la salida (a diferencia de migrate-db.ts, que no instancia ORM/Logger y sí termina solo).
    process.exit(process.exitCode ?? 0)
  })
