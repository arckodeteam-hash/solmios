// shared/usecases/reservation-payment-history.ts — Historial de cobros de UNA reserva.
//
// Por qué (pedido del cliente, 2026-08-30): la reserva mostraba un total "Pagado" y nada más.
// Recepción no tenía forma de responder "¿por dónde pagó?": ni el método, ni la fecha, ni la
// referencia, ni quién lo cargó. El listado de `/panel/billing → Pagos` existe pero es global
// del hotel y no se puede filtrar por reserva.
//
// Sale de `collectReservationPayments` — la MISMA recolección con la que se calcula el total
// cobrado. Si fueran dos recorridos distintos, el desglose podría no sumar el número que la
// propia reserva muestra arriba.
//
// Los nombres de usuario se resuelven contra `users`, NUNCA contra `employee-profiles`: son
// módulos distintos con ids que no matchean (regla CLAUDE.md).

import { round2 } from '../utils/money'
import { collectReservationPayments, type ReservationPaidRepos } from './reservation-paid'

/** Estados que representan dinero que se movió de verdad (los mismos que cuentan para el total). */
const SETTLED_STATUSES = new Set(['completed', 'refunded'])

export interface PaymentHistoryEntry {
  id: string
  /** 'charge' | 'refund' | 'deposit' | 'withdrawal'. */
  type: string
  /** 'card' | 'cash' | 'transfer' | 'link' | 'deposit' | 'other'. */
  method: string
  status: string
  /** Positivo para cobros, NEGATIVO para devoluciones: así la columna suma a la vista. */
  amount: number
  currency: string
  description: string
  /** Referencia externa (sesión de Stripe, comprobante bancario…) para cruzar con el banco. */
  reference: string
  /** Nombre del usuario que lo registró. Vacío = lo asentó el sistema, no una persona. */
  registeredBy: string
  createdAt: string
}

export interface PaymentHistoryResult {
  entries: PaymentHistoryEntry[]
  /** Cobros menos devoluciones, contando solo lo liquidado. Cuadra con lo que suma la lista. */
  net: number
}

export interface PaymentHistoryDeps extends ReservationPaidRepos {
  /** Repo `Users` — resuelve `createdBy` a un nombre. Opcional: sin él, el nombre va vacío. */
  userRepo?: { findMany(filter: Record<string, unknown>): Promise<any[]> }
}

/**
 * Historial ordenado del más reciente al más viejo (es el orden en que se consulta: "¿qué pasó
 * con este cobro recién?"). Multi-tenancy: toda query lleva `hotelId`.
 */
export async function reservationPaymentHistory(
  deps: PaymentHistoryDeps,
  hotelId: string,
  reservationId: string,
): Promise<PaymentHistoryResult> {
  const rows = (await collectReservationPayments(deps, hotelId, reservationId)) as any[]
  const names = await resolveUserNames(deps, hotelId, rows)

  const entries: PaymentHistoryEntry[] = rows.map((p) => {
    const isRefund = String(p?.type ?? '') === 'refund'
    const amount = Math.abs(Number(p?.amount) || 0)
    return {
      id: String(p?.id ?? ''),
      type: String(p?.type ?? ''),
      method: String(p?.method ?? ''),
      status: String(p?.status ?? ''),
      amount: isRefund ? -round2(amount) : round2(amount),
      currency: String(p?.currency || 'USD').toUpperCase(),
      description: String(p?.description ?? ''),
      // `reference` es lo genérico; para Stripe el dato útil puede estar en el id de la sesión.
      reference: String(p?.reference || p?.stripeSessionId || p?.stripePaymentId || ''),
      registeredBy: names.get(String(p?.createdBy ?? '')) ?? '',
      createdAt: String(p?.createdAt ?? p?.processedAt ?? ''),
    }
  })

  entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

  const net = round2(
    entries.reduce((acc, e) => (SETTLED_STATUSES.has(e.status) ? acc + e.amount : acc), 0),
  )
  return { entries, net }
}

/** `users.id` → nombre, en UNA query. Filtra por hotel: un id de otro tenant no se resuelve. */
async function resolveUserNames(
  deps: PaymentHistoryDeps,
  hotelId: string,
  rows: readonly any[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!deps.userRepo) return out
  const ids = [...new Set(rows.map((p) => String(p?.createdBy ?? '')).filter(Boolean))]
  if (!ids.length) return out
  try {
    const users = await deps.userRepo.findMany({ hotelId })
    for (const u of users ?? []) {
      const id = String((u as { id?: unknown })?.id ?? '')
      if (!id || !ids.includes(id)) continue
      const name = String((u as { name?: unknown })?.name ?? '').trim()
      if (name) out.set(id, name)
    }
  } catch {
    // Sin nombres el historial sigue siendo útil (fecha, monto, método, referencia).
  }
  return out
}
