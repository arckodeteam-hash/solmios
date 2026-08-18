// complete-requires-photos.test.ts — En modo `photos` (el default), la tarea no se cierra
// sin las fotos de las áreas que el hotel marcó `required` (el seed trae cama, baño y vista
// general). Es el mismo criterio que el gate de video: sin evidencia, la habitación no
// queda "limpia". Sin requirements configuradas (o sin repo cableado) no se exige nada —
// compat con hoteles que no usan el checklist fotográfico.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { TimingsUseCase } from '../usecases/timings'
import type { HousekeepingDTO, HousekeepingUser } from '../types'

const camarera: HousekeepingUser = { id: 'u1', role: 'housekeeper', hotelId: 'h1' }

interface Req { areaId: string; required: number | boolean; roomType: string }

function setup(task: Partial<HousekeepingDTO>, opts?: { requirements?: Req[]; roomType?: string; mode?: 'photos' | 'video' }) {
  const existing = {
    id: 't1', hotelId: 'h1', roomId: 'r1', staffId: 'u1', status: 'in_progress',
    startTime: '2026-08-16T10:00:00Z', photos: [], ...task,
  } as unknown as HousekeepingDTO
  const updates: Record<string, any>[] = []
  const repo = {
    findById: async () => existing,
    update: async (_id: string, patch: Record<string, any>) => {
      updates.push(patch)
      return { ...existing, ...patch }
    },
  } as unknown as RepositoryAdapter<HousekeepingDTO>
  const uc = new TimingsUseCase(
    repo,
    async () => {},
    async () => {},
    undefined,
    async () => {},
    { get: async () => ({ completionEvidence: opts?.mode ?? 'photos' }) },
    { listByRoomType: async () => opts?.requirements ?? [] },
    { findOne: async () => ({ id: 'r1', type: opts?.roomType ?? 'suite' }) } as any,
  )
  return { uc, updates }
}

const REQS: Req[] = [
  { areaId: 'bed', required: 1, roomType: 'all' },
  { areaId: 'bathroom', required: 1, roomType: 'all' },
  { areaId: 'kitchen', required: 0, roomType: 'all' }, // opcional: no bloquea
]

describe('TimingsUseCase.complete — fotos obligatorias (modo photos)', () => {
  it('sin ninguna foto y áreas requeridas: la tarea NO se cierra y nombra lo que falta', async () => {
    const { uc, updates } = setup({}, { requirements: REQS })
    await expect(uc.complete('t1', camarera)).rejects.toThrow('Faltan fotos obligatorias (bed, bathroom)')
    expect(updates).toHaveLength(0)
  })

  it('con las fotos requeridas subidas: cierra normal', async () => {
    const photos = [
      { areaId: 'bed', url: 'https://b/1.jpg' },
      { areaId: 'bathroom', url: 'https://b/2.jpg' },
      { areaId: 'kitchen', url: 'https://b/3.jpg' }, // extra: no molesta
    ]
    const { uc, updates } = setup({ photos } as any, { requirements: REQS })
    const res = await uc.complete('t1', camarera)
    expect(res.status).toBe('completed')
    expect(updates).toHaveLength(1)
  })

  it('requirements de OTRO roomType no aplican: cierra sin fotos', async () => {
    const reqsSuiteOnly = [{ areaId: 'bed', required: 1, roomType: 'suite' }]
    const { uc } = setup({}, { requirements: reqsSuiteOnly, roomType: 'double' })
    const res = await uc.complete('t1', camarera)
    expect(res.status).toBe('completed')
  })

  it('requirements del roomType de la habitación + globales aplican ambas', async () => {
    const reqs = [
      { areaId: 'bed', required: 1, roomType: 'all' },
      { areaId: 'balcony', required: 1, roomType: 'suite' },
    ]
    const { uc } = setup({}, { requirements: reqs, roomType: 'suite' })
    await expect(uc.complete('t1', camarera)).rejects.toThrow('bed, balcony')
  })

  it('hotel sin requirements configuradas: no exige nada (compat)', async () => {
    const { uc, updates } = setup({}, { requirements: [] })
    const res = await uc.complete('t1', camarera)
    expect(res.status).toBe('completed')
    expect(updates).toHaveLength(1)
  })

  it('sin el repo de requirements cableado: no exige nada (degradación igual que settings)', async () => {
    const existing = { id: 't1', hotelId: 'h1', roomId: 'r1', staffId: 'u1', status: 'in_progress', startTime: 'x', photos: [] } as any
    const repo = { findById: async () => existing, update: async (_i: string, p: any) => ({ ...existing, ...p }) } as any
    const uc = new TimingsUseCase(repo, async () => {}, async () => {}, undefined, async () => {},
      { get: async () => ({ completionEvidence: 'photos' }) }) // sin requirements ni roomRepo
    const res = await uc.complete('t1', camarera)
    expect(res.status).toBe('completed')
  })
})
