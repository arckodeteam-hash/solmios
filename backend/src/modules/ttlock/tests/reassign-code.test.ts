// modules/ttlock/tests/reassign-code.test.ts — #258 (REQ-HAC-03, criterio 3.3): reasignar la
// habitación de una reserva con código vigente REEMPLAZA el PIN. `generateCode` crea el código en
// la cerradura de la habitación NUEVA y `keepSingleCode` revoca el anterior (PIN físico incluido,
// vía /v3/keyboardPwd/delete). Resultado: un solo código activo, el de la cerradura correcta, y el
// viejo en 'revoked'. Se usa el TtlockService real con repos fake y `fetch` pisado.

import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { TtlockService } from '../service'
import { TtlockQueries } from '../usecases/ttlock-queries'

const log = silentLogger()

/** Fixture: reserva res1 ya mudada a rm2 (el usecase de reservas la actualiza ANTES de emitir onRoomAssigned). */
function makeWorld(opts: { reservationRoomId?: string; lock2Status?: string } = {}) {
  const reservation = { id: 'res1', hotelId: 'h1', roomId: opts.reservationRoomId ?? 'rm2', checkIn: '2026-06-01', checkOut: '2026-06-03' }
  const locks = [
    { id: 'l1', hotelId: 'h1', ttlockLockId: '111', name: 'Puerta 101', roomId: 'rm1', status: 'online' },
    { id: 'l2', hotelId: 'h1', ttlockLockId: '222', name: 'Puerta 102', roomId: 'rm2', status: opts.lock2Status ?? 'online' },
  ]
  // Código vigente de la habitación VIEJA (rm1 / l1), generado al pagar la seña.
  const codes: any[] = [
    { id: 'c-old', lockId: 'l1', hotelId: 'h1', reservationId: 'res1', code: '445566', status: 'active', ttlockKeyboardPwdId: '9001', createdAt: '2026-05-01T00:00:00Z' },
  ]
  const match = (row: any, filter: any) => Object.entries(filter || {}).every(([k, v]) => row[k] === v)
  let seq = 0
  const orm = {
    findMany: async (table: string, filter: any) => {
      if (table === 'Configuration') return [{ id: 'cfg1', hotelId: 'h1', key: 'ttlock_config', value: JSON.stringify({ clientId: 'test', clientSecret: 'sec', accessToken: 'tok', region: 'eu' }) }]
      if (table === 'LockDevices') return locks.filter((l) => match(l, filter))
      if (table === 'LockCodes') return codes.filter((c) => match(c, filter))
      if (table === 'Reservations') return [reservation].filter((r) => match(r, filter))
      if (table === 'Hotels') return [{ id: 'h1', timezone: 'UTC' }]
      return []
    },
    findById: async (table: string, id: string) => {
      if (table === 'LockDevices') return locks.find((l) => l.id === id) || null
      if (table === 'LockCodes') return codes.find((c) => c.id === id) || null
      if (table === 'Reservations') return reservation.id === id ? reservation : null
      if (table === 'Hotels') return { id: 'h1', timezone: 'UTC' }
      return null
    },
    create: async (table: string, data: any) => {
      const row = { id: `${table}-${++seq}`, createdAt: new Date().toISOString(), ...data }
      if (table === 'LockCodes') codes.push(row)
      return row
    },
    update: async (table: string, id: string, data: any) => {
      if (table === 'LockCodes') { const c = codes.find((x) => x.id === id); if (c) Object.assign(c, data) }
    },
    delete: async () => {},
  }
  return { orm, codes, locks, reservation }
}

function repo(orm: any, table: string) {
  return {
    findMany: async (filter: any) => orm.findMany(table, filter),
    findById: async (id: string) => orm.findById(table, id),
    findOne: async (filter: any) => { const rows = await orm.findMany(table, filter); return rows[0] || null },
    create: async (data: any) => orm.create(table, data),
    update: async (id: string, data: any) => orm.update(table, id, data),
    delete: async (id: string) => orm.delete(table, id),
    count: async (filter?: any) => { const rows = await orm.findMany(table, filter); return rows.length },
    paginate: async (filter?: any) => { const rows = await orm.findMany(table, filter); return { data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 } },
  }
}

/** fetch fake de Sciener: registra cada llamada y responde OK; `keyboardPwdId` incremental en el add. */
function fakeSciener(onCall?: (url: string, body: string) => Response | undefined) {
  const calls: Array<{ url: string; body: string }> = []
  let nextPwdId = 5000
  const fetchFn = (async (url: any, init: any) => {
    const u = String(url)
    const body = String(init?.body ?? '')
    calls.push({ url: u, body })
    const custom = onCall?.(u, body)
    if (custom) return custom
    if (u.includes('/v3/keyboardPwd/add')) return new Response(JSON.stringify({ errcode: 0, keyboardPwdId: ++nextPwdId }))
    return new Response(JSON.stringify({ errcode: 0 }))
  }) as any
  return { fetchFn, calls }
}

async function withFetch<T>(fetchFn: any, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch
  globalThis.fetch = fetchFn
  try { return await fn() } finally { globalThis.fetch = realFetch }
}

