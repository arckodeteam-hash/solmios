// scripts/backfill-reservation-room-type.ts — rellena `reservations.roomType` desde `rooms.type` en
// las filas anteriores a #258 (REQ-HAC-01).
//
// Desde #258 lo que se vende es el TIPO de habitación (`roomType`) y la unidad (`roomId`) se asigna
// al check-in. Las reservas existentes tienen `roomId` pero `roomType` NULL/'' (la columna la agrega
// `addColumnIfMissing` en migrate-db.ts justo antes de este paso): sin este backfill, el filtro por
// tipo, el listado de habitaciones asignables (`allowTypeChange`) y cualquier chequeo de
// type_mismatch verían un tipo vacío y tratarían toda reserva vieja como "sin tipo".
//
// TODO EN SQL, sin leer nombres de columna en JS (mismo motivo que backfill-reservation-source-web.ts):
// Postgres pliega a minúsculas los identificadores sin comillas y `fila.roomId` volvería `undefined`.
// El único valor que cruza a JS es `changes` del `run`, que los dos adapters devuelven con ese nombre.
//
// Idempotente: sólo toca filas con `roomType` NULL/'' y `roomId` que exista en `rooms`; la segunda
// corrida matchea 0. Una reserva cuya habitación ya no existe queda sin tipo (no hay de dónde
// sacarlo). Sólo se llama desde `migrate-db.ts` y desde su test
// `reservas/tests/relax-roomid-backfill-roomtype.e2e.test.ts`: NO se corre aparte.

import type { DbAdapter } from 'arckode-framework'

/**
 * Copia `rooms.type` a `reservations.roomType` donde falte. Devuelve cuántas filas cambiaron en
 * ESTA corrida (0 en las siguientes).
 */
export async function backfillReservationRoomType(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  const r = await db.run(
    `UPDATE reservations SET roomType = (SELECT type FROM rooms WHERE rooms.id = reservations.roomId)
      WHERE (roomType IS NULL OR roomType = '') AND roomId IS NOT NULL
        AND EXISTS (SELECT 1 FROM rooms WHERE rooms.id = reservations.roomId)`,
  )
  return Number(r?.changes ?? 0)
}
