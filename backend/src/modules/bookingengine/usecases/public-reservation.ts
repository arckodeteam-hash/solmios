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
import { paymentAmountsOf } from '../../../shared/utils/payment-status'
import { paidForReservation } from '../../../shared/usecases/reservation-paid'

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

  // Lo REALMENTE cobrado sale de `payments` (fuente de verdad del dinero, CLAUDE.md): un pago
  // en efectivo por folio no toca `reservations.deposit`. Best-effort — si la consulta falla,
  // se cae a `deposit`, que para el flujo del motor web sí espeja el cobro de Stripe.
  let paid = Number(reservation.deposit) || 0
  try {
    paid = await paidForReservation(
      {
        folioRepo: { findMany: (f: any) => orm.findMany('Folios', f) },
        invoiceRepo: { findMany: (f: any) => orm.findMany('Invoices', f) },
        paymentRepo: { findMany: (f: any) => orm.findMany('Payments', f) },
      },
      String(reservation.hotelId),
      String(reservation.id),
      reservation,
    )
  } catch {
    // Se queda con `deposit`: mostrar el pago del motor web es mejor que no mostrar nada.
  }
  const amounts = paymentAmountsOf(reservation.totalAmount, paid)

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
        // `reservations` NO tiene columna `paymentStatus`: leerla devolvía SIEMPRE 'unpaid',
        // incluso con la reserva cobrada al 100%, y por eso la pantalla de confirmación no le
        // mostraba al huésped que su pago entró (reporte de cliente 2026-08-30). Se deriva de
        // `payments`, la fuente de verdad del dinero, con `deposit` de respaldo.
        paymentStatus: amounts.status,
        // Su propio pago: cuánto entró y cuánto queda. No es dato interno del hotel —
        // es la información que el huésped necesita para saber si le queda algo por pagar.
        amountPaid: amounts.paid,
        pendingAmount: amounts.pending,
        promoCode: reservation.promoCode ?? null,
        // Tarea 3.4 (corrección 2026-08-25) — 'pending' cuando el hotel apagó "confirmación
        // instantánea" y todavía no revisó esta reserva. null = no aplica (caso normal).
        // Deliberadamente en el allow-list: es justo lo que el huésped necesita saber
        // ("tu reserva está pagada pero el hotel todavía no la confirmó").
        approvalStatus: reservation.approvalStatus ?? null,
      },
      guest: guest ? { id: guest.id, name: guest.name, email: guest.email, phone: guest.phone ?? '' } : null,
      paymentStatus: amounts.status,
    },
  }
}
