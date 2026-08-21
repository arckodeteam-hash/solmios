// payment-requests/usecases/update-request.ts — Edición de una solicitud de cobro.
//
// Extraído del service (regla GOD_SERVICE del analyzer: el service wirea, el usecase decide). Junta
// las tres reglas que gobiernan un update:
//   · el techo del monto (SEC-1/SEC-2) — sin él se creaba el cobro por el importe correcto y se lo
//     editaba a cualquier cifra antes de generar la Checkout Session;
//   · la re-verificación post-commit del techo agregado (COR-3), que revierte el monto si otro
//     cobro de la misma reserva entró en el medio;
//   · la baja de la Checkout Session cuando la fila deja de respaldarla (GH-0.3 +
//     BUG-ceiling-bypass) — sea porque sale de `pending` (`PUT {status:'cancelled'}` liberaba el
//     techo con el link vivo) o porque cambia de importe (`PUT {amount:50}` sobre un pending de
//     $300 bajaba el comprometido a 50 y dejaba el link de $300 pagable);
//   · el rastro de auditoría de TODO cambio de estado hecho a mano (SEC-1).
// La sección crítica (lock por reserva) la abre el caller: la ownership se valida antes de tomarlo.

import { NotFoundError } from 'arckode-framework'
import type { PaymentRequestDTO, UpdatePaymentRequestDTO, CurrentUser } from '../types'
import type { PaymentRequestsSockets } from '../sockets'
import { assertChargeableAmount, assertCeilingAfterCommit, type ChargeCeilingDeps } from './charge-ceiling'
import { releasesCeiling, invalidatesSession, releaseSession, DEAD_LINK_PATCH } from './live-session'
import { isAuditableStatusChange, statusChangeEntry, type AuditEntry } from './audit'

/**
 * Campos que un PUT puede tocar. Espeja `UpdatePaymentRequestSchema` y es la SEGUNDA barrera: el
 * schema filtra en el borde HTTP, esto filtra a los callers que entran por el service.
 *
 * BUG-ceiling-bypass: `stripeSessionId`/`stripePaymentUrl`/`paidAt` salieron de acá — son estado
 * interno del servidor (los escriben `create-checkout.ts` y `stripe-webhook.ts` por repo directo).
 * Ver el porqué completo en `validators/schema.ts`.
 */
const PATCHABLE = ['amount', 'status', 'sentTo', 'sentVia'] as const

export interface UpdateRequestDeps {
  repo: { update: (id: string, patch: Partial<PaymentRequestDTO>) => Promise<PaymentRequestDTO | null> }
  ceilingDeps: ChargeCeilingDeps
  sockets: PaymentRequestsSockets
  audit: (entry: AuditEntry) => Promise<void>
}

