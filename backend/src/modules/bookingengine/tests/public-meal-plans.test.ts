// bookingengine/tests/public-meal-plans.test.ts — tasks.md 2.2/2.4 (solmi-direct-booking-qa-fixes)
// → #361 catálogo abierto + switch `booking_config.showMealPlans`.
//
// Cubre GET /api/public/hotels/:slug/meal-plans a nivel usecase.
//
// Aceptancia: con el switch ENCENDIDO, solo regímenes activos, con `name`/`description`, en
// `LEGACY_ORDER` (room_only, breakfast, half_board, all_inclusive) y después por `createdAt` —
// NO por sortOrder como upsells (acá no hay reorder). Con el switch APAGADO (o sin fila de
// config) → `[]`, aunque haya activos.
//
// Casos:
//  (1) Happy path — 3 configurados, solo los activos se listan, en orden fijo, con nombre.
//  (2) active=false se excluye.
//  (3) Hotel inexistente/pausado → 404.
//  (4) Hotel sin filas configuradas → array vacío (200, no 404).
//  (5) Orden fijo independiente del orden en que llegan de la DB; los no históricos al final
//      por createdAt.
//  (6) #361 switch apagado → [] con breakfast activo.
//  (7) #361 hotel sin fila de booking_config → [] (default off).
//  (8) #361 `room_only` es una fila real: si está activa se lista primero, con su precio.
//  (9) compat: sin repo `bookingConfig` cableado se lista el catálogo activo (callers viejos).
import { describe, it, expect } from 'bun:test'
import { getPublicMealPlans } from '../usecases/public-meal-plans'
import type { MealPlanDTO } from '../types'

const baseMealPlan = (overrides: Partial<MealPlanDTO> = {}): MealPlanDTO => ({
  id: 'mp1', hotelId: 'h1', code: 'breakfast', name: 'Desayuno incluido', description: null,
  active: true, priceMode: 'included', price: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const SHOW_ON = { hotelId: 'h1', enabled: true, showMealPlans: true }
const SHOW_OFF = { hotelId: 'h1', enabled: true, showMealPlans: false }

/** `bookingConfig === undefined` → repo NO cableado (compat); `null` → repo cableado sin fila. */
const makeDeps = (hotel: any, mealPlans: MealPlanDTO[], bookingConfig: any = SHOW_ON) => ({
  hotels: { findOne: async () => hotel } as any,
  mealPlans: { findMany: async () => mealPlans } as any,
  ...(bookingConfig === undefined ? {} : { bookingConfig: { findOne: async () => bookingConfig } as any }),
})

const activeHotel = { id: 'h1', slug: 'caribe', onlineBookingStatus: 'active' }

describe('getPublicMealPlans — tasks.md 2.2/2.4 (+ #361 switch)', () => {
  it('happy path: solo los activos, en orden fijo (breakfast, half_board, all_inclusive), con name/description', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp3', code: 'all_inclusive', name: 'Todo incluido', active: true, priceMode: 'per_person_per_night', price: 60 }),
      baseMealPlan({ id: 'mp1', code: 'breakfast', active: true }),
      baseMealPlan({ id: 'mp2', code: 'half_board', name: 'Media pensión', description: ' Desayuno y cena ', active: true, priceMode: 'per_person_per_night', price: 25 }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body.map((m: any) => m.code)).toEqual(['breakfast', 'half_board', 'all_inclusive'])
    // Shape: code/name/description/priceMode/price — sin id/hotelId/timestamps (nada interno sale).
    expect(res.body[1]).toEqual({ code: 'half_board', name: 'Media pensión', description: 'Desayuno y cena', priceMode: 'per_person_per_night', price: 25 })
    expect(res.body[0]).toEqual({ code: 'breakfast', name: 'Desayuno incluido', description: null, priceMode: 'included', price: 0 })
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

  it('hotel sin filas configuradas → array vacío (200)', async () => {
    const deps = makeDeps(activeHotel, [])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('orden fijo, independiente del orden en que llegan de la DB; códigos nuevos al final por createdAt', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp5', code: 'vegano', name: 'Menú vegano', createdAt: '2026-03-02T00:00:00Z' }),
      baseMealPlan({ id: 'mp2', code: 'half_board', name: 'Media pensión', active: true }),
      baseMealPlan({ id: 'mp4', code: 'brunch', name: 'Brunch', createdAt: '2026-03-01T00:00:00Z' }),
      baseMealPlan({ id: 'mp3', code: 'all_inclusive', name: 'Todo incluido', active: true }),
      baseMealPlan({ id: 'mp1', code: 'breakfast', active: true }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.body.map((m: any) => m.code)).toEqual(['breakfast', 'half_board', 'all_inclusive', 'brunch', 'vegano'])
  })

  // ─── #361 — switch `booking_config.showMealPlans` ───────────────────────────────────────
  it('#361 switch apagado → [] aunque breakfast esté activo (200, no 404)', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp1', code: 'breakfast', active: true }),
      baseMealPlan({ id: 'mp2', code: 'half_board', active: true }),
    ], SHOW_OFF)
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('#361 switch encendido → sólo activos, con name y description, en orden legacy', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp3', code: 'all_inclusive', name: 'Todo incluido', description: 'Comidas y bebidas', active: false }),
      baseMealPlan({ id: 'mp2', code: 'half_board', name: 'Desayuno y cena', active: true, priceMode: 'per_person_per_night', price: 30 }),
      baseMealPlan({ id: 'mp1', code: 'breakfast', name: 'Desayuno buffet', description: 'De 7 a 10', active: true }),
    ], SHOW_ON)
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { code: 'breakfast', name: 'Desayuno buffet', description: 'De 7 a 10', priceMode: 'included', price: 0 },
      { code: 'half_board', name: 'Desayuno y cena', description: null, priceMode: 'per_person_per_night', price: 30 },
    ])
  })

  it('#361 switch como 1 (sqlite) también enciende', async () => {
    const deps = makeDeps(activeHotel, [baseMealPlan({ active: true })], { hotelId: 'h1', showMealPlans: 1 })
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.body.map((m: any) => m.code)).toEqual(['breakfast'])
  })

  it('#361 hotel sin fila de booking_config → [] (default apagado)', async () => {
    const deps = makeDeps(activeHotel, [baseMealPlan({ id: 'mp1', code: 'breakfast', active: true })], null)
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('#361 room_only es una fila real: activa → primera, con su precio', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp1', code: 'breakfast', active: true }),
      baseMealPlan({ id: 'mp0', code: 'room_only', name: 'Solo alojamiento', description: 'Sin comidas incluidas', active: true, priceMode: 'per_person_per_night', price: 5 }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.body.map((m: any) => m.code)).toEqual(['room_only', 'breakfast'])
    expect(res.body[0]).toEqual({ code: 'room_only', name: 'Solo alojamiento', description: 'Sin comidas incluidas', priceMode: 'per_person_per_night', price: 5 })
  })

  it('compat: sin repo bookingConfig cableado se lista el catálogo activo (callers viejos)', async () => {
    const deps = makeDeps(activeHotel, [baseMealPlan({ active: true })], undefined)
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body.map((m: any) => m.code)).toEqual(['breakfast'])
  })
})
