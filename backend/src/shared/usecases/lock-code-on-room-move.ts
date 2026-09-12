// shared/usecases/lock-code-on-room-move.ts — Cambio de habitación con código TTLock vigente.
//
// Lo llama `connectors/reservas-ttlock.ts` cuando `onRoomAssigned` trae `previousRoomId` distinto
// (reasignación). Vive acá y no en el connector para que el connector sólo wiree (regla del
// analyzer: los conectores no deciden).
//
// `generateCode` del módulo ttlock crea el PIN en la cerradura NUEVA y recién después revoca los
// anteriores (`keepSingleCode`): para "Regenerar" en la misma habitación es el contrato correcto
// (nunca se queda sin código). Al REASIGNAR ese contrato no alcanza: si la cerradura nueva
// rechaza el PIN, el viejo seguía abriendo la habitación ANTERIOR, que ya no es de este huésped y
// se puede vender a otro. Acá la prioridad es la seguridad de la unidad que se libera: el código
// anterior se expira aunque el nuevo haya fallado, y la reserva queda SIN código con un error
// explícito en el log para que recepción genere uno a mano.

export interface LockCodeMovePorts {
  generateCode: (hotelId: string, reservationId: string) => Promise<unknown>
  expireCodesByReservation: (reservationId: string) => Promise<void>
}

export interface LockCodeMoveEvent {
  reservationId: string
  hotelId: string
  roomId: string | null
  previousRoomId: string | null
}

export type ErrorLogger = { error: (msg: string, meta?: any) => unknown }

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function replaceLockCodeOnRoomMove(ttlock: LockCodeMovePorts, log: ErrorLogger, data: LockCodeMoveEvent): Promise<void> {
  try {
    await ttlock.generateCode(data.hotelId, data.reservationId)
    return
  } catch (e) {
    log.error(`TTLock: la cerradura de ${data.roomId} rechazó el PIN de la reserva ${data.reservationId}: ${errMsg(e)}. Se revoca el de ${data.previousRoomId}: la reserva queda SIN código, generar uno a mano`)
  }
  try {
    await ttlock.expireCodesByReservation(data.reservationId)
  } catch (e) {
    log.error(`TTLock: tampoco se pudo revocar el código anterior de la reserva ${data.reservationId} (habitación ${data.previousRoomId}): ${errMsg(e)} — el PIN viejo SIGUE ABRIENDO esa puerta`)
  }
}
