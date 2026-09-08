// ari-outbox/types.ts — DTOs y tipos de la outbox de ARI (availability, rates & inventory).
// SOLO tipos: el ModelDefinition vive en model.ts (el gate MODEL_IN_TYPES_FILE de
// `bun run analyze` se queja si el schema se cuela acá).

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
  createdAt?: string
  updatedAt?: string
}
