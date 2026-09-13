// bookingengine/tests/public-meal-plans.test.ts — tasks.md 2.2/2.4 (solmi-direct-booking-qa-fixes)
// + catálogo abierto (#360).
//
// Cubre GET /api/public/hotels/:slug/meal-plans a nivel usecase, y las piezas puras de
// `usecases/public-meal-plan-lines.ts` que comparten `/rates` y `/booking`
// (`resolveMealPlanLine`, `buildPublicMealPlans`, `visibleMealPlans`).
//
// Aceptancia (#360): solo regímenes activos, con `name`/`description`, ordenados por
// `sortOrder` ASC y luego `createdAt` ASC. `room_only` es una fila normal (ya no se antepone a
// mano ni se filtra). `booking_config.showMealPlans === false` → 200 `[]`.
//
// Casos:
//  (1) Happy path — solo los activos, shape {code, name, description, priceMode, price}.
//  (2) active=false se excluye.
//  (3) Hotel inexistente/pausado → 404.
//  (4) Hotel sin filas → array vacío (200, no 404) — no se inventa "Solo alojamiento".
//  (5) Orden por sortOrder y luego createdAt, independiente del orden de la DB.
//  (6) Fila legacy sin name → name por LEGACY_NAMES; code custom → su name.
//  (7) showMealPlans:false → [] (200); sin fila de config / showMealPlans ausente → lista normal.
//  (8) resolveMealPlanLine: line.name; room_only con fila → línea included total 0; room_only sin
//      fila → line null; catálogo oculto (visibleMealPlans) → rechaza un code activo.
//  (9) buildPublicMealPlans: name/description + orden por sortOrder.
import { describe, it, expect } from 'bun:test'
import { getPublicMealPlans } from '../usecases/public-meal-plans'
import {
  buildPublicMealPlans, resolveMealPlanLine, visibleMealPlans, ROOM_ONLY_CODE,
} from '../usecases/public-meal-plan-lines'
import type { MealPlanDTO } from '../types'

