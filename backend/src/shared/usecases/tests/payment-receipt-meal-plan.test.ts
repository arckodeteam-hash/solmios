// shared/usecases/tests/payment-receipt-meal-plan.test.ts — #361: línea "Régimen" del recibo cuando
// `room_only` es una fila del catálogo CON precio.
//
// Antes de #361 `room_only` era "sin régimen" y el recibo no mostraba línea. Ahora el hotel puede
// ponerle precio a "Solo alojamiento": si la fila trae `mealPlanTotal > 0` el huésped lo pagó y el
// desglose tiene que mostrarlo (si no, las líneas no suman el total). Sin cargo sigue sin línea.
import { describe, it, expect } from 'bun:test'
import { buildReceiptLines } from '../payment-receipt'
import { hasMealPlanCharge, reservationMealPlanLabel } from '../meal-plan-labels'

const BREAKDOWN = {
  subtotal: 300, promoDiscount: 0, upsellsTotal: 0, upsells: [],
  childAmenitiesTotal: 0, roomAmenitiesTotal: 0, mealPlanTotal: 0,
  taxes: 0, taxBreakdown: [], total: 300,
}

function reservation(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', roomId: 'room-1', totalAmount: 300, checkIn: '2026-09-12', checkOut: '2026-09-13',
    priceBreakdown: BREAKDOWN, mealPlan: 'room_only', mealPlanName: 'Solo alojamiento', mealPlanTotal: 0,
    ...over,
  } as any
}

function sumOf(lines: ReturnType<typeof buildReceiptLines>): number {
  return Math.round(lines.filter((l) => l.kind !== 'total').reduce((acc, l) => acc + l.amount, 0) * 100) / 100
}

describe('hasMealPlanCharge (#361)', () => {
  it('true con código real, o con cargo aunque el código sea room_only', () => {
    expect(hasMealPlanCharge({ mealPlan: 'breakfast', mealPlanTotal: 0 })).toBe(true)
    expect(hasMealPlanCharge({ mealPlan: 'room_only', mealPlanTotal: 45 })).toBe(true)
    expect(hasMealPlanCharge({ mealPlan: '', mealPlanTotal: '12' })).toBe(true)
  })
  it('false sin código y sin cargo (room_only / vacío / total inválido)', () => {
    expect(hasMealPlanCharge({ mealPlan: 'room_only', mealPlanTotal: 0 })).toBe(false)
    expect(hasMealPlanCharge({ mealPlan: 'room_only' })).toBe(false)
    expect(hasMealPlanCharge({ mealPlan: '', mealPlanTotal: 'abc' })).toBe(false)
    expect(hasMealPlanCharge(null)).toBe(false)
  })
  it('la etiqueta prefiere el nombre persistido, incluso para room_only', () => {
    expect(reservationMealPlanLabel({ mealPlan: 'room_only', mealPlanName: 'Solo alojamiento' }, 'en')).toBe('Solo alojamiento')
    expect(reservationMealPlanLabel({ mealPlan: 'room_only' }, 'en')).toBe('Room only')
    expect(reservationMealPlanLabel({ mealPlan: 'breakfast', mealPlanName: ' ' }, 'es')).toBe('Desayuno')
  })
})

describe('buildReceiptLines — room_only con precio (#361)', () => {
  it('room_only con mealPlanTotal 45 → línea Régimen de 45 y las líneas suman el total', () => {
    const lines = buildReceiptLines(reservation({
      totalAmount: 345,
      mealPlanPriceMode: 'per_person_per_night', mealPlanUnitPrice: 22.5, mealPlanPersons: 2, mealPlanTotal: 45,
      priceBreakdown: { ...BREAKDOWN, subtotal: 345, mealPlanTotal: 45, total: 345 },
    }))
    const meal = lines.find((l) => l.kind === 'meal_plan')!
    expect(meal).toBeDefined()
    expect(meal.amount).toBe(45)
    expect(meal.description).toBe('Régimen · Solo alojamiento · 2 personas × 1 noche')
    expect(meal.quantity).toBe(2)
    expect(meal.unitPrice).toBe(22.5)
    expect(lines.find((l) => l.kind === 'room')!.amount).toBe(300)
    expect(lines.find((l) => l.kind === 'total')!.amount).toBe(345)
    expect(sumOf(lines)).toBe(345)
  })

  it('room_only con total 0 sigue SIN línea de régimen', () => {
    const lines = buildReceiptLines(reservation({ mealPlanTotal: 0 }))
    expect(lines.map((l) => l.kind)).not.toContain('meal_plan')
    expect(sumOf(lines)).toBe(300)
  })

  it('en grupo, sólo las hermanas con cargo o régimen real llevan línea', () => {
    const lead = reservation({ groupId: 'g1', roomId: 'r1', totalAmount: 100, mealPlanTotal: 30, mealPlanUnitPrice: 15, mealPlanPersons: 2 })
    const sis = reservation({ id: 's2', groupId: 'g1', roomId: 'r2', totalAmount: 100, priceBreakdown: null, mealPlanTotal: 0 })
    const kinds = buildReceiptLines(lead, [lead, sis], []).map((l) => [l.kind, l.amount])
    expect(kinds.filter(([k]) => k === 'meal_plan')).toEqual([['meal_plan', 30]])
  })
})
