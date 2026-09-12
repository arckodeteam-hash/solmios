// scripts/merge-duplicate-guests.ts — UNIVERSAL (PostgreSQL + SQLite). GitHub #273 (MR-08).
//
// Por qué existe: hasta #273 cada reserva del motor público (`public-booking.ts`,
// `public-booking-group.ts`) y cada alta del panel con email creaban una ficha NUEVA en `guests`,
// así que un mismo huésped terminaba con N fichas y el CRM, el historial, la lealtad y los
// auto-mensajes se partían entre ellas. Desde #273 los dos POST públicos y el create del panel
// pasan por `shared/usecases/find-or-create-guest.ts` y ya no generan duplicados; este script
// fusiona los que quedaron de antes.
//
// Regla:
//   - Grupo = (hotelId, LOWER(TRIM(email))) con email no vacío y más de una ficha. El mismo email
//     en OTRO hotel es otra persona a efectos del sistema (tenant) y no se toca.
//   - Canónica = la ficha más antigua por `createdAt` y después por `id` (determinista en ambos
//     motores). Se conserva ese id porque es el que más filas históricas ya apuntan.
//   - Con --apply, por grupo (y dentro de una transacción si el adapter la expone):
//       1. UPDATE <tabla> SET guestId = canónica WHERE guestId IN (duplicadas) en cada tabla con
//          `guestId`: reservations, folios, invoices, message_logs, reviews, loyalty_transactions,
//          campaign_sends, payments, deposits, ai_conversations, restaurant_orders (cargo a la
//          habitación) — y `groups.leadGuestId`.
//       2. UPDATE guests: totalStays / totalSpent / loyaltyPoints = suma del grupo, email = el
//          normalizado, name/phone completados SOLO si la canónica los tiene vacíos (con el primer
//          duplicado, por antigüedad, que los tenga — nunca se pisa lo cargado), updatedAt = ahora.
//       3. DELETE FROM guests WHERE id IN (duplicadas).
//   - --dry lista los grupos (hotel, email, canónica, duplicadas, totales resultantes y cuántas
//     filas por tabla se reapuntarían, contadas con SELECT COUNT) y NO escribe.
//   - Idempotente: la segunda corrida encuentra 0 grupos y no escribe nada.
//
// Sobre "Messages" y "Feedback" que menciona el issue: en este repo `messages` es el chat interno
// del staff (messages/model.ts: senderId/receiverId) y `feedback_pins` es QA de la UI — ninguna
// tiene `guestId`, así que no hay nada que reapuntar ahí. Las tablas reales con `guestId` son las
// de arriba. `tier` no se recalcula: es de `crm` y se deriva de los puntos al próximo movimiento.
//
// Tablas inexistentes (base vieja sin algún módulo) se detectan ANTES de abrir la transacción
// (un SELECT fallido dentro de una tx de Postgres la aborta entera) y se saltean con un aviso.
//
// Aliases snake_case en los SELECT a propósito: los adapters crudos no remapean y Postgres pliega
// `hotelId` a `hotelid` (mismo criterio que dedupe-restaurant-order-numbers.ts). Columnas sin
// comillas en UPDATE/DELETE: PG las pliega a minúsculas, que es como las creó el ORM.
//
// Paso post-deploy OPCIONAL de #273. Uso:
//   DB_PATH=data/managerhotel.db bun run scripts/merge-duplicate-guests.ts --dry   [--hotel <id>]
//   DB_PATH=data/managerhotel.db bun run scripts/merge-duplicate-guests.ts --apply [--hotel <id>]
//   DATABASE_URL=postgres://...  bun run scripts/merge-duplicate-guests.ts --dry
// Test: src/modules/huespedes/tests/merge-duplicate-guests.test.ts

import type { DbAdapter } from 'arckode-framework'

/** Tablas con `guestId` que apuntan a `guests.id`. Orden = orden de reapunte (informativo). */
export const GUEST_ID_TABLES = [
  'reservations',
  'folios',
  'invoices',
  'message_logs',
  'reviews',
  'loyalty_transactions',
  'campaign_sends',
  'payments',
  'deposits',
  'ai_conversations',
  'restaurant_orders',
] as const

