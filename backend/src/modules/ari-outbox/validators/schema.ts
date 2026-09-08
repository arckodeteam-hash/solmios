// ari-outbox/validators/schema.ts — Validación de entrada.
// Schemas planos, sin dependencias externas (mismo estilo que canales/ y email-queue/).
//
// El módulo no expone escritura de FILAS: `schedule`/`drain` los llama un conector con tipos, no
// HTTP. Los inputs externos son el query del listado admin
// (GET /api/admin/ari-outbox?hotelId=&status=&kind=&limit=&page=) y el body de la config de la cola
// (PUT /api/admin/ari-outbox/config).
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

/**
 * Body del PUT de config. Los dos campos son OPCIONALES porque el endpoint acepta un patch parcial
 * (guardar solo `maxPerMinute` no puede pisar `maxAttempts` con el default). Acá sólo se rechaza lo
 * que no es número —un `'muchas'` que llegue crudo terminaría en un techo NaN—: los rangos válidos
 * los resuelve `sanearConfig` (usecases/outbox-admin.ts), que es donde viven los mínimos y máximos.
 */
export const QueueConfigSchema: Record<string, ValidationRule> = {
  maxAttempts: { type: 'number' as const },
  maxPerMinute: { type: 'number' as const },
}

export const AriOutboxValidator = { list: ListAriOutboxSchema, queueConfig: QueueConfigSchema }
