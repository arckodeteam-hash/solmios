// connectors/tests/restaurante-integridad.test.ts — #208: el puerto de reservas que el restaurante
// recibe por conector en vez de importar el módulo reservas.
//
//  - restaurante-reservas: `ReservationPort.findById` delega en `reservas.getById` (que ya hace
//    ownership) y traduce "no existe" y "es de otro hotel" a `null` — el usecase responde el MISMO
//    404 para ambos. Otros errores (base caída) se propagan: no son "no encontrada".
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { AuthError, NotFoundError, ForbiddenError } from 'arckode-framework'
import { restauranteReservasConnector } from '../restaurante-reservas'

const user = { id: 'u1', role: 'waiter', hotelId: 'h1' }

function mountReservas(getById: (id: string, u: any) => Promise<any>) {
  let port: any = null
  const calls: any[] = []
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'restaurant') return { setReservationPort: (p: any) => { port = p } }
      if (name === 'reservas') return { getById: async (id: string, u: any) => { calls.push([id, u]); return getById(id, u) } }
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  restauranteReservasConnector(ctx)
  return { port, calls }
}

describe('restauranteReservasConnector', () => {
  it('reserva encontrada → resumen {id, hotelId, guestId, roomId}, llamando a reservas.getById con el usuario', async () => {
    const { port, calls } = mountReservas(async (id) => ({ id, hotelId: 'h1', guestId: 'g1', roomId: 'r-101', totalAmount: 500, checkIn: '2026-01-01' }))
    expect(await port.findById('res-1', user)).toEqual({ id: 'res-1', hotelId: 'h1', guestId: 'g1', roomId: 'r-101' })
    expect(calls).toEqual([['res-1', { id: 'u1', role: 'waiter', hotelId: 'h1' }]])
  })

  it('NotFoundError de reservas → null', async () => {
    const { port } = mountReservas(async () => { throw new NotFoundError('Reserva no encontrada') })
    expect(await port.findById('nope', user)).toBeNull()
  })

  it('AuthError (reserva de otro hotel, ownership de reservas) → null', async () => {
    const { port } = mountReservas(async () => { throw new AuthError('No autorizado') })
    expect(await port.findById('ajena', user)).toBeNull()
  })

  it('ForbiddenError → null', async () => {
    const { port } = mountReservas(async () => { throw new ForbiddenError('Forbidden') })
    expect(await port.findById('ajena', user)).toBeNull()
  })

  it('cualquier otro error (base caída) se propaga — no es "no encontrada"', async () => {
    const { port } = mountReservas(async () => { throw new Error('connection refused') })
    await expect(port.findById('res-1', user)).rejects.toThrow('connection refused')
  })

  it('super_admin: getById devuelve la reserva de otro hotel y el resumen trae ESE hotelId (el usecase decide el 404)', async () => {
    const { port } = mountReservas(async (id) => ({ id, hotelId: 'h2' }))
    const r = await port.findById('res-2', { id: 'sa', role: 'super_admin', hotelId: 'h1' })
    expect(r?.hotelId).toBe('h2')
  })
})
