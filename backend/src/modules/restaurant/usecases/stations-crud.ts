// restaurant/usecases/stations-crud.ts — CRUD de estaciones (pantallas KDS configurables, RES-0).
// Extraído del service para mantenerlo bajo el límite de líneas (God Object, arckode analyze).
// Reglas: ownership (IDOR); nombre obligatorio.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { StationDTO, CurrentUser } from '../types'

export interface StationsCrudDeps {
  stations: RepositoryAdapter<StationDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
}

export interface CreateStationInput { name: string; active?: number; sortOrder?: number; alertMinutes?: number }
export interface UpdateStationInput { name?: string; active?: number; sortOrder?: number; alertMinutes?: number }

/** #211 — umbral de demora del KDS por estación (ámbar a N min, rojo a 2N). */
export const DEFAULT_ALERT_MINUTES = 10
const MAX_ALERT_MINUTES = 180

function assertAlertMinutes(v: number | undefined): void {
  if (v === undefined) return
  if (!Number.isInteger(v) || v < 1 || v > MAX_ALERT_MINUTES) {
    throw new ValidationError(`El umbral de demora debe ser un entero entre 1 y ${MAX_ALERT_MINUTES} minutos`)
  }
}

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

export async function listStations(deps: StationsCrudDeps, user: CurrentUser): Promise<{ data: StationDTO[]; total: number }> {
  const data = await deps.stations.findMany({ hotelId: hotelFor(user) })
  data.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  return { data, total: data.length }
}

export async function getStation(deps: StationsCrudDeps, id: string, user: CurrentUser): Promise<StationDTO> {
  const item = await deps.stations.findById(id)
  if (!item) throw new NotFoundError('Estación no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(item.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  return item
}

export async function createStation(deps: StationsCrudDeps, dto: CreateStationInput, user: CurrentUser): Promise<StationDTO> {
  const hotelId = hotelFor(user)
  if (!dto.name?.trim()) throw new ValidationError('El nombre de la estación es obligatorio')
  assertAlertMinutes(dto.alertMinutes)
  return deps.stations.create({
    hotelId, name: dto.name.trim(), active: dto.active ?? 1, sortOrder: dto.sortOrder ?? 0,
    alertMinutes: dto.alertMinutes ?? DEFAULT_ALERT_MINUTES,
  } as Omit<StationDTO, 'id'>)
}

export async function updateStation(deps: StationsCrudDeps, id: string, dto: UpdateStationInput, user: CurrentUser): Promise<StationDTO> {
  const existing = await deps.stations.findById(id)
  if (!existing) throw new NotFoundError('Estación no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  assertAlertMinutes(dto.alertMinutes)
  const item = await deps.stations.update(id, dto as Partial<Omit<StationDTO, 'id'>>)
  if (!item) throw new NotFoundError('Estación no encontrada')
  return item
}

/** Las categorías/ítems que referencian la estación caen al fallback de ruteo (1ª activa / "Sin estación"). */
export async function deleteStation(deps: StationsCrudDeps, id: string, user: CurrentUser): Promise<void> {
  const existing = await deps.stations.findById(id)
  if (!existing) throw new NotFoundError('Estación no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  const deleted = await deps.stations.delete(id)
  if (!deleted) throw new NotFoundError('Estación no encontrada')
}
