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

/**
 * #239 — Cierre estándar de un bloque de `migrate-db.ts`. El archivo ya usaba este criterio en
 * `ensureRestaurantOrderNumberIndex` y `ensureBusinessDateColumnsAndIndexes`; vive acá para que todos
 * los bloques lo compartan en vez de repetirlo — o, como pasaba en nueve de ellos, no aplicarlo.
 *
 * Dos causas que NO son lo mismo y venían confundidas bajo un `console.log`:
 *  - la tabla todavía no existe → `RUN_MIGRATE=1` no corrió; el paso se aplica en la próxima vuelta.
 *    Es un aviso y la migración sigue.
 *  - cualquier OTRO fallo (permisos, datos corruptos, disco) → RELANZA, para que `bun run migrate`
 *    termine con exit ≠ 0 y el deploy corte. Sin esto la migración salía en 0 con la garantía
 *    ausente: así es como un UNIQUE de dinero puede faltar en producción sin que nadie se entere.
 *
 * `consequence` no es decorativo: es lo que lee el operador para decidir si el deploy sigue. Dice qué
 * se rompe, no "falló X".
 */
export function failMigrationStep(e: unknown, step: { what: string; missingTable: string; consequence: string }): void {
  const msg = e instanceof Error ? e.message : String(e)
  if (isMissingTableError(e)) {
    console.warn(`⚠ ${step.what}: tabla ${step.missingTable} aún no migrada (correr RUN_MIGRATE=1) — ${msg.slice(0, 120)}`)
    return
  }
  throw new Error(`${step.what}: ${step.consequence} Motivo: ${msg}`, { cause: e })
}
