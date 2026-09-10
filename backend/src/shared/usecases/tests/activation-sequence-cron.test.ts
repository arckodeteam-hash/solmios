// activation-sequence-cron.test.ts — REQ-PIPE-08/09 (#149/#150): reglas, dedup, silencio por
// contacto humano, rescate +2/+7, perdido automático +14 y reinicio tras extender.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createActivationSequenceCron, shouldAutoLose, rescueEventFor, type SequenceRow } from '../activation-sequence-cron'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString()
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString()

type Signals = NonNullable<SequenceRow['signals']>
type RowOverrides = Omit<Partial<SequenceRow>, 'signals'> & { signals?: Partial<Signals> }

function row(over: RowOverrides): SequenceRow {
  const { signals, ...rest } = over
  return {
    hotelId: 'h1', hotelName: 'Hotel Sol', email: 'dueno@hotel.com', stage: 'registered',
    subscriptionStatus: 'trialing', trialEndsAt: daysFromNow(10), daysLeft: 10,
    registeredAt: daysAgo(4), contactedAt: null, lostAt: null,
    signals: { rooms: 0, rates: 0, channels: 0, reservations: 0, lastActivityAt: null, ...(signals ?? {}) },
    ...rest,
  }
}

function harness(rows: SequenceRow[], prospects: any[] = []) {
  const calls: any[] = []
  const updates: Array<{ id: string; patch: any }> = []
  const creates: any[] = []
  const orm = {
    findMany: async (table: string, where: Record<string, unknown>) => {
      if (table === 'SalesProspects') return prospects.filter((p) => p.hotelId === where.hotelId)
      return []
    },
    update: async (_t: string, id: string, patch: any) => { updates.push({ id, patch }); return null },
    create: async (_t: string, data: any) => { creates.push(data); return { id: 'new', ...data } },
  }
  const resolve = (name: string) => {
    if (name === 'platform-emails') return { sendEvent: async (...a: any[]) => { calls.push(a); return { sent: true } } }
    if (name === 'sales-leads') return { getPipeline: async () => ({ data: rows, total: rows.length }) }
    return null
  }
  const cron = createActivationSequenceCron(orm, resolve, silentLogger())
  return { cron, calls, updates, creates }
}

describe('activation-sequence-cron — secuencia de activación (#149)', () => {
  it('día ≥1 sin habitaciones → activation_no_rooms, crea el prospecto con sequenceSent', async () => {
    const h = harness([row({ registeredAt: daysAgo(1) })])
    const r = await h.cron(NOW)
    expect(r.sent.activation_no_rooms).toBe(1)
    expect(h.calls[0][0]).toBe('activation_no_rooms')
    expect(h.calls[0][1]).toBe('dueno@hotel.com')
    expect(h.calls[0][2]).toBe('h1')
    expect(h.calls[0][3].hotel_name).toBe('Hotel Sol')
    expect(h.creates[0].sequenceSent.activation_no_rooms).toBe(NOW.toISOString())
  })

  it('habitaciones sin tarifas desde hace ≥2 días → activation_no_rates', async () => {
    const h = harness([row({ registeredAt: daysAgo(2), signals: { rooms: 5 } })])
    await h.cron(NOW)
    expect(h.calls.map((c) => c[0])).toEqual(['activation_no_rates'])
  })

  it('tarifas sin canal, día ≥3 → activation_no_channel', async () => {
    const h = harness([row({ registeredAt: daysAgo(3), stage: 'activated', signals: { rooms: 5, rates: 2 } })])
    await h.cron(NOW)
    expect(h.calls.map((c) => c[0])).toEqual(['activation_no_channel'])
  })

  it('activated con ≤3 días de trial → trial_offer con days_left', async () => {
    const h = harness([row({ stage: 'activated', daysLeft: 3, trialEndsAt: daysFromNow(3), signals: { rooms: 5, rates: 2, channels: 1 } })])
    await h.cron(NOW)
    expect(h.calls.map((c) => c[0])).toEqual(['trial_offer'])
    expect(h.calls[0][3].days_left).toBe('3')
  })

  it('cumple dos reglas → recibe solo la primera (un correo por corrida)', async () => {
    // rooms=0 (regla 1) y activated con daysLeft 2 (regla 4): sale solo la 1.
    const h = harness([row({ registeredAt: daysAgo(5), stage: 'activated', daysLeft: 2 })])
    await h.cron(NOW)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0][0]).toBe('activation_no_rooms')
  })

  it('activation_no_rooms enviado ayer → hoy 0 correos (dedup)', async () => {
    const h = harness([row({ registeredAt: daysAgo(5) })], [{ id: 'p1', hotelId: 'h1', sequenceSent: { activation_no_rooms: daysAgo(1) } }])
    const r = await h.cron(NOW)
    expect(h.calls).toHaveLength(0)
    expect(r.sent).toEqual({})
    expect(h.updates).toHaveLength(0)
  })

  it('sequenceSent guardado como string JSON también deduplica', async () => {
    const h = harness([row({ registeredAt: daysAgo(5) })], [{ id: 'p1', hotelId: 'h1', sequenceSent: JSON.stringify({ activation_no_rooms: daysAgo(1) }) }])
    await h.cron(NOW)
    expect(h.calls).toHaveLength(0)
  })

  it('contactedAt ayer → 0 correos (hay un humano encima)', async () => {
    const h = harness([row({ registeredAt: daysAgo(5), contactedAt: daysAgo(1) })])
    const r = await h.cron(NOW)
    expect(h.calls).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })

  it('no toca hoteles pagando, perdidos, sin email ni suscripciones no-trialing', async () => {
    const h = harness([
      row({ hotelId: 'a', stage: 'paying', subscriptionStatus: 'active', registeredAt: daysAgo(5) }),
      row({ hotelId: 'b', stage: 'lost', lostAt: daysAgo(1), registeredAt: daysAgo(5) }),
      row({ hotelId: 'c', email: null, registeredAt: daysAgo(5) }),
      row({ hotelId: 'd', subscriptionStatus: 'canceled', stage: 'expired', registeredAt: daysAgo(30), trialEndsAt: daysAgo(20) }),
    ])
    await h.cron(NOW)
    expect(h.calls).toHaveLength(0)
  })
})

