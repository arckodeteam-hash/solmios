// shared/usecases/payment-receipt.ts — Recibo de pago (HTML A4) de una reserva del motor web.
//
// #270 (MR-05): el huésped que pagó por el widget recibe un RECIBO con el desglose completo
// (alojamiento, extras, amenidades, promo, cada impuesto, total, método y referencia del pago).
// Lo usan dos consumidores: el endpoint público `GET /api/public/reservations/:id/receipt.pdf`
// (bookingengine/usecases/public-receipt.ts) y el adjunto del correo de pago confirmado.
//
// NO es una factura fiscal: no lleva NCF ni numeración; la leyenda "Recibo de pago · no es
// factura fiscal" va visible en el documento. La factura sigue saliendo por `facturas/`
// (invoice-template.ts), cuyo estilo visual se imita acá sin reusarlo (está acoplado a FacturasDTO).
//
// Puro: sin I/O. Quien lo llama carga reserva/hotel/huésped/pagos y arma `ReceiptData`.
// Todo texto que viene de datos pasa por `escapeHtml` — nombres de hotel/huésped/extras son
// texto libre del panel o del huésped.

import { escapeHtml } from '../../services/notification-renderer'
import { round2 } from '../utils/money'
import { hasMealPlan, mealPlanLabel } from './meal-plan-labels'

export type ReceiptLineKind = 'room' | 'meal_plan' | 'upsell' | 'child_amenity' | 'room_amenity' | 'discount' | 'tax' | 'total'

export interface ReceiptLine {
  kind: ReceiptLineKind
  description: string
  /** Cantidad (extras/amenidades). Ausente en alojamiento, descuento, impuestos y total. */
  quantity?: number
  /** Precio unitario (extras/amenidades). */
  unitPrice?: number
  /** % del impuesto (solo `kind: 'tax'`). */
  rate?: number
  /** Importe de la línea. Negativo en `discount`. */
  amount: number
}

export interface ReceiptData {
  /** Localizador visible al huésped: `reservation.id.slice(0, 8)`. */
  locator: string
  /** ISO de emisión del recibo. */
  issuedAt: string
  currency: string
  hotel: {
    name: string
    address?: string
    /** RNC/NIF del hotel (`hotels.ownerTaxId`). */
    taxId?: string
    phone?: string
    email?: string
    /** Solo se muestra si es una URL http(s). */
    logo?: string
  }
  guest: { name: string; email?: string; phone?: string }
  stay: {
    checkIn: string
    checkOut: string
    nights: number
    adults: number
    children: number
    childrenAges?: number[]
    needsCrib: boolean
    /** Cantidad de habitaciones (1 o N si es grupo). */
    rooms: number
  }
  /** Todas las líneas que devuelve `buildReceiptLines` (la vista las reparte por `kind`). */
  lines: ReceiptLine[]
  promoCode?: string | null
  payment: {
    /** Etiqueta legible del método (Tarjeta, Transferencia…). */
    method: string
    /** Referencia del cobro (`payments.reference`: sesión/charge de Stripe). '—' si no hay pago. */
    reference: string
    amountPaid?: number
    paidAt?: string | null
  }
  /** Nombre de la plataforma para el pie ("Emitido a través de …"). Opcional. */
  platformName?: string
}

/** Forma mínima de la reserva que necesita el desglose (misma que `Reservations` + `priceBreakdown`). */
export interface ReceiptReservationLike {
  id?: string
  roomId?: string | null
  totalAmount?: number | string | null
  promoCode?: string | null
  priceBreakdown?: {
    subtotal?: number
    promoDiscount?: number
    upsellsTotal?: number
    /** MR-10 (#275) — línea por upsell cotizada por `kind` (`upsell-pricing.ts`): `unitPrice` del
     *  catálogo, `quantity` efectiva, `nights` y `persons` (solo per_person_per_night). */
    upsells?: Array<{ id?: string; name?: string; kind?: string; unitPrice?: number; quantity?: number; nights?: number; persons?: number; total?: number }>
    childAmenitiesTotal?: number
    roomAmenitiesTotal?: number
    /** MR-03 (#268) — Σ del régimen de todas las filas, ya dentro de `subtotal`. */
    mealPlanTotal?: number
    taxes?: number
    taxBreakdown?: Array<{ name?: string; rate?: number; amount?: number }>
    total?: number
  } | null
  childAmenities?: Array<{ id?: string; key?: string; name?: string; price?: number; quantity?: number; total?: number }> | null
  roomAmenities?: Array<{ id?: string; key?: string; name?: string; price?: number; quantity?: number; total?: number }> | null
  /** MR-03 (#268) — snapshot del régimen de ESTA fila (código, precio por persona y noche, personas, total). */
  mealPlan?: string | null
  mealPlanUnitPrice?: number | null
  mealPlanTotal?: number | null
  mealPlanPersons?: number | null
  checkIn?: string | null
  checkOut?: string | null
}

