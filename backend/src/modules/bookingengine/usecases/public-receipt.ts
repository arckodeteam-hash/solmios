// bookingengine/usecases/public-receipt.ts — #270 (MR-05)
//
// Recibo de pago en PDF de una reserva del motor web, para el huésped:
//   GET /api/public/reservations/:id/receipt.pdf?token=X
//
// Seguridad: la MISMA regla que `GET /api/public/reservations/:id` (public-reservation.ts):
// token HMAC + timingSafeEqual vía `reservationTokenMatches`, y el MISMO body de 404
// (`PUBLIC_RESERVATION_NOT_FOUND`) para "no existe / sin token / token incorrecto /
// accessToken null" — anti-enumeración entre endpoints, no solo dentro de uno.
//
// El HTML lo arma `shared/usecases/payment-receipt.ts` (puro); acá se cargan reserva, hotel,
// huésped, hermanas del grupo, habitaciones y pagos. `buildReceiptHtmlFor` no valida el token —
// lo usa el correo de pago confirmado desde el backend (booking-paid-email.ts) para adjuntar
// el mismo recibo que el huésped descarga desde la confirmación.
//
// `toPdf` va inyectado (puppeteer en producción, stub en tests): el usecase no sabe de Chromium.

import {
  buildReceiptLines,
  renderReceiptHtml,
  paymentMethodLabel,
  type ReceiptData,
} from '../../../shared/usecases/payment-receipt'
import { reservationTokenMatches, PUBLIC_RESERVATION_NOT_FOUND } from './public-reservation'

export interface ReceiptPdfDeps {
  toPdf: (html: string) => Promise<Buffer>
  platformName?: string
}

export interface ReceiptPdfResponse {
  status: number
  body: any
  headers?: Record<string, string>
}

