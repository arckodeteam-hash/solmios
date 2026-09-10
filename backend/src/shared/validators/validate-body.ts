// shared/validators/validate-body.ts — Validación de bodies con tipos estructurados.
//
// `validateSchema` del framework solo entiende string|number|boolean|email|url|date. Su `switch` no
// tiene caso para 'array'|'object'|'json'|'text': el campo NO se copia al output. El proyecto tenía
// 41 campos declarados con esos tipos, y todos se descartaban en silencio. Dos síntomas:
//
//   required: true  → el handler recibe `undefined` y revienta (500)  ej. payroll `employees`
//   opcional        → el dato del usuario nunca se persiste           ej. `notes`, `photos`
//
// `text` NO es un alias de `string`: el caso `string` del framework hace `replace(/\s+/g, ' ')`,
// que aplasta los saltos de línea. Un campo de notas multilínea quedaría en una sola línea.

// Se exporta con el MISMO nombre que el del framework, y es un superconjunto: los controllers
// cambian el import y nada más. (El analyzer también exige ver `validateSchema(` en el controller.)
import { validateSchema as validateFrameworkSchema, ValidationError } from 'arckode-framework'
import type { ValidationRule } from 'arckode-framework'

/**
 * Tipos que el framework no valida y resolvemos acá. `integer` existe porque el `number` del
 * framework hace `Number(value)` sobre strings: `days:"7"` pasaba como 7 y `7.5` como 7.5. Un
 * campo que es una CANTIDAD (días, unidades) exige un entero JSON, sin coerción.
 */
export type StructuredType = 'array' | 'object' | 'json' | 'text' | 'integer'

export interface StructuredRule {
  type: StructuredType
  required?: boolean
  /** array: cantidad de elementos. text: longitud del string. integer: valor. */
  min?: number
  max?: number
  message?: string
}

export type BodyRule = ValidationRule | StructuredRule
export type BodySchema = Record<string, BodyRule>

const STRUCTURED: ReadonlySet<string> = new Set<StructuredType>(['array', 'object', 'json', 'text', 'integer'])

const isStructured = (rule: BodyRule): rule is StructuredRule => STRUCTURED.has(rule.type)

/** Un objeto plano: ni null, ni array. */
const isPlainObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v)

function validateStructured(field: string, rule: StructuredRule, value: unknown): { value?: unknown; errors: string[] } {
  switch (rule.type) {
    case 'array': {
      if (!Array.isArray(value)) return { errors: [rule.message ?? `${field} must be an array`] }
      if (rule.min !== undefined && value.length < rule.min) return { errors: [`Minimum ${rule.min} items`] }
      if (rule.max !== undefined && value.length > rule.max) return { errors: [`Maximum ${rule.max} items`] }
      return { value, errors: [] }
    }
    // `object` es estricto: un objeto plano. `metadata`, `preferences`, `emergencyContact`.
    case 'object': {
      if (!isPlainObject(value)) return { errors: [rule.message ?? `${field} must be an object`] }
      return { value, errors: [] }
    }
    // `json` es cualquier estructura: los modelos lo usan tanto para objetos como para listas
    // (`packages.contents` arranca en `[]`). Rechazar el array convertía un descarte silencioso
    // en un 400.
    case 'json': {
      if (!isPlainObject(value) && !Array.isArray(value)) {
        return { errors: [rule.message ?? `${field} must be an object or an array`] }
      }
      return { value, errors: [] }
    }
    case 'text': {
      if (typeof value !== 'string') return { errors: [rule.message ?? `${field} must be a string`] }
      // Trim de bordes, pero se preservan los saltos de línea internos.
      const trimmed = value.trim()
      if (rule.min !== undefined && trimmed.length < rule.min) return { errors: [`Minimum ${rule.min} characters`] }
      if (rule.max !== undefined && trimmed.length > rule.max) return { errors: [`Maximum ${rule.max} characters`] }
      return { value: trimmed, errors: [] }
    }
    // Estricto: número JSON entero. `"7"` (string) y `7.5` se rechazan — nada de `Number(value)`.
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { errors: [rule.message ?? `${field} must be an integer`] }
      }
      if (rule.min !== undefined && value < rule.min) return { errors: [`Minimum ${rule.min}`] }
      if (rule.max !== undefined && value > rule.max) return { errors: [`Maximum ${rule.max}`] }
      return { value, errors: [] }
    }
  }
}

/**
 * Valida el body contra un schema que puede mezclar tipos del framework y estructurados.
 * Devuelve SOLO los campos declarados, igual que `validateSchema` — un campo ausente del schema se
 * sigue descartando, que es la defensa contra mass-assignment.
 */
export function validateSchema(schema: BodySchema, input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) throw new ValidationError('Request body must be an object')
  const data = input as Record<string, unknown>

  const base: Record<string, ValidationRule> = {}
  const structured: Record<string, StructuredRule> = {}
  for (const [field, rule] of Object.entries(schema)) {
    if (isStructured(rule)) structured[field] = rule
    else base[field] = rule
  }

  // Los tipos que el framework sí entiende: delegamos, para no duplicar sanitización.
  const output = validateFrameworkSchema(base, data)

  const errors: Record<string, string[]> = {}
  for (const [field, rule] of Object.entries(structured)) {
    const value = data[field]
    if (value === undefined || value === null) {
      if (rule.required) errors[field] = [rule.message ?? `${field} is required`]
      continue
    }
    const result = validateStructured(field, rule, value)
    if (result.errors.length > 0) errors[field] = result.errors
    else output[field] = result.value
  }

  if (Object.keys(errors).length > 0) throw new ValidationError('Validation error', errors)
  return output
}

/** Alias explícito, para call sites donde `validateSchema` se preste a confusión con el del framework. */
export const validateBody = validateSchema
