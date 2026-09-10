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

// ─── sales_prospects — lo que ventas anota sobre cada prospecto (REQ-PIPE-03) ───────────────
//
// El pipeline NO se guarda: la etapa, las señales y el calor se calculan al consultar
// (`usecases/pipeline.ts`) desde `subscriptions`/`hotels`/`rooms`/... Esta tabla es solo lo que
// una persona decide: próximo paso, responsable, cuándo se lo contactó, si se perdió y por qué.
// Una fila por `hotelId` (hotel registrado) O por `leadId` (`sales_leads` sin hotel) — ambos
// nullables, uno obligatorio. Se crea en el primer PUT (upsert), nunca al registrarse el hotel.
export const SalesProspectsModel: ModelDefinition = {
  table: 'sales_prospects',
  fields: {
    id: { type: 'string', required: true },
    /** `hotels.id` cuando el prospecto ya se registró. Null en los leads de contacto. */
    hotelId: { type: 'string', indexed: true },
    /** `sales_leads.id` cuando todavía no hay hotel. Null en los registrados. */
    leadId: { type: 'string', indexed: true },
    /** Cuándo hay que volver a tocarlo (ISO). Vencido ⇒ va primero en el pipeline. */
    nextStepAt: { type: 'string' },
    nextStepNote: { type: 'string' },
    /** `users.id` del super_admin responsable. */
    assignedTo: { type: 'string' },
    /** Último contacto humano (ISO). En Fase B pausa la secuencia automática 2 días. */
    contactedAt: { type: 'string' },
    lostAt: { type: 'string' },
    /** Uno de SALES_LOST_REASONS (types.ts). Setearlo sin `lostAt` sella `lostAt = now` (service). */
    lostReason: { type: 'string' },
    // `text`, no `string`: notas multilínea (`string` aplasta los saltos de línea en validate-body).
    notes: { type: 'text' },
    /** Dedup de la secuencia automática (Fase B): `{ [evento]: fechaISO }`. */
    sequenceSent: { type: 'json', default: {} },
  },
  timestamps: true,
}

export function registerSalesLeadsModels(orm: ORM): void {
  orm.define('SalesLeads', SalesLeadsModel)
  orm.define('SalesProspects', SalesProspectsModel)
}
