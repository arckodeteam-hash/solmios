// shared/usecases/addon-folio-charges.ts — Los extras pagados online (`reservation_addons` con
// `source:'booking_engine'`) como líneas de cargo del folio.
//
// Por qué (#269, MR-04): el motor público cobra upsells / amenidades junto con la noche y el
// prepago ENTERO llega al folio en el check-in (`prepaid-folio-lines`). Pero el folio nacía sólo
// con el cargo de la habitación: 165.20 pagados contra 118 cargados → el tope de
// `capPrepaidLines` dejaba 47.20 "a favor" que no existía, y el checkout facturaba una estadía
// sin los extras que el huésped ya había pagado. Con una línea `category:'extra'` por addon, el
// folio cuadra: 100+18, 30+5.40, 10+1.80 = 165.20 contra un crédito de 165.20 → saldo 0.
//
// Idempotencia: cada cargo lleva `reference: 'addon:<addon.id>'`. `FolioCharges` sólo tiene índice
// único por `reference` para `source='pos'`, así que la dedup es EN MEMORIA dentro de la tx del
// caller (mismo criterio que folios/usecases/night-audit.ts): se pasan los cargos existentes del
// folio y no se genera fila para un addon que ya tiene la suya. Así el check-in y el night audit
// (subtarea 4) pueden correr sobre el mismo folio sin duplicar.
//
// Impuesto: se calcula con el `taxRate` que pasa el caller (el de `configuration('taxes')` del
// hotel en ese momento, el mismo que lleva la noche), NO con `addon.taxRate`, que es un snapshot
// informativo de lo que se aplicó al reservar. Redondeo por línea con `round2` (30×0.18 = 5.40).
//
// Helper PURO: sin I/O, sin imports de módulos. Quien lo llama hace `tx.create('FolioCharges', row)`.

import { round2 } from '../utils/money'

/** Prefijo del `reference` de los cargos generados desde un addon: `addon:<reservation_addons.id>`. */
export const ADDON_CHARGE_REFERENCE_PREFIX = 'addon:'

/** Único `source` de addon que se postea: el importe ya está pagado/incluido en `totalAmount`. */
const POSTABLE_ADDON_SOURCE = 'booking_engine'

/** Fila mínima de `reservation_addons` que necesita el helper. */
export interface AddonSourceRow {
  id?: string | null
  description?: string | null
  /** Importe UNITARIO (la línea vale `amount × quantity`). */
  amount?: number | null
  quantity?: number | null
  kind?: string | null
  source?: string | null
}

/** Cargo ya existente en el folio (sólo importa `reference` para la dedup). */
export interface ExistingChargeRow {
  reference?: string | null
}

/** Fila lista para `tx.create('FolioCharges', row)`. */
export interface AddonFolioChargeRow {
  id: string
  folioId: string
  hotelId: string
  description: string
  category: 'extra'
  kind: 'charge'
  quantity: number
  /** Base de la línea: `addon.amount × quantity`. */
  amount: number
  taxes: number
  total: number
  source: AddonChargeSource
  postedAt: string
  reference: string
}

export type AddonChargeSource = 'checkin' | 'night_audit'

export interface BuildAddonFolioChargesInput {
  folioId: string
  hotelId: string
  addons: ReadonlyArray<AddonSourceRow> | null | undefined
  /** % total del hotel al momento de postear (18 = 18 %). */
  taxRate: number
  existingCharges: ReadonlyArray<ExistingChargeRow> | null | undefined
  source: AddonChargeSource
  postedAt: string
}

/** `reference` que identifica el cargo de un addon. */
export function addonChargeReference(addonId: string): string {
  return `${ADDON_CHARGE_REFERENCE_PREFIX}${addonId}`
}

/**
 * Una fila por addon `booking_engine` que todavía no tiene su cargo en el folio.
 *
 * - Se ignoran addons manuales (`source` distinto de `booking_engine`): esos los postea recepción
 *   a mano y NO están dentro del prepago.
 * - Se ignoran `kind:'discount'` (no son un cargo) y las líneas con base 0 (nada que cobrar).
 * - Orden estable: el de `addons`.
 */
export function buildAddonFolioCharges(input: BuildAddonFolioChargesInput): AddonFolioChargeRow[] {
  const seen = new Set(
    (input.existingCharges ?? [])
      .map((c) => String(c?.reference ?? ''))
      .filter((ref) => ref.startsWith(ADDON_CHARGE_REFERENCE_PREFIX)),
  )
  const taxRate = Math.max(0, Number(input.taxRate) || 0)
  const rows: AddonFolioChargeRow[] = []

  for (const addon of input.addons ?? []) {
    const id = String(addon?.id ?? '')
    if (!id) continue
    if (String(addon?.source ?? '') !== POSTABLE_ADDON_SOURCE) continue
    if (String(addon?.kind ?? '') === 'discount') continue
    const reference = addonChargeReference(id)
    if (seen.has(reference)) continue

    const quantity = Math.max(1, Math.floor(Number(addon?.quantity) || 1))
    const amount = round2(Math.max(0, Number(addon?.amount) || 0) * quantity)
    if (amount <= 0) continue
    const taxes = round2(amount * taxRate / 100)

    const base = String(addon?.description ?? '').trim() || 'Extra'
    rows.push({
      id: crypto.randomUUID(),
      folioId: input.folioId,
      hotelId: input.hotelId,
      description: quantity > 1 ? `${base} ×${quantity}` : base,
      category: 'extra',
      kind: 'charge',
      quantity,
      amount,
      taxes,
      total: round2(amount + taxes),
      source: input.source,
      postedAt: input.postedAt,
      reference,
    })
    seen.add(reference)
  }
  return rows
}

/** Σ `total` (base + impuesto) de las filas: lo que suben al tope de crédito del prepago. */
export function addonChargesTotal(rows: ReadonlyArray<Pick<AddonFolioChargeRow, 'total'>>): number {
  return round2(rows.reduce((s, r) => s + (Number(r.total) || 0), 0))
}

/** Σ `amount` (base sin impuesto): para el audit log / respuesta del check-in. */
export function addonChargesBase(rows: ReadonlyArray<Pick<AddonFolioChargeRow, 'amount'>>): number {
  return round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))
}