/** Columnas distintas de `guestId` que también referencian a `guests.id`. */
export const GUEST_REF_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  ...GUEST_ID_TABLES.map((table) => ({ table, column: 'guestId' })),
  { table: 'groups', column: 'leadGuestId' },
]

export interface GuestMergeGroup {
  hotelId: string
  /** Email normalizado (lower + trim): el que queda en la ficha canónica. */
  email: string
  canonicalId: string
  duplicateIds: string[]
  totalStays: number
  totalSpent: number
  loyaltyPoints: number
  /** name/phone que se completan en la canónica (sólo si estaban vacíos). */
  fill: { name?: string; phone?: string }
  /** Filas por tabla (`tabla.columna`) que apuntan a alguna duplicada y se reapuntarían. */
  repoint: Record<string, number>
}

export interface MergeResult {
  groups: GuestMergeGroup[]
  /** Grupos fusionados (0 en --dry). */
  merged: number
  /** Filas reapuntadas por `tabla.columna` (0 en --dry). */
  repointed: Record<string, number>
  /** Tablas que no existen en esta base y se saltearon. */
  skippedTables: string[]
}

export type MergeDb = Pick<DbAdapter, 'query' | 'run'> & { transaction?: DbAdapter['transaction'] }

interface DupeGroupRow { hotel_id: string; norm_email: string; c: number }
interface GuestRow {
  id: string
  name: string | null
  phone: string | null
  created_at: string | null
  total_stays: number | null
  total_spent: number | null
  loyalty_points: number | null
}

const num = (v: unknown): number => Number(v ?? 0) || 0
const blank = (v: unknown): boolean => v == null || String(v).trim() === ''
const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',')
const round2 = (n: number): number => Math.round(n * 100) / 100

/** La ficha más vieja primero: createdAt y después id (determinista en ambos motores). */
export function sortOldestFirst(rows: GuestRow[]): GuestRow[] {
  return [...rows].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id)),
  )
}

/** Qué tablas referenciadas existen en esta base. Se resuelve FUERA de la transacción a propósito. */
async function existingRefs(db: Pick<DbAdapter, 'query'>): Promise<{ refs: Array<{ table: string; column: string }>; skipped: string[] }> {
  const refs: Array<{ table: string; column: string }> = []
  const skipped: string[] = []
  for (const ref of GUEST_REF_COLUMNS) {
    try {
      await db.query(`SELECT ${ref.column} FROM ${ref.table} WHERE 1 = 0`)
      refs.push(ref)
    } catch {
      skipped.push(ref.table)
    }
  }
  return { refs, skipped }
}

async function countRefs(db: Pick<DbAdapter, 'query'>, ref: { table: string; column: string }, ids: string[]): Promise<number> {
  const rows = (await db.query(
    `SELECT COUNT(*) AS c FROM ${ref.table} WHERE ${ref.column} IN (${placeholders(ids.length)})`,
    ids,
  )) as Array<{ c: number }>
  return num(rows[0]?.c)
}

/**
 * Arma el plan de fusión sin escribir: un grupo por (hotelId, email normalizado) con más de una
 * ficha. Es lo que imprime --dry y lo que ejecuta --apply.
 */
export async function planGuestMerges(db: MergeDb, opts: { hotelId?: string } = {}): Promise<GuestMergeGroup[]> {
  const { refs } = await existingRefs(db)
  return planWithRefs(db, refs, opts)
}

