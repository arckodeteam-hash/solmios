// shared/usecases/confirmation-email-variables.ts — Base de variables de `reservation_confirmed`.
//
// #270: la plantilla de confirmación creció (desglose, huéspedes, enlaces, {platform_name}) y
// la disparan DOS flujos: el pago del motor público (booking-paid-email.ts, que llena todo) y
// la reserva creada desde el panel (reservas/usecases/reservation-email.ts, que no tiene
// desglose ni token público). El renderer deja literal cualquier `{var}` que falte, así que el
// flujo del panel necesita esta base para que ningún placeholder llegue crudo al huésped.
// Un flujo pisa lo que sí conoce; lo demás queda neutro ('' en los fragmentos HTML y en los
// enlaces, '—' en los textos). Si se agrega una variable a la plantilla, va acá también: el
// test de contrato de cada flujo lo exige.

import type { NotificationLanguage } from '../../services/notification-defaults'
import { escapeHtml } from '../../services/notification-renderer'
import { DEFAULT_PLATFORM_IDENTITY } from '../utils/platform-identity'

export const CRIB_NO: Record<NotificationLanguage, string> = { es: 'No', en: 'No', pt: 'Não' }

/** La reserva no persiste régimen todavía: sin dato se informa "sólo alojamiento". */
export const ROOM_ONLY: Record<NotificationLanguage, string> = {
  es: 'Sólo alojamiento', en: 'Room only', pt: 'Somente hospedagem',
}

/** Todas las variables que usan las plantillas de `reservation_confirmed`, en valor neutro. */
export function confirmationVariableDefaults(
  language: NotificationLanguage,
  platformName: string = DEFAULT_PLATFORM_IDENTITY.platformName,
): Record<string, string | number> {
  return {
    guest_name: 'Huésped',
    hotel_name: 'Hotel',
    hotel_phone: '',
    hotel_email: '',
    hotel_address: '—',
    hotel_logo_url: '',
    logo_url: '',
    platform_name: platformName,
    checkin_date: '',
    checkout_date: '',
    checkin_time: '',
    checkout_time: '',
    adults: '',
    children: '',
    children_ages: '',
    crib: CRIB_NO[language] ?? CRIB_NO.es,
    meal_plan: ROOM_ONLY[language] ?? ROOM_ONLY.es,
    estimated_arrival: '—',
    special_requests: '—',
    rooms_lines: '',
    rooms_count: '1',
    extras_lines: '',
    child_amenities_lines: '',
    room_amenities_lines: '',
    promo_code: '',
    promo_discount: '—',
    tax_lines: '',
    subtotal: '—',
    total_amount: '—',
    deposit_amount: '—',
    pending_amount: '—',
    payment_method: '—',
    cancellation_policy: '',
    locator: '',
    manage_url: '',
    receipt_url: '',
    ...confirmationFragments(language, {}),
    room_number: '',
    room_type: '',
    room_capacity: '',
    room_base_price: '',
    wifi_network: '',
    wifi_password: '',
    lock_code: '',
  }
}

// ─── Bloques condicionales ─────────────────────────────────────────────────
//
// El renderer no tiene condicionales: sólo reemplaza `{var}`. Lo que puede NO existir (niños,
// promo, enlaces públicos) se arma acá como fragmento ya renderizado ('' cuando no aplica), así
// la plantilla no muestra "0 niños ()", "Código promocional  −—" ni botones con `href=""` a un
// huésped de una reserva creada desde el panel. Convención del renderer: las keys `*_lines` van
// como HTML crudo (cada valor escapado acá); el resto son texto y se escapan al renderizar.

export interface ConfirmationFragmentsInput {
  adults?: number
  children?: number
  childrenAges?: unknown[]
  /** Código promocional aplicado; sin él no hay fila de promo. */
  promoCode?: string
  /** Descuento ya formateado ("10.00 USD"). */
  promoDiscount?: string
  /** Enlace público "Ver mi reserva"; '' = sin botón. */
  manageUrl?: string
  /** Enlace público "Descargar recibo (PDF)"; '' = sin botón ni mención al recibo. */
  receiptUrl?: string
}

