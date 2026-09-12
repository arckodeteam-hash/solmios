// arrival-setup.ts — Tarea automática de "preparación de llegada" (#274).
//
// Housekeeping tiene que saber ANTES de que llegue el huésped qué dejar en la habitación:
// cuna, amenidades infantiles, régimen, pedido especial. Ese dato vive en la reserva; acá se
// traduce a `setupItems` estructurados y se mantiene UNA tarea `arrival_setup` por reserva.
// `syncArrivalSetup` es idempotente: la llaman el connector (created/updated/cancelled) y el
// cron diario, y cualquiera de los dos puede correr N veces sin duplicar ni pisar trabajo hecho.
import type { RepositoryAdapter } from 'arckode-framework'
import type { SetupItem } from '../types'

export const ARRIVAL_SETUP_TYPE = 'arrival_setup'
/** Cuántos días antes del check-in aparece la tarea. Antes de eso sería ruido en el tablero. */
export const SETUP_WINDOW_DAYS = 2

/** Lo mínimo de la reserva que hace falta. Se acepta el registro crudo del repo de reservas. */
export interface ArrivalReservationRef {
  id: string
  hotelId: string
  roomId?: string | null
  status?: string | null
  checkIn?: string | null
  needsCrib?: boolean | null
  cribCount?: number | null
  /** Snapshot `[{id,name,price,quantity,total}]`; puede venir como string JSON según el driver. */
  childAmenities?: unknown
  regime?: string | null
  notes?: string | null
}

export interface ArrivalSetupDeps {
  repo: RepositoryAdapter<any>
  invalidate: (hotelId: string) => Promise<void>
  now?: () => Date
}

export type ArrivalSetupResult = { action: 'created' | 'updated' | 'deleted' | 'none'; task?: any }

/** Prefijo con el que el motor público guarda el pedido del huésped en `notes` (public-booking.ts). */
const REQUEST_PREFIX = 'Pedido especial: '

function toArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
}

function qtyOf(value: unknown): number {
  return Math.max(1, Number(value) || 1)
}

/**
 * El pedido especial va concatenado con el resto de las notas (` | ` o salto de línea, ver
 * `notesParts` en public-booking.ts): se corta en el separador siguiente para quedarse solo
 * con el texto del huésped.
 */
function extractRequest(notes: string | null | undefined): string | null {
  if (!notes) return null
  const idx = notes.indexOf(REQUEST_PREFIX)
  if (idx < 0) return null
  const rest = notes.slice(idx + REQUEST_PREFIX.length)
  const end = rest.search(/ \| |\n/)
  const text = (end < 0 ? rest : rest.slice(0, end)).trim()
  return text || null
}

/** Pura: de la reserva a los ítems. Sin nada que preparar → `[]` (y entonces no hay tarea). */
export function buildSetupItems(r: ArrivalReservationRef): SetupItem[] {
  const items: SetupItem[] = []
  if (r.needsCrib) items.push({ type: 'crib', qty: qtyOf(r.cribCount) })
  for (const a of toArray(r.childAmenities)) {
    const name = typeof a?.name === 'string' ? a.name.trim() : ''
    if (name) items.push({ type: 'amenity', name, qty: qtyOf(a?.quantity) })
  }
  if (r.regime && r.regime !== 'room_only') items.push({ type: 'regime', name: r.regime })
  const request = extractRequest(r.notes)
  if (request) items.push({ type: 'request', text: request })
  return items
}

/** checkIn (YYYY-MM-DD) dentro de hoy + SETUP_WINDOW_DAYS, en UTC. Sin fecha no hay ventana. */
export function isInSetupWindow(checkIn: string | null | undefined, now: Date = new Date()): boolean {
  if (!checkIn) return false
  const limit = new Date(now.getTime() + SETUP_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  return checkIn.slice(0, 10) <= limit
}

/**
 * Mantiene la tarea `arrival_setup` de la reserva en sincronía con ella. Solo se toca la tarea
 * `pending`: una que ya se empezó/terminó es trabajo hecho y queda como registro. La tarea sigue
 * a la reserva: si cambia de habitación, la tarea pasa a la nueva y la vieja queda sin ítems.
 */
export async function syncArrivalSetup(deps: ArrivalSetupDeps, r: ArrivalReservationRef): Promise<ArrivalSetupResult> {
  const existing = await deps.repo.findMany({ reservationId: r.id, type: ARRIVAL_SETUP_TYPE } as any)
  const pending = (existing ?? []).find((t: any) => t.status === 'pending')
  const items = buildSetupItems(r)
  const now = deps.now?.() ?? new Date()
  const applies = r.status === 'confirmed' && !!r.roomId && items.length > 0 && isInSetupWindow(r.checkIn, now)

  if (!applies) {
    if (!pending) return { action: 'none' }
    await deps.repo.delete(pending.id)
    await deps.invalidate(r.hotelId)
    return { action: 'deleted', task: pending }
  }

  const assignedDate = r.checkIn ? r.checkIn.slice(0, 10) : undefined
  if (pending) {
    const patch = { roomId: r.roomId, setupItems: items, assignedDate }
    const same = pending.roomId === patch.roomId
      && (pending.assignedDate ?? undefined) === assignedDate
      && JSON.stringify(pending.setupItems ?? null) === JSON.stringify(items)
    if (same) return { action: 'none', task: pending }
    const task = await deps.repo.update(pending.id, patch as any)
    await deps.invalidate(r.hotelId)
    return { action: 'updated', task }
  }

  const task = await deps.repo.create({
    id: crypto.randomUUID(),
    hotelId: r.hotelId,
    roomId: r.roomId,
    reservationId: r.id,
    type: ARRIVAL_SETUP_TYPE,
    priority: 'medium',
    status: 'pending',
    assignedDate,
    setupItems: items,
  } as any)
  await deps.invalidate(r.hotelId)
  return { action: 'created', task }
}
