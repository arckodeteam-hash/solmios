// ari-outbox/types.ts — DTOs y tipos de la outbox de ARI (availability, rates & inventory).
// SOLO tipos: el schema de la tabla vive en model.ts (el gate MODEL_IN_TYPES_FILE de
// `bun run analyze` se queja si se cuela acá).
// Ojo: ese chequeo es TEXTUAL —un regex sobre el archivo crudo (checks.ts:446)—, así que
// nombrar acá el tipo del schema, aunque sea en un comentario, ya cuenta como violación.

/** Ciclo de vida de una fila: se agenda pending, el drain la toma processing y la cierra. */
export type AriOutboxStatus = 'pending' | 'processing' | 'sent' | 'failed'

/** Qué publicador drena la fila: cada kind tiene su propio push contra Channex. */
export type AriOutboxKind = 'rates' | 'inventory'

/** Una fila de `ari_outbox` = una ráfaga de cambios de un hotel esperando su push. */
export interface AriOutboxRow {
  id: string
  hotelId: string
  kind: AriOutboxKind | string
  /**
   * Canales explícitos de la ráfaga. `[]` (o ausente) significa cambio GLOBAL: el drain publica
   * la tarifa base y después los canales con override. Ver el comentario de `channels` en model.ts.
   */
  channels: string[]
  status: AriOutboxStatus
  /** ISO. Cuándo vence el debounce de la ráfaga, o cuándo toca el próximo reintento. */
  scheduledAt: string
  attempts: number
  maxAttempts: number
  lastError?: string | null
  /**
   * Qué proceso tiene la fila AHORA mismo (`null`/ausente = libre). Lo escribe el reclamo de la
   * cola y lo limpia el cierre: sin él, dos procesos que leen la misma fila `pending` la toman los
   * dos y publican el mismo push dos veces.
   */
  claimedBy?: string | null
  /**
   * Candado de unicidad de la fila PENDIENTE, en la base y no en el proceso. Vale
   * `${hotelId}|${kind}` mientras la fila está `pending` y `null` en cualquier otro estado, con
   * un único plano encima (ver model.ts): así dos procesos que agendan el mismo (hotel, kind) a
   * la vez no pueden dejar dos ráfagas pendientes —el perdedor recibe el error de unicidad y
   * fusiona sus canales en la fila que ya existe— mientras que el historial `sent`/`failed` del
   * mismo par convive sin chocar, porque en SQL los `null` de un índice único son distintos
   * entre sí. `undefined`/`null` = la fila ya no compite por el turno.
   */
  pendingKey?: string | null
  createdAt?: string
  updatedAt?: string
}
