// pricing/usecases/rate-overrides.ts — Tarifa y restricciones por RANGO DE FECHAS y RATE PLAN.
//
// Capa más específica de la cadena de precio (ver `shared/models.ts`, RateOverrides). Todo lo de
// acá es lógica sobre el repo `RateOverrides`; nada de HTTP ni de Channex — el push lo dispara el
// connector `pricing-canales` con las filas que devuelve `upsertRateOverrides`.
//
// Convención heredada de `date-restrictions.ts`: un override que queda TODO en cero no se guarda,
// se borra. Así la tabla no se llena de filas neutras y "volver al precio de temporada" es
// simplemente poner los campos en cero desde la grilla.

import type { RepositoryAdapter } from 'arckode-framework'

export interface RateOverrideRow {
  id: string
  hotelId: string
  roomType: string
  ratePlan: string
  dateFrom: string
  dateTo: string
  rate: number
  minStay: number
  maxStay: number
  stopSell: number
  closedToArrival: number
  closedToDeparture: number
  minStayThrough: number
}

/** Lo que manda la grilla. Los numéricos son opcionales: ausente ≡ 0 ≡ "no toco esa dimensión". */
export interface RateOverrideInput {
  roomType?: string
  ratePlan?: string
  dateFrom?: string
  dateTo?: string
  rate?: number
  minStay?: number
  maxStay?: number
  stopSell?: number | boolean
  closedToArrival?: number | boolean
  closedToDeparture?: number | boolean
  minStayThrough?: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Entero >= 0. Cualquier basura (NaN, negativo, string) cae a 0 = "sin override". */
function nonNegativeInt(v: unknown): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Flag 0/1. Acepta boolean y number porque la grilla manda boolean y la DB guarda INTEGER. */
function flag(v: unknown): number {
  return v === true || v === 1 || v === '1' ? 1 : 0
}

/** Precio en unidades mayores, 2 decimales. 0 = sin override de precio (ver models.ts). */
function money(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

/**
 * Normaliza una fila de la grilla. `null` si el rango no es válido: sin fechas bien formadas no hay
 * override posible, y dejarlo pasar publicaría un `date_from`/`date_to` inválido a Channex.
 * `dateTo` ausente ≡ un solo día (el caso "poné 333 el 22/11") — es el atajo que más se usa.
 */
export function normalizeRateOverride(
  input: RateOverrideInput,
): Omit<RateOverrideRow, 'id' | 'hotelId'> | null {
  const roomType = String(input?.roomType || '').trim()
  const ratePlan = String(input?.ratePlan || '').trim().toLowerCase()
  const dateFrom = String(input?.dateFrom || '').slice(0, 10)
  const dateTo = String(input?.dateTo || dateFrom).slice(0, 10)
  if (!roomType || !ratePlan) return null
  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) return null
  if (dateTo < dateFrom) return null
  return {
    roomType,
    ratePlan,
    dateFrom,
    dateTo,
    rate: money(input.rate),
    minStay: nonNegativeInt(input.minStay),
    maxStay: nonNegativeInt(input.maxStay),
    stopSell: flag(input.stopSell),
    closedToArrival: flag(input.closedToArrival),
    closedToDeparture: flag(input.closedToDeparture),
    minStayThrough: nonNegativeInt(input.minStayThrough),
  }
}

/** Un override sin ninguna dimensión seteada no dice nada: se borra en vez de guardarse. */
export function isEmptyOverride(o: Omit<RateOverrideRow, 'id' | 'hotelId'>): boolean {
  return o.rate === 0 && o.minStay === 0 && o.maxStay === 0 && o.stopSell === 0 &&
    o.closedToArrival === 0 && o.closedToDeparture === 0 && o.minStayThrough === 0
}

/** Overrides del hotel; si se pasa [from,to] devuelve los que SOLAPAN ese rango (no los contenidos). */
export async function listRateOverrides(
  repo: RepositoryAdapter<any>, hotelId: string, from?: string, to?: string,
): Promise<RateOverrideRow[]> {
  let rows = (await repo.findMany({ hotelId })) as RateOverrideRow[]
  if (from && to) rows = rows.filter((r) => r.dateFrom <= to && r.dateTo >= from)
  return rows.sort((a, b) =>
    a.dateFrom.localeCompare(b.dateFrom) || a.roomType.localeCompare(b.roomType) ||
    a.ratePlan.localeCompare(b.ratePlan))
}

/** Dimensiones que un override puede fijar. El push las traduce a campos de `POST /restrictions`. */
export const OVERRIDE_DIMENSIONS = [
  'rate', 'minStay', 'maxStay', 'stopSell', 'closedToArrival', 'closedToDeparture', 'minStayThrough',
] as const
export type OverrideDimension = typeof OVERRIDE_DIMENSIONS[number]

/**
 * Fila guardada + las dimensiones que quedaron APAGADAS en este guardado (estaban en algo y
 * pasaron a 0). Se necesitan porque Channex hace updates PARCIALES: si el usuario saca el
 * stop_sell de un rango, no alcanza con omitir el campo — hay que mandar `stop_sell: false`
 * explícito o el cierre publicado sigue vivo en la OTA.
 */
export interface SavedRateOverride {
  row: RateOverrideRow
  cleared: OverrideDimension[]
}

/**
 * Upsert por (roomType, ratePlan, dateFrom, dateTo). Devuelve las filas que quedaron PUBLICABLES
 * — o sea las que hay que empujar a Channex — y por separado las que se borraron, que también hay
 * que empujar (revertir un override es un cambio de ARI: Channex tiene que volver al precio de
 * temporada, y para eso necesita recibir ese rango otra vez).
 */
export async function upsertRateOverrides(
  repo: RepositoryAdapter<any>, hotelId: string, items: RateOverrideInput[],
): Promise<{ saved: SavedRateOverride[]; removed: Array<Omit<RateOverrideRow, 'id' | 'hotelId'>> }> {
  const saved: SavedRateOverride[] = []
  const removed: Array<Omit<RateOverrideRow, 'id' | 'hotelId'>> = []
  for (const item of items || []) {
    const norm = normalizeRateOverride(item)
    if (!norm) continue
    const existing = ((await repo.findMany({
      hotelId, roomType: norm.roomType, ratePlan: norm.ratePlan,
      dateFrom: norm.dateFrom, dateTo: norm.dateTo,
    })) as RateOverrideRow[])[0]
    if (isEmptyOverride(norm)) {
      if (existing) { await repo.delete(existing.id); removed.push(norm) }
      continue
    }
    const cleared = OVERRIDE_DIMENSIONS.filter((d) => Number(existing?.[d]) > 0 && norm[d] === 0)
    if (existing) {
      const row = await repo.update(existing.id, norm as any)
      saved.push({ row: (row ?? { ...existing, ...norm }) as RateOverrideRow, cleared })
    } else {
      const row = await repo.create({ id: crypto.randomUUID(), hotelId, ...norm } as any)
      saved.push({ row: (row ?? { id: '', hotelId, ...norm }) as RateOverrideRow, cleared })
    }
  }
  return { saved, removed }
}

/** Borra un override por id, verificando que sea del hotel (no confiar en el id del cliente). */
export async function deleteRateOverride(
  repo: RepositoryAdapter<any>, hotelId: string, id: string,
): Promise<RateOverrideRow | null> {
  const row = ((await repo.findMany({ hotelId, id })) as RateOverrideRow[])[0]
  if (!row) return null
  await repo.delete(row.id)
  return row
}

/**
 * Override que aplica a una fecha, para la cadena de precio local. Gana el MÁS ESPECÍFICO: el de
 * rango más corto. Empate → el que empieza más tarde (el cargado para ese tramo puntual).
 *
 * Es la contraparte local del "last win" de Channex: allá el orden de los entries decide, acá
 * decide la especificidad, y las dos reglas coinciden porque el push manda los rangos largos
 * primero y los cortos al final.
 */
export function pickOverrideForDate(
  overrides: RateOverrideRow[], roomType: string, ratePlan: string, date: string,
): RateOverrideRow | null {
  const rt = String(roomType).toLowerCase()
  const rp = String(ratePlan).toLowerCase()
  const hits = overrides.filter((o) =>
    String(o.roomType).toLowerCase() === rt &&
    String(o.ratePlan).toLowerCase() === rp &&
    o.dateFrom <= date && o.dateTo >= date)
  if (hits.length === 0) return null
  return hits.sort((a, b) => {
    const spanA = Date.parse(a.dateTo) - Date.parse(a.dateFrom)
    const spanB = Date.parse(b.dateTo) - Date.parse(b.dateFrom)
    return spanA - spanB || b.dateFrom.localeCompare(a.dateFrom)
  })[0]!
}
