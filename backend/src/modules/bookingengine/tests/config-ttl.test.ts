// #266 — pendingTtlMinutes: minutos para completar el pago de una reserva web (15–1440, default 60).
// Reemplaza pendingPaymentTtlHours de #248. Valida el schema del admin (entero acotado, sin
// coerción) y el default 60 del ConfigUseCase tanto para filas anteriores a la columna como
// para hoteles sin config.
import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { validateSchema } from '../../../shared/validators/validate-body'
import { UpdateBookingConfigSchema } from '../validators/schema'
import { ConfigUseCase, DEFAULT_PENDING_TTL_MINUTES } from '../usecases/config'

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

describe('UpdateBookingConfigSchema.pendingTtlMinutes', () => {
  it('rechaza 14 (por debajo del mínimo 15)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: 14 })).toThrow(ValidationError)
  })

  it('rechaza 1441 (por encima del máximo 1440)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: 1441 })).toThrow(ValidationError)
  })

  it('rechaza un valor negativo', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: -1 })).toThrow(ValidationError)
  })

  it('rechaza un decimal', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: 7.5 })).toThrow(ValidationError)
  })

  it('rechaza un string numérico (sin coerción)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: '60' })).toThrow(ValidationError)
  })

  it('acepta 60 (default) y los bordes 15 y 1440', () => {
    expect(validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: 60 }).pendingTtlMinutes).toBe(60)
    expect(validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: 15 }).pendingTtlMinutes).toBe(15)
    expect(validateSchema(UpdateBookingConfigSchema, { pendingTtlMinutes: 1440 }).pendingTtlMinutes).toBe(1440)
  })

  it('ya no acepta el campo viejo pendingPaymentTtlHours (#248) — se descarta del body', () => {
    expect((validateSchema(UpdateBookingConfigSchema, { pendingPaymentTtlHours: 24 }) as any).pendingPaymentTtlHours).toBeUndefined()
  })
})

describe('ConfigUseCase.get — default de pendingTtlMinutes', () => {
  it('el default exportado es 60', () => {
    expect(DEFAULT_PENDING_TTL_MINUTES).toBe(60)
  })

  it('una fila anterior a la columna (sin valor) devuelve 60 sin persistir', async () => {
    const { usecase, created } = setup([{ id: 'cfg1', hotelId: 'h1', enabled: true, minNights: 1 }])
    const cfg = await usecase.get('h1')
    expect(cfg.pendingTtlMinutes).toBe(60)
    expect(cfg.minNights).toBe(1) // el resto de la fila se conserva
    expect(created).toHaveLength(0)
  })

  it('una fila con NULL devuelve 60', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', pendingTtlMinutes: null }])
    expect((await usecase.get('h1')).pendingTtlMinutes).toBe(60)
  })

  it('una fila con un valor configurado (15) NO se pisa con el default', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', pendingTtlMinutes: 15 }])
    expect((await usecase.get('h1')).pendingTtlMinutes).toBe(15)
  })

  it('sin filas crea la config con 60', async () => {
    const { usecase, created } = setup([])
    const cfg = await usecase.get('h1')
    expect(cfg.pendingTtlMinutes).toBe(60)
    expect(created).toHaveLength(1)
    expect(created[0].pendingTtlMinutes).toBe(60)
  })
})
