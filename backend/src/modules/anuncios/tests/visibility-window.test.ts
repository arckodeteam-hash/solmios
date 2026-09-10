// anuncios/tests/visibility-window.test.ts — la regla de vigencia (ANN-3), en puro.
import { describe, it, expect } from 'bun:test'
import { ValidationError, AuthError } from 'arckode-framework'
import {
  normalizeWindow,
  isVisibleAt,
  isScheduled,
  applyWindow,
  resolveScope,
  paginateInMemory,
} from '../usecases/visibility-window'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const YESTERDAY = '2026-09-09T12:00:00.000Z'
const TOMORROW = '2026-09-11T12:00:00.000Z'

function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return null
}

describe('normalizeWindow — validación del par startsAt/endsAt', () => {
  it('fechas invertidas → ValidationError con httpStatus 400', () => {
    const err = catchError(() => normalizeWindow({ startsAt: TOMORROW, endsAt: YESTERDAY }))
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).httpStatus).toBe(400)
    expect((err as Error).message).toBe('endsAt debe ser posterior a startsAt')
  })

  it('endsAt igual a startsAt también es inválido (la ventana tiene que tener duración)', () => {
    const err = catchError(() => normalizeWindow({ startsAt: TOMORROW, endsAt: TOMORROW }))
    expect((err as ValidationError).httpStatus).toBe(400)
  })

  it('fecha no parseable → 400 y nombra el campo', () => {
    const err = catchError(() => normalizeWindow({ startsAt: 'mañana a la tarde' }))
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).httpStatus).toBe(400)
    expect((err as Error).message).toContain('startsAt')
  })

  it('solo endsAt válido: startsAt queda null y endsAt normalizado a ISO', () => {
    expect(normalizeWindow({ endsAt: '2026-09-11T12:00:00Z' })).toEqual({
      startsAt: null,
      endsAt: TOMORROW,
    })
  })

  it('create sin fechas → ambos null (publica ya, sin vencimiento)', () => {
    expect(normalizeWindow({})).toEqual({ startsAt: null, endsAt: null })
  })

  it('update: un campo ausente conserva el actual y se valida contra él', () => {
    const current = { startsAt: TOMORROW, endsAt: null }
    // endsAt antes del startsAt que YA tiene la fila → inválido aunque el body no traiga startsAt.
    const err = catchError(() => normalizeWindow({ endsAt: YESTERDAY }, current))
    expect((err as ValidationError).httpStatus).toBe(400)
    // Uno posterior sí, y el startsAt actual se conserva.
    expect(normalizeWindow({ endsAt: '2026-09-12T12:00:00.000Z' }, current)).toEqual({
      startsAt: TOMORROW,
      endsAt: '2026-09-12T12:00:00.000Z',
    })
  })

  // Por HTTP sólo llega '' (validateSchema descarta null); null cubre a quien llame al usecase directo.
  it("update: null o '' borran el valor actual", () => {
    const current = { startsAt: TOMORROW, endsAt: '2026-09-12T12:00:00.000Z' }
    expect(normalizeWindow({ startsAt: null }, current)).toEqual({
      startsAt: null,
      endsAt: '2026-09-12T12:00:00.000Z',
    })
    expect(normalizeWindow({ endsAt: '' }, current)).toEqual({ startsAt: TOMORROW, endsAt: null })
  })
})

describe('isVisibleAt / isScheduled / applyWindow', () => {
  it('programado para mañana no es visible hoy (y es scheduled)', () => {
    expect(isVisibleAt({ startsAt: TOMORROW }, NOW)).toBe(false)
    expect(isScheduled({ startsAt: TOMORROW }, NOW)).toBe(true)
  })

  it('endsAt ayer no es visible aunque active sea 1', () => {
    expect(isVisibleAt({ endsAt: YESTERDAY, active: 1 } as any, NOW)).toBe(false)
    expect(isScheduled({ endsAt: YESTERDAY }, NOW)).toBe(false)
  })

  it('sin fechas es visible siempre: los anuncios ya creados no cambian', () => {
    expect(isVisibleAt({}, NOW)).toBe(true)
    expect(isVisibleAt({ startsAt: null, endsAt: null }, NOW)).toBe(true)
    expect(isScheduled({}, NOW)).toBe(false)
  })

  it('dentro de la ventana es visible; startsAt exacto a now ya publica, endsAt exacto ya vence', () => {
    expect(isVisibleAt({ startsAt: YESTERDAY, endsAt: TOMORROW }, NOW)).toBe(true)
    expect(isVisibleAt({ startsAt: NOW.toISOString() }, NOW)).toBe(true)
    expect(isVisibleAt({ endsAt: NOW.toISOString() }, NOW)).toBe(false)
  })

  it('applyWindow deja sólo las vigentes y conserva el orden', () => {
    const rows = [
      { id: 'a', startsAt: TOMORROW },
      { id: 'b' },
      { id: 'c', endsAt: YESTERDAY },
      { id: 'd', startsAt: YESTERDAY, endsAt: TOMORROW },
    ]
    expect(applyWindow(rows, NOW).map((r) => r.id)).toEqual(['b', 'd'])
  })
})

describe('resolveScope', () => {
  it("hotel_admin pidiendo 'all' → AuthError", () => {
    const err = catchError(() => resolveScope('all', 'hotel_admin'))
    expect(err).toBeInstanceOf(AuthError)
    expect((err as Error).message).toBe('scope=all es solo para super_admin')
  })

  it("super_admin pidiendo 'all' → 'all'", () => {
    expect(resolveScope('all', 'super_admin')).toBe('all')
  })

  it("undefined o cualquier otro valor → 'active', para cualquier rol", () => {
    expect(resolveScope(undefined, 'hotel_admin')).toBe('active')
    expect(resolveScope(undefined, 'super_admin')).toBe('active')
    expect(resolveScope('active', 'hotel_admin')).toBe('active')
    expect(resolveScope('todo', 'hotel_admin')).toBe('active')
  })
})

describe('paginateInMemory', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }))

  it('total y pages salen de las filas recibidas, no de la tabla', () => {
    const page1 = paginateInMemory(rows, 1, 3)
    expect(page1).toEqual({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 7, page: 1, limit: 3, pages: 3 })
    const page3 = paginateInMemory(rows, 3, 3)
    expect(page3.data).toEqual([{ id: 7 }])
    expect(page3.pages).toBe(3)
  })

  it('sin filas: total 0, pages 0 (misma semántica que el paginate del ORM), data vacía', () => {
    expect(paginateInMemory([], 1, 10)).toEqual({ data: [], total: 0, page: 1, limit: 10, pages: 0 })
  })

  it('una página más allá de la última se acota a la última', () => {
    expect(paginateInMemory(rows, 99, 3).data).toEqual([{ id: 7 }])
  })
})
