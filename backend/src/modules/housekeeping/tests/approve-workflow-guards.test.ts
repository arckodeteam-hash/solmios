// approve-workflow-guards.test.ts — Segregación de funciones + idempotencia + perímetro
// de la máquina de estados.
//
// El rol `housekeeper` tiene `housekeeping:edit` (permissions.ts), así que el guard de
// permisos NO distingue camarera de supervisor. La integridad del workflow de revisión
// vive en los usecases:
//  (a) quien realizó la limpieza no puede marcar presencia, aprobar ni devolver SU tarea
//      (antes: presence → approve y quedaba "inspected" con rating propio);
//  (b) aprobar dos veces (doble-toque con mala señal / dos supervisores) no pisa el
//      rating ni duplica efectos — el segundo ve la tarea ya inspeccionada;
//  (c) el PUT genérico no puede setear `inspected`: salteaba presencia + calificación.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { ApproveUseCase } from '../usecases/approve'
import { CrudUseCase } from '../usecases/crud'
import type { HousekeepingDTO, HousekeepingUser } from '../types'

const supervisor: HousekeepingUser = { id: 'sup-1', role: 'hotel_admin', hotelId: 'h1' }
const camarera: HousekeepingUser = { id: 'cam-1', role: 'housekeeper', hotelId: 'h1' }

function makeRepo(task: Partial<HousekeepingDTO>) {
  const current = {
    id: 't1', hotelId: 'h1', roomId: 'r1', staffId: 'cam-1', status: 'completed',
    supOnSiteTime: '2026-08-16T10:00:00Z', ...task,
  } as unknown as HousekeepingDTO
  const updates: Record<string, any>[] = []
  return {
    current, updates,
    repo: {
      findById: async () => current,
      update: async (_id: string, patch: Record<string, any>) => {
        updates.push(patch)
        Object.assign(current, patch)
        return current
      },
    } as unknown as RepositoryAdapter<HousekeepingDTO>,
  }
}

describe('ApproveUseCase — segregación e idempotencia', () => {
  it('(a) la camarera asignada NO puede marcar presencia de su propia tarea', async () => {
    const { repo } = makeRepo({})
    const uc = new ApproveUseCase(repo)
    await expect(uc.markPresence('t1', camarera)).rejects.toThrow('que realizaste vos mismo')
  })

  it('(a) la camarera asignada NO puede aprobar su propia tarea (ni con presencia ajena)', async () => {
    const { repo } = makeRepo({})
    const uc = new ApproveUseCase(repo)
    await expect(uc.approve('t1', camarera, undefined, 10)).rejects.toThrow('que realizaste vos mismo')
  })

  it('(a) la camarera asignada NO puede devolver (reject) su propia tarea', async () => {
    const { repo } = makeRepo({})
    const uc = new ApproveUseCase(repo)
    await expect(uc.reject('t1', camarera, 'repetir')).rejects.toThrow('que realizaste vos mismo')
  })

  it('el supervisor (no asignado) aprueba normal: completed → inspected con rating', async () => {
    const { repo, updates, current } = makeRepo({})
    const uc = new ApproveUseCase(repo)
    const res = await uc.approve('t1', supervisor, 'impecable', 9)
    expect(res.status).toBe('inspected')
    expect(current.rating).toBe(9)
    expect(current.supervisorId).toBe('sup-1')
    expect(updates).toHaveLength(1)
  })

  it('(b) aprobar una tarea ya inspeccionada es idempotente: no pisa rating ni re-emite', async () => {
    const { repo, updates, current } = makeRepo({ status: 'inspected', rating: 8, supervisorId: 'otro' })
    const uc = new ApproveUseCase(repo)
    const res = await uc.approve('t1', supervisor, undefined, 2)
    expect(res).toBe(current) // tal cual, sin update
    expect(current.rating).toBe(8) // el 2 del segundo intento NO pisó
    expect(updates).toHaveLength(0)
  })
})

describe('CrudUseCase.update — inspected solo vía approve', () => {
  it('(c) PUT con status inspected → ValidationError que indica el endpoint correcto', async () => {
    const { repo } = makeRepo({ status: 'completed', staffId: 'cam-1' })
    const crud = new CrudUseCase(repo, { findById: async () => null } as any, {
      invalidate: async () => {},
      audit: async () => {},
    } as any)
    await expect(crud.update('t1', { status: 'inspected' } as any, supervisor))
      .rejects.toThrow('POST /api/housekeeping/:id/approve')
  })

  it('PUT con otros estados sigue funcionando (corrección manual operativa)', async () => {
    const { repo, updates } = makeRepo({ status: 'completed', staffId: 'cam-1' })
    const crud = new CrudUseCase(repo, { findById: async () => null } as any, {
      invalidate: async () => {},
      audit: async () => {},
    } as any)
    await crud.update('t1', { priority: 'high' } as any, supervisor)
    expect(updates[0]?.priority).toBe('high')
  })
})
