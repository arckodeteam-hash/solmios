// meal-plans.test.ts — MR-03 (#268): la regla ÚNICA del régimen que muestra el panel y el mapa
// único de etiquetas (antes 6 copias con textos distintos y la prioridad al revés). #361: el
// catálogo es abierto — el NOMBRE persistido (`mealPlanName`) manda sobre el mapa legacy.
import { describe, it, expect } from 'vitest'
import {
  effectiveMealPlan, hasMealPlan, mealPlanLabel, mealPlanLabelKey, MEAL_PLAN_LABELS, MEAL_PLAN_LABEL_KEY,
  reservationMealPlanLabel, publicMealPlanLabel,
} from './meal-plans'

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

describe('mealPlanLabel — etiquetas LEGACY del panel (fallback para códigos históricos)', () => {
  it('cubre los 5 códigos históricos de `regime` (incluido full_board, que solo existe cargado a mano)', () => {
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

describe('MEAL_PLAN_LABEL_KEY — keys i18n LEGACY del widget', () => {
  it('solo los códigos históricos reservables (+ room_only); full_board y un código nuevo no tienen key', () => {
    expect(Object.keys(MEAL_PLAN_LABEL_KEY).sort()).toEqual(['all_inclusive', 'breakfast', 'half_board', 'room_only'])
    expect(mealPlanLabelKey('breakfast')).toBe('rooms.board.breakfast')
    expect(mealPlanLabelKey('full_board')).toBeUndefined()
    expect(mealPlanLabelKey('x_custom')).toBeUndefined()
    expect(mealPlanLabelKey(null)).toBeUndefined()
  })
})

describe('reservationMealPlanLabel (#361) — el nombre persistido manda; `regime` editado a mano gana', () => {
  it('(d) código nuevo del catálogo abierto con nombre persistido → el nombre, nunca el código', () => {
    expect(reservationMealPlanLabel({ mealPlan: 'x_custom', mealPlanName: 'Pensión gourmet' })).toBe('Pensión gourmet')
    // `regime` igual al snapshot (el motor escribe los dos): sigue siendo el nombre
    expect(reservationMealPlanLabel({ regime: 'x_custom', mealPlan: 'x_custom', mealPlanName: 'Pensión gourmet' })).toBe('Pensión gourmet')
    // `regime` vacío cuenta como ausente
    expect(reservationMealPlanLabel({ regime: '', mealPlan: 'x_custom', mealPlanName: 'Pensión gourmet' })).toBe('Pensión gourmet')
  })

  it('(d) recepción editó `regime` a un código distinto: manda el código editado con su etiqueta legacy', () => {
    expect(reservationMealPlanLabel({ regime: 'breakfast', mealPlan: 'x_custom', mealPlanName: 'Pensión gourmet' })).toBe('Desayuno incluido')
    expect(reservationMealPlanLabel({ regime: 'room_only', mealPlan: 'x_custom', mealPlanName: 'Pensión gourmet' })).toBe('Solo alojamiento')
  })

  it('(d) reserva vieja sin nombre → etiqueta legacy del código; código desconocido sin nombre → crudo', () => {
    expect(reservationMealPlanLabel({ mealPlan: 'breakfast' })).toBe('Desayuno incluido')
    expect(reservationMealPlanLabel({ regime: 'half_board' })).toBe('Media pensión')
    expect(reservationMealPlanLabel({ mealPlan: 'brunch', mealPlanName: '   ' })).toBe('brunch')
  })

  it('room_only como fila del catálogo con nombre propio → ese nombre', () => {
    expect(reservationMealPlanLabel({ regime: 'room_only', mealPlan: 'room_only', mealPlanName: 'Sólo habitación' })).toBe('Sólo habitación')
  })

  it('sin régimen → fallback ("—" por defecto)', () => {
    expect(reservationMealPlanLabel({ mealPlanName: 'Fantasma' })).toBe('—')
    expect(reservationMealPlanLabel({}, '')).toBe('')
    expect(reservationMealPlanLabel(null)).toBe('—')
    expect(reservationMealPlanLabel(undefined, 'n/a')).toBe('n/a')
  })
})

describe('publicMealPlanLabel (#361) — etiqueta del motor público: name → i18n legacy → código', () => {
  const t = (key: string) => `i18n:${key}`

  it('con nombre (trim) devuelve el nombre tal cual vino del catálogo', () => {
    expect(publicMealPlanLabel({ code: 'x_custom', name: 'Pensión gourmet' }, t)).toBe('Pensión gourmet')
    expect(publicMealPlanLabel({ code: 'breakfast', name: '  Desayuno buffet  ' }, t)).toBe('Desayuno buffet')
  })

  it('sin nombre: código histórico → su key i18n; código nuevo → el código crudo (nunca se oculta)', () => {
    expect(publicMealPlanLabel({ code: 'breakfast' }, t)).toBe('i18n:rooms.board.breakfast')
    expect(publicMealPlanLabel({ code: 'room_only', name: '' }, t)).toBe('i18n:rooms.board.roomOnly')
    expect(publicMealPlanLabel({ code: 'x_custom', name: null }, t)).toBe('x_custom')
  })
})
