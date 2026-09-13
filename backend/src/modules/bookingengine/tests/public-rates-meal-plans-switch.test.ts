// bookingengine/tests/public-rates-meal-plans-switch.test.ts — #361: el motor público sólo ve el
// catálogo de regímenes con `booking_config.showMealPlans` encendido, y trabaja con nombres.
//
// Unit sobre `public-meal-plan-lines.ts` (los helpers que `/meal-plans`, `/rates` y los POST
// comparten) + `getPublicRates` de punta a punta con el switch:
//  (a) `visibleMealPlanCatalog`: off / sin fila → []; on (true/1/'1') → activos en LEGACY_ORDER + createdAt.
//  (b) `buildPublicMealPlans` sobre el catálogo visible: off → []; on → con `name`/`description`
//      y `totalForStay`.
//  (c) `resolveMealPlanLine`: fila `room_only` visible → línea con `name` (y precio); sin fila
//      → `null`; código sin fila visible → `meal_plan_unavailable`; vacío → `null` siempre.
//  (d) `getPublicRates` → `mealPlans: []` con el switch apagado y el catálogo con nombres con
//      el switch encendido.
import { describe, it, expect } from 'bun:test'
import {
  visibleMealPlanCatalog, activeMealPlanCatalog, buildPublicMealPlans, resolveMealPlanLine, MEAL_PLAN_CODE_ORDER,
} from '../usecases/public-meal-plan-lines'
import { LEGACY_ORDER } from '../usecases/meal-plans-crud'
import { getPublicRates } from '../usecases/public-rates'

const HOTEL_ID = 'h1'

const row = (o: Partial<any> = {}) => ({
  id: `mp-${o.code ?? 'x'}`, hotelId: HOTEL_ID, code: 'breakfast', name: 'Desayuno', description: null,
  active: true, priceMode: 'included', price: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...o,
})

const ROWS = [
  row({ code: 'vegano', name: 'Menú vegano', createdAt: '2026-03-02T00:00:00Z', priceMode: 'per_person_per_night', price: 12 }),
  row({ code: 'all_inclusive', name: 'Todo incluido', active: false, priceMode: 'per_person_per_night', price: 60 }),
  row({ code: 'half_board', name: 'Desayuno y cena', description: 'Buffet', priceMode: 'per_person_per_night', price: 25 }),
  row({ code: 'brunch', name: 'Brunch', createdAt: '2026-03-01T00:00:00Z' }),
  row({ code: 'breakfast', name: 'Desayuno incluido' }),
  row({ code: 'room_only', name: 'Solo alojamiento', description: 'Sin comidas incluidas', priceMode: 'per_person_per_night', price: 5 }),
]

describe('visibleMealPlanCatalog — #361 switch showMealPlans', () => {
  it('switch apagado, sin fila de config o valor raro → []', () => {
    expect(visibleMealPlanCatalog({ showMealPlans: false }, ROWS)).toEqual([])
    expect(visibleMealPlanCatalog(null, ROWS)).toEqual([])
    expect(visibleMealPlanCatalog(undefined, ROWS)).toEqual([])
    expect(visibleMealPlanCatalog({}, ROWS)).toEqual([])
    expect(visibleMealPlanCatalog({ showMealPlans: 0 }, ROWS)).toEqual([])
    expect(visibleMealPlanCatalog({ showMealPlans: 'true' }, ROWS)).toEqual([])
  })

  it('switch encendido (true / 1 / "1") → sólo activos, LEGACY_ORDER primero y después createdAt', () => {
    const expected = ['room_only', 'breakfast', 'half_board', 'brunch', 'vegano']
    for (const on of [true, 1, '1']) {
      expect(visibleMealPlanCatalog({ showMealPlans: on }, ROWS).map((m) => m.code)).toEqual(expected)
    }
    // No muta el array de entrada ni deja el inactivo.
    expect(ROWS.map((m) => m.code)[0]).toBe('vegano')
    expect(visibleMealPlanCatalog({ showMealPlans: true }, ROWS).some((m) => m.code === 'all_inclusive')).toBe(false)
  })

  it('MEAL_PLAN_CODE_ORDER es LEGACY_ORDER (room_only primero) y activeMealPlanCatalog ignora el switch', () => {
    expect(MEAL_PLAN_CODE_ORDER).toBe(LEGACY_ORDER)
    expect(activeMealPlanCatalog(ROWS).map((m) => m.code)).toEqual(['room_only', 'breakfast', 'half_board', 'brunch', 'vegano'])
    expect(visibleMealPlanCatalog({ showMealPlans: true }, [])).toEqual([])
  })
})

