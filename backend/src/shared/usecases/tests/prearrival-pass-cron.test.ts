import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createPrearrivalPassCron } from '../prearrival-pass-cron'

const HOTEL = { id: 'h1', checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo' }
// Llegada real: 2026-09-12 15:00 RD = 19:00 UTC.
const ARRIVAL = Date.parse('2026-09-12T19:00:00.000Z')
const RESERVA = { id: 'res1', hotelId: 'h1', checkIn: '2026-09-12', checkOut: '2026-09-13', status: 'confirmed' }

interface HarnessOptions {
  pass?: any
  reserva?: any
  sendOk?: boolean
  /** Reservas visibles para `findMany('Reservations', { status, checkIn })` (pasada B). */
  reservas?: any[]
  /** Fila booking_config del hotel (sin fila = default 0). */
  bookingConfig?: any
  /** Respuesta del fake `reservas.autoAssignRoom` (undefined = módulo sin la función). */
  autoAssign?: (id: string, hotelId: string) => Promise<any>
  partialOk?: boolean
}

function harness(over: HarnessOptions = {}) {
  const pass = over.pass === undefined ? { id: 'p1', reservationId: 'res1', lockCode: '401697' } : over.pass
  const passes: any[] = pass ? [pass] : []
  const reservas: any[] = over.reservas ?? []
  const updates: any[] = []
  const sends: string[] = []
  const partialSends: string[] = []
  const autoAssignCalls: Array<{ id: string; hotelId: string }> = []
  const warns: any[] = []
  const eq = (row: any, where: any) => Object.keys(where ?? {}).every((k) => row[k] === where[k])
  const orm = {
    findMany: async (t: string, where: any) => {
      if (t === 'WalletPasses') return passes.filter((p) => eq(p, where))
      if (t === 'Reservations') return reservas.filter((r) => eq(r, where))
      if (t === 'BookingConfig') return over.bookingConfig && over.bookingConfig.hotelId === where?.hotelId ? [over.bookingConfig] : []
      return []
    },
    findById: async (t: string, id: string) => {
      if (t === 'Reservations') return over.reserva === undefined ? RESERVA : over.reserva
      if (t === 'Hotels') return HOTEL
      return null
    },
    update: async (t: string, id: string, data: any) => {
      updates.push({ t, id, data })
      if (t === 'WalletPasses') { const row = passes.find((p) => p.id === id); if (row) Object.assign(row, data) }
    },
  }
  const wallet = {
    sendPassEmailNow: async (rid: string) => { sends.push(rid); return over.sendOk !== false },
    sendPartialPassEmailNow: async (rid: string) => { partialSends.push(rid); return over.partialOk !== false },
  }
  const reservasModule = over.autoAssign
    ? { autoAssignRoom: async (id: string, hotelId: string) => { autoAssignCalls.push({ id, hotelId }); return over.autoAssign!(id, hotelId) } }
    : {}
  const logger = Object.assign(silentLogger(), { warn: (...args: any[]) => { warns.push(args) } })
  const resolve = (n: string) => (n === 'wallet-pass' ? wallet : n === 'reservas' ? reservasModule : null)
  const cron = createPrearrivalPassCron(orm, resolve, logger)
  return { cron, updates, sends, partialSends, autoAssignCalls, warns, passes }
}

const hoursBefore = (h: number) => new Date(ARRIVAL - h * 3_600_000)

describe('cron de pase 24 h antes', () => {
  it('NO manda nada cuando faltan más de 24 h', async () => {
    const h = harness()
    const r = await h.cron(hoursBefore(30))
    expect(r.sent).toBe(0)
    expect(h.sends).toHaveLength(0)
  })

  it('manda cuando entra en la ventana de 24 h', async () => {
    const h = harness()
    const r = await h.cron(hoursBefore(23))
    expect(r.sent).toBe(1)
    expect(h.sends).toEqual(['res1'])
  })

  it('justo en el borde de las 24 h ya manda', async () => {
    const h = harness()
    expect((await h.cron(hoursBefore(24))).sent).toBe(1)
  })

  it('marca emailSentAt para no reenviar en el próximo tick', async () => {
    const h = harness()
    await h.cron(hoursBefore(10))
    expect(h.updates[0].t).toBe('WalletPasses')
    expect(h.updates[0].data.emailSentAt).toBeTruthy()
  })

  it('un pase ya avisado se saltea', async () => {
    const h = harness({ pass: { id: 'p1', reservationId: 'res1', emailSentAt: '2026-09-11T00:00:00Z' } })
    const r = await h.cron(hoursBefore(10))
    expect(r.sent).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('un pase obsoleto (habitación reasignada) NO se manda: su código ya no abre', async () => {
    const h = harness({ pass: { id: 'p1', reservationId: 'res1', obsoleteAt: '2026-09-11T00:00:00Z' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
  })

  it('una reserva cancelada no recibe el código', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'cancelled' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
  })

  it('una reserva SIN PAGAR (pending) no recibe el código de la puerta', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'pending' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
    expect(h.sends).toHaveLength(0)
  })

  it('el huésped que ya hizo check-in sí puede recibirlo (reenvío)', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'checked_in' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(1)
  })

  it('un estado desconocido queda FUERA por default (lista blanca)', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'estado_nuevo_del_futuro' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
  })

  it('si el envío falla NO marca emailSentAt: se reintenta al tick siguiente', async () => {
    const h = harness({ sendOk: false })
    const r = await h.cron(hoursBefore(10))
    expect(r.sent).toBe(0)
    expect(h.updates).toHaveLength(0)
  })

  it('el huésped que ya llegó igual recibe su código (el corte es solo por arriba)', async () => {
    const h = harness()
    expect((await h.cron(new Date(ARRIVAL + 3_600_000))).sent).toBe(1)
  })

  it('sin módulo wallet-pass no revienta', async () => {
    const cron = createPrearrivalPassCron(
      { findMany: async () => [], findById: async () => null, update: async () => {} },
      () => null, silentLogger(),
    )
    expect((await cron(new Date())).sent).toBe(0)
  })
})

// ── #262 (REQ-HAC-07): reservas confirmadas SIN habitación ─────────────────────────────────
// Reserva sin roomId con checkIn mañana; `now` fijo a 20 h de la llegada (dentro de las 24 h).
const SIN_HAB = { ...RESERVA, roomId: null }
const NOW_20H = hoursBefore(20)

describe('cron de pase — reservas sin habitación (#262)', () => {
  it('config 0 (sin fila booking_config): no auto-asigna y manda el pase parcial', async () => {
    const h = harness({ pass: null, reserva: SIN_HAB, reservas: [SIN_HAB], autoAssign: async () => ({ assigned: true, roomId: 'r1', roomNumber: '101' }) })
    const r = await h.cron(NOW_20H)
    expect(h.autoAssignCalls).toHaveLength(0)
    expect(h.partialSends).toEqual(['res1'])
    expect(h.sends).toHaveLength(0)
    expect(r.sent).toBe(1)
    expect(r.assigned).toBe(0)
  })

  it('config 0 explícito en la fila: tampoco auto-asigna', async () => {
    const h = harness({
      pass: null, reserva: SIN_HAB, reservas: [SIN_HAB],
      bookingConfig: { hotelId: 'h1', autoAssignBeforeArrivalHours: 0 },
      autoAssign: async () => ({ assigned: true, roomId: 'r1', roomNumber: '101' }),
    })
    const r = await h.cron(NOW_20H)
    expect(h.autoAssignCalls).toHaveLength(0)
    expect(r.sent).toBe(1)
    expect(r.assigned).toBe(0)
  })

  it('config 24 con habitación libre: auto-asigna, manda el pase COMPLETO y marca emailSentAt', async () => {
    let h: ReturnType<typeof harness>
    h = harness({
      pass: null, reserva: SIN_HAB, reservas: [SIN_HAB],
      bookingConfig: { hotelId: 'h1', autoAssignBeforeArrivalHours: 24 },
      // Simula al connector reservas-ttlock/reservas-wallet: al asignar aparece la fila con código.
      autoAssign: async () => { h.passes.push({ id: 'wp1', reservationId: 'res1', lockCode: '1234' }); return { assigned: true, roomId: 'r1', roomNumber: '101' } },
    })
    const r = await h.cron(NOW_20H)
    expect(h.autoAssignCalls).toEqual([{ id: 'res1', hotelId: 'h1' }])
    expect(h.sends).toEqual(['res1'])
    expect(h.partialSends).toHaveLength(0)
    const wp1 = h.passes.find((p) => p.id === 'wp1')
    expect(wp1.emailSentAt).toBeTruthy()
    expect(r.assigned).toBe(1)
    expect(r.sent).toBe(1)
  })

  it('config 24 asignada pero sin código (ttlock apagado): no marca y cae al parcial', async () => {
    let h: ReturnType<typeof harness>
    h = harness({
      pass: null, reserva: SIN_HAB, reservas: [SIN_HAB],
      bookingConfig: { hotelId: 'h1', autoAssignBeforeArrivalHours: 24 },
      autoAssign: async () => { h.passes.push({ id: 'wp1', reservationId: 'res1', lockCode: '' }); return { assigned: true, roomId: 'r1', roomNumber: '101' } },
    })
    const r = await h.cron(NOW_20H)
    expect(h.sends).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(h.partialSends).toEqual(['res1'])
    expect(r.assigned).toBe(1)
    expect(r.sent).toBe(1)
  })

  it('config 24 sin habitaciones libres: warn + pase parcial', async () => {
    const h = harness({
      pass: null, reserva: SIN_HAB, reservas: [SIN_HAB],
      bookingConfig: { hotelId: 'h1', autoAssignBeforeArrivalHours: 24 },
      autoAssign: async () => ({ assigned: false, reason: 'no_rooms' }),
    })
    const r = await h.cron(NOW_20H)
    expect(h.autoAssignCalls).toHaveLength(1)
    expect(h.warns.length).toBeGreaterThan(0)
    expect(h.warns[0][0]).toContain('sin habitaciones libres')
    expect(h.warns[0][1]).toMatchObject({ reservationId: 'res1', hotelId: 'h1', reason: 'no_rooms' })
    expect(h.partialSends).toEqual(['res1'])
    expect(h.sends).toHaveLength(0)
    expect(r.sent).toBe(1)
    expect(r.assigned).toBe(0)
  })

  it('si autoAssignRoom revienta: warn, parcial y la corrida sigue', async () => {
    const h = harness({
      pass: null, reserva: SIN_HAB, reservas: [SIN_HAB],
      bookingConfig: { hotelId: 'h1', autoAssignBeforeArrivalHours: 24 },
      autoAssign: async () => { throw new Error('boom') },
    })
    const r = await h.cron(NOW_20H)
    expect(h.warns[0][0]).toContain('autoAssignRoom falló')
    expect(h.partialSends).toEqual(['res1'])
    expect(r.sent).toBe(1)
    expect(r.assigned).toBe(0)
  })

  it('config 6 con 20 h por delante: todavía no toca auto-asignar, pero SÍ va el parcial', async () => {
    const h = harness({
      pass: null, reserva: SIN_HAB, reservas: [SIN_HAB],
      bookingConfig: { hotelId: 'h1', autoAssignBeforeArrivalHours: 6 },
      autoAssign: async () => ({ assigned: true, roomId: 'r1', roomNumber: '101' }),
    })
    const r = await h.cron(NOW_20H)
    expect(h.autoAssignCalls).toHaveLength(0)
    expect(h.partialSends).toEqual(['res1'])
    expect(r.sent).toBe(1)
    expect(r.assigned).toBe(0)
  })

  it('con más de 24 h por delante no manda ni el parcial', async () => {
    const h = harness({ pass: null, reserva: SIN_HAB, reservas: [SIN_HAB] })
    const r = await h.cron(hoursBefore(30))
    expect(h.partialSends).toHaveLength(0)
    expect(r.sent).toBe(0)
  })

  it('fila parcial ya mandada (lockCode \'\'): la pasada A la saltea y el parcial no se duplica', async () => {
    const h = harness({
      pass: { id: 'p1', reservationId: 'res1', lockCode: '', emailSentAt: '2026-09-11T00:00:00Z' },
      reserva: SIN_HAB, reservas: [SIN_HAB], partialOk: false,
    })
    const r = await h.cron(NOW_20H)
    expect(h.sends).toHaveLength(0)
    expect(h.partialSends).toEqual(['res1'])
    expect(r.sent).toBe(0)
    expect(r.skipped).toBe(2)
  })

  it('una fila parcial sin emailSentAt tampoco entra en la pasada A (no hay código que mandar)', async () => {
    const h = harness({ pass: { id: 'p1', reservationId: 'res1', lockCode: '' }, reserva: SIN_HAB, reservas: [SIN_HAB], partialOk: false })
    const r = await h.cron(NOW_20H)
    expect(h.sends).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(r.sent).toBe(0)
  })

  it('una reserva sin habitación pero pending no se toca', async () => {
    const pending = { ...SIN_HAB, status: 'pending' }
    const h = harness({
      pass: null, reserva: pending, reservas: [pending],
      bookingConfig: { hotelId: 'h1', autoAssignBeforeArrivalHours: 24 },
      autoAssign: async () => ({ assigned: true, roomId: 'r1', roomNumber: '101' }),
    })
    const r = await h.cron(NOW_20H)
    expect(h.autoAssignCalls).toHaveLength(0)
    expect(h.partialSends).toHaveLength(0)
    expect(r.sent).toBe(0)
  })

  it('una reserva confirmada CON habitación no entra en la pasada B', async () => {
    const conHab = { ...RESERVA, roomId: 'r9' }
    const h = harness({ pass: null, reserva: conHab, reservas: [conHab] })
    const r = await h.cron(NOW_20H)
    expect(h.partialSends).toHaveLength(0)
    expect(r.sent).toBe(0)
  })
})
