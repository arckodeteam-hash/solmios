// add-message.test.ts — REQ-SOP-02/03: lógica pura de buildAddMessage.
import { describe, it, expect } from 'bun:test'
import { buildAddMessage } from '../usecases/add-message'
import type { TicketsDTO } from '../types'

const baseTicket = (overrides: Partial<TicketsDTO> = {}): TicketsDTO => ({
  id: 't1', hotelId: 'h1', userId: 'u1', subject: 'Issue', status: 'open',
  createdAt: '', updatedAt: '', messages: [], ...overrides,
})

describe('buildAddMessage', () => {
  it('el autor sale de `actor` — no hay forma de pasar authorKind/authorName desde el body', async () => {
    const ticket = baseTicket()
    const { message } = buildAddMessage(ticket, 'Hola', { id: 'agent-1', name: 'Agente Real', role: 'super_admin', userType: 'admin' })
    expect(message.authorKind).toBe('support')
    expect(message.authorName).toBe('Agente Real')
    expect(message.authorId).toBe('agent-1')
  })

  it('hotel escribiendo → authorKind hotel', () => {
    const ticket = baseTicket()
    const { message } = buildAddMessage(ticket, 'Hola', { id: 'u1', name: 'Huésped Hotel', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })
    expect(message.authorKind).toBe('hotel')
  })

  it('hotel A sobre ticket de hotel B → ForbiddenError (403)', () => {
    const ticket = baseTicket({ hotelId: 'hB' })
    expect(() => buildAddMessage(ticket, 'Hola', { id: 'u1', name: 'X', role: 'hotel_admin', hotelId: 'hA', userType: 'merchant' }))
      .toThrow(expect.objectContaining({ httpStatus: 403 }))
  })

  it('super_admin puede escribir en el ticket de cualquier hotel', () => {
    const ticket = baseTicket({ hotelId: 'hB' })
    const { message } = buildAddMessage(ticket, 'Hola', { id: 'agent-1', name: 'Agente', role: 'super_admin', userType: 'admin' })
    expect(message.authorId).toBe('agent-1')
  })

  it('ticket closed → ConflictError (409)', () => {
    const ticket = baseTicket({ status: 'closed' })
    expect(() => buildAddMessage(ticket, 'Hola', { id: 'u1', name: 'X', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' }))
      .toThrow(expect.objectContaining({ httpStatus: 409 }))
  })

  it('message vacío (solo espacios) → ValidationError (400)', () => {
    const ticket = baseTicket()
    expect(() => buildAddMessage(ticket, '   ', { id: 'u1', name: 'X', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' }))
      .toThrow(expect.objectContaining({ httpStatus: 400 }))
  })

  it('message > 4000 caracteres → ValidationError (400)', () => {
    const ticket = baseTicket()
    const long = 'a'.repeat(4001)
    expect(() => buildAddMessage(ticket, long, { id: 'u1', name: 'X', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' }))
      .toThrow(expect.objectContaining({ httpStatus: 400 }))
  })

  it('message se guarda trimeado', () => {
    const ticket = baseTicket()
    const { message } = buildAddMessage(ticket, '  Hola con espacios  ', { id: 'u1', name: 'X', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })
    expect(message.message).toBe('Hola con espacios')
  })

  it('primer mensaje de un agente sobre ticket open sin agente → auto-asigna y pasa a in_progress', () => {
    const ticket = baseTicket({ status: 'open', assignedTo: undefined })
    const { patch } = buildAddMessage(ticket, 'Ya lo reviso', { id: 'agent-1', name: 'Agente', role: 'super_admin', userType: 'admin' })
    expect(patch.assignedTo).toBe('agent-1')
    expect(patch.status).toBe('in_progress')
  })

  it('segundo agente no roba la asignación', () => {
    const ticket = baseTicket({ status: 'in_progress', assignedTo: 'agent-1' })
    const { patch } = buildAddMessage(ticket, 'Yo tomo el caso', { id: 'agent-2', name: 'Otro Agente', role: 'super_admin', userType: 'admin' })
    expect(patch.assignedTo).toBeUndefined()
    expect(patch.status).toBeUndefined()
  })

  it('mensaje de un hotel no auto-asigna', () => {
    const ticket = baseTicket({ status: 'open', assignedTo: undefined })
    const { patch } = buildAddMessage(ticket, 'Sigo esperando', { id: 'u1', name: 'Hotel', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })
    expect(patch.assignedTo).toBeUndefined()
    expect(patch.status).toBeUndefined()
  })

  it('el nuevo mensaje se agrega preservando los mensajes existentes (normalizados)', () => {
    const ticket = baseTicket({
      messages: [{ author: 'Soporte Arckode', date: '2026-01-01', message: 'Vieja respuesta' } as any],
    })
    const { patch } = buildAddMessage(ticket, 'Nuevo mensaje', { id: 'u1', name: 'Hotel', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })
    expect(patch.messages).toHaveLength(2)
    expect(patch.messages?.[0].authorName).toBe('Soporte Arckode')
    expect(patch.messages?.[0].authorKind).toBe('support')
    expect(patch.messages?.[1].message).toBe('Nuevo mensaje')
  })
})