describe('buildPublicMealPlans sobre el catálogo visible', () => {
  it('switch apagado → []', () => {
    expect(buildPublicMealPlans(visibleMealPlanCatalog({ showMealPlans: false }, ROWS), HOTEL_ID, 2, 3)).toEqual([])
  })

  it('switch encendido → activos ordenados con name/description y totalForStay', () => {
    const items = buildPublicMealPlans(visibleMealPlanCatalog({ showMealPlans: true }, ROWS), HOTEL_ID, 2, 3)
    expect(items.map((m) => m.code)).toEqual(['room_only', 'breakfast', 'half_board', 'brunch', 'vegano'])
    expect(items[0]).toEqual({
      code: 'room_only', name: 'Solo alojamiento', description: 'Sin comidas incluidas',
      priceMode: 'per_person_per_night', price: 5, persons: 2, nights: 3, perNight: 10, totalForStay: 30,
    })
    expect(items[1]).toEqual({
      code: 'breakfast', name: 'Desayuno incluido', description: null,
      priceMode: 'included', price: 0, persons: 2, nights: 3, perNight: 0, totalForStay: 0,
    })
    expect(items[2]).toMatchObject({ code: 'half_board', name: 'Desayuno y cena', description: 'Buffet', totalForStay: 150 })
  })

  it('filtra por hotel aunque el catálogo traiga filas ajenas', () => {
    const rows = [...ROWS, row({ code: 'breakfast', hotelId: 'h2', name: 'Ajeno', id: 'mp-ajeno' })]
    const items = buildPublicMealPlans(visibleMealPlanCatalog({ showMealPlans: true }, rows), HOTEL_ID, 1, 1)
    expect(items.filter((m) => m.code === 'breakfast')).toHaveLength(1)
    expect(items.find((m) => m.code === 'breakfast')!.name).toBe('Desayuno incluido')
  })
})

