// reservas/tests/promo-code.test.ts — FIX 2026-07-31 + PC-1/PC-2/PC-8 (auditoría 2026-08-19).
//
// Cubre el puerto `PromoCodePort` (connectors/reservas-promocodes.ts) inyectado en
// createReservation/updateReservation.
//
// Casos:
//  (1) sin promoCodes cableado (compat callers/tests viejos) → crea igual, no valida
//  (2) dto sin promoCode → no llama al puerto, crea normal
//  (3) código inválido (reason del validador) → 409, NO crea la reserva
//  (4) código válido → consume ANTES de crear (PC-1: orden verificable) y crea
//  (5) si la creación falla tras consumir → compensa con releaseUse (PC-1)
//  (6) descuento declarado ≠ descuento del server → 409 con el monto real (PC-2)
//  (7) descuento registrado = el del server, y el total manual se recompone (PC-2)
//  (8) código agotado (consumeUse lanza) → 409, la reserva NO se crea (PC-1)
//  (9) update cambia el código → valida + consume el nuevo, libera el viejo post-éxito (PC-8)
//  (10) update quita el código → libera el viejo (PC-8)
//  (11) update con código inválido → 409 sin tocar la reserva (PC-8)
import { describe, it, expect } from 'bun:test'
import { createReservation, updateReservation, type PromoCodePort } from '../usecases/crud'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopSockets = {} as any

const resRepo = (fail = false, existing?: Record<string, any>) => ({
  findMany: async () => [],
  findById: async () => existing ?? null,
  create: async (data: any) => {
    if (fail) throw new Error('boom')
    return { id: 'r-new', ...data }
  },
  update: async (id: string, patch: any) => ({ id, ...(existing ?? {}), ...patch }),
}) as any

const baseDto = (over: Record<string, any> = {}) => ({
  hotelId: 'h1', roomId: 'room-1', guestId: 'g1', checkIn: '2026-07-20', checkOut: '2026-07-22',
  status: 'confirmed', totalAmount: 200, ...over,
}) as any

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }

/** Port mock con orden de operaciones grabado (para verificar consume-antes-de-create). */
function makePromoPort(opts: { valid?: boolean; reason?: string; discount?: number; consumeFails?: boolean } = {}) {
  const ops: string[] = []
  const port: PromoCodePort = {
    validate: async (_hotelId, code, _subtotal) => ({
      valid: opts.valid ?? true, discount: opts.discount ?? 20, reason: opts.reason, code,
    }),
    consumeUse: async (_hotelId, code) => {
      if (opts.consumeFails) throw new Error('Código promocional agotado (X)')
      ops.push(`consume:${code}`)
    },
    releaseUse: async (_hotelId, code) => { ops.push(`release:${code}`) },
  }
  return { port, ops }
}

