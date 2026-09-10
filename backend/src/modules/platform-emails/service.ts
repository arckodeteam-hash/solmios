// platform-emails/service.ts — Plantillas editables de los 6 correos de PLATAFORMA.
//
// El service recibe `RepositoryAdapter<T>`, nunca el ORM (regla cardinal de services). El sender
// de email se inyecta post-construcción (`setEmailDeps`), mismo patrón que
// `usuarios/service.ts:setEmailVerificationDeps` — el bootstrap de email lo cablea después de
// crear todos los módulos, así que no puede ir en el constructor.

import { NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { renderTemplate } from '../../services/notification-renderer'
import type { PlatformEmailTemplateDTO, UpdatePlatformEmailTemplateDTO, PlatformEmailSender, PlatformEmailEvent } from './types'

export class PlatformEmailsService {
  private sender?: PlatformEmailSender

  constructor(private readonly repo: RepositoryAdapter<PlatformEmailTemplateDTO>) {}

  /** Cablea el envío. Lo llama el bootstrap de email (best-effort, puede no estar seteado nunca). */
  setEmailDeps(sender: PlatformEmailSender): void {
    this.sender = sender
  }

  list(): Promise<PlatformEmailTemplateDTO[]> {
    return this.repo.findMany()
  }

  get(event: string): Promise<PlatformEmailTemplateDTO | null> {
    return this.repo.findOne({ event })
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

    // El subject NO es HTML (fix H2, mismo criterio que NotificationRenderer.resolveAndRender):
    // 'Bed & Breakfast' no debe llegar como 'Bed &amp; Breakfast'.
    const subject = renderTemplate(template.subject, variables, false)
    const html = renderTemplate(template.body, variables, true)

    await this.sender.enqueue({
      to, subject, html, hotelId,
      relatedType: `platform_email:${event as PlatformEmailEvent}`,
      // `relatedId` = hotel destinatario (REQ-PIPE-08): la cola queda consultable por hotel.
      relatedId: hotelId,
    })
    return { sent: true }
  }
}
