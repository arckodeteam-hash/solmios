// shared/utils/tests/db-errors.test.ts — clasificación portable de errores del motor.
// #208: `migrate-db.ts` decide con `isMissingTableError` si el fallo del UNIQUE de restaurant_orders es
// un aviso ("la tabla la crea RUN_MIGRATE") o un error que tira la migración (exit 1). Una columna
// faltante también dice "does not exist" y NO puede colarse como aviso.
import { describe, it, expect } from 'bun:test'
import { isMissingTableError, isUniqueViolation, failMigrationStep } from '../db-errors'

describe('isMissingTableError', () => {
  it('SQLite: "no such table"', () => {
    expect(isMissingTableError(new Error('no such table: restaurant_orders'))).toBe(true)
    expect(isMissingTableError('No such table: x')).toBe(true)
  })

  it('Postgres: SQLSTATE 42P01 por `code`, o `relation "x" does not exist` sin code', () => {
    expect(isMissingTableError(Object.assign(new Error('undefined_table'), { code: '42P01' }))).toBe(true)
    expect(isMissingTableError(new Error('relation "restaurant_orders" does not exist'))).toBe(true)
  })

  it('NO es tabla faltante: columna faltante (42703), UNIQUE violado, duplicados al crear el índice, error genérico', () => {
    expect(isMissingTableError(Object.assign(new Error('column "number" does not exist'), { code: '42703' }))).toBe(false)
    expect(isMissingTableError(new Error('could not create unique index "idx_restaurant_orders_hotel_number" — Key (hotelid, number)=(h1, CMD-2026-0001) is duplicated.'))).toBe(false)
    expect(isMissingTableError(new Error('UNIQUE constraint failed: restaurant_orders.hotelId, restaurant_orders.number'))).toBe(false)
    expect(isMissingTableError(new Error('connection refused'))).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
    expect(isMissingTableError(undefined)).toBe(false)
  })
})

describe('isUniqueViolation', () => {
  it('SQLite y Postgres', () => {
    expect(isUniqueViolation(new Error('UNIQUE constraint failed: x.y'))).toBe(true)
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "x"'))).toBe(true)
    expect(isUniqueViolation(new Error('SQLSTATE 23505'))).toBe(true)
    expect(isUniqueViolation(new Error('no such table: x'))).toBe(false)
  })
})

// ─── #239: failMigrationStep — el deploy deja de mentir cuando una migración falla ───
// El defecto que esto cierra: nueve bloques de `migrate-db.ts` imprimían "tabla aún no migrada
// (correr RUN_MIGRATE)" ante CUALQUIER error y seguían. El operador leía una causa falsa, corría
// RUN_MIGRATE, no cambiaba nada, y el deploy reportaba éxito con el índice/backfill ausente.
describe('#239 — failMigrationStep: tabla ausente avisa, cualquier otro fallo aborta', () => {
  const step = { what: 'payments_pos_ref', missingTable: 'payments', consequence: 'Un cobro del POS puede asentarse dos veces.' }

  it('tabla inexistente (SQLite) → avisa y NO corta la migración', () => {
    expect(() => failMigrationStep(new Error('no such table: payments'), step)).not.toThrow()
  })

  it('tabla inexistente (Postgres, por código 42P01) → avisa y NO corta', () => {
    const e = Object.assign(new Error('relation "payments" does not exist'), { code: '42P01' })
    expect(() => failMigrationStep(e, step)).not.toThrow()
  })

  it('permiso denegado → RELANZA (la migración sale en rojo)', () => {
    expect(() => failMigrationStep(new Error('permission denied for table payments'), step)).toThrow('payments_pos_ref')
  })

  it('el error que relanza explica la CONSECUENCIA, no solo que falló', () => {
    try {
      failMigrationStep(new Error('disk full'), step)
      throw new Error('debió relanzar')
    } catch (e) {
      expect((e as Error).message).toContain('Un cobro del POS puede asentarse dos veces.')
      expect((e as Error).message).toContain('disk full')
      expect((e as Error).cause).toBeInstanceOf(Error)   // conserva el original para el stack
    }
  })

  it('una COLUMNA faltante NO es tabla faltante: aborta', () => {
    // 42703: `column "x" does not exist` también dice "does not exist" — si se tratara como tabla
    // ausente, un ADD COLUMN que no corrió se silenciaría para siempre.
    const e = Object.assign(new Error('column "businessdate" does not exist'), { code: '42703' })
    expect(() => failMigrationStep(e, step)).toThrow()
  })
})
