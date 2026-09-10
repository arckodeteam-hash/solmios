// services/notification-renderer.ts — Política de render de plantillas de notificación (SRP).
//
// Responsabilidad ÚNICA: dado (hotelId, event, language, variables), resolver la plantilla
// [override del hotel en auto_messages > default de código (mismo idioma) > fallback 'es']
// y renderizar los placeholders. NO encola ni envía — eso es infraestructura (EmailService).
//
// Extraído de EmailService para que este quede como adapter puro (cola + providers SMTP/Resend),
// reduciendo el God Object (spec 11.1.6 refactor SOLID).

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { getCodeDefault } from './notification-defaults'
import type { NotificationEvent, NotificationLanguage } from './notification-defaults'

/** Subtipo mínimo de auto_messages (override de plantilla por hotel). Exportado para tipar el repo en composition-root. */
export interface AutoMessageTemplateRow {
  emailSubject?: string | null
  emailBody?: string | null
}

const PLACEHOLDER_RE = /\{(\w+)\}/g

/** Escapa HTML en valores interpolados (defensa XSS si el HTML se re-muestra en una vista web). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Reemplaza placeholders `{key}` por su valor en `variables`.
 * - Si la key ESTÁ en variables (aunque sea '') → reemplaza.
 * - Si NO está → deja el placeholder literal (no rompe).
 * - `escape=true` (default): escapa HTML en strings (para bodies HTML).
 * - `escape=false`: texto plano (para subjects de email, que NO son HTML — fix H2).
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number>,
  escape = true,
): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (!(key in variables)) return match
    const v = variables[key]
    if (v === null || v === undefined) return ''
    const str = String(v)
    return typeof v === 'string' && escape ? escapeHtml(str) : str
  })
}

export interface RenderInput {
  hotelId: string
  event: NotificationEvent
  language: NotificationLanguage
  variables: Record<string, string | number>
}

export interface RenderedNotification {
  subject: string
  html: string
}

/**
 * Resuelve y renderiza una plantilla por (hotelId, event, language).
 * Un override parcial del hotel (falta subject o body) se descarta entero (no se mezcla con el default).
 */
export class NotificationRenderer {
  constructor(
    /** Repo de auto_messages para override por hotel. null → solo defaults de código. */
    private readonly templateRepo: RepositoryAdapter<AutoMessageTemplateRow> | null = null,
    private readonly logger?: Logger,
  ) {}

  async resolveAndRender(input: RenderInput): Promise<RenderedNotification> {
    const { subject, body } = await this.resolveTemplate(input.hotelId, input.event, input.language)
    return {
      // El subject es texto plano (no HTML): se renderiza SIN escape (fix H2 —
      // 'Bed & Breakfast' no debe llegar al cliente como 'Bed &amp; Breakfast').
      subject: renderTemplate(subject, input.variables, false),
      html: this.applyLogo(renderTemplate(body, input.variables, true), input.variables),
    }
  }

  /**
   * Branding (spec 11.1.5): si llega `logo_url` (hotel.logo), reemplaza el emoji 🏨 del
   * header por el logo real. Un único punto de transformación — evita tocar las 15 plantillas.
   * Sin logo_url → deja el emoji (default). Reemplaza solo la primera ocurrencia (header).
   */
  private applyLogo(html: string, variables: Record<string, string | number>): string {
    const logo = String(variables.logo_url || '').trim()
    // logo_url lo controla el merchant (hotel.logo). Sin validar, un logo `x"><script>...` hacía
    // attribute breakout → XSS en los emails a sus huéspedes. Solo se admiten URLs http(s), y aun
    // así se escapa antes de meterla en el atributo.
    if (!/^https?:\/\//i.test(logo)) return html
    return html.replace('🏨 ', `<img src="${escapeHtml(logo)}" alt="logo" style="height:36px;vertical-align:middle"> `)
  }

  private async resolveTemplate(
    hotelId: string,
    event: NotificationEvent,
    language: NotificationLanguage,
  ): Promise<{ subject: string; body: string }> {
    if (this.templateRepo) {
      try {
        const row = await this.templateRepo.findOne({
          hotelId, event, channel: 'email', language, isActive: 1,
        } as Record<string, unknown>) as AutoMessageTemplateRow | null
        if (row && row.emailSubject && row.emailBody) {
          return { subject: row.emailSubject, body: row.emailBody }
        }
      } catch (e) {
        this.logger?.warn('NotificationRenderer: override lookup falló, usando default de código', { event, language, error: (e as Error).message })
      }
    }
    return getCodeDefault(event, language)
  }
}
