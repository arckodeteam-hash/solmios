// ari-outbox/validators/schema.ts — Validación de entrada.
// Schemas planos, sin dependencias externas (mismo estilo que canales/ y email-queue/).
//
// El módulo no expone escritura: `schedule`/`drain` los llama un conector con tipos, no HTTP.
// El único input externo es el query del listado admin
// (GET /api/admin/ari-outbox?hotelId=&status=&kind=&limit=&page=).

import type { ValidationRule } from 'arckode-framework'

export const ListAriOutboxSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, max: 200 },
  status: { type: 'string' as const, enum: ['pending', 'processing', 'sent', 'failed'] },
  kind: { type: 'string' as const, enum: ['rates', 'inventory'] },
  page: { type: 'number' as const, min: 1 },
  // El tope duro (MAX_LIST_LIMIT) lo aplica el service: acá solo se rechaza lo absurdo.
  limit: { type: 'number' as const, min: 1 },
}

export const AriOutboxValidator = { list: ListAriOutboxSchema }