export interface ReceiptRoomLike { id: string; number?: string | null; name?: string | null; type?: string | null }

const ROOM_TYPE_LABELS: Record<string, string> = {
  single: 'Individual', double: 'Doble', twin: 'Twin', triple: 'Triple', quad: 'Cuádruple',
  suite: 'Suite', family: 'Familiar', studio: 'Estudio', apartment: 'Apartamento',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: 'Tarjeta', link: 'Link de pago', cash: 'Efectivo', transfer: 'Transferencia',
  deposit: 'Depósito', stripe: 'Tarjeta (Stripe)', other: 'Otro',
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Etiqueta legible del método de pago (`payments.method` / `reservations.paymentMethod`). */
export function paymentMethodLabel(method: unknown): string {
  const key = String(method ?? '').trim().toLowerCase()
  if (!key) return '—'
  return PAYMENT_METHOD_LABELS[key] ?? key
}

/** "Suite Mar · Suite" / "Doble" — el tipo/nombre que el huésped reservó. SIN número de
 *  habitación: puede reasignarse hasta la víspera y el recibo no promete una unidad concreta
 *  (mismo criterio que el correo de confirmación, booking-paid-email.ts). */
export function roomLabel(room: ReceiptRoomLike | null | undefined): string {
  if (!room) return 'Habitación'
  const name = String(room.name ?? '').trim()
  const type = String(room.type ?? '').trim()
  const typeLabel = type ? (ROOM_TYPE_LABELS[type.toLowerCase()] ?? type) : ''
  if (name && typeLabel && name.toLowerCase() !== typeLabel.toLowerCase()) return `${name} · ${typeLabel}`
  return name || typeLabel || 'Habitación'
}

function amenityLines(
  kind: 'child_amenity' | 'room_amenity',
  items: Array<{ name?: string; price?: number; quantity?: number; total?: number }> | null | undefined,
): ReceiptLine[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      const quantity = Math.max(1, Math.floor(num(a.quantity) || 1))
      const unitPrice = num(a.price)
      const amount = a.total != null ? num(a.total) : round2(unitPrice * quantity)
      return { kind, description: String(a.name ?? '').trim() || 'Amenidad', quantity, unitPrice, amount }
    })
}

function nightsOf(row: ReceiptReservationLike): number {
  const a = new Date(String(row.checkIn ?? '')).getTime()
  const b = new Date(String(row.checkOut ?? '')).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1
  return Math.max(1, Math.round((b - a) / 86_400_000))
}

/**
 * MR-03 (#268) — línea del régimen de UNA fila: "Régimen · Desayuno · 2 personas × 3 noches",
 * cantidad = personas × noches (cuadra con el unitario, mismo criterio que los upsells) e importe
 * `mealPlanTotal`. `included` (total 0) sale como "(incluido)" sin importe. Sin régimen, nada.
 */
function mealPlanLineOf(row: ReceiptReservationLike): ReceiptLine[] {
  if (!hasMealPlan(row.mealPlan)) return []
  const label = mealPlanLabel(row.mealPlan, 'es')
  const amount = round2(num(row.mealPlanTotal))
  if (amount <= 0) return [{ kind: 'meal_plan', description: `Régimen · ${label} (incluido)`, amount: 0 }]
  const persons = Math.max(1, Math.floor(num(row.mealPlanPersons) || 1))
  const nights = nightsOf(row)
  return [{
    kind: 'meal_plan',
    description: `Régimen · ${label} · ${persons} persona${persons === 1 ? '' : 's'} × ${nights} noche${nights === 1 ? '' : 's'}`,
    quantity: persons * nights,
    unitPrice: num(row.mealPlanUnitPrice),
    amount,
  }]
}

/**
 * Arma las líneas del recibo a partir del snapshot que el huésped vio y pagó (`priceBreakdown`).
 *
 * - Alojamiento: `subtotal − upsellsTotal − childAmenitiesTotal − roomAmenitiesTotal − mealPlanTotal` (1 habitación),
 *   o UNA línea por habitación del grupo con el `totalAmount` de cada fila hermana (la líder es la
 *   única con `priceBreakdown`; las hermanas llevan su importe de alojamiento en `totalAmount`).
 * - Cada upsell "nombre × cantidad", cada amenidad infantil y cada amenidad de habitación (en grupo,
 *   las amenidades salen de cada fila hermana: el snapshot vive por habitación).
 * - Promo como línea negativa con el código. Impuestos uno por uno con nombre y %. Total.
 * - Sin `priceBreakdown` (reserva vieja o creada desde el panel): alojamiento = `totalAmount`.
 */
