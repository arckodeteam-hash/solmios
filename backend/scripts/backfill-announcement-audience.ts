// scripts/backfill-announcement-audience.ts — UNIVERSAL (PostgreSQL + SQLite).
//
// Rellena `announcements.audience` en las filas anteriores a esa columna.
//
// POR QUÉ ES OBLIGATORIO y no un detalle cosmético: el listado busca los anuncios de plataforma
// por `audience = 'all'`, porque el ORM del framework solo filtra por igualdad y `hotelId IS NULL`
// no es expresable (`kernel/db/orm-utils.ts:buildWhere`). Una fila con `audience` nulo no matchea
// NINGUNA consulta del listado: sin este backfill, los anuncios que ya existían dejan de verse.
//
//   - fila CON hotelId  → 'hotel' (era, y sigue siendo, de ese hotel)
//   - fila SIN hotelId  → 'all'   (era un anuncio de plataforma; hasta ahora no lo veía nadie)
//
// ⚠️ Un anuncio viejo sin hotel y con active = 1 EMPIEZA A VERSE en todos los hoteles al correr
// esto. Revisar antes qué hay: el script los lista y no toca `active`.
//
// Idempotente: solo escribe donde `audience` está nulo o vacío.
//
// Local (SQLite):  DB_PATH=data/managerhotel.db bun run scripts/backfill-announcement-audience.ts
// Prod (Postgres): DATABASE_URL=postgres://... bun run scripts/backfill-announcement-audience.ts
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

interface Row { id: string; title: string; hotelid?: string | null; hotelId?: string | null; active?: number | null }

const hotelOf = (r: Row) => r.hotelId ?? r.hotelid ?? null

async function main(): Promise<void> {
  await db.connect()
  try {
    const pending = (await db.query(
      `SELECT id, title, hotelId, active FROM announcements WHERE audience IS NULL OR audience = ''`,
    )) as Row[]

    if (pending.length === 0) {
      console.log('announcements.audience: nada pendiente — todas las filas ya tienen audiencia.')
      return
    }

    const globales = pending.filter((r) => !hotelOf(r))
    const deHotel = pending.filter((r) => !!hotelOf(r))

    if (globales.length > 0) {
      console.log(`\n⚠️  ${globales.length} anuncio(s) SIN hotel pasan a verse en TODOS los hoteles:`)
      for (const r of globales) {
        console.log(`   - ${r.id}  active=${r.active ?? '?'}  "${r.title}"`)
      }
      console.log('   Si alguno no debe difundirse: UPDATE announcements SET active = 0 WHERE id = ...\n')
    }

    await db.run(`UPDATE announcements SET audience = 'hotel' WHERE (audience IS NULL OR audience = '') AND hotelId IS NOT NULL AND hotelId <> ''`)
    await db.run(`UPDATE announcements SET audience = 'all' WHERE (audience IS NULL OR audience = '') AND (hotelId IS NULL OR hotelId = '')`)

    console.log(`announcements.audience: ${deHotel.length} → 'hotel', ${globales.length} → 'all'.`)
  } finally {
    await db.close()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
