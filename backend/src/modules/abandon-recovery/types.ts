// abandon-recovery/types.ts — Tipos del módulo (F3, task 3.14).
//
// El módulo NO tiene tabla propia: lee/escribe la tabla `reservations` (campo
// `abandonEmailSent`, agreggado por la migración + declarado en el modelo ORM de reservas).
// Por eso no hay AbandonRecoveryDTO ni modelos propios.

/** Resultado de un sweep del cron — para log + telemetría. */
export interface AbandonSweepResult {
  /** Total de reservas candidatas encontradas en la ventana (pending, 1h-4h, flag false). */
  scanned: number
  /** Emails encolados efectivamente. Equivale a `scanned` menos los que fallaron al encolar. */
  emailed: number
  /** Reservas que se saltaron (no tenían accessToken, no tenían email del guest, etc.). */
  skipped: number
  /** Errores por reserva (una entrada por reserva que falló al encolar). Para log warn. */
  errors: Array<{ reservationId: string; reason: string }>
}

/** Interface del EmailService que el módulo necesita (subset de EmailService real). */
export interface AbandonEmailSender {
  /**
   * Encola un email para envío async por el worker. Mismo método que usan reservas/payroll/
   * opiniones. Devuelve `sent` (bool) — si el encolado falla, el cron NO marca el flag y
   * reintenta en el próximo tick.
   */
  enqueue?(to: string, subject: string, html: string, opts?: Record<string, unknown>): Promise<{ sent: boolean }>
  send?(to: string, subject: string, html: string, opts?: Record<string, unknown>): Promise<{ sent: boolean }>
}

/** Config del sweep — inyectable para tests (default hardcoded en el factory). */
export interface AbandonSweepConfig {
  /** Edad mínima de la reserva para considerar abandonada (ms). Default 1h. */
  minAgeMs: number
  /** Edad máxima de la reserva para considerarla abandonada (ms). Default 4h. */
  maxAgeMs: number
  /** Base pública para construir el link de recuperación. Default = process.env.PUBLIC_BASE_URL. */
  publicBaseUrl: string
}

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE

/** Ventana de abandono: entre 1h (no molestar al cliente que recién abre el widget) y 4h
 *  (más allá ya no es "abandono recuperable", es pérdida de interés). Tunable vía config. */
export const DEFAULT_ABANDON_MIN_AGE_MS = MS_PER_HOUR          // 1h
export const DEFAULT_ABANDON_MAX_AGE_MS = 4 * MS_PER_HOUR      // 4h

/** TTL de pago por defecto (minutos) cuando el hotel no tiene fila en booking_config o la
 *  columna `pendingTtlMinutes` es null (filas previas a #266). Mismo valor que
 *  `DEFAULT_PENDING_TTL_MINUTES` de `bookingengine/usecases/config.ts` — se duplica a
 *  propósito: no se importa entre módulos. Rango válido del admin: 15–1440. */
export const DEFAULT_PENDING_TTL_MINUTES = 60

/** Check de pasarela de pago del hotel (#266). Inyectado post-init desde composition-root
 *  (mismo patrón que el EmailService): si devuelve false, el hotel no puede cobrar online y
 *  el link "completá tu reserva" no lleva a ningún checkout → el sweep no encola el correo. */
export type GatewayConfiguredCheck = (hotelId: string) => Promise<boolean>
