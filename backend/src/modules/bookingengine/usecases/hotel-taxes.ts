// bookingengine/usecases/hotel-taxes.ts — Los impuestos del hotel, leídos UNA sola vez igual.
//
// Tarea 24 (#88): el huésped tiene que ver cada impuesto con nombre, % e importe, y el total
// que ve antes de pagar tiene que ser EXACTAMENTE el que cobra la pasarela. Eso no se sostiene
// con tres lectores distintos (había uno en public-rates, otro en public-booking y una copia en
// public-booking-group) que no coincidían en el detalle: uno exigía `active` verdadero, otro
// aceptaba la ausencia del flag; uno miraba la key `impuestos`, el otro no. Un impuesto que se
// mostraba en la selección podía no cobrarse, o al revés.
//
// Semántica única, la de facturación (`facturas/usecases/billing.ts` y `folios/usecases/
// folio-math.ts:taxRateFor`): `configuration(key='taxes'|'impuestos')` con filas
// `{nombre|name, tasa|rate, activo|active}`; cuentan las ACTIVAS con tasa > 0. Si no hay
// ninguna, `hotels.taxRate`/`hotels.taxName` (lo que Configuración → Impuestos sí guarda).

import type { RepositoryAdapter } from 'arckode-framework'
import { round2 } from '../../../shared/utils/money'

export interface HotelTax {
  name: string
  /** Porcentaje (18 = 18 %). */
  rate: number
}

export interface TaxLine extends HotelTax {
  /** Importe de ESTE impuesto sobre la base, ya redondeado a 2 decimales. */
  amount: number
}

/** Lo mínimo de la fila de `hotels` que hace falta para el fallback. */
type HotelTaxFields = { taxRate?: unknown; taxName?: unknown } | null | undefined

function parseConfigured(value: unknown): HotelTax[] {
  const arr = Array.isArray(value) ? value : []
  return arr
    .filter((t: any) => t && (t.activo ?? t.active))
    .map((t: any) => ({ name: String(t.nombre ?? t.name ?? 'Tax'), rate: Number(t.tasa ?? t.rate ?? 0) }))
    .filter((t) => Number.isFinite(t.rate) && t.rate > 0)
}

/**
 * Impuestos activos del hotel. `hotel` es la fila de `hotels` si el caller ya la tiene; si no,
 * `loadHotel` la busca solo cuando hace falta el fallback (no antes: es una lectura de más).
 */
export async function readHotelTaxes(
  config: RepositoryAdapter<any> | null | undefined,
  hotelId: string,
  hotel: HotelTaxFields | (() => Promise<HotelTaxFields>),
): Promise<HotelTax[]> {
  if (config) {
    try {
      // Algunos callers (y sus tests) cablean un repo con solo `findMany`: se acepta cualquiera.
      const one = async (key: string) => typeof (config as any).findOne === 'function'
        ? config.findOne({ hotelId, key })
        : (await config.findMany({ hotelId, key }))?.[0] ?? null
      let row = await one('taxes')
      if (!row) row = await one('impuestos')
      const configured = parseConfigured(row?.value)
      if (configured.length > 0) return configured
    } catch { /* cae al fallback */ }
  }
  let h: HotelTaxFields = null
  try {
    h = typeof hotel === 'function' ? await hotel() : hotel
  } catch {
    return []
  }
  const rate = Number(h?.taxRate) || 0
  if (rate > 0) return [{ name: String(h?.taxName ?? 'Tax'), rate }]
  return []
}

/**
 * Desglose de impuestos sobre una base imponible. Cada línea se redondea por separado y el
 * total es la SUMA de las líneas: así lo que se muestra fila por fila cierra con el total, y el
 * widget puede reproducirlo con la misma cuenta antes de crear la reserva.
 */
export function taxLinesOn(base: number, taxes: HotelTax[]): TaxLine[] {
  const b = Math.max(0, base)
  return taxes.map((t) => ({ name: t.name, rate: t.rate, amount: round2((b * t.rate) / 100) }))
}

export function sumTaxLines(lines: TaxLine[]): number {
  return round2(lines.reduce((s, l) => s + l.amount, 0))
}