function nightsBetween(checkIn: unknown, checkOut: unknown): number {
  const a = new Date(String(checkIn ?? '')).getTime()
  const b = new Date(String(checkOut ?? '')).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

function guestNameOf(guest: any): string {
  if (!guest) return ''
  const full = String(guest.name ?? '').trim()
  if (full) return full
  return [guest.firstName, guest.lastName].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ')
}

function hotelAddressOf(hotel: any): string {
  return [hotel?.address, hotel?.municipality, hotel?.province, hotel?.country]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

/** El pago que respalda el recibo: el último completado; si no hay completado, el último de todos. */
function pickPayment(payments: any[]): any | null {
  const rows = (payments ?? []).filter((p) => p && typeof p === 'object')
  if (!rows.length) return null
  const byDate = (a: any, b: any) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  const completed = rows.filter((p) => p.status === 'completed').sort(byDate)
  if (completed.length) return completed[completed.length - 1]
  return rows.sort(byDate)[rows.length - 1]
}

async function findManySafe(orm: any, model: string, filter: Record<string, unknown>): Promise<any[]> {
  try {
    const rows = await orm.findMany(model, filter)
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

/**
 * Carga todo lo que necesita el recibo y devuelve `ReceiptData`, o `null` si la reserva no existe.
 * SIN validación del token (solo para llamadas internas, el correo). El endpoint público valida antes.
 */
export async function buildReceiptDataFor(orm: any, reservationId: string, platformName?: string): Promise<ReceiptData | null> {
  const rows = await findManySafe(orm, 'Reservations', { id: reservationId })
  const reservation = rows[0]
  if (!reservation) return null

  const hotel = (await findManySafe(orm, 'Hotels', { id: reservation.hotelId }))[0] ?? null
  const guest = reservation.guestId ? (await findManySafe(orm, 'Guests', { id: reservation.guestId }))[0] ?? null : null

  // Grupo: la líder es la única con `priceBreakdown`; las hermanas aportan su habitación y su
  // `totalAmount` de alojamiento. Se ordenan por creación para que la líder salga primera.
  let siblings: any[] = []
  if (reservation.groupId) {
    siblings = (await findManySafe(orm, 'Reservations', { groupId: reservation.groupId, hotelId: reservation.hotelId }))
      .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
  }
  const roomIds = Array.from(new Set(
    (siblings.length ? siblings : [reservation]).map((r) => r.roomId).filter(Boolean).map(String),
  ))
  const rooms: any[] = []
  for (const roomId of roomIds) {
    const room = (await findManySafe(orm, 'Rooms', { id: roomId, hotelId: reservation.hotelId }))[0]
    if (room) rooms.push(room)
  }

  // El modelo se registra en singular (`payments/model.ts: orm.define('Payment', ...)`), no 'Payments'.
  const payments = await findManySafe(orm, 'Payment', { reservationId: reservation.id, hotelId: reservation.hotelId })
  const payment = pickPayment(payments)

  // Adultos/niños del grupo: la suma de cada habitación (cada fila lleva los suyos).
  const occupancyRows = siblings.length ? siblings : [reservation]
  const adults = occupancyRows.reduce((s, r) => s + (Number(r.adults) || 0), 0)
  const children = occupancyRows.reduce((s, r) => s + (Number(r.children) || 0), 0)
  const childrenAges = occupancyRows.flatMap((r) => (Array.isArray(r.childrenAges) ? r.childrenAges : []))
  const needsCrib = occupancyRows.some((r) => r.needsCrib === true || (Number(r.cribCount) || 0) > 0)

  const lines = buildReceiptLines(reservation, siblings, rooms)
  const locator = String(reservation.id).slice(0, 8)

  return {
    locator,
    issuedAt: new Date().toISOString(),
    currency: String(reservation.currency || hotel?.currency || 'USD'),
    hotel: {
      name: String(hotel?.name ?? 'Hotel'),
      address: hotelAddressOf(hotel) || undefined,
      taxId: hotel?.ownerTaxId ? String(hotel.ownerTaxId) : undefined,
      phone: hotel?.phone ? String(hotel.phone) : undefined,
      email: hotel?.email ? String(hotel.email) : undefined,
      logo: hotel?.logo ? String(hotel.logo) : undefined,
    },
    guest: {
      name: guestNameOf(guest),
      email: guest?.email ? String(guest.email) : undefined,
      phone: guest?.phone ? String(guest.phone) : undefined,
    },
    stay: {
      checkIn: String(reservation.checkIn ?? ''),
      checkOut: String(reservation.checkOut ?? ''),
      nights: nightsBetween(reservation.checkIn, reservation.checkOut),
      adults,
      children,
      childrenAges,
      needsCrib,
      rooms: Math.max(1, occupancyRows.length),
    },
    lines,
    promoCode: reservation.promoCode ?? null,
    payment: {
      method: paymentMethodLabel(payment?.method ?? reservation.paymentMethod),
      reference: String(payment?.reference ?? '').trim() || '—',
      amountPaid: payment ? Number(payment.amount) || 0 : undefined,
      paidAt: payment?.processedAt ?? payment?.createdAt ?? null,
    },
    platformName,
  }
}

/**
 * HTML del recibo de una reserva (o `null` si no existe). Sin validar el token — uso interno (correo).
 * Reutilizado por `getPublicReceiptPdf` una vez validado el token.
 */
export async function buildReceiptHtmlFor(orm: any, reservationId: string, platformName?: string): Promise<string | null> {
  const data = await buildReceiptDataFor(orm, reservationId, platformName)
  return data ? renderReceiptHtml(data) : null
}

/**
 * GET /api/public/reservations/:id/receipt.pdf?token=X
 *
 * @returns 404 (MISMO body que public-reservation) si no existe / sin token / token incorrecto /
 *          accessToken null. 200 con el PDF (`content-type: application/pdf`) si el token valida.
 */
export async function getPublicReceiptPdf(
  orm: any,
  reservationId: string,
  receivedToken: string | undefined | null,
  deps: ReceiptPdfDeps,
): Promise<ReceiptPdfResponse> {
  if (!receivedToken) return PUBLIC_RESERVATION_NOT_FOUND

  // findMany({id}) y no findById — mismo patrón que public-reservation.ts (endpoint público:
  // la "autenticación" es el HMAC del token, no hay sesión que el analyzer pueda exigir).
  const rows = await findManySafe(orm, 'Reservations', { id: reservationId })
  const reservation = rows[0]
  if (!reservation || !reservationTokenMatches(reservation, receivedToken)) return PUBLIC_RESERVATION_NOT_FOUND

  const html = await buildReceiptHtmlFor(orm, String(reservation.id), deps.platformName)
  if (!html) return PUBLIC_RESERVATION_NOT_FOUND

  const body = await deps.toPdf(html)
  const locator = String(reservation.id).slice(0, 8)
  return {
    status: 200,
    body,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="recibo-${locator}.pdf"`,
    },
  }
}
