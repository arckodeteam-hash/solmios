// cash/tests/service.test.ts — Tests del servicio Caja.
// Usa RepositoryAdapter mock — sin dependencia de SQLite.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { CashService } from '../service'
import type { CashMovementDTO, CashShiftDTO, CurrentUser } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const passAuth: Auth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth
const currentUser: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

function makeRepo<T extends object>(ov: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (d: any) => ({ id: 'x1', ...d } as T),
    update: async (id: any, d: any) => ({ id, ...d } as T),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...ov,
  } as RepositoryAdapter<T>
}
function makeUserRepo(hotelId = 'h1'): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findById: async () => ({ id: 'u1', hotelId }) }
}

describe('CashService', () => {
  it('getById lanza NotFound si no existe', async () => {
    const s = new CashService(makeRepo<CashMovementDTO>(), makeRepo<CashShiftDTO>(), makeUserRepo(), log, silentCache, passAuth)
    await expect(s.getById('no-existe', currentUser)).rejects.toThrow('Movimiento no encontrado')
  })

  it('create fuerza hotelId del JWT y marca source=manual (P0 IDOR)', async () => {
    const created: any[] = []
    const repo = makeRepo<CashMovementDTO>({
      create: async (d: any) => { created.push(d); return { id: 'm1', ...d } as CashMovementDTO },
    })
    const s = new CashService(repo, makeRepo<CashShiftDTO>(), makeUserRepo(), log, silentCache, passAuth)
    // Intento de IDOR: body pide hotelId='h2', el user es de 'h1'.
    await s.create({ type: 'income', amount: 50, hotelId: 'h2' } as any, currentUser)
    expect(created[0].hotelId).toBe('h1') // forzado al del JWT
    expect(created[0].source).toBe('manual')
  })

  it('create rechaza tipo de movimiento inválido', async () => {
    const s = new CashService(makeRepo<CashMovementDTO>(), makeRepo<CashShiftDTO>(), makeUserRepo(), log, silentCache, passAuth)
    await expect(s.create({ type: 'invalid', amount: 10 } as any, currentUser)).rejects.toThrow('Tipo de movimiento inválido')
  })

  it('openShift crea un turno abierto', async () => {
    const created: any[] = []
    const shiftRepo = makeRepo<CashShiftDTO>({
      create: async (d: any) => { created.push(d); return { id: 's1', ...d } as CashShiftDTO },
    })
    const s = new CashService(makeRepo<CashMovementDTO>(), shiftRepo, makeUserRepo(), log, silentCache, passAuth)
    const shift = await s.openShift({ openingAmount: 100 }, currentUser)
    expect(shift.status).toBe('open')
    expect(created[0].openingAmount).toBe(100)
  })

  it('closeShift calcula expected y diferencia (arqueo)', async () => {
    const shift = { id: 's1', hotelId: 'h1', status: 'open', openingAmount: 100 } as CashShiftDTO
    const shiftRepo = makeRepo<CashShiftDTO>({
      findById: async () => shift,
      update: async (_id: any, d: any) => ({ ...shift, ...d } as CashShiftDTO),
    })
    // Movimientos del turno: income 50, expense 20 → expected = 100 + 50 - 20 = 130
    const repo = makeRepo<CashMovementDTO>({
      findMany: async () => ([
        { id: 'm1', shiftId: 's1', type: 'income', amount: 50, method: 'cash' },
        { id: 'm2', shiftId: 's1', type: 'expense', amount: 20, method: 'cash' },
      ] as any),
    })
    const s = new CashService(repo, shiftRepo, makeUserRepo(), log, silentCache, passAuth)
    // QA-UI caja-2026-08-22: cerrar con diferencia (20 de sobrante) ahora exige motivo — sin
    // notes el usecase rechaza. La matemática que este test protege (expected/difference) no cambia.
    const closed = await s.closeShift('s1', { countedAmount: 150, notes: 'Sobrante de vuelto' }, currentUser)
    expect(closed.status).toBe('closed')
    expect(closed.expectedAmount).toBe(130)
    expect(closed.difference).toBe(20) // 150 contado − 130 esperado = sobrante +20
  })

  it('registerPaymentIncome hace dedup por paymentId', async () => {
    const repo = makeRepo<CashMovementDTO>({ findMany: async () => ([{ id: 'm1', paymentId: 'p1' }] as any) })
    const s = new CashService(repo, makeRepo<CashShiftDTO>(), makeUserRepo(), log, silentCache, passAuth)
    const res = await s.registerPaymentIncome({ hotelId: 'h1', paymentId: 'p1', amount: 30 })
    expect(res).toBeNull() // ya existe → dedup, no duplica
  })

  it('registerPaymentIncome crea ingreso cuando no existe', async () => {
    const created: any[] = []
    const repo = makeRepo<CashMovementDTO>({
      findMany: async () => [],
      create: async (d: any) => { created.push(d); return { id: 'm2', ...d } as CashMovementDTO },
    })
    const s = new CashService(repo, makeRepo<CashShiftDTO>(), makeUserRepo(), log, silentCache, passAuth)
    const res = await s.registerPaymentIncome({ hotelId: 'h1', paymentId: 'p2', amount: 40, method: 'cash' })
    expect(res).not.toBeNull()
    expect(created[0].type).toBe('income')
    expect(created[0].source).toBe('payment_connector')
    expect(created[0].paymentId).toBe('p2')
  })
})
