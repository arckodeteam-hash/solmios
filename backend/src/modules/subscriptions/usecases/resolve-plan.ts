// resolve-plan.ts — ¿Qué plan corre efectivamente para un hotel?
//
// FUENTE DE VERDAD: la fila de `subscriptions` ACTIVA del hotel (trialing/active/past_due —
// `WORKING_STATUSES` de access.ts, que ahora se importa acá: una sola lista para el corte de
// acceso y para el gate de módulos). `hotels.plan` es SOLO un espejo que se mantiene
// sincronizado (signup al arrancar el trial, handle-stripe-event al pagar) para los
// lectores legacy — nunca decide qué módulos ve el hotel.
//
// El bug que motivó esto (prod 2026-08): el trial elegía `plan-host` (4 módulos), el alta
// nunca escribía `hotels.plan`, el default del modelo ('professional') ganaba, y el gate de
// módulos — que solo leía `hotels.plan` — le mostraba al hotel TODOS los módulos del panel.
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { WORKING_STATUSES } from './access'

/** Lo mínimo que el resolver necesita para loguear: los WARN/ERROR del fail-open y del
 *  fail-closed no pueden ser silenciosos (E2/CS-8). */
export type GateLogger = Pick<Logger, 'warn' | 'error'>

export interface ResolvedHotelPlan {
  /** `plans.modules` TAL CUAL configurado. `null` = sin matriz → sin restricción de plan (legacy).
   *  `[]` = matriz VACÍA → cero módulos (fail-closed). */
  modules: string[] | null
  /** Slug del plan resuelto (dominio de `hotels.plan`). */
  slug?: string
  /** `plans.id` de la suscripción activa, cuando la hubo. */
  planId?: string
  /** 'subscription' = la fila activa manda · 'legacy' = espejo hotels.plan / sin datos. */
  source: 'subscription' | 'legacy'
}

/**
 * `plans.modules` llega como json (array) o string JSON según el motor — normaliza.
 * `null` si no es array (legacy: sin matriz → sin restricción). JSON corrupto → `[]`
 * (CS-8, fail-closed consistente con la sub activa sin planId): antes el `JSON.parse`
 * lanzaba y cada ruta gateada del hotel respondía 500.
 */
function parseModules(raw: unknown, logger?: GateLogger, hotelId?: string): string[] | null {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      logger?.error('plans.modules con JSON corrupto — gate con matriz VACÍA (cero módulos)', { hotelId })
      return []
    }
  }
  return Array.isArray(value) ? value.map(String) : null
}

export async function resolveHotelPlan(
  subscriptionsRepo: RepositoryAdapter<any>,
  plansRepo: RepositoryAdapter<any>,
  hotelId: string,
  /** Espejo legacy `hotels.plan` — SOLO se consulta si no hay suscripción activa. */
  legacyHotelPlan?: string,
  logger?: GateLogger,
): Promise<ResolvedHotelPlan> {
  const subs = ((await subscriptionsRepo.findMany({ hotelId })) as any[]) ?? []
  // CS-7: orden determinista. Con varias filas para el hotel (doble alta, migración) un
  // `find` sin orden podía resolver OTRA fila distinta de la que parchea el webhook de
  // Stripe. Prioridad: la fila con `stripeSubscriptionId` (la que el pago tocó); desempate
  // por `createdAt` descendente (la más reciente primero).
  const active = subs
    .filter((s) => WORKING_STATUSES.has(s?.status))
    .sort((a, b) =>
      Number(!!b.stripeSubscriptionId) - Number(!!a.stripeSubscriptionId) ||
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
    )[0]

  if (active) {
    // CS-3: sub ACTIVA sin planId → matriz VACÍA (cero módulos), NUNCA `null` (= sin
    // restricción = TODO el panel prendido). Antes, un signup que no cargó planes dejaba
    // una suscripción trialing con planId vacío y el hotel entraba con todo habilitado —
    // repetible en el trial público sin captcha. Fail-closed + WARN: nunca silencioso.
    // (Hoy SignupSchema exige planId no vacío; esto defiende las filas legacy.)
    if (!active.planId) {
      logger?.warn('Suscripción activa sin planId — gate con matriz VACÍA (cero módulos)', {
        hotelId, status: active.status,
      })
      return { modules: [], planId: undefined, source: 'subscription' }
    }
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
    return { modules: parseModules(plan.modules, logger, hotelId), slug: plan.slug, planId: active.planId, source: 'subscription' }
  }

  // LEGACY: hotel sin suscripción activa. Dos casos:
  //  1. Hoteles previos a este módulo (sin fila): mantienen el acceso de HOY — cortárselo por
  //     una migración interna sería encerrar a clientes existentes. Se resuelve `hotels.plan`.
  //  2. Fila expirada/cancelada/suspended: el CORTE DE ACCESO lo decide access.ts (allowed:false);
  //     este resolver no bloquea nada, solo deja de aplicar la matriz de esa suscripción muerta.
  if (legacyHotelPlan) {
    const plan = ((await plansRepo.findMany({ slug: legacyHotelPlan })) as any[])?.[0]
    if (plan) return { modules: parseModules(plan.modules, logger, hotelId), slug: plan.slug, source: 'legacy' }
  }
  return { modules: null, source: 'legacy' }
}
