// promo-codes/tests/promo-atomic.test.ts — PC-1/PC-5 (auditoría 2026-08-19).
//
// El viejo `incrementUsesByCode` era read-modify-write: dos consumidores concurrentes leían
// uses=0 y ambos escribían (un single-use canjeado dos veces). Estos tests clavan la
// mecánica CAS del reemplazo: tope de maxUses, UPDATE condicional, compensación y floor 0.
import { describe, it, expect } from 'bun:test'
import { consumeUse, releaseUse } from '../usecases/promo-atomic'

/** Mock del orm: findOne + updateMany que respeta el filtro `uses` (simula el CAS del motor). */
function makeOrm(row: { id: string; uses: number; maxUses: number | null } | null) {
  const calls: Array<{ id: string; filterUses: number; newUses: number }> = []
  const store = row ? { ...row } : null
  return {
    calls,
    findOne: async (_model: string, filters: Record<string, unknown>) =>
      store && filters.hotelId === 'h1' && filters.code === (store as any).code ? store : null,
    updateMany: async (_model: string, filters: Record<string, unknown>, changes: Record<string, unknown>) => {
      // CAS: solo aplica si `uses` sigue siendo el valor del filtro.
      if (!store || filters.id !== store.id || filters.uses !== store.uses) return 0
      calls.push({ id: store.id, filterUses: store.uses, newUses: Number(changes.uses) })
      store.uses = Number(changes.uses)
      return 1
    },
    __store: store,
  } as any
}

const baseRow = (uses: number, maxUses: number | null = null) => ({ id: 'p1', hotelId: 'h1', code: 'POINTS-ABC', uses, maxUses })

describe('consumeUse (PC-1 — CAS)', () => {
  it('consume un uso: UPDATE condicional uses→uses+1', async () => {
    const orm = makeOrm(baseRow(0, 1))
    await consumeUse(orm, 'h1', 'points-abc') // case-insensitive
    expect(orm.__store.uses).toBe(1)
    expect(orm.calls).toEqual([{ id: 'p1', filterUses: 0, newUses: 1 }])
  })

  it('código con uses >= maxUses → ConflictError, NO toca el contador', async () => {
    const orm = makeOrm(baseRow(1, 1))
    await expect(consumeUse(orm, 'h1', 'POINTS-ABC')).rejects.toThrow(/agotado/i)
    expect(orm.__store.uses).toBe(1)
    expect(orm.calls.length).toBe(0)
  })

  it('pierde la carrera (affected=0: otro flujo ya incrementó) → ConflictError', async () => {
    const orm = makeOrm(baseRow(0, null))
    // El primer consume mueve uses 0→1; el segundo leyó "fresh" 0 PERO el mock CAS ya no matchea.
    await consumeUse(orm, 'h1', 'POINTS-ABC')
    // Simular la carrera: re-leer usa el store vivo (uses=1), así que forzamos el caso
    // affected=0 con un orm cuyo filtro nunca matchea:
    const raced = {
      findOne: async () => baseRow(0, null), // lee uses=0 (snapshot viejo)
      updateMany: async () => 0, // el UPDATE WHERE uses=0 no afecta filas (otro ya escribió 1)
    } as any
    await expect(consumeUse(raced, 'h1', 'POINTS-ABC')).rejects.toThrow(/agotado/i)
  })

  it('código inexistente (borrado entre validate y consume) → no-op sin throw', async () => {
    const orm = makeOrm(null)
    await expect(consumeUse(orm, 'h1', 'GONE')).resolves.toBeUndefined()
  })

  it('maxUses=null (ilimitado) consume sin tope', async () => {
    const orm = makeOrm(baseRow(500, null))
    await consumeUse(orm, 'h1', 'POINTS-ABC')
    expect(orm.__store.uses).toBe(501)
  })
})

describe('releaseUse (PC-5 — devolución por cancelación/compensación)', () => {
  it('devuelve un uso: uses→uses−1', async () => {
    const orm = makeOrm(baseRow(2, 5))
    await releaseUse(orm, 'h1', 'POINTS-ABC')
    expect(orm.__store.uses).toBe(1)
  })

  it('floor 0: uses=0 → no-op (nunca negativo)', async () => {
    const orm = makeOrm(baseRow(0, 1))
    await releaseUse(orm, 'h1', 'POINTS-ABC')
    expect(orm.__store.uses).toBe(0)
    expect(orm.calls.length).toBe(0)
  })

  it('best-effort: si el UPDATE falla (pierde la carrera contra un admin), no throw', async () => {
    const orm = {
      findOne: async () => baseRow(1, 1),
      updateMany: async () => { throw new Error('db gone') },
    } as any
    await expect(releaseUse(orm, 'h1', 'POINTS-ABC')).resolves.toBeUndefined()
  })

  it('código inexistente → no-op', async () => {
    await expect(releaseUse(makeOrm(null), 'h1', 'GONE')).resolves.toBeUndefined()
  })
})
