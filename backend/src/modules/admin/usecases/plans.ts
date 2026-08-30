// usecases/plans.ts — CRUD de planes SaaS (super_admin), extraído del service (God Object >200 líneas).
// Mismo patrón que amenities-catalog.ts: el service delega, la lógica vive acá.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import { auditSafely, planDeleteEntry, type AuditPort } from './audit'
import { invalidPlanModuleKeys, suggestPlanCopy } from './modules'

export interface PlansDeps {
  plansRepo: RepositoryAdapter<any>
  logger: Logger
  /** Auth de plataforma: `assertOwnership` con el rol admin (super_admin) habilita la puerta. */
  auth?: any
  /** Recurso de plataforma: dueño centinela que nunca coincide con un user.id (ver service). */
  platformResource: string
  auditPort: () => AuditPort | null
}

/**
 * CS-9: la matriz `modules` se valida contra el catálogo (misma fuente que el gate,
 * usecases/modules.ts). Antes se persistía cualquier string y el gate lo ignoraba en
 * silencio — un typo dejaba al hotel sin el módulo sin error visible para el super_admin.
 * El controller mapea ValidationError → 400.
 */
function assertValidPlanModules(modules: unknown): void {
  const invalid = invalidPlanModuleKeys(Array.isArray(modules) ? modules : [])
  if (invalid.length) {
    throw new ValidationError(
      `Claves de módulo inválidas en el plan: ${invalid.join(', ')}. `
      + 'Cada clave debe ser un módulo (ej: finance) o un submódulo (ej: finance.billing) del catálogo (GET /api/admin/modules/catalog)',
    )
  }
}

/**
 * QA 2026-08-30 — si el admin eligió módulos pero dejó Descripción/Features en blanco, el plan
 * quedaba "mudo" en la landing pública (sin ninguna copy, aunque el catálogo SÍ describe cada
 * módulo). Completa esos dos campos con `suggestPlanCopy` SOLO cuando llegan vacíos — nunca pisa
 * texto que el admin ya escribió a mano. Sigue siendo texto plano editable después (no un
 * template server-side): el admin puede reescribirlo desde `plans.vue` como siempre.
 */
function withSuggestedCopy(body: any, modules: unknown[]): { description: string; features: unknown[] } {
  const needsDescription = !body.description
  const needsFeatures = !Array.isArray(body.features) || body.features.length === 0
  if (modules.length === 0 || (!needsDescription && !needsFeatures)) {
    return { description: body.description || '', features: body.features || [] }
  }
  const suggested = suggestPlanCopy(modules)
  return {
    description: needsDescription ? suggested.description : body.description,
    features: needsFeatures ? suggested.features : body.features,
  }
}

export async function createPlan(deps: PlansDeps, body: any): Promise<any> {
  if (!body.name || !body.price) throw new Error('name y price requeridos')
  if (body.modules !== undefined) assertValidPlanModules(body.modules)
  const modules = Array.isArray(body.modules) ? body.modules : []
  const copy = withSuggestedCopy(body, modules)
  return await deps.plansRepo.create({
    name: body.name,
    slug: body.name.toLowerCase().replace(/\s+/g, '-'),
    price: Number(body.price), currency: body.currency || 'USD',
    description: copy.description, features: copy.features,
    modules,
    limits: body.limits || { rooms: 30, users: 2, properties: 1 },
    isActive: body.isActive !== false ? 1 : 0, sortOrder: body.sortOrder || 0,
  })
}

export async function updatePlan(deps: PlansDeps, id: string, body: any, user?: any): Promise<any> {
  const existing = await deps.plansRepo.findById(id) as any
  if (!existing) throw new Error('Plan no encontrado')
  if (deps.auth) deps.auth.assertOwnership(deps.platformResource, user?.id ?? '', user?.role, 'super_admin')
  if (body.modules !== undefined) assertValidPlanModules(body.modules)
  const patch: Record<string, any> = {}
  for (const k of ['name', 'price', 'currency', 'description', 'features', 'modules', 'limits', 'isActive', 'sortOrder']) {
    if (body[k] !== undefined) patch[k] = k === 'isActive' ? (body[k] ? 1 : 0) : body[k]
  }
  if (body.modules !== undefined) {
    const copy = withSuggestedCopy(body, body.modules)
    patch.description = copy.description
    patch.features = copy.features
  }
  if (body.name) patch.slug = body.name.toLowerCase().replace(/\s+/g, '-')
  return await deps.plansRepo.update(id, patch)
}

export async function deletePlan(deps: PlansDeps, id: string, user?: any): Promise<void> {
  const existing = await deps.plansRepo.findById(id) as any
  if (!existing) throw new Error('Plan no encontrado')
  if (deps.auth) deps.auth.assertOwnership(deps.platformResource, user?.id ?? '', user?.role, 'super_admin')
  await deps.plansRepo.delete(id)
  await auditSafely(deps.auditPort(), deps.logger, planDeleteEntry(existing, user))
}
