// ari-outbox/model.ts — Schema de base de datos de la outbox de ARI.
// Describe la tabla `ari_outbox`: las ráfagas de cambios de tarifas/inventario que esperan su
// push a Channex. Importado por index.ts → orm.define() para registrar el modelo.
//
// Existe porque el coalescing vivía SOLO en memoria (canales/usecases/push-coalescing.ts): la
// ráfaga se guardaba en un Map con un setTimeout de 1.5s, así que un reinicio del proceso dentro
// de esa ventana —un deploy, un crash— se comía el push y el canal quedaba con el precio viejo,
// sin rastro de que había algo pendiente. Persistir la ráfaga ANTES de que venza el debounce hace
// que una instancia nueva pueda drenarla, y deja la cola consultable (CA-9).
//
// OJO (anti-patrón del repo, ver canales/model.ts › channexGroupId): el ORM DESCARTA sin warning
// los campos que no están declarados acá. Todo campo que el código de la cola use tiene que estar
// en este `fields`; el e2e de tests/model.e2e.test.ts es justamente el guardia de eso.

import type { ModelDefinition, ORM } from 'arckode-framework'

export const AriOutboxModel: ModelDefinition = {
  table: 'ari_outbox',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    // Multi-tenancy: el drain agrupa y publica por hotel, así que se consulta siempre filtrando acá.
    hotelId: { type: 'string', required: true, indexed: true },
    // Qué publicador drena la fila ('rates' | 'inventory'): son dos pushes distintos contra
    // Channex y no se pueden mezclar en una misma llamada.
    kind: { type: 'string', required: true },
    // PLURAL y json —no el `channel` singular que sugería el issue— porque una fila es UNA RÁFAGA,
    // el equivalente persistente del `entry` del Map de push-coalescing.ts:15, donde los canales
    // explícitos se acumulan en un Set mientras dura el debounce. La semántica es la de `flush`:
    //   []           → cambio GLOBAL (temporada, planning, CTA/CTD): se publica la base Y DESPUÉS
    //                  los canales con tarifa propia.
    //   con canales  → el hotel editó la tarifa DE ESOS canales: se publica solo eso.
    // Con `channel` singular una ráfaga mixta serían varias filas y habría que BORRAR la fila
    // global cuando llega una explícita para no republicar la base encima del override — o sea,
    // reimplementar el Set del coalescer a fuerza de deletes. Acumular en el array es la misma
    // operación que ya hace el Map, y `json` está soportado por SQLite y Postgres (canales/model.ts
    // lo usa en `config`), así que no ata la migración a un motor.
    channels: { type: 'json', default: [] },
    // pending → processing → sent | failed. Indexado porque el tick del drain busca exactamente
    // por status en cada pasada (y el listado admin filtra por lo mismo).
    status: { type: 'string', default: 'pending', indexed: true },
    // ISO. Cuándo vence el debounce de la ráfaga y, después de un fallo, cuándo toca el próximo
    // reintento: un solo campo para las dos cosas, porque el drain siempre pregunta lo mismo
    // ("¿qué está vencido?"). Equivale al `nextRetryAt` de email_queue fusionado con el timer.
    scheduledAt: { type: 'string', required: true },
    // Backoff y fallo permanente, con el mismo molde que la cola de emails (shared/models.ts).
    attempts: { type: 'number', default: 0 },
    maxAttempts: { type: 'number', default: 3 },
    // Texto del último error, para que el listado admin diga POR QUÉ una fila quedó en failed sin
    // tener que ir a los logs del proceso que la intentó.
    lastError: { type: 'string' },
    // Dueño actual de la fila (`null` = libre). Es la otra mitad del compare-and-swap del drain:
    // el reclamo escribe acá su identidad y el cierre solo aplica si la fila SIGUE siendo suya, así
    // una fila reclamada por stale a mitad de push no la cierra el proceso zombi. Declarado acá
    // porque el ORM descarta sin warning los campos que no están en `fields` (ver el aviso de arriba).
    claimedBy: { type: 'string' },
  },
}

export function registerAriOutboxModels(orm: ORM): void {
  orm.define('AriOutbox', AriOutboxModel)
}
