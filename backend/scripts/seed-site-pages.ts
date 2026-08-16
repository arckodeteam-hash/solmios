// scripts/seed-site-pages.ts — Importa las páginas estáticas del sitio (footer de
// solmios.com) al CMS `site-pages`. Idempotente por slug: existe → update de contenido,
// no existe → insert. Portable SQLite/PG (mismo patrón de conexión que migrate-db.ts).
//
// Fuente: ../documentacion/paginas-solmios/*.html — de cada archivo extrae
// <title>, meta description y el inner de <main> (el hero lo aporta el landing
// con el title/description del registro del CMS; el contenido es solo <main>).
//
// EXCLUSIONES: `estado.html` (página FUNCIONAL con fetch en vivo, no contenido
// editorial — se sirve como archivo estático) y archivos ya gestionados aparte.
//
// Uso:
//   bun run scripts/seed-site-pages.ts                     # SQLite dev
//   DATABASE_URL=postgres://... bun run scripts/seed-site-pages.ts
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import type { DbAdapter } from 'arckode-framework'

const DATABASE_URL = process.env.DATABASE_URL
const db: DbAdapter & { connect(): Promise<void> } = DATABASE_URL
  ? new PostgresAdapter({ connectionString: DATABASE_URL })
  : new SqliteAdapter({
      path: process.env.DB_PATH || './data/managerhotel.db',
      wal: true,
      foreignKeys: true,
    })

const PAGES_DIR = join(import.meta.dir, '..', '..', 'documentacion', 'paginas-solmios')

/** Páginas FUNCIONALES (con lógica propia) que no viven en el CMS. */
const SKIP = new Set(['estado.html'])

/** slug → (categoría, orden). Los slugs del footer del sitio. */
const META: Record<string, { category: string; sortOrder: number }> = {
  'sobre-nosotros': { category: 'empresa', sortOrder: 10 },
  contacto: { category: 'empresa', sortOrder: 20 },
  carreras: { category: 'empresa', sortOrder: 30 },
  api: { category: 'producto', sortOrder: 10 },
  ayuda: { category: 'soporte', sortOrder: 10 },
  documentacion: { category: 'soporte', sortOrder: 20 },
  comunidad: { category: 'soporte', sortOrder: 40 },
  privacidad: { category: 'legal', sortOrder: 10 },
  terminos: { category: 'legal', sortOrder: 20 },
  cookies: { category: 'legal', sortOrder: 30 },
  blog: { category: 'blog', sortOrder: 10 },
  'blog-calendario-y-canales': { category: 'blog', sortOrder: 20 },
  'blog-checkin-sin-llaves': { category: 'blog', sortOrder: 30 },
  'blog-facturacion-fiscal': { category: 'blog', sortOrder: 40 },
}

interface Extracted {
  title: string
  description: string
  contentHtml: string
}

function extract(html: string): Extracted {
  const rawTitle = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? ''
  const title = rawTitle.replace(/\s*[—-]\s*SolmiOS\s*$/i, '').trim() || rawTitle.trim()
  const description =
    /<meta name="description" content="([^"]*)"/.exec(html)?.[1]?.trim() ?? ''
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1]?.trim() ?? ''
  return { title, description, contentHtml: main }
}

async function main() {
  await db.connect()

  const files = readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('.html') && !SKIP.has(f))
    .sort()

  if (files.length === 0) {
    console.log(`No hay .html en ${PAGES_DIR} — nada que sembrar.`)
    return
  }

  let created = 0
  let updated = 0

  for (const file of files) {
    const slug = file.replace(/\.html$/, '')
    const meta = META[slug]
    if (!meta) {
      console.warn(`⚠ ${slug}: sin categoría definida en META — se omite. Agregala al mapa.`)
      continue
    }

    const { title, description, contentHtml } = extract(readFileSync(join(PAGES_DIR, file), 'utf-8'))
    const now = new Date().toISOString()

    // Sin genérico en la llamada: la interface DbAdapter no lo declara (mismo
    // estilo que migrate-db.ts — cast del resultado).
    const existing = (await db.query(
      'SELECT id FROM site_pages WHERE slug = ? LIMIT 1',
      [slug],
    )) as Array<{ id: string }>
    if (existing && existing.length > 0) {
      await db.run(
        `UPDATE site_pages SET title = ?, metaDescription = ?, contentHtml = ?,
           category = ?, sortOrder = ?, updatedAt = ? WHERE slug = ?`,
        [title, description || null, contentHtml, meta.category, meta.sortOrder, now, slug],
      )
      updated++
    } else {
      await db.run(
        `INSERT INTO site_pages (id, hotelId, slug, title, metaDescription, contentHtml,
           category, status, sortOrder, createdAt, updatedAt)
         VALUES (?, 'platform', ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
        [crypto.randomUUID(), slug, title, description || null, contentHtml,
          meta.category, meta.sortOrder, now, now],
      )
      created++
    }
    console.log(`✓ /${slug} (${meta.category}) — ${existing && existing.length > 0 ? 'actualizada' : 'creada'}`)
  }

  console.log(`\nSite-pages seed listo: ${created} creadas, ${updated} actualizadas.`)
  console.log(`Páginas funcionales excluidas (se sirven estáticas): ${[...SKIP].join(', ') || '—'}`)
  await db.close()
}

main().catch((e) => {
  console.error('seed-site-pages falló:', e)
  process.exit(1)
})
