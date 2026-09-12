// abandon-recovery/usecases/eligibility.ts — Filtros de elegibilidad del sweep (#266).
//
// Extraído de service.ts para mantenerlo < 200 líneas (regla del analyzer: God Object),
// mismo criterio que usecases/template.ts. Funciones sin estado: reciben las deps y el
// logger que necesitan, así se testean sin instanciar el service.

import type { Logger } from 'arckode-framework'
import type { GatewayConfiguredCheck } from '../types'
import { DEFAULT_PENDING_TTL_MINUTES } from '../types'

/** Subset de BookingConfig repo que necesita `ttlFor` (sin exponer el ORM completo). */
export interface BookingConfigLookup {
  findMany(q: Record<string, unknown>): Promise<any[]>
}

/** Resultado del chequeo de pasarela: `ok` sigue; `skip` salta; `error` salta y registra. */
export type GatewayCheckResult =
  | { outcome: 'ok' }
  | { outcome: 'skip' }
  | { outcome: 'error'; reason: string }

/** ¿La reserva ya venció? `paymentDeadlineAt < now` (#266); null/inválido = no vence (mismo
 *  criterio que el cron de vencimiento, así nunca mandamos un link que ese cron ya mató ni
 *  callamos uno que sigue vivo). Un status distinto de pending también cuenta como vencida
 *  (defensivo: la query ya filtra pending, pero el ORM puede devolver filas viejas). */
export function isExpired(r: { status?: string; paymentDeadlineAt?: string | null }, nowMs: number): boolean {
  if (r.status !== undefined && r.status !== 'pending') return true
  if (!r.paymentDeadlineAt) return false
  const deadlineMs = new Date(r.paymentDeadlineAt).getTime()
  return Number.isFinite(deadlineMs) && deadlineMs < nowMs
}

/** TTL de pago (minutos) del hotel vía booking_config (#266): null/undefined/inválido → 60.
 *  Cacheado por hotelId dentro del sweep; sin dep `bookingConfig` → default. */
export async function ttlFor(
  hotelId: string | undefined,
  bookingConfig: BookingConfigLookup | null | undefined,
  cache: Map<string, number>,
  logger: Logger,
): Promise<number> {
  const key = hotelId ?? ''
  if (cache.has(key)) return cache.get(key)!
  let ttl = DEFAULT_PENDING_TTL_MINUTES
  try {
    const v = hotelId && bookingConfig ? (await bookingConfig.findMany({ hotelId }))?.[0]?.pendingTtlMinutes : undefined
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) ttl = v
  } catch (e: unknown) {
    logger.warn('abandon-recovery: lookup de booking_config falló — usando TTL default', { hotelId, error: (e as Error)?.message })
  }
  cache.set(key, ttl)
  return ttl
}

/** #266: sin pasarela de pago no hay checkout al que volver → el correo no tiene sentido.
 *  Sin hotelId o sin check inyectado no se filtra (`ok`). Si el check tira, se reporta como
 *  `error` (el caller lo suma a `errors` y salta la reserva sin marcar el flag). */
export async function checkGateway(
  hotelId: string | undefined,
  isGatewayConfigured: GatewayConfiguredCheck | null | undefined,
): Promise<GatewayCheckResult> {
  if (!hotelId || !isGatewayConfigured) return { outcome: 'ok' }
  try {
    return (await isGatewayConfigured(hotelId)) ? { outcome: 'ok' } : { outcome: 'skip' }
  } catch (e: unknown) {
    return { outcome: 'error', reason: `gateway check: ${(e as Error)?.message ?? String(e)}` }
  }
}

/** ¿La reserva cae en la ventana de abandono? (createdAt entre now-maxAge y now-minAge).
 *  Filtro en JS: el ORM no soporta createdAt >= X AND createdAt <= Y en findMany (mismo
 *  patrón que reports/usecases/no-show-cron.ts). Fecha inválida → fuera de ventana. */
export function isInAbandonWindow(createdAt: string, nowMs: number, window: { minAgeMs: number; maxAgeMs: number }): boolean {
  const createdMs = new Date(createdAt).getTime()
  return Number.isFinite(createdMs) && createdMs >= nowMs - window.maxAgeMs && createdMs <= nowMs - window.minAgeMs
}
