// #248 REQ-RWP-05 — pendingPaymentTtlHours: horas para pagar una reserva web (0 = nunca vence).
// Valida el schema del admin (entero ≥ 0, sin coerción) y el default 24 del ConfigUseCase
// tanto para filas anteriores a la columna como para hoteles sin config.
import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { validateSchema } from '../../../shared/validators/validate-body'
import { UpdateBookingConfigSchema } from '../validators/schema'
import { ConfigUseCase } from '../usecases/config'

const noCache = { get: async () => null, set: async () => {}, delete: async () => {} } as unknown as CacheAdapter

function setup(rows: any[]) {
  const created: any[] = []
  const repo = {
    findMany: async () => rows,
    create: async (data: any) => {
      const row = { id: 'cfg1', ...data }
      created.push(row)
      return row
    },
  } as unknown as RepositoryAdapter<any>
  return { usecase: new ConfigUseCase(repo, noCache), created }
}

describe('UpdateBookingConfigSchema.pendingPaymentTtlHours', () => {
  it('rechaza un valor negativo', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingPaymentTtlHours: -1 })).toThrow(ValidationError)
  })

  it('rechaza un decimal', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingPaymentTtlHours: 7.5 })).toThrow(ValidationError)
  })

  it('rechaza un string numérico (sin coerción)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingPaymentTtlHours: '24' })).toThrow(ValidationError)
  })

  it('acepta 0 (nunca vence) y 24', () => {
    expect(validateSchema(UpdateBookingConfigSchema, { pendingPaymentTtlHours: 0 }).pendingPaymentTtlHours).toBe(0)
    expect(validateSchema(UpdateBookingConfigSchema, { pendingPaymentTtlHours: 24 }).pendingPaymentTtlHours).toBe(24)
  })
})

describe('ConfigUseCase.get — default de pendingPaymentTtlHours', () => {
  it('una fila anterior a la columna (sin valor) devuelve 24 sin persistir', async () => {
    const { usecase, created } = setup([{ id: 'cfg1', hotelId: 'h1', enabled: true, minNights: 1 }])
    const cfg = await usecase.get('h1')
    expect(cfg.pendingPaymentTtlHours).toBe(24)
    expect(cfg.minNights).toBe(1) // el resto de la fila se conserva
    expect(created).toHaveLength(0)
  })

  it('una fila con NULL devuelve 24', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', pendingPaymentTtlHours: null }])
    expect((await usecase.get('h1')).pendingPaymentTtlHours).toBe(24)
  })

  it('una fila con 0 (nunca vence) NO se pisa con el default', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', pendingPaymentTtlHours: 0 }])
    expect((await usecase.get('h1')).pendingPaymentTtlHours).toBe(0)
  })

  it('sin filas crea la config con 24', async () => {
    const { usecase, created } = setup([])
    const cfg = await usecase.get('h1')
    expect(cfg.pendingPaymentTtlHours).toBe(24)
    expect(created).toHaveLength(1)
    expect(created[0].pendingPaymentTtlHours).toBe(24)
  })
})
