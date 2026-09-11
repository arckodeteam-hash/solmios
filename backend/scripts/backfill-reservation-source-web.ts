// scripts/backfill-reservation-source-web.ts — pasa a `source='web'` las reservas del motor público
// que ya existían antes de #247 (REQ-RWP-04), cuando el motor las grababa como `source='direct'`.
//
// Desde #247 el motor público escribe `source:'web'` (el `channel` sigue en 'direct': el reporte de
// directas las cuenta igual) para que el listado distinga "reserva web" de "carga en recepción". Las
// filas anteriores al cambio quedaron todas en 'direct' y el panel las mostraba como "Directa".
//
// El discriminador es `accessToken`: SÓLO el flujo público lo setea — `bookingengine/usecases/
// public-booking.ts` (`accessToken: crypto.randomUUID()`), `public-booking-group.ts`
// (`sharedAccessToken`) y `stripe.ts` lo consumen para el link de confirmación/pago del widget—,
// mientras que una reserva cargada desde `/api/panel/reservas` lo deja en NULL. Una fila
// `source='direct'` con `accessToken` no nulo ni vacío nació en el motor público, sin excepción.
//
// TODO EN SQL, sin leer nombres de columna en JS (mismo motivo que backfill-ari-outbox-pending-key.ts):
// Postgres pliega a minúsculas los identificadores sin comillas, así que `fila.accessToken` volvería
// `undefined` en producción. Acá el único valor que cruza a JS es `changes` del `run`, que los dos
// adapters (SqliteAdapter `result.changes`, PostgresAdapter `rowCount`) devuelven con ese nombre.
//
// Idempotente: la primera corrida convierte las filas que matchean y la segunda matchea 0 (ya son
// 'web'). Sólo se llama desde `migrate-db.ts` (corre en cada deploy) y desde su test
// `reservas/tests/backfill-source-web.e2e.test.ts`: NO se corre aparte.

import type { DbAdapter } from 'arckode-framework'

/**
 * Convierte a `source='web'` las reservas `source='direct'` con `accessToken` no nulo ni vacío.
 * Devuelve cuántas filas cambiaron en ESTA corrida (0 en las siguientes).
 */
export async function backfillReservationSourceWeb(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  const r = await db.run(
    `UPDATE reservations SET source = 'web' WHERE source = 'direct' AND accessToken IS NOT NULL AND accessToken <> ''`,
  )
  return Number(r?.changes ?? 0)
}
