// shared/usecases/tests/booking-sync-cron.test.ts — Cron de ingesta GLOBAL de bookings (issue #564).
//
// Cubre el factory del cron a nivel función (sin red, sin timer). El uso real del orm lo hace
// el usecase del módulo canales; acá solo se valida que el cron resuelve el módulo, propaga
// métricas, y NUNCA propaga excepciones (catch externo → zero result).
//
// Casos:
//  (1) service presente → métricas propagan a logger.info, sin warn.
//  (2) resolveModule null → warn + zero result, no throw.
//  (3) syncAllBookingRevisions lanza → catch + zero result, no propaga.
import { describe, it, expect } from 'bun:test'
import { createBookingSyncCron, DEFAULT_BOOKING_SYNC_TICK_MS } from '../booking-sync-cron'

describe('createBookingSyncCron — issue #564', () => {
  it('service presente → métricas propagan a logger.info', async () => {
    const infoCalls: any[] = []
    const warnCalls: any[] = []
    const fakeLogger = {
      info: (...a: any[]) => infoCalls.push(a),
      warn: (...a: any[]) => warnCalls.push(a),
    }
    const metrics = {
      success: true, feedSize: 3, ingested: 2, skipped: 1,
      acknowledged: 3, unmapped: 0, suspended: 0, errors: [],
    }
    const resolveModule = () => ({ syncAllBookingRevisions: async () => metrics })
    const cron = createBookingSyncCron(null, resolveModule, fakeLogger as any)

    const result = await cron()

    expect(result).toEqual(metrics)
    expect(infoCalls.length).toBeGreaterThanOrEqual(1)
    expect(warnCalls).toHaveLength(0)
  })

  it('resolveModule null → warn + zero, no throw', async () => {
    const warnCalls: any[] = []
    const fakeLogger = { info: () => {}, warn: (...a: any[]) => warnCalls.push(a) }
    const resolveModule = () => null
    const cron = createBookingSyncCron(null, resolveModule, fakeLogger as any)

    const result = await cron()

    expect(result.success).toBe(false)
    expect(result.feedSize).toBe(0)
    expect(result.ingested).toBe(0)
    expect(result.acknowledged).toBe(0)
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('syncAllBookingRevisions lanza → catch + zero, no propaga', async () => {
    const warnCalls: any[] = []
    const fakeLogger = { info: () => {}, warn: (...a: any[]) => warnCalls.push(a) }
    const resolveModule = () => ({
      syncAllBookingRevisions: async () => { throw new Error('boom') },
    })
    const cron = createBookingSyncCron(null, resolveModule, fakeLogger as any)

    const result = await cron()

    expect(result.success).toBe(false)
    expect(result.ingested).toBe(0)
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('exporta DEFAULT_BOOKING_SYNC_TICK_MS = 60 s', () => {
    expect(DEFAULT_BOOKING_SYNC_TICK_MS).toBe(60_000)
  })
})
