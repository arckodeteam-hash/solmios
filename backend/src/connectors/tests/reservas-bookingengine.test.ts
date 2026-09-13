// connectors/tests/reservas-bookingengine.test.ts — invalidación del listado de reservas ante
// escrituras del motor público que no pasan por el CRUD de `reservas`.
//
// #272 (revisión): además del alta (`onBookingCreated`), la cancelación pública escribe
// `Reservations` directo (bookingengine/usecases/public-cancel.ts) y el listado seguía mostrando
// la reserva viva hasta CACHE_TTL (300 s). El connector tiene que bumpear también en
// `onBookingCancelled`, y un fallo de la invalidación no puede tumbar el evento.
// #309: la confirmación por pago web (webhook Stripe / retorno Azul-CardNet) escribe status/paid
// directo y el listado seguía 'pendiente': el connector también bumpea en `onBookingPaid`.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { reservasBookingengineConnector } from '../reservas-bookingengine'

function makeCtx(opts: { invalidateThrows?: boolean; assignThrows?: boolean; assignResult?: any } = {}) {
  const invalidated: string[] = []
  const assigned: Array<{ reservationId: string; hotelId: string }> = []
  const sockets: Record<string, any> = {}
  const modules: Record<string, any> = {
    bookingengine: { setSockets: (s: any) => accumulateSockets(sockets, s) },
    reservas: {
      invalidateListCache: async (hotelId: string) => {
        if (opts.invalidateThrows) throw new Error('cache caída')
        invalidated.push(hotelId)
      },
      autoAssignRoom: async (reservationId: string, hotelId: string) => {
        if (opts.assignThrows) throw new Error('sin unidad')
        assigned.push({ reservationId, hotelId })
        return opts.assignResult ?? { assigned: true, roomId: 'rm1', roomNumber: '101' }
      },
    },
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  reservasBookingengineConnector(ctx)
  return { sockets, invalidated, assigned }
}

const CANCELLED = {
  reservationId: 'res-1', hotelId: 'h1', refundAmount: 100, cancellationFee: 100, policyApplied: null,
  promoCode: null, reservationIds: ['res-1', 'res-2'], roomIds: ['rm1', 'rm2'], groupId: 'g1',
}

const PAID = { id: 'res-1', hotelId: 'h1', totalAmount: 100, paymentRef: 'cs_1' }

describe('reservasBookingengineConnector', () => {
  it('onBookingCreated → invalida el listado del hotel', async () => {
    const { sockets, invalidated } = makeCtx()
    await sockets.onBookingCreated({ id: 'res-1', hotelId: 'h1' })
    expect(invalidated).toEqual(['h1'])
  })

  it('onBookingCancelled → invalida el listado del hotel (#272)', async () => {
    const { sockets, invalidated } = makeCtx()
    expect(typeof sockets.onBookingCancelled).toBe('function')
    await sockets.onBookingCancelled(CANCELLED)
    expect(invalidated).toEqual(['h1'])
  })

  it('onBookingPaid → invalida el listado del hotel (#309)', async () => {
    const { sockets, invalidated } = makeCtx()
    expect(typeof sockets.onBookingPaid).toBe('function')
    await sockets.onBookingPaid(PAID)
    expect(invalidated).toEqual(['h1'])
  })

  // Corrección 2026-09-13 a REQ-HAC-05: la fila nace por tipo, pero el sistema le asigna una unidad al instante.
  it('onBookingCreated → pide una unidad para la reserva (autoAssignRoom con id + hotel)', async () => {
    const { sockets, assigned } = makeCtx()
    await sockets.onBookingCreated({ id: 'res-1', hotelId: 'h1' })
    expect(assigned).toEqual([{ reservationId: 'res-1', hotelId: 'h1' }])
  })

  it('onBookingCreated de un grupo → una unidad por CADA fila (`reservationIds`), no sólo la líder', async () => {
    const { sockets, assigned } = makeCtx()
    await sockets.onBookingCreated({ id: 'res-1', hotelId: 'h1', reservationIds: ['res-1', 'res-2', 'res-3'] })
    expect(assigned.map((a) => a.reservationId)).toEqual(['res-1', 'res-2', 'res-3'])
    expect(new Set(assigned.map((a) => a.hotelId))).toEqual(new Set(['h1']))
  })

  it('la auto-asignación falla o no encuentra unidad → el evento resuelve igual (la reserva ya existe)', async () => {
    const a = makeCtx({ assignThrows: true })
    await expect(a.sockets.onBookingCreated({ id: 'res-1', hotelId: 'h1' })).resolves.toBeUndefined()
    const b = makeCtx({ assignResult: { assigned: false, reason: 'no_rooms' } })
    await expect(b.sockets.onBookingCreated({ id: 'res-1', hotelId: 'h1', reservationIds: ['res-1', 'res-2'] })).resolves.toBeUndefined()
    expect(b.assigned).toHaveLength(2)
  })

  it('onBookingPaid / onBookingCancelled NO asignan (sólo el alta)', async () => {
    const { sockets, assigned } = makeCtx()
    await sockets.onBookingPaid(PAID)
    await sockets.onBookingCancelled(CANCELLED)
    expect(assigned).toEqual([])
  })

  it('la invalidación falla → el evento resuelve igual', async () => {
    const { sockets } = makeCtx({ invalidateThrows: true })
    await expect(sockets.onBookingCancelled(CANCELLED)).resolves.toBeUndefined()
    await expect(sockets.onBookingCreated({ id: 'res-1', hotelId: 'h1' })).resolves.toBeUndefined()
    await expect(sockets.onBookingPaid(PAID)).resolves.toBeUndefined()
  })
})
