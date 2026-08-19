// reservas/tests/lock-code-email.test.ts — R-5 (auditoría 2026-08-19).
//
// El ownership de sendLockCodeEmail era fail-open: `if (currentUser.hotelId && ...)` dejaba
// pasar SIN NINGÚN check a cualquier token sin hotelId — un usuario autenticado con
// reservations:edit podía disparar el email del código de cerradura de reservas de OTRO
// hotel. Estos tests clavan el fail-closed (patrón crud.listReservations: token sin hotel →
// resolver vía userRepo → sin hotel resuelto, rechazar).
import { describe, it, expect, mock } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import type { EmailSender } from '../../../services/email-sender'
import { sendLockCodeEmail } from '../usecases/lock-code-email'

const log = silentLogger()

function makeRepo<T extends { id: string }>(store: T[] = []): RepositoryAdapter<T> {
  return {
    findMany: async () => store,
    findById: async (id: string) => store.find((x) => x.id === id) ?? null,
    findOne: async () => store[0] ?? null,
    create: async (data: Omit<T, 'id'>) => { const row = { id: `m-${store.length + 1}`, ...data } as T; store.push(row); return row },
    update: async () => ({} as T),
    delete: async () => true,
    count: async () => store.length,
    paginate: async () => ({ data: store, total: store.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<T>
}

/** ORM fake por nombre de modelo — para los OrmRepository(orm, 'LockCodes'/'MessageLogs') internos. */
function makeOrm(data: Record<string, any[]>) {
  const match = (rows: any[], f: Record<string, unknown>) =>
    rows.filter((r) => Object.entries(f).every(([k, v]) => (r as any)[k] === v))
  return {
    findMany: async (m: string, f: Record<string, unknown> = {}) => match(data[m] ?? [], f),
    findById: async (m: string, id: string) => (data[m] ?? []).find((r) => r.id === id) ?? null,
    findOne: async (m: string, f: Record<string, unknown> = {}) => match(data[m] ?? [], f)[0] ?? null,
    create: async (m: string, d: any) => { (data[m] ??= []).push(d); return d },
    update: async (m: string, id: string, p: any) => { const r = (data[m] ?? []).find((x) => x.id === id); if (r) Object.assign(r, p); return r ?? null },
  } as any
}

const enqueueNotifMock = mock(async () => 'q-1')
const emailSender = { enqueueNotification: enqueueNotifMock } as unknown as EmailSender

const reservation = { id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'room1', checkIn: '2026-01-01', checkOut: '2026-01-03' }

function makeDeps(over: Partial<Parameters<typeof sendLockCodeEmail>[0]> = {}) {
  return {
    orm: makeOrm({ LockCodes: [{ id: 'c1', reservationId: 'r1', hotelId: 'h1', code: '123456', status: 'active' }] }),
    reservationRepo: makeRepo([reservation as any]),
    guestRepo: makeRepo([{ id: 'g1', hotelId: 'h1', name: 'Ana', email: 'a@b.com' } as any]),
    userRepo: makeRepo([{ id: 'u1', hotelId: 'h1' } as any]),
    emailSender,
    roomRepo: makeRepo([{ id: 'room1', hotelId: 'h1', number: '101' } as any]),
    hotelRepo: makeRepo([{ id: 'h1', name: 'Palma' } as any]),
    messageLogRepo: makeRepo([] as any),
    logger: log,
    ...over,
  } as Parameters<typeof sendLockCodeEmail>[0]
}

describe('sendLockCodeEmail — ownership fail-closed (R-5)', () => {
  it('token SIN hotelId se resuelve vía userRepo y envía (hotel correcto)', async () => {
    enqueueNotifMock.mockClear()
    const deps = makeDeps()
    const r = await sendLockCodeEmail(deps, 'r1', { id: 'u1' }) // sin hotelId ni role
    expect(r.sentTo).toBe('a@b.com')
    expect(enqueueNotifMock).toHaveBeenCalledTimes(1)
  })

  it('token sin hotelId y userRepo tampoco lo resuelve → 404 (fail-closed)', async () => {
    enqueueNotifMock.mockClear()
    const deps = makeDeps({ userRepo: makeRepo([{ id: 'u2' } as any]) }) // sin hotelId en DB
    await expect(sendLockCodeEmail(deps, 'r1', { id: 'u2' })).rejects.toThrow('Reserva no encontrada')
    expect(enqueueNotifMock).not.toHaveBeenCalled()
  })

  it('reserva de OTRO hotel → 404 aunque el token no traiga hotelId (antes: pasaba)', async () => {
    enqueueNotifMock.mockClear()
    const ajena = { ...reservation, hotelId: 'h2' }
    const deps = makeDeps({ reservationRepo: makeRepo([ajena as any]) })
    await expect(sendLockCodeEmail(deps, 'r1', { id: 'u1' })).rejects.toThrow('Reserva no encontrada')
    expect(enqueueNotifMock).not.toHaveBeenCalled()
  })

  it('super_admin de plataforma pasa sin userRepo', async () => {
    enqueueNotifMock.mockClear()
    const deps = makeDeps({ userRepo: undefined as any })
    const r = await sendLockCodeEmail(deps, 'r1', { id: 'root', role: 'super_admin' })
    expect(r.sentTo).toBe('a@b.com')
  })
})
