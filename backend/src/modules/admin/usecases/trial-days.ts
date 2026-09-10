// admin/usecases/trial-days.ts — Duración global del período de prueba (#103, CFG-6).
// Mismo patrón que subscription-settings.ts: 1 fila en `configuration`
// (hotelId='platform', key='trial_days') con `{ days }` — `value` es json, así que una clave
// nueva del KV no requiere migración. `subscriptions` la lee por connector al crear el hotel;
// TRIAL_DAYS queda como fallback cuando la fila no existe.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { BodySchema } from '../../../shared/validators/validate-body'

export interface TrialDays {
  days: number
}

/** Los 15 días históricos de TRIAL_DAYS: sin fila, el alta sigue igual que antes del #103. */
export const DEFAULT_TRIAL_DAYS = 15

/** Menos de 1 día es invisible; más de 365 ya no es una prueba. */
export const TRIAL_DAYS_MIN = 1
export const TRIAL_DAYS_MAX = 365

/**
 * `integer` y no `number`, mismo criterio que ExtendTrialSchema: el `number` del framework
 * coerciona `"30"` → 30 (SEC-2); el contrato de la pestaña Suscripciones es un entero JSON.
 */
export const UpdateTrialDaysSchema: BodySchema = {
  days: { type: 'integer' as const, required: true, min: TRIAL_DAYS_MIN, max: TRIAL_DAYS_MAX },
}

const TRIAL_DAYS_KEY = 'trial_days'
const PLATFORM = 'platform'

async function readRaw(configRepo: RepositoryAdapter<any>): Promise<{ row: any; days: unknown }> {
  const rows = await configRepo.findMany({ hotelId: PLATFORM, key: TRIAL_DAYS_KEY })
  const row = (rows as any[])?.[0]
  // Según el driver, `value` llega serializado o como objeto (mismo manejo que readRaw de
  // subscription-settings). Un JSON corrupto cae al default: la lectura de config global no
  // puede romper el alta de un hotel por una fila vieja mal escrita.
  let value: any = {}
  if (row) {
    try { value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value } catch { value = {} }
  }
  return { row, days: value && typeof value === 'object' ? (value as any).days : undefined }
}

function esDaysValido(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= TRIAL_DAYS_MIN && days <= TRIAL_DAYS_MAX
}

/** Sin fila o con `{days}` malformado → default (fallback silencioso, como getSubscriptionSettings). */
export async function getTrialDays(configRepo: RepositoryAdapter<any>): Promise<TrialDays> {
  const { days } = await readRaw(configRepo)
  return { days: esDaysValido(days) ? days : DEFAULT_TRIAL_DAYS }
}

export async function setTrialDays(configRepo: RepositoryAdapter<any>, days: number): Promise<TrialDays> {
  // La ruta ya validó con UpdateTrialDaysSchema; el usecase re-valida para que un caller
  // interno (connector, script) no escriba un valor que la lectura descartaría en silencio.
  if (!esDaysValido(days)) {
    throw new ValidationError(`trial_days fuera de rango: days debe ser un entero entre ${TRIAL_DAYS_MIN} y ${TRIAL_DAYS_MAX}`)
  }
  const { row } = await readRaw(configRepo)
  const value = { days }
  if (row) await configRepo.update(row.id, { value })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: PLATFORM, key: TRIAL_DAYS_KEY, value })
  return value
}
