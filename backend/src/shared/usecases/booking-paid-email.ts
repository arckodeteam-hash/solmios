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
// `system` en la campanita) para que mande la confirmación a mano desde la reserva. El PDF
// también es best-effort: si el generador falla, el correo sale igual sin adjunto.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender, EmailAttachment } from '../../services/email-sender'
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
   * Generador del recibo PDF. Lo inyecta la infraestructura (puppeteer) para que este usecase
   * no dependa del navegador headless; `null` = no hay recibo para adjuntar.
   */
  receiptPdf?: (reservationId: string) => Promise<Buffer | null>
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

/** "ITBIS · 18% · 52.20 USD". El rate llega como fracción (0.18) o como porcentaje (18): ambos valen. */
function taxLine(tax: { name?: unknown; rate?: unknown; amount?: unknown }, currency: string): string {
  const raw = Number(tax.rate ?? 0) || 0
  const pct = raw < 1 ? raw * 100 : raw
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

/** Recibo PDF adjunto, best-effort: sin generador o con fallo el correo sale igual. */
async function receiptAttachmentOf(
  deps: BookingPaidEmailDeps, reservationId: string, locator: string,
): Promise<EmailAttachment[] | undefined> {
  if (!deps.receiptPdf) return undefined
  try {
    const pdf = await deps.receiptPdf(reservationId)
    if (!pdf) return undefined
    return [{ filename: `recibo-${locator}.pdf`, contentType: 'application/pdf', contentBase64: pdf.toString('base64') }]
  } catch (e) {
    deps.logger.warn('booking-paid-email: no se pudo generar el recibo PDF', { reservationId, error: (e as Error).message })
    return undefined
  }
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
      metadata: { reservationId, link: `/reservas/${reservationId}` },
    })
  } catch (e) {
    deps.logger.warn('booking-paid-email: no se pudo avisar al hotel del fallo', { reservationId, error: (e as Error).message })
  }
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
    const breakdown = (reservation.priceBreakdown ?? {}) as Record<string, any>
    // En un grupo la líder lleva el priceBreakdown con el total de TODAS las habitaciones.
    const total = Number(breakdown.total ?? reservation.totalAmount ?? 0)
    const paid = Number(reservation.deposit ?? 0)
    const pending = Math.max(0, Number((total - paid).toFixed(2)))
    const method = String(reservation.paymentMethod ?? '')
    const cancellationType = await hotelCancellationTypeOf(hotelRepo, reservation.hotelId)
    const locator = String(reservation.id ?? '').slice(0, 8)
    const publicUrl = String(deps.publicUrl ?? '').replace(/\/+$/, '')
    const accessToken = String(reservation.accessToken ?? '')
    const platformName = deps.configRepo
      ? (await resolvePlatformIdentity(deps.configRepo)).platformName
      : DEFAULT_PLATFORM_IDENTITY.platformName

    const siblings: any[] = reservation.groupId
      ? (await reservationsRepo.findMany({ groupId: reservation.groupId, hotelId: reservation.hotelId }))
          .sort((a: any, b: any) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
      : []
    const roomsLines = siblings.length ? await roomsLinesOf(siblings, deps.roomsRepo, currency, language) : ''

    const query = `booking=${encodeURIComponent(reservation.id)}&token=${encodeURIComponent(accessToken)}`
    const canLink = Boolean(publicUrl && hotel?.slug)
    const logoUrl = logoUrlOf(hotel?.logo, publicUrl)
    const [yes, no] = YES_NO[language]
    const upsellLines: PricedLine[] = Array.isArray(breakdown.upsellLines) ? breakdown.upsellLines : []
    const childAmenities: PricedLine[] = Array.isArray(reservation.childAmenities) ? reservation.childAmenities : []
    const roomAmenities: PricedLine[] = Array.isArray(reservation.roomAmenities) ? reservation.roomAmenities : []
    const taxBreakdown: any[] = Array.isArray(breakdown.taxBreakdown) ? breakdown.taxBreakdown : []
    const childrenAges: unknown[] = Array.isArray(reservation.childrenAges) ? reservation.childrenAges : []

    const attachments = await receiptAttachmentOf(deps, reservationId, locator)

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
        extras_lines: linesHtml(upsellLines.map(l => pricedLine(l, currency))),
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
          ? `${publicUrl}/api/public/reservations/${encodeURIComponent(reservation.id)}/receipt.pdf?token=${encodeURIComponent(accessToken)}`
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
