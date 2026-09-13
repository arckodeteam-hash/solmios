// #361 — booking_config.showMealPlans: switch "Mostrar regímenes en el motor de reservas".
// Si es false (default) el motor público no muestra regímenes. Valida el schema del admin
// (boolean estricto), el default false del ConfigUseCase (hotel sin config y fila vieja con
// null/undefined) y que un update({showMealPlans:true}) lo persista.
import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { validateSchema } from '../../../shared/validators/validate-body'
import { UpdateBookingConfigSchema } from '../validators/schema'
import { ConfigUseCase } from '../usecases/config'
import { BookingConfigModel } from '../model'

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
      return { ...(rows[0] ?? { id }), ...data }
    },
  } as unknown as RepositoryAdapter<any>
  return { usecase: new ConfigUseCase(repo, noCache), created, updated }
}

describe('BookingConfigModel.showMealPlans (#361)', () => {
  it('está declarado como boolean con default false', () => {
    expect(BookingConfigModel.fields.showMealPlans).toEqual({ type: 'boolean', default: false })
  })
})

describe('UpdateBookingConfigSchema.showMealPlans (#361)', () => {
  it('acepta true y false', () => {
    expect(validateSchema(UpdateBookingConfigSchema, { showMealPlans: true }).showMealPlans).toBe(true)
    expect(validateSchema(UpdateBookingConfigSchema, { showMealPlans: false }).showMealPlans).toBe(false)
  })

  it('rechaza un string o un número (sin coerción)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { showMealPlans: 'true' })).toThrow(ValidationError)
    expect(() => validateSchema(UpdateBookingConfigSchema, { showMealPlans: 1 })).toThrow(ValidationError)
  })
})

describe('ConfigUseCase.get — default de showMealPlans (#361)', () => {
  it('sin filas crea la config con showMealPlans=false', async () => {
    const { usecase, created } = setup([])
    const cfg = await usecase.get('h1')
    expect(cfg.showMealPlans).toBe(false)
    expect(created).toHaveLength(1)
    expect(created[0].showMealPlans).toBe(false)
  })

  it('una fila anterior a la columna (sin valor) devuelve false sin persistir', async () => {
    const { usecase, created, updated } = setup([{ id: 'cfg1', hotelId: 'h1', enabled: true, showComparison: true }])
    const cfg = await usecase.get('h1')
    expect(cfg.showMealPlans).toBe(false)
    expect(cfg.showComparison).toBe(true) // el resto de la fila se conserva
    expect(created).toHaveLength(0)
    expect(updated).toHaveLength(0)
  })

  it('una fila con NULL devuelve false', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', showMealPlans: null }])
    expect((await usecase.get('h1')).showMealPlans).toBe(false)
  })

  it('una fila con true NO se pisa con el default', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', showMealPlans: true }])
    expect((await usecase.get('h1')).showMealPlans).toBe(true)
  })
})

describe('ConfigUseCase.update — showMealPlans (#361)', () => {
  it('update({showMealPlans:true}) lo persiste', async () => {
    const { usecase, updated } = setup([{ id: 'cfg1', hotelId: 'h1', showMealPlans: false }])
    const dto = validateSchema(UpdateBookingConfigSchema, { showMealPlans: true })
    const cfg = await usecase.update('h1', dto)
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('cfg1')
    expect(updated[0].data.showMealPlans).toBe(true)
    expect(cfg.showMealPlans).toBe(true)
  })

  it('update({showMealPlans:false}) vuelve a apagarlo', async () => {
    const { usecase, updated } = setup([{ id: 'cfg1', hotelId: 'h1', showMealPlans: true }])
    const cfg = await usecase.update('h1', validateSchema(UpdateBookingConfigSchema, { showMealPlans: false }))
    expect(updated[0].data.showMealPlans).toBe(false)
    expect(cfg.showMealPlans).toBe(false)
  })
})
