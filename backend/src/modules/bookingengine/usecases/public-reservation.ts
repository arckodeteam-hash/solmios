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
//
// #272 — Expone además el estado del reembolso (refundStatus/refundedAt/refundAmount/
// cancellationFee/cancelledAt) y, si la reserva es parte de un grupo (token compartido), las
// habitaciones hermanas en `group.rooms` (allow-list mínima: id, roomType, adults, children, status).

import crypto from 'node:crypto'
import { paymentAmountsOf } from '../../../shared/utils/payment-status'
import { paidForReservation } from '../../../shared/usecases/reservation-paid'
import { chargeableTotal } from '../../../shared/utils/reservation-balance'
import { DEFAULT_APPROVAL_DEADLINE_HOURS } from './config'

const NOT_FOUND = { status: 404, body: { error: 'Reservation not found' } } as const
/** #270 — el MISMO 404 (misma referencia) para cualquier otro endpoint público por id+token
 *  (recibo PDF): anti-enumeración exige un body idéntico entre endpoints, no solo dentro de uno. */
export const PUBLIC_RESERVATION_NOT_FOUND = NOT_FOUND

/** #272 — Hermanas del grupo para la página pública. Best-effort: cualquier fallo → null. */
async function publicGroupOf(orm: any, reservation: any): Promise<null | { id: string; rooms: any[] }> {
  if (!reservation.groupId) return null
  try {
    const siblings = (await orm.findMany('Reservations', { hotelId: reservation.hotelId, groupId: reservation.groupId })) as any[]
    if (!Array.isArray(siblings) || !siblings.length) return null
    const rooms = await Promise.all(siblings.map(async (r) => {
      let roomType = ''
      try {
        const room = (r.roomId ? (await orm.findMany('Rooms', { id: r.roomId })) as any[] : [])[0]
        roomType = String(room?.type ?? '')
      } catch {
        // roomType = '' — mostrar la habitación sin tipo es mejor que no listarla.
      }
      return { id: r.id, roomType, adults: r.adults, children: r.children, status: r.status }
    }))
    return { id: String(reservation.groupId), rooms }
  } catch {
    return null
  }
}

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
 * #270 — ¿El token de la URL corresponde al `accessToken` de ESTA reserva?
 * HMAC(secret(hotelId), stored) vs HMAC(secret, received) + timingSafeEqual. `false` si falta
 * el token recibido o la reserva no tiene `accessToken` (creada desde el panel). Compartido por
 * `getPublicReservation` y por el recibo PDF (`public-receipt.ts`) para que la regla sea UNA.
 */
