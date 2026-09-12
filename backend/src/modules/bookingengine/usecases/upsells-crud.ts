// bookingengine/usecases/upsells-crud.ts — Admin CRUD de upsells (F2 2.3).
//
// Sub-dominio del módulo bookingengine: vive acá porque los upsells son extras del
// widget de reservas (comparten hotelId + permiso), no ameritan módulo aparte.
//
// Reglas de negocio (mismas que promo-codes / landing):
//  - Ownership IDOR: toda operación admin valida que el upsell pertenezca al hotel
//    del JWT. `findOne({id})` + `auth.assertOwnership(record.hotelId, user.hotelId, ...)`.
//  - Multi-tenant: TODO filtrado por hotelId.
//  - `kind` (enum cerrado) y `price` (>=0) validados acá (el validador no soporta
//    unión discriminada ni condicionales).
//  - Sin unique constraint física: el mismo `name` puede repetirse (no hay business
//    rule que lo prohíba — un hotel puede tener "Desayuno" y "Desayuno VIP"). Si en
//    el futuro se pide único por (hotelId, name), se agrega UNIQUE index en migrate-db.
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en model.ts.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  UpsellDTO, CreateUpsellDTO, UpdateUpsellDTO, UpsellKind, UpsellCurrentUser,
} from '../types'

export interface UpsellsCrudDeps {
  upsells: RepositoryAdapter<UpsellDTO>
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

/** Enum cerrado de `UpsellKind` (única lista; `per_night` y `per_person_per_night` son de MR-10 #275). */
const UPSELL_KINDS: readonly UpsellKind[] = ['per_room', 'per_person', 'per_stay', 'per_night', 'per_person_per_night']

/** Valida que `t` esté en el enum cerrado de UpsellKind. */
function assertKind(t: unknown): UpsellKind {
  if (!UPSELL_KINDS.includes(t as UpsellKind)) {
    throw new ValidationError(`kind debe ser uno de: ${UPSELL_KINDS.map((k) => `'${k}'`).join(', ')}`)
  }
  return t as UpsellKind
}

/** Valida price >= 0 (permitimos 0 para "gratis como beneficio"). */
function assertPrice(p: unknown): number {
  const n = Number(p)
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError('price debe ser un número >= 0')
  }
  return n
}

/**
 * Resuelve el hotelId efectivo (vía userRepo, no del JWT directo) y lo compara contra
 * `resourceHotelId` con `auth.assertOwnership`. Patrón landing/blocks-crud.
 */
async function assertOwnershipOf(deps: UpsellsCrudDeps, resourceHotelId: string, user: UpsellCurrentUser): Promise<void> {
  const me = await deps.userRepo.findOne({ id: user.id })
  deps.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
}

// ─── list ──────────────────────────────────────────────────────────────────
/**
 * Lista los upsells del hotel del admin. Orden: `sortOrder` ASC (orden canónico del
 * widget), desempate por `createdAt` ASC (estables).
 */
export async function list(
  deps: UpsellsCrudDeps,
  user: UpsellCurrentUser,
): Promise<{ data: UpsellDTO[]; total: number }> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const all = await deps.upsells.findMany({ hotelId })
  all.sort((a, b) => {
    const sa = a.sortOrder ?? 0
    const sb = b.sortOrder ?? 0
    if (sa !== sb) return sa - sb
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  })
  return { data: all, total: all.length }
}

// ─── create ────────────────────────────────────────────────────────────────
export async function create(
  deps: UpsellsCrudDeps,
  dto: CreateUpsellDTO,
  user: UpsellCurrentUser,
): Promise<UpsellDTO> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  if (!dto.name || !String(dto.name).trim()) throw new ValidationError('name es requerido')
  const kind = assertKind(dto.kind)
  const price = assertPrice(dto.price)

  const record: Omit<UpsellDTO, 'id'> = {
    hotelId,
    name: String(dto.name).trim(),
    description: dto.description ?? null,
    price,
    kind,
    active: typeof dto.active === 'boolean' ? dto.active : true,
    sortOrder: typeof dto.sortOrder === 'number' ? dto.sortOrder : 0,
  } as any

  return await deps.upsells.create(record as any) as UpsellDTO
}

// ─── update ────────────────────────────────────────────────────────────────
export async function update(
  deps: UpsellsCrudDeps,
  id: string,
  dto: UpdateUpsellDTO,
  user: UpsellCurrentUser,
): Promise<UpsellDTO> {
  const existing = await deps.upsells.findOne({ id })
  if (!existing) throw new NotFoundError('Upsell no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)

  const patch: Record<string, unknown> = {}
  if (dto.name !== undefined) {
    if (!String(dto.name).trim()) throw new ValidationError('name no puede ser vacío')
    patch.name = String(dto.name).trim()
  }
  if (dto.description !== undefined) patch.description = dto.description
  if (dto.kind !== undefined) patch.kind = assertKind(dto.kind)
  if (dto.price !== undefined) patch.price = assertPrice(dto.price)
  if (dto.active !== undefined) patch.active = dto.active
  if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder

  const updated = await deps.upsells.update(id, patch as Partial<Omit<UpsellDTO, 'id'>>)
  if (!updated) throw new NotFoundError('Upsell no encontrado')
  return updated
}

// ─── delete ────────────────────────────────────────────────────────────────
export async function remove(
  deps: UpsellsCrudDeps,
  id: string,
  user: UpsellCurrentUser,
): Promise<{ id: string; deleted: true }> {
  const existing = await deps.upsells.findOne({ id })
  if (!existing) throw new NotFoundError('Upsell no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)
  const ok = await deps.upsells.delete(id)
  if (!ok) throw new NotFoundError('Upsell no encontrado')
  return { id, deleted: true }
}