describe('activation-sequence-cron — rescate y perdido automático (#150)', () => {
  const expired = (daysExpired: number, over: RowOverrides = {}) => row({
    stage: 'expired', trialEndsAt: daysAgo(daysExpired), daysLeft: -daysExpired, registeredAt: daysAgo(daysExpired + 14),
    signals: { rooms: 3, rates: 1 }, ...over,
  })

  it('+2 días vencido → trial_rescue_1', async () => {
    const h = harness([expired(2)])
    await h.cron(NOW)
    expect(h.calls.map((c) => c[0])).toEqual(['trial_rescue_1'])
  })

  it('+7 días con rescue_1 ya enviado → trial_rescue_2; sin rescue_1 → primero rescue_1', async () => {
    const withR1 = harness([expired(7)], [{ id: 'p1', hotelId: 'h1', sequenceSent: { trial_rescue_1: daysAgo(5) } }])
    await withR1.cron(NOW)
    expect(withR1.calls.map((c) => c[0])).toEqual(['trial_rescue_2'])

    const without = harness([expired(7)])
    await without.cron(NOW)
    expect(without.calls.map((c) => c[0])).toEqual(['trial_rescue_1'])
  })

  it('+14 días sin actividad ni contacto → lostAt + lostReason=no_response y 0 correos', async () => {
    const h = harness([expired(14)], [{ id: 'p1', hotelId: 'h1', sequenceSent: { trial_rescue_1: daysAgo(12), trial_rescue_2: daysAgo(7) } }])
    const r = await h.cron(NOW)
    expect(h.calls).toHaveLength(0)
    expect(r.lost).toBe(1)
    expect(h.updates[0]!.patch).toEqual({ lostAt: NOW.toISOString(), lostReason: 'no_response' })
  })

  it('+14 días CON contactedAt hace 3 días → NO se marca perdido', async () => {
    const h = harness([expired(14, { contactedAt: daysAgo(3) })])
    const r = await h.cron(NOW)
    expect(r.lost).toBe(0)
    expect(h.updates).toHaveLength(0)
  })

  it('+14 días con actividad en el producto después del vencimiento → NO se marca perdido', async () => {
    expect(shouldAutoLose(expired(14, { signals: { rooms: 3, rates: 1, lastActivityAt: daysAgo(2) } }), NOW)).toBe(false)
    expect(shouldAutoLose(expired(14, { signals: { rooms: 3, rates: 1, lastActivityAt: daysAgo(20) } }), NOW)).toBe(true)
  })

  it('reinicio tras extender: un rescue enviado antes del nuevo vencimiento no cuenta', () => {
    // Venció el día -20, rescue_1 salió el -18, lo extendieron y volvió a vencer hace 2 días.
    const r = expired(2)
    expect(rescueEventFor(r, { trial_rescue_1: daysAgo(18), trial_rescue_2: daysAgo(13) }, NOW)).toBe('trial_rescue_1')
    // Rescue enviado DESPUÉS del vencimiento vigente sí deduplica.
    expect(rescueEventFor(r, { trial_rescue_1: daysAgo(1) }, NOW)).toBe(null)
  })

  it('perdido ya marcado → no se vuelve a tocar', async () => {
    const h = harness([expired(30, { stage: 'lost', lostAt: daysAgo(10) })])
    const r = await h.cron(NOW)
    expect(r.lost).toBe(0)
    expect(h.calls).toHaveLength(0)
  })
})
