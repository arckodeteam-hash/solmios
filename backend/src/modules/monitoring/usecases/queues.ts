// monitoring/usecases/queues.ts — Estado real de las colas que YA existen (REQ-MON-06).
//
// Tres fuentes, tres caminos distintos, sin recalcular nada que otro módulo ya calcule:
//   · email_queue     → se cuenta por status (4 COUNT en paralelo) y se busca el último enviado.
//   · ari_outbox      → lo cuenta ari-outbox (stats): llega por un puerto que inyecta el conector
//                       monitoring-ari-outbox. Sin conector → `null`, que la UI lee como "sin datos".
//   · webhook_deliveries → las últimas 20 entregas con evento, código y resultado, tal cual se
//                       escriben en cada intento (webhooks/usecases/dispatch.ts).
// Nada de acá lanza por una fuente caída: cada bloque se resuelve por separado.

import type { FindOptions } from 'arckode-framework'
import type { AriOutboxStatsPort, EmailQueueSummary, QueuesSnapshot, WebhookDeliveryView } from '../types'

export const WEBHOOK_DELIVERIES_LIMIT = 20
const EMAIL_STATUSES = ['pending', 'processing', 'sent', 'failed'] as const

/** Fila de `email_queue` tal como la lee este módulo (sólo lo que mira). */
export interface EmailQueueRow {
  id: string
  status: string
  updatedAt?: string
}

/** Fila de `webhook_deliveries`: `success` es 1/0 en la base (webhooks/model.ts). */
export interface WebhookDeliveryRow {
  id: string
  webhookId: string
  event: string
  statusCode?: number | null
  success?: number | boolean
  attemptedAt: string
}

/** Lo mínimo de RepositoryAdapter que hace falta por tabla. */
export interface QueueReader<T> {
  findMany(filters?: Record<string, unknown>, options?: FindOptions): Promise<T[]>
  count(filters?: Record<string, unknown>): Promise<number>
}

export interface QueueReaders {
  email: QueueReader<EmailQueueRow>
  webhooks: QueueReader<WebhookDeliveryRow>
}

export async function resumirEmailQueue(email: QueueReader<EmailQueueRow>): Promise<EmailQueueSummary> {
  const [counts, ultimos] = await Promise.all([
    Promise.all(EMAIL_STATUSES.map((status) => email.count({ status }))),
    email.findMany({ status: 'sent' }, { limit: 1, orderBy: { field: 'updatedAt', dir: 'DESC' } }),
  ])
  const [pending = 0, processing = 0, sent = 0, failed = 0] = counts
  return {
    pending, processing, sent, failed,
    total: pending + processing + sent + failed,
    ultimoProcesadoEn: ultimos[0]?.updatedAt ?? null,
  }
}

export async function ultimasEntregasWebhook(webhooks: QueueReader<WebhookDeliveryRow>): Promise<WebhookDeliveryView[]> {
  const rows = await webhooks.findMany({}, { limit: WEBHOOK_DELIVERIES_LIMIT, orderBy: { field: 'attemptedAt', dir: 'DESC' } })
  return rows.map((r) => ({
    id: r.id,
    webhookId: r.webhookId,
    event: r.event,
    statusCode: typeof r.statusCode === 'number' ? r.statusCode : null,
    success: r.success === 1 || r.success === true,
    attemptedAt: r.attemptedAt,
  }))
}

export async function leerColas(readers: QueueReaders, ariOutbox: AriOutboxStatsPort | null): Promise<QueuesSnapshot> {
  const [email, ultimasEntregas, ari] = await Promise.all([
    resumirEmailQueue(readers.email),
    ultimasEntregasWebhook(readers.webhooks),
    ariOutbox ? ariOutbox.stats() : Promise.resolve(null),
  ])
  return { email, ariOutbox: ari, webhooks: { ultimasEntregas } }
}
