// shared/usecases/tests/approval-reminder.test.ts — Recordatorio de aprobación pendiente (#271 MR-06).
//
// World en memoria: arrays por tabla + `notify` fake que registra llamadas. `update` escribe en el
// array para que una segunda corrida vea el `approvalReminderAt` que dejó la primera (dedup).
// Cubre el barrido (`runApprovalReminder`), el aviso (`notifyApprovalOverdue`) y el factory del
// cron (kill-switch por env, try/catch cron-level, constantes).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { Logger } from 'arckode-framework'
import {
  runApprovalReminder,
  DEFAULT_APPROVAL_DEADLINE_HOURS,
  type ApprovalReminderDeps,
  type ApprovalReminderNotifyInput,
  type ApprovalReminderResult,
} from '../approval-reminder'
import {
  createApprovalReminderCron,
  isApprovalReminderDisabled,
  APPROVAL_REMINDER_TICK_MS,
  APPROVAL_REMINDER_FIRST_TICK_MS,
} from '../approval-reminder-cron'
import { notifyApprovalOverdue, RESERVATION_NOTIFICATION_TYPE } from '../notify-reservation-received'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const HOTEL = 'hotel-a'
const NOW = new Date('2026-09-12T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const matches = (f: Record<string, unknown>) => (row: any) => Object.entries(f).every(([k, v]) => row[k] === v)

interface NotifyCall { ref: { id: string; hotelId: string }; input: ApprovalReminderNotifyInput }

interface World {
  reservations: any[]
  bookingConfig: any[]
  notifyCalls: NotifyCall[]
  configReads: number
  deps: ApprovalReminderDeps
}

function world(over: Partial<Pick<World, 'reservations' | 'bookingConfig'>> & { notifyThrows?: boolean } = {}): World {
  const w: World = {
    reservations: over.reservations ?? [],
    bookingConfig: over.bookingConfig ?? [{ hotelId: HOTEL, approvalDeadlineHours: 24 }],
    notifyCalls: [],
    configReads: 0,
    deps: null as any,
  }
  w.deps = {
    reservations: {
      findMany: async (q) => w.reservations.filter(matches(q)),
      update: async (id, data) => {
        const r = w.reservations.find((x) => x.id === id)
        if (!r) throw new Error('not_found')
        Object.assign(r, data)
        return r
      },
    },
    bookingConfig: { findMany: async (q) => { w.configReads++; return w.bookingConfig.filter(matches(q)) } },
    notify: async (ref, input) => {
      if (over.notifyThrows) throw new Error('notificaciones caído')
      w.notifyCalls.push({ ref, input })
      return { notified: 1, emailed: true }
    },
    logger: noopLogger,
  }
  return w
}

/** Reserva pagada, pendiente de aprobación hace 25 h (vencida con plazo 24). */
const pendingApproval = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', guestId: 'g1', status: 'confirmed', approvalStatus: 'pending',
  approvalReminderAt: null, createdAt: hoursAgo(25), ...over,
})

