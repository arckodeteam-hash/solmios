// reservas/tests/create-guest-email.test.ts — MR-08 (#273): un huésped = una ficha desde el panel.
//
// `POST /api/reservas` puede traer `guestEmail` (+ `guestName`/`guestPhone`) en lugar de `guestId`.
// El usecase resuelve la ficha con el helper compartido `findOrCreateGuest` (email normalizado
// lower/trim, luego teléfono E.164): si existe se reusa su id, si no se crea UNA. Los tres campos
// nunca se persisten en Reservations, y con `guestId` presente se ignoran.

import { describe, it, expect } from 'bun:test'
import { createReservation } from '../usecases/crud'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopSockets = {} as any
const HOTEL = 'h1'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

/** repo de reservas: habitación siempre libre; guarda lo que recibe `create` para inspeccionarlo. */
function resRepo() {
  const created: any[] = []
  return {
    created,
    findMany: async () => [],
    create: async (data: any) => { created.push(data); return { id: 'r-new', ...data } },
  } as any
}

/** repo de Guests en memoria con contadores de findOne/create. */
function guestRepo(rows: any[] = []) {
  const state = { rows: [...rows], creates: 0, findOnes: 0 }
  const matches = (g: any, f: Record<string, any>) => Object.entries(f).every(([k, v]) => g[k] === v)
  return {
    state,
    findOne: async (f: Record<string, any>) => { state.findOnes++; return state.rows.find((g) => matches(g, f)) ?? null },
    findMany: async (f: Record<string, any>) => state.rows.filter((g) => matches(g, f)),
    create: async (data: any) => { state.creates++; const g = { id: data.id ?? `g-${state.creates}`, ...data }; state.rows.push(g); return g },
    update: async (id: string, data: any) => { const g = state.rows.find((r) => r.id === id); Object.assign(g, data); return g },
  } as any
}

const baseDto = (over: Record<string, any> = {}) => ({
  hotelId: HOTEL, roomId: 'room-1', checkIn: '2026-07-20', checkOut: '2026-07-22',
  status: 'confirmed', totalAmount: 200, ...over,
}) as any

const run = (repo: any, guests: any, dto: any) =>
  createReservation(repo, undefined, noopLogger, noopCache, noopSockets, {}, dto, user, undefined, guests)

describe('createReservation — guestEmail sin guestId (MR-08, #273)', () => {
  it('(a) email existente con otra mayúscula/espacios → reusa la ficha, sin create en Guests', async () => {
    const repo = resRepo()
    const guests = guestRepo([{ id: 'g-ana', hotelId: HOTEL, name: 'Ana', email: 'ana@mail.com', phone: '' }])
    const item = await run(repo, guests, baseDto({ guestEmail: 'Ana@Mail.com ', guestName: 'Ana Pérez' }))
    expect(item.guestId).toBe('g-ana')
    expect(repo.created[0].guestId).toBe('g-ana')
    expect(guests.state.creates).toBe(0)
    expect(guests.state.rows).toHaveLength(1)
  })

  it('(b) email nuevo → 1 create en Guests y la reserva apunta a ese id', async () => {
    const repo = resRepo()
    const guests = guestRepo([{ id: 'g-otro', hotelId: HOTEL, name: 'Otro', email: 'otro@mail.com', phone: '' }])
    const item = await run(repo, guests, baseDto({ guestEmail: 'nuevo@mail.com', guestName: 'Nuevo', guestPhone: '809-555-0000' }))
    expect(guests.state.creates).toBe(1)
    const created = guests.state.rows.find((g: any) => g.email === 'nuevo@mail.com')
    expect(created).toBeDefined()
    expect(created.hotelId).toBe(HOTEL)
    expect(created.name).toBe('Nuevo')
    expect(item.guestId).toBe(created.id)
    expect(repo.created[0].guestId).toBe(created.id)
  })

  it('(c) guestEmail/guestName/guestPhone NO se persisten en Reservations', async () => {
    const repo = resRepo()
    const guests = guestRepo()
    await run(repo, guests, baseDto({ guestEmail: 'nuevo@mail.com', guestName: 'Nuevo', guestPhone: '8095550000' }))
    expect(repo.created).toHaveLength(1)
    const row = repo.created[0]
    expect(row).not.toHaveProperty('guestEmail')
    expect(row).not.toHaveProperty('guestName')
    expect(row).not.toHaveProperty('guestPhone')
    expect(typeof row.guestId).toBe('string')
    expect(row.hotelId).toBe(HOTEL)
    expect(row.totalAmount).toBe(200)
  })

  it('(d) con guestId presente, guestEmail se ignora (no busca por email ni crea)', async () => {
    const repo = resRepo()
    const guests = guestRepo([
      { id: 'g-ana', hotelId: HOTEL, name: 'Ana', email: 'ana@mail.com', phone: '' },
      { id: 'g-bob', hotelId: HOTEL, name: 'Bob', email: 'bob@mail.com', phone: '' },
    ])
    const item = await run(repo, guests, baseDto({ guestId: 'g-bob', guestEmail: 'ana@mail.com' }))
    expect(item.guestId).toBe('g-bob')
    // Solo la validación IDOR `findOne({ id })`: ninguna búsqueda por email.
    expect(guests.state.findOnes).toBe(1)
    expect(guests.state.creates).toBe(0)
    expect(repo.created[0]).not.toHaveProperty('guestEmail')
  })

  it('sin guestRepo cableado no resuelve (retrocompatible): la reserva sale sin guestId', async () => {
    const repo = resRepo()
    const item = await run(repo, undefined, baseDto({ guestEmail: 'nuevo@mail.com' }))
    expect(item.guestId).toBeUndefined()
    expect(repo.created[0]).not.toHaveProperty('guestEmail')
  })
})
