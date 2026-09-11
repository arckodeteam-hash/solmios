// tickets/tests/notify-hooks.test.ts — Bloque 7 (#120): hooks de notificación del service.
// - onTicketsStatusChanged SOLO cuando un admin de plataforma cambia el status (ticket enriquecido).
// - email al solicitante (best-effort, nunca propaga) en respuestas de soporte y cambios de estado.
// Usa repos fake — sin SQLite ni Postgres.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { TicketsService } from '../service'
import type { TicketsDTO } from '../types'
import type { TicketStatusChange } from '../sockets'
import type { TicketEmailPort } from '../usecases/notify-requester'
import { emailRequester } from '../usecases/notify-requester'
import { buildTicketStatusNotice, buildTicketMessageNotice, notifyTicketMessage, notifyTicketStatus } from '../../../shared/usecases/notify-ticket'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const platformAdmin = { id: 'agent-1', role: 'super_admin', hotelId: undefined, userType: 'admin' }
const merchant = { id: 'u1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' }

const baseTicket = (overrides: Partial<TicketsDTO> = {}): TicketsDTO => ({
  id: 't1', hotelId: 'h1', userId: 'u1', subject: 'No anda el check-in', status: 'open',
  createdAt: '', updatedAt: '', messages: [], ...overrides,
})

function makeRepo(ticket: TicketsDTO): RepositoryAdapter<TicketsDTO> {
  return {
    findMany: async () => [],
    findById: async () => ticket,
    findOne: async () => null,
    create: async (data) => ({ id: 'ticket-1', ...data } as TicketsDTO),
    update: async (id, data) => ({ ...ticket, id, ...data } as TicketsDTO),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }
}

const users = [
  { id: 'u1', name: 'Rosa Hotelera', email: 'rosa@hotel.com', role: 'hotel_admin', hotelId: 'h1', active: 1 },
  { id: 'agent-1', name: 'Agente Solmios', email: 'agente@solmios.com', role: 'super_admin', hotelId: 'platform', active: 1 },
]
const userRepo = {
  findById: async (id: string) => users.find((u) => u.id === id) ?? null,
  findMany: async () => users,
} as unknown as RepositoryAdapter<any>
const hotelRepo = { findMany: async () => [{ id: 'h1', name: 'Hotel Sol' }] } as unknown as RepositoryAdapter<any>

function makeService(ticket: TicketsDTO) {
  return new TicketsService(makeRepo(ticket), log, silentCache, userRepo, fakeAuth, hotelRepo)
}

type EnqueueInput = Parameters<TicketEmailPort['enqueue']>[0]
function makeEmailPort(opts: { configured?: boolean; fail?: boolean } = {}) {
  const sent: EnqueueInput[] = []
  const port: TicketEmailPort = {
    isConfigured: async () => opts.configured ?? true,
    enqueue: async (input) => {
      if (opts.fail) throw new Error('smtp down')
      sent.push(input)
      return 'msg-1'
    },
  }
  return { port, sent }
}

