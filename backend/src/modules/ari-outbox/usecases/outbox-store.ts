// ari-outbox/usecases/outbox-store.ts — El puerto de persistencia de la outbox, contra la base real.
//
// Recibe `orm` crudo AL LADO del repositorio, y no solo un RepositoryAdapter, por un motivo
// puntual: el reclamo de fila del drain (usecases/outbox-queue.ts › processOne) es un
// compare-and-swap, y `RepositoryAdapter`/`OrmRepository` solo saben `update(id, data)` — un write
// por id, que no puede exigir "y que la fila SIGA en pending". Con eso, dos procesos que leyeron
// la misma fila vencida la marcan los dos y el push a Channex sale duplicado. `ORM.updateMany`
// SÍ genera el `UPDATE ... WHERE ...` sobre cualquier campo y devuelve cuántas filas cambió, pero
// el puerto de repositorio no lo expone: este archivo junta las dos mitades. Mismo criterio que
// admin/usecases/special-conditions.ts y subscriptions/usecases/handle-stripe-event.ts ›
// releaseCategorySlot (la única forma atómica que el framework permite sin SQL manual, prohibido
// por CLAUDE.md).

import { OrmRepository } from 'arckode-framework'
import type { AriOutboxRow } from '../types'
import type { AriOutboxStore } from '../service'

const MODEL = 'AriOutbox'

/**
 * El store del módulo: el `OrmRepository` de siempre para create/update/findMany/paginate, más el
 * `updateWhere` del compare-and-swap montado sobre `orm.updateMany`.
 */
export function createAriOutboxStore(orm: any): AriOutboxStore {
  const repo = new OrmRepository<AriOutboxRow>(orm, MODEL)
  return {
    create: (row) => repo.create(row as any),
    update: (id, patch) => repo.update(id, patch as any),
    findMany: (query) => repo.findMany(query),
    paginate: (filters, options) => repo.paginate(filters, options),
    updateWhere: (where, patch) => updateWhere(orm, where, patch),
  }
}

/**
 * `UPDATE ari_outbox SET <patch> WHERE <where>` → cuántas filas cambió. Devolver ese número es
 * TODO el contrato: el que ve 0 perdió la carrera y se va sin publicar.
 *
 * Dos detalles verificados contra el ORM (kernel/db/orm.ts:205 y kernel/db/orm-utils.ts › buildWhere):
 *
 * 1. `patch` VACÍO igual escribe. Es el latido del drain, que solo quiere renovar `updatedAt`:
 *    como el modelo tiene `timestamps: true`, `updateMany` agrega `updatedAt` al SET aunque
 *    `changes` venga vacío, así que la sentencia sale bien formada y devuelve 1. Sin ese
 *    `timestamps: true` el SET quedaría vacío y la sentencia sería inválida — por eso el latido
 *    depende del modelo, no de un campo de relleno.
 *
 * 2. `where` con `null` NO se traduce a `IS NULL`. `buildWhere` arma siempre `campo = ?` y bindea
 *    el null, y en SQL `campo = NULL` no matchea NUNCA (probado: devuelve 0 filas). Eso importa
 *    porque `reclaimStale` reclama filas cuyo `claimedBy` puede ser null: las anteriores a este
 *    campo, que quedarían colgadas para siempre. Para esas se cambia el guard —no se quita—: se
 *    lee la fila y el CAS se hace contra su `updatedAt`, que el propio ORM pisa en CADA escritura.
 *    Si otro proceso la tocó entre la lectura y el update, el `updatedAt` ya no es el leído y este
 *    devuelve 0, que es la misma garantía que da el guard por `claimedBy`.
 */
async function updateWhere(
  orm: any,
  where: Record<string, unknown>,
  patch: Partial<AriOutboxRow>,
): Promise<number> {
  const nulos = Object.keys(where).filter((k) => where[k] === null || where[k] === undefined)
  if (nulos.length === 0) return Number(await orm.updateMany(MODEL, where, patch)) || 0

  const concretos: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(where)) if (!nulos.includes(k)) concretos[k] = v

  const candidatas = (await orm.findMany(MODEL, concretos)) as AriOutboxRow[]
  let cambiadas = 0
  for (const fila of candidatas) {
    // El filtro por null se resuelve en memoria sobre la fila leída; el UPDATE de abajo es el que
    // decide quién gana.
    if (nulos.some((k) => (fila as unknown as Record<string, unknown>)[k] != null)) continue
    // Sin `updatedAt` no hay guard optimista posible. Se actualiza igual (y no se abandona la
    // fila): con `timestamps: true` esto no pasa, y dejarla sin reclamar sería perder el push.
    const guard = fila.updatedAt ? { ...concretos, id: fila.id, updatedAt: fila.updatedAt } : { ...concretos, id: fila.id }
    cambiadas += Number(await orm.updateMany(MODEL, guard, patch)) || 0
  }
  return cambiadas
}
