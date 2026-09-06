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
