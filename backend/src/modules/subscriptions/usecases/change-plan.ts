// subscriptions/usecases/change-plan.ts — Mover el plan REAL de un hotel.
//
// El bug que motivó esto (#46): el super admin cambiaba el plan desde /admin/hotels y el panel
// del hotel no cambiaba nada. `AdminService.updateHotel` escribía SOLO el espejo legacy
// `hotels.plan`, y `resolveHotelPlan` ignora ese espejo cuando el hotel tiene una suscripción
// activa — la fuente de verdad es `subscriptions.planId` (ver resolve-plan.ts). O sea: el select
// existía, guardaba, y el hotel seguía viendo exactamente los mismos módulos de antes.
//
// Este usecase es el núcleo compartido: lo usan el cambio de plan del super admin y el upgrade
// self-service del hotel. NO habla con Stripe — mueve el plan que decide el gate y deja el
// espejo consistente; el cobro/prorrateo es responsabilidad de quien llama (upgrade-plan.ts).
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ValidationError, NotFoundError } from 'arckode-framework'
import { WORKING_STATUSES } from './access'
import { compareSubscriptions } from './resolve-plan'

export interface ChangePlanDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  hotelsRepo: RepositoryAdapter<any>
  plansRepo: RepositoryAdapter<any>
  logger: Logger
}

export interface ChangePlanOptions {
  /**
   * Deja mover a un plan con `isActive` en false. Es para la plataforma: el super admin puede
   * necesitar poner a un hotel en un plan retirado del catálogo público (migración, acuerdo
   * puntual). El upgrade self-service NUNCA lo manda — un plan dado de baja no se vende solo.
   */
  allowInactive?: boolean
}

export interface ChangePlanResult {
  /** `false` sólo cuando NO se escribió nada: ni la suscripción ni el espejo (idempotente). */
  changed: boolean
  hotelId: string
  planId: string
  planSlug: string
  /** `planId` que tenía la suscripción antes del cambio (`null` si no había fila activa). */
  previousPlanId: string | null
  /** Fila de `subscriptions` movida · `null` = el hotel no tiene ninguna activa (camino legacy). */
  subscriptionId: string | null
}

/**
 * Cambia el plan efectivo de un hotel.
 *
 * `planRef` acepta el `plans.id` O el `plans.slug`: el select de /admin/hotels manda el slug
 * (su dominio es `hotels.plan`) y el upgrade del panel manda el id. Se resuelve por id primero
 * — es la clave real — y recién después por slug en minúsculas.
 */
export async function changeHotelPlan(
  deps: ChangePlanDeps,
  hotelId: string,
  planRef: string,
  options: ChangePlanOptions = {},
): Promise<ChangePlanResult> {
  const { subscriptionsRepo, hotelsRepo, plansRepo, logger } = deps
  if (!hotelId) throw new ValidationError('Falta el hotel')
  if (!planRef) throw new ValidationError('Falta el plan')

  const plan = await resolvePlan(plansRepo, planRef)
  if (!plan) throw new NotFoundError('Plan no encontrado')
  // `isActive` llega como boolean o como 0/1 según el motor (sqlite guarda enteros).
  if (!options.allowInactive && (plan.isActive === false || plan.isActive === 0)) {
    throw new ValidationError('Ese plan está desactivado')
  }

  const hotel = (await hotelsRepo.findById(hotelId)) as any
  if (!hotel) throw new NotFoundError('Hotel no encontrado')

  const planId = String(plan.id)
  const planSlug = plan.slug ? String(plan.slug) : ''

  // MISMO criterio que el gate, importado — no reimplementado. Si acá se eligiera otra fila
  // (un `find` sin orden, otra lista de estados), el hotel quedaría gateado con una suscripción
  // distinta de la que se movió: el cambio "guardaría" y el panel seguiría igual, que es
  // exactamente el bug que este usecase viene a cerrar (CS-7 en resolve-plan.ts).
  const subs = ((await subscriptionsRepo.findMany({ hotelId })) as any[]) ?? []
  const active = subs.filter((s) => WORKING_STATUSES.has(s?.status)).sort(compareSubscriptions)[0]

  const previousPlanId = active?.planId ? String(active.planId) : null
  // Dos mutaciones posibles e INDEPENDIENTES: la suscripción y el espejo. `changed` tiene que
  // cubrir las dos o miente: con la suscripción ya en el plan pedido pero `hotels.plan` atrasado
  // (el desfasaje que este mismo bug dejó en producción antes del arreglo), el espejo SÍ se
  // reescribe y devolver `changed:false` afirmaría que no se tocó nada.
  const subStale = !!active && previousPlanId !== planId
  const mirrorStale = !!planSlug && String(hotel.plan ?? '') !== planSlug
  const changed = subStale || mirrorStale

  if (active && subStale) {
    await subscriptionsRepo.update(active.id, { planId })
    logger.info('Plan del hotel cambiado', { hotelId, previousPlanId, planId, planSlug, subscriptionId: active.id })
  } else if (active && mirrorStale) {
    // La suscripción ya estaba bien y sólo se reparó el espejo. Es una escritura real en
    // producción: sin este log no quedaba ningún rastro de que se tocó la fila del hotel.
    logger.info('Espejo hotels.plan reparado (la suscripción ya estaba en ese plan)', {
      hotelId, planId, planSlug, espejoAnterior: String(hotel.plan ?? ''),
    })
  } else if (!active && changed) {
    // Hotel SIN suscripción activa (fila cancelada/vencida, o alta previa a este módulo). No se
    // inventa una suscripción: crear una fila `active` sin nada en Stripe le daría acceso pago
    // gratis y ensuciaría el webhook. Ese hotel se resuelve por el camino legacy de
    // resolveHotelPlan, y ahí el espejo `hotels.plan` SÍ es su fuente — con espejarlo alcanza.
    logger.info('Plan del hotel cambiado (sin suscripción activa: solo espejo legacy)', { hotelId, planId, planSlug })
  }

  // Espejo legacy, BEST-EFFORT — mismo criterio que handle-stripe-event.ts: la fuente de verdad
  // (la suscripción) ya quedó bien y un fallo acá no puede tumbar la operación; a lo sumo el
  // espejo queda viejo para los lectores legacy.
  if (mirrorStale) {
    try {
      await hotelsRepo.update(hotelId, { plan: planSlug })
    } catch (e) {
      logger.warn('No se pudo sincronizar hotels.plan tras el cambio de plan', { hotelId, error: (e as Error).message })
    }
  }

  return { changed, hotelId, planId, planSlug, previousPlanId, subscriptionId: active?.id ? String(active.id) : null }
}

/** Por `plans.id` primero (clave real) y, si no existe, por `plans.slug` en minúsculas. */
async function resolvePlan(plansRepo: RepositoryAdapter<any>, planRef: string): Promise<any | null> {
  const ref = String(planRef).trim()
  const byId = (await plansRepo.findById(ref)) as any
  if (byId) return byId
  return ((await plansRepo.findMany({ slug: ref.toLowerCase() })) as any[])?.[0] ?? null
}