function makeService(orm: any) {
  const queries = new TtlockQueries(orm)
  return new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
}

describe('TTLock — reasignar habitación reemplaza el código (#258 / 3.3)', () => {
  it('reserva con código activo en rm1 → generateCode tras mudarla a rm2: queda 1 activo (en l2) y el anterior revoked', async () => {
    const { orm, codes } = makeWorld()
    const { fetchFn, calls } = fakeSciener()
    const created = await withFetch(fetchFn, () => makeService(orm).generateCode('h1', 'res1'))

    // El nuevo código vive en la cerradura de la habitación NUEVA, con la ventana de la estadía.
    expect(created.status).toBe('active')
    expect(created.lockId).toBe('l2')
    expect(created.reservationId).toBe('res1')
    expect(String(created.ttlockKeyboardPwdId)).toBe('5001')
    expect(created.code).not.toBe('445566')

    // Persistencia: un solo código vigente para la reserva, el anterior pasó a 'revoked'.
    const vigentes = codes.filter((c) => c.reservationId === 'res1' && (c.status === 'active' || c.status === 'pending'))
    expect(vigentes).toHaveLength(1)
    expect(vigentes[0].id).toBe(created.id)
    expect(codes.find((c) => c.id === 'c-old')?.status).toBe('revoked')

    // Hardware: el PIN nuevo se creó en la cerradura 222 y el viejo (9001) se borró de la 111.
    const add = calls.find((c) => c.url.includes('/v3/keyboardPwd/add'))
    expect(add?.body).toContain('lockId=222')
    const del = calls.find((c) => c.url.includes('/v3/keyboardPwd/delete'))
    expect(del?.body).toContain('lockId=111')
    expect(del?.body).toContain('keyboardPwdId=9001')
  })

  it('reasignar dos veces seguidas sigue dejando UN solo código vigente', async () => {
    const { orm, codes, reservation } = makeWorld()
    const { fetchFn } = fakeSciener()
    await withFetch(fetchFn, async () => {
      const svc = makeService(orm)
      const first = await svc.generateCode('h1', 'res1')      // rm1 → rm2
      reservation.roomId = 'rm1'
      const second = await svc.generateCode('h1', 'res1')     // rm2 → rm1 (vuelve)
      const vigentes = codes.filter((c) => c.reservationId === 'res1' && (c.status === 'active' || c.status === 'pending'))
      expect(vigentes.map((c) => c.id)).toEqual([second.id])
      expect(second.lockId).toBe('l1')
      expect(codes.find((c) => c.id === first.id)?.status).toBe('revoked')
      expect(codes.find((c) => c.id === 'c-old')?.status).toBe('revoked')
    })
  })

  it('si la cerradura nueva rechaza el PIN, el código anterior sigue activo (nunca se queda sin código)', async () => {
    const { orm, codes } = makeWorld()
    const { fetchFn, calls } = fakeSciener((url) =>
      url.includes('/v3/keyboardPwd/add') ? new Response(JSON.stringify({ errcode: -3, errmsg: 'lock unreachable' })) : undefined,
    )
    await withFetch(fetchFn, async () => {
      await expect(makeService(orm).generateCode('h1', 'res1')).rejects.toThrow()
    })
    expect(codes.find((c) => c.id === 'c-old')?.status).toBe('active')
    expect(codes.filter((c) => c.reservationId === 'res1')).toHaveLength(1)
    expect(calls.some((c) => c.url.includes('/v3/keyboardPwd/delete'))).toBe(false)
  })

  it('cerradura nueva OFFLINE: el código nuevo queda pending y el viejo igual se revoca (uno solo vigente)', async () => {
    const { orm, codes } = makeWorld({ lock2Status: 'offline' })
    const { fetchFn, calls } = fakeSciener()
    const created = await withFetch(fetchFn, () => makeService(orm).generateCode('h1', 'res1'))
    expect(created.status).toBe('pending')
    expect(created.lockId).toBe('l2')
    expect(codes.find((c) => c.id === 'c-old')?.status).toBe('revoked')
    const vigentes = codes.filter((c) => c.reservationId === 'res1' && (c.status === 'active' || c.status === 'pending'))
    expect(vigentes).toHaveLength(1)
    // Sin PIN físico en la nueva (offline) pero sí se borró el de la vieja.
    expect(calls.some((c) => c.url.includes('/v3/keyboardPwd/add'))).toBe(false)
    expect(calls.some((c) => c.url.includes('/v3/keyboardPwd/delete') && c.body.includes('keyboardPwdId=9001'))).toBe(true)
  })

  it('generateCodeIfAbsent (primera asignación) NO regenera si ya hay un código vigente', async () => {
    const { orm, codes } = makeWorld({ reservationRoomId: 'rm1' })
    const { fetchFn, calls } = fakeSciener()
    const r = await withFetch(fetchFn, () => makeService(orm).generateCodeIfAbsent('h1', 'res1'))
    expect(r.skipped).toBe(true)
    expect(codes).toHaveLength(1)
    expect(calls).toHaveLength(0)
  })
})