describe('runApprovalReminder', () => {
  it('pendiente hace 25 h con plazo 24 → notify una vez con {deadlineHours, pendingSince} y approvalReminderAt seteado; segunda corrida no repite', async () => {
    const w = world({ reservations: [pendingApproval()] })
    const out = await runApprovalReminder(w.deps, NOW)

    expect(out).toEqual({ scanned: 1, reminded: 1, skipped: 0, errors: [] })
    expect(w.notifyCalls).toHaveLength(1)
    expect(w.notifyCalls[0].ref).toEqual({ id: 'r1', hotelId: HOTEL })
    expect(w.notifyCalls[0].input).toEqual({ deadlineHours: 24, pendingSince: hoursAgo(25) })
    expect(w.reservations[0].approvalReminderAt).toBe(NOW.toISOString())

    // Dedup: la marca frena la próxima corrida.
    const again = await runApprovalReminder(w.deps, new Date(NOW.getTime() + 3_600_000))
    expect(again).toEqual({ scanned: 0, reminded: 0, skipped: 0, errors: [] })
    expect(w.notifyCalls).toHaveLength(1)
  })

  it('pendiente hace 10 h → no avisa ni marca', async () => {
    const w = world({ reservations: [pendingApproval({ createdAt: hoursAgo(10) })] })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out).toEqual({ scanned: 1, reminded: 0, skipped: 1, errors: [] })
    expect(w.notifyCalls).toHaveLength(0)
    expect(w.reservations[0].approvalReminderAt).toBeNull()
  })

  it('plazo exacto (24 h justas) ya cuenta como vencido', async () => {
    const w = world({ reservations: [pendingApproval({ createdAt: hoursAgo(24) })] })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out.reminded).toBe(1)
  })

  it('hotel sin fila booking_config → usa el default de 24 h', async () => {
    expect(DEFAULT_APPROVAL_DEADLINE_HOURS).toBe(24)
    const w = world({
      bookingConfig: [],
      reservations: [pendingApproval({ id: 'r-old', createdAt: hoursAgo(25) }), pendingApproval({ id: 'r-new', createdAt: hoursAgo(23) })],
    })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 2, reminded: 1, skipped: 1 })
    expect(w.notifyCalls.map((c) => c.ref.id)).toEqual(['r-old'])
    expect(w.notifyCalls[0].input.deadlineHours).toBe(24)
  })

  it('respeta el plazo configurado del hotel (48 h) y lo lee UNA vez por hotel por corrida', async () => {
    const w = world({
      bookingConfig: [{ hotelId: HOTEL, approvalDeadlineHours: 48 }],
      reservations: [pendingApproval({ id: 'a', createdAt: hoursAgo(30) }), pendingApproval({ id: 'b', createdAt: hoursAgo(50) })],
    })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out).toMatchObject({ reminded: 1, skipped: 1 })
    expect(w.notifyCalls.map((c) => c.ref.id)).toEqual(['b'])
    expect(w.notifyCalls[0].input.deadlineHours).toBe(48)
    expect(w.configReads).toBe(1)
  })

  it('status cancelled o approvalStatus approved/rejected → no avisa', async () => {
    const w = world({
      reservations: [
        pendingApproval({ id: 'c', status: 'cancelled' }),
        pendingApproval({ id: 'ok', approvalStatus: 'approved' }),
        pendingApproval({ id: 'no', approvalStatus: 'rejected' }),
      ],
    })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out).toEqual({ scanned: 0, reminded: 0, skipped: 0, errors: [] })
    expect(w.notifyCalls).toHaveLength(0)
    for (const r of w.reservations) expect(r.approvalReminderAt).toBeNull()
  })

  it('grupo de 2 pendientes vencidas → un solo notify (la más antigua) y ambas marcadas', async () => {
    const w = world({
      reservations: [
        pendingApproval({ id: 'g-2', groupId: 'grp', createdAt: hoursAgo(25) }),
        pendingApproval({ id: 'g-1', groupId: 'grp', createdAt: hoursAgo(26) }),
      ],
    })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out).toEqual({ scanned: 2, reminded: 1, skipped: 0, errors: [] })
    expect(w.notifyCalls).toHaveLength(1)
    expect(w.notifyCalls[0].ref.id).toBe('g-1')
    expect(w.notifyCalls[0].input.pendingSince).toBe(hoursAgo(26))
    expect(w.reservations.every((r) => r.approvalReminderAt === NOW.toISOString())).toBe(true)

    const again = await runApprovalReminder(w.deps, NOW)
    expect(again.reminded).toBe(0)
    expect(w.notifyCalls).toHaveLength(1)
  })

  it('grupo con la más antigua sin vencer → nada (se evalúa por la más antigua)', async () => {
    const w = world({
      reservations: [
        pendingApproval({ id: 'g-1', groupId: 'grp', createdAt: hoursAgo(20) }),
        pendingApproval({ id: 'g-2', groupId: 'grp', createdAt: hoursAgo(19) }),
      ],
    })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out).toEqual({ scanned: 2, reminded: 0, skipped: 2, errors: [] })
  })

  it('notify que tira → error en errors, approvalReminderAt NO seteado (se reintenta en la próxima), y sigue con la siguiente', async () => {
    const w = world({ reservations: [pendingApproval({ id: 'x' }), pendingApproval({ id: 'y', hotelId: 'hotel-b' })], notifyThrows: true })
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out.reminded).toBe(0)
    expect(out.errors).toEqual([
      { reservationId: 'x', reason: 'notificaciones caído' },
      { reservationId: 'y', reason: 'notificaciones caído' },
    ])
    for (const r of w.reservations) expect(r.approvalReminderAt).toBeNull()
  })

  it('update que tira → error registrado, el aviso ya salió y no se propaga', async () => {
    const w = world({ reservations: [pendingApproval()] })
    w.deps.reservations.update = async () => { throw new Error('db ro') }
    const out = await runApprovalReminder(w.deps, NOW)
    expect(out.reminded).toBe(1)
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].reason).toContain('approvalReminderAt')
  })

  it('findMany que tira → propaga (lo absorbe el cron)', async () => {
    const w = world()
    w.deps.reservations.findMany = async () => { throw new Error('orm caído') }
    await expect(runApprovalReminder(w.deps, NOW)).rejects.toThrow('orm caído')
  })
})

