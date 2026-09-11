// shared/utils/db-errors.ts — Clasificación de errores del motor, portable SQLite + Postgres.
//
// El adapter no normaliza los errores del driver: una violación de UNIQUE llega como
// "UNIQUE constraint failed: ..." en SQLite y como "duplicate key value violates unique
// constraint ..." (SQLSTATE 23505) en Postgres. El código que usa un índice único como
// garantía dura de concurrencia necesita distinguir esa carrera de un error real.

/**
 * Detecta violación de unique constraint en SQLite y en Postgres.
 *
 * Se usa donde el UNIQUE INDEX es el árbitro de una carrera: el perdedor reintenta
 * (numerador de facturas) o trata la operación como no-op idempotente (ledger de stock).
 */
export function isUniqueViolation(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')
}

/**
 * Detecta "la tabla no existe" en SQLite (`no such table: x`) y en Postgres (SQLSTATE 42P01
 * `undefined_table`, o el mensaje `relation "x" does not exist` cuando el driver no propaga `code`).
 *
 * Lo usa `migrate-db.ts` para distinguir "la tabla la crea RUN_MIGRATE y todavía no corrió" (aviso,
 * se aplica en la próxima corrida) de un error real. NO alcanza con buscar "does not exist": una
 * columna faltante (42703, `column "x" does not exist`) también lo dice y ESO sí es un error.
 */
export function isMissingTableError(e: unknown): boolean {
  if ((e as { code?: string } | null)?.code === '42P01') return true
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes('no such table') || (msg.includes('relation') && msg.includes('does not exist'))
}
