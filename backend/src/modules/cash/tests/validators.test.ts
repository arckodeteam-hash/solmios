// cash/tests/validators.test.ts — #212: el concepto es obligatorio (mín. 3 caracteres) en un
// movimiento manual. Antes `saveMov` solo validaba el monto y quedaban egresos de 500 sin decir
// para qué. La regla vive en el schema (controller): un curl tampoco la saltea.

import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import { validateSchema } from '../../../shared/validators/validate-body'
import { CreateMovementSchema, UpdateMovementSchema } from '../validators/schema'

/** El framework responde "Validation error" y detalla por campo en `fields`. */
function fieldErrors(schema: Record<string, any>, body: unknown): Record<string, string[]> {
  try {
    validateSchema(schema, body)
  } catch (e) {
    if (e instanceof ValidationError) return e.fields ?? {}
    throw e
  }
  return {}
}

describe('CreateMovementSchema — concepto obligatorio (#212)', () => {
  it('sin concepto → 400 con el mensaje que muestra la UI', () => {
    expect(fieldErrors(CreateMovementSchema, { type: 'expense', amount: 500 }).concept).toEqual(['Indicá el concepto'])
  })

  it('concepto de 2 caracteres → 400', () => {
    expect(fieldErrors(CreateMovementSchema, { type: 'expense', amount: 500, concept: 'ab' }).concept).toEqual(['Minimum 3 characters'])
  })

  it('solo espacios no cuenta como concepto', () => {
    expect(fieldErrors(CreateMovementSchema, { type: 'expense', amount: 500, concept: '      ' }).concept).toHaveLength(1)
  })

  it('con concepto de 3+ caracteres pasa y se conserva', () => {
    const out = validateSchema(CreateMovementSchema, { type: 'expense', amount: 500, concept: 'Hielo' })
    expect(out.concept).toBe('Hielo')
    expect(out.amount).toBe(500)
  })
})

describe('UpdateMovementSchema — el concepto puede omitirse pero no acortarse a menos de 3', () => {
  it('sin concepto (solo monto) pasa', () => {
    expect(validateSchema(UpdateMovementSchema, { amount: 60 }).amount).toBe(60)
  })

  it('concepto de 2 caracteres → 400', () => {
    expect(fieldErrors(UpdateMovementSchema, { concept: 'ab' }).concept).toEqual(['Minimum 3 characters'])
  })
})
