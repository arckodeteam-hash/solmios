// admin/usecases/extend-trial.ts — REQ-PIPE-05 (#146): el super-admin le da más días de prueba a un hotel.
//
// La extensión en sí (fila `subscriptions`, correo `trial_extended`) vive en `subscriptions`; acá
// solo se delega al puerto que inyecta el connector `admin-subscriptions-trial` y se deja rastro
// en `audit_log` con el `userId` del admin. Sin puerto cableado se tira (el controller responde
// 503) — nunca un falso éxito.
import type { Logger } from 'arckode-framework'
import { auditSafely, trialExtendEntry, type Actor, type AuditPort } from './audit'

/** Lo que devuelve `subscriptions.extendTrial()` (subscriptions/usecases/extend-trial.ts) — copiado, no importado. */
export interface ExtendTrialOutcome {
  subscription: any
  daysLeft: number
  previousTrialEndsAt: string | null
  emailSent: boolean
}

export interface TrialPort {
  extendTrial(hotelId: string, days: number): Promise<ExtendTrialOutcome>
}

/** Falta el connector `admin-subscriptions-trial`: el controller lo mapea a 503 por TIPO, no por texto. */
export class TrialPortUnavailableError extends Error {
  readonly httpStatus = 503
  constructor() {
    super('Extender trial no disponible: falta el connector admin-subscriptions-trial')
    this.name = 'TrialPortUnavailableError'
  }
}

export interface ExtendTrialAuditedDeps {
  trialPort: TrialPort | null
  auditPort: AuditPort | null
  logger: Logger
}

export async function extendTrialAudited(
  deps: ExtendTrialAuditedDeps,
  hotelId: string,
  days: number,
  user?: Actor,
): Promise<ExtendTrialOutcome> {
  if (!deps.trialPort) throw new TrialPortUnavailableError()
  const result = await deps.trialPort.extendTrial(hotelId, days)
  await auditSafely(deps.auditPort, deps.logger, trialExtendEntry({
    hotelId, days, previousTrialEndsAt: result.previousTrialEndsAt, trialEndsAt: result.subscription?.trialEndsAt,
  }, user))
  return result
}
