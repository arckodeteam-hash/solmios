// habitaciones/tests/validators.test.ts — A-2 (auditoría 2026-08-19).
//
// El enum de tipo NO incluía 'family' mientras el selector del panel y el batch sí lo
// ofrecían: crear/editar una habitación "Familiar" era un 400 SIEMPRE, y el map del
// frontend colapsaba triple/quad→family al leer (round-trip corrupto). El enum ahora acepta
// TODO lo que la UI puede mandar.
import { describe, it, expect } from 'bun:test'
import { validateSchema } from 'arckode-framework'
import { CreateHabitacionesSchema, UpdateHabitacionesSchema } from '../validators/schema'

const base = { number: '101', basePrice: 100, hotelId: 'h1' }

describe('ROOM_TYPE enum (A-2)', () => {
  it("'family' es un tipo válido al crear y al editar", () => {
    const created = validateSchema(CreateHabitacionesSchema, { ...base, type: 'family' })
    expect(created.type).toBe('family')
    const updated = validateSchema(UpdateHabitacionesSchema, { type: 'family' })
    expect(updated.type).toBe('family')
  })

  it('triple y quad siguen válidos (el round-trip del panel ya no los muta)', () => {
    expect(validateSchema(UpdateHabitacionesSchema, { type: 'triple' }).type).toBe('triple')
    expect(validateSchema(UpdateHabitacionesSchema, { type: 'quad' }).type).toBe('quad')
  })

  it('un tipo fuera del catálogo se rechaza', () => {
    expect(() => validateSchema(CreateHabitacionesSchema, { ...base, type: 'mansion' })).toThrow()
  })
})
