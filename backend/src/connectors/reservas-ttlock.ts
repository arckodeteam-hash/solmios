// connectors/reservas-ttlock.ts — Ciclo de vida del código TTLock ligado a la reserva:
//   - onRoomAssigned (#258, REQ-HAC-03): la habitación es la que determina la cerradura, así que
//     el PIN se genera AL ASIGNAR (no al pagar) si la reserva ya está confirmada/pagada. Primera
//     asignación → `generateCodeIfAbsent` (idempotente: si el pago ya lo generó, no duplica).
//     Reasignación (cambio de habitación) → `generateCode`: crea el PIN en la cerradura nueva y
//     `keepSingleCode` revoca el de la anterior (una reserva = UN código vigente). Si la cerradura
//     nueva RECHAZA el PIN, el anterior se expira igual (`shared/usecases/lock-code-on-room-move.ts`):
//     seguía abriendo la habitación que se liberó. Desasignar (roomId null) → expira: sin
//     habitación no hay cerradura que abrir.
//   - onReservationCheckedOut / onReservationCancelled → expira los códigos vigentes.
//
// C-1 (auditoría 2026-08-19): solo escuchaba onReservationCheckedOut — una reserva pagada
// con código ya generado que se CANCELABA dejaba el PIN de la habitación activo hasta su
// endDate original: el huésped recuperó la plata según política pero conservaba acceso
// físico. onReservationCancelled (panel, sistema, OTA) ahora también expira.
//
// Todo es best-effort: ttlock puede no estar registrado en el despliegue, la habitación puede no
// tener cerradura o el hotel no estar conectado — se loguea y la asignación/cancelación sigue
// (el staff puede generar/revocar a mano). El connector solo wirea: la idempotencia, el reemplazo
// (keepSingleCode) y el hardware viven en el módulo ttlock.
import type { ConnectorContext, Logger } from 'arckode-framework'
import { replaceLockCodeOnRoomMove } from '../shared/usecases/lock-code-on-room-move'

interface TtlockModule {
  expireCodesByReservation: (id: string) => Promise<void>
  generateCodeIfAbsent: (hotelId: string, reservationId: string) => Promise<unknown>
  generateCode: (hotelId: string, reservationId: string) => Promise<unknown>
}

interface ReservasModule {
  setSockets: (s: any) => void
  getById: (id: string, user: { id: string; role: string; hotelId?: string }) => Promise<any>
}

export interface RoomAssignedEvent {
  reservationId: string
  hotelId: string
  roomId: string | null
  previousRoomId: string | null
}

type InfoLogger = Pick<Logger, 'info' | 'error'>
const fallbackLog: InfoLogger = {
  info: (msg: string) => console.info(`[reservas-ttlock] ${msg}`),
  error: (msg: string) => console.error(`[reservas-ttlock] ${msg}`),
} as InfoLogger

const systemUser = (hotelId: string) => ({ id: 'system-connector', role: 'super_admin', hotelId })
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
/** Best-effort: el fallo se loguea y la promesa resuelve — nunca tumba al emisor del evento. */
const bestEffort = (p: Promise<unknown>, onError: (e: unknown) => void): Promise<void> => p.then(() => undefined, onError)
/** `resolveModule` tira si el módulo no está registrado en este despliegue: acá eso es un no-op. */
function resolveOptional<T>(ctx: ConnectorContext, name: string): T | null {
  try { return ctx.resolveModule<T>(name) } catch { return null }
}

/**
 * ¿La reserva "merece" código? Confirmada/alojada, o con la seña pagada, o saldada por completo.
 * Una `pending` sin pago que recibe habitación (pre-asignación del recepcionista) NO genera:
 * el PIN llega cuando se confirme/pague (payment-requests-ttlock) — y ahí ya tendrá habitación.
 */
export function isReservationEntitledToCode(res: any): boolean {
  const total = Number(res?.totalAmount)
  const pending = Number(res?.pendingAmount)
  const paidInFull = Number.isFinite(total) && total > 0 && Number.isFinite(pending) && pending <= 0
  return Boolean(res) && (res.status === 'confirmed' || res.status === 'checked_in' || res.depositStatus === 'paid' || paidInFull)
}

async function expireCodes(ctx: ConnectorContext, reservationId: string): Promise<void> {
  await resolveOptional<TtlockModule>(ctx, 'ttlock')?.expireCodesByReservation(reservationId)
}

async function generateOnAssign(ctx: ConnectorContext, log: InfoLogger, data: RoomAssignedEvent): Promise<void> {
  const reservas = ctx.resolveModule<ReservasModule>('reservas')
  const res = await reservas.getById(data.reservationId, systemUser(data.hotelId))
  if (!isReservationEntitledToCode(res)) {
    log.info(`Reserva ${data.reservationId} asignada a ${data.roomId} sin confirmar/pagar: el código se genera al confirmar o pagar`)
    return
  }
  const ttlock = ctx.resolveModule<TtlockModule>('ttlock')
  // Reasignación: el PIN vigente abre la cerradura VIEJA. generateCode crea el de la nueva y
  // keepSingleCode revoca los anteriores (hardware incluido) — queda uno solo, el correcto.
  // Primera asignación (o la misma habitación): generateCodeIfAbsent, idempotente.
  const moved = Boolean(data.previousRoomId) && data.previousRoomId !== data.roomId
  // Reasignación con la cerradura nueva fallando: el PIN viejo se expira igual (ver usecase).
  await (moved ? replaceLockCodeOnRoomMove(ttlock, log, data) : ttlock.generateCodeIfAbsent(data.hotelId, data.reservationId))
}

function handleRoomAssigned(ctx: ConnectorContext, log: InfoLogger, data: RoomAssignedEvent): Promise<void> {
  if (!data?.reservationId || !data?.hotelId) return Promise.resolve()
  // Desasignar (roomId null): sin habitación no hay cerradura. Se expira lo vigente (incluye 'pending').
  const job = data.roomId ? generateOnAssign(ctx, log, data) : expireCodes(ctx, data.reservationId)
  return bestEffort(job, (e) => log.info(`TTLock: no se procesó la asignación de habitación de la reserva ${data.reservationId}: ${errMsg(e)}`))
}

export function reservasTtlockConnector(ctx: ConnectorContext, logger?: InfoLogger): void {
  const log = logger ?? fallbackLog
  const expireBestEffort = (reservationId: string) =>
    bestEffort(expireCodes(ctx, reservationId), (e) => log.info(`TTLock: no se expiraron los códigos de la reserva ${reservationId}: ${errMsg(e)}`))
  const reservas = ctx.resolveModule<ReservasModule>('reservas')
  reservas.setSockets({
    onReservationCheckedOut: (data: { reservationId: string }) => expireBestEffort(data.reservationId),
    // C-1: cancelar = sin acceso físico. La idempotencia de cancel-core (no re-emite el
    // evento si ya estaba cancelada) evita el doble procesado.
    onReservationCancelled: (data: { reservationId: string }) => expireBestEffort(data.reservationId),
    onRoomAssigned: (data: RoomAssignedEvent) => handleRoomAssigned(ctx, log, data),
  })
}
