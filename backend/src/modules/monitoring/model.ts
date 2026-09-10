// monitoring/model.ts — Schema de base de datos del registro de errores (REQ-MON-02).
// Describe la tabla `error_logs`: los 5xx/429 y las excepciones que captura el middleware
// httpMetrics (shared/observability/http-metrics.ts), agrupados por (path, message) con contador.
// Importado por index.ts → orm.define() para registrar el modelo.
//
// Se persiste en base —y no en memoria como las métricas de latencia— porque el valor de un error
// está justamente en sobrevivir al reinicio que pudo haber provocado (design › decisión 1).
//
// OJO (anti-patrón del repo, ver canales/model.ts › channexGroupId): el ORM DESCARTA sin warning
// los campos que no están declarados acá. Todo campo que use usecases/error-logs.ts tiene que
// estar en este `fields`.

import type { ModelDefinition, ORM } from 'arckode-framework'

export const ErrorLogsModel: ModelDefinition = {
  table: 'error_logs',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    // Nullable: un error puede no tener hotel (petición sin token, cron, ruta pública).
    hotelId: { type: 'string', indexed: true },
    method: { type: 'string', required: true },
    // Ruta YA normalizada (UUID/ULID/dígitos → :id): es la mitad de la clave de agrupación.
    path: { type: 'string', required: true, indexed: true },
    statusCode: { type: 'number', required: true },
    // La otra mitad de la clave. `text` porque un mensaje de excepción puede pasar los 255.
    message: { type: 'text', required: true },
    // Primeras líneas del stack (el middleware ya lo recorta); ausente en los 5xx sin excepción.
    stack: { type: 'text' },
    // Cuántas veces se vio el mismo (path, message): 500 repeticiones son UNA fila (decisión 5).
    count: { type: 'number', default: 1 },
    firstSeenAt: { type: 'string', required: true },
    // Indexado porque el listado ordena por acá y la retención filtra por acá.
    lastSeenAt: { type: 'string', required: true, indexed: true },
  },
}

export function registerMonitoringModels(orm: ORM): void {
  orm.define('ErrorLogs', ErrorLogsModel)
}
