// admin/usecases/amenities-catalog.ts — CRUD del catálogo de amenities de la plataforma.
//
// Extraído de `admin/service.ts` (el service pasó de 216 líneas y `arckode analyze` lo marcaba
// como God Object). Lógica idéntica a la que vivía en el service: mismos errores, mismo
// `assertOwnership` contra el centinela de recurso de plataforma, mismo audit al borrar.

import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { ValidationError, ConflictError, NotFoundError } from 'arckode-framework'
import type { AmenityCatalogDTO } from '../types'
import { auditSafely, amenityCatalogDeleteEntry, type AuditPort } from './audit'

export interface AmenitiesCatalogDeps {
  repo: RepositoryAdapter<AmenityCatalogDTO>
  logger: Logger
  /**
   * OBLIGATORIO y tipado (QA7-3/QA11-2). Con `auth?: any` un wiring sin auth apagaba el chequeo
   * ENTERO en silencio (`if (deps.auth)`), justo al revés de la decisión que se tomó en
   * `payment-requests/service.ts` para el repo de extras: una dependencia de seguridad no puede
   * ser opcional. `admin/index.ts` ya corta el arranque si no hay auth.
   */
  auth: Pick<Auth, 'assertOwnership'>
  /** Centinela de "recurso de la plataforma": cierra la puerta del dueño y deja sólo la del rol. */
  platformResource: string
  auditPort(): AuditPort | null
}

/**
 * El catálogo es de la PLATAFORMA: sólo el super_admin lo toca. Sin ramas opcionales.
 *
 * El "solicitante" va VACÍO a propósito. `Auth.assertOwnership` (kernel/auth.ts) deja pasar primero
 * a quien coincide con el dueño del recurso (`requestingUserId === resourceOwnerId`); pasando el id
 * del usuario, alguien cuyo id fuera literalmente el centinela entraba por esa puerta. Un recurso de
 * plataforma NO tiene dueño: la única llave válida es el rol.
 */
/** Lo mínimo que hace falta del usuario autenticado. Tipado: de esto depende la autorización. */
export interface AmenityActor { id?: string; role?: string }

function assertPlatformAdmin(deps: AmenitiesCatalogDeps, user?: AmenityActor): void {
  deps.auth.assertOwnership(deps.platformResource, '', user?.role, 'super_admin')
}

/** Cuerpo aceptado por el alta/edición. Espeja `validators/schema.ts` (Create/UpdateAmenityCatalog). */
export interface AmenityCatalogInput {
  key?: string
  label?: string
  category?: string
  icon?: string
  isActive?: boolean | number
  sortOrder?: number
}

export async function listAmenitiesCatalog(deps: AmenitiesCatalogDeps): Promise<{ data: AmenityCatalogDTO[]; total: number }> {
  const data = await deps.repo.findMany({})
  return { data, total: data.length }
}

export async function createAmenityCatalog(deps: AmenitiesCatalogDeps, body: AmenityCatalogInput, user?: AmenityActor): Promise<AmenityCatalogDTO> {
  // Defensa en profundidad, igual que update/delete: el catálogo es un recurso de la PLATAFORMA,
  // no de un hotel. Sin esto el alta quedaba colgada sólo del guard de ruta.
  assertPlatformAdmin(deps, user)
  // STR-4: errores TIPADOS. Con `new Error()` en español el status HTTP salía de
  // `msg.includes('ya existe')` en el controller: cambiar un texto de UI cambiaba el código de
  // respuesta. Mismo criterio que `usecases/subscription-categories.ts`.
  if (!body.key || !body.label) throw new ValidationError('key y label requeridos')
  const existing = (await deps.repo.findMany({ key: body.key }))[0]
  if (existing) throw new ConflictError('Amenity ya existe')
  return await deps.repo.create({
    key: body.key, label: body.label,
    category: body.category || 'interior', icon: body.icon || '',
    isActive: body.isActive !== false ? 1 : 0, sortOrder: body.sortOrder || 0,
  } as Omit<AmenityCatalogDTO, 'id'>)
}

export async function updateAmenityCatalog(deps: AmenitiesCatalogDeps, id: string, body: AmenityCatalogInput, user?: AmenityActor): Promise<AmenityCatalogDTO> {
  // SEC-3: autorizar ANTES de leer. Con el `findById` primero, un usuario sin permiso distinguía
  // 404 de 403 y podía sondear qué ids existen — un oráculo de existencia gratis.
  assertPlatformAdmin(deps, user)
  const existing = await deps.repo.findById(id)
  if (!existing) throw new NotFoundError('Amenity no encontrado')
  const patch: Record<string, unknown> = {}
  for (const k of ['key', 'label', 'category', 'icon', 'isActive', 'sortOrder'] as (keyof AmenityCatalogInput)[]) {
    if (body[k] !== undefined) patch[k] = k === 'isActive' ? (body[k] ? 1 : 0) : body[k]
  }
  return await deps.repo.update(id, patch as Partial<AmenityCatalogDTO>) as AmenityCatalogDTO
}

export async function deleteAmenityCatalog(deps: AmenitiesCatalogDeps, id: string, user?: AmenityActor): Promise<void> {
  // SEC-3: mismo orden que el update — permiso primero, lectura después.
  assertPlatformAdmin(deps, user)
  const existing = await deps.repo.findById(id)
  if (!existing) throw new NotFoundError('Amenity no encontrado')
  await deps.repo.delete(id)
  await auditSafely(deps.auditPort(), deps.logger, amenityCatalogDeleteEntry(existing, user))
}
