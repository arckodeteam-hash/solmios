// shared/utils/tests/db-errors.test.ts — clasificación portable de errores del motor.
// #208: `migrate-db.ts` decide con `isMissingTableError` si el fallo del UNIQUE de restaurant_orders es
// un aviso ("la tabla la crea RUN_MIGRATE") o un error que tira la migración (exit 1). Una columna
// faltante también dice "does not exist" y NO puede colarse como aviso.
import { describe, it, expect } from 'bun:test'
import { isMissingTableError, isUniqueViolation } from '../db-errors'

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