export function buildReceiptLines(
  reservation: ReceiptReservationLike,
  siblings?: ReceiptReservationLike[] | null,
  rooms?: ReceiptRoomLike[] | null,
): ReceiptLine[] {
  const pb = reservation.priceBreakdown ?? null
  const roomById = new Map((rooms ?? []).map((r) => [String(r.id), r]))
  const lines: ReceiptLine[] = []

  const group = Array.isArray(siblings) && siblings.length > 1 ? siblings : null
  if (group) {
    for (const row of group) {
      const room = row.roomId ? roomById.get(String(row.roomId)) : undefined
      lines.push({ kind: 'room', description: `Alojamiento · ${roomLabel(room)}`, amount: round2(num(row.totalAmount)) })
    }
  } else if (pb) {
    const accommodation = num(pb.subtotal) - num(pb.upsellsTotal) - num(pb.childAmenitiesTotal) - num(pb.roomAmenitiesTotal) - num(pb.mealPlanTotal)
    const room = reservation.roomId ? roomById.get(String(reservation.roomId)) : undefined
    lines.push({ kind: 'room', description: `Alojamiento · ${roomLabel(room)}`, amount: round2(Math.max(0, accommodation)) })
  } else {
    const room = reservation.roomId ? roomById.get(String(reservation.roomId)) : undefined
    lines.push({ kind: 'room', description: `Alojamiento · ${roomLabel(room)}`, amount: round2(num(reservation.totalAmount)) })
  }

  // MR-03 (#268) — el régimen vive por fila (en grupo, cada hermana el suyo): sale antes de los
  // extras, en el orden de las habitaciones. En grupo el `totalAmount` de cada hermana es sólo
  // alojamiento, así que no hay que restarlo de nada.
  const mealPlanSources = group ?? [reservation]
  for (const row of mealPlanSources) lines.push(...mealPlanLineOf(row))

  for (const u of pb?.upsells ?? []) {
    if (!u || typeof u !== 'object') continue
    // El recibo muestra `cantidad × unitario = importe`, así que `quantity` lleva el multiplicador
    // completo del kind (cantidad × noches × personas) y `unitPrice` sigue siendo el del catálogo
    // — mismo criterio que los `ReservationAddons` (#269). El detalle ("2 personas × 3 noches")
    // va en la descripción para que el huésped entienda de dónde sale el 6.
    const qty = Math.max(1, Math.floor(num(u.quantity) || 1))
    const nights = Math.max(1, Math.floor(num(u.nights) || 1))
    const persons = u.persons != null ? Math.max(1, Math.floor(num(u.persons) || 1)) : undefined
    const quantity = qty * nights * (persons ?? 1)
    const unitPrice = num(u.unitPrice)
    const amount = u.total != null ? num(u.total) : round2(unitPrice * quantity)
    const name = String(u.name ?? '').trim() || 'Extra'
    const detail = persons !== undefined
      ? ` · ${persons} persona${persons === 1 ? '' : 's'} × ${nights} noche${nights === 1 ? '' : 's'}`
      : u.kind === 'per_night' ? ` · ${nights} noche${nights === 1 ? '' : 's'}` : ''
    lines.push({ kind: 'upsell', description: `${name}${detail}`, quantity, unitPrice, amount })
  }

  const amenitySources = group ?? [reservation]
  for (const row of amenitySources) lines.push(...amenityLines('child_amenity', row.childAmenities))
  for (const row of amenitySources) lines.push(...amenityLines('room_amenity', row.roomAmenities))

  const promoDiscount = num(pb?.promoDiscount)
  if (promoDiscount > 0) {
    const code = String(reservation.promoCode ?? '').trim()
    lines.push({ kind: 'discount', description: code ? `Descuento promo (${code})` : 'Descuento promo', amount: -round2(promoDiscount) })
  }

  for (const t of pb?.taxBreakdown ?? []) {
    if (!t || typeof t !== 'object') continue
    lines.push({ kind: 'tax', description: String(t.name ?? '').trim() || 'Impuesto', rate: num(t.rate), amount: round2(num(t.amount)) })
  }

  const total = pb ? num(pb.total) : num(reservation.totalAmount)
  lines.push({ kind: 'total', description: 'Total', amount: round2(total) })
  return lines
}

