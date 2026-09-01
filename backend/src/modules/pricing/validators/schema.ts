import type { ValidationRule } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'

const arrayType = 'array' as any

// Topes anti-absurdo. Una tarifa negativa o disparatada se arrastra a folios/facturas (dinero real),
// así que se rechaza acá antes de tocar la BD.
const MAX_PRICE = 1_000_000          // por noche
const MAX_MARKUP_PCT = 1000          // recargo por ocupación (una suite puede ir +150%; el tope corta lo absurdo)
const MIN_MARKUP_PCT = -100          // -100% = tarifa gratis; por debajo daría precio negativo
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const num = (v: unknown): number => (v === undefined || v === null || v === '' ? 0 : Number(v))

export const CreateBlockSchema: Record<string, ValidationRule> = {
  roomIds: { type: arrayType, required: true },
  reason: { type: 'string' as const, max: 200 },
  startDate: { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  endDate: { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
}

export const UpdateSeasonsSchema: Record<string, ValidationRule> = {
  seasons: { type: arrayType, required: true },
}

export const ActivateSeasonSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true, min: 1 },
}

export const UpdateRatesSchema: Record<string, ValidationRule> = {
  rates: { type: arrayType, required: true },
}

export const UpdateRateRestrictionsSchema: Record<string, ValidationRule> = {
  restrictions: { type: arrayType, required: true },
}

export const UpdateDateRestrictionsSchema: Record<string, ValidationRule> = {
  items: { type: arrayType, required: true },
}

export const UpdateRateOverridesSchema: Record<string, ValidationRule> = {
  items: { type: arrayType, required: true },
}

const MAX_MIN_STAY = 365   // estadía mínima disparatada (más de un año) se corta acá

export const AssignSeasonSchema: Record<string, ValidationRule> = {
  from: { type: 'string' as const, required: true, pattern: DATE_RE },
  to: { type: 'string' as const, required: true, pattern: DATE_RE },
  season: { type: 'string' as const, max: 60 },   // vacío = borrar la asignación
}

// ─── Validación por ítem (validateSchema no valida el contenido de los arrays) ───

/** Cada tarifa: precios/recargos en rango y la tarifa resultante nunca negativa. */
export function validateRateItems(rates: unknown): void {
  if (!Array.isArray(rates)) throw new ValidationError('rates debe ser un array')
  rates.forEach((r: any, i: number) => {
    const at = `rates[${i}]`
    if (!r || typeof r !== 'object') throw new ValidationError(`${at}: item inválido`)
    if (!r.roomType || !r.season || r.occupancy === undefined || r.occupancy === null)
      throw new ValidationError(`${at}: roomType, season y occupancy son requeridos`)
    const base = num(r.basePrice)
    const pct = num(r.percentage)
    if (!Number.isFinite(base) || base < 0) throw new ValidationError(`${at}: basePrice no puede ser negativo`)
    if (base > MAX_PRICE) throw new ValidationError(`${at}: basePrice fuera de rango`)
    if (!Number.isFinite(pct) || pct < MIN_MARKUP_PCT || pct > MAX_MARKUP_PCT)
      throw new ValidationError(`${at}: percentage fuera de rango (${MIN_MARKUP_PCT}..${MAX_MARKUP_PCT})`)
    if (base * (1 + pct / 100) < 0) throw new ValidationError(`${at}: la tarifa resultante no puede ser negativa`)
    if (r.price !== undefined && r.price !== null) {
      const price = num(r.price)
      if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) throw new ValidationError(`${at}: price fuera de rango`)
    }
    if (r.channel !== undefined && typeof r.channel !== 'string') throw new ValidationError(`${at}: channel debe ser string`)
    const minStay = num(r.minStay ?? 0), maxStay = num(r.maxStay ?? 0)
    if (minStay < 0 || minStay > MAX_MIN_STAY || maxStay < 0 || maxStay > MAX_MIN_STAY)
      throw new ValidationError(`${at}: minStay/maxStay fuera de rango (0..${MAX_MIN_STAY})`)
    if (maxStay > 0 && maxStay < minStay) throw new ValidationError(`${at}: maxStay no puede ser menor que minStay`)
  })
}

/** Cada temporada: fechas con formato válido y fin no anterior al inicio (si vienen). */
export function validateSeasonItems(seasons: unknown): void {
  if (!Array.isArray(seasons)) throw new ValidationError('seasons debe ser un array')
  seasons.forEach((s: any, i: number) => {
    const at = `seasons[${i}]`
    if (!s || typeof s !== 'object') throw new ValidationError(`${at}: item inválido`)
    if (s.startDate && !DATE_RE.test(s.startDate)) throw new ValidationError(`${at}: startDate inválido (YYYY-MM-DD)`)
    if (s.endDate && !DATE_RE.test(s.endDate)) throw new ValidationError(`${at}: endDate inválido (YYYY-MM-DD)`)
    if (s.startDate && s.endDate && s.endDate < s.startDate)
      throw new ValidationError(`${at}: endDate no puede ser anterior a startDate`)
  })
}

