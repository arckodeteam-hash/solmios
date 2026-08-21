// payment-requests/usecases/delete-request.ts — Baja de una solicitud de cobro.
//
// Extraído del service por la regla GOD_SERVICE del analyzer (el service wirea, el usecase decide)
// y para que quede junto a su gemelo `update-request.ts`: borrar y cancelar son el MISMO evento
// desde el punto de vista del techo agregado — la fila deja de contar como `pending`.
//
// GH-0.3: por eso la Checkout Session se mata ANTES de sacar la fila. Sin esto, borrar un cobro
// pendiente liberaba el saldo del lado del servidor y dejaba un link vivo y pagable del lado del
// huésped, sin fila que lo respaldara: el webhook no encontraba el PaymentRequest y el cobro
// quedaba fuera de `payments`, del folio y del audit log.

import { NotFoundError } from 'arckode-framework'
import type { PaymentRequestDTO, CurrentUser } from '../types'
import type { PaymentRequestsSockets } from '../sockets'
import { releaseSession, LIVE_STATUS } from './live-session'
import { deleteEntry, type AuditEntry } from './audit'

export interface DeleteRequestDeps {
  repo: { delete: (id: string) => Promise<boolean> }
  sockets: PaymentRequestsSockets
  audit: (entry: AuditEntry) => Promise<void>
}

/** `existing` ya viene leída Y validada por ownership (IDOR CR-25). */
export async function deletePaymentRequest(
  deps: DeleteRequestDeps,
  id: string,
  existing: PaymentRequestDTO,
  user: CurrentUser,
): Promise<void> {
  if (existing.status === LIVE_STATUS) {
    // Si la sesión ya fue abonada, esto corta con 409: la fila es el único rastro del cobro.
    await releaseSession(existing, { allowPaid: false, action: 'borrar el cobro' })
  }
  const deleted = await deps.repo.delete(id)
  if (!deleted) throw new NotFoundError('Payment request no encontrado')
  await deps.sockets.onPaymentRequestDeleted?.(id)
  await deps.audit(deleteEntry(existing, user))
}