const OCCUPANCY_LABELS: Record<NotificationLanguage, { adult: [string, string]; child: [string, string] }> = {
  es: { adult: ['adulto', 'adultos'], child: ['niño', 'niños'] },
  en: { adult: ['adult', 'adults'], child: ['child', 'children'] },
  pt: { adult: ['adulto', 'adultos'], child: ['criança', 'crianças'] },
}

const RECEIPT_INTRO: Record<NotificationLanguage, string> = {
  es: ' y el recibo de su pago',
  en: ' and your payment receipt',
  pt: ' e o recibo do seu pagamento',
}

const PROMO_LABEL: Record<NotificationLanguage, string> = {
  es: 'Código promocional', en: 'Promo code', pt: 'Código promocional',
}

const ACTION_LABELS: Record<NotificationLanguage, { manage: string; receipt: string }> = {
  es: { manage: 'Ver mi reserva', receipt: 'Descargar recibo (PDF)' },
  en: { manage: 'View my reservation', receipt: 'Download receipt (PDF)' },
  pt: { manage: 'Ver a minha reserva', receipt: 'Baixar recibo (PDF)' },
}

const PROMO_CELL_STYLE = 'padding:6px 0;color:#6b7280;'
const PROMO_AMOUNT_STYLE = 'padding:6px 0;font-weight:bold;text-align:right;'
const MANAGE_BTN_STYLE = 'display:inline-block;background:#1a2b4c;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;margin:4px;'
const RECEIPT_BTN_STYLE = 'display:inline-block;background:white;color:#1a2b4c;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;border:1px solid #1a2b4c;margin:4px;'

function plural(n: number, [one, many]: [string, string]): string {
  return n === 1 ? one : many
}

/**
 * Fragmentos condicionales de `reservation_confirmed`:
 * - `occupancy` (texto): "2 adultos · 1 niño (6)" — sin niños no menciona niños; sin adultos, ''.
 * - `receipt_intro` (texto): " y el recibo de su pago" sólo si hay `receiptUrl`.
 * - `promo_lines` (HTML): la fila del desglose sólo si hay `promoCode`.
 * - `actions_lines` (HTML): los botones "Ver mi reserva" / "Descargar recibo" sólo con su URL.
 */
export function confirmationFragments(
  language: NotificationLanguage,
  input: ConfirmationFragmentsInput,
): Record<'occupancy' | 'receipt_intro' | 'promo_lines' | 'actions_lines', string> {
  const lang: NotificationLanguage = language in OCCUPANCY_LABELS ? language : 'es'
  const labels = OCCUPANCY_LABELS[lang]
  const adults = Math.max(0, Number(input.adults ?? 0) || 0)
  const children = Math.max(0, Number(input.children ?? 0) || 0)
  const ages = (input.childrenAges ?? []).map((a) => String(a)).filter(Boolean)
  const parts: string[] = []
  if (adults > 0) parts.push(`${adults} ${plural(adults, labels.adult)}`)
  if (children > 0) parts.push(`${children} ${plural(children, labels.child)}${ages.length ? ` (${ages.join(', ')})` : ''}`)

  const promoCode = String(input.promoCode ?? '').trim()
  const promoLines = promoCode
    ? `<tr><td style="${PROMO_CELL_STYLE}">${PROMO_LABEL[lang]} ${escapeHtml(promoCode)}</td>`
      + `<td style="${PROMO_AMOUNT_STYLE}">−${escapeHtml(String(input.promoDiscount ?? '—'))}</td></tr>`
    : ''

  const manageUrl = String(input.manageUrl ?? '').trim()
  const receiptUrl = String(input.receiptUrl ?? '').trim()
  const buttons: string[] = []
  if (manageUrl) buttons.push(`<a href="${escapeHtml(manageUrl)}" style="${MANAGE_BTN_STYLE}">${ACTION_LABELS[lang].manage}</a>`)
  if (receiptUrl) buttons.push(`<a href="${escapeHtml(receiptUrl)}" style="${RECEIPT_BTN_STYLE}">${ACTION_LABELS[lang].receipt}</a>`)

  return {
    occupancy: parts.join(' · '),
    receipt_intro: receiptUrl ? RECEIPT_INTRO[lang] : '',
    promo_lines: promoLines,
    actions_lines: buttons.length ? `<p style="text-align:center;margin:20px 0;">${buttons.join('\n      ')}</p>` : '',
  }
}