const baseMealPlan = (overrides: Partial<MealPlanDTO> = {}): MealPlanDTO => ({
  id: 'mp1', hotelId: 'h1', code: 'breakfast', name: 'Desayuno incluido', description: '', sortOrder: 0,
  active: true, priceMode: 'included', price: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const makeDeps = (hotel: any, mealPlans: MealPlanDTO[], bookingConfig?: any | null) => ({
  hotels: { findOne: async () => hotel } as any,
  mealPlans: { findMany: async () => mealPlans } as any,
  ...(bookingConfig === undefined ? {} : { bookingConfig: { findOne: async () => bookingConfig } as any }),
})

const activeHotel = { id: 'h1', slug: 'caribe', onlineBookingStatus: 'active' }

describe('getPublicMealPlans — tasks.md 2.2/2.4 + #360', () => {
  it('happy path: solo los activos, shape {code, name, description, priceMode, price}', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp3', code: 'all_inclusive', name: 'Todo incluido', sortOrder: 3, active: true, priceMode: 'per_person_per_night', price: 60 }),
      baseMealPlan({ id: 'mp0', code: 'room_only', name: 'Solo alojamiento', sortOrder: 0, active: true }),
      baseMealPlan({ id: 'mp1', code: 'breakfast', name: 'Desayuno incluido', sortOrder: 1, active: true }),
      baseMealPlan({ id: 'mp2', code: 'half_board', name: 'Desayuno y cena', description: 'Desayuno buffet y cena a la carta', sortOrder: 2, active: true, priceMode: 'per_person_per_night', price: 25 }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    // room_only es una fila más: sale en su posición, no se antepone ni se filtra.
    expect(res.body.map((m: any) => m.code)).toEqual(['room_only', 'breakfast', 'half_board', 'all_inclusive'])
    // Shape: solo code/name/description/priceMode/price — sin id/hotelId/timestamps.
    expect(res.body[2]).toEqual({
      code: 'half_board', name: 'Desayuno y cena', description: 'Desayuno buffet y cena a la carta',
      priceMode: 'per_person_per_night', price: 25,
    })
    expect(res.body[0]).toEqual({ code: 'room_only', name: 'Solo alojamiento', description: '', priceMode: 'included', price: 0 })
  })

  it('active=false se excluye', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp1', code: 'breakfast', active: true }),
      baseMealPlan({ id: 'mp2', code: 'half_board', active: false }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.body.map((m: any) => m.code)).toEqual(['breakfast'])
  })

  it('hotel inexistente → 404', async () => {
    const deps = makeDeps(null, [])
    const res = await getPublicMealPlans(deps as any, 'no-existe')
    expect(res.status).toBe(404)
  })

  it('hotel pausado → MISMO 404', async () => {
    const deps = makeDeps({ ...activeHotel, onlineBookingStatus: 'paused' }, [
      baseMealPlan({ active: true }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(404)
  })

  it('hotel sin filas configuradas → array vacío (200) — no inventa "Solo alojamiento" acá', async () => {
    const deps = makeDeps(activeHotel, [])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('orden por sortOrder ASC y luego createdAt ASC, independiente del orden en que llegan de la DB', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'c', code: 'cena_gourmet', name: 'Cena gourmet', sortOrder: 5, createdAt: '2026-03-01T00:00:00Z' }),
      baseMealPlan({ id: 'b', code: 'brunch', name: 'Brunch', sortOrder: 1, createdAt: '2026-02-01T00:00:00Z' }),
      // Mismo sortOrder que brunch pero creado antes → va primero.
      baseMealPlan({ id: 'a', code: 'all_inclusive', name: 'Todo incluido', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' }),
      baseMealPlan({ id: 'r', code: 'room_only', name: 'Solo alojamiento', sortOrder: 0, createdAt: '2026-04-01T00:00:00Z' }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.body.map((m: any) => m.code)).toEqual(['room_only', 'all_inclusive', 'brunch', 'cena_gourmet'])
  })

  it('fila legacy sin name → name por LEGACY_NAMES; code custom → su propio name', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp1', code: 'breakfast', name: undefined as any, description: undefined as any, sortOrder: 0 }),
      baseMealPlan({ id: 'mp2', code: 'pension_vip', name: 'Pensión VIP', description: 'Con vinos', sortOrder: 1, priceMode: 'per_person_per_night', price: 80 }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.body).toEqual([
      { code: 'breakfast', name: 'Desayuno incluido', description: '', priceMode: 'included', price: 0 },
      { code: 'pension_vip', name: 'Pensión VIP', description: 'Con vinos', priceMode: 'per_person_per_night', price: 80 },
    ])
  })

  describe('booking_config.showMealPlans (#360)', () => {
    const rows = [
      baseMealPlan({ id: 'mp0', code: 'room_only', name: 'Solo alojamiento', sortOrder: 0 }),
      baseMealPlan({ id: 'mp1', code: 'breakfast', sortOrder: 1 }),
    ]

    it('showMealPlans:false → 200 [] (catálogo tratado como vacío, el motor sigue abierto)', async () => {
      const deps = makeDeps(activeHotel, rows, { hotelId: 'h1', enabled: true, showMealPlans: false })
      const res = await getPublicMealPlans(deps as any, 'caribe')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('showMealPlans:true → lista normal', async () => {
      const deps = makeDeps(activeHotel, rows, { hotelId: 'h1', enabled: true, showMealPlans: true })
      const res = await getPublicMealPlans(deps as any, 'caribe')
      expect(res.body.map((m: any) => m.code)).toEqual(['room_only', 'breakfast'])
    })

    it('showMealPlans ausente en la fila (config vieja) → visible por default', async () => {
      const deps = makeDeps(activeHotel, rows, { hotelId: 'h1', enabled: true })
      const res = await getPublicMealPlans(deps as any, 'caribe')
      expect(res.body.map((m: any) => m.code)).toEqual(['room_only', 'breakfast'])
    })

    it('sin fila de booking_config → visible por default', async () => {
      const deps = makeDeps(activeHotel, rows, null)
      const res = await getPublicMealPlans(deps as any, 'caribe')
      expect(res.body).toHaveLength(2)
    })
  })
})

describe('resolveMealPlanLine — #360 catálogo abierto', () => {
  const catalog = [
    baseMealPlan({ id: 'mp0', code: 'room_only', name: 'Solo alojamiento', sortOrder: 0 }),
    baseMealPlan({ id: 'mp1', code: 'breakfast', name: 'Desayuno incluido', sortOrder: 1 }),
    baseMealPlan({ id: 'mp2', code: 'pension_vip', name: 'Pensión VIP', sortOrder: 2, priceMode: 'per_person_per_night', price: 30 },
    ),
    baseMealPlan({ id: 'mp3', code: 'all_inclusive', name: 'Todo incluido', sortOrder: 3, active: false }),
  ]

  it('code activo → line con name (snapshot), precio del catálogo y total persons × nights', () => {
    const r = resolveMealPlanLine(catalog, 'pension_vip', 'h1', 2, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line).toEqual({
      code: 'pension_vip', name: 'Pensión VIP', priceMode: 'per_person_per_night', unitPrice: 30,
      persons: 2, nights: 3, total: 180,
    })
  })

  it('fila legacy sin name → line.name por LEGACY_NAMES', () => {
    const r = resolveMealPlanLine([baseMealPlan({ code: 'half_board', name: undefined as any })], 'half_board', 'h1', 2, 1)
    expect(r.ok && r.line?.name).toBe('Desayuno y cena')
  })

  it('room_only CON fila activa → línea real (included, total 0), no null', () => {
    const r = resolveMealPlanLine(catalog, ROOM_ONLY_CODE, 'h1', 2, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line).toEqual({
      code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', unitPrice: 0, persons: 2, nights: 3, total: 0,
    })
  })

  it('room_only SIN fila en el catálogo → line null (compat con widgets/reservas viejas)', () => {
    const sinRoomOnly = catalog.filter((m) => m.code !== 'room_only')
    expect(resolveMealPlanLine(sinRoomOnly, 'room_only', 'h1', 2, 3)).toEqual({ ok: true, line: null })
    // Fila room_only inactiva → también null (no es "unavailable": es "sin régimen").
    const inactiva = catalog.map((m) => (m.code === 'room_only' ? { ...m, active: false } : m))
    expect(resolveMealPlanLine(inactiva, 'room_only', 'h1', 2, 3)).toEqual({ ok: true, line: null })
  })

  it('sin code / vacío → line null', () => {
    expect(resolveMealPlanLine(catalog, undefined, 'h1', 2, 3)).toEqual({ ok: true, line: null })
    expect(resolveMealPlanLine(catalog, '   ', 'h1', 2, 3)).toEqual({ ok: true, line: null })
  })

  it('inactivo / inexistente / de otro hotel → meal_plan_unavailable', () => {
    expect(resolveMealPlanLine(catalog, 'all_inclusive', 'h1', 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })
    expect(resolveMealPlanLine(catalog, 'no_existe', 'h1', 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })
    expect(resolveMealPlanLine(catalog, 'breakfast', 'h-otro', 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })
  })

  it('catálogo oculto (visibleMealPlans con showMealPlans:false) → rechaza un code activo', () => {
    const hidden = visibleMealPlans(catalog, { showMealPlans: false })
    expect(hidden).toEqual([])
    expect(resolveMealPlanLine(hidden, 'breakfast', 'h1', 2, 3)).toEqual({ ok: false, reason: 'meal_plan_unavailable' })
    // room_only con catálogo oculto → "sin régimen" (compat): la reserva pasa sin línea.
    expect(resolveMealPlanLine(hidden, 'room_only', 'h1', 2, 3)).toEqual({ ok: true, line: null })
  })

  it('visibleMealPlans: showMealPlans true/ausente o sin config → catálogo tal cual', () => {
    expect(visibleMealPlans(catalog, { showMealPlans: true })).toBe(catalog)
    expect(visibleMealPlans(catalog, {})).toBe(catalog)
    expect(visibleMealPlans(catalog, null)).toBe(catalog)
    expect(visibleMealPlans(catalog, undefined)).toBe(catalog)
  })
})

describe('buildPublicMealPlans — #360 name/description + orden por sortOrder', () => {
  it('cada ítem trae name/description y sale ordenado por sortOrder/createdAt', () => {
    const items = buildPublicMealPlans([
      baseMealPlan({ id: 'b', code: 'breakfast', name: 'Desayuno incluido', description: 'Buffet', sortOrder: 1 }),
      baseMealPlan({ id: 'r', code: 'room_only', name: 'Solo alojamiento', sortOrder: 0 }),
      baseMealPlan({ id: 'v', code: 'pension_vip', name: 'Pensión VIP', sortOrder: 2, priceMode: 'per_person_per_night', price: 30 }),
      baseMealPlan({ id: 'x', code: 'all_inclusive', sortOrder: 3, active: false }),
      baseMealPlan({ id: 'o', hotelId: 'h-otro', code: 'brunch', sortOrder: 0 }),
    ], 'h1', 2, 3)
    expect(items.map((m) => m.code)).toEqual(['room_only', 'breakfast', 'pension_vip'])
    expect(items[1]).toEqual({
      code: 'breakfast', name: 'Desayuno incluido', description: 'Buffet', priceMode: 'included', price: 0,
      persons: 2, nights: 3, perNight: 0, totalForStay: 0,
    })
    expect(items[2]).toEqual({
      code: 'pension_vip', name: 'Pensión VIP', description: '', priceMode: 'per_person_per_night', price: 30,
      persons: 2, nights: 3, perNight: 60, totalForStay: 180,
    })
  })
})
