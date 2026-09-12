// shared/usecases/booking-paid-email.ts — Correo "pago confirmado" del motor de reservas.
//
// Por qué existe (pedido del cliente, 2026-08-29): al pagar por el widget público el huésped
// SOLO recibía el correo del pase con el número de habitación y el código de la puerta. Dos
// problemas: (1) nunca se le confirmaba el PAGO, y (2) la habitación puede reasignarse hasta
// el día antes de la llegada, así que mandar el número al momento de reservar es prometer algo
// que el hotel todavía no puede sostener.
//
// Ahora al pagar va este correo — plata, fechas CON hora, política y datos del hotel, SIN
// habitación ni código — y el pase con el código lo manda `prearrival-pass-cron.ts` 24 h antes
// de la llegada, cuando la habitación ya está firme.
//
// #270: el correo es un recibo completo — desglose (extras, amenidades, promo, impuestos),
// ocupación (adultos/niños/cuna), régimen, llegada estimada, pedido especial, total del GRUPO
// con una línea por habitación, link para gestionar la reserva y el recibo PDF adjunto.
//
// Best-effort: cualquier fallo se loguea y se traga. El cobro ya está asentado; no se revierte
// una reserva pagada porque el correo no salió. Lo que sí hace es AVISAR al hotel (notificación
// `system` en la campanita) para que mande la confirmación a mano desde la reserva.
//
// El PDF NO se genera acá: el correo se encola con un marcador diferido (`{ kind: 'receipt' }`)
// y el worker de la cola genera el recibo justo antes de enviar. Generarlo en línea lanzaba un
// Chromium dentro del webhook de Stripe / retorno de Azul-CardNet (que esperan este usecase con
// `await`): N pagos simultáneos = N navegadores sin tope. Si el worker no logra generarlo, el
// correo sale igual sin adjunto — el huésped tiene el botón de descarga en la confirmación.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender, DeferredEmailAttachment } from '../../services/email-sender'
import { reservationPanelLink } from './notify-reservation-received'
import type { NotificationLanguage } from '../../services/notification-defaults'
import { resolveGuestLanguage } from '../../services/guest-language'
import { escapeHtml } from '../../services/notification-renderer'
import { cancellationPolicyText } from './cancellation-text'
import { hotelCancellationTypeOf } from './cancellation-math'
import { effectiveCheckInTime, effectiveCheckOutTime } from '../utils/hotel-schedule'
import { DEFAULT_PLATFORM_IDENTITY, resolvePlatformIdentity } from '../utils/platform-identity'

export interface BookingPaidEmailDeps {
  emailSender: EmailSender
  reservationsRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  logger: Logger
  /** Tipo/nombre de cada habitación del grupo (nunca el número: la habitación no se promete). */
  roomsRepo?: RepositoryAdapter<any>
  /** Campanita del hotel: aviso `system` cuando el envío falla. */
  notificationsRepo?: RepositoryAdapter<any>
  /** Identidad de la plataforma (`{platform_name}`); sin él se usa el default. */
  configRepo?: Pick<RepositoryAdapter<any>, 'findOne'>
  /**
   * Adjuntar el recibo PDF como marcador diferido: lo genera el worker de la cola al enviar
   * (ver header). `false`/ausente = el correo va sin recibo.
   */
  attachReceipt?: boolean
  /** Origen del frontend (PUBLIC_URL): arma manage_url, receipt_url y el logo relativo. */
  publicUrl?: string
}

const PAYMENT_LABELS: Record<string, Record<NotificationLanguage, string>> = {
  card: { es: 'Tarjeta', en: 'Card', pt: 'Cartão' },
  link: { es: 'Link de pago', en: 'Payment link', pt: 'Link de pagamento' },
  cash: { es: 'Efectivo', en: 'Cash', pt: 'Dinheiro' },
  transfer: { es: 'Transferencia', en: 'Bank transfer', pt: 'Transferência' },
}

