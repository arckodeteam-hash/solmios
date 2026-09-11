// sse-ticket-auth.test.ts — #211: el ticket de conexión (SSE) no es un access token y se usa una vez.
import { describe, it, expect } from 'bun:test'
import { AuthError } from 'arckode-framework'
import { makeAuth } from './route-permission-helpers'
import { sseTicketAuth, UsedTickets } from '../sse-ticket-auth'

const user = { id: 'u1', role: 'kitchen', hotelId: 'h1', userType: 'merchant' }

describe('HotelAuth.createTicket / verifyTicket', () => {
  it('el ticket lleva type ticket, scope y jti; verifyTicket lo acepta solo para su scope', () => {
    const auth = makeAuth()
    const { ticket, jti } = auth.createTicket(user, 'restaurant:events', '60s')
    expect(jti).toBeTruthy()
    expect(JSON.parse(ticket)).toMatchObject({ type: 'ticket', scope: 'restaurant:events', jti, hotelId: 'h1', role: 'kitchen' })
    expect(auth.verifyTicket(ticket, 'restaurant:events')).toMatchObject({ id: 'u1', role: 'kitchen', hotelId: 'h1', jti })
    expect(() => auth.verifyTicket(ticket, 'otro')).toThrow(AuthError)
  })

  it('verifyToken rechaza un ticket (no autentica ninguna ruta normal) y verifyTicket rechaza un access token', () => {
    const auth = makeAuth()
    const { ticket } = auth.createTicket(user, 'restaurant:events', '60s')
    expect(() => auth.verifyToken(ticket)).toThrow(AuthError)
    const access = auth.createToken(user)
    expect(() => auth.verifyTicket(access, 'restaurant:events')).toThrow(AuthError)
    // Un refresh token tampoco (firmado con otro secreto, pero además type distinto).
    expect(() => auth.verifyTicket(auth.createRefreshToken(user), 'restaurant:events')).toThrow(AuthError)
  })

  it('cada ticket tiene un jti distinto', () => {
    const auth = makeAuth()
    expect(auth.createTicket(user, 's', '60s').jti).not.toBe(auth.createTicket(user, 's', '60s').jti)
  })
})

describe('UsedTickets', () => {
  it('consume una vez; la segunda dentro del TTL devuelve false; vencido, se olvida', () => {
    let t = 1000
    const used = new UsedTickets(60_000, () => t)
    expect(used.consume('a')).toBe(true)
    expect(used.consume('a')).toBe(false)
    t += 59_000
    expect(used.consume('a')).toBe(false)
    t += 2_000
    expect(used.consume('a')).toBe(true)   // el jti venció (y el JWT ya venció también): no se acumula para siempre
    expect(used.size()).toBe(1)
  })
})

describe('sseTicketAuth', () => {
  function run(headers: Record<string, string>, query: Record<string, string>, used?: UsedTickets) {
    const auth = makeAuth()
    const mw = sseTicketAuth(auth, { scope: 'restaurant:events', ttlMs: 60_000, used })
    const req: any = { headers, query }
    return { auth, req, call: () => mw(req, async () => ({ status: 200, body: { user: req.user } })) }
  }

  it('sin ticket → AuthError', async () => {
    const { call } = run({}, {})
    await expect(call()).rejects.toThrow(AuthError)
  })

  it('con ticket válido por query deja req.user como authenticate() (sin el jti)', async () => {
    const auth = makeAuth()
    const used = new UsedTickets(60_000)
    const mw = sseTicketAuth(auth, { scope: 'restaurant:events', ttlMs: 60_000, used })
    const { ticket } = auth.createTicket(user, 'restaurant:events', '60s')
    const req: any = { headers: {}, query: { ticket } }
    const res = await mw(req, async () => ({ status: 200 }))
    expect(res.status).toBe(200)
    expect(req.user).toEqual({ id: 'u1', role: 'kitchen', hotelId: 'h1', userType: 'merchant', impersonatedBy: undefined })
    expect(req.user.jti).toBeUndefined()
    // Segunda vez, mismo ticket → AuthError.
    await expect(mw({ headers: {}, query: { ticket } } as any, async () => ({ status: 200 }))).rejects.toThrow('Ticket already used')
  })

  it('un access token en la query o el header → AuthError', async () => {
    const auth = makeAuth()
    const mw = sseTicketAuth(auth, { scope: 'restaurant:events', ttlMs: 60_000 })
    const access = auth.createToken(user)
    await expect(mw({ headers: {}, query: { ticket: access } } as any, async () => ({ status: 200 }))).rejects.toThrow(AuthError)
    await expect(mw({ headers: { authorization: `Bearer ${access}` }, query: {} } as any, async () => ({ status: 200 }))).rejects.toThrow(AuthError)
  })
})
