// connectors/tests/tickets-notificaciones.test.ts — Cableado tickets→notificaciones (#120).
//
// El conector solo DELEGA en shared/usecases/notify-ticket, pero es el que decide que un fallo
// de la campanita no tumbe la respuesta del agente (ya persistida). Se verifica: quién dispara
// el aviso (soporte sí, hotel no), qué lleva (agente, asunto, link al ticket) y que un
// notificaciones.create roto se loguea y no propaga.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext, Logger } from 'arckode-framework'
import { ticketsNotificacionesConnector } from '../tickets-notificaciones'

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 'tk1', hotelId: 'h1', userId: 'u-rosa', subject: 'No puedo emitir facturas', status: 'open',
  createdAt: '', updatedAt: '', ...over,
})

const message = (over: Record<string, unknown> = {}) => ({
  id: 'm1', authorId: 'u-agent', authorName: 'Ana Soporte', authorKind: 'support', message: 'Ya lo estamos viendo', createdAt: '',
  ...over,
})

/** Monta el conector y devuelve los sockets que registró + lo que le pidió a notificaciones. */
function mount(opts: { createThrows?: boolean; notificacionesAvailable?: boolean } = {}) {
  const created: any[] = []
  const errors: any[] = []
  let sockets: any = {}

  const notificaciones = {
    create: async (dto: any, user: any) => {
      if (opts.createThrows) throw new Error('db down')
      created.push({ dto, user })
      return { id: 'n1', ...dto }
    },
  }
  const logger = {
    error: (msg: string, meta?: any) => { errors.push({ msg, meta }) },
    warn: () => {}, info: () => {}, debug: () => {},
  } as unknown as Logger

  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'tickets') return { setSockets: (s: any) => { sockets = s } }
      if (name === 'notificaciones') {
        if (opts.notificacionesAvailable === false) throw new Error('notificaciones no disponible')
        return notificaciones
      }
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext

  ticketsNotificacionesConnector(logger)(ctx)
  return { sockets, created, errors }
}

describe('ticketsNotificacionesConnector', () => {
  it('registra los dos sockets (mensaje y cambio de estado)', () => {
    const { sockets } = mount()
    expect(typeof sockets.onTicketsMessageAdded).toBe('function')
    expect(typeof sockets.onTicketsStatusChanged).toBe('function')
  })

  it('mensaje de soporte → 1 notificación al hotel con el nombre del agente, el asunto y el link', async () => {
    const { sockets, created } = mount()
    await sockets.onTicketsMessageAdded(ticket(), message())

    expect(created).toHaveLength(1)
    const { dto, user } = created[0]
    expect(dto.hotelId).toBe('h1')
    expect(dto.type).toBe('support')
    expect(dto.userId).toBeUndefined() // broadcast al hotel, no a un usuario puntual
    expect(dto.title).toContain('Ana Soporte')
    expect(dto.title).toContain('No puedo emitir facturas')
    expect(dto.message).toContain('Ya lo estamos viendo')
    expect(dto.metadata).toMatchObject({ ticketId: 'tk1', link: '/panel/support?ticket=tk1', agentName: 'Ana Soporte' })
    expect(user.hotelId).toBe('h1')
  })

  it('mensaje del hotel → 0 notificaciones (el hotel no se avisa a sí mismo)', async () => {
    const { sockets, created } = mount()
    await sockets.onTicketsMessageAdded(ticket(), message({ authorKind: 'hotel', authorName: 'Rosa' }))
    expect(created).toHaveLength(0)
  })

  it('cambio de estado → 1 notificación con el agente y el estado nuevo', async () => {
    const { sockets, created } = mount()
    await sockets.onTicketsStatusChanged(ticket({ status: 'resolved' }), {
      from: 'open', to: 'resolved', actor: { id: 'u-agent', name: 'Ana Soporte', userType: 'admin' },
    })

    expect(created).toHaveLength(1)
    const { dto } = created[0]
    expect(dto.type).toBe('support')
    expect(dto.hotelId).toBe('h1')
    expect(dto.title).toContain('Ana Soporte')
    expect(dto.title).toContain('Resuelto')
    expect(dto.message).toContain('Resuelto')
    expect(dto.metadata.link).toBe('/panel/support?ticket=tk1')
  })

  it('notificaciones.create lanza → se loguea y NO propaga', async () => {
    const { sockets, created, errors } = mount({ createThrows: true })

    await expect(sockets.onTicketsMessageAdded(ticket(), message())).resolves.toBeUndefined()
    await expect(sockets.onTicketsStatusChanged(ticket(), {
      to: 'in_progress', actor: { id: 'u-agent', name: 'Ana Soporte', userType: 'admin' },
    })).resolves.toBeUndefined()

    expect(created).toHaveLength(0)
    expect(errors).toHaveLength(2)
    expect(errors[0].meta).toMatchObject({ ticketId: 'tk1', hotelId: 'h1', event: 'message', error: 'db down' })
    expect(errors[1].meta).toMatchObject({ ticketId: 'tk1', event: 'status', error: 'db down' })
  })

  it('notificaciones no montado → se loguea y NO propaga (satélite opcional)', async () => {
    const { sockets, created, errors } = mount({ notificacionesAvailable: false })
    await expect(sockets.onTicketsMessageAdded(ticket(), message())).resolves.toBeUndefined()
    expect(created).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })
})
