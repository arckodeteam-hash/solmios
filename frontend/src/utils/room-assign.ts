// utils/room-assign.ts — Helpers puros (sin Vue) de la asignación de habitación (REQ-HAC-06, #261).
//
// La reserva vende un TIPO y la unidad se elige en recepción (HAC-03). Mientras `roomId` es null la
// reserva vive en la banda "Sin asignar" del planning: acá se reparten esas reservas en carriles sin
// solape (una fila por carril) y se traduce el 409 de `POST /reservas/:id/assign-room` a un texto
// que la recepción entienda ("Ocupada por X del … al …", "Es de tipo Doble…").

/** Lo mínimo de una estadía para acomodarla en carriles: id + noches [checkIn, checkOut). */
export interface StayLike {
  id: string
  checkIn: string
  checkOut: string
}

/** Fecha de calendario YYYY-MM-DD: las noches se comparan por día, no por hora/zona. */
const day = (v: unknown): string => String(v ?? '').slice(0, 10)

/**
 * Reparte estadías en carriles donde ninguna se solapa (greedy por `checkIn`; desempate por `id`
 * para que el resultado sea estable). Dos consecutivas (checkOut == checkIn) comparten carril:
 * el check-out es por la mañana y el check-in por la tarde. Sin items → `[]` (0 carriles).
 */
export function layoutUnassignedLanes<T extends StayLike>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => {
    const byDate = day(a.checkIn).localeCompare(day(b.checkIn))
    return byDate !== 0 ? byDate : String(a.id).localeCompare(String(b.id))
  })
  const lanes: T[][] = []
  const laneEnds: string[] = []
  for (const item of sorted) {
    const start = day(item.checkIn)
    const idx = laneEnds.findIndex(end => end <= start)
    if (idx === -1) {
      lanes.push([item])
      laneEnds.push(day(item.checkOut))
    } else {
      lanes[idx].push(item)
      laneEnds[idx] = day(item.checkOut)
    }
  }
  return lanes
}

/** Motivos que manda el backend en `details.reason` del 409 de assign-room (usecases/assign-room.ts). */
export type AssignErrorReason = 'room_overlap' | 'type_mismatch' | 'room_not_sellable' | 'invalid_status'

interface AssignErrorDetails {
  reason?: AssignErrorReason | string
  locator?: string
  from?: string
  to?: string
  expected?: string
  actual?: string
  status?: string
}

const FALLBACK_MESSAGE = 'No se pudo asignar la habitación'

function isApiErrorLike(err: unknown): err is { status: number; message: string; details?: AssignErrorDetails } {
  return !!err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number'
    && typeof (err as { message?: unknown }).message === 'string'
}

/**
 * Texto para el toast cuando falla la asignación. Con un 409 estructurado se dice el POR QUÉ
 * (quién ocupa la habitación y cuándo, qué tipo se vendió, etc.); con cualquier otro `ApiError`
 * se respeta su `message` (los usecases responden en español); si no es un error de API, un
 * genérico — un `TypeError` de red no le dice nada a la recepción.
 */
export function assignErrorMessage(err: unknown): string {
  if (!isApiErrorLike(err)) return FALLBACK_MESSAGE
  const details = err.details && typeof err.details === 'object' ? err.details : undefined
  if (err.status === 409 && details?.reason) {
    switch (details.reason) {
      case 'room_overlap': {
        const locator = details.locator || 'otra reserva'
        const from = day(details.from)
        const to = day(details.to)
        return from && to ? `Ocupada por ${locator} del ${from} al ${to}` : `Ocupada por ${locator}`
      }
      case 'type_mismatch':
        return `Es de tipo "${details.actual ?? '—'}" y la reserva vendió "${details.expected ?? '—'}"`
      case 'room_not_sellable':
        return `Fuera de servicio (${details.status ?? 'no vendible'})`
      case 'invalid_status':
        return `No se puede asignar en estado ${details.status ?? 'actual'}`
      default:
        break
    }
  }
  return err.message || FALLBACK_MESSAGE
}

/** Reserva sin unidad asignada. `mapReservation` deja `roomId = ''` cuando el backend manda null. */
export function isUnassigned(r: { roomId?: string | null }): boolean {
  return !r.roomId
}
