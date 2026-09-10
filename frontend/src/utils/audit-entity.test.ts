// audit-entity.test.ts — Normalización y agrupamiento de entidades de audit log (#139): el
// filtro comparaba contra la entidad cruda, así 'Reservations' y 'reservation' parecían dos
// cosas y la mitad de las opciones del desplegable devolvía la tabla vacía.
import { describe, it, expect } from 'vitest'
import { normalizeEntity, entityGroup, auditFilterOptions } from './audit-entity'

describe('normalizeEntity — minúsculas, sin acentos, singular', () => {
  it("'Reservations' y 'reservation' son la MISMA entidad (la diferencia ocultaba 226 de 250 reservas)", () => {
    expect(normalizeEntity('Reservations')).toBe('reservation')
    expect(normalizeEntity('reservations')).toBe('reservation')
  })

  it("las entidades que no son plurales quedan igual ('cash_shift', 'room_rate')", () => {
    expect(normalizeEntity('cash_shift')).toBe('cash_shift')
    expect(normalizeEntity('room_rate')).toBe('room_rate')
  })

  it("'guests' → 'guest', sin acentos (mismo criterio que norm() de SearchSelect)", () => {
    expect(normalizeEntity('guests')).toBe('guest')
    expect(normalizeEntity('Réservations')).toBe('reservation')
  })

  it('una entidad ausente normaliza a vacío, nunca a "undefined"', () => {
    expect(normalizeEntity(undefined)).toBe('')
    expect(normalizeEntity(null)).toBe('')
  })
})

describe('entityGroup — el grupo es el valor del filtro, no la entidad', () => {
  it('facturación agrupa invoice|payment|expense (tres entidades, una sola opción)', () => {
    expect(entityGroup('invoice')).toBe('billing')
    expect(entityGroup('payment')).toBe('billing')
    expect(entityGroup('expense')).toBe('billing')
  })

  it("acepta la entidad cruda o la normalizada: 'Reservations' cae en 'reservation'", () => {
    expect(entityGroup('Reservations')).toBe('reservation')
    expect(entityGroup('reservation')).toBe('reservation')
  })

  it("una entidad desconocida es su propio grupo (mejor opción extra que filtro vacío)", () => {
    expect(entityGroup('room_rate')).toBe('room_rate')
    expect(entityGroup('cash_shift')).toBe('cash_shift')
  })
})

describe('auditFilterOptions — opciones derivadas SOLO de lo presente en los datos', () => {
  // 2 Reservations + 1 reservation + 1 invoice + 1 expense: el caso prod en chico.
  const logs = [
    { entity: 'Reservations' },
    { entity: 'Reservations' },
    { entity: 'reservation' },
    { entity: 'invoice' },
    { entity: 'expense' },
  ]

  it('devuelve exactamente los grupos presentes con su conteo (agrupa y suma), alfabético', () => {
    expect(auditFilterOptions(logs)).toEqual([
      { value: 'billing', count: 2 },
      { value: 'reservation', count: 3 },
    ])
  })

  it("'auth' NO aparece si no hay logs de auth (ninguna opción devuelve tabla vacía)", () => {
    const values = auditFilterOptions(logs).map((o) => o.value)
    expect(values).not.toContain('auth')
    expect(values).toEqual(['billing', 'reservation'])
  })

  it('sin logs no hay opciones, y los logs sin entidad no generan grupo', () => {
    expect(auditFilterOptions([])).toEqual([])
    expect(auditFilterOptions([{ entity: null }, {}, { entity: '' }])).toEqual([])
  })
})
