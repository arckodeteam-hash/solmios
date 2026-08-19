// bookingengine/usecases/public-reservation.ts — F0 0.14
// spec: openspec/changes/solmi-direct-booking/specs/booking-unification/spec.md
//
// Endpoint público SEGURO para consultar una reserva por id + token. Reemplaza al
// IDOR abierto `GET /api/public/bookings/:id` (usecases/booking.ts:50-55, marcado @ignore).
//
// Seguridad:
// - El `?token=X` de la URL es el `accessToken` (UUID v4) que `createPublicBookingDirect`
//   seteó al crear la reserva por flujo público (F0 0.13).
// - La comparación usa HMAC-SHA256 con un secret por hotel + `timingSafeEqual`
//   (anti timing attack). Reserva con `accessToken=null` (creada desde panel) →
//   HMAC computado sobre '' → no matchea ningún token → 404.
// - Anti-enumeración: el MISMO body de 404 para "no existe", "sin token",
//   "token incorrecto" y "accessToken null". No se filtra existencia en la response.
//
// Decisión: de dónde sale el secret (el spec NO lo fija):
//   `process.env.BOOKING_TOKEN_SECRET + ':' + hotelId`.
//   - Por hotel: el `hotelId` revuelve el espacio. Un leak del token del hotel A
//     no valida contra el hotel B, y viceversa.
//   - Env server-side: si `BOOKING_TOKEN_SECRET` no está (typo, deploy mal
//     configurado), caemos a un fallback dev explícito con el mismo trade-off que
//     `services/guarantee-pin.ts:8` (romper todo en prod es peor que degradar).
//     Activar el secret real es requisito de prod.
//
// Por qué hashear AMBOS lados (stored y received) y no solo uno:
//   La task pide "HMAC-SHA256" pero `reservation.accessToken` ya está guardado en
//   claro (F0 0.13, test existence-check: `UUID_RE.test(reservationCreate.row.accessToken)`).
//   Para no romper 0.13 Y cumplir el requerimiento criptográfico, computo
//   `HMAC(secret, stored)` y `HMAC(secret, received)` y los comparo con
//   `timingSafeEqual`. Es equivalente a `stored === received` en igualdad pero:
//     · la comparación es a tiempo constante (timing-safe),
//     · si en el futuro se migra el stored a un hash, no cambia el contract.
//
// Forma funcional (sin clase) — mismo estilo que `public-booking.ts` y `public-hotel-info.ts`.

import crypto from 'node:crypto'

const NOT_FOUND = { status: 404, body: { error: 'Reservation not found' } } as const

function hotelSecret(hotelId: string): string {
  const base = process.env.BOOKING_TOKEN_SECRET || 'dev-fallback-booking-secret'
  return `${base}:${hotelId}`
}

function hmac(secret: string, value: string): Buffer {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest()
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Devuelve la reserva pública + guest + paymentStatus, validando el token HMAC.
 *
 * @returns 404 (mismo body) si no existe, sin token, token incorrecto, o accessToken=null.
 *          200 con `{ reservation, guest, paymentStatus }` si el token valida.
 */
export async function getPublicReservation(
  orm: any,
  id: string,
  token: string | undefined | null,
): Promise<{ status: number; body: any }> {
  // Sin token → 404 (mismo body que not-found, no revelar existencia).
  if (!token) return NOT_FOUND

  // Lookup por `findMany({id})` (no findById) — mismo patrón que `public-booking.ts`.
  // El analyzer arckode pide auth.assertOwnership() para findById, pero este endpoint
  // es PÚBLICO: la "autenticación" la hace el HMAC del token abajo. No hay user session.
  const rows = (await orm.findMany('Reservations', { id })) as any[]
  const reservation = rows[0]
  // No existe o creada desde panel (accessToken null) → 404 mismo body.
  if (!reservation || !reservation.accessToken) return NOT_FOUND

  // HMAC sobre el token recibido vs el accessToken almacenado. timingSafeEqual evita
  // timing attacks sobre la comparación. Secret derivado por hotel.
  const secret = hotelSecret(reservation.hotelId)
  const expected = hmac(secret, String(reservation.accessToken))
  const received = hmac(secret, String(token))
  if (!safeEqual(expected, received)) return NOT_FOUND

  let guest: any = null
  if (reservation.guestId) {
    const guestRows = (await orm.findMany('Guests', { id: reservation.guestId })) as any[]
    guest = guestRows[0] || null
  }

  // B-6/H-4 (auditoría 2026-08-19): allow-list ESTRICTA, campo por campo — NUNCA la fila
  // cruda (patrón public-hotel-info.ts). La fila de Reservations arrastra ownerNotes,
  // otaNotes, cardHolder/cardLast4 (el model dice "se revelan solo tras PIN"),
  // preCheckinHash, accessToken y snapshot financiero; la de Guests, document,
  // documentUrl, emergencyContact, notes internas y loyaltyPoints. El token HMAC del
  // huésped autentica la LECTURA de lo suyo, no convierte la fila en pública. El contrato
  // real del frontend (booking-confirmation.vue + types/booking.ts) queda cubierto:
  // reservation.{id, checkIn, checkOut, status, totalAmount, paymentStatus} + guest.{name, email}.
  return {
    status: 200,
    body: {
      reservation: {
        id: reservation.id,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        status: reservation.status,
        adults: reservation.adults,
        children: reservation.children,
        totalAmount: reservation.totalAmount,
        currency: reservation.currency,
        paymentStatus: reservation.paymentStatus ?? 'unpaid',
        promoCode: reservation.promoCode ?? null,
      },
      guest: guest ? { id: guest.id, name: guest.name, email: guest.email, phone: guest.phone ?? '' } : null,
      paymentStatus: reservation.paymentStatus ?? 'unpaid',
    },
  }
}
