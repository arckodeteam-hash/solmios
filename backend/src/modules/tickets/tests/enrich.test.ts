// tickets/tests/enrich.test.ts — REQ-SOP-01/03: una consulta a users y una a hotels por página.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { enrichTickets } from '../usecases/enrich'
import type { TicketsDTO } from '../types'

function makeCountedRepo<T extends object>(data: T[]) {
  let calls = 0
  const repo = { findMany: async () => { calls++; return data } } as unknown as RepositoryAdapter<T>
  return { repo, calls: () => calls }
}

describe('enrichTickets', () => {
  it('20 tickets / 7 hoteles / 12 usuarios → una sola consulta a users y a hotels', async () => {
    const hotels = Array.from({ length: 7 }, (_, i) => ({ id: `h${i + 1}`, name: `Hotel ${i + 1}` }))
    const users = Array.from({ length: 12 }, (_, i) => ({
      id: `u${i + 1}`, name: `User ${i + 1}`, email: `u${i + 1}@x.com`, role: 'hotel_admin', active: 1,
    }))
    const tickets: TicketsDTO[] = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i + 1}`, hotelId: `h${(i % 7) + 1}`, userId: `u${(i % 12) + 1}`,
      subject: `Issue ${i + 1}`, createdAt: '', updatedAt: '',
    }))

    const userRepo = makeCountedRepo(users)
    const hotelRepo = makeCountedRepo(hotels)
    const result = await enrichTickets(tickets, { userRepo: userRepo.repo, hotelRepo: hotelRepo.repo })

    expect(result).toHaveLength(20)
    expect(userRepo.calls()).toBe(1)
    expect(hotelRepo.calls()).toBe(1)
    expect(result[0].requester?.name).toBe('User 1')
    expect(result[0].hotel?.name).toBe('Hotel 1')
  })

  it('userId inexistente → requester.name vacío y la página se completa sin error', async () => {
    const users = [{ id: 'u1', name: 'Real User', email: 'r@x.com', role: 'hotel_admin', active: 1 }]
    const hotels = [{ id: 'h1', name: 'Hotel 1' }]
    const tickets: TicketsDTO[] = [
      { id: 't1', hotelId: 'h1', userId: 'ghost', subject: 'Issue', createdAt: '', updatedAt: '' },
      { id: 't2', hotelId: 'h1', userId: 'u1', subject: 'Issue 2', createdAt: '', updatedAt: '' },
    ]
    const userRepo = makeCountedRepo(users)
    const hotelRepo = makeCountedRepo(hotels)
    const result = await enrichTickets(tickets, { userRepo: userRepo.repo, hotelRepo: hotelRepo.repo })

    expect(result).toHaveLength(2)
    expect(result[0].requester?.name).toBe('')
    expect(result[0].requester?.active).toBe(false)
    expect(result[1].requester?.name).toBe('Real User')
  })

  it('assignedTo vacío → assignee null; assignedTo inexistente → name vacío sin error', async () => {
    const users = [{ id: 'u1', name: 'Agent', email: 'a@x.com', role: 'super_admin', active: 1 }]
    const hotels = [{ id: 'h1', name: 'Hotel 1' }]
    const tickets: TicketsDTO[] = [
      { id: 't1', hotelId: 'h1', userId: 'u1', subject: 'Issue', createdAt: '', updatedAt: '' },
      { id: 't2', hotelId: 'h1', userId: 'u1', subject: 'Issue 2', assignedTo: 'u1', createdAt: '', updatedAt: '' },
      { id: 't3', hotelId: 'h1', userId: 'u1', subject: 'Issue 3', assignedTo: 'ghost', createdAt: '', updatedAt: '' },
    ]
    const userRepo = makeCountedRepo(users)
    const hotelRepo = makeCountedRepo(hotels)
    const result = await enrichTickets(tickets, { userRepo: userRepo.repo, hotelRepo: hotelRepo.repo })

    expect(result[0].assignee).toBeNull()
    expect(result[1].assignee).toEqual({ id: 'u1', name: 'Agent' })
    expect(result[2].assignee).toEqual({ id: 'ghost', name: '' })
  })

  it('hotelId inexistente → hotel.name vacío sin error', async () => {
    const userRepo = makeCountedRepo([])
    const hotelRepo = makeCountedRepo([])
    const tickets: TicketsDTO[] = [{ id: 't1', hotelId: 'ghost-hotel', userId: 'ghost-user', subject: 'Issue', createdAt: '', updatedAt: '' }]
    const result = await enrichTickets(tickets, { userRepo: userRepo.repo, hotelRepo: hotelRepo.repo })
    expect(result[0].hotel).toEqual({ id: 'ghost-hotel', name: '' })
  })

  it('página vacía no dispara ninguna consulta', async () => {
    const userRepo = makeCountedRepo([])
    const hotelRepo = makeCountedRepo([])
    const result = await enrichTickets([], { userRepo: userRepo.repo, hotelRepo: hotelRepo.repo })
    expect(result).toEqual([])
    expect(userRepo.calls()).toBe(0)
    expect(hotelRepo.calls()).toBe(0)
  })
})
