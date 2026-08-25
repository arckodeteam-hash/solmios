// cash/tests/close-history.test.ts — Regresiones de la auditoría docs/qa-ui/caja-2026-08-22.
//
// Lo que se protege acá:
//   1. H2/M6: cerrar un turno con diferencia (fuera de BALANCE_EPSILON) SIN motivo se rechaza
//      con ValidationError (400) — antes el arqueo venía prellenado con el esperado y un click
//      cerraba cualquier faltante sin explicación.
//   2. Con motivo cierra y persiste notes + difference (redondeada a centavos).
//   3. Cierre cuadrado (o dentro del centavo de tolerancia) NO exige motivo.
//   4. H1: listShiftHistory — histórico paginado, filtrable por fecha de apertura, con neto por
//      método firmado (el egreso RESTA, no suma) y sin mezclar registers.

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

// Turno del flujo de la auditoría: fondo $500 + ingreso efectivo $1000 − egreso efectivo $200
// → esperado en cajón $1300. Contar $1290 ⇒ faltante −$10.
const OPEN_SHIFT: CashShiftDTO = {
  id: 's1', hotelId: 'h1', status: 'open', register: 'reception', openingAmount: 500,
} as CashShiftDTO
const SHIFT_MOVS: CashMovementDTO[] = [
  { id: 'm1', hotelId: 'h1', shiftId: 's1', register: 'reception', type: 'income', amount: 1000, method: 'cash' },
  { id: 'm2', hotelId: 'h1', shiftId: 's1', register: 'reception', type: 'expense', amount: 200, method: 'cash' },
  { id: 'm3', hotelId: 'h1', shiftId: 's1', register: 'reception', type: 'income', amount: 300, method: 'card' },
] as CashMovementDTO[]

function makeCloseService(updates: any[] = []) {
  const shiftRepo = makeRepo<CashShiftDTO>({
    findById: async () => OPEN_SHIFT,
    findMany: async () => [OPEN_SHIFT] as any,
    update: async (_id: any, d: any) => { updates.push(d); return { ...OPEN_SHIFT, ...d } as CashShiftDTO },
  })
  const repo = makeRepo<CashMovementDTO>({ findMany: async (f: any) => (f.shiftId ? SHIFT_MOVS : []) as any })
  return { service: new CashService(repo, shiftRepo, makeUserRepo(), log, silentCache, passAuth), updates }
}

describe('closeShift — motivo obligatorio cuando el arqueo no cuadra (H2/M6)', () => {
  it('diferencia fuera de BALANCE_EPSILON SIN motivo → ValidationError con mensaje en español', async () => {
    const { service } = makeCloseService()
    await expect(service.closeShift('s1', { countedAmount: 1290 }, currentUser))
      .rejects.toThrow('escribí el motivo de la diferencia')
  })

  it('el mensaje dice la diferencia y el esperado (para contar de nuevo en el mostrador)', async () => {
    const { service } = makeCloseService()
    try {
      await service.closeShift('s1', { countedAmount: 1290 }, currentUser)
      throw new Error('debía rechazar')
    } catch (e: any) {
      expect(e.message).toContain('-10')
      expect(e.message).toContain('1300') // esperado, para re-contar
    }
  })

  it('CON motivo cierra y persiste notes + difference redondeada', async () => {
    const { service, updates } = makeCloseService()
    const closed = await service.closeShift('s1', { countedAmount: 1290, notes: 'Faltante de cambio, avisó el cajero' }, currentUser)
    expect(closed.status).toBe('closed')
    expect(updates[0].difference).toBe(-10)
    expect(updates[0].countedAmount).toBe(1290)
    expect(updates[0].expectedAmount).toBe(1300)
    expect(updates[0].notes).toBe('Faltante de cambio, avisó el cajero')
    expect(updates[0].closedBy).toBe('u1')
  })

  it('con motivo en blanco (solo espacios) también se rechaza', async () => {
    const { service } = makeCloseService()
    await expect(service.closeShift('s1', { countedAmount: 1290, notes: '   ' }, currentUser))
      .rejects.toThrow('motivo')
  })

  it('cierre cuadrado SIN motivo cierra normal (no exige explicación de lo que no pasó)', async () => {
    const { service, updates } = makeCloseService()
    const closed = await service.closeShift('s1', { countedAmount: 1300 }, currentUser)
    expect(closed.status).toBe('closed')
    expect(updates[0].difference).toBe(0)
  })

  it('diferencia de UN centavo está dentro de BALANCE_EPSILON → cierra sin motivo', async () => {
    const { service } = makeCloseService()
    const closed = await service.closeShift('s1', { countedAmount: 1300.01 }, currentUser)
    expect(closed.status).toBe('closed')
  })

  it('persiste el conteo por denominaciones cuando viene (opcional)', async () => {
    const { service, updates } = makeCloseService()
    await service.closeShift('s1', { countedAmount: 1290, notes: 'faltante', denominations: '{"1000":1,"200":1,"50":1,"10":4}' }, currentUser)
    expect(updates[0].denominations).toBe('{"1000":1,"200":1,"50":1,"10":4}')
  })
})

