// abandon-recovery/index.ts — PUERTA PÚBLICA (F3, task 3.14).
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Módulo cron-only: recupera reservas abandonadas enviándoles un email con link al widget.
// NO tiene tabla propia, NO tiene rutas HTTP, NO tiene controller/validators/sockets/model.
// Su única responsabilidad es exponer el `AbandonRecoveryService.runSweep()` que el cron
// (`shared/usecases/abandon-recovery-cron.ts`) invoca cada 30 min desde composition-root.
//
// El wiring del cron vive en `shared/usecases/` (mismo molde que currency-rates-cron /
// external-reviews-cron) porque NO hay orden-de-carga con otros módulos: solo lee
// `reservations` + `guests` + `hotels` (todos modelos compartidos). Si mañana necesitara
// rutas admin (ej. "ver historial de emails mandados"), se agrega controller acá; hoy no
// aporta valor y evita crecer el archivo.
//
// Anti-patrón ORM (D5): `abandonEmailSent` está declarado en `ReservasModel` (reservas/model.ts).
// Si se olvidara esa declaración, el ORM descarta el campo al hacer `update()` y el flag
// quedaría en false forever → re-envío infinito de emails cada 30 min. Memoria 1805.

import { createModule, OrmRepository } from 'arckode-framework'
import { AbandonRecoveryService } from './service'
import type { AbandonRecoveryDeps } from './service'
import type { AbandonEmailSender, AbandonSweepResult, AbandonSweepConfig, GatewayConfiguredCheck } from './types'
import {
  DEFAULT_ABANDON_MIN_AGE_MS,
  DEFAULT_ABANDON_MAX_AGE_MS,
  DEFAULT_PENDING_TTL_MINUTES,
} from './types'
import { buildRecoveryLink, renderAbandonEmailHtml, emailSubject, formatPendingTtl } from './usecases/template'
import { registerAbandonRecoveryModels } from './model'

export { AbandonRecoveryService }
export { buildRecoveryLink, renderAbandonEmailHtml, emailSubject, formatPendingTtl }
export type { AbandonRecoveryDeps, AbandonSweepResult, AbandonSweepConfig, AbandonEmailSender, GatewayConfiguredCheck }
export {
  DEFAULT_ABANDON_MIN_AGE_MS,
  DEFAULT_ABANDON_MAX_AGE_MS,
  DEFAULT_PENDING_TTL_MINUTES,
}
export { registerAbandonRecoveryModels }

export interface AbandonRecoveryModuleOpts {
  /** EmailService (inyectado post-init desde email-bootstrap para evitar orden-de-carga). */
  email?: AbandonEmailSender
  /** #266: check de pasarela del hotel. Normalmente se inyecta post-init con
   *  `service.setGatewayCheck(fn)` desde composition-root (mismo patrón que `setEmail`):
   *  el módulo de pagos se resuelve después de registrar éste. */
  isGatewayConfigured?: GatewayConfiguredCheck
  /** Override de la ventana de abandono (tests). Default: 1h–4h. */
  sweepConfig?: Partial<AbandonSweepConfig>
}

export function AbandonRecoveryModule(opts: AbandonRecoveryModuleOpts = {}) {
  return createModule({
    name: 'abandon-recovery',
    version: '1.0.0',
    description: 'Cron de recuperación de reservas abandonadas (F3 3.14)',

    contract: {
      name: 'abandon-recovery',
      version: '1.0.0',
      description: 'Sweep periódico de reservas pending → email con link al widget',
      actions: ['runSweep', 'setEmail', 'setGatewayCheck', 'setSweepConfig'],
      events: [],
      // NO tiene tabla propia: es dueño del FLAG `abandonEmailSent` en reservations.
      tables: [],
      dependencies: [],
      rules: [
        'NO tiene tabla propia: es dueño del flag reservations.abandonEmailSent',
        'Cron-only: sin rutas HTTP (la exposición admin se agrega en F4 si hace falta)',
        'Idempotente: marca abandonEmailSent=true solo si el email se encoló con éxito',
        'NO marca flag para reservas sin accessToken (creadas desde panel, no son abandono público)',
        'Ventana 1h–4h: antes molesta al cliente que está decidiendo; después es pérdida',
        'No manda el correo si la reserva ya venció (reservations.paymentDeadlineAt < now; sin deadline → createdAt + booking_config.pendingTtlMinutes, #266)',
        'No manda el correo si el hotel no tiene pasarela de pago (dep isGatewayConfigured, inyectado post-init vía setGatewayCheck, #266)',
        'El texto del correo usa el TTL real del hotel ("vence ... en N minutos"), no un valor fijo (#266)',
      ],
    },

    create({ logger, orm }: { logger: any; orm: any }) {
      // No-op por diseño (ver model.ts): el único estado del módulo es el flag en `reservations`,
      // cuyo schema es dueño el módulo reservas. Llamamos al register para explícitar la
      // estructura canónica del framework y que el analyzer vea el wiring.
      registerAbandonRecoveryModels(orm)
      const log = logger.child('abandon-recovery')
      const reservationsRepo = new OrmRepository<any>(orm, 'Reservations')
      const guestsRepo = new OrmRepository<any>(orm, 'Guests')
      const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')

      const deps: AbandonRecoveryDeps = {
        reservations: reservationsRepo,
        guests: guestsRepo,
        hotels: hotelsRepo,
        email: opts.email ?? null as AbandonEmailSender | null,
        // #266: tabla compartida (registrada por bookingengine/model.ts) — sólo lectura del TTL.
        bookingConfig: new OrmRepository<any>(orm, 'BookingConfig'),
        isGatewayConfigured: opts.isGatewayConfigured ?? null,
      }
      const sweepConfig: AbandonSweepConfig = {
        minAgeMs: opts.sweepConfig?.minAgeMs ?? DEFAULT_ABANDON_MIN_AGE_MS,
        maxAgeMs: opts.sweepConfig?.maxAgeMs ?? DEFAULT_ABANDON_MAX_AGE_MS,
        publicBaseUrl: opts.sweepConfig?.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? '',
      }
      const service = new AbandonRecoveryService(deps, log, sweepConfig)

      log.info('Módulo abandon-recovery listo (cron-only)')
      return service
    },
  })
}