// ─── notifyApprovalOverdue ──────────────────────────────────────────────────

const USERS = [
  { id: 'u-admin', hotelId: 'h1', name: 'Admin', email: 'admin@palma.com', role: 'hotel_admin', active: 1 },
  { id: 'u-cama', hotelId: 'h1', name: 'Camarera', email: 'cama@palma.com', role: 'housekeeper', active: 1 },
]
const ROLES = [
  { id: 'ro1', hotelId: 'h1', name: 'hotel_admin', permissions: ['reservations:view'] },
  { id: 'ro3', hotelId: 'h1', name: 'housekeeper', permissions: ['housekeeping:view'] },
]
const RESERVA = {
  id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'room1',
  checkIn: '2026-09-12T00:00:00.000Z', checkOut: '2026-09-14T00:00:00.000Z',
  totalAmount: 150, currency: 'USD', channel: 'direct', approvalStatus: 'pending',
}

function notifyHarness(over: { reservas?: any[]; hotelEmail?: string } = {}) {
  const created: any[] = []
  const sent: any[] = []
  const pushed: any[] = []
  const reservas = over.reservas ?? [RESERVA]
  const deps: any = {
    notificaciones: { create: async (dto: any) => { created.push(dto); return dto } },
    users: { list: async (hotelId?: string) => USERS.filter((u) => u.hotelId === hotelId) },
    roles: { list: async () => ({ data: ROLES }) },
    reservations: {
      findById: async (id: string) => reservas.find((r) => r.id === id) ?? null,
      findMany: async (where: Record<string, unknown>) => reservas.filter(matches(where)),
    },
    hotels: { findById: async () => ({ id: 'h1', name: 'Hotel Palma', email: over.hotelEmail ?? 'info@palma.com' }) },
    guests: { findById: async () => ({ id: 'g1', name: 'Ana Pérez' }) },
    rooms: { getById: async () => ({ id: 'room1', number: '101' }) },
    emailSender: { enqueue: async (i: any) => { sent.push(i); return 'q1' } },
    push: { notifyUser: async (userId: string, hotelId: string, n: any) => { pushed.push({ userId, hotelId, ...n }); return 1 } },
    platformIdentity: async () => ({ platformName: 'Plataforma', supportEmail: '', supportPhone: '' }),
    logger: silentLogger(),
  }
  return { deps, created, sent, pushed }
}

describe('notifyApprovalOverdue', () => {
  it('título con horas enteras y huésped; campanita sólo a quien ve reservas; correo y push con kind approval_overdue', async () => {
    const h = notifyHarness()
    const out = await notifyApprovalOverdue(h.deps, { id: 'r1', hotelId: 'h1' }, { deadlineHours: 24, pendingSince: hoursAgo(25.7) }, NOW)

    expect(out).toEqual({ notified: 1, emailed: true })
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({
      hotelId: 'h1', userId: 'u-admin', type: RESERVATION_NOTIFICATION_TYPE, read: 0,
      title: 'Reserva por aprobar hace 25 h — Ana Pérez',
      metadata: { link: '/panel/reservations?open=r1', reservationId: 'r1', kind: 'approval_overdue' },
    })
    expect(h.created[0].message).toContain('Ana Pérez')
    expect(h.created[0].message).toContain('2026-09-12 → 2026-09-14')
    expect(h.created[0].message).toContain('150.00 USD')
    expect(h.created[0].message).toContain('El huésped ya pagó y espera respuesta. Plazo del hotel: 24 h. Aprobá o rechazá desde el panel.')

    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toMatchObject({ to: 'info@palma.com', hotelId: 'h1', relatedType: 'reservation:approval_overdue', relatedId: 'r1' })
    expect(h.sent[0].subject).toContain('Reserva por aprobar hace 25 h')
    expect(h.sent[0].html).toContain('Plazo del hotel: 24 h')
    expect(h.sent[0].html).toContain('Huésped: Ana Pérez')

    expect(h.pushed).toHaveLength(1)
    expect(h.pushed[0]).toMatchObject({ userId: 'u-admin', data: { reservationId: 'r1' } })
  })

  it('reserva inexistente → nada, sin lanzar', async () => {
    const h = notifyHarness({ reservas: [] })
    const out = await notifyApprovalOverdue(h.deps, { id: 'nope', hotelId: 'h1' }, { deadlineHours: 24, pendingSince: hoursAgo(30) }, NOW)
    expect(out).toEqual({ notified: 0, emailed: false })
    expect(h.created).toHaveLength(0)
  })

  it('nunca tira: si cargar la reserva revienta, devuelve ceros', async () => {
    const h = notifyHarness()
    h.deps.reservations.findById = async () => { throw new Error('boom') }
    const out = await notifyApprovalOverdue(h.deps, { id: 'r1', hotelId: 'h1' }, { deadlineHours: 24, pendingSince: hoursAgo(30) }, NOW)
    expect(out).toEqual({ notified: 0, emailed: false })
  })
})

