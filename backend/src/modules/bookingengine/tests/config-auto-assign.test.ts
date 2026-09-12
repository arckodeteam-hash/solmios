// #262 REQ-HAC-07 — autoAssignBeforeArrivalHours: horas antes de la llegada a partir de las cuales
// el cron de pase pre-llegada asigna automáticamente la habitación sugerida a una reserva sin
// habitación (0–168, default 0 = apagado). Valida el schema del admin (entero acotado, sin
// coerción), el default 0 del ConfigUseCase (filas viejas sin la columna y hoteles sin config)
// y que un update con 24 persista 24.
import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { validateSchema } from '../../../shared/validators/validate-body'
import { UpdateBookingConfigSchema } from '../validators/schema'
import { ConfigUseCase, DEFAULT_AUTO_ASSIGN_BEFORE_ARRIVAL_HOURS } from '../usecases/config'

const noCache = { get: async () => null, set: async () => {}, delete: async () => {} } as unknown as CacheAdapter

function setup(rows: any[]) {
  const created: any[] = []
  const updated: Array<{ id: string; data: any }> = []
  const repo = {
    findMany: async () => rows,
    create: async (data: any) => {
      const row = { id: 'cfg1', ...data }
      created.push(row)
      return row
    },
    update: async (id: string, data: any) => {
      updated.push({ id, data })
      const row = { ...(rows[0] ?? { id }), ...data }
      return row
    },
  } as unknown as RepositoryAdapter<any>
  return { usecase: new ConfigUseCase(repo, noCache), created, updated }
}

describe('UpdateBookingConfigSchema.autoAssignBeforeArrivalHours', () => {
  it('acepta 0 (apagado), 24 y el borde 168', () => {
    expect(validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: 0 }).autoAssignBeforeArrivalHours).toBe(0)
    expect(validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: 24 }).autoAssignBeforeArrivalHours).toBe(24)
    expect(validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: 168 }).autoAssignBeforeArrivalHours).toBe(168)
  })

  it('rechaza -1 (por debajo del mínimo 0)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: -1 })).toThrow(ValidationError)
  })

  it('rechaza 169 (por encima del máximo 168)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: 169 })).toThrow(ValidationError)
  })

  it('rechaza un decimal (1.5)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: 1.5 })).toThrow(ValidationError)
  })

  it('rechaza un string (sin coerción)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: '24' })).toThrow(ValidationError)
  })
})

describe('ConfigUseCase.get — default de autoAssignBeforeArrivalHours', () => {
  it('el default exportado es 0 (apagado)', () => {
    expect(DEFAULT_AUTO_ASSIGN_BEFORE_ARRIVAL_HOURS).toBe(0)
  })

  it('una fila anterior a la columna (sin valor) devuelve 0 sin persistir', async () => {
    const { usecase, created } = setup([{ id: 'cfg1', hotelId: 'h1', enabled: true, minNights: 1, approvalDeadlineHours: 24 }])
    const cfg = await usecase.get('h1')
    expect(cfg.autoAssignBeforeArrivalHours).toBe(0)
    expect(cfg.approvalDeadlineHours).toBe(24) // el resto de la fila se conserva
    expect(cfg.minNights).toBe(1)
    expect(created).toHaveLength(0)
  })

  it('una fila con NULL devuelve 0', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', autoAssignBeforeArrivalHours: null }])
    expect((await usecase.get('h1')).autoAssignBeforeArrivalHours).toBe(0)
  })

  it('una fila con un valor configurado (24) NO se pisa con el default', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', autoAssignBeforeArrivalHours: 24 }])
    expect((await usecase.get('h1')).autoAssignBeforeArrivalHours).toBe(24)
  })

  it('sin filas crea la config con 0', async () => {
    const { usecase, created } = setup([])
    const cfg = await usecase.get('h1')
    expect(cfg.autoAssignBeforeArrivalHours).toBe(0)
    expect(created).toHaveLength(1)
    expect(created[0].autoAssignBeforeArrivalHours).toBe(0)
  })
})

describe('ConfigUseCase.update — autoAssignBeforeArrivalHours', () => {
  it('update con 24 (validado por el schema) persiste 24', async () => {
    const { usecase, updated } = setup([{ id: 'cfg1', hotelId: 'h1', autoAssignBeforeArrivalHours: 0 }])
    const dto = validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: 24 })
    const cfg = await usecase.update('h1', dto)
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('cfg1')
    expect(updated[0].data.autoAssignBeforeArrivalHours).toBe(24)
    expect(cfg.autoAssignBeforeArrivalHours).toBe(24)
  })

  it('update con -1 o 1.5 no llega al repo: el schema lo rechaza antes', async () => {
    const { updated } = setup([{ id: 'cfg1', hotelId: 'h1', autoAssignBeforeArrivalHours: 0 }])
    for (const bad of [-1, 1.5]) {
      let dto: any = null
      expect(() => { dto = validateSchema(UpdateBookingConfigSchema, { autoAssignBeforeArrivalHours: bad }) }).toThrow(ValidationError)
      expect(dto).toBeNull()
    }
    expect(updated).toHaveLength(0)
  })
})