const YES_NO: Record<NotificationLanguage, [string, string]> = {
  es: ['Sí', 'No'], en: ['Yes', 'No'], pt: ['Sim', 'Não'],
}

// La reserva no persiste régimen todavía: si algún día lo trae, se muestra; si no, "sólo alojamiento".
const ROOM_ONLY: Record<NotificationLanguage, string> = {
  es: 'Sólo alojamiento', en: 'Room only', pt: 'Somente hospedagem',
}

const OCCUPANCY: Record<NotificationLanguage, [string, string]> = {
  es: ['adultos', 'niños'], en: ['adults', 'children'], pt: ['adultos', 'crianças'],
}

function money(amount: unknown, currency: string): string {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toFixed(2)} ${currency}`
}

/** Como `money` pero con el 0 explícito: en una línea de desglose "0.00" es un dato, no un vacío. */
function moneyOf(amount: unknown, currency: string): string {
  const n = Number(amount ?? 0)
  return `${(Number.isFinite(n) ? n : 0).toFixed(2)} ${currency}`
}

/** `<ul>` con una `<li>` por texto (ya escapado); '' si no hay líneas, así la plantilla no deja un hueco. */
function linesHtml(items: string[]): string {
  if (!items.length) return ''
  return `<ul>${items.map(t => `<li>${t}</li>`).join('')}</ul>`
}

type PricedLine = { name?: unknown; quantity?: unknown; total?: unknown; price?: unknown }

/** "Desayuno × 2 = 20.00 USD" — sirve para upsells y amenidades (misma forma). */
function pricedLine(line: PricedLine, currency: string): string {
  const qty = Math.max(1, Number(line.quantity ?? 1) || 1)
  const total = line.total ?? Number(line.price ?? 0) * qty
  return `${escapeHtml(String(line.name ?? ''))} × ${qty} = ${moneyOf(total, currency)}`
}

type UpsellPricedLike = PricedLine & { kind?: unknown; unitPrice?: unknown; nights?: unknown; persons?: unknown }

const UPSELL_UNITS: Record<NotificationLanguage, { persons: string; nights: string }> = {
  es: { persons: 'personas', nights: 'noches' },
  en: { persons: 'persons', nights: 'nights' },
  pt: { persons: 'pessoas', nights: 'noites' },
}

/**
 * Línea de un upsell cotizado por `kind` (MR-10 #275, `priceBreakdown.upsells[]`):
 * "Desayuno × 2 personas × 3 noches = 60.00 USD" (ppn) · "Parking × 3 noches = 45.00 USD"
 * (per_night) · "Transfer × 2 = 30.00 USD" (el resto). Mismo criterio que el texto de `notes`
 * en `public-booking.ts`: el huésped tiene que ver de dónde sale el importe.
 */
function upsellLine(line: UpsellPricedLike, currency: string, language: NotificationLanguage): string {
  const units = UPSELL_UNITS[language]
  const qty = Math.max(1, Number(line.quantity ?? 1) || 1)
  const nights = Math.max(1, Number(line.nights ?? 1) || 1)
  const persons = line.persons != null ? Math.max(1, Number(line.persons) || 1) : undefined
  const factor = persons !== undefined
    ? `× ${persons} ${units.persons} × ${nights} ${units.nights}`
    : line.kind === 'per_night' ? `× ${nights} ${units.nights}` : `× ${qty}`
  const total = line.total ?? Number(line.unitPrice ?? 0) * qty * nights * (persons ?? 1)
  return `${escapeHtml(String(line.name ?? ''))} ${factor} = ${moneyOf(total, currency)}`
}

/** "ITBIS · 18% · 52.20 USD". `rate` es SIEMPRE porcentaje (hotel-taxes.ts: amount = base × rate / 100). */
function taxLine(tax: { name?: unknown; rate?: unknown; amount?: unknown }, currency: string): string {
  const pct = Number(tax.rate ?? 0) || 0
  const pctText = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/\.?0+$/, '')
  return `${escapeHtml(String(tax.name ?? ''))} · ${pctText}% · ${moneyOf(tax.amount, currency)}`
}

/** Logo absoluto para el header del correo; el renderer sólo admite http(s). */
function logoUrlOf(logo: unknown, publicUrl: string): string {
  const raw = String(logo ?? '').trim()
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/') && publicUrl) return `${publicUrl}${raw}`
  return ''
}

/**
 * Una `<li>` por habitación del grupo: tipo/nombre + ocupación + importe. NUNCA el número de
 * habitación (puede reasignarse hasta la víspera).
 */
async function roomsLinesOf(
  rows: any[],
  roomsRepo: RepositoryAdapter<any> | undefined,
  currency: string,
  language: NotificationLanguage,
): Promise<string> {
  const [adultsLabel, childrenLabel] = OCCUPANCY[language]
  const items: string[] = []
  for (const row of rows) {
    const room = row.roomId && roomsRepo ? await roomsRepo.findById(row.roomId) : null
    const label = String(room?.name || room?.type || '').trim() || '—'
    const occupancy = `${Number(row.adults ?? 0)} ${adultsLabel}, ${Number(row.children ?? 0)} ${childrenLabel}`
    items.push(`${escapeHtml(label)} · ${escapeHtml(occupancy)} · ${moneyOf(row.totalAmount, currency)}`)
  }
  return linesHtml(items)
}

/** Marcador del recibo PDF: el worker de la cola lo resuelve (genera el PDF) al enviar. */
function receiptAttachmentOf(
  deps: BookingPaidEmailDeps, reservationId: string, locator: string,
): DeferredEmailAttachment[] | undefined {
  if (!deps.attachReceipt) return undefined
  return [{ kind: 'receipt', reservationId, filename: `recibo-${locator}.pdf` }]
}

/** Aviso al hotel cuando el correo no salió: el cobro está, la confirmación hay que mandarla a mano. */
async function notifyHotelOfFailure(
  deps: BookingPaidEmailDeps, reservation: any, to: string, reservationId: string, error: string,
): Promise<void> {
  if (!deps.notificationsRepo || !reservation) return
  try {
    await deps.notificationsRepo.create({
      id: crypto.randomUUID(),
      hotelId: reservation.hotelId,
      type: 'system',
      title: `No se pudo enviar la confirmación a ${to}`,
      message: `Reserva ${String(reservation.id ?? '').slice(0, 8)}: ${error}. Envíe la confirmación manualmente desde la reserva.`,
      read: 0,
      date: new Date().toISOString(),
      // Mismo destino que el aviso de "reserva recibida": `/reservas/:id` no existe en el panel.
      metadata: { reservationId, link: reservationPanelLink(reservationId) },
    })
  } catch (e) {
    deps.logger.warn('booking-paid-email: no se pudo avisar al hotel del fallo', { reservationId, error: (e as Error).message })
  }
}

/**
 * Filas sobre las que se calcula la plata del correo: la reserva sola, o ella más sus
 * hermanas no canceladas si pertenece a un grupo. Best-effort: si la consulta falla, se
 * usa sólo la reserva. La líder siempre está (Map por id).
 */
async function groupRows(
  reservationsRepo: RepositoryAdapter<any>,
  reservation: any,
  logger: Logger,
): Promise<any[]> {
  if (!reservation.groupId) return [reservation]
  const byId = new Map<string, any>([[String(reservation.id), reservation]])
  try {
    const siblings = await reservationsRepo.findMany({
      hotelId: reservation.hotelId, groupId: reservation.groupId,
    })
    for (const s of siblings ?? []) {
      if (!s || s.status === 'cancelled') continue
      byId.set(String(s.id), s)
    }
  } catch (e) {
    logger.warn('booking-paid-email: no se pudieron cargar las hermanas del grupo', {
      reservationId: reservation.id, groupId: reservation.groupId, error: (e as Error).message,
    })
  }
  return [...byId.values()]
}

/**
 * Encola el correo de confirmación de pago de una reserva del motor público.
 * No-op silencioso si la reserva no existe o el huésped no dejó email.
 */
export async function sendBookingPaidEmail(
  deps: BookingPaidEmailDeps,
  reservationId: string,
): Promise<boolean> {
  const { emailSender, reservationsRepo, hotelRepo, guestRepo, logger } = deps
  // Fuera del try: el catch los necesita para avisar al hotel a quién no le llegó.
  let reservation: any = null
  let to = ''
  try {
    reservation = await reservationsRepo.findById(reservationId)
    if (!reservation) return false

    const hotel = await hotelRepo.findById(reservation.hotelId)
    const guest = reservation.guestId ? await guestRepo.findById(reservation.guestId) : null
    // Tenancy: el huésped tiene que ser del mismo hotel que la reserva (defensa IDOR).
    if (guest?.hotelId && guest.hotelId !== reservation.hotelId) return false

    to = String(guest?.email ?? '').trim()
    if (!to) {
      logger.info('booking-paid-email: reserva sin email de huésped', { reservationId })
      return false
    }

    const language = resolveGuestLanguage(guest) as NotificationLanguage
    const currency = String(reservation.currency || 'USD').toUpperCase()
    // #270 — el desglose (extras, promo, impuestos) vive en el priceBreakdown de la líder.
    const breakdown = (reservation.priceBreakdown ?? {}) as Record<string, any>
    // #276 MR-11: en una reserva de GRUPO el cobro queda repartido entre las hermanas
    // (`settle()` prorratea el `deposit`), así que el total/pagado de la líder sola no es lo
    // que el huésped pagó. El mail habla del pedido entero: sumamos las hermanas vivas.
    const rows = await groupRows(reservationsRepo, reservation, logger)
    const total = rows.reduce((acc, r) => acc + Number(r.totalAmount ?? 0), 0)
    const paid = rows.reduce((acc, r) => acc + Number(r.deposit ?? 0), 0)
    const pending = Math.max(0, Number((total - paid).toFixed(2)))
    const method = String(reservation.paymentMethod ?? '')
    const cancellationType = await hotelCancellationTypeOf(hotelRepo, reservation.hotelId)
    const locator = String(reservation.id ?? '').slice(0, 8)
    const publicUrl = String(deps.publicUrl ?? '').replace(/\/+$/, '')
    const token: string = String(reservation.accessToken ?? '')
    const platformName = deps.configRepo
      ? (await resolvePlatformIdentity(deps.configRepo)).platformName
      : DEFAULT_PLATFORM_IDENTITY.platformName

    // #270 — una línea por habitación: las MISMAS filas vivas que suman el total (una hermana
    // cancelada no se lista ni se cobra), en orden de alta.
    const siblings: any[] = reservation.groupId
      ? [...rows].sort((a: any, b: any) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
      : []
    const roomsLines = siblings.length ? await roomsLinesOf(siblings, deps.roomsRepo, currency, language) : ''

    // Los links públicos llevan el accessToken como query `token` (mismo contrato que el widget).
    const publicQuery = (params: Record<string, string>) => new URLSearchParams(params).toString()
    const query = publicQuery({ booking: String(reservation.id), token })
    const canLink = Boolean(publicUrl && hotel?.slug)
    const logoUrl = logoUrlOf(hotel?.logo, publicUrl)
    const [yes, no] = YES_NO[language]
    // MR-10 (#275) — `priceBreakdown.upsells[]` trae `kind`/`nights`/`persons`: el detalle sale de ahí.
    const upsellLines: UpsellPricedLike[] = Array.isArray(breakdown.upsells) ? breakdown.upsells : []
    const childAmenities: PricedLine[] = Array.isArray(reservation.childAmenities) ? reservation.childAmenities : []
    const roomAmenities: PricedLine[] = Array.isArray(reservation.roomAmenities) ? reservation.roomAmenities : []
    const taxBreakdown: any[] = Array.isArray(breakdown.taxBreakdown) ? breakdown.taxBreakdown : []
    const childrenAges: unknown[] = Array.isArray(reservation.childrenAges) ? reservation.childrenAges : []

    const attachments = receiptAttachmentOf(deps, reservationId, locator)

    await emailSender.enqueueNotification({
      to,
      hotelId: reservation.hotelId,
      event: 'reservation_confirmed',
      language,
      variables: {
        guest_name: guest?.name || guest?.firstName || 'Huésped',
        hotel_name: hotel?.name ?? 'Hotel',
        hotel_phone: hotel?.phone ?? '',
        hotel_email: hotel?.email ?? '',
        hotel_address: [hotel?.address, hotel?.municipality, hotel?.province, hotel?.country]
          .filter(Boolean).join(', ') || '—',
        hotel_logo_url: logoUrl,
        logo_url: logoUrl,
        platform_name: platformName,
        checkin_date: String(reservation.checkIn ?? ''),
        checkout_date: String(reservation.checkOut ?? ''),
        // Horario EFECTIVO: lo acordado con este huésped pisa el general del hotel.
        checkin_time: effectiveCheckInTime(reservation, hotel),
        checkout_time: effectiveCheckOutTime(reservation, hotel),
        adults: String(Number(reservation.adults ?? 0) || 0),
        children: String(Number(reservation.children ?? 0) || childrenAges.length),
        children_ages: childrenAges.map(a => String(a)).join(', '),
        crib: reservation.needsCrib ? yes : no,
        meal_plan: String(reservation.mealPlan ?? '').trim() || ROOM_ONLY[language],
        estimated_arrival: String(reservation.estimatedArrival ?? '').trim() || '—',
        special_requests: String(reservation.specialRequests ?? '').trim() || '—',
        rooms_lines: roomsLines,
        rooms_count: String(siblings.length || 1),
        extras_lines: linesHtml(upsellLines.map(l => upsellLine(l, currency, language))),
        child_amenities_lines: linesHtml(childAmenities.map(l => pricedLine(l, currency))),
        room_amenities_lines: linesHtml(roomAmenities.map(l => pricedLine(l, currency))),
        promo_code: String(reservation.promoCode ?? '').trim(),
        promo_discount: money(breakdown.promoDiscount, currency),
        tax_lines: linesHtml(taxBreakdown.map(t => taxLine(t, currency))),
        subtotal: money(breakdown.subtotal, currency),
        total_amount: money(total, currency),
        deposit_amount: money(paid, currency),
        pending_amount: pending > 0 ? money(pending, currency) : '—',
        payment_method: PAYMENT_LABELS[method]?.[language] ?? (method || '—'),
        cancellation_policy: cancellationPolicyText(cancellationType, language),
        locator,
        manage_url: canLink ? `${publicUrl}/h/${encodeURIComponent(hotel.slug)}/confirm?${query}` : '',
        receipt_url: publicUrl
          ? `${publicUrl}/api/public/reservations/${encodeURIComponent(reservation.id)}/receipt.pdf?${publicQuery({ token })}`
          : '',
        // La habitación y el código NO viajan acá a propósito: van 24 h antes de la llegada.
        room_number: '',
        room_type: '',
        room_capacity: '',
        room_base_price: '',
        wifi_network: '',
        wifi_password: '',
        lock_code: '',
      },
      relatedType: 'reservation',
      relatedId: reservationId,
      ...(attachments ? { attachments } : {}),
    })
    logger.info('booking-paid-email encolado', { to, reservationId, language, attached: Boolean(attachments) })
    return true
  } catch (e) {
    const error = (e as Error).message
    logger.warn('booking-paid-email falló', { reservationId, error })
    await notifyHotelOfFailure(deps, reservation, to, reservationId, error)
    return false
  }
}
