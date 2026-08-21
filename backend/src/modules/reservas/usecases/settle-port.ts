// reservas/usecases/settle-port.ts — Adaptador del puerto de settlement del checkout.
//
// El orquestador real vive en `shared/usecases/settle-folio-at-checkout.ts` y lo cablea el
// connector `reservas-folios-settlement`. Acá sólo se traduce la fila de la reserva a los
// parámetros del puerto. Vive fuera del service por la regla GOD_SERVICE del analyzer: el service
// wirea, el usecase decide.
//
// DEBT-1: este archivo nació con `user: any` en el actor que autoriza cerrar el folio y emitir la
// factura, y `any` en la reserva y en el resultado. `any` en el actor de una operación contable es
// lo que deja pasar un `req.user` a medio armar (sin `role`, sin `id`) hasta `folios.close`, donde
// la autorización se decide. Los tres están tipados — y el borde HTTP lo COMPRUEBA con
// `toSettleActor`, porque un `req.user as SettleActor` es una promesa del programador, no una
// verificación: el `any` seguía entrando, sólo que en silencio.

import { AuthError } from 'arckode-framework'

/** Cobro con el que se salda el folio al hacer el checkout. */
export interface SettleInput { amount: number; method: string; reference?: string }

/** Actor que autoriza el cierre del folio y la emisión de la factura. Es el `req.user` del JWT. */
export interface SettleActor { id: string; role: string; hotelId?: string }

/**
 * Convierte el `req.user` en un `SettleActor` COMPROBADO.
 *
 * El tipo solo no alcanzaba: el único call site era `req.user as SettleActor`
 * (`reservas/controller.ts`), y un casteo no verifica nada — un token sin `role` (o sin `id`)
 * llegaba igual hasta `folios.close`, que es donde se decide la autorización, con `undefined` en
 * el campo que la decide. Exactamente lo que DEBT-1 dijo cerrar y no cerró.
 *
 * Falla fuerte: cerrar un folio y emitir una factura sin saber QUIÉN lo hizo no es un caso
 * degradado, es un asiento contable sin responsable.
 */
export function toSettleActor(user: unknown): SettleActor {
  const u = user as Record<string, unknown> | null | undefined
  const id = String(u?.id ?? '')
  const role = String(u?.role ?? '')
  if (!id || !role) throw new AuthError('El usuario que cierra el folio no está identificado')
  const hotelId = u?.hotelId === undefined || u?.hotelId === null ? undefined : String(u.hotelId)
  return { id, role, hotelId }
}

/** Lo mínimo que el puerto necesita de la fila `reservations`. */
export interface SettleReservation {
  id: string
  hotelId: string
  guestId?: string | null
  roomId?: string | null
}

/** Lo que devuelve el settlement: folio cerrado, factura emitida (si hubo saldo) y sus importes. */
export interface SettleResult {
  folioId: string
  invoiceId: string | null
  balance: number
  amountPaid: number
  invoiceNumber: string | null
}

export type SettleFolioPort = (
  params: {
    reservationId: string; hotelId: string; guestId: string | null; roomId: string | null
    settle?: SettleInput | null
  },
  user: SettleActor,
) => Promise<SettleResult>

/** Sin puerto cableado no hay settlement: el checkout sigue sin cerrar folio (comportamiento previo). */
export async function settleFolioForCheckout(
  port: SettleFolioPort | undefined,
  reservation: SettleReservation,
  settle: SettleInput | null | undefined,
  user: SettleActor,
): Promise<SettleResult | null> {
  if (!port) return null
  return port({
    reservationId: reservation.id,
    hotelId: reservation.hotelId,
    guestId: reservation.guestId || null,
    roomId: reservation.roomId ?? null,
    settle: settle || null,
  }, user)
}
