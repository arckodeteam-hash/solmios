// bookingengine/usecases/child-amenities-crud.ts — Admin CRUD de amenidades para niños/bebés
// (REQ-01, #233).
//
// Sub-dominio del módulo bookingengine, mismo criterio que upsells-crud.ts: las amenidades
// infantiles son extras del motor de reservas (comparten hotelId + permiso), no ameritan
// módulo aparte. Catálogo ABIERTO por hotel (nombre libre + precio) — a diferencia de la cuna
// (`childPolicy.cribAvailable`, Sí/No sin precio, que sigue igual).
//
// Reglas de negocio (mismas que upsells-crud.ts):
//  - Ownership IDOR: `assertOwnershipOf` re-lee el hotelId del usuario vía userRepo, no confía
//    en el JWT directo. update/remove validan que el registro sea del hotel del admin.
//  - Multi-tenant: TODO filtrado por hotelId.
//  - `name` no vacío tras trim y `price` número finito >= 0 (0 = gratuita, se muestra igual)
//    validados acá. `active` default true.
//  - Sin unique constraint física sobre `name` (mismo criterio que upsells).
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en model.ts.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  ChildAmenityDTO, CreateChildAmenityDTO, UpdateChildAmenityDTO, UpsellCurrentUser,
} from '../types'

export interface ChildAmenitiesCrudDeps {
  childAmenities: RepositoryAdapter<ChildAmenityDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
}

// ─── helpers ───────────────────────────────────────────────────────────────

/** Hotel efectivo del JWT; rechaza si el usuario no tiene hotel asignado. */
function hotelFor(user: UpsellCurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

/** `name` requerido, no vacío tras trim. Devuelve el valor normalizado. */
function assertName(n: unknown): string {
  const s = typeof n === 'string' ? n.trim() : ''
  if (!s) throw new ValidationError('name es requerido')
  return s
}

/** Valida price >= 0 (0 permitido = amenidad gratuita). */
function assertPrice(p: unknown): number {
  const n = Number(p)
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError('price debe ser un número >= 0')
  }
  return n
}

/** `sortOrder` opcional: entero >= 0. */
function assertSortOrder(s: unknown): number {
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError('sortOrder debe ser un número >= 0')
  }
  return Math.floor(n)
}

/**
 * Resuelve el hotelId efectivo (vía userRepo, no del JWT directo) y lo compara contra
 * `resourceHotelId` con `auth.assertOwnership`. Patrón upsells-crud / landing / blocks-crud.
 */
async function assertOwnershipOf(deps: ChildAmenitiesCrudDeps, resourceHotelId: string, user: UpsellCurrentUser): Promise<void> {
  const me = await deps.userRepo.findOne({ id: user.id })
  deps.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
}

/**
 * Busca la amenidad por id y exige que sea del hotel del admin. Un id de OTRO hotel devuelve
 * el mismo 404 que un id inexistente (anti-enumeración: no revela que existe en otro tenant).
 */
async function findOwned(deps: ChildAmenitiesCrudDeps, id: string, user: UpsellCurrentUser): Promise<ChildAmenityDTO> {
  const hotelId = hotelFor(user)
  const existing = await deps.childAmenities.findOne({ id })
  if (!existing || existing.hotelId !== hotelId) throw new NotFoundError('Amenidad no encontrada')
  await assertOwnershipOf(deps, existing.hotelId, user)
  return existing
}

/** Orden canónico: `sortOrder` ASC, desempate por `name` (alfabético, estable). */
function sortAmenities(rows: ChildAmenityDTO[]): ChildAmenityDTO[] {
  return rows.sort((a, b) => {
    const sa = Number(a.sortOrder ?? 0)
    const sb = Number(b.sortOrder ?? 0)
    if (sa !== sb) return sa - sb
    return String(a.name ?? '').localeCompare(String(b.name ?? ''))
  })
}

// ─── list ──────────────────────────────────────────────────────────────────
/** Lista las amenidades del hotel del admin, ordenadas por sortOrder ASC y luego name. */
export async function list(
  deps: ChildAmenitiesCrudDeps,
  user: UpsellCurrentUser,
): Promise<{ data: ChildAmenityDTO[]; total: number }> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const all = sortAmenities(await deps.childAmenities.findMany({ hotelId }))
  return { data: all, total: all.length }
}

// ─── create ────────────────────────────────────────────────────────────────
export async function create(
  deps: ChildAmenitiesCrudDeps,
  dto: CreateChildAmenityDTO,
  user: UpsellCurrentUser,
): Promise<ChildAmenityDTO> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const name = assertName(dto.name)
  const price = assertPrice(dto.price)

  const record: Omit<ChildAmenityDTO, 'id' | 'createdAt' | 'updatedAt'> = {
    hotelId,
    name,
    price,
    active: typeof dto.active === 'boolean' ? dto.active : true,
    sortOrder: dto.sortOrder !== undefined ? assertSortOrder(dto.sortOrder) : 0,
  }

  return await deps.childAmenities.create(record as any) as ChildAmenityDTO
}

// ─── update ────────────────────────────────────────────────────────────────
export async function update(
  deps: ChildAmenitiesCrudDeps,
  id: string,
  dto: UpdateChildAmenityDTO,
  user: UpsellCurrentUser,
): Promise<ChildAmenityDTO> {
  await findOwned(deps, id, user)

  const patch: Record<string, unknown> = {}
  if (dto.name !== undefined) patch.name = assertName(dto.name)
  if (dto.price !== undefined) patch.price = assertPrice(dto.price)
  if (dto.active !== undefined) patch.active = dto.active
  if (dto.sortOrder !== undefined) patch.sortOrder = assertSortOrder(dto.sortOrder)

  const updated = await deps.childAmenities.update(id, patch as Partial<Omit<ChildAmenityDTO, 'id'>>)
  if (!updated) throw new NotFoundError('Amenidad no encontrada')
  return updated
}

// ─── delete ────────────────────────────────────────────────────────────────
export async function remove(
  deps: ChildAmenitiesCrudDeps,
  id: string,
  user: UpsellCurrentUser,
): Promise<{ id: string; deleted: true }> {
  await findOwned(deps, id, user)
  const ok = await deps.childAmenities.delete(id)
  if (!ok) throw new NotFoundError('Amenidad no encontrada')
  return { id, deleted: true }
}
