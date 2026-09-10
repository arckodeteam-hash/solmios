// platform-emails/controller.ts — Adaptador HTTP del módulo Platform Emails.

import type { HttpRequest, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
// `validateSchema` sale de shared/validate-body (superset del framework, soporta `type:'text'`
// sin aplastar saltos de línea) — mismo import que messages/controller.ts.
import { validateSchema } from '../../shared/validators/validate-body'
import type { PlatformEmailsService } from './service'
import { UpdatePlatformEmailTemplateSchema, SendTestEmailSchema } from './validators/schema'

/** Variables de ejemplo por evento — solo para el botón "Enviar prueba" del admin. */
const SAMPLE_VARIABLES: Record<string, Record<string, string>> = {
  welcome: { hotel_name: 'Hotel de Prueba', link: 'https://ejemplo.com/panel/dashboard' },
  trial_ending: { hotel_name: 'Hotel de Prueba', days_left: '2', link: 'https://ejemplo.com/panel/suscripcion' },
  trial_expired: { hotel_name: 'Hotel de Prueba', link: 'https://ejemplo.com/panel/suscripcion' },
  payment_succeeded: { hotel_name: 'Hotel de Prueba', plan_name: 'Professional', amount: '$123', link: 'https://ejemplo.com/panel/suscripcion' },
  payment_failed: { hotel_name: 'Hotel de Prueba', plan_name: 'Professional', amount: '$123', link: 'https://ejemplo.com/panel/suscripcion' },
  subscription_canceled: { hotel_name: 'Hotel de Prueba', link: 'https://ejemplo.com/panel/suscripcion' },
  subscription_renewal_auto: { hotel_name: 'Hotel de Prueba', days_left: '3', link: 'https://ejemplo.com/panel/suscripcion' },
  subscription_renewal_manual: { hotel_name: 'Hotel de Prueba', days_left: '3', link: 'https://ejemplo.com/panel/suscripcion' },
  subscription_suspended: { hotel_name: 'Hotel de Prueba', link: 'https://ejemplo.com/panel/suscripcion' },
  subscription_reactivated: { hotel_name: 'Hotel de Prueba', link: 'https://ejemplo.com/panel/dashboard' },
  trial_extended: { hotel_name: 'Hotel de Prueba', days_left: '7', platform_name: 'SolmiOS', link: 'https://ejemplo.com/panel/dashboard' },
  // REQ-PIPE-08/09 (#149/#150): secuencia de activación y rescate.
  activation_no_rooms: { hotel_name: 'Hotel de Prueba', platform_name: 'SolmiOS', support_email: 'soporte@ejemplo.com', support_phone: '809-555-0000', link: 'https://ejemplo.com/panel/habitaciones' },
  activation_no_rates: { hotel_name: 'Hotel de Prueba', platform_name: 'SolmiOS', support_email: 'soporte@ejemplo.com', support_phone: '809-555-0000', link: 'https://ejemplo.com/panel/tarifas' },
  activation_no_channel: { hotel_name: 'Hotel de Prueba', platform_name: 'SolmiOS', support_email: 'soporte@ejemplo.com', support_phone: '809-555-0000', link: 'https://ejemplo.com/panel/canales' },
  trial_offer: { hotel_name: 'Hotel de Prueba', days_left: '3', platform_name: 'SolmiOS', support_email: 'soporte@ejemplo.com', support_phone: '809-555-0000', link: 'https://ejemplo.com/panel/suscripcion' },
  trial_rescue_1: { hotel_name: 'Hotel de Prueba', platform_name: 'SolmiOS', support_email: 'soporte@ejemplo.com', support_phone: '809-555-0000', link: 'https://ejemplo.com/panel/suscripcion' },
  trial_rescue_2: { hotel_name: 'Hotel de Prueba', platform_name: 'SolmiOS', support_email: 'soporte@ejemplo.com', support_phone: '809-555-0000', link: 'https://ejemplo.com/panel/suscripcion' },
}
// `platform_name`/`support_email`/`support_phone` NO van acá: las agrega el service desde
// Configuración → Plataforma, así la prueba muestra exactamente lo que va a salir.

export class PlatformEmailsController {
  constructor(
    private readonly service: PlatformEmailsService,
    private readonly logger: Logger,
  ) {}

  async index() {
    const items = await this.service.list()
    return { status: 200, body: items }
  }

  async show(req: HttpRequest) {
    const item = await this.service.get(req.params.event)
    if (!item) throw new NotFoundError(`No hay plantilla para el evento "${req.params.event}"`)
    return { status: 200, body: item }
  }

  async update(req: HttpRequest) {
    const data = validateSchema(UpdatePlatformEmailTemplateSchema, req.body) as {
      subject?: string; body?: string; isActive?: boolean
    }
    if (data.subject === undefined && data.body === undefined && data.isActive === undefined) {
      throw new ValidationError('Nada para actualizar: mandá subject, body o isActive')
    }
    const item = await this.service.update(req.params.event, data)
    return { status: 200, body: item }
  }

  async sendTest(req: HttpRequest) {
    const { to } = validateSchema(SendTestEmailSchema, req.body) as { to: string }
    const event = req.params.event
    const variables = SAMPLE_VARIABLES[event] ?? {}
    const result = await this.service.sendEvent(event, to, 'test', variables)
    return { status: 200, body: result }
  }
}
