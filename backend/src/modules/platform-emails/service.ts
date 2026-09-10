// platform-emails/service.ts — Plantillas editables de los 6 correos de PLATAFORMA.
//
// El service recibe `RepositoryAdapter<T>`, nunca el ORM (regla cardinal de services). El sender
// de email se inyecta post-construcción (`setEmailDeps`), mismo patrón que
// `usuarios/service.ts:setEmailVerificationDeps` — el bootstrap de email lo cablea después de
// crear todos los módulos, así que no puede ir en el constructor.

import { NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { renderTemplate } from '../../services/notification-renderer'
import {
  PLATFORM_EMAIL_VARIABLES,
  DEFAULT_PLATFORM_IDENTITY,
  platformEmailVariables,
  resolvePlatformIdentity,
} from '../../shared/utils/platform-identity'
import type { PlatformEmailTemplateDTO, UpdatePlatformEmailTemplateDTO, PlatformEmailSender, PlatformEmailEvent } from './types'

type ConfigRepo = Pick<RepositoryAdapter<Record<string, unknown>>, 'findOne'>

export class PlatformEmailsService {
  private sender?: PlatformEmailSender

  /**
   * `configRepo` es la tabla `configuration`: de ahí sale el nombre de la plataforma y el contacto
   * de soporte que el super-admin carga en Configuración → Plataforma. Opcional para no romper a
   * quien construye el service sin config (tests): sin él se usan los defaults.
   */
  constructor(
    private readonly repo: RepositoryAdapter<PlatformEmailTemplateDTO>,
    private readonly configRepo?: ConfigRepo,
  ) {}

  /** Cablea el envío. Lo llama el bootstrap de email (best-effort, puede no estar seteado nunca). */
  setEmailDeps(sender: PlatformEmailSender): void {
    this.sender = sender
  }

  async list(): Promise<PlatformEmailTemplateDTO[]> {
    const rows = await this.repo.findMany()
    return rows.map(withPlatformVariables)
  }

  async get(event: string): Promise<PlatformEmailTemplateDTO | null> {
    const row = await this.repo.findOne({ event })
    return row ? withPlatformVariables(row) : null
  }

  /** Variables globales (`platform_name`, `support_email`, `support_phone`) para cualquier envío. */
  async platformVariables(): Promise<Record<string, string>> {
    const identity = this.configRepo
      ? await resolvePlatformIdentity(this.configRepo)
      : { ...DEFAULT_PLATFORM_IDENTITY }
    return platformEmailVariables(identity)
  }

  async update(event: string, patch: UpdatePlatformEmailTemplateDTO): Promise<PlatformEmailTemplateDTO> {
    const row = await this.repo.findOne({ event })
    if (!row) throw new NotFoundError(`No hay plantilla para el evento "${event}"`)
    const updated = await this.repo.update(row.id, patch)
    return updated as PlatformEmailTemplateDTO
  }

  /**
   * Envía el correo de un evento del ciclo de vida SaaS. NUNCA tira: sin plantilla, inactiva, sin
   * destinatario o sin sender inyectado → `{sent:false}` silencioso (mismo criterio que
   * `resendVerificationEmail` en usuarios — un email transaccional que falla no puede romper el
   * flujo que lo dispara: signup, webhook de Stripe, cron de trial).
   */
  async sendEvent(
    event: string,
    to: string,
    hotelId: string,
    variables: Record<string, string>,
  ): Promise<{ sent: boolean }> {
    if (!to || !this.sender) return { sent: false }
    const template = await this.repo.findOne({ event })
    if (!template || !template.isActive) return { sent: false }

    // Las variables de plataforma van debajo de las del evento: quien dispara el envío puede
    // pisarlas, pero nunca queda un `{platform_name}` sin resolver en el correo.
    const vars = { ...(await this.platformVariables()), ...variables }

    // El subject NO es HTML (fix H2, mismo criterio que NotificationRenderer.resolveAndRender):
    // 'Bed & Breakfast' no debe llegar como 'Bed &amp; Breakfast'.
    const subject = renderTemplate(template.subject, vars, false)
    const html = renderTemplate(template.body, vars, true)

    await this.sender.enqueue({
      to, subject, html, hotelId,
      relatedType: `platform_email:${event as PlatformEmailEvent}`,
    })
    return { sent: true }
  }
}

/**
 * `variables` es el hint que la UI muestra como "variables disponibles". Las globales se agregan
 * en la respuesta y no en la fila: así una plantilla sembrada antes de que existieran (o editada
 * a mano) también las ofrece, sin migrar datos.
 */
function withPlatformVariables(row: PlatformEmailTemplateDTO): PlatformEmailTemplateDTO {
  let own: string[] = []
  try {
    const parsed = JSON.parse(row.variables || '[]')
    own = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch { own = [] }
  const merged = [...own, ...PLATFORM_EMAIL_VARIABLES.filter((v) => !own.includes(v))]
  return { ...row, variables: JSON.stringify(merged) }
}
