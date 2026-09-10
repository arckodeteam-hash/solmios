// shared/tests/validate-body.test.ts — Tipos estructurados en el body.
//
// Regresión: `validateSchema` del framework no tiene caso para array/object/json/text. Los campos
// declarados así NO llegaban al output: o el handler reventaba (required) o el dato se perdía.

import { describe, it, expect } from 'bun:test'
import { validateSchema } from 'arckode-framework'
import { validateBody, type BodySchema } from '../validators/validate-body'

describe('el bug que motiva este helper', () => {
  it('validateSchema del framework descarta un campo `array`', () => {
    const out = validateSchema({ items: { type: 'array' as any, required: true } }, { items: [1, 2] })
    expect(out.items).toBeUndefined()
  })

  it('validateBody sí lo devuelve', () => {
    const out = validateBody({ items: { type: 'array', required: true } }, { items: [1, 2] })
    expect(out.items).toEqual([1, 2])
  })
})

describe('validateBody — array', () => {
  const schema: BodySchema = { items: { type: 'array', required: true, min: 1 } }

  it('acepta un array', () => {
    expect(validateBody(schema, { items: ['a'] }).items).toEqual(['a'])
  })

  it('rechaza lo que no es array', () => {
    expect(() => validateBody(schema, { items: 'a' })).toThrow('Validation error')
    expect(() => validateBody(schema, { items: { 0: 'a' } })).toThrow('Validation error')
  })

  it('exige el mínimo de elementos', () => {
    expect(() => validateBody(schema, { items: [] })).toThrow('Validation error')
  })

  it('un array requerido ausente falla, en vez de llegar undefined al handler', () => {
    expect(() => validateBody(schema, {})).toThrow('Validation error')
  })

  it('un array opcional ausente simplemente no aparece', () => {
    const out = validateBody({ tags: { type: 'array' } }, {})
    expect(out.tags).toBeUndefined()
  })
})

describe('validateBody — object / json', () => {
  it('acepta un objeto plano', () => {
    const out = validateBody({ metadata: { type: 'object' } }, { metadata: { a: 1 } })
    expect(out.metadata).toEqual({ a: 1 })
  })

  it('`json` acepta un objeto', () => {
    const out = validateBody({ contents: { type: 'json' } }, { contents: { x: true } })
    expect(out.contents).toEqual({ x: true })
  })

  // `packages.contents` arranca en `[]`: los modelos usan `json` tanto para objetos como para listas.
  it('`json` también acepta un array', () => {
    const out = validateBody({ contents: { type: 'json' } }, { contents: [{ label: 'Desayuno' }] })
    expect(out.contents).toEqual([{ label: 'Desayuno' }])
  })

  it('`json` rechaza un escalar', () => {
    expect(() => validateBody({ contents: { type: 'json' } }, { contents: 'texto' })).toThrow('Validation error')
  })

  it('`object` es estricto: un array NO es un objeto plano', () => {
    expect(() => validateBody({ metadata: { type: 'object' } }, { metadata: [1] })).toThrow('Validation error')
  })

  it('null se trata como ausente, no como objeto', () => {
    expect(validateBody({ metadata: { type: 'object' } }, { metadata: null }).metadata).toBeUndefined()
    expect(() => validateBody({ metadata: { type: 'object', required: true } }, { metadata: null })).toThrow('Validation error')
  })
})

describe('validateBody — text', () => {
  // El caso `string` del framework hace replace(/\s+/g,' ') y aplasta los saltos de línea.
  it('preserva los saltos de línea, a diferencia de `string`', () => {
    const multiline = 'linea uno\nlinea dos'
    expect(validateBody({ notes: { type: 'text' } }, { notes: multiline }).notes).toBe(multiline)
    expect(validateSchema({ notes: { type: 'string' } }, { notes: multiline }).notes).toBe('linea uno linea dos')
  })

  it('recorta los bordes', () => {
    expect(validateBody({ notes: { type: 'text' } }, { notes: '  hola  ' }).notes).toBe('hola')
  })

  it('respeta el máximo', () => {
    expect(() => validateBody({ notes: { type: 'text', max: 3 } }, { notes: 'hola' })).toThrow('Validation error')
  })

  it('rechaza lo que no es string', () => {
    expect(() => validateBody({ notes: { type: 'text' } }, { notes: 42 })).toThrow('Validation error')
  })
})

describe('validateBody — integer (sin coerción)', () => {
  const schema: BodySchema = { days: { type: 'integer', required: true, min: 1, max: 30 } }

  it('acepta un entero JSON dentro del rango', () => {
    expect(validateBody(schema, { days: 7 }).days).toBe(7)
    expect(validateBody(schema, { days: 1 }).days).toBe(1)
    expect(validateBody(schema, { days: 30 }).days).toBe(30)
  })

  it('el `number` del framework coerciona "7" → 7; `integer` lo rechaza', () => {
    expect(validateSchema({ days: { type: 'number', required: true } }, { days: '7' }).days).toBe(7)
    expect(() => validateBody(schema, { days: '7' })).toThrow('Validation error')
  })

  it('rechaza decimales, NaN, booleanos y null requerido', () => {
    expect(() => validateBody(schema, { days: 7.5 })).toThrow('Validation error')
    expect(() => validateBody(schema, { days: Number.NaN })).toThrow('Validation error')
    expect(() => validateBody(schema, { days: true })).toThrow('Validation error')
    expect(() => validateBody(schema, { days: null })).toThrow('Validation error')
    expect(() => validateBody(schema, {})).toThrow('Validation error')
  })

  it('respeta min/max', () => {
    expect(() => validateBody(schema, { days: 0 })).toThrow('Validation error')
    expect(() => validateBody(schema, { days: 31 })).toThrow('Validation error')
  })
})

describe('validateBody — convive con los tipos del framework', () => {
  const schema: BodySchema = {
    concept: { type: 'string', required: true },
    amount: { type: 'number', min: 0 },
    notes: { type: 'text' },
    items: { type: 'array' },
  }

  it('valida y devuelve las dos familias juntas', () => {
    const out = validateBody(schema, { concept: 'Nafta', amount: 100, notes: 'a\nb', items: [1] })
    expect(out).toEqual({ concept: 'Nafta', amount: 100, notes: 'a\nb', items: [1] })
  })

  it('sigue descartando lo que no está en el schema (anti mass-assignment)', () => {
    const out = validateBody(schema, { concept: 'x', hotelId: 'otro-hotel', isAdmin: true })
    expect(out.hotelId).toBeUndefined()
    expect(out.isAdmin).toBeUndefined()
  })

  it('los errores de ambas familias se acumulan', () => {
    expect(() => validateBody(schema, { amount: -1, items: 'no-array' })).toThrow('Validation error')
  })

  it('un body que no es objeto se rechaza', () => {
    expect(() => validateBody(schema, null)).toThrow('Request body must be an object')
    expect(() => validateBody(schema, 'texto')).toThrow('Request body must be an object')
  })
})