describe('onTicketsStatusChanged (solo admin de plataforma)', () => {
  it('admin PUT {status: resolved} sobre ticket open → 1 llamada con from/to/actor y ticket enriquecido', async () => {
    const svc = makeService(baseTicket({ status: 'open' }))
    const changes: TicketStatusChange[] = []
    let changedTicket: TicketsDTO | null = null
    let updatedTicket: TicketsDTO | null = null
    svc.setSockets({
      onTicketsStatusChanged: async (t, c) => { changedTicket = t; changes.push(c) },
      onTicketsUpdated: async (t) => { updatedTicket = t },
    })

    const result = await svc.update('t1', { status: 'resolved' }, platformAdmin)

    expect(result.status).toBe('resolved')
    // La respuesta del PUT vuelve enriquecida, igual que getById/addMessage
    expect(result.requester?.name).toBe('Rosa Hotelera')
    expect(result.hotel?.name).toBe('Hotel Sol')
    expect(changes).toHaveLength(1)
    expect(changes[0].from).toBe('open')
    expect(changes[0].to).toBe('resolved')
    expect(changes[0].actor.id).toBe('agent-1')
    expect(changes[0].actor.name).toBe('Agente Solmios')
    expect(changes[0].actor.userType).toBe('admin')
    expect(changedTicket!.requester?.email).toBe('rosa@hotel.com')
    expect(changedTicket!.hotel?.name).toBe('Hotel Sol')
    // onTicketsUpdated también recibe el ticket enriquecido
    expect(updatedTicket!.requester?.name).toBe('Rosa Hotelera')
    expect(updatedTicket!.hotel?.id).toBe('h1')
  })

  it('merchant PUT {status: resolved} → socket NO llamado (onTicketsUpdated sí)', async () => {
    const svc = makeService(baseTicket({ status: 'open' }))
    let statusCalls = 0
    let updatedCalls = 0
    svc.setSockets({
      onTicketsStatusChanged: async () => { statusCalls++ },
      onTicketsUpdated: async () => { updatedCalls++ },
    })
    await svc.update('t1', { status: 'resolved' }, merchant)
    expect(statusCalls).toBe(0)
    expect(updatedCalls).toBe(1)
  })

  it('admin PUT {priority: high} sin status → NO llamado', async () => {
    const svc = makeService(baseTicket({ status: 'open' }))
    let statusCalls = 0
    svc.setSockets({ onTicketsStatusChanged: async () => { statusCalls++ } })
    await svc.update('t1', { priority: 'high' }, platformAdmin)
    expect(statusCalls).toBe(0)
  })

  it('admin PUT con el mismo status → NO llamado', async () => {
    const svc = makeService(baseTicket({ status: 'resolved' }))
    let statusCalls = 0
    svc.setSockets({ onTicketsStatusChanged: async () => { statusCalls++ } })
    await svc.update('t1', { status: 'resolved' }, platformAdmin)
    expect(statusCalls).toBe(0)
  })

  it('admin cambia status → email al solicitante con el estado', async () => {
    const svc = makeService(baseTicket({ status: 'open' }))
    const { port, sent } = makeEmailPort()
    svc.setEmailDeps(port)
    await svc.update('t1', { status: 'resolved' }, platformAdmin)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('rosa@hotel.com')
    expect(sent[0].subject).toBe('Agente Solmios marcó tu ticket «No anda el check-in» como Resuelto')
    expect(sent[0].relatedType).toBe('ticket')
    expect(sent[0].relatedId).toBe('t1')
  })
})

describe('email al solicitante en addMessage', () => {
  it('admin responde → enqueue con to/hotelId/relatedId del ticket', async () => {
    const svc = makeService(baseTicket())
    const { port, sent } = makeEmailPort({ configured: true })
    svc.setEmailDeps(port)
    let socketTicket: TicketsDTO | null = null
    svc.setSockets({ onTicketsMessageAdded: async (t) => { socketTicket = t } })

    await svc.addMessage('t1', 'Ya lo estamos viendo', platformAdmin)

    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('rosa@hotel.com')
    expect(sent[0].hotelId).toBe('h1')
    expect(sent[0].relatedId).toBe('t1')
    expect(sent[0].relatedType).toBe('ticket')
    expect(sent[0].subject).toBe('Agente Solmios respondió tu ticket «No anda el check-in»')
    expect(sent[0].html).toContain('/panel/support?ticket=t1')
    // el socket recibe el ticket enriquecido
    expect(socketTicket!.requester?.email).toBe('rosa@hotel.com')
  })

  it('merchant escribe → NO enqueue', async () => {
    const svc = makeService(baseTicket())
    const { port, sent } = makeEmailPort()
    svc.setEmailDeps(port)
    await svc.addMessage('t1', 'Sigue sin andar', merchant)
    expect(sent).toHaveLength(0)
  })

  it('hotel sin email configurado → NO enqueue', async () => {
    const svc = makeService(baseTicket())
    const { port, sent } = makeEmailPort({ configured: false })
    svc.setEmailDeps(port)
    await svc.addMessage('t1', 'Ya lo estamos viendo', platformAdmin)
    expect(sent).toHaveLength(0)
  })

  it('sin setEmailDeps → addMessage funciona igual', async () => {
    const svc = makeService(baseTicket())
    const result = await svc.addMessage('t1', 'Ya lo estamos viendo', platformAdmin)
    expect(result.messages).toHaveLength(1)
  })

  it('enqueue lanza → addMessage igual devuelve el ticket con el mensaje (no propaga)', async () => {
    const svc = makeService(baseTicket())
    const { port } = makeEmailPort({ fail: true })
    svc.setEmailDeps(port)
    const result = await svc.addMessage('t1', 'Ya lo estamos viendo', platformAdmin)
    expect(result.messages).toHaveLength(1)
    expect(result.messages?.[0].message).toBe('Ya lo estamos viendo')
  })

  it('emailRequester: sin requester.email → no consulta isConfigured ni encola', async () => {
    let configuredCalls = 0
    const port: TicketEmailPort = { isConfigured: async () => { configuredCalls++; return true }, enqueue: async () => 'x' }
    await emailRequester(port, baseTicket(), { title: 't', message: 'm', link: '/x' }, log)
    expect(configuredCalls).toBe(0)
  })
})

