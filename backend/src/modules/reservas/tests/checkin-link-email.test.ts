// reservas/tests/checkin-link-email.test.ts — Envío manual del enlace de check-in digital (#336).
//
// Clava: ownership fail-closed (mismo patrón R-5 que lock-code-email), validaciones tempranas
// (PUBLIC_URL, email del huésped) SIN encolar, y el camino feliz: evento `checkin_link`, el MISMO
// enlace que muestra el panel (`PUBLIC_URL/checkin/:hash`, sin doble barra) y traza en
// message_logs que el historial del modal proyecta como envío manual con su referencia.
import { describe, it, expect, mock } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import type { EmailSender } from '../../../services/email-sender'
import { checkinHashFromId } from '../../../shared/utils/checkin-hash'
import { sendCheckinLinkEmail } from '../usecases/checkin-link-email'
import { toMessageLogView } from '../usecases/message-log'

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

const reservation = { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', hotelId: 'h1', guestId: 'g1', roomId: 'room1', checkIn: '2026-01-01', checkOut: '2026-01-03', externalLocator: 'LOC-77' }

function makeDeps(over: Partial<Parameters<typeof sendCheckinLinkEmail>[0]> = {}) {
  const enqueueNotification = mock(async () => 'q-1')
  const logs: any[] = []
  const deps = {
    reservationRepo: makeRepo([reservation as any]),
    guestRepo: makeRepo([{ id: 'g1', hotelId: 'h1', name: 'Ana', email: 'a@b.com', language: 'en' } as any]),
    userRepo: makeRepo([{ id: 'u1', hotelId: 'h1' } as any]),
    hotelRepo: makeRepo([{ id: 'h1', name: 'Palma', phone: '+34 600' } as any]),
    emailSender: { enqueueNotification } as unknown as EmailSender,
    messageLogRepo: makeRepo(logs as any),
    publicUrl: 'https://panel.test/', // barra final a propósito: el enlace no puede quedar con `//checkin`
    logger: log,
    ...over,
  } as Parameters<typeof sendCheckinLinkEmail>[0]
  return { deps, enqueueNotification, logs }
}

describe('sendCheckinLinkEmail (#336)', () => {
  it('reserva de OTRO hotel → NotFoundError y NO encola', async () => {
    const { deps, enqueueNotification } = makeDeps({ reservationRepo: makeRepo([{ ...reservation, hotelId: 'h2' } as any]) })
    await expect(sendCheckinLinkEmail(deps, reservation.id, { id: 'u1', hotelId: 'h1' })).rejects.toMatchObject({ name: 'NotFoundError', message: 'Reserva no encontrada' })
    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('token sin hotelId y userRepo tampoco lo resuelve → NotFoundError (fail-closed)', async () => {
    const { deps, enqueueNotification } = makeDeps({ userRepo: makeRepo([{ id: 'u2' } as any]) })
    await expect(sendCheckinLinkEmail(deps, reservation.id, { id: 'u2' })).rejects.toMatchObject({ name: 'NotFoundError' })
    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('huésped sin email → ValidationError y NO encola', async () => {
    const { deps, enqueueNotification, logs } = makeDeps({ guestRepo: makeRepo([{ id: 'g1', hotelId: 'h1', name: 'Ana' } as any]) })
    await expect(sendCheckinLinkEmail(deps, reservation.id, { id: 'u1', hotelId: 'h1' })).rejects.toMatchObject({ name: 'ValidationError', message: 'El huésped no tiene email cargado' })
    expect(enqueueNotification).not.toHaveBeenCalled()
    expect(logs).toHaveLength(0)
  })

  it('huésped de OTRO hotel se trata como inexistente → ValidationError (tenacy)', async () => {
    const { deps, enqueueNotification } = makeDeps({ guestRepo: makeRepo([{ id: 'g1', hotelId: 'h2', name: 'Ana', email: 'a@b.com' } as any]) })
    await expect(sendCheckinLinkEmail(deps, reservation.id, { id: 'u1', hotelId: 'h1' })).rejects.toMatchObject({ name: 'ValidationError' })
    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('sin PUBLIC_URL → ValidationError y NO encola', async () => {
    const { deps, enqueueNotification } = makeDeps({ publicUrl: '' })
    await expect(sendCheckinLinkEmail(deps, reservation.id, { id: 'u1', hotelId: 'h1' })).rejects.toMatchObject({ name: 'ValidationError', message: 'Falta configurar PUBLIC_URL: no se puede armar el enlace de check-in' })
    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('feliz: encola checkin_link con el enlace del panel y deja traza manual "sent"', async () => {
    const { deps, enqueueNotification, logs } = makeDeps()
    const out = await sendCheckinLinkEmail(deps, reservation.id, { id: 'u1' }) // sin hotelId: se resuelve vía userRepo

    const expectedUrl = `https://panel.test/checkin/${checkinHashFromId(reservation.id)}`
    expect(out).toEqual({ sentTo: 'a@b.com', checkinUrl: expectedUrl })

    expect(enqueueNotification).toHaveBeenCalledTimes(1)
    const input = (enqueueNotification.mock.calls[0] as any[])[0]
    expect(input.event).toBe('checkin_link')
    expect(input.to).toBe('a@b.com')
    expect(input.hotelId).toBe('h1')
    expect(input.language).toBe('en')
    expect(input.relatedType).toBe('checkin_link')
    expect(input.relatedId).toBe(reservation.id)
    expect(input.variables.checkin_url).toBe(expectedUrl)
    expect(input.variables.checkin_url).not.toContain('//checkin')
    expect(input.variables.hotel_name).toBe('Palma')
    expect(input.variables.hotel_phone).toBe('+34 600')
    expect(input.variables.locator).toBe('LOC-77')
    expect(input.variables.guest_name).toBe('Ana')
    expect(input.variables.checkin_date).toBe('2026-01-01')
    expect(input.variables.checkout_date).toBe('2026-01-03')

    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ hotelId: 'h1', reservationId: reservation.id, guestId: 'g1', messageType: 'email', status: 'sent', recipient: 'a@b.com', messageId: 'q-1' })
    expect(logs[0].sentAt).toBeTruthy()
    // El historial del modal lo ve como envío manual con su referencia y quién lo mandó.
    const view = toMessageLogView(logs[0])
    expect(view.manual).toBe(true)
    expect(view.reference).toBe('Enlace de check-in digital')
    expect(view.sentByUserId).toBe('u1')
  })

  it('sin externalLocator → locator = últimos 8 del id', async () => {
    const { deps, enqueueNotification } = makeDeps({ reservationRepo: makeRepo([{ ...reservation, externalLocator: undefined } as any]) })
    await sendCheckinLinkEmail(deps, reservation.id, { id: 'u1', hotelId: 'h1' })
    expect(((enqueueNotification.mock.calls[0] as any[])[0]).variables.locator).toBe('34567890')
  })

  it('super_admin pasa sin userRepo', async () => {
    const { deps } = makeDeps({ userRepo: undefined })
    const out = await sendCheckinLinkEmail(deps, reservation.id, { id: 'root', role: 'super_admin' })
    expect(out.sentTo).toBe('a@b.com')
  })

  it('enqueue rechaza → traza "failed" con el error y la función lanza', async () => {
    const enqueueNotification = mock(async () => { throw new Error('smtp caído') })
    const { deps, logs } = makeDeps({ emailSender: { enqueueNotification } as unknown as EmailSender })
    await expect(sendCheckinLinkEmail(deps, reservation.id, { id: 'u1', hotelId: 'h1' })).rejects.toThrow('No se pudo encolar el email')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ status: 'failed', messageType: 'email', recipient: 'a@b.com', messageId: null, sentAt: null })
    expect(JSON.parse(logs[0].response)).toMatchObject({ kind: 'manual', reference: 'Enlace de check-in digital', byUserId: 'u1', error: 'smtp caído' })
    expect(toMessageLogView(logs[0]).reference).toBe('Enlace de check-in digital') // parseTrace tolera la clave extra `error`
  })
})
