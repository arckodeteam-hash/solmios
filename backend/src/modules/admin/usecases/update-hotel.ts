// admin/usecases/update-hotel.ts — Actualización de CUALQUIER hotel desde la plataforma.
//
// Se extrajo de `admin/service.ts` (que había pasado el límite de 200 líneas del analyzer)
// SIN cambiar el comportamiento: mismas validaciones, mismo orden de escritura y mismos
// mensajes de error. La cobertura vive en `tests/update-hotel-plan.test.ts`.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { changeHotelPlan } from '../../subscriptions/usecases/change-plan'

export interface UpdateHotelDeps {
  hotelsRepo?: RepositoryAdapter<any>
  plansRepo: RepositoryAdapter<any>
  subscriptionsRepo?: RepositoryAdapter<any>
  logger: Logger
  auth?: any
  platformResource: string
}

/**
 * Actualiza plan/estado/datos de CUALQUIER hotel (operación de plataforma, solo super_admin).
 * El `plan` se valida contra la tabla `plans` (no un enum): un plan inexistente → error. Así se puede
 * asignar cualquier plan que exista en la tabla y no quedan planes fantasma.
 */
export async function updateHotel(deps: UpdateHotelDeps, id: string, body: any, user?: any): Promise<any> {
  const { hotelsRepo, plansRepo, subscriptionsRepo, logger, auth, platformResource } = deps
  if (!hotelsRepo) throw new Error('hotelsRepo no disponible')
  const existing = await hotelsRepo.findById(id) as any
  if (!existing) throw new Error('Hotel no encontrado')
  if (auth) auth.assertOwnership(platformResource, user?.id ?? '', user?.role, 'super_admin')
  const patch: Record<string, any> = {}
  if (body.plan !== undefined) {
    const slug = String(body.plan).toLowerCase()
    const plan = (await plansRepo.findMany({ slug }))[0]
    if (!plan) throw new Error(`El plan '${body.plan}' no existe en el catálogo de planes`)
    patch.plan = slug
    // #46: el gate IGNORA este espejo si el hotel tiene suscripción activa (resolve-plan.ts) —
    // escribir solo `hotels.plan` "guardaba" y el panel seguía con los módulos viejos. Va ANTES
    // del espejo y el error se PROPAGA: si falla no se escribe NADA, en vez de prometer un plan
    // que el hotel no tiene. `allowInactive`: la plataforma sí asigna planes fuera de catálogo.
    if (subscriptionsRepo) {
      await changeHotelPlan({ subscriptionsRepo, hotelsRepo, plansRepo, logger }, id, String((plan as any).id), { allowInactive: true })
    }
  }
  if (body.status !== undefined) patch.status = String(body.status).toLowerCase()
  if (body.name !== undefined) patch.name = body.name
  if (body.email !== undefined) patch.email = body.email
  if (body.phone !== undefined) patch.phone = body.phone
  if (body.location !== undefined) patch.address = body.location
  return await hotelsRepo.update(id, patch)
}
