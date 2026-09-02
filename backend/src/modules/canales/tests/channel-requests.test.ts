// channel-requests.test.ts — "Solicitar Conexión" tiene que llegarle a alguien.
//
// Antes ese botón abría el asistente embebido de Channex y ahí moría: el hotelero veía una
// pantalla en inglés pidiendo credenciales de OTA que no tiene, y del lado nuestro nadie se
// enteraba de que ese hotel quería conectarse.
import { describe, it, expect } from 'bun:test'
import {
  requestChannel, updateChannelRequest, forHotel,
  type ChannelRequestDeps, type ChannelRequestRow,
} from '../usecases/channel-requests'

function makeDeps(existing: ChannelRequestRow[] = []) {
  const rows = [...existing]
  const notified: ChannelRequestRow[] = []
  const deps: ChannelRequestDeps = {
    findMany: async (q) => rows.filter((r) => r.hotelId === q.hotelId && r.channel === q.channel),
    create: async (row) => { rows.push(row); return row },
    update: async (id, patch) => {
      const i = rows.findIndex((r) => r.id === id)
      rows[i] = { ...rows[i]!, ...patch } as ChannelRequestRow
      return rows[i]!
    },
    notify: async (row) => { notified.push(row) },
  }
  return { deps, rows, notified }
}

const BOOKING = { hotelId: 'h1', hotelName: 'Hotel Frente Sol', channel: 'booking', channelName: 'Booking.com', requestedByEmail: 'dueño@hotel.com' }

describe('requestChannel', () => {
  it('registra el pedido y avisa al admin', async () => {
    const { deps, rows, notified } = makeDeps()
    const { request, created } = await requestChannel(deps, BOOKING)
    expect(created).toBe(true)
    expect(request).toMatchObject({ hotelId: 'h1', channel: 'booking', status: 'pending', hotelName: 'Hotel Frente Sol' })
    expect(rows).toHaveLength(1)
    expect(notified).toHaveLength(1)
  })

  it('apretar dos veces NO genera dos pedidos', async () => {
    const { deps, rows } = makeDeps()
    const primero = await requestChannel(deps, BOOKING)
    const segundo = await requestChannel(deps, BOOKING)
    expect(segundo.created).toBe(false)
    expect(segundo.request.id).toBe(primero.request.id)
    expect(rows).toHaveLength(1)
  })

  it('pero si la anterior se cerró, se puede volver a pedir', async () => {
    const { deps, rows } = makeDeps([
      { id: 'vieja', hotelId: 'h1', channel: 'booking', status: 'rejected' } as ChannelRequestRow,
    ])
    const { created } = await requestChannel(deps, BOOKING)
    expect(created).toBe(true)
    expect(rows).toHaveLength(2)
  })

  it('otro canal es otro pedido', async () => {
    const { deps, rows } = makeDeps()
    await requestChannel(deps, BOOKING)
    await requestChannel(deps, { ...BOOKING, channel: 'airbnb', channelName: 'Airbnb' })
    expect(rows.map((r) => r.channel)).toEqual(['booking', 'airbnb'])
  })

  it('un fallo del aviso no pierde la solicitud', async () => {
    const { deps, rows } = makeDeps()
    deps.notify = async () => { throw new Error('SMTP caído') }
    const { created } = await requestChannel(deps, BOOKING)
    expect(created).toBe(true)
    expect(rows).toHaveLength(1)
  })
})

describe('updateChannelRequest', () => {
  it('el admin mueve el estado y deja notas', async () => {
    const { deps } = makeDeps([{ id: 'r1', hotelId: 'h1', channel: 'booking', status: 'pending' } as ChannelRequestRow])
    const updated = await updateChannelRequest(deps, 'r1', { status: 'in_progress', notes: 'Esperando el contrato' })
    expect(updated).toMatchObject({ status: 'in_progress', notes: 'Esperando el contrato' })
  })

  it('un estado inventado se rechaza en vez de guardarse', async () => {
    const { deps } = makeDeps([{ id: 'r1', hotelId: 'h1', channel: 'booking', status: 'pending' } as ChannelRequestRow])
    expect(await updateChannelRequest(deps, 'r1', { status: 'lo-que-sea' })).toBeNull()
  })
})

describe('forHotel', () => {
  it('las notas del admin no salen hacia el hotel', () => {
    const visible = forHotel({ id: 'r1', hotelId: 'h1', channel: 'booking', status: 'pending', notes: 'ojo, este hotel debe 2 meses' } as ChannelRequestRow)
    expect('notes' in visible).toBe(false)
    expect(visible.status).toBe('pending')
  })
})
