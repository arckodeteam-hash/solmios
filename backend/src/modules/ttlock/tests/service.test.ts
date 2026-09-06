import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { TtlockService } from '../service'
import { TtlockQueries } from '../usecases/ttlock-queries'

const log = silentLogger()

function makeOrm(overrides: Partial<Record<string, any>> = {}) {
  return {
    findMany: async (table: string, _filter: any) => {
      if (table === 'Configuration') return [{ id: 'cfg1', value: JSON.stringify({ clientId: 'test', clientSecret: 'sec', accessToken: 'tok', region: 'eu' }) }]
      if (table === 'LockDevices') return [{ id: 'l1', hotelId: 'h1', ttlockLockId: '123', name: 'Door 1', roomId: 'rm1', status: 'online' }]
      if (table === 'LockCodes') return [{ id: 'c1', lockId: 'l1', hotelId: 'h1', code: '1234', status: 'active' }]
      if (table === 'Rooms') return [{ id: 'rm1', number: '101' }]
      return []
    },
    findById: async (table: string, _id: string) => {
      if (table === 'Reservations') return { id: 'res1', hotelId: 'h1', roomId: 'rm1', checkIn: '2026-06-01', checkOut: '2026-06-03' }
      if (table === 'LockDevices') return { id: 'l1', hotelId: 'h1', name: 'Door 1', roomId: 'rm1' }
      if (table === 'LockCodes') return { id: 'c1', lockId: 'l1', hotelId: 'h1', code: '1234', status: 'active' }
      return null
    },
    create: async (_table: string, data: any) => data,
    update: async (_table: string, _id: string, _data: any) => {},
    delete: async (_table: string, _id: string) => {},
    ...overrides,
  }
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
    paginate: async (filter?: any, _options?: any) => { const rows = await orm.findMany(table, filter); return { data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 } },
  }
}

