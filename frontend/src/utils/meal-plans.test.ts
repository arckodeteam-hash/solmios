// meal-plans.test.ts — MR-03 (#268): la regla ÚNICA del régimen que muestra el panel y el mapa
// único de etiquetas (antes 6 copias con textos distintos y la prioridad al revés).
import { describe, it, expect } from 'vitest'
import { effectiveMealPlan, hasMealPlan, mealPlanLabel, mealPlanLabelKey, mealPlanDisplayName, MEAL_PLAN_LABELS, MEAL_PLAN_LABEL_KEY } from './meal-plans'

describe('effectiveMealPlan — `regime` (editable) manda sobre `mealPlan` (snapshot web)', () => {
  it('reserva web recién creada: los dos iguales → ese código', () => {
    expect(effectiveMealPlan({ regime: 'breakfast', mealPlan: 'breakfast' })).toBe('breakfast')
  })

  it('recepción editó el régimen desde el panel: gana `regime`, no el snapshot', () => {
    expect(effectiveMealPlan({ regime: 'half_board', mealPlan: 'breakfast' })).toBe('half_board')
    // incluso si lo bajó a "solo alojamiento"
    expect(effectiveMealPlan({ regime: 'room_only', mealPlan: 'breakfast' })).toBe('room_only')
  })

  it('sin `regime` (null / vacío) cae al snapshot web', () => {
    expect(effectiveMealPlan({ regime: null, mealPlan: 'all_inclusive' })).toBe('all_inclusive')
    expect(effectiveMealPlan({ regime: '', mealPlan: 'all_inclusive' })).toBe('all_inclusive')
    expect(effectiveMealPlan({ mealPlan: 'all_inclusive' })).toBe('all_inclusive')
  })

  it('sin nada → null; reserva inexistente → null', () => {
    expect(effectiveMealPlan({ regime: null, mealPlan: null })).toBeNull()
    expect(effectiveMealPlan({})).toBeNull()
    expect(effectiveMealPlan(null)).toBeNull()
    expect(effectiveMealPlan(undefined)).toBeNull()
  })
})

describe('hasMealPlan — solo se anuncia lo que no es "solo alojamiento"', () => {
  it.each([['breakfast', true], ['half_board', true], ['full_board', true], ['all_inclusive', true], ['room_only', false], ['', false], [null, false], [undefined, false]])(
    '%s → %s', (code, expected) => { expect(hasMealPlan(code as string | null | undefined)).toBe(expected) },
  )
})

describe('mealPlanLabel — etiquetas del panel', () => {
  it('cubre los 5 códigos de `regime` (incluido full_board, que solo existe cargado a mano)', () => {
    expect(mealPlanLabel('room_only')).toBe('Solo alojamiento')
    expect(mealPlanLabel('breakfast')).toBe('Desayuno incluido')
    expect(mealPlanLabel('half_board')).toBe('Media pensión')
    expect(mealPlanLabel('full_board')).toBe('Pensión completa')
    expect(mealPlanLabel('all_inclusive')).toBe('Todo incluido')
    expect(Object.keys(MEAL_PLAN_LABELS)).toEqual(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'])
  })

  it('código desconocido se muestra crudo; sin código, el fallback ("—" por defecto)', () => {
    expect(mealPlanLabel('brunch')).toBe('brunch')
    expect(mealPlanLabel(null)).toBe('—')
    expect(mealPlanLabel(undefined, '')).toBe('')
  })
})

describe('MEAL_PLAN_LABEL_KEY — keys i18n legacy del widget', () => {
  it('solo los 4 códigos legacy (#360: fallback sin name); full_board y códigos custom NO tienen key', () => {
    expect(Object.keys(MEAL_PLAN_LABEL_KEY).sort()).toEqual(['all_inclusive', 'breakfast', 'half_board', 'room_only'])
    expect(mealPlanLabelKey('breakfast')).toBe('rooms.board.breakfast')
    expect(mealPlanLabelKey('full_board')).toBeUndefined()
    expect(mealPlanLabelKey('brunch_premium')).toBeUndefined()
    expect(mealPlanLabelKey(null)).toBeUndefined()
  })
})

describe('mealPlanDisplayName — nombre visible en el widget (#360, catálogo abierto)', () => {
  const t = (key: string) => `i18n:${key}`

  it('el name del catálogo/snapshot manda, incluso sobre un código legacy con key', () => {
    expect(mealPlanDisplayName('breakfast', 'Desayuno buffet', t)).toBe('Desayuno buffet')
    expect(mealPlanDisplayName('brunch_premium', 'Brunch premium', t)).toBe('Brunch premium')
    expect(mealPlanDisplayName('room_only', 'Solo alojamiento', t)).toBe('Solo alojamiento')
  })

  it('sin name (fila/reserva legacy): key i18n del código traducida con t', () => {
    expect(mealPlanDisplayName('breakfast', undefined, t)).toBe('i18n:rooms.board.breakfast')
    expect(mealPlanDisplayName('half_board', '', t)).toBe('i18n:rooms.board.halfBoard')
    expect(mealPlanDisplayName('room_only', '   ', t)).toBe('i18n:rooms.board.roomOnly')
  })

  it('sin name y sin key (código custom) → el código crudo, nunca se oculta; sin t tampoco se muestra la key', () => {
    expect(mealPlanDisplayName('brunch_premium', undefined, t)).toBe('brunch_premium')
    expect(mealPlanDisplayName('breakfast')).toBe('breakfast')
    expect(mealPlanDisplayName('breakfast', null)).toBe('breakfast')
  })

  it('sin código ni name → cadena vacía', () => {
    expect(mealPlanDisplayName(null, null, t)).toBe('')
    expect(mealPlanDisplayName(undefined)).toBe('')
    expect(mealPlanDisplayName('', '')).toBe('')
  })
})
