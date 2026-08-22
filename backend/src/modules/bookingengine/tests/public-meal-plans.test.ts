// bookingengine/tests/public-meal-plans.test.ts — tasks.md 2.2/2.4 (solmi-direct-booking-qa-fixes).
//
// Cubre GET /api/public/hotels/:slug/meal-plans a nivel usecase.
//
// Aceptancia: solo regímenes activos, en orden fijo (breakfast, half_board, all_inclusive) —
// NO por sortOrder como upsells (acá no hay reorder, el orden es siempre el mismo).
//
// Casos:
//  (1) Happy path — 3 configurados, solo los activos se listan, en orden fijo.
//  (2) active=false se excluye.
//  (3) Hotel inexistente/pausado → 404.
//  (4) Hotel sin filas configuradas → array vacío (200, no 404) — "Solo alojamiento" NO
//      viene acá (es la base implícita del frontend, no una fila de este endpoint).
//  (5) Orden fijo independiente del orden en que llegan de la DB.
import { describe, it, expect } from 'bun:test'
import { getPublicMealPlans } from '../usecases/public-meal-plans'
import type { MealPlanDTO } from '../types'

const baseMealPlan = (overrides: Partial<MealPlanDTO> = {}): MealPlanDTO => ({
  id: 'mp1', hotelId: 'h1', code: 'breakfast', active: true, priceMode: 'included', price: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const makeDeps = (hotel: any, mealPlans: MealPlanDTO[]) => ({
  hotels: { findOne: async () => hotel } as any,
  mealPlans: { findMany: async () => mealPlans } as any,
})

const activeHotel = { id: 'h1', slug: 'caribe', onlineBookingStatus: 'active' }

describe('getPublicMealPlans — tasks.md 2.2/2.4', () => {
  it('happy path: solo los activos, en orden fijo (breakfast, half_board, all_inclusive)', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp3', code: 'all_inclusive', active: true, priceMode: 'per_person_per_night', price: 60 }),
      baseMealPlan({ id: 'mp1', code: 'breakfast', active: true }),
      baseMealPlan({ id: 'mp2', code: 'half_board', active: true, priceMode: 'per_person_per_night', price: 25 }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body.map((m: any) => m.code)).toEqual(['breakfast', 'half_board', 'all_inclusive'])
    // Shape: solo code/priceMode/price — sin id/hotelId/timestamps (nada interno sale).
    expect(res.body[1]).toEqual({ code: 'half_board', priceMode: 'per_person_per_night', price: 25 })
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

  it('orden fijo, independiente del orden en que llegan de la DB', async () => {
    const deps = makeDeps(activeHotel, [
      baseMealPlan({ id: 'mp2', code: 'half_board', active: true }),
      baseMealPlan({ id: 'mp3', code: 'all_inclusive', active: true }),
      baseMealPlan({ id: 'mp1', code: 'breakfast', active: true }),
    ])
    const res = await getPublicMealPlans(deps as any, 'caribe')
    expect(res.body.map((m: any) => m.code)).toEqual(['breakfast', 'half_board', 'all_inclusive'])
  })
})
