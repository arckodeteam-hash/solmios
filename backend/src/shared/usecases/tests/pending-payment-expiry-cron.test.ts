// shared/usecases/tests/pending-payment-expiry-cron.test.ts — Tests del factory del cron (#248 REQ-RWP-05, #266).
//
// Cubre: kill-switch por env (evaluado por tick, env inyectado — no toca process.env), log de
// resumen por corrida, try/catch cron-level y constantes. La lógica de vencimiento está en
// pending-payment-expiry.test.ts.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { Logger } from 'arckode-framework'
import {
  createPendingPaymentExpiryCron,
  isPendingPaymentExpiryDisabled,
  PENDING_PAYMENT_EXPIRY_TICK_MS,
  PENDING_PAYMENT_EXPIRY_FIRST_TICK_MS,
} from '../pending-payment-expiry-cron'
import type { PendingPaymentExpiryResult } from '../pending-payment-expiry'

const log = silentLogger()

function makeRun(impl: () => Promise<PendingPaymentExpiryResult>): { run: () => Promise<PendingPaymentExpiryResult>; calls: () => number } {
  let n = 0
  return { run: async () => { n++; return impl() }, calls: () => n }
}

/** Logger que captura los `info` (para verificar el resumen por corrida). */
function capturingLogger(): { logger: Logger; infos: string[] } {
  const infos: string[] = []
  const logger = {
    ...log,
    info: (msg: string, ..._rest: unknown[]) => { infos.push(msg) },
  } as unknown as Logger
  return { logger, infos }
}

describe('createPendingPaymentExpiryCron', () => {
  it('BOOKING_PENDING_TTL_DISABLED=1 → no corre el sweep y devuelve ceros', async () => {
    const { run, calls } = makeRun(async () => ({ scanned: 5, expired: 2, skipped: 3, errors: [] }))
    const cron = createPendingPaymentExpiryCron(run, log, { BOOKING_PENDING_TTL_DISABLED: '1' })
    const result = await cron()
    expect(calls()).toBe(0)
    expect(result).toEqual({ scanned: 0, expired: 0, skipped: 0, errors: [] })
  })

  it('sin flag → corre el sweep una vez y loguea el resumen "vencidas: N"', async () => {
    const expected: PendingPaymentExpiryResult = { scanned: 5, expired: 2, skipped: 3, errors: [] }
    const { run, calls } = makeRun(async () => expected)
    const { logger, infos } = capturingLogger()
    const cron = createPendingPaymentExpiryCron(run, logger, {})
    const result = await cron()
    expect(calls()).toBe(1)
    expect(result).toEqual(expected)
    expect(infos.some((m) => m.includes('vencidas: 2'))).toBe(true)
  })

  it('evalúa el flag en cada tick (no al construir)', async () => {
    const env: NodeJS.ProcessEnv = {}
    const { run, calls } = makeRun(async () => ({ scanned: 0, expired: 0, skipped: 0, errors: [] }))
    const cron = createPendingPaymentExpiryCron(run, log, env)
    await cron()
    env.BOOKING_PENDING_TTL_DISABLED = '1'
    await cron()
    expect(calls()).toBe(1)
  })

  it('no rompe si run tira (cron-level try/catch)', async () => {
    const { run } = makeRun(async () => { throw new Error('boom') })
    const cron = createPendingPaymentExpiryCron(run, log, {})
    const result = await cron()
    expect(result.scanned).toBe(0)
    expect(result.expired).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toContain('cron-level')
    expect(result.errors[0].reason).toContain('boom')
  })

  it('isPendingPaymentExpiryDisabled solo con "1" exacto', () => {
    expect(isPendingPaymentExpiryDisabled({ BOOKING_PENDING_TTL_DISABLED: '1' })).toBe(true)
    expect(isPendingPaymentExpiryDisabled({ BOOKING_PENDING_TTL_DISABLED: 'true' })).toBe(false)
    expect(isPendingPaymentExpiryDisabled({})).toBe(false)
  })

  it('constantes (#266): tick 5 min y primer tick 20 s', () => {
    expect(PENDING_PAYMENT_EXPIRY_TICK_MS).toBe(5 * 60 * 1000)
    expect(PENDING_PAYMENT_EXPIRY_FIRST_TICK_MS).toBe(20_000)
  })
})
