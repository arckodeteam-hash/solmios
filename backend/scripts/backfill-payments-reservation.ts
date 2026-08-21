// scripts/backfill-payments-reservation.ts — COR-B (gate, 3ª ronda).
//
// La columna `payments.reservationId` (BUG-ceiling-bypass) llegó SIN backfill y con un comentario
// que decía que lo previo no era reconstruible. Falso: `shared/usecases/charge-reschedule-diff.ts`
// escribía `metadata: { reservationId, source: 'reschedule' }` en esas MISMAS filas desde ANTES de
// que existiera la columna — el dato siempre estuvo, sólo que en JSON (no filtrable por WHERE).
// Sin este backfill, los cobros de reprogramación históricos siguen invisibles para
// `paidForReservation` y el techo de `payment-requests` los autoriza a recobrar por Stripe.
//
// Portable SQLite + Postgres: el JSON se parsea en JS (json_extract no existe en PG) y los
// placeholders `?` los convierte el PostgresAdapter. Idempotente: sólo toca filas con
// `reservationId IS NULL`, así que correrlo dos veces no duplica trabajo ni pisa correcciones.

import type { DbAdapter } from 'arckode-framework'

/** `metadata` llega como STRING (columna TEXT del ORM) — también tolera objeto por si el driver lo parsea. */
function reservationIdFromMetadata(metadata: unknown): string | null {
  if (typeof metadata === 'string') {
    try { return reservationIdFromMetadata(JSON.parse(metadata)) } catch { return null }
  }
  if (metadata && typeof metadata === 'object') {
    const rid = (metadata as Record<string, unknown>).reservationId
    if (typeof rid === 'string' && rid.trim()) return rid.trim()
  }
  return null
}

/**
 * Reconstruye `payments.reservationId` desde la metadata histórica. Devuelve cuántas filas fijó.
 * Sólo se llama desde `migrate-db.ts` (tras el addColumnIfMissing) y desde su test.
 */
export async function backfillPaymentsReservationId(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  const rows = (await db.query(
    'SELECT id, metadata FROM payments WHERE reservationId IS NULL AND metadata IS NOT NULL',
  )) as Array<{ id: string; metadata: unknown }>
  let fixed = 0
  for (const row of rows) {
    const rid = reservationIdFromMetadata(row.metadata)
    if (!rid) continue
    // El `AND reservationId IS NULL` del UPDATE defiende contra una corrida concurrente.
    await db.run('UPDATE payments SET reservationId = ? WHERE id = ? AND reservationId IS NULL', [rid, row.id])
    fixed++
  }
  return fixed
}
