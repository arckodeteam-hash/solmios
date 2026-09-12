// bookingengine/tests/upsell-pricing.test.ts — Matemática y topes de upsells por kind (MR-10 #275).
//
// Helper puro (`usecases/upsell-pricing.ts`), sin repos: se le pasa el catálogo ya leído.
//
// Casos:
//  (1) per_person_per_night: 10 × 2 personas × 3 noches = 60, qty forzado a 1, nights 3
//  (2) per_night: 15 × 3 noches = 45; qty:7 del cliente se ignora (no es error)
//  (3) per_person: qty 5 con 2 personas → upsell_quantity_out_of_range (max 2); qty 2 OK
//  (4) per_room: qty 3 con 3 habitaciones OK; qty 4 → error (max 3)
//  (5) per_stay: qty 2 → error (max 1)
//  (6) ids inexistentes / inactivos / de otro hotel se ignoran
//  (7) upsellMaxQuantity por kind
//  (8) total = suma redondeada de líneas; unitPrice × quantity × nights × persons reproduce total
import { describe, it, expect } from 'bun:test'
import { resolveUpsellLines, upsellMaxQuantity } from '../usecases/upsell-pricing'
import type { UpsellPricingContext } from '../usecases/upsell-pricing'
import type { UpsellDTO } from '../types'

const H = 'h1'
const ctx: UpsellPricingContext = { nights: 3, rooms: 3, persons: 2 }

