// sales-leads/model.ts — Schema de la tabla sales_leads.
// Leads del formulario de ventas (botones "Hablar con Ventas" / "Contactar ventas" de la
// landing pública). Scope PLATAFORMA: no llevan hotelId (no son contenido de un hotel —
// los gestiona el super_admin del SaaS), mismo patrón que deletion-requests.
import type { ModelDefinition, ORM } from 'arckode-framework'

export const SalesLeadsModel: ModelDefinition = {
  table: 'sales_leads',
  fields: {
    id: { type: 'string', required: true },
    fullName: { type: 'string', required: true },
    email: { type: 'string', required: true },
    phone: { type: 'string' },
    hotelName: { type: 'string' },
    // Texto libre ("1-10", "50+"), no un número — el visitante puede no saberlo con precisión.
    roomsRange: { type: 'string' },
    // `text`, no `string`: el mensaje del lead puede ser multilínea y `string` aplasta los
    // saltos de línea (`replace(/\s+/g, ' ')` en validate-body.ts).
    message: { type: 'text' },
    // Slug del plan cuando el lead vino de "Contactar ventas" en una tarjeta de plan a cotización
    // (p.ej. 'ultra'); null cuando vino del CTA genérico "Hablar con Ventas".
    planInterest: { type: 'string' },
    // new (recién llegado) → contacted (ventas ya escribió) → won | lost.
    status: { type: 'string', default: 'new' },
    // Notas internas del equipo de ventas — nunca públicas. `text`, no `string` (multilínea).
    notes: { type: 'text' },
  },
  timestamps: true,
}

export function registerSalesLeadsModels(orm: ORM): void {
  orm.define('SalesLeads', SalesLeadsModel)
}
