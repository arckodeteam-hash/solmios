// connectors/tests/reservas-bookingengine.test.ts — invalidación del listado de reservas ante
// escrituras del motor público que no pasan por el CRUD de `reservas`.
//
// #272 (revisión): además del alta (`onBookingCreated`), la cancelación pública escribe
// `Reservations` directo (bookingengine/usecases/public-cancel.ts) y el listado seguía mostrando
// la reserva viva hasta CACHE_TTL (300 s). El connector tiene que bumpear también en
// `onBookingCancelled`, y un fallo de la invalidación no puede tumbar el evento.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { reservasBookingengineConnector } from '../reservas-bookingengine'

function makeCtx(opts: { invalidateThrows?: boolean } = {}) {
  const invalidated: string[] = []
  const sockets: Record<string, any> = {}
  const modules: Record<string, any> = {
    bookingengine: { setSockets: (s: any) => accumulateSockets(sockets, s) },
    reservas: {
      invalidateListCache: async (hotelId: string) => {
        if (opts.invalidateThrows) throw new Error('cache caída')
        invalidated.push(hotelId)
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
  return { sockets, invalidated }
}

const CANCELLED = {
  reservationId: 'res-1', hotelId: 'h1', refundAmount: 100, cancellationFee: 100, policyApplied: null,
  promoCode: null, reservationIds: ['res-1', 'res-2'], roomIds: ['rm1', 'rm2'], groupId: 'g1',
}

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

  it('la invalidación falla → el evento resuelve igual', async () => {
    const { sockets } = makeCtx({ invalidateThrows: true })
    await expect(sockets.onBookingCancelled(CANCELLED)).resolves.toBeUndefined()
    await expect(sockets.onBookingCreated({ id: 'res-1', hotelId: 'h1' })).resolves.toBeUndefined()
  })
})