describe('createReservation — código promocional (FIX 2026-07-31 + PC-1/PC-2)', () => {
  it('(1) sin promoCodes cableado → crea igual, no valida (compat)', async () => {
    const item = await createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ promoCode: 'ABC' }), user,
    )
    expect(item.id).toBe('r-new')
  })

  it('(2) dto sin promoCode → no consume, crea normal', async () => {
    const { port, ops } = makePromoPort()
    const item = await createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto(), user,
      undefined, undefined, undefined, port,
    )
    expect(item.id).toBe('r-new')
    expect(ops.length).toBe(0)
  })

  it('(3) código inválido → 409, NO crea la reserva', async () => {
    const { port } = makePromoPort({ valid: false, reason: 'expired' })
    const call = createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ promoCode: 'VENCIDO' }), user,
      undefined, undefined, undefined, port,
    )
    await expect(call).rejects.toThrow(/inválido/i)
  })

  it('(4) código válido → consume ANTES de crear y aplica el descuento del SERVER (PC-1/PC-2)', async () => {
    const calls: string[] = []
    const repo = {
      findMany: async () => [],
      create: async (data: any) => { calls.push('create'); return { id: 'r-new', ...data } },
    } as any
    const { port, ops } = makePromoPort({ discount: 30 })
    // total 200 YA trae el descuento restado (identidad del wizard: total = sub − disc):
    // subtotal implícito 230, server confirma 30 → el total sigue consistente en 200.
    const item = await createReservation(
      repo, undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ promoCode: 'VERANO', promoDiscountAmount: 30 }), user,
      undefined, undefined, undefined, port,
    )
    expect(item.id).toBe('r-new')
    expect(ops).toEqual(['consume:VERANO'])
    expect(calls).toEqual(['create']) // consume quedó registrado ANTES que create
    expect((item as any).promoDiscountAmount).toBe(30) // autoridad del server
    expect((item as any).totalAmount).toBe(200) // 230 (sub) − 30 (disc) — identidad preservada
  })

  it('(5) si la creación falla tras consumir → compensa con releaseUse', async () => {
    const { port, ops } = makePromoPort()
    const call = createReservation(
      resRepo(true), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ promoCode: 'X' }), user,
      undefined, undefined, undefined, port,
    )
    await expect(call).rejects.toThrow('boom')
    expect(ops).toEqual(['consume:X', 'release:X'])
  })

  it('(6) descuento declarado ≠ descuento del server → 409 con el monto real (PC-2)', async () => {
    const { port } = makePromoPort({ discount: 20 }) // server: 20; cliente declara 90
    const call = createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ promoCode: 'HACK', promoDiscountAmount: 90 }), user,
      undefined, undefined, undefined, port,
    )
    await expect(call).rejects.toThrow(/El descuento real del código HACK es 20.00, no 90.00/)
  })

  it('(7) sin promoDiscountAmount del cliente, el server igual aplica el suyo (total recompuesto)', async () => {
    const { port } = makePromoPort({ discount: 25 })
    const item = await createReservation(
      resRepo(), undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ promoCode: 'LATE' }), user,
      undefined, undefined, undefined, port,
    )
    expect((item as any).promoDiscountAmount).toBe(25)
    expect(item.totalAmount).toBe(175) // 200 − 25
  })

  it('(8) código agotado (consumeUse lanza) → 409 y la reserva NO se crea', async () => {
    const { port } = makePromoPort({ consumeFails: true })
    let created = false
    const repo = { findMany: async () => [], create: async (d: any) => { created = true; return d } } as any
    await expect(createReservation(
      repo, undefined, noopLogger, noopCache, noopSockets, {}, baseDto({ promoCode: 'AGOTADO' }), user,
      undefined, undefined, undefined, port,
    )).rejects.toThrow(/agotado/i)
    expect(created).toBe(false)
  })
})

describe('updateReservation — promoCode en edición (PC-8, 2026-08-19)', () => {
  const existing = { id: 'r1', hotelId: 'h1', roomId: 'room-1', status: 'confirmed', promoCode: 'VIEJO', totalAmount: 200 }

  it('(9) cambia el código → valida + consume el NUEVO antes de persistir, libera el VIEJO post-éxito', async () => {
    const calls: string[] = []
    const repo = {
      findMany: async () => [],
      findById: async () => existing,
      update: async (id: string, patch: any) => { calls.push('update'); return { ...existing, ...patch } },
    } as any
    const { port, ops } = makePromoPort()
    const item = await updateReservation(repo, noopLogger, noopCache, noopSockets, 'r1', { promoCode: 'NUEVO' } as any, user, undefined, undefined, undefined, port)
    expect((item as any).promoCode).toBe('NUEVO')
    expect(calls).toEqual(['update'])
    expect(ops).toEqual(['consume:NUEVO', 'release:VIEJO'])
  })

  it('(10) quita el código → libera el viejo', async () => {
    const repo = { findMany: async () => [], findById: async () => existing, update: async (id: string, p: any) => ({ ...existing, ...p }) } as any
    const { port, ops } = makePromoPort()
    await updateReservation(repo, noopLogger, noopCache, noopSockets, 'r1', { promoCode: '' } as any, user, undefined, undefined, undefined, port)
    expect(ops).toEqual(['release:VIEJO'])
  })

  it('(11) código nuevo inválido → 409 sin consumir ni persistir', async () => {
    const repo = { findMany: async () => [], findById: async () => existing, update: async () => { throw new Error('no debe llegar') } } as any
    const { port, ops } = makePromoPort({ valid: false, reason: 'max_uses_reached' })
    await expect(updateReservation(repo, noopLogger, noopCache, noopSockets, 'r1', { promoCode: 'MALO' } as any, user, undefined, undefined, undefined, port))
      .rejects.toThrow(/inválido/i)
    expect(ops).toEqual([])
  })

  it('(12) mismo código → no consume ni libera (idempotente)', async () => {
    const repo = { findMany: async () => [], findById: async () => existing, update: async (id: string, p: any) => ({ ...existing, ...p }) } as any
    const { port, ops } = makePromoPort()
    await updateReservation(repo, noopLogger, noopCache, noopSockets, 'r1', { promoCode: 'VIEJO' } as any, user, undefined, undefined, undefined, port)
    expect(ops).toEqual([])
  })
})