describe('TtlockService', () => {
  describe('getConfig', () => {
    it('returns connection status', async () => {
      const orm = makeOrm()
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const result = await svc.getConfig('h1')
      expect(result.configured).toBe(true)
      expect(result.connected).toBe(true)
    })
  })

  describe('listLocks', () => {
    it('returns locks with room numbers', async () => {
      const orm = makeOrm()
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const result = await svc.listLocks('h1')
      expect(result).toHaveLength(1)
      expect(result[0].roomNumber).toBe('101')
    })
  })

  describe('updateLock', () => {
    it('updates lock fields', async () => {
      let lockData = { id: 'l1', name: 'Door 1', roomId: 'rm1', hotelId: 'h1' }
      const orm = makeOrm({
        findById: async (table: string, _id: string) => {
          if (table === 'LockDevices') return lockData
          if (table === 'Reservations') return { id: 'res1', hotelId: 'h1', roomId: 'rm1', checkIn: '2026-06-01', checkOut: '2026-06-03' }
          return null
        },
        update: async (_table: string, _id: string, data: any) => { lockData = { ...lockData, ...data } },
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const result = await svc.updateLock('l1', { name: 'Updated Door' })
      expect(result.name).toBe('Updated Door')
    })
  })

  describe('revokeCode', () => {
    it('marks code as revoked', async () => {
      let updated = false
      const orm = makeOrm({ update: async () => { updated = true } })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      await svc.revokeCode('c1', 'h1')
      expect(updated).toBe(true)
    })

    it('borra el PIN de la cerradura FÍSICA, no solo la fila', async () => {
      const calls: string[] = []
      const orm = makeOrm({
        findById: async (table: string, _id: string) => {
          if (table === 'LockCodes') return { id: 'c1', lockId: 'l1', hotelId: 'h1', code: '1234', status: 'active', ttlockKeyboardPwdId: '999' }
          if (table === 'LockDevices') return { id: 'l1', hotelId: 'h1', ttlockLockId: '123' }
          return null
        },
        update: async () => { calls.push('db-update') },
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async (url: any, init: any) => {
        calls.push(`fetch:${String(url)}`)
        calls.push(`body:${String(init?.body)}`)
        return new Response(JSON.stringify({ errcode: 0 }))
      }) as any
      try {
        const queries = new TtlockQueries(orm)
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
        await svc.revokeCode('c1', 'h1')
      } finally {
        globalThis.fetch = realFetch
      }
      expect(calls.some(c => c.includes('/v3/keyboardPwd/delete'))).toBe(true)
      expect(calls.some(c => c.includes('keyboardPwdId=999'))).toBe(true)
      expect(calls).toContain('db-update')
    })

    it('NO marca revocado si la cerradura rechaza el borrado', async () => {
      let updated = false
      const orm = makeOrm({
        findById: async (table: string, _id: string) => {
          if (table === 'LockCodes') return { id: 'c1', lockId: 'l1', hotelId: 'h1', status: 'active', ttlockKeyboardPwdId: '999' }
          if (table === 'LockDevices') return { id: 'l1', hotelId: 'h1', ttlockLockId: '123' }
          return null
        },
        update: async () => { updated = true },
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ errcode: 10003, errmsg: 'invalid token' }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
        await expect(svc.revokeCode('c1', 'h1')).rejects.toThrow(/TTLock/)
      } finally {
        globalThis.fetch = realFetch
      }
      // Si el PIN sigue vivo en la puerta, la fila no puede decir "revocado".
      expect(updated).toBe(false)
    })
  })

  describe('expireCodesByReservation — checkout best-effort', () => {
    it('marca expired cuando el borrado físico funciona', async () => {
      const updates: any[] = []
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Configuration') return [{ id: 'cfg1', value: JSON.stringify({ clientId: 'test', accessToken: 'tok', region: 'eu' }) }]
          if (table === 'LockCodes') return [{ id: 'c1', reservationId: 'res1', lockId: 'l1', hotelId: 'h1', status: 'active', ttlockKeyboardPwdId: '999' }]
          return []
        },
        findById: async (table: string) => {
          if (table === 'LockDevices') return { id: 'l1', hotelId: 'h1', ttlockLockId: '123' }
          return null
        },
        update: async (_t: string, id: string, data: any) => { updates.push({ id, ...data }) },
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ errcode: 0 }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
        await svc.expireCodesByReservation('res1')
      } finally {
        globalThis.fetch = realFetch
      }
      expect(updates).toEqual([{ id: 'c1', status: 'expired' }])
    })

    // El PIN sigue abriendo la puerta: NO se puede mentir con 'expired'.
    it('NO marca expired si el borrado físico falla — queda expire_failed', async () => {
      const updates: any[] = []
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Configuration') return [{ id: 'cfg1', value: JSON.stringify({ clientId: 'test', accessToken: 'tok', region: 'eu' }) }]
          if (table === 'LockCodes') return [{ id: 'c1', reservationId: 'res1', lockId: 'l1', hotelId: 'h1', status: 'active', ttlockKeyboardPwdId: '999' }]
          return []
        },
        findById: async (table: string) => {
          if (table === 'LockDevices') return { id: 'l1', hotelId: 'h1', ttlockLockId: '123' }
          return null
        },
        update: async (_t: string, id: string, data: any) => { updates.push({ id, ...data }) },
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ errcode: 10003, errmsg: 'invalid token' }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
        await svc.expireCodesByReservation('res1')
      } finally {
        globalThis.fetch = realFetch
      }
      expect(updates).toEqual([{ id: 'c1', status: 'expire_failed' }])
      expect(updates.some(u => u.status === 'expired')).toBe(false)
    })
  })

  // SEC-5.3 (#351): un merchant NO puede generar el código de puerta de una reserva de OTRO hotel.
  // El guard está en generateCodeForReservation: `if (res.hotelId !== hotelId) throw 'Sin acceso'`,
  // que corta ANTES de tocar la cerradura (por eso no hace falta mockear el cliente TTLock).
  describe('generateCode — aislamiento multi-tenant (SEC-5.3)', () => {
    it('un merchant NO genera código de una reserva de otro hotel', async () => {
      // findReservationById usa orm.findMany('Reservations', {id}); la reserva es del hotel 'h1'.
      const orm = makeOrm({
        findMany: async (table: string) => table === 'Reservations'
          ? [{ id: 'res1', hotelId: 'h1', roomId: 'rm1', checkIn: '2026-06-01', checkOut: '2026-06-03' }]
          : [],
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      // token del hotel 'h2' intentando generar el PIN de la reserva del hotel 'h1'
      await expect(svc.generateCode('h2', 'res1')).rejects.toThrow(/Sin acceso/)
    })

    it('rechaza si la reserva no existe', async () => {
      const orm = makeOrm() // findMany('Reservations') → [] → null → 'Reserva no encontrada'
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      await expect(svc.generateCode('h1', 'inexistente')).rejects.toThrow(/no encontrada/)
    })
  })

  // generateCodeIfAbsent — punto de entrada de la generación AUTOMÁTICA (al pagarse la seña). Debe
  // ser idempotente: el webhook de Stripe reintenta y una reserva puede tener varios Links de Pago.
  describe('generateCodeIfAbsent — idempotencia', () => {
    it('NO regenera si la reserva ya tiene un código ACTIVO', async () => {
      const orm = makeOrm({
        findMany: async (table: string) => table === 'LockCodes'
          ? [{ id: 'c1', reservationId: 'res1', hotelId: 'h1', status: 'active' }]
          : [],
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const r = await svc.generateCodeIfAbsent('h1', 'res1')
      expect(r.skipped).toBe(true)
    })

    it('SÍ genera si el único código de la reserva está revocado (no activo)', async () => {
      // Sin código activo → NO saltea → llama a generateCode. La reserva no existe en este mock, así
      // que tira 'no encontrada': la excepción PRUEBA que pasó la guarda de idempotencia y siguió.
      const orm = makeOrm({
        findMany: async (table: string) => table === 'LockCodes'
          ? [{ id: 'c1', reservationId: 'res1', hotelId: 'h1', status: 'revoked' }]
          : [],
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      await expect(svc.generateCodeIfAbsent('h1', 'res1')).rejects.toThrow(/no encontrada/)
    })

    it('NO genera (auto) si la cerradura de la habitación tiene auto-códigos apagado', async () => {
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'LockCodes') return []                                   // sin código previo
          if (table === 'Reservations') return [{ id: 'res1', hotelId: 'h1', roomId: 'rm1' }]
          if (table === 'LockDevices') return [{ id: 'l1', hotelId: 'h1', ttlockLockId: '123', roomId: 'rm1', autoCodesEnabled: false }]
          return []
        },
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const r = await svc.generateCodeIfAbsent('h1', 'res1')
      expect(r.skipped).toBe(true)
      expect(r.reason).toBe('auto-disabled')
    })

    // #240 — código duplicado: con un código ACTIVO existente NO debe crearse una segunda fila.
    it('NO crea una segunda fila lock_codes si ya hay una activa', async () => {
      const created: any[] = []
      const orm = makeOrm({
        findMany: async (table: string) => table === 'LockCodes'
          ? [{ id: 'c1', reservationId: 'res1', hotelId: 'h1', status: 'active' }]
          : [],
        create: async (table: string, data: any) => { created.push({ table, ...data }); return data },
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const r = await svc.generateCodeIfAbsent('h1', 'res1')
      expect(r.skipped).toBe(true)
      expect(created.filter((c) => c.table === 'LockCodes')).toHaveLength(0) // no duplica
    })

    // #240 — un código 'pending' (emitido con la cerradura offline) también bloquea la regeneración.
    it('NO regenera si la reserva ya tiene un código PENDING', async () => {
      const created: any[] = []
      const orm = makeOrm({
        findMany: async (table: string) => table === 'LockCodes'
          ? [{ id: 'c1', reservationId: 'res1', hotelId: 'h1', status: 'pending' }]
          : [],
        create: async (table: string, data: any) => { created.push({ table, ...data }); return data },
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const r = await svc.generateCodeIfAbsent('h1', 'res1')
      expect(r.skipped).toBe(true)
      expect(r.reason).toBe('already-pending')
      expect(created.filter((c) => c.table === 'LockCodes')).toHaveLength(0)
    })
  })

  // #240 — cerradura OFFLINE: no se empuja el PIN al hardware, se registra el código como 'pending'.
  describe('generateCode — cerradura offline', () => {
    it('registra el código como pending y NO llama a la API de Sciener', async () => {
      const created: any[] = []
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Reservations') return [{ id: 'res1', hotelId: 'h1', roomId: 'rm1', checkIn: '2026-06-01', checkOut: '2026-06-03' }]
          // La cerradura de la habitación está OFFLINE.
          if (table === 'LockDevices') return [{ id: 'l1', hotelId: 'h1', ttlockLockId: '123', roomId: 'rm1', status: 'offline' }]
          if (table === 'Configuration') return [{ id: 'cfg1', value: JSON.stringify({ clientId: 'test', accessToken: 'tok', region: 'eu' }) }]
          return []
        },
        create: async (table: string, data: any) => { created.push({ table, ...data }); return data },
      })
      let fetchCalls = 0
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => { fetchCalls++; return new Response(JSON.stringify({ errcode: 0, keyboardPwdId: 1 })) }) as any
      try {
        const queries = new TtlockQueries(orm)
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
        const result = await svc.generateCode('h1', 'res1')
        // Side-effects: fila 'pending', sin PIN físico, y CERO llamadas a la cerradura.
        expect(fetchCalls).toBe(0)
        const lc = created.find((c) => c.table === 'LockCodes')
        expect(lc).toBeDefined()
        expect(lc.status).toBe('pending')
        expect(lc.ttlockKeyboardPwdId).toBe('')
        expect(lc.code).toBeTruthy()          // PIN pre-asignado para reintentar
        expect(lc.reservationId).toBe('res1')
        expect(result.status).toBe('pending')
      } finally {
        globalThis.fetch = realFetch
      }
    })
  })

  // QA-03 (#302): happy-path de generateCode — genera el PIN en la cerradura y persiste la fila
  // lock_codes ACTIVA con la ventana de la estadía. Se mockea el cliente Sciener (fetch).
  describe('generateCode — happy path', () => {
    it('crea la fila lock_codes activa con la ventana de la estadía y el PIN de la cerradura', async () => {
      const created: any[] = []
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Reservations') return [{ id: 'res1', hotelId: 'h1', roomId: 'rm1', checkIn: '2026-06-01', checkOut: '2026-06-03' }]
          if (table === 'LockDevices') return [{ id: 'l1', hotelId: 'h1', ttlockLockId: '123', roomId: 'rm1', status: 'online' }]
          if (table === 'Configuration') return [{ id: 'cfg1', value: JSON.stringify({ clientId: 'test', clientSecret: 'sec', accessToken: 'tok', region: 'eu' }) }]
          return []
        },
        create: async (table: string, data: any) => { created.push({ table, ...data }); return data },
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ errcode: 0, keyboardPwdId: 555 }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
        await svc.generateCode('h1', 'res1')
        const lc = created.find((c) => c.table === 'LockCodes')
        expect(lc).toBeDefined()
        expect(lc.status).toBe('active')
        expect(lc.reservationId).toBe('res1')
        expect(lc.startDate).toBe('2026-06-01')
        expect(lc.endDate).toBe('2026-06-03')
        expect(lc.code).toBeTruthy() // se generó un PIN
        expect(String(lc.ttlockKeyboardPwdId)).toBe('555') // pwdId devuelto por la cerradura
      } finally {
        globalThis.fetch = realFetch
      }
    })
  })

  // Fase B: gateways + códigos activos leídos del hardware (no de la BD).
  describe('listGateways / listActiveCodes', () => {
    it('listGateways devuelve los gateways de la cuenta TTLock', async () => {
      const orm = makeOrm()
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ total: 1, list: [{ gatewayId: 2312994, gatewayName: 'gateway', isOnline: 1, lockNum: 1 }] }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
        const gws = await svc.listGateways('h1')
        expect(gws).toHaveLength(1)
        expect(gws[0].gatewayId).toBe(2312994)
        expect(gws[0].isOnline).toBe(1)
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('listActiveCodes lee los PIN reales del hardware de la cerradura', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ total: 1, list: [{ keyboardPwdId: 1, keyboardPwd: '445566', nickName: 'Solmi', keyboardPwdType: 3, status: 1 }] }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        const codes = await svc.listActiveCodes('h1', 'l1')
        expect(codes).toHaveLength(1)
        expect(codes[0].keyboardPwd).toBe('445566')
        expect(codes[0].keyboardPwdName).toBe('Solmi') // mapea nickName → keyboardPwdName
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('listActiveCodes de una cerradura de OTRO hotel: assertOwnership corta', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const queries = new TtlockQueries(orm)
      const auth = { assertOwnership: (a: string, b: string) => { if (a !== b) throw new Error('Forbidden') } } as any
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
      await expect(svc.listActiveCodes('h2', 'l1')).rejects.toThrow(/Forbidden/)
    })

    it('listLockRecords lee el historial de actividad de la cerradura', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ total: 1, list: [{ recordId: 631488774, recordType: 4, success: 1, keyboardPwd: '121563', lockDate: 1784217414000 }] }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        const recs = await svc.listLockRecords('h1', 'l1')
        expect(recs).toHaveLength(1)
        expect(recs[0].keyboardPwd).toBe('121563')
        expect(recs[0].success).toBe(1)
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('listLockRecords de una cerradura de OTRO hotel: assertOwnership corta', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const queries = new TtlockQueries(orm)
      const auth = { assertOwnership: (a: string, b: string) => { if (a !== b) throw new Error('Forbidden') } } as any
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
      await expect(svc.listLockRecords('h2', 'l1')).rejects.toThrow(/Forbidden/)
    })
  })

  // Gestión desde el Planning: abrir la puerta en remoto + borrar un PIN del hardware.
  describe('unlockLock / deletePasscode', () => {
    it('unlockLock llama al endpoint de apertura remota', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const realFetch = globalThis.fetch
      let calledUrl = ''
      globalThis.fetch = (async (url: any) => { calledUrl = String(url); return new Response(JSON.stringify({ errcode: 0 })) }) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        await svc.unlockLock('h1', 'l1')
        expect(calledUrl).toContain('/v3/lock/unlock')
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('lockLock llama al endpoint de CIERRE remoto, no al de apertura', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const realFetch = globalThis.fetch
      let calledUrl = ''
      globalThis.fetch = (async (url: any) => { calledUrl = String(url); return new Response(JSON.stringify({ errcode: 0 })) }) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        await svc.lockLock('h1', 'l1')
        expect(calledUrl).toContain('/v3/lock/lock')
        expect(calledUrl).not.toContain('/unlock')
      } finally {
        globalThis.fetch = realFetch
      }
    })

    // Muchos modelos son de resorte y no tienen motor para echar el pestillo: Sciener responde con
    // errcode. Tragarse ese error diría "puerta cerrada" con la puerta abierta.
    it('lockLock propaga el error cuando la cerradura no soporta cierre remoto', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ errcode: -3007, errmsg: 'Lock does not support remote locking' }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        await expect(svc.lockLock('h1', 'l1')).rejects.toThrow(/remote locking/)
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('lockLock de otro hotel: assertOwnership corta', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const queries = new TtlockQueries(orm)
      const auth = { assertOwnership: (a: string, b: string) => { if (a !== b) throw new Error('Forbidden') } } as any
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
      await expect(svc.lockLock('h2', 'l1')).rejects.toThrow(/Forbidden/)
    })

    it('unlockLock de otro hotel: assertOwnership corta', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const queries = new TtlockQueries(orm)
      const auth = { assertOwnership: (a: string, b: string) => { if (a !== b) throw new Error('Forbidden') } } as any
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
      await expect(svc.unlockLock('h2', 'l1')).rejects.toThrow(/Forbidden/)
    })

    it('deletePasscode borra del hardware y revoca la fila de la BD que apunta a ese PIN', async () => {
      const updated: any[] = []
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
        findMany: async (table: string) => {
          if (table === 'Configuration') return [{ id: 'cfg1', value: JSON.stringify({ clientId: 'test', accessToken: 'tok', region: 'eu' }) }]
          if (table === 'LockCodes') return [{ id: 'c1', status: 'active', ttlockKeyboardPwdId: '999' }]
          return []
        },
        update: async (table: string, id: string, data: any) => { updated.push({ table, id, data }) },
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ errcode: 0 }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        await svc.deletePasscode('h1', 'l1', '999')
        expect(updated.some(u => u.table === 'LockCodes' && u.data.status === 'revoked')).toBe(true)
      } finally {
        globalThis.fetch = realFetch
      }
    })
  })

  // Gateway de la cerradura + código fijo (permanente) — para el modal robusto del Planning.
  describe('listLockGateways / createPermanentCode', () => {
    it('listLockGateways devuelve el gateway de la cerradura con señal', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ list: [{ gatewayId: 2312994, gatewayName: 'gateway', rssi: -57 }] }))) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        const gws = await svc.listLockGateways('h1', 'l1')
        expect(gws[0].gatewayId).toBe(2312994)
        expect(gws[0].rssi).toBe(-57)
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('createPermanentCode crea un fijo con keyboardPwdType=1 y el code dado', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'h1', ttlockLockId: '123' } : null,
      })
      const realFetch = globalThis.fetch
      let sentBody = ''
      globalThis.fetch = (async (_url: any, init: any) => { sentBody = String(init?.body); return new Response(JSON.stringify({ keyboardPwdId: 42 })) }) as any
      try {
        const queries = new TtlockQueries(orm)
        const auth = { assertOwnership: () => {} } as any
        const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
        const r = await svc.createPermanentCode('h1', 'l1', '246810', 'Staff')
        expect(r.code).toBe('246810')
        expect(String(r.keyboardPwdId)).toBe('42')
        expect(sentBody).toContain('keyboardPwdType=1')
        expect(sentBody).toContain('endDate=0')
      } finally {
        globalThis.fetch = realFetch
      }
    })
  })

  // Limpieza masiva del tab Códigos: borrar los históricos (revoked/expired) de una cerradura.
  describe('purgeInactiveCodes', () => {
    it('borra solo los revoked/expired y devuelve el conteo', async () => {
      const codes = [
        { id: 'c1', lockId: 'l1', hotelId: 'h1', code: '1111', status: 'active' },
        { id: 'c2', lockId: 'l1', hotelId: 'h1', code: '2222', status: 'revoked' },
        { id: 'c3', lockId: 'l1', hotelId: 'h1', code: '3333', status: 'expired' },
        { id: 'c4', lockId: 'l1', hotelId: 'h1', code: '4444', status: 'pending' },
        { id: 'c5', lockId: 'l1', hotelId: 'h1', code: '5555', status: 'expire_failed' },
      ]
      const deleted: string[] = []
      const orm = makeOrm({
        findMany: async (table: string) => table === 'LockDevices'
          ? [{ id: 'l1', hotelId: 'h1', ttlockLockId: '123', roomId: 'rm1' }]
          : table === 'LockCodes' ? codes : [],
        delete: async (_table: string, id: string) => { deleted.push(id); return true },
      })
      const queries = new TtlockQueries(orm)
      const auth = { assertOwnership: () => {} } as any
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
      const n = await svc.purgeInactiveCodes('h1', 'l1')
      expect(n).toBe(2)
      expect(deleted.sort()).toEqual(['c2', 'c3'])
    })

    it('exige que la cerradura sea del hotel (ownership)', async () => {
      const orm = makeOrm({
        findById: async (table: string) => table === 'LockDevices' ? { id: 'l1', hotelId: 'OTRO', ttlockLockId: '123' } : null,
      })
      const queries = new TtlockQueries(orm)
      const auth = { assertOwnership: () => { throw new Error('Forbidden') } } as any
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries, auth)
      expect(svc.purgeInactiveCodes('h1', 'l1')).rejects.toThrow('Forbidden')
    })

    it('404 lógico si la cerradura no existe', async () => {
      const orm = makeOrm({ findById: async () => null })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      expect(svc.purgeInactiveCodes('h1', 'nope')).rejects.toThrow('Cerradura no encontrada')
    })

    // Variante GLOBAL (sin lockDeviceId): purge de TODO el hotel desde la página principal
    // de cerraduras. El hotelId (del token) es el filtro del findMany → nunca toca otro hotel.
    it('GLOBAL (sin lockId) borra los revoked/expired de TODO el hotel y respeta active/pending/expire_failed', async () => {
      const codes = [
        { id: 'c1', lockId: 'l1', hotelId: 'h1', code: '1111', status: 'active' },
        { id: 'c2', lockId: 'l1', hotelId: 'h1', code: '2222', status: 'revoked' },
        { id: 'c3', lockId: 'l2', hotelId: 'h1', code: '3333', status: 'expired' },
        { id: 'c4', lockId: 'l2', hotelId: 'h1', code: '4444', status: 'pending' },
        { id: 'c5', lockId: 'l1', hotelId: 'h1', code: '5555', status: 'expire_failed' },
        { id: 'c6', lockId: 'l9', hotelId: 'OTRO', code: '6666', status: 'revoked' }, // otro hotel: intocable
      ]
      const deleted: string[] = []
      const orm = makeOrm({
        findMany: async (table: string, filter: any) => {
          if (table !== 'LockCodes') return []
          // El repo real filtra por hotelId en el WHERE: el mock replica ese contrato.
          return filter?.hotelId ? codes.filter(c => c.hotelId === filter.hotelId) : codes
        },
        delete: async (_table: string, id: string) => { deleted.push(id); return true },
      })
      const queries = new TtlockQueries(orm)
      const svc = new TtlockService(repo(orm, 'LockDevices'), repo(orm, 'LockCodes'), log, queries)
      const n = await svc.purgeInactiveCodes('h1')
      expect(n).toBe(2)
      expect(deleted.sort()).toEqual(['c2', 'c3'])
      expect(deleted).not.toContain('c6') // cross-tenant: el filtro del hotel lo impide
    })
  })
})