export function reservationTokenMatches(
  reservation: { hotelId: string; accessToken?: string | null },
  receivedToken: string | undefined | null,
): boolean {
  if (!receivedToken || !reservation.accessToken) return false
  const secret = hotelSecret(reservation.hotelId)
  const expected = hmac(secret, String(reservation.accessToken))
  const received = hmac(secret, String(receivedToken))
  return safeEqual(expected, received)
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
  if (!reservationTokenMatches(reservation, token)) return NOT_FOUND

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
  // Auditoría final (2026-09-04) — FIX: comparaba `paid` contra `reservation.totalAmount` crudo,
  // ignorando `otherCharges`/extras — el MISMO bug (2026-08-19) que `shared/utils/
  // reservation-balance.ts` ya había resuelto para Administración (`getExtendedDetail`), pero
  // nunca migrado acá. Con extras cargados, esta pantalla podía decir "pendiente" sobre un saldo
  // que Administración ya veía en $0 (o viceversa). Best-effort: un fallo leyendo extras no puede
  // tumbar la confirmación pública, se degrada a "sin extras" (mismo total que antes).
  let addons: unknown[] = []
  try {
    addons = await orm.findMany('ReservationAddons', { reservationId: reservation.id, hotelId: reservation.hotelId })
  } catch {
    // addons = [] — chargeableTotal degrada a totalAmount + otherCharges, sin extras.
  }
  const amounts = paymentAmountsOf(chargeableTotal(reservation, addons as any[]), paid)
  const group = await publicGroupOf(orm, reservation)

  // #271 MR-06 — plazo de aprobación del hotel (`booking_config.approvalDeadlineHours`). Best-effort:
  // sin fila, columna vieja en null o consulta fallida → default 24. Siempre un número, nunca null:
  // la pantalla de confirmación lo interpola en "El hotel revisará su reserva en las próximas N h".
  let approvalDeadlineHours = DEFAULT_APPROVAL_DEADLINE_HOURS
  try {
    const configRows = (await orm.findMany('BookingConfig', { hotelId: reservation.hotelId })) as any[]
    const raw = Number(configRows?.[0]?.approvalDeadlineHours)
    if (Number.isFinite(raw) && raw > 0) approvalDeadlineHours = raw
  } catch {
    // Se queda con el default: el plazo es informativo, no puede tumbar la confirmación pública.
  }
  const rejected = reservation.approvalStatus === 'rejected'

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
        // Requerimiento 4 (2026-09-03) — la edad de cada niño es SUYA, la declaró el huésped al
        // reservar: mismo criterio que `adults`/`children` de arriba, no un dato interno del
        // hotel. Ausente/`[]` en reservas viejas (antes de esta feature) o sin niños.
        childrenAges: reservation.childrenAges ?? [],
        // Tarea "Cobro % niños" (2026-09-09) — % REALMENTE cobrado a los niños de esta reserva
        // (o `null` si la regla no aplicó): es la cuenta que el huésped ya vio y pagó, no un dato
        // interno del hotel.
        childrenRatePercentApplied: reservation.childrenRatePercentApplied ?? null,
        // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — mismo criterio que
        // `childrenAges` de arriba: es lo que EL HUÉSPED pidió, no un dato interno del hotel.
        // Ausente/default en reservas de antes de esta feature.
        needsCrib: reservation.needsCrib ?? false,
        cribCount: reservation.cribCount ?? 0,
        // MR-03 (#268) — régimen que EL HUÉSPED eligió y pagó (snapshot congelado), no un dato
        // interno del hotel. `null`/0 en reservas anteriores a esta feature o sin régimen.
        mealPlan: reservation.mealPlan ?? null,
        mealPlanPriceMode: reservation.mealPlanPriceMode ?? null,
        mealPlanUnitPrice: reservation.mealPlanUnitPrice ?? 0,
        mealPlanTotal: reservation.mealPlanTotal ?? 0,
        totalAmount: reservation.totalAmount,
        // Tarea 24 (#88): el desglose que vio en el paso de pago (subtotal, extras, promo, cada
        // impuesto con nombre/%/importe, total). Es SUYO — lo aceptó él. `null` en reservas
        // anteriores a esta feature o creadas desde el panel.
        totalBreakdown: reservation.priceBreakdown ?? null,
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
        // #266 (MR-01) — por qué se canceló SU reserva: el cron/webhook de vencimiento escribe
        // 'payment_timeout' cuando el huésped no completó el pago en el plazo, y la pantalla de
        // confirmación lo usa para decirle "venció, volvé a reservar" en vez de un error genérico.
        // `cancellationReason` es texto libre (el panel guarda lo que tipea el empleado): al
        // público sale SOLO el código de sistema 'payment_timeout'; cualquier otro motivo → null.
        cancellationReason: reservation.cancellationReason === 'payment_timeout' ? 'payment_timeout' : null,
        // #272 — SU cancelación y SU reembolso: lo que retuvo la política, lo que se le devuelve
        // y en qué estado está ('none' | 'pending' | 'done' | 'failed', lo escribe el connector
        // de refunds). La pantalla pública lo usa para decir "5-10 días hábiles" o "el hotel lo
        // está gestionando" en vez de un genérico. Es SU dinero (mismo criterio que
        // `amountPaid`/`pendingAmount`): siempre número (0 si no hay nada que devolver), también
        // en el rechazo del hotel (#271 MR-06, que reembolsa el 100% de lo cobrado).
        cancellationFee: reservation.cancellationFee ?? 0,
        refundAmount: Number(reservation.refundAmount ?? 0),
        refundStatus: reservation.refundStatus ?? 'none',
        refundedAt: reservation.refundedAt ?? null,
        cancelledAt: reservation.cancelledAt ?? null,
        // #271 (MR-06) — cuántas horas se da el hotel para revisar SU reserva pendiente: es la
        // promesa que la pantalla de confirmación le hace al huésped ("el hotel revisará su reserva
        // en las próximas N h"), no un dato interno. Siempre número (default 24).
        approvalDeadlineHours,
        // #271 (MR-06) — por qué el hotel RECHAZÓ su reserva. Al rechazar, el panel guarda en
        // `cancellationReason` el texto que el empleado escribió PARA el huésped (RejectReservationModal),
        // así que en esta rama sí es suyo. Fuera de `approvalStatus === 'rejected'` → null: la
        // regla de arriba (solo el código 'payment_timeout') sigue intacta para el resto.
        rejectionReason: rejected ? (reservation.cancellationReason ?? null) : null,
      },
      guest: guest ? { id: guest.id, name: guest.name, email: guest.email, phone: guest.phone ?? '' } : null,
      paymentStatus: amounts.status,
      // #272 — grupo (token compartido): las N habitaciones, para listarlas y cancelarlas juntas.
      group,
    },
  }
}
