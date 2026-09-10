// monitoring/validators/schema.ts — Validación de entrada.
// Schemas planos, sin dependencias externas (mismo estilo que ari-outbox/ y email-queue/).
//
// Las rutas son de lectura salvo dos: POST /api/admin/backups (sin body: el motor y el destino
// los decide el servidor, no el cliente) y los DELETE por id. Igual se valida lo poco que entra:
// el `limit` del listado de errores y el body del POST, para que un cliente que mande campos no
// los vea "aceptados" en silencio.

import type { ValidationRule } from 'arckode-framework'

/** GET /api/admin/monitoring/errors?limit=. El tope real lo aplica normalizeLimit (usecase). */
export const ListErrorsSchema: Record<string, ValidationRule> = {
  limit: { type: 'number' as const, min: 1, max: 200 },
}

/**
 * POST /api/admin/backups. Vacío A PROPÓSITO: no hay nada que el cliente pueda elegir (ni motor,
 * ni ruta, ni nombre), y declararlo así deja el `validateSchema` del controller como el gate que
 * exige el analyzer para toda ruta mutante.
 */
export const CreateBackupSchema: Record<string, ValidationRule> = {}

/** Ids de fila/archivo por ruta: sin espacios ni barras, tope corto. */
export const IdParamSchema: Record<string, ValidationRule> = {
  id: { type: 'string' as const, required: true, min: 1, max: 200, pattern: /^[A-Za-z0-9._-]+$/, message: 'id inválido' },
}

export const MonitoringValidator = { listErrors: ListErrorsSchema, createBackup: CreateBackupSchema, idParam: IdParamSchema }
