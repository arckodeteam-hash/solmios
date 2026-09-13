// shared/usecases/meal-plan-labels.test.ts — #360: `mealPlanLabel(code, lang, name?)` prefiere el
// nombre congelado al reservar (`reservations.mealPlanName`) y cae a la tabla legacy por código
// cuando no viene (reservas anteriores a la columna). `hasMealPlan` no cambia: `room_only`/vacío
// siguen siendo "sin régimen" para el correo y el recibo.
import { describe, it, expect } from 'bun:test'
import { hasMealPlan, mealPlanLabel, ROOM_ONLY } from './meal-plan-labels'

describe('mealPlanLabel — #360 nombre del catálogo (snapshot) sobre la etiqueta legacy', () => {
  it('con name devuelve el name tal cual, en cualquier idioma y para cualquier code', () => {
    expect(mealPlanLabel('breakfast', 'es', 'Desayuno buffet')).toBe('Desayuno buffet')
    expect(mealPlanLabel('breakfast', 'en', 'Desayuno buffet')).toBe('Desayuno buffet')
    expect(mealPlanLabel('pension_gourmet', 'pt', 'Pensión gourmet')).toBe('Pensión gourmet')
    // Incluso `room_only` como fila real del catálogo con nombre propio.
    expect(mealPlanLabel('room_only', 'en', 'Sólo habitación')).toBe('Sólo habitación')
  })

  it('name con espacios se recorta; name vacío/blanco/null/undefined cae al legacy', () => {
    expect(mealPlanLabel('breakfast', 'es', '  Desayuno buffet  ')).toBe('Desayuno buffet')
    expect(mealPlanLabel('breakfast', 'es', '')).toBe('Desayuno')
    expect(mealPlanLabel('breakfast', 'es', '   ')).toBe('Desayuno')
    expect(mealPlanLabel('breakfast', 'es', null)).toBe('Desayuno')
    expect(mealPlanLabel('breakfast', 'es', undefined)).toBe('Desayuno')
  })

  it('sin name: tabla legacy por idioma (comportamiento anterior a #360)', () => {
    expect(mealPlanLabel('breakfast', 'es')).toBe('Desayuno')
    expect(mealPlanLabel('half_board', 'en')).toBe('Half board')
    expect(mealPlanLabel('all_inclusive', 'pt')).toBe('Tudo incluído')
    expect(mealPlanLabel('breakfast')).toBe('Desayuno')
  })

  it('sin name y code desconocido → el code crudo (mejor que un hueco)', () => {
    expect(mealPlanLabel('pension_gourmet', 'es')).toBe('pension_gourmet')
    expect(mealPlanLabel('pension_gourmet', 'en')).toBe('pension_gourmet')
  })

  it('room_only / vacío sin name → ROOM_ONLY del idioma', () => {
    expect(mealPlanLabel('room_only', 'es')).toBe(ROOM_ONLY.es)
    expect(mealPlanLabel('room_only', 'en')).toBe(ROOM_ONLY.en)
    expect(mealPlanLabel('room_only', 'pt')).toBe(ROOM_ONLY.pt)
    expect(mealPlanLabel('', 'en')).toBe(ROOM_ONLY.en)
    expect(mealPlanLabel(null, 'pt')).toBe(ROOM_ONLY.pt)
    expect(mealPlanLabel(undefined)).toBe(ROOM_ONLY.es)
  })
})

describe('hasMealPlan — sigue igual (#360 no lo toca)', () => {
  it('room_only, vacío, null → false; cualquier otro code (legacy o custom) → true', () => {
    expect(hasMealPlan('room_only')).toBe(false)
    expect(hasMealPlan('')).toBe(false)
    expect(hasMealPlan('   ')).toBe(false)
    expect(hasMealPlan(null)).toBe(false)
    expect(hasMealPlan(undefined)).toBe(false)
    expect(hasMealPlan('breakfast')).toBe(true)
    expect(hasMealPlan('pension_gourmet')).toBe(true)
  })
})
