// canales/tests/booking-cancellation.test.ts — Cancelación OTA aplicada al PMS (CH-04, AC "cancelación end-to-end")
//
// Cubre el camino de `applyBookingRevision` que `booking-sync.test.ts` no toca: qué pasa cuando el
// feed trae una revisión `cancelled` de una reserva que YA existe en el PMS. Es el escenario que
// Channex dispara en la certificación, y el que decide si el depósito retenido se libera o queda
// trabado.
//
// La regla que se prueba: un fallo del puerto de cancelación se reintenta SALVO que sea definitivo
// (`invalid_state` / `not_found`), porque reintentar para siempre quema el feed y entierra las
// revisiones sanas detrás.
import { describe, it, expect } from 'bun:test'
import { applyBookingRevision } from '../usecases/booking-ingestion'
import type { ReservationCancelPort } from '../usecases/booking-ingestion'

const EXISTING = { id: 'res-9', hotelId: 'h1', externalLocator: 'OTA-1', status: 'confirmed' }

function makeDeps(over: {
  existingRes?: any[]
  cancel?: ReservationCancelPort
} = {}) {
  const created: any[] = []
  const cancelCalls: Array<{ id: string; hotelId: string; reason: string }> = []
  const logged: Array<{ msg: string; meta?: Record<string, unknown> }> = []

  const cancel: ReservationCancelPort = over.cancel ?? (async () => ({ ok: true }))

  const deps: any = {
    hotelId: 'h1',
    apiKey: 'key',
    orm: {
      findMany: async (model: string) => {
        if (model === 'Reservations') return over.existingRes ?? [EXISTING]
        if (model === 'Rooms') return [{ id: 'room-1', type: 'double' }]
        return []
      },
      create: async (_model: string, payload: any) => { created.push(payload); return payload },
      update: async () => {},
    },
    channex: { getRoomTypeById: async () => ({ id: 'rt-1', title: 'Double Room' }) },
    cancelReservation: async (id: string, hotelId: string, reason: string) => {
      cancelCalls.push({ id, hotelId, reason })
      return cancel(id, hotelId, reason)
    },
    logger: { error: (msg: string, meta?: Record<string, unknown>) => { logged.push({ msg, meta }) } },
  }
  return { deps, created, cancelCalls, logged }
}

const cancelledDto = (over: Record<string, unknown> = {}) => ({
  hotelId: 'h1', externalLocator: 'OTA-1', status: 'cancelled', channel: 'booking.com', ...over,
})

describe('applyBookingRevision — cancelación OTA', () => {
  it('reserva existente + status cancelled → cancela por el puerto, no crea nada', async () => {
    const { deps, created, cancelCalls } = makeDeps()
    const res = await applyBookingRevision(deps, cancelledDto())

    expect(res.created).toBe(false)
    expect(created).toHaveLength(0)
    expect(cancelCalls).toHaveLength(1)
    expect(cancelCalls[0]!.id).toBe('res-9')
    expect(cancelCalls[0]!.hotelId).toBe('h1')
    expect(cancelCalls[0]!.reason).toContain('booking.com')
  })

  it('sin canal en la revisión → el motivo cae en "OTA", no en undefined', async () => {
    const { deps, cancelCalls } = makeDeps()
    await applyBookingRevision(deps, cancelledDto({ channel: undefined }))
    expect(cancelCalls[0]!.reason).toContain('OTA')
    expect(cancelCalls[0]!.reason).not.toContain('undefined')
  })

  it('el feed reprocesa la misma revisión → vuelve a delegar y NO crea duplicado (idempotencia del lado reservas)', async () => {
    const { deps, created, cancelCalls } = makeDeps({
      existingRes: [{ ...EXISTING, status: 'cancelled' }],
      cancel: async () => ({ ok: true, idempotent: true }),
    })
    await applyBookingRevision(deps, cancelledDto())
    await applyBookingRevision(deps, cancelledDto())

    expect(created).toHaveLength(0)
    expect(cancelCalls).toHaveLength(2)
  })

  it('fallo transitorio (puerto sin cablear, BD caída) → LANZA para que la revisión se reintente y NO se ackee', async () => {
    const { deps, logged } = makeDeps({
      cancel: async () => ({ ok: false, error: 'db_down', message: 'connection refused' }),
    })
    await expect(applyBookingRevision(deps, cancelledDto())).rejects.toThrow(/No se pudo cancelar la reserva res-9/)
    expect(logged).toHaveLength(0)
  })

  it('invalid_state (el huésped ya hizo check-in) → NO lanza: se loguea y se ackea, un reintento daría lo mismo', async () => {
    const { deps, logged } = makeDeps({
      cancel: async () => ({ ok: false, error: 'invalid_state', message: 'reserva en checked_in' }),
    })
    const res = await applyBookingRevision(deps, cancelledDto())

    expect(res.created).toBe(false)
    expect(logged).toHaveLength(1)
    expect(logged[0]!.meta?.reason).toBe('invalid_state')
    expect(logged[0]!.meta?.reservationId).toBe('res-9')
    expect(logged[0]!.meta?.externalLocator).toBe('OTA-1')
  })

  it('not_found → NO lanza: mismo trato definitivo que invalid_state', async () => {
    const { deps, logged } = makeDeps({
      cancel: async () => ({ ok: false, error: 'not_found' }),
    })
    await applyBookingRevision(deps, cancelledDto())
    expect(logged[0]!.meta?.reason).toBe('not_found')
  })

  it('sin logger cableado, un fallo definitivo tampoco lanza', async () => {
    const { deps } = makeDeps({ cancel: async () => ({ ok: false, error: 'not_found' }) })
    delete (deps as any).logger
    const res = await applyBookingRevision(deps, cancelledDto())
    expect(res.created).toBe(false)
  })

  it('revisión MODIFICADA de una reserva existente → dedupe seco: ni cancela ni crea (no se auto-aplica)', async () => {
    const { deps, created, cancelCalls } = makeDeps()
    const res = await applyBookingRevision(deps, cancelledDto({ status: 'modified', totalAmount: 999 }))

    expect(res.created).toBe(false)
    expect(created).toHaveLength(0)
    expect(cancelCalls).toHaveLength(0)
  })

  it('cancelación de una reserva que el PMS nunca vio → se ingesta como cancelada, sin llamar al puerto', async () => {
    const { deps, created, cancelCalls } = makeDeps({ existingRes: [] })
    const res = await applyBookingRevision(deps, cancelledDto())

    expect(res.created).toBe(true)
    expect(cancelCalls).toHaveLength(0)
    expect(created[0]!.status).toBe('cancelled')
  })
})