// ─── createApprovalReminderCron ─────────────────────────────────────────────

const log = silentLogger()

function makeRun(impl: () => Promise<ApprovalReminderResult>): { run: () => Promise<ApprovalReminderResult>; calls: () => number } {
  let n = 0
  return { run: async () => { n++; return impl() }, calls: () => n }
}

function capturingLogger(): { logger: Logger; infos: string[] } {
  const infos: string[] = []
  const logger = { ...log, info: (msg: string, ..._rest: unknown[]) => { infos.push(msg) } } as unknown as Logger
  return { logger, infos }
}

describe('createApprovalReminderCron', () => {
  it('BOOKING_APPROVAL_REMINDER_DISABLED=1 → no corre y devuelve ceros', async () => {
    const { run, calls } = makeRun(async () => ({ scanned: 5, reminded: 2, skipped: 3, errors: [] }))
    const cron = createApprovalReminderCron(run, log, { BOOKING_APPROVAL_REMINDER_DISABLED: '1' })
    const result = await cron()
    expect(calls()).toBe(0)
    expect(result).toEqual({ scanned: 0, reminded: 0, skipped: 0, errors: [] })
  })

  it('sin flag → corre una vez y loguea "recordadas: N"', async () => {
    const expected: ApprovalReminderResult = { scanned: 5, reminded: 2, skipped: 3, errors: [] }
    const { run, calls } = makeRun(async () => expected)
    const { logger, infos } = capturingLogger()
    const cron = createApprovalReminderCron(run, logger, {})
    const result = await cron()
    expect(calls()).toBe(1)
    expect(result).toEqual(expected)
    expect(infos.some((m) => m.includes('recordadas: 2'))).toBe(true)
  })

  it('evalúa el flag en cada tick (no al construir)', async () => {
    const env: NodeJS.ProcessEnv = {}
    const { run, calls } = makeRun(async () => ({ scanned: 0, reminded: 0, skipped: 0, errors: [] }))
    const cron = createApprovalReminderCron(run, log, env)
    await cron()
    env.BOOKING_APPROVAL_REMINDER_DISABLED = '1'
    await cron()
    expect(calls()).toBe(1)
  })

  it('run que tira no propaga (cron-level try/catch)', async () => {
    const { run } = makeRun(async () => { throw new Error('boom') })
    const cron = createApprovalReminderCron(run, log, {})
    const result = await cron()
    expect(result.reminded).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toContain('cron-level')
    expect(result.errors[0].reason).toContain('boom')
  })

  it('isApprovalReminderDisabled solo con "1" exacto', () => {
    expect(isApprovalReminderDisabled({ BOOKING_APPROVAL_REMINDER_DISABLED: '1' })).toBe(true)
    expect(isApprovalReminderDisabled({ BOOKING_APPROVAL_REMINDER_DISABLED: 'true' })).toBe(false)
    expect(isApprovalReminderDisabled({})).toBe(false)
  })

  it('constantes: tick 15 min y primer tick 30 s', () => {
    expect(APPROVAL_REMINDER_TICK_MS).toBe(15 * 60 * 1000)
    expect(APPROVAL_REMINDER_FIRST_TICK_MS).toBe(30_000)
  })
})
