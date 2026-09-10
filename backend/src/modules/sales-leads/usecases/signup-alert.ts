// sales-leads/usecases/signup-alert.ts — REQ-PIPE-04 (#145): avisar a ventas de un alta, ya.
//
// Lo dispara `subscriptions.onHotelSignedUp` (vía `connectors/subscriptions-sales-alert.ts`) en
// la MISMA petición del alta. Es best-effort de punta a punta: nada de lo que pase acá puede
// llegar al alta — el hotel ya está creado y la respuesta ya es 201. Un fallo se loguea; sin log
// un SMTP caído deja a ventas sin enterarse y a nadie sabiendo por qué (misma regla que #27).
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { buildSignupAlertEmail, signupWhatsappText } from './emails'
import { whatsappUrlFor } from './pipeline'
import { resolvePlatformIdentity } from '../../../shared/utils/platform-identity'

/** `email_queue.relatedType` del aviso de alta: por acá se rastrea si ventas fue avisado. */
export const SIGNUP_ALERT_RELATED_TYPE = 'sales-pipeline:signup'

export interface SignupAlertEmailPort {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }): Promise<string>
}

export interface SignupAlertDeps {
  /** Ausente ⇒ no se encola (se avisa por log). Lo cablea email-bootstrap con `setEmailDeps`. */
  emailSender?: SignupAlertEmailPort
  /** `plans` — solo para escribir el NOMBRE del plan; sin repo va el id crudo. */
  plansRepo?: RepositoryAdapter<any>
  /** KV `configuration` — de acá sale el nombre de la plataforma del texto de WhatsApp. Sin repo, default. */
  configRepo?: Pick<RepositoryAdapter<any>, 'findOne'>
  /** Casilla de ventas (SALES_LEADS_ADMIN_EMAIL). */
  to: string
  /** `hotelId` con el que se encola: scope plataforma. */
  platformHotelId: string
  /** Base pública del panel (PUBLIC_URL) para el link a `/admin/leads-ventas`. */
  appUrl: string
  logger: Logger
}

export interface SignedUpHotelInput { id: string; name: string; email: string; phone?: string | null; country?: string | null }
export interface SignedUpOwnerInput { id: string; name: string; email: string }

export async function notifySignup(
  deps: SignupAlertDeps,
  hotel: SignedUpHotelInput,
  owner: SignedUpOwnerInput,
  planId: string,
): Promise<void> {
  if (!deps.emailSender) {
    deps.logger.warn('sales-leads: alta sin emailSender — el aviso a ventas NO se encoló', { hotelId: hotel.id })
    return
  }
  try {
    const [planName, identity] = await Promise.all([
      planNameOf(deps.plansRepo, planId),
      resolvePlatformIdentity(deps.configRepo ?? { findOne: async () => null }),
    ])
    const e164Url = whatsappUrlFor(hotel.phone, hotel.country)
    const whatsappUrl = e164Url
      ? `${e164Url}?text=${encodeURIComponent(signupWhatsappText(owner.name, hotel.name, identity.platformName))}`
      : null
    const mail = buildSignupAlertEmail({
      hotelId: hotel.id, hotelName: hotel.name, ownerName: owner.name, email: owner.email || hotel.email,
      phone: hotel.phone ?? null, country: hotel.country ?? null, planName, appUrl: deps.appUrl, whatsappUrl,
    })
    await deps.emailSender.enqueue({
      to: deps.to, subject: mail.subject, html: mail.html,
      hotelId: deps.platformHotelId, relatedType: SIGNUP_ALERT_RELATED_TYPE, relatedId: hotel.id,
    })
    deps.logger.info('sales-leads: aviso de alta encolado a ventas', { hotelId: hotel.id, whatsapp: !!whatsappUrl })
  } catch (e) {
    deps.logger.error('sales-leads: falló el aviso de alta a ventas', { error: (e as Error).message, hotelId: hotel.id })
  }
}

/** Nombre del plan para el correo. `null` si no eligió; el id crudo si no se pudo resolver. */
async function planNameOf(plansRepo: RepositoryAdapter<any> | undefined, planId: string): Promise<string | null> {
  if (!planId) return null
  if (!plansRepo) return planId
  try {
    const plan = await plansRepo.findOne({ id: planId })
    return plan?.name ? String(plan.name) : planId
  } catch {
    return planId
  }
}
