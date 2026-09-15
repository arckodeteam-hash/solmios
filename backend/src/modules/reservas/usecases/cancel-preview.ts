// reservas/usecases/cancel-preview.ts — Preview de cancelación (GET /api/reservas/:id/cancel-preview).
//
// Responde "¿qué pasa si cancelo esta reserva AHORA?" SIN persistir nada y SIN emitir
// sockets. Es el gemelo de solo-lectura de `cancel.ts`: reusa EXACTAMENTE la misma
// matemática (`resolvePolicy` + `computePenalty` de shared/usecases/cancellation-math)
// para que lo que el recepcionista ve antes de confirmar sea idéntico a lo que se
// persiste después. Re-implementar el cálculo acá es el bug que este archivo evita.
//
// Diferencia clave con cancel.ts: NUNCA lanza 409. Es un preview — si la reserva no se
// puede cancelar, responde 200 con `canCancel:false` + `blockedReason` en español para
// mostrarle al usuario POR QUÉ el botón está deshabilitado.
import { NotFoundError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'
import { assertValidTransition } from './state-machine'
import { resolvePolicy, computePenalty, hotelCancellationTypeOf, checkInInstant, hotelScheduleOf } from '../../../shared/usecases/cancellation-math'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'
import { cancellationBaseOf } from './cancel-base'

const MS_PER_HOUR = 3_600_000
const DEFAULT_CURRENCY = 'USD'

export interface CancelPreviewDeps {
  repo: RepositoryAdapter<any>
  policyRepo: RepositoryAdapter<any>
  /** Hotels — preset `cancellationType` + moneda de fallback. Opcional: fail-soft. */
  hotelRepo?: RepositoryAdapter<any>
  /** Guests — solo para el nombre a mostrar. Opcional: fail-soft → ''. */
  guestRepo?: RepositoryAdapter<any>
  /** Lo cobrado de la reserva — MISMA base que `cancel-core.ts` (ver `cancel-base.ts`). */
  paidOf?: PaidSource
}

/** Contrato EXACTO consumido por el panel (frontend/pages/reservations). No renombrar campos. */
export interface CancelPreview {
  reservationId: string
  status: string
  canCancel: boolean
  blockedReason: string
  guestName: string
  /** Correo del huésped: el modal lo muestra junto a "Avisar al huésped" ('' = no hay a quién avisar). */
  guestEmail: string
  checkIn: string
  checkOut: string
  hoursUntilCheckIn: number
  totalAmount: number
  deposit: number
  currency: string
  refundable: boolean
  penaltyPercent: number
  cancellationFee: number
  refundAmount: number
  policySource: 'custom' | 'preset' | 'default'
  policyLabel: string
  tierLabel: string
}

/** Mensajes en ESPAÑOL para el usuario final (el 409 crudo del state machine no se muestra). */
const BLOCKED_REASONS: Record<string, string> = {
  cancelled: 'La reserva ya está cancelada.',
  checked_in: 'El huésped ya hizo el check-in. Para cerrar la reserva hay que hacer el check-out, no cancelarla.',
  checked_out: 'La reserva ya tiene el check-out realizado: no se puede cancelar.',
}

function blockedReasonFor(status: string): string {
  return BLOCKED_REASONS[status] ?? `No se puede cancelar una reserva en estado "${status}".`
}

/** Nombre y correo del huésped para mostrar. Fail-soft: sin guestId / error / sin fila → ''. */
async function guestOf(guestRepo: RepositoryAdapter<any> | undefined, guestId: string | null | undefined): Promise<{ name: string; email: string }> {
  if (!guestRepo || !guestId) return { name: '', email: '' }
  try {
    const rows = (await guestRepo.findMany({ id: guestId } as any)) as any[]
    const row = rows?.[0]
    return {
      name: typeof row?.name === 'string' ? row.name : '',
      email: typeof row?.email === 'string' ? row.email.trim() : '',
    }
  } catch {
    return { name: '', email: '' }
  }
}

/** Moneda de la reserva; si no tiene, la del hotel; si no, USD. Fail-soft en toda la cadena. */
async function currencyOf(hotelRepo: RepositoryAdapter<any> | undefined, hotelId: string, reservationCurrency: unknown): Promise<string> {
  if (typeof reservationCurrency === 'string' && reservationCurrency !== '') return reservationCurrency
  if (!hotelRepo || !hotelId) return DEFAULT_CURRENCY
  try {
    const rows = (await hotelRepo.findMany({ id: hotelId } as any)) as any[]
    const cur = rows?.[0]?.currency
    return typeof cur === 'string' && cur !== '' ? cur : DEFAULT_CURRENCY
  } catch {
    return DEFAULT_CURRENCY
  }
}

/**
 * Calcula el preview de cancelación de una reserva. NO persiste, NO emite sockets.
 *
 * `canCancel` sale del MISMO `assertValidTransition` que usa la cancelación real (envuelto
 * en try/catch: acá el 409 se traduce a texto, no se propaga). Los montos salen del MISMO
 * `computePenalty`, así que el preview y la cancelación real no pueden divergir.
 */
export async function previewCancellation(
  deps: CancelPreviewDeps,
  id: string,
  currentUser: { id: string; role: string; hotelId?: string },
  auth: Auth,
): Promise<CancelPreview> {
  const { repo, policyRepo, hotelRepo, guestRepo } = deps
  const item = await repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings. Post-findById
  // obligatorio (regla CLAUDE.md + analyzer textual). Un preview lee datos financieros de la
  // reserva: el aislamiento multi-tenant aplica igual que en la cancelación.
  auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')

  const status = String(item.status ?? '')

  // ── ¿Se puede cancelar? Misma state machine que cancel.ts, sin propagar el 409 ──
  let canCancel = true
  let blockedReason = ''
  if (status === 'cancelled') {
    canCancel = false
    blockedReason = blockedReasonFor('cancelled')
  } else {
    try {
      assertValidTransition(status, 'cancelled')
    } catch {
      canCancel = false
      blockedReason = blockedReasonFor(status)
    }
  }

  // ── Montos: MISMA matemática que la cancelación real (F1) ──────────────────
  // Se calcula SIEMPRE, incluso con canCancel=false: el usuario quiere ver la penalidad
  // vigente aunque el botón esté deshabilitado.
  const nowIso = new Date().toISOString()
  const hotelType = await hotelCancellationTypeOf(hotelRepo, item.hotelId)
  const policy = await resolvePolicy(policyRepo, item.hotelId, item.channel, hotelType)
  const deposit = await cancellationBaseOf(deps.paidOf, item)
  // Mismo instante que la cancelación real: fecha de llegada a la hora de check-in, en la zona del hotel.
  const checkIn = checkInInstant(item, await hotelScheduleOf(hotelRepo, item.hotelId))
  const penalty = computePenalty(policy, { now: nowIso, checkIn, depositAmount: deposit })

  const hoursUntilCheckIn = (Date.parse(checkIn) - Date.parse(nowIso)) / MS_PER_HOUR
  const guest = await guestOf(guestRepo, item.guestId)

  return {
    reservationId: id,
    status,
    canCancel,
    blockedReason,
    guestName: guest.name,
    guestEmail: guest.email,
    checkIn: String(item.checkIn ?? ''),
    checkOut: String(item.checkOut ?? ''),
    // Redondeo a 1 decimal: el frontend lo muestra tal cual y no necesita 14 decimales.
    // Puede ser NEGATIVO (checkIn ya pasado) — el contrato lo contempla.
    hoursUntilCheckIn: Number.isFinite(hoursUntilCheckIn) ? Math.round(hoursUntilCheckIn * 10) / 10 : 0,
    totalAmount: Number(item.totalAmount ?? 0),
    deposit,
    currency: await currencyOf(hotelRepo, item.hotelId, item.currency),
    refundable: penalty.refundable,
    penaltyPercent: penalty.penaltyPercent,
    cancellationFee: penalty.cancellationFee,
    refundAmount: penalty.refundAmount,
    policySource: policy.source,
    policyLabel: policy.label ?? '',
    tierLabel: penalty.matchedTier?.label ?? '',
  }
}