async function planWithRefs(
  db: MergeDb,
  refs: Array<{ table: string; column: string }>,
  opts: { hotelId?: string },
): Promise<GuestMergeGroup[]> {
  const hotelFilter = opts.hotelId ? ' AND hotelId = ?' : ''
  const hotelParams = opts.hotelId ? [opts.hotelId] : []

  const dupes = (await db.query(
    `SELECT hotelId AS hotel_id, LOWER(TRIM(email)) AS norm_email, COUNT(*) AS c FROM guests
     WHERE email IS NOT NULL AND TRIM(email) <> ''${hotelFilter}
     GROUP BY hotelId, LOWER(TRIM(email)) HAVING COUNT(*) > 1
     ORDER BY hotelId, LOWER(TRIM(email))`,
    hotelParams,
  )) as DupeGroupRow[]

  const groups: GuestMergeGroup[] = []
  for (const g of dupes) {
    const rows = (await db.query(
      `SELECT id, name, phone, createdAt AS created_at, totalStays AS total_stays, totalSpent AS total_spent,
              loyaltyPoints AS loyalty_points
       FROM guests WHERE hotelId = ? AND LOWER(TRIM(email)) = ?`,
      [g.hotel_id, g.norm_email],
    )) as GuestRow[]
    const [canonical, ...duplicates] = sortOldestFirst(rows)
    if (!canonical || duplicates.length === 0) continue

    const fill: GuestMergeGroup['fill'] = {}
    if (blank(canonical.name)) {
      const donor = duplicates.find((d) => !blank(d.name))
      if (donor) fill.name = String(donor.name).trim()
    }
    if (blank(canonical.phone)) {
      const donor = duplicates.find((d) => !blank(d.phone))
      if (donor) fill.phone = String(donor.phone).trim()
    }

    const duplicateIds = duplicates.map((d) => d.id)
    const repoint: Record<string, number> = {}
    for (const ref of refs) {
      const c = await countRefs(db, ref, duplicateIds)
      if (c > 0) repoint[`${ref.table}.${ref.column}`] = c
    }

    groups.push({
      hotelId: g.hotel_id,
      email: g.norm_email,
      canonicalId: canonical.id,
      duplicateIds,
      totalStays: rows.reduce((s, r) => s + num(r.total_stays), 0),
      totalSpent: round2(rows.reduce((s, r) => s + num(r.total_spent), 0)),
      loyaltyPoints: rows.reduce((s, r) => s + num(r.loyalty_points), 0),
      fill,
      repoint,
    })
  }
  return groups
}

async function applyGroup(
  db: Pick<DbAdapter, 'query' | 'run'>,
  refs: Array<{ table: string; column: string }>,
  group: GuestMergeGroup,
  now: string,
): Promise<Record<string, number>> {
  const repointed: Record<string, number> = {}
  const ids = group.duplicateIds
  for (const ref of refs) {
    const r = await db.run(
      `UPDATE ${ref.table} SET ${ref.column} = ? WHERE ${ref.column} IN (${placeholders(ids.length)})`,
      [group.canonicalId, ...ids],
    )
    if (r.changes > 0) repointed[`${ref.table}.${ref.column}`] = r.changes
  }

  const sets = ['totalStays = ?', 'totalSpent = ?', 'loyaltyPoints = ?', 'email = ?', 'updatedAt = ?']
  const params: unknown[] = [group.totalStays, group.totalSpent, group.loyaltyPoints, group.email, now]
  if (group.fill.name !== undefined) { sets.push('name = ?'); params.push(group.fill.name) }
  if (group.fill.phone !== undefined) { sets.push('phone = ?'); params.push(group.fill.phone) }
  params.push(group.canonicalId)
  await db.run(`UPDATE guests SET ${sets.join(', ')} WHERE id = ?`, params)

  await db.run(`DELETE FROM guests WHERE id IN (${placeholders(ids.length)})`, ids)
  return repointed
}

/**
 * Fusiona las fichas duplicadas de `guests`. Con `apply: false` sólo devuelve el plan (nada se
 * escribe). Con `apply: true` ejecuta cada grupo dentro de `db.transaction` si el adapter lo
 * expone (SqliteAdapter y PostgresAdapter lo hacen), si no, secuencial.
 */