export async function updatePaymentRequest(
  deps: UpdateRequestDeps,
  id: string,
  dto: UpdatePaymentRequestDTO,
  user: CurrentUser,
  /** La fila ya leída Y validada por ownership (IDOR CR-26). */
  previous: PaymentRequestDTO,
): Promise<PaymentRequestDTO> {
  // El techo corre SIEMPRE que venga un monto. Sin `reservationId` no hay saldo contra el cual
  // toparse, pero el "> 0" se exige igual: antes esa rama se salteaba entera (SEC-3).
  if (dto.amount !== undefined) {
    const { hotelId, reservationId } = previous
    const amount = await assertChargeableAmount(deps.ceilingDeps, { hotelId, reservationId, amount: dto.amount, excludeRequestId: id })
    dto = { ...dto, amount }
  }

  const patch: Partial<PaymentRequestDTO> = {}
  for (const k of PATCHABLE as readonly (keyof UpdatePaymentRequestDTO)[]) {
    if (dto[k] !== undefined) (patch as any)[k] = dto[k]
  }

  // SEC-7: revivir un cobro (`PUT {status:'pending'}` sobre cancelled/expired) RE-ENTRA al techo
  // agregado. El bloque de arriba sólo corre si el body trae `amount`; sin esto, un cobro cancelado
  // volvía a `pending` congelando un importe que el saldo ACTUAL de la reserva ya no respalda
  // (bajó por un PUT de `totalAmount`/`otherCharges` o por la baja de un extra). Mismo criterio
  // que `create`: el techo se mide contra el estado de HOY, no contra el del día en que se creó.
  const nextStatus = dto.status
  if (nextStatus === 'pending' && previous.status !== 'pending' && previous.reservationId && dto.amount === undefined) {
    patch.amount = await assertChargeableAmount(deps.ceilingDeps, {
      hotelId: previous.hotelId, reservationId: previous.reservationId,
      amount: previous.amount, excludeRequestId: id,
    })
  }

  // GH-0.3 + BUG-ceiling-bypass: la sesión de Stripe tiene que dejar de ser pagable en el MISMO
  // acto en que la fila deja de respaldarla. Son dos motivos, no uno:
  //   · el cobro sale de `pending` → sale del techo agregado (`committedPending` filtra por estado);
  //   · el cobro cambia de importe → la sesión emitida quedó por otro número (ver
  //     `invalidatesSession`). Bajarlo libera techo con el link viejo todavía vivo, que es el mismo
  //     bug por otra puerta.
  // Va ANTES del update: si Stripe falla, la fila NO cambia y el techo sigue reservado. Sobre una
  // sesión ya abonada corta con 409 (ver `live-session.ts`).
  const releases = releasesCeiling(previous.status, nextStatus)
  const reprices = invalidatesSession(previous, dto.amount)
  if (releases || reprices) {
    const action = releases ? `marcar el cobro como "${nextStatus}"` : 'cambiarle el importe al cobro'
    // COR-C: `allowPaid` SIEMPRE false — también para `nextStatus:'paid'`. La excepción dejaba
    // pasar el "marcar pagado a mano" sobre un pending cuya Checkout Session YA había sido abonada:
    // la fila quedaba `paid` y el webhook posterior descartaba la liquidación entera
    // (`stripe-webhook.ts` corta en `pr.status === 'paid'`) — sin fila en `payments`, sin cargo de
    // folio, sin bump de `deposit` y sin audit, con el techo autorizando un segundo link por la
    // misma plata. Si el huésped pagó el link, la liquidación la hace el webhook; marcarlo a mano
    // acá es exactamente lo que hay que impedir (409 con el motivo).
    await releaseSession(previous, { allowPaid: false, action })
    // La URL muerta no se sigue mostrando ni compartiendo desde el panel.
    Object.assign(patch, DEAD_LINK_PATCH)
  }

  // `paidAt` lo pone el SERVIDOR, no el body (BUG-ceiling-bypass): es el sello de cuándo entró la
  // plata. El webhook ya lo escribe por su cuenta; acá se cubre el "marcar pagado a mano".
  if (nextStatus === 'paid' && previous.status !== 'paid' && !previous.paidAt) {
    patch.paidAt = new Date().toISOString()
  }

  const item = await deps.repo.update(id, patch)
  if (!item) throw new NotFoundError('Payment request no encontrado')

  if (dto.amount !== undefined) {
    // COR-3: revertir si otro cobro de la misma reserva entró en el medio. COR-D: la compensación
    // restaura TODOS los campos que este update tocó (`amount`, `status`, `sentTo`/`sentVia`,
    // `stripePaymentUrl`, `paidAt`), no sólo el monto — antes la fila quedaba p.ej. `cancelled`
    // con la URL vaciada aunque el PUT sólo había cambiado el importe, y la denegación hablaba de
    // una cancelación que nadie pidió. La Checkout Session ya expirada NO se puede revivir (API de
    // Stripe): regenerar el link desde el panel es el flujo normal tras editar un cobro rechazado.
    await assertCeilingAfterCommit(deps.ceilingDeps, { ...item, amount: Number(dto.amount) },
      async () => {
        await deps.repo.update(id, {
          amount: previous.amount, status: previous.status, sentTo: previous.sentTo, sentVia: previous.sentVia,
          stripePaymentUrl: previous.stripePaymentUrl, paidAt: previous.paidAt ?? null,
        } as Partial<PaymentRequestDTO>)
      })
  }

  await deps.sockets.onPaymentRequestUpdated?.(item)
  // Cualquier cambio de estado a mano mueve el saldo comprometido de la reserva (perdonar una deuda
  // marcando "paid", liberar el techo marcando "cancelled", revivir un link a "pending"): todos
  // necesitan rastro, no sólo los cuatro de la whitelist vieja (SEC-1).
  if (isAuditableStatusChange(dto.status, previous.status)) {
    await deps.audit(statusChangeEntry(item, previous.status, user))
  }
  return item
}
