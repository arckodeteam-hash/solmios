// monitoring/tests/queues.test.ts — Estado de las colas con datos sembrados de las TRES fuentes
// (REQ-MON-06): email_queue por status, ari_outbox por el puerto de stats, y las últimas entregas
// de webhook con su código. Lectores en memoria con la semántica de OrmRepository.

import { describe, it, expect } from 'bun:test'
import { leerColas, resumirEmailQueue, ultimasEntregasWebhook, WEBHOOK_DELIVERIES_LIMIT, type EmailQueueRow, type QueueReader, type WebhookDeliveryRow } from '../usecases/queues'
import type { AriOutboxCounts } from '../types'

function reader<T extends { id: string }>(rows: T[]): QueueReader<T> {
  const matchea = (row: T, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)
  return {
    async findMany(where = {}, options = {}) {
      let out = rows.filter((r) => matchea(r, where))
      const ob = Array.isArray(options.orderBy) ? options.orderBy[0] : options.orderBy
      if (ob) {
        out = [...out].sort((a, b) => {
          const av = String((a as unknown as Record<string, unknown>)[ob.field] ?? '')
          const bv = String((b as unknown as Record<string, unknown>)[ob.field] ?? '')
          return av.localeCompare(bv) * (ob.dir === 'DESC' ? -1 : 1)
        })
      }
      if (options.limit) out = out.slice(0, options.limit)
      return out
    },
    async count(where = {}) { return rows.filter((r) => matchea(r, where)).length },
  }
}

const EMAILS: EmailQueueRow[] = [
  { id: 'm1', status: 'pending' }, { id: 'm2', status: 'pending' }, { id: 'm3', status: 'pending' }, { id: 'm4', status: 'pending' },
  { id: 'm5', status: 'processing' },
  { id: 'm6', status: 'sent', updatedAt: '2026-09-09T10:00:00.000Z' },
  { id: 'm7', status: 'sent', updatedAt: '2026-09-10T08:30:00.000Z' },
  { id: 'm8', status: 'failed' },
]

const DELIVERIES: WebhookDeliveryRow[] = [
  { id: 'd1', webhookId: 'w1', event: 'reservation.created', statusCode: 200, success: 1, attemptedAt: '2026-09-10T09:00:00.000Z' },
  { id: 'd2', webhookId: 'w1', event: 'reservation.created', statusCode: 500, success: 0, attemptedAt: '2026-09-10T09:05:00.000Z' },
  { id: 'd3', webhookId: 'w2', event: 'payment.received', statusCode: null, success: 0, attemptedAt: '2026-09-10T09:06:00.000Z' },
]

const ARI: AriOutboxCounts = { pending: 2, processing: 0, sent: 10, failed: 1, retrying: 1, total: 14 }

describe('GET /api/admin/monitoring/queues — leerColas', () => {
  it('con datos sembrados de las 3 fuentes devuelve email, ariOutbox y webhooks', async () => {
    const snap = await leerColas({ email: reader(EMAILS), webhooks: reader(DELIVERIES) }, { stats: async () => ARI })

    // REQ-MON-06: 4 correos pendientes → 4 pendientes.
    expect(snap.email).toEqual({ pending: 4, processing: 1, sent: 2, failed: 1, total: 8, ultimoProcesadoEn: '2026-09-10T08:30:00.000Z' })
    // Lo cuenta ari-outbox: acá llega tal cual, sin recalcular estados.
    expect(snap.ariOutbox).toEqual(ARI)
    // Más reciente primero; la fallida trae su 500 y el intento sin respuesta trae null.
    expect(snap.webhooks.ultimasEntregas.map((d) => d.id)).toEqual(['d3', 'd2', 'd1'])
    expect(snap.webhooks.ultimasEntregas[1]).toEqual({ id: 'd2', webhookId: 'w1', event: 'reservation.created', statusCode: 500, success: false, attemptedAt: '2026-09-10T09:05:00.000Z' })
    expect(snap.webhooks.ultimasEntregas[2]!.success).toBe(true)
    expect(snap.webhooks.ultimasEntregas[0]!.statusCode).toBeNull()
  })

  it('sin el conector de ari-outbox el bloque viene null (sin datos), no en cero', async () => {
    const snap = await leerColas({ email: reader([]), webhooks: reader([]) }, null)
    expect(snap.ariOutbox).toBeNull()
    expect(snap.email).toEqual({ pending: 0, processing: 0, sent: 0, failed: 0, total: 0, ultimoProcesadoEn: null })
    expect(snap.webhooks.ultimasEntregas).toEqual([])
  })

  it('las entregas de webhook se acotan a las últimas 20', async () => {
    const muchas: WebhookDeliveryRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `d${i}`, webhookId: 'w', event: 'e', statusCode: 200, success: true,
      attemptedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    }))
    const out = await ultimasEntregasWebhook(reader(muchas))
    expect(out).toHaveLength(WEBHOOK_DELIVERIES_LIMIT)
    expect(out[0]!.id).toBe('d24')
    expect(out[19]!.id).toBe('d5')
  })

  it('resumirEmailQueue suma el total con los cuatro estados', async () => {
    const r = await resumirEmailQueue(reader(EMAILS))
    expect(r.total).toBe(r.pending + r.processing + r.sent + r.failed)
  })
})