function up(overrides: Partial<UpsellDTO>): UpsellDTO {
  return {
    id: 'up_x', hotelId: H, name: 'Extra', description: null,
    price: 10, kind: 'per_stay', active: true, sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const catalog: UpsellDTO[] = [
  up({ id: 'ppn', name: 'Desayuno', price: 10, kind: 'per_person_per_night' }),
  up({ id: 'night', name: 'Parking', price: 15, kind: 'per_night' }),
  up({ id: 'person', name: 'Transfer', price: 20, kind: 'per_person' }),
  up({ id: 'room', name: 'Decoración', price: 30, kind: 'per_room' }),
  up({ id: 'stay', name: 'Late checkout', price: 25, kind: 'per_stay' }),
  up({ id: 'inactive', name: 'Viejo', price: 99, kind: 'per_stay', active: false }),
  up({ id: 'foreign', name: 'Ajeno', price: 99, kind: 'per_stay', hotelId: 'h-OTRO' }),
]

describe('resolveUpsellLines (MR-10 #275)', () => {
  it('per_person_per_night: 10 × 2 personas × 3 noches = 60, qty forzado a 1', () => {
    const r = resolveUpsellLines(catalog, [{ id: 'ppn', quantity: 4 }], H, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ id: 'ppn', kind: 'per_person_per_night', unitPrice: 10, quantity: 1, nights: 3, persons: 2, total: 60 })
    expect(r.total).toBe(60)
  })

  it('per_night: 15 × 3 noches = 45; qty:7 del cliente se ignora', () => {
    const r = resolveUpsellLines(catalog, [{ id: 'night', quantity: 7 }], H, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines[0]).toMatchObject({ id: 'night', kind: 'per_night', unitPrice: 15, quantity: 1, nights: 3, total: 45 })
    expect(r.lines[0].persons).toBeUndefined()
    expect(r.total).toBe(45)
  })

  it('per_person: qty 5 con 2 personas → upsell_quantity_out_of_range (max 2)', () => {
    const r = resolveUpsellLines(catalog, [{ id: 'person', quantity: 5 }], H, ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r).toMatchObject({ error: 'upsell_quantity_out_of_range', upsellId: 'person', name: 'Transfer', kind: 'per_person', quantity: 5, max: 2 })
  })

  it('per_person: qty 2 con 2 personas OK → 20 × 2 = 40, nights 1', () => {
    const r = resolveUpsellLines(catalog, [{ id: 'person', quantity: 2 }], H, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines[0]).toMatchObject({ kind: 'per_person', unitPrice: 20, quantity: 2, nights: 1, total: 40 })
    expect(r.total).toBe(40)
  })

  it('per_room: qty 3 con 3 habitaciones OK; qty 4 → error (max 3)', () => {
    const ok = resolveUpsellLines(catalog, [{ id: 'room', quantity: 3 }], H, ctx)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.lines[0]).toMatchObject({ kind: 'per_room', quantity: 3, nights: 1, total: 90 })

    const bad = resolveUpsellLines(catalog, [{ id: 'room', quantity: 4 }], H, ctx)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad).toMatchObject({ error: 'upsell_quantity_out_of_range', upsellId: 'room', kind: 'per_room', quantity: 4, max: 3 })
  })

  it('per_stay: qty 2 → error (max 1); sin quantity → 1', () => {
    const bad = resolveUpsellLines(catalog, [{ id: 'stay', quantity: 2 }], H, ctx)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad).toMatchObject({ error: 'upsell_quantity_out_of_range', upsellId: 'stay', kind: 'per_stay', quantity: 2, max: 1 })

    const ok = resolveUpsellLines(catalog, [{ id: 'stay' }], H, ctx)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.lines[0]).toMatchObject({ quantity: 1, nights: 1, total: 25 })
  })

  it('ids inexistentes / inactivos / de otro hotel se ignoran (no fail-fast)', () => {
    const r = resolveUpsellLines(
      catalog,
      [{ id: 'nope' }, { id: 'inactive' }, { id: 'foreign' }, { id: 'stay' }, null as any, { id: 42 } as any],
      H, ctx,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines.map((l) => l.id)).toEqual(['stay'])
    expect(r.total).toBe(25)
  })

  it('sin items → ok con lines [] y total 0', () => {
    const r = resolveUpsellLines(catalog, [], H, ctx)
    expect(r).toEqual({ ok: true, lines: [], total: 0 })
  })

  it('total = suma redondeada; cada línea reproduce unitPrice × quantity × nights × persons', () => {
    const r = resolveUpsellLines(
      catalog,
      [{ id: 'ppn' }, { id: 'night' }, { id: 'person', quantity: 2 }, { id: 'room', quantity: 3 }, { id: 'stay' }],
      H, ctx,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines).toHaveLength(5)
    for (const l of r.lines) {
      expect(l.total).toBe(Math.round(l.unitPrice * l.quantity * l.nights * (l.persons ?? 1) * 100) / 100)
    }
    expect(r.total).toBe(60 + 45 + 40 + 90 + 25)
  })

  it('redondea a 2 decimales (ppn 3.333 × 2 × 3)', () => {
    const cat = [up({ id: 'dec', price: 3.333, kind: 'per_person_per_night' })]
    const r = resolveUpsellLines(cat, [{ id: 'dec' }], H, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // unitPrice se redondea a 3.33 antes de multiplicar → 3.33 × 2 × 3 = 19.98
    expect(r.lines[0].unitPrice).toBe(3.33)
    expect(r.lines[0].total).toBe(19.98)
  })
})

describe('upsellMaxQuantity (MR-10 #275)', () => {
  it('per_room = habitaciones, per_person = personas, fijos = 1', () => {
    expect(upsellMaxQuantity('per_room', ctx)).toBe(3)
    expect(upsellMaxQuantity('per_person', ctx)).toBe(2)
    expect(upsellMaxQuantity('per_stay', ctx)).toBe(1)
    expect(upsellMaxQuantity('per_night', ctx)).toBe(1)
    expect(upsellMaxQuantity('per_person_per_night', ctx)).toBe(1)
  })

  it('ctx inválido (NaN/negativo) no habilita topes negativos', () => {
    expect(upsellMaxQuantity('per_person', { nights: 1, rooms: 1, persons: NaN })).toBe(0)
    expect(upsellMaxQuantity('per_room', { nights: 1, rooms: -2, persons: 1 })).toBe(0)
  })
})
