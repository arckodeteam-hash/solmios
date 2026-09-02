// habitaciones/usecases/batch-create.ts — alta masiva de habitaciones por rango de números.
// Extraído del service (SC-05) para mantenerlo bajo el límite de 200 líneas del analyzer.
// Corre en transacción si hay ORM: o entran todas las del lote o ninguna.

import type { RepositoryAdapter, Logger, CacheAdapter, ORM } from 'arckode-framework'
import { AuthError, ValidationError, OrmRepository } from 'arckode-framework'
import type { HabitacionesDTO } from '../types'
import { bumpListVersion } from './cache'

export interface BatchCreateInput {
  hotelId: string
  type: string
  basePrice: number
  from: number
  to: number
  floor?: number
  capacity?: number
  bathrooms?: number
  surfaceArea?: number
  onlineBookingEnabled?: boolean
}

export interface BatchCreateDeps {
  repo: RepositoryAdapter<HabitacionesDTO>
  logger: Logger
  cache: CacheAdapter
  orm?: ORM
  onCreated?: (item: HabitacionesDTO) => Promise<void> | void
}

export async function batchCreateRooms(
  deps: BatchCreateDeps,
  input: BatchCreateInput,
  currentUser: { id: string; role: string; hotelId?: string },
): Promise<HabitacionesDTO[]> {
  if (currentUser.role !== 'super_admin' && input.hotelId !== currentUser.hotelId) {
    throw new AuthError('No autorizado para crear en otro hotel')
  }
  if (input.from > input.to) {
    throw new ValidationError('"from" debe ser menor o igual que "to"')
  }
  const count = input.to - input.from + 1
  if (count > 500) {
    throw new ValidationError('Máximo 500 habitaciones por lote')
  }

  const created: HabitacionesDTO[] = []

  const doCreate = async (repo: RepositoryAdapter<HabitacionesDTO>) => {
    const existing = await repo.findMany({ hotelId: input.hotelId })
    const existingNumbers = new Set(existing.map((r) => r.number))

    for (let i = input.from; i <= input.to; i++) {
      const number = String(i)
      if (existingNumbers.has(number)) {
        deps.logger.warn(`batch create: skipping duplicate number ${number}`)
        continue
      }
      const dto: any = {
        number,
        type: input.type,
        basePrice: input.basePrice,
        hotelId: input.hotelId,
        status: 'available',
        floor: input.floor ?? 1,
        capacity: input.capacity ?? 2,
        bathrooms: input.bathrooms ?? 1,
        surfaceArea: input.surfaceArea ?? 0,
        onlineBookingEnabled: input.onlineBookingEnabled !== false,
      }
      const item = await repo.create(dto)
      created.push(item)
    }

    if (created.length === 0 && count > 0) {
      throw new ValidationError('Todos los números ya existen')
    }
  }

  if (deps.orm) {
    await deps.orm.transaction(async (tx) => {
      const txRepo = new OrmRepository<HabitacionesDTO>(tx, 'Rooms')
      await doCreate(txRepo)
    })
  } else {
    await doCreate(deps.repo)
  }

  for (const item of created) {
    await deps.onCreated?.(item)
  }

  // El listado se cachea con clave VERSIONADA (ver `usecases/cache.ts`): el `delete` de una clave
  // fija que había acá no borraba nada —esa clave no existe— y el lote recién creado quedaba
  // invisible en el panel durante los 5 minutos del TTL. El alta de a una ya bumpeaba la versión;
  // el lote no, que es justo por donde carga sus habitaciones un hotel nuevo.
  await bumpListVersion(deps.cache, input.hotelId)
  return created
}
