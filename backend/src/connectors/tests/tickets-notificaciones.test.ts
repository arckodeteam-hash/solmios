// connectors/tests/tickets-notificaciones.test.ts — REQ-SOP-06: el hotel se entera de la
// respuesta del agente (con su nombre y link al ticket) sin entrar a /panel/support.
//
// Un conector solo DELEGA: se verifica el cableado, el filtro (sólo soporte / sólo admin con
// cambio de estado) y que un fallo del satélite nunca rompa el addMessage/update del ticket.

import { describe, it, expect, spyOn } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { ticketsNotificacionesConnector } from '../tickets-notificaciones'

function makeCtx(hosts: string[], modules: Record<string, any> = {}) {
  const captured: any = { sockets: {} }
  const hostStub = { setSockets: (s: any) => Object.assign(captured.sockets, s) }
  const ctx = {
    resolveModule: (name: string) => {
      if (hosts.includes(name)) return { ...hostStub, ...(modules[name] ?? {}) }
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`) // simula un módulo no montado
    },
  } as unknown as ConnectorContext
  return { ctx, captured }
}

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 't1', hotelId: 'h1', userId: 'u1', subject: 'Wifi caído', status: 'open',
  createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', ...over,
})
const msg = (over: Record<string, unknown> = {}) => ({
  id: 'm1', authorId: 'a1', authorName: 'Ana', authorKind: 'support', message: 'Ya lo revisamos', createdAt: '2026-09-10T00:00:00.000Z', ...over,
})
const adminChange = (previousStatus = 'open') => ({
  previous: ticket({ status: previousStatus }),
  actor: { id: 'a1', name: 'Ana', role: 'super_admin', userType: 'admin' },
})

function setup(notificaciones: any = { create: async (dto: any) => { created.push(dto); return {} } }) {
  const { ctx, captured } = makeCtx(['tickets'], { notificaciones })
  ticketsNotificacionesConnector(ctx)
  return captured
}
let created: any[] = []

describe('ticketsNotificacionesConnector', () => {
  it('mensaje de soporte → 1 notificación al hotel con el nombre del agente y el link al ticket', async () => {
    created = []
    const captured = setup()
    await captured.sockets.onTicketsMessageAdded(ticket(), msg())

    expect(created).toHaveLength(1)
    expect(created[0].hotelId).toBe('h1')
    expect(created[0].userId).toBeUndefined() // broadcast al hotel
    expect(created[0].type).toBe('system')
    expect(created[0].title).toContain('Ana')
    expect(created[0].title).toContain('respondió tu ticket «Wifi caído»')
    expect(created[0].message).toBe('Ya lo revisamos')
    expect(created[0].metadata.link).toBe('/panel/support?ticket=t1')
    expect(created[0].metadata.ticketId).toBe('t1')
    expect(created[0].metadata.agentId).toBe('a1')
  })

  it('mensaje del hotel → 0 notificaciones (lo escribió él mismo)', async () => {
    created = []
    const captured = setup()
    await captured.sockets.onTicketsMessageAdded(ticket(), msg({ authorKind: 'hotel', authorName: 'Recepción' }))
    expect(created).toHaveLength(0)
  })

  it('notificaciones.create lanza → el socket resuelve sin lanzar (el mensaje ya está guardado)', async () => {
    created = []
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const captured = setup({ create: async () => { throw new Error('db down') } })
      await expect(captured.sockets.onTicketsMessageAdded(ticket(), msg())).resolves.toBeUndefined()
      await expect(captured.sockets.onTicketsUpdated(ticket({ status: 'resolved' }), adminChange('open'))).resolves.toBeUndefined()
      expect(created).toHaveLength(0)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('estado cambiado por admin → 1 notificación con nombre, estado legible y link', async () => {
    created = []
    const captured = setup()
    await captured.sockets.onTicketsUpdated(ticket({ status: 'in_progress' }), adminChange('open'))

    expect(created).toHaveLength(1)
    expect(created[0].title).toBe('Ana marcó tu ticket «Wifi caído» como En progreso')
    expect(created[0].type).toBe('system')
    expect(created[0].metadata.link).toBe('/panel/support?ticket=t1')
    expect(created[0].metadata.status).toBe('in_progress')
    expect(created[0].metadata.agentId).toBe('a1')
  })

  it('sin cambio de estado, cambio hecho por el hotel o sin change → 0 notificaciones', async () => {
    created = []
    const captured = setup()
    await captured.sockets.onTicketsUpdated(ticket({ status: 'open' }), adminChange('open'))
    await captured.sockets.onTicketsUpdated(ticket({ status: 'closed' }), {
      previous: ticket({ status: 'open' }),
      actor: { id: 'u1', name: 'Recepción', role: 'admin', hotelId: 'h1', userType: 'merchant' },
    })
    await captured.sockets.onTicketsUpdated(ticket({ status: 'closed' }))
    expect(created).toHaveLength(0)
  })

  it('módulo notificaciones no montado → el socket resuelve sin lanzar', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { ctx, captured } = makeCtx(['tickets'])
      ticketsNotificacionesConnector(ctx)
      await expect(captured.sockets.onTicketsMessageAdded(ticket(), msg())).resolves.toBeUndefined()
      await expect(captured.sockets.onTicketsUpdated(ticket({ status: 'resolved' }), adminChange('open'))).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})
