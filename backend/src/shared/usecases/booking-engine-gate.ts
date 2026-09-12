// shared/usecases/booking-engine-gate.ts — UN SOLO interruptor del motor de reservas público
// (#276 MR-11).
//
// Antes cada endpoint `/api/public/...` del motor decidía por su cuenta si el hotel "estaba
// abierto": los GET miraban `hotels.onlineBookingStatus`, `/rates` y los dos POST miraban además
// `booking_config.enabled`, y los POST respondían un body distinto ('Hotel no encontrado' vs
// 'Hotel not found'). Resultado: un hotel pausado por la plataforma seguía aceptando POST
// directos, y el body distinto revelaba qué gate había cortado. Este helper es la ÚNICA fuente
// de verdad; todos los handlers públicos del motor lo llaman y responden el MISMO 404.
//
// Los DOS flags que componen el interruptor:
//
//  - `hotels.onlineBookingStatus` — flag de PLATAFORMA. Lo pone el super-admin al dar de alta,
//    pausar o dar de baja el hotel ('active' | 'paused' | 'inactive' | …). Sólo 'active' abre.
//  - `booking_config.enabled` — flag del HOTEL. Es el toggle "Activo/Inactivo" que el propio
//    hotel maneja en `/panel/booking-engine`. Default `true`: un hotel SIN fila en
//    `booking_config` (nunca tocó esa pantalla) está abierto; sólo `enabled === false` cierra.
//
// Función PURA (sin I/O): cada caller carga `hotel` y `bookingConfig` con sus repos y pasa las
// filas. Vive en `shared/` porque la regla la comparten varios usecases de `bookingengine` y
// no debe divergir entre ellos (molde `shared/usecases/room-status.ts`).

/** Forma mínima que el gate necesita del hotel. `null` = no existe → cerrado. */
export interface EngineGateHotel {
  onlineBookingStatus?: string | null
  [k: string]: unknown
}

/** Forma mínima que el gate necesita de `booking_config`. `null` = sin fila → abierto. */
export interface EngineGateBookingConfig {
  enabled?: boolean | null
  [k: string]: unknown
}

/**
 * Body del 404 cuando el motor está cerrado. Anti-enumeración: el MISMO para "el hotel no
 * existe", "la plataforma lo pausó" y "el hotel apagó su motor" — desde afuera no se distingue.
 */
export const ENGINE_CLOSED_BODY: { error: string } = Object.freeze({ error: 'Hotel not found' })

/**
 * `true` sólo si AMBOS flags abren: `hotel.onlineBookingStatus === 'active'` (plataforma) y
 * `bookingConfig.enabled !== false` (hotel; sin fila = abierto).
 */
export function isEngineOpen(
  hotel: EngineGateHotel | null | undefined,
  bookingConfig: EngineGateBookingConfig | null | undefined,
): boolean {
  return hotel?.onlineBookingStatus === 'active' && bookingConfig?.enabled !== false
}

/** Respuesta `{status, body}` estándar de los handlers públicos cuando el motor está cerrado. */
export function engineClosed(): { status: 404; body: { error: string } } {
  return { status: 404, body: { ...ENGINE_CLOSED_BODY } }
}
