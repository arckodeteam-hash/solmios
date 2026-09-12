// connectors/tests/reservas-wallet.test.ts — Conector reservas-wallet (#262, REQ-HAC-07).
//
// Un conector solo DELEGA. Acá se verifica que escucha `reservas.onRoomAssigned` (además de
// `bookingengine.onBookingPaid`) y que al asignar una habitación dispara
// `wallet.generatePass(reservationId, false)` sin que un fallo del módulo tumbe la asignación.
// Molde del ctx: reservas-connectors.test.ts.

import { describe, it, expect, mock } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { reservasWalletConnector } from '../reservas-wallet'

/** ctx mock: captura los sockets que el conector inyecta en bookingengine y reservas. */
function makeCtx(wallet: any) {
  const captured: { bookingengine: any; reservas: any } = { bookingengine: {}, reservas: {} }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'bookingengine') return { setSockets: (s: any) => Object.assign(captured.bookingengine, s) }
      if (name === 'reservas') return { setSockets: (s: any) => Object.assign(captured.reservas, s) }
      if (name === 'wallet-pass') return wallet
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured }
}

describe('reservasWalletConnector — onRoomAssigned (#262)', () => {
  it('registra onBookingPaid en bookingengine y onRoomAssigned en reservas', () => {
    const { ctx, captured } = makeCtx({ generatePass: mock(async () => null) })
    reservasWalletConnector(ctx)
    expect(typeof captured.bookingengine.onBookingPaid).toBe('function')
    expect(typeof captured.reservas.onRoomAssigned).toBe('function')
  })

  it('onRoomAssigned con roomId → generatePass(reservationId, false)', async () => {
    const generatePass = mock(async (_id: string, _send?: boolean) => null)
    const { ctx, captured } = makeCtx({ generatePass })
    reservasWalletConnector(ctx)

    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: null })

    expect(generatePass).toHaveBeenCalledTimes(1)
    expect(generatePass.mock.calls[0]).toEqual(['res1', false])
  })

  it('onRoomAssigned con roomId null (desasignación) → no llama generatePass', async () => {
    const generatePass = mock(async (_id: string, _send?: boolean) => null)
    const { ctx, captured } = makeCtx({ generatePass })
    reservasWalletConnector(ctx)

    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: null, previousRoomId: 'r1' })

    expect(generatePass).not.toHaveBeenCalled()
  })

  it('si generatePass lanza → no propaga (la asignación no se rompe)', async () => {
    const generatePass = mock(async (_id: string, _send?: boolean) => { throw new Error('ttlock caído') })
    const { ctx, captured } = makeCtx({ generatePass })
    reservasWalletConnector(ctx)

    await expect(
      captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: null }),
    ).resolves.toBeUndefined()
    expect(generatePass).toHaveBeenCalledTimes(1)
  })

  it('onBookingPaid sigue disparando generatePass(id, false)', async () => {
    const generatePass = mock(async (_id: string, _send?: boolean) => null)
    const { ctx, captured } = makeCtx({ generatePass })
    reservasWalletConnector(ctx)

    await captured.bookingengine.onBookingPaid({ id: 'res1' })

    expect(generatePass.mock.calls[0]).toEqual(['res1', false])
  })
})