/** Cada restricción: estadías no negativas y maxStay >= minStay (0 = sin tope). */
export function validateRestrictionItems(restrictions: unknown): void {
  if (!Array.isArray(restrictions)) throw new ValidationError('restrictions debe ser un array')
  restrictions.forEach((r: any, i: number) => {
    const at = `restrictions[${i}]`
    if (!r || typeof r !== 'object') throw new ValidationError(`${at}: item inválido`)
    if (!r.roomType || !r.season) throw new ValidationError(`${at}: roomType y season son requeridos`)
    for (const f of ['minStay', 'maxStay'] as const) {
      if (r[f] !== undefined && r[f] !== null) {
        const v = num(r[f])
        if (!Number.isFinite(v) || v < 0) throw new ValidationError(`${at}: ${f} no puede ser negativo`)
      }
    }
    const min = num(r.minStay), max = num(r.maxStay)
    if (max > 0 && max < min) throw new ValidationError(`${at}: maxStay no puede ser menor que minStay`)
  })
}

/** Cada ítem de "Días Mínimos": fecha válida y minStay entero en [1..365]. */
export function validateDateRestrictionItems(items: unknown): void {
  if (!Array.isArray(items)) throw new ValidationError('items debe ser un array')
  items.forEach((it: any, i: number) => {
    const at = `items[${i}]`
    if (!it || typeof it !== 'object') throw new ValidationError(`${at}: item inválido`)
    if (!DATE_RE.test(String(it.date || ''))) throw new ValidationError(`${at}: date inválido (YYYY-MM-DD)`)
    const v = num(it.minStay)
    if (!Number.isInteger(v) || v < 1 || v > MAX_MIN_STAY)
      throw new ValidationError(`${at}: minStay debe ser un entero entre 1 y ${MAX_MIN_STAY}`)
  })
}

/**
 * Cada celda de la grilla de tarifas por fecha: rango válido, precio y estadías no negativas.
 * `dateTo` es opcional (ausente ≡ un solo día); el resto de la normalización la hace el usecase
 * `rate-overrides.ts` — acá solo se rechaza lo que sería un error del cliente, no se corrige.
 */
export function validateRateOverrideItems(items: unknown): void {
  if (!Array.isArray(items)) throw new ValidationError('items debe ser un array')
  items.forEach((it: any, i: number) => {
    const at = `items[${i}]`
    if (!it || typeof it !== 'object') throw new ValidationError(`${at}: item inválido`)
    if (!it.roomType || !it.ratePlan) throw new ValidationError(`${at}: roomType y ratePlan son requeridos`)
    if (!DATE_RE.test(String(it.dateFrom || ''))) throw new ValidationError(`${at}: dateFrom inválido (YYYY-MM-DD)`)
    if (it.dateTo !== undefined && it.dateTo !== null && it.dateTo !== '') {
      if (!DATE_RE.test(String(it.dateTo))) throw new ValidationError(`${at}: dateTo inválido (YYYY-MM-DD)`)
      if (String(it.dateTo) < String(it.dateFrom)) throw new ValidationError(`${at}: dateTo no puede ser anterior a dateFrom`)
    }
    for (const f of ['rate', 'minStay', 'maxStay', 'minStayThrough'] as const) {
      if (it[f] !== undefined && it[f] !== null && it[f] !== '') {
        const v = num(it[f])
        if (!Number.isFinite(v) || v < 0) throw new ValidationError(`${at}: ${f} no puede ser negativo`)
      }
    }
    const min = num(it.minStay), max = num(it.maxStay)
    if (max > 0 && max < min) throw new ValidationError(`${at}: maxStay no puede ser menor que minStay`)
  })
}

/** Asignación de temporada: rango coherente y weekdays (si vienen) enteros 0..6 (0=Dom). */
export function validateAssignSeason(body: any): void {
  if (!body || typeof body !== 'object') throw new ValidationError('body inválido')
  if (body.to < body.from) throw new ValidationError('to no puede ser anterior a from')
  if (body.weekdays !== undefined && body.weekdays !== null) {
    if (!Array.isArray(body.weekdays)) throw new ValidationError('weekdays debe ser un array')
    for (const w of body.weekdays) {
      if (!Number.isInteger(w) || w < 0 || w > 6) throw new ValidationError('weekdays: cada día es un entero 0..6 (0=Dom)')
    }
  }
}

/** Bloqueo de habitación: fin no anterior al inicio (los formatos ya los valida CreateBlockSchema). */
export function validateBlockRange(startDate: string, endDate: string): void {
  if (startDate && endDate && endDate < startDate)
    throw new ValidationError('endDate no puede ser anterior a startDate')
}

export const PricingValidator = {
  createBlock: CreateBlockSchema,
  updateSeasons: UpdateSeasonsSchema,
  updateRates: UpdateRatesSchema,
  updateRateRestrictions: UpdateRateRestrictionsSchema,
  updateDateRestrictions: UpdateDateRestrictionsSchema,
  assignSeason: AssignSeasonSchema,
  updateRateOverrides: UpdateRateOverridesSchema,
}
