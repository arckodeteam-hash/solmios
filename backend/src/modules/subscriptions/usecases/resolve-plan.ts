// resolve-plan.ts — ¿Qué plan corre efectivamente para un hotel?
//
// FUENTE DE VERDAD: la fila de `subscriptions` ACTIVA del hotel (trialing/active/past_due —
// mismos estados que access.ts:WORKING_STATUSES). `hotels.plan` es SOLO un espejo que se
// mantiene sincronizado (signup al arrancar el trial, handle-stripe-event al pagar) para los
// lectores legacy — nunca decide qué módulos ve el hotel.
//
// El bug que motivó esto (prod 2026-08): el trial elegía `plan-host` (4 módulos), el alta
// nunca escribía `hotels.plan`, el default del modelo ('professional') ganaba, y el gate de
// módulos — que solo leía `hotels.plan` — le mostraba al hotel TODOS los módulos del panel.
import type { RepositoryAdapter } from 'arckode-framework'

/** Estados con suscripción viva. Mismo criterio que access.ts:WORKING_STATUSES (privado ahí,
 *  público acá porque el gate de módulos necesita el mismo conjunto). */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due'] as const

export interface ResolvedHotelPlan {
  /** `plans.modules` TAL CUAL configurado. `null` = sin matriz → sin restricción de plan (legacy). */
  modules: string[] | null
  /** Slug del plan resuelto (dominio de `hotels.plan`). */
  slug?: string
  /** `plans.id` de la suscripción activa, cuando la hubo. */
  planId?: string
  /** 'subscription' = la fila activa manda · 'legacy' = espejo hotels.plan / sin datos. */
  source: 'subscription' | 'legacy'
}

/** `plans.modules` llega como json (array) o string JSON según el motor — normaliza. `null` si no es array. */
function parseModules(raw: unknown): string[] | null {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  return Array.isArray(value) ? value.map(String) : null
}

export async function resolveHotelPlan(
  subscriptionsRepo: RepositoryAdapter<any>,
  plansRepo: RepositoryAdapter<any>,
  hotelId: string,
  /** Espejo legacy `hotels.plan` — SOLO se consulta si no hay suscripción activa. */
  legacyHotelPlan?: string,
  logger?: { warn: (msg: string, meta?: any) => void },
): Promise<ResolvedHotelPlan> {
  const subs = ((await subscriptionsRepo.findMany({ hotelId })) as any[]) ?? []
  const active = subs.find((s) => (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(s?.status))

  if (active) {
    // Trial sin plan elegido (signup sin planId): sin matriz, solo el toggle global.
    if (!active.planId) return { modules: null, planId: undefined, source: 'subscription' }
    const plan = ((await plansRepo.findMany({ id: active.planId })) as any[])?.[0]
    if (!plan) {
      // LEGACY EXPLÍCITO (no silencioso): un hotel CON suscripción viva cuyo plan fue borrado
      // de `plans` NO se encierra (fail-open, mismo criterio que require-module) — pero se
      // deja registrado, porque "todo incluido" para un plan de 4 módulos es un bug de datos.
      logger?.warn('Suscripción activa apunta a un plan inexistente — gate sin matriz de módulos', {
        hotelId, planId: active.planId, status: active.status,
      })
      return { modules: null, planId: active.planId, source: 'subscription' }
    }
    return { modules: parseModules(plan.modules), slug: plan.slug, planId: active.planId, source: 'subscription' }
  }

  // LEGACY: hotel sin suscripción activa. Dos casos:
  //  1. Hoteles previos a este módulo (sin fila): mantienen el acceso de HOY — cortárselo por
  //     una migración interna sería encerrar a clientes existentes. Se resuelve `hotels.plan`.
  //  2. Fila expirada/cancelada/suspended: el CORTE DE ACCESO lo decide access.ts (allowed:false);
  //     este resolver no bloquea nada, solo deja de aplicar la matriz de esa suscripción muerta.
  if (legacyHotelPlan) {
    const plan = ((await plansRepo.findMany({ slug: legacyHotelPlan })) as any[])?.[0]
    if (plan) return { modules: parseModules(plan.modules), slug: plan.slug, source: 'legacy' }
  }
  return { modules: null, source: 'legacy' }
}
