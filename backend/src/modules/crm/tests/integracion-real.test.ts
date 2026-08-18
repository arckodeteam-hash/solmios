// crm/tests/integracion-real.test.ts — Especificación crm-integracion-real:
// configurabilidad, canje→promo con compensación, y recompute masivo de tiers.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { readLoyaltyConfig, DEFAULT_LOYALTY_CONFIG } from '../usecases/loyalty-config'
import { CrmService, type LoyaltyPromoPort } from '../service'

const log = silentLogger()

function makeRepo<T>(rows: T[] = [], writes: any = { create: [], update: [] }): any {
  return {
    findMany: async () => rows,
    findById: async (id: string) => (rows as any[]).find((r) => r.id === id) ?? null,
    create: async (data: any) => { writes.create.push(data); return { id: 'txn-1', ...data } },
    update: async (id: string, data: any) => { writes.update.push({ id, data }); return { id, ...data } },
  }
}

function configRepoWith(value: unknown): any {
  return { findMany: async () => (value === undefined ? [] : [{ value }]) }
}

describe('readLoyaltyConfig (T1)', () => {
  it('sin key → defaults históricos (rollback gratis: hotel sin config no cambia comportamiento)', async () => {
    const cfg = await readLoyaltyConfig(configRepoWith(undefined), 'h1')
    expect(cfg).toEqual(DEFAULT_LOYALTY_CONFIG)
    expect(cfg.pointsPerCurrencyUnit).toBe(10)
  })

  it('JSON corrupto o shape inválido → defaults, sin throw', async () => {
    expect(await readLoyaltyConfig(configRepoWith('{no es json'), 'h1')).toEqual(DEFAULT_LOYALTY_CONFIG)
    expect(await readLoyaltyConfig(configRepoWith('42'), 'h1')).toEqual(DEFAULT_LOYALTY_CONFIG)
    expect((await readLoyaltyConfig(configRepoWith('{"enabled":false,"pointsPerCurrencyUnit":-5}'), 'h1')).pointsPerCurrencyUnit)
      .toBe(10) // valor inválido → default, no -5
  })

  it('config válida se respeta (flag, ratio, tiers propios)', async () => {
    const cfg = await readLoyaltyConfig(configRepoWith('{"enabled":false,"pointsPerCurrencyUnit":5,"pointValue":2,"promoValidDays":30,"tiers":[{"tier":"gold","stays":3,"spent":900}]}'), 'h1')
    expect(cfg.enabled).toBe(false)
    expect(cfg.pointsPerCurrencyUnit).toBe(5)
    expect(cfg.pointValue).toBe(2)
    expect(cfg.promoValidDays).toBe(30)
    expect(cfg.tiers).toEqual([{ tier: 'gold', stays: 3, spent: 900 }])
  })
})

describe('redeemPoints → promo code (T9)', () => {
  const guest = { id: 'g1', hotelId: 'h1', loyaltyPoints: 500, tier: 'bronze', totalStays: 0, totalSpent: 0 }

  function svc(opts: { promo?: LoyaltyPromoPort | null; config?: unknown } = {}) {
    const writes: any = { create: [], update: [] }
    const service = new CrmService(makeRepo([], writes), makeRepo(), makeRepo(), makeRepo([guest], writes), makeRepo(), log, { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any)
    service.setConfigRepo(configRepoWith(opts.config))
    if (opts.promo !== null) service.setPromoPort(opts.promo ?? {
      createForLoyalty: async (_h, code, value, days) => ({ id: 'p1', code }) as never,
    })
    return { service, writes }
  }

  it('canje completo: debita y devuelve el promo code con su valor', async () => {
    const { service } = svc()
    const res = await service.redeemPoints('g1', 'h1', 300, 'canje test')
    expect((res as any).promoCode).toMatch(/^POINTS-/)
    expect((res as any).discountValue).toBe(300) // 300 puntos × pointValue 1
  })

  it('sin balance: 422 de validación y CERO efectos (sin transacción ni promo)', async () => {
    let promoCalled = false
    const { service, writes } = svc({ promo: { createForLoyalty: async () => { promoCalled = true; return { id: 'x', code: 'x' } } } })
    await expect(service.redeemPoints('g1', 'h1', 900, 'x')).rejects.toThrow('insuficientes')
    expect(writes.create).toHaveLength(0)
    expect(promoCalled).toBe(false)
  })

  it('promo falla → COMPENSA: puntos devueltos y reversa auditada (spec crm-loyalty)', async () => {
    const { service, writes } = svc({ promo: { createForLoyalty: async () => { throw new Error('boom') } } })
    await expect(service.redeemPoints('g1', 'h1', 300, 'x')).rejects.toThrow('No se pudo generar')
    // redeem (-300) + reversa (+300) y el update final devuelve el balance original
    const txns = writes.create.map((t: any) => t.type)
    expect(txns).toContain('redeem')
    expect(txns).toContain('earn')
    const lastUpdate = writes.update[writes.update.length - 1]
    expect(lastUpdate.data.loyaltyPoints).toBe(500)
  })

  it('flag desactivado → el canje se rechaza (rollback sin deploy)', async () => {
    const { service } = svc({ config: '{"enabled":false}' })
    await expect(service.redeemPoints('g1', 'h1', 100, 'x')).rejects.toThrow('desactivado')
  })
})

describe('recomputeTiers masivo (T6)', () => {
  it('sube a los que corresponden y NO baja a nadie (ratchet)', async () => {
    const guests = [
      { id: 'g1', hotelId: 'h1', tier: 'bronze', totalStays: 6, totalSpent: 0 },   // → gold (5 stays)
      { id: 'g2', hotelId: 'h1', tier: 'gold', totalStays: 0, totalSpent: 0 },     // ya gold, no baja
      { id: 'g3', hotelId: 'h1', tier: 'silver', totalStays: 1, totalSpent: 0 },   // no alcanza silver de nuevo, no baja
    ]
    const writes: any = { create: [], update: [] }
    const service = new CrmService(makeRepo([], writes), makeRepo(), makeRepo(), makeRepo(guests, writes), makeRepo(), log, { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any)
    service.setConfigRepo(configRepoWith(undefined))

    const res = await service.recomputeTiers('h1')
    expect(res.recomputed).toBe(3)
    expect(res.upgraded).toBe(1)
    expect(writes.update).toEqual([{ id: 'g1', data: { tier: 'gold' } }])
  })
})
