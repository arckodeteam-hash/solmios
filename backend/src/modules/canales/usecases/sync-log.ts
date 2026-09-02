const SYNC_ACTION_LABELS: Record<string, string> = {
  sync_property: 'Sincronización de propiedad',
  ingest_bookings: 'Recepción de reservas',
  push_availability: 'Disponibilidad enviada',
  push_rates: 'Tarifas enviadas',
  push_rate_overrides: 'Tarifas por fecha enviadas',
  open_channel_test: 'Open Channel: prueba de conexión',
  open_channel_mapping: 'Open Channel: pedido de mapeo',
  open_channel_change: 'Open Channel: cambio recibido',
}

/** Nombres legibles de las claves que escriben los pushes ARI (`ari-tasks.ts`). */
const DETAIL_LABELS: Record<string, string> = {
  taskIds: 'tareas',
  entries: 'entradas',
  calls: 'llamadas',
  error: 'error',
}

/** `details` ya parseado a objeto, venga como json string o como objeto del ORM. */
function parseDetails(d: any): any {
  if (d === null || d === undefined) return null
  if (typeof d === 'string') { try { return JSON.parse(d) } catch { return d } }
  return d
}

/** Convierte el objeto `details` (json) del sync_log en un texto legible para la tabla del panel. */
export function formatSyncDetails(d: any): string {
  const obj = parseDetails(d)
  if (obj === null || obj === undefined) return ''
  if (typeof obj !== 'object') return String(obj)
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${DETAIL_LABELS[k] || k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join(' · ')
}

/** Los task ids de una fila, sueltos, para que el panel los muestre copiables. */
export function syncTaskIds(d: any): string[] {
  const obj = parseDetails(d)
  const ids = obj && typeof obj === 'object' ? (obj as any).taskIds : null
  return Array.isArray(ids) ? ids.filter((x: unknown): x is string => typeof x === 'string') : []
}

/**
 * Historial de sincronización desde la tabla `sync_log` (donde el sync/ingest escriben).
 * Antes se leía de Configuration('channex_sync_log'), fuente que nadie escribía → el historial
 * salía siempre vacío. Devuelve los últimos 50, más nuevos primero, con acción/detalle legibles.
 */
export async function getSyncLog(syncLogRepo: any, hotelId?: string): Promise<any[]> {
  if (!syncLogRepo) return []
  const rows = (await syncLogRepo.findMany(hotelId ? { hotelId } : {})) as any[]
  return rows
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      channel: r.channel,
      status: r.status,
      createdAt: r.createdAt,
      action: SYNC_ACTION_LABELS[r.action] || r.action,
      details: formatSyncDetails(r.details),
      // Sueltos además del texto: el panel los muestra copiables (los pide la certificación PMS).
      taskIds: syncTaskIds(r.details),
    }))
}
