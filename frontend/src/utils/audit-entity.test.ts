// audit-entity.test.ts — Normalización y agrupamiento de entidades de audit log (#139): el
// filtro comparaba contra la entidad cruda, así 'Reservations' y 'reservation' parecían dos
// cosas y la mitad de las opciones del desplegable devolvía la tabla vacía.
import { describe, it, expect } from 'vitest'
import { normalizeEntity, entityGroup, entityLabel, auditFilterOptions } from './audit-entity'

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
    expect(entityGroup('cash_shift')).toBe('cash_shift')
    expect(entityGroup('device')).toBe('device')
  })

  it("payment_request es facturación; auth es login; room_rate/season son configuración; role es usuarios", () => {
    expect(entityGroup('payment_request')).toBe('billing')
    expect(entityGroup('auth')).toBe('auth')
    expect(entityGroup('room_rate')).toBe('configuration')
    expect(entityGroup('season')).toBe('configuration')
    expect(entityGroup('role')).toBe('user')
  })

  it("sin entidad cae en 'system', la categoría 'Sistema' de la tabla", () => {
    expect(entityGroup(undefined)).toBe('system')
    expect(entityGroup('')).toBe('system')
  })
})

describe('entityLabel — texto del <option>', () => {
  it('grupo conocido usa su label; desconocido se humaniza; system es Sistema', () => {
    expect(entityLabel('billing')).toBe('Facturación')
    expect(entityLabel('reservation')).toBe('Reservas')
    expect(entityLabel('cash_shift')).toBe('Cash shift')
    expect(entityLabel('system')).toBe('Sistema')
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

  it('devuelve exactamente los grupos presentes con su conteo (agrupa y suma), más frecuentes primero', () => {
    expect(auditFilterOptions(logs)).toEqual([
      { value: 'reservation', label: 'Reservas', count: 3 },
      { value: 'billing', label: 'Facturación', count: 2 },
    ])
  })

  it('el caso de producción: 226 Reservations + 24 reservation + invoice/payment/expense', () => {
    const prod = [
      ...Array.from({ length: 226 }, () => ({ entity: 'Reservations' })),
      ...Array.from({ length: 24 }, () => ({ entity: 'reservation' })),
      ...Array.from({ length: 4 }, () => ({ entity: 'invoice' })),
      ...Array.from({ length: 2 }, () => ({ entity: 'payment' })),
      { entity: 'expense' },
    ]
    expect(auditFilterOptions(prod)).toEqual([
      { value: 'reservation', label: 'Reservas', count: 250 },
      { value: 'billing', label: 'Facturación', count: 7 },
    ])
  })

  it("'auth' NO aparece si no hay logs de auth (ninguna opción devuelve tabla vacía)", () => {
    const values = auditFilterOptions(logs).map((o) => o.value)
    expect(values).not.toContain('auth')
    expect(values).toEqual(['reservation', 'billing'])
  })

  it("sin logs no hay opciones; los logs sin entidad cuentan como 'Sistema'", () => {
    expect(auditFilterOptions([])).toEqual([])
    expect(auditFilterOptions([{ entity: null }, {}, { entity: '' }])).toEqual([{ value: 'system', label: 'Sistema', count: 3 }])
  })
})