describe('shared/usecases/notify-ticket', () => {
  it('buildTicketStatusNotice con nombre vacío → "Soporte marcó tu ticket …"', () => {
    const notice = buildTicketStatusNotice(baseTicket(), '', 'in_progress')
    expect(notice.title).toBe('Soporte marcó tu ticket «No anda el check-in» como En progreso')
    expect(notice.link).toBe('/panel/support?ticket=t1')
  })

  it('buildTicketMessageNotice usa el nombre del agente y el link al panel', () => {
    const notice = buildTicketMessageNotice(baseTicket(), 'Agente Solmios', 'Hola')
    expect(notice.title).toBe('Agente Solmios respondió tu ticket «No anda el check-in»')
    expect(notice.message).toBe('Hola')
    expect(notice.link).toBe('/panel/support?ticket=t1')
  })

  it('notifyTicketMessage: mensaje de hotel → no crea; de soporte → crea type support broadcast al hotel', async () => {
    const created: Array<Record<string, unknown>> = []
    const port = { create: async (dto: Record<string, unknown>) => { created.push(dto); return dto } }
    const hotelMsg = { authorName: 'Rosa', authorKind: 'hotel' as const, message: 'x' }
    const supportMsg = { authorName: 'Agente Solmios', authorKind: 'support' as const, message: 'Lo vemos' }
    await notifyTicketMessage(port, baseTicket(), hotelMsg)
    expect(created).toHaveLength(0)
    await notifyTicketMessage(port, baseTicket(), supportMsg)
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('support')
    expect(created[0].hotelId).toBe('h1')
    expect(created[0].userId).toBeUndefined()
    expect((created[0].metadata as Record<string, unknown>).link).toBe('/panel/support?ticket=t1')
    expect((created[0].metadata as Record<string, unknown>).agentName).toBe('Agente Solmios')
  })

  it('notifyTicketStatus: crea la notificación con el estado legible', async () => {
    const created: Array<Record<string, unknown>> = []
    const port = { create: async (dto: Record<string, unknown>) => { created.push(dto); return dto } }
    await notifyTicketStatus(port, baseTicket(), { from: 'open', to: 'resolved', actor: { id: 'agent-1', name: 'Agente Solmios' } })
    expect(created).toHaveLength(1)
    expect(created[0].title).toBe('Agente Solmios marcó tu ticket «No anda el check-in» como Resuelto')
    expect((created[0].metadata as Record<string, unknown>).ticketId).toBe('t1')
  })

  it('notifyTicketStatus NO traga errores (lo hace el connector)', async () => {
    const port = { create: async () => { throw new Error('db down') } }
    await expect(notifyTicketStatus(port, baseTicket(), { to: 'closed', actor: { id: 'a', name: 'A' } })).rejects.toThrow('db down')
  })
})
