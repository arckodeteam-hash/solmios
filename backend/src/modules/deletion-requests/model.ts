// deletion-requests/model.ts — Schema de la tabla deletion_requests.
// Solicitudes de eliminación de datos personales (Ley 172-13), enviadas desde el
// formulario público de /p/eliminacion-datos. Scope PLATAFORMA: no llevan hotelId
// (no son contenido de un hotel — las gestiona el super_admin del SaaS, igual que
// site-pages). El módulo es el único dueño del modelo (regla anti modelos-duales).
import type { ModelDefinition, ORM } from 'arckode-framework'

export const DeletionRequestsModel: ModelDefinition = {
  table: 'deletion_requests',
  fields: {
    id: { type: 'string', required: true },
    // Acuse de recibo instantáneo (se muestra al huésped al enviar el formulario).
    requestNumber: { type: 'string', required: true },
    fullName: { type: 'string', required: true },
    // Teléfono o usuario de WhatsApp/Instagram/Facebook con el que escribió.
    contactHandle: { type: 'string', required: true },
    // Hotel/establecimiento con el que interactuó — opcional, texto libre (el huésped
    // puede no recordarlo, per la política de privacidad).
    hotelName: { type: 'string' },
    // received (acuse) → verifying (identidad) → completed | rejected.
    status: { type: 'string', default: 'received' },
    // Notas internas del admin (qué se verificó, motivo de rechazo, etc.) — nunca públicas.
    notes: { type: 'string' },
  },
  timestamps: true,
}

export function registerDeletionRequestsModels(orm: ORM): void {
  orm.define('DeletionRequests', DeletionRequestsModel)
}
