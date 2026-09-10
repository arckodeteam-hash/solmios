// sales-leads/usecases/lead-notify.ts — Correos del formulario público: acuse al lead + aviso a ventas.
//
// Best-effort de punta a punta: un fallo de email NUNCA rompe el envío del formulario — el lead ya
// quedó guardado en DB. Cada correo se intenta por separado: que falle el acuse no deja a ventas
// sin enterarse. Extraído del service (límite de 200 líneas del analyzer); misma lógica.
import type { Logger } from 'arckode-framework'
import type { SalesLeadDTO } from '../types'
import { buildAckEmail, buildAdminAlertEmail } from './emails'

export interface LeadNotifyEmailPort {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }): Promise<string>
}

export interface LeadNotifyDeps {
  /** Ausente ⇒ no se manda nada (el lead igual quedó guardado). */
  emailSender?: LeadNotifyEmailPort
  /** Casilla de ventas (SALES_LEADS_ADMIN_EMAIL). */
  to: string
  /** `hotelId` con el que se encola: scope plataforma. */
  platformHotelId: string
  logger: Logger
}

export async function notifyLead(deps: LeadNotifyDeps, item: SalesLeadDTO): Promise<void> {
  if (!deps.emailSender) return
  try {
    const ack = buildAckEmail({ fullName: item.fullName })
    await deps.emailSender.enqueue({
      to: item.email, subject: ack.subject, html: ack.html,
      hotelId: deps.platformHotelId, relatedType: 'sales-lead', relatedId: item.id,
    })
  } catch (e) {
    deps.logger.error('sales-leads: falló el acuse de recibo por email', { error: (e as Error).message, id: item.id })
  }
  try {
    const alert = buildAdminAlertEmail({
      fullName: item.fullName, email: item.email, phone: item.phone, hotelName: item.hotelName,
      roomsRange: item.roomsRange, message: item.message, planInterest: item.planInterest,
    })
    await deps.emailSender.enqueue({
      to: deps.to, subject: alert.subject, html: alert.html,
      hotelId: deps.platformHotelId, relatedType: 'sales-lead', relatedId: item.id,
    })
  } catch (e) {
    deps.logger.error('sales-leads: falló el aviso a ventas por email', { error: (e as Error).message, id: item.id })
  }
}