describe('resolveMealPlanLine — fila room_only visible vs sin fila (#361)', () => {
  const visible = visibleMealPlanCatalog({ showMealPlans: true }, ROWS)

  it('fila room_only visible con precio → línea con name y total', () => {
    const r = resolveMealPlanLine(visible, 'room_only', HOTEL_ID, 3, 2)
    expect(r.ok).toBe(true)
    expect((r as any).line).toEqual({
      code: 'room_only', name: 'Solo alojamiento', priceMode: 'per_person_per_night', unitPrice: 5, persons: 3, nights: 2, total: 30,
    })
  })

  it('room_only sin fila visible (switch apagado / fila ausente) → line null', () => {
    expect(resolveMealPlanLine(visibleMealPlanCatalog({ showMealPlans: false }, ROWS), 'room_only', HOTEL_ID, 2, 3)).toEqual({ ok: true, line: null })
    const sinFila = visible.filter((m) => m.code !== 'room_only')
    expect(resolveMealPlanLine(sinFila, 'room_only', HOTEL_ID, 2, 3)).toEqual({ ok: true, line: null })
    expect(resolveMealPlanLine([], 'room_only', HOTEL_ID, 2, 3)).toEqual({ ok: true, line: null })
  })

  it('code vacío → null siempre (aunque la fila room_only visible tenga precio)', () => {
    expect(resolveMealPlanLine(visible, '', HOTEL_ID, 2, 3)).toEqual({ ok: true, line: null })
    expect(resolveMealPlanLine(visible, undefined, HOTEL_ID, 2, 3)).toEqual({ ok: true, line: null })
    expect(resolveMealPlanLine(visible, '  ', HOTEL_ID, 2, 3)).toEqual({ ok: true, line: null })
  })

  it('cualquier otro code sin fila visible → meal_plan_unavailable; con fila visible → línea con name', () => {
    expect(resolveMealPlanLine(visibleMealPlanCatalog({ showMealPlans: false }, ROWS), 'breakfast', HOTEL_ID, 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })
    expect(resolveMealPlanLine(visible, 'all_inclusive', HOTEL_ID, 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })
    expect(resolveMealPlanLine(visible, 'no_existe', HOTEL_ID, 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })
    expect(resolveMealPlanLine(visible, 'breakfast', 'h2', 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })

    const r = resolveMealPlanLine(visible, 'vegano', HOTEL_ID, 2, 3)
    expect((r as any).line).toMatchObject({ code: 'vegano', name: 'Menú vegano', unitPrice: 12, total: 72 })
    const inc = resolveMealPlanLine(visible, 'breakfast', HOTEL_ID, 2, 3)
    expect((inc as any).line).toMatchObject({ code: 'breakfast', name: 'Desayuno incluido', priceMode: 'included', unitPrice: 0, total: 0 })
  })

  it('fila sin name → line.name vacío (el caller cae a la etiqueta por código)', () => {
    const r = resolveMealPlanLine([row({ code: 'breakfast', name: '   ' })], 'breakfast', HOTEL_ID, 1, 1)
    expect((r as any).line.name).toBe('')
  })
})

describe('getPublicRates → mealPlans[] respeta el switch (#361)', () => {
  const HOTEL = { id: HOTEL_ID, slug: 'caribe', onlineBookingStatus: 'active', currency: 'USD', taxRate: 0 }
  const query = { checkIn: '2026-09-10', checkOut: '2026-09-13', guests: 2 }

  function deps(bookingConfig: any) {
    return {
      hotels: { findOne: async (f: any) => (f.slug === HOTEL.slug ? HOTEL : null) } as any,
      availability: {
        checkAvailability: async () => ({
          hotelId: HOTEL_ID, hotelName: 'Caribe', checkIn: query.checkIn, checkOut: query.checkOut, nights: 3,
          roomTypes: [{ roomType: 'standard', available: 1, price: 100, currency: 'USD', capacity: 3, surfaceArea: 20, amenities: [] }],
        }),
      },
      config: { findOne: async () => null, findMany: async () => [] } as any,
      bookingConfig: { findOne: async () => bookingConfig } as any,
      mealPlans: { findMany: async () => ROWS } as any,
    }
  }

  it('switch apagado → mealPlans: [] (200)', async () => {
    const res = await getPublicRates(deps({ hotelId: HOTEL_ID, enabled: true, showMealPlans: false }) as any, 'caribe', query)
    expect(res.status).toBe(200)
    expect(res.body.mealPlans).toEqual([])
  })

  it('hotel sin fila de booking_config → mealPlans: []', async () => {
    const res = await getPublicRates(deps(null) as any, 'caribe', query)
    expect(res.status).toBe(200)
    expect(res.body.mealPlans).toEqual([])
  })

  it('switch encendido → activos con name, en orden, totalForStay para guests × nights', async () => {
    const res = await getPublicRates(deps({ hotelId: HOTEL_ID, enabled: true, showMealPlans: true }) as any, 'caribe', query)
    expect(res.status).toBe(200)
    expect(res.body.mealPlans.map((m: any) => m.code)).toEqual(['room_only', 'breakfast', 'half_board', 'brunch', 'vegano'])
    expect(res.body.mealPlans[0]).toMatchObject({ code: 'room_only', name: 'Solo alojamiento', persons: 2, nights: 3, totalForStay: 30 })
    expect(res.body.mealPlans[2]).toMatchObject({ code: 'half_board', name: 'Desayuno y cena', description: 'Buffet', totalForStay: 150 })
  })
})