describe('listShiftHistory — histórico paginado y filtrado (H1)', () => {
  const SHIFTS: any[] = [
    { id: 's3', hotelId: 'h1', register: 'reception', status: 'closed', openingAmount: 580, openedAt: '2026-08-20T10:00:00', closedAt: '2026-08-20T18:00:00', openedBy: 'u1', closedBy: 'u2', countedAmount: 600, expectedAmount: 670, difference: -70 },
    { id: 's2', hotelId: 'h1', register: 'reception', status: 'closed', openingAmount: 200, openedAt: '2026-08-10T09:00:00', closedAt: '2026-08-10T17:00:00', openedBy: 'u1', closedBy: 'u1', countedAmount: 580, expectedAmount: 580, difference: 0 },
    { id: 's1', hotelId: 'h1', register: 'reception', status: 'open', openingAmount: 100, openedAt: '2026-08-01T08:00:00', openedBy: 'u2' },
    { id: 's-rest', hotelId: 'h1', register: 'restaurant', status: 'closed', openingAmount: 50, openedAt: '2026-08-15T12:00:00' },
  ]
  const MOVS: any[] = [
    { id: 'm1', hotelId: 'h1', shiftId: 's2', register: 'reception', type: 'income', amount: 500, method: 'cash' },
    { id: 'm2', hotelId: 'h1', shiftId: 's2', register: 'reception', type: 'expense', amount: 120, method: 'cash' },
    { id: 'm3', hotelId: 'h1', shiftId: 's2', register: 'reception', type: 'income', amount: 300, method: 'card' },
    { id: 'm4', hotelId: 'h1', shiftId: 's-rest', register: 'restaurant', type: 'income', amount: 900, method: 'cash' },
  ]

  function makeHistoryService() {
    const shiftRepo = makeRepo<CashShiftDTO>({ findMany: async (f: any) => SHIFTS.filter((s) => s.register === f.register) as any })
    const repo = makeRepo<CashMovementDTO>({ findMany: async (f: any) => MOVS.filter((m) => m.register === f.register) as any })
    return new CashService(repo, shiftRepo, makeUserRepo(), log, silentCache, passAuth)
  }

  it('devuelve los turnos del register ORDENADOS por apertura descendente, con paginación', async () => {
    const s = makeHistoryService()
    const page = await s.listShiftHistory({ page: 1, limit: 2 }, undefined, currentUser)
    expect(page.total).toBe(3) // s-rest es del restaurante, no entra
    expect(page.data.map((r) => r.id)).toEqual(['s3', 's2'])
    expect(page.pages).toBe(2)
    expect(page.hasNext).toBe(true)
    expect(page.hasPrev).toBe(false)
  })

  it('página 2 trae el resto y marca hasNext=false', async () => {
    const s = makeHistoryService()
    const page = await s.listShiftHistory({ page: 2, limit: 2 }, undefined, currentUser)
    expect(page.data.map((r) => r.id)).toEqual(['s1'])
    expect(page.hasNext).toBe(false)
    expect(page.hasPrev).toBe(true)
  })

  it('filtra por fecha de apertura from/to (inclusive el día de `to`)', async () => {
    const s = makeHistoryService()
    const page = await s.listShiftHistory({ from: '2026-08-10', to: '2026-08-10' }, undefined, currentUser)
    expect(page.data.map((r) => r.id)).toEqual(['s2'])
  })

  it('enriquece cada turno con byMethodNet FIRMADO: el egreso resta, la tarjeta va aparte', async () => {
    const s = makeHistoryService()
    const page = await s.listShiftHistory({}, undefined, currentUser)
    const s2 = page.data.find((r) => r.id === 's2')!
    // ingreso 500 − egreso 120 = 380 neto efectivo (NO 620: el egreso sale del cajón)
    expect(s2.byMethodNet.cash).toBe(380)
    expect(s2.byMethodNet.card).toBe(300)
  })

  it('un turno sin movimientos llega con byMethodNet vacío, no en undefined', async () => {
    const s = makeHistoryService()
    const page = await s.listShiftHistory({}, undefined, currentUser)
    const s1 = page.data.find((r) => r.id === 's1')!
    expect(s1.byMethodNet).toEqual({})
  })

  it('la caja del restaurante NO ve los turnos de recepción (register separado)', async () => {
    const s = makeHistoryService()
    const page = await s.listShiftHistory({}, undefined, currentUser, 'restaurant')
    expect(page.data.map((r) => r.id)).toEqual(['s-rest'])
    expect(page.data[0].byMethodNet.cash).toBe(900)
  })
})