export async function mergeDuplicateGuests(
  db: MergeDb,
  opts: { hotelId?: string; apply: boolean; log?: (msg: string) => void },
): Promise<MergeResult> {
  const log = opts.log ?? (() => {})
  const { refs, skipped } = await existingRefs(db)
  for (const t of skipped) log(`   (aviso) la tabla ${t} no existe en esta base: se saltea`)

  const groups = await planWithRefs(db, refs, { hotelId: opts.hotelId })
  const repointed: Record<string, number> = {}
  let merged = 0
  if (!opts.apply) return { groups, merged, repointed, skippedTables: skipped }

  const now = new Date().toISOString()
  for (const group of groups) {
    const done = db.transaction
      ? await db.transaction((tx) => applyGroup(tx, refs, group, now))
      : await applyGroup(db, refs, group, now)
    for (const [k, v] of Object.entries(done)) repointed[k] = (repointed[k] ?? 0) + v
    merged++
    log(`   ✔ ${group.hotelId} ${group.email}: ${group.duplicateIds.length} duplicada(s) → ${group.canonicalId}`)
  }
  return { groups, merged, repointed, skippedTables: skipped }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// Solo cuando se ejecuta como script: importarlo desde el test NO conecta ninguna base.
if (import.meta.main) {
  const argv = process.argv.slice(2)
  const dry = argv.includes('--dry')
  const apply = argv.includes('--apply')
  const hotelIdx = argv.indexOf('--hotel')
  const hotelId = hotelIdx >= 0 ? argv[hotelIdx + 1] : undefined

  if (dry === apply || (hotelIdx >= 0 && !hotelId)) {
    console.error('Uso: bun run scripts/merge-duplicate-guests.ts --dry|--apply [--hotel <id>]')
    console.error('  --dry    lista los grupos de fichas duplicadas y qué se reapuntaría, sin escribir')
    console.error('  --apply  fusiona (reapunta guestId, suma totales, borra duplicadas)')
    console.error('  --hotel  limita a un hotel')
    process.exit(1)
  }

  const { SqliteAdapter } = await import('arckode-framework/adapters/sqlite')
  const { PostgresAdapter } = await import('arckode-framework/adapters/postgres')
  const DATABASE_URL = process.env.DATABASE_URL
  const db = DATABASE_URL
    ? new PostgresAdapter({ connectionString: DATABASE_URL })
    : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })
  await db.connect()

  console.log(`\n👥 merge-duplicate-guests ${apply ? '(APPLY)' : '(DRY)'}${hotelId ? ` hotel=${hotelId}` : ''}`)
  console.log(`   motor: ${DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`)

  try {
    const result = await mergeDuplicateGuests(db, { hotelId, apply, log: (m) => console.log(m) })
    console.log(`   grupos de fichas duplicadas: ${result.groups.length}`)
    for (const g of result.groups) {
      const refs = Object.entries(g.repoint).map(([k, v]) => `${k}=${v}`).join(', ') || 'ninguna fila referenciada'
      const fill = [g.fill.name !== undefined ? `name←"${g.fill.name}"` : '', g.fill.phone !== undefined ? `phone←"${g.fill.phone}"` : '']
        .filter(Boolean).join(' ')
      console.log(`     • hotel ${g.hotelId} · ${g.email} · canónica ${g.canonicalId} · ${g.duplicateIds.length} duplicada(s) [${g.duplicateIds.join(', ')}]`)
      console.log(`       → totalStays=${g.totalStays} totalSpent=${g.totalSpent} loyaltyPoints=${g.loyaltyPoints}${fill ? ` ${fill}` : ''} · reapunta: ${refs}`)
    }
    if (!apply) {
      console.log(result.groups.length === 0
        ? '\n✅ Sin duplicados. Nada que fusionar.\n'
        : '\n   (dry) No se escribió nada. Corré con --apply para fusionar.\n')
    } else {
      const totals = Object.entries(result.repointed).map(([k, v]) => `${k}=${v}`).join(', ') || 'ninguna'
      console.log(`\n✅ Fusionados ${result.merged} grupo(s). Filas reapuntadas: ${totals}.\n`)
    }
  } finally {
    await db.close()
  }
  process.exit(0)
}
