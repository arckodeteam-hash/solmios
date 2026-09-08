// scripts/backfill-ari-outbox-pending-key.ts — pobla `ari_outbox.pendingKey` en las bases que ya
// tenían filas pendientes antes de que existiera la columna (#65).
//
// `pendingKey` vale 'hotelId|kind' MIENTRAS la fila está pending y NULL en cualquier otro estado.
// Sobre esa columna hay un índice único PLANO que, como en SQL los NULL de un índice único son
// DISTINTOS entre sí, se comporta igual que el índice único PARCIAL (hotelId, kind) WHERE
// status='pending' que el ORM no sabe expresar: sólo puede chocar entre dos filas pendientes del
// mismo par, y todo el historial sent/failed convive sin problema.
//
// El backfill NO puede marcar todas las pendientes: una base con el bug de #65 tiene DOS filas
// pending del mismo par, y marcarlas a las dos haría fallar el CREATE UNIQUE INDEX que viene
// justo después. Se marca UNA sola por grupo —la de `id` mínimo— y las demás quedan en NULL: se
// drenan como hasta hoy y el índice rige de ahí en adelante.
//
// TODO EN SQL, sin leer valores de columna en JS, y eso es DELIBERADO: los adapters crudos
// (`DbAdapter`) no pasan por el remap de `OrmRepository`, y Postgres pliega a minúsculas los
// identificadores sin comillas, así que una fila que vuelve de `db.query('SELECT hotelId ...')`
// trae la clave `hotelid` en Postgres y `hotelId` en SQLite (CLAUDE.md: "Columnas físicas en PG
// son lowercase"). Un `fila.hotelId` daría `undefined` EN PRODUCCIÓN y escribiría la clave
// corrupta 'undefined|<kind>', agrupando por kind y pisando hoteles distintos entre sí. Haciendo
// la decisión dentro de la sentencia, el nombre de la columna nunca cruza a JS y el problema no
// existe. No lo reescribas como un loop.
//
// Portable SQLite + Postgres (los dos motores del proyecto): `||` es la concatenación ANSI y las
// subconsultas correlacionadas las soportan ambos.
//
// El `NOT EXISTS` es la condición que hace esto idempotente y NO se puede sacar: comprueba que el
// turno del grupo no esté YA tomado. Con el `MIN(id)` solo, una fila pendiente que entra después
// con un `id` MENOR que la que ya tiene la clave se elige a sí misma y choca contra el índice —y
// pasa de verdad, porque los id son UUID y no un contador, así que "más nueva" no implica "id
// mayor". El caso de idempotencia de model.e2e.test.ts falla si se saca.
//
// El `MIN(id)` no necesita filtrar por `pendingKey IS NULL` (cuando el `NOT EXISTS` se cumple,
// NINGUNA pendiente del grupo tiene clave, así que el mínimo es el mismo con o sin el filtro):
// se deja fuera a propósito para no sugerir una condición que ningún test puede sostener.

import type { DbAdapter } from 'arckode-framework'

/**
 * Marca la fila pendiente más vieja de cada (hotelId, kind) que todavía no tenga `pendingKey`.
 * Devuelve cuántas quedaron marcadas en total (incluidas las de corridas anteriores), que es lo
 * único observable sin leer nombres de columna.
 *
 * Sólo se llama desde `migrate-db.ts` (tras el addColumnIfMissing y ANTES del CREATE UNIQUE INDEX)
 * y desde su test.
 */
export async function backfillAriOutboxPendingKey(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  await db.run(`
    UPDATE ari_outbox
       SET pendingKey = hotelId || '|' || kind
     WHERE status = 'pending'
       AND pendingKey IS NULL
       AND id = (SELECT MIN(otra.id)
                   FROM ari_outbox otra
                  WHERE otra.hotelId = ari_outbox.hotelId
                    AND otra.kind = ari_outbox.kind
                    AND otra.status = 'pending')
       AND NOT EXISTS (SELECT 1
                         FROM ari_outbox ya
                        WHERE ya.hotelId = ari_outbox.hotelId
                          AND ya.kind = ari_outbox.kind
                          AND ya.status = 'pending'
                          AND ya.pendingKey IS NOT NULL)
  `)
  // COUNT(*) con alias en minúsculas a propósito: es el mismo motivo de arriba —un alias
  // camelCase volvería plegado desde Postgres y este número sería `undefined`.
  const filas = (await db.query(
    `SELECT COUNT(*) AS marcadas FROM ari_outbox WHERE status = 'pending' AND pendingKey IS NOT NULL`,
  )) as Array<{ marcadas: number | string }>
  return Number(filas[0]?.marcadas ?? 0)
}