function money(amount: unknown, currency: string): string {
  return `${num(amount).toFixed(2)} ${escapeHtml(currency)}`
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  try {
    const iso = String(dateStr)
    const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso)
    if (Number.isNaN(d.getTime())) return escapeHtml(iso)
    return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return escapeHtml(String(dateStr)) }
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(String(dateStr))
  if (Number.isNaN(d.getTime())) return escapeHtml(String(dateStr))
  return d.toLocaleString('es-DO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isHttpUrl(v: unknown): boolean {
  return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim())
}

/** `rate` es SIEMPRE porcentaje (hotel-taxes.ts: amount = base × rate / 100): 18 → "18%", 0.5 → "0.5%". */
function ratePct(rate: unknown): string {
  const r = num(rate)
  return Number.isInteger(r) ? `${r}%` : `${r.toFixed(2).replace(/\.?0+$/, '')}%`
}

/** HTML A4 imprimible del recibo. Puro: quien lo llama decide si lo manda a puppeteer o al correo. */
export function renderReceiptHtml(data: ReceiptData): string {
  const { hotel, guest, stay, payment, currency } = data
  const items = data.lines.filter((l) => l.kind === 'room' || l.kind === 'meal_plan' || l.kind === 'upsell' || l.kind === 'child_amenity' || l.kind === 'room_amenity')
  const discounts = data.lines.filter((l) => l.kind === 'discount')
  const taxes = data.lines.filter((l) => l.kind === 'tax')
  const totalLine = data.lines.find((l) => l.kind === 'total')
  const itemsSubtotal = round2(items.reduce((s, l) => s + l.amount, 0))
  const discountTotal = round2(discounts.reduce((s, l) => s + l.amount, 0))
  const total = totalLine ? totalLine.amount : round2(itemsSubtotal + discountTotal + taxes.reduce((s, l) => s + l.amount, 0))

  const itemsHtml = items.map((l, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(l.description)}</td>
        <td class="qty">${l.quantity != null ? String(l.quantity) : '1'}</td>
        <td class="amt">${l.unitPrice != null ? money(l.unitPrice, currency) : money(l.amount, currency)}</td>
        <td class="amt">${money(l.amount, currency)}</td>
      </tr>`).join('')

  const guestsLabel = [
    `${stay.adults} adulto${stay.adults === 1 ? '' : 's'}`,
    stay.children > 0
      ? `${stay.children} niño${stay.children === 1 ? '' : 's'}${stay.childrenAges?.length ? ` (${stay.childrenAges.map((a) => `${num(a)} años`).join(', ')})` : ''}`
      : '',
    stay.needsCrib ? 'cuna solicitada' : '',
  ].filter(Boolean).join(' · ')

  const hotelDetails = [
    hotel.address ? `<div class="hotel-detail">${escapeHtml(hotel.address)}</div>` : '',
    hotel.taxId ? `<div class="hotel-detail">RNC/NIF: ${escapeHtml(hotel.taxId)}</div>` : '',
    hotel.phone ? `<div class="hotel-detail">Tel: ${escapeHtml(hotel.phone)}</div>` : '',
    hotel.email ? `<div class="hotel-detail">${escapeHtml(hotel.email)}</div>` : '',
  ].join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Recibo de pago ${escapeHtml(data.locator)}</title>
<style>
  @page { size: A4; margin: 15mm 20mm; }
  @media print { body { margin: 0; padding: 0; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #1e293b; background: #fff; width: 210mm; min-height: 297mm;
    padding: 15mm 20mm; font-size: 11px; line-height: 1.5;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #0f3460; margin-bottom: 16px; }
  .hotel-logo { max-height: 40px; margin-bottom: 6px; }
  .hotel-name { font-size: 20px; font-weight: 800; color: #0f3460; letter-spacing: -0.5px; }
  .hotel-detail { font-size: 9px; color: #64748b; margin-top: 2px; }
  .doc-box { text-align: right; }
  .doc-type { font-size: 22px; font-weight: 900; color: #0f3460; letter-spacing: 2px; }
  .doc-number { font-size: 13px; font-weight: 700; color: #334155; margin-top: 4px; }
  .doc-date { font-size: 10px; color: #64748b; margin-top: 2px; }
  .legend { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px; padding: 8px 14px; margin-bottom: 16px; font-size: 10px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .party-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
  .party-label { font-size: 8px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
  .party-name { font-size: 13px; font-weight: 700; color: #0f3460; }
  .party-detail { font-size: 10px; color: #64748b; margin-top: 2px; }
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .items-table th { background: #0f3460; color: #fff; padding: 8px 12px; font-size: 9px; text-transform: uppercase; text-align: left; font-weight: 700; letter-spacing: 0.5px; }
  .items-table td { padding: 7px 12px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #1e293b; }
  .items-table tbody tr:nth-child(even) { background: #f8fafc; }
  .items-table .num { width: 30px; text-align: center; color: #475569; }
  .items-table .qty { width: 50px; text-align: center; }
  .items-table .amt { width: 110px; text-align: right; }
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 20px; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; color: #475569; }
  .totals-row.discount { color: #166534; }
  .totals-divider { border-top: 1px solid #e2e8f0; margin: 6px 0; }
  .totals-row.total { font-size: 14px; font-weight: 800; color: #0f3460; padding: 6px 0; }
  .payment-info { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; }
  .payment-info-title { font-size: 10px; font-weight: 700; color: #166534; text-transform: uppercase; margin-bottom: 6px; }
  .payment-detail { font-size: 10px; color: #475569; }
  .footer { border-top: 2px solid #0f3460; padding-top: 12px; margin-top: 20px; text-align: center; font-size: 9px; color: #94a3b8; }
</style>
</head>
<body>

<div class="header">
  <div>
    ${isHttpUrl(hotel.logo) ? `<img src="${escapeHtml(String(hotel.logo).trim())}" alt="Logo" class="hotel-logo">` : ''}
    <div class="hotel-name">${escapeHtml(hotel.name || 'Hotel')}</div>
    ${hotelDetails}
  </div>
  <div class="doc-box">
    <div class="doc-type">RECIBO DE PAGO</div>
    <div class="doc-number">Localizador ${escapeHtml(data.locator)}</div>
    <div class="doc-date">Emitido: ${formatDateTime(data.issuedAt)}</div>
  </div>
</div>

<div class="legend">Recibo de pago · no es factura fiscal</div>

<div class="parties">
  <div class="party-box">
    <div class="party-label">Huésped</div>
    <div class="party-name">${escapeHtml(guest.name || 'Huésped')}</div>
    ${guest.email ? `<div class="party-detail">${escapeHtml(guest.email)}</div>` : ''}
    ${guest.phone ? `<div class="party-detail">Tel: ${escapeHtml(guest.phone)}</div>` : ''}
  </div>
  <div class="party-box">
    <div class="party-label">Estadía</div>
    <div class="party-name">${formatDate(stay.checkIn)} → ${formatDate(stay.checkOut)}</div>
    <div class="party-detail">${stay.nights} noche${stay.nights === 1 ? '' : 's'} · ${stay.rooms} habitaci${stay.rooms === 1 ? 'ón' : 'ones'}</div>
    <div class="party-detail">${escapeHtml(guestsLabel)}</div>
  </div>
</div>

<table class="items-table">
  <thead>
    <tr>
      <th class="num">#</th>
      <th>Concepto</th>
      <th class="qty">Cant.</th>
      <th class="amt">Precio</th>
      <th class="amt">Importe</th>
    </tr>
  </thead>
  <tbody>${itemsHtml}
  </tbody>
</table>

<div class="totals-section">
  <div class="totals-box">
    <div class="totals-row"><span>Subtotal</span><span>${money(itemsSubtotal, currency)}</span></div>
    ${discounts.map((l) => `<div class="totals-row discount"><span>${escapeHtml(l.description)}</span><span>${money(l.amount, currency)}</span></div>`).join('')}
    ${taxes.map((l) => `<div class="totals-row"><span>${escapeHtml(l.description)} (${ratePct(l.rate)})</span><span>${money(l.amount, currency)}</span></div>`).join('')}
    <div class="totals-divider"></div>
    <div class="totals-row total"><span>TOTAL</span><span>${money(total, currency)}</span></div>
  </div>
</div>

<div class="payment-info">
  <div class="payment-info-title">Pago</div>
  <div class="payment-detail">Método: ${escapeHtml(payment.method || '—')}</div>
  <div class="payment-detail">Referencia: ${escapeHtml(payment.reference || '—')}</div>
  ${payment.amountPaid != null ? `<div class="payment-detail">Importe pagado: ${money(payment.amountPaid, currency)}</div>` : ''}
  ${payment.paidAt ? `<div class="payment-detail">Fecha del pago: ${formatDateTime(payment.paidAt)}</div>` : ''}
</div>

<div class="footer">
  ${escapeHtml(hotel.name || 'Hotel')}${hotel.email ? ` · ${escapeHtml(hotel.email)}` : ''}${hotel.phone ? ` · Tel: ${escapeHtml(hotel.phone)}` : ''}
  ${data.platformName ? `<div>Emitido a través de ${escapeHtml(data.platformName)}</div>` : ''}
</div>

</body>
</html>`
}
