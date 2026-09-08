// ari-outbox/validators/schema.ts — Validación de entrada.
// Schemas planos, sin dependencias externas (mismo estilo que canales/ y email-queue/).
//
// El módulo no expone escritura: `schedule`/`drain` los llama un conector con tipos, no HTTP.
// El único input externo es el query del listado admin
// (GET /api/admin/ari-outbox?hotelId=&status=&kind=&limit=&page=).
//
// Sólo los filtros de TEXTO se validan acá. `page` y `limit` quedan fuera a propósito: los normaliza
// el service (basura → default, tope duro de 200), así que una regla en este schema sería letra
// muerta — declararía un rechazo que nunca ocurre, que es justo lo que confunde al que lo lee.

import type { ValidationRule } from 'arckode-framework'

export const ListAriOutboxSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, max: 200 },
  // Los enums son los mismos conjuntos que `AriOutboxStatus` y `AriOutboxKind` en types.ts: un valor
  // fuera de ellos filtraría por algo que no existe y devolvería una lista vacía en silencio, que se
  // lee como "no hay nada en la outbox" en vez de "escribiste mal".
  status: { type: 'string' as const, enum: ['pending', 'processing', 'sent', 'failed'] },
  kind: { type: 'string' as const, enum: ['rates', 'inventory'] },
}

export const AriOutboxValidator = { list: ListAriOutboxSchema }
