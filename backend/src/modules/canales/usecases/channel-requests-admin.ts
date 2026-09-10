// canales/usecases/channel-requests-admin.ts — La bandeja del admin de plataforma.
//
// El alta de una OTA es MANUAL: alguien de la plataforma llama al hotel, entra al dashboard de
// Channex con el contrato y las credenciales de la OTA, crea el canal y lo mapea. La bandeja tiene
// que traer ARMADO todo lo que hace falta para eso, porque si no el admin abre cuatro pantallas
// para cada caso: el mensaje que escribió el hotel, a qué teléfono llamarlo, si el hotel tiene
// property en Channex, y a quién le toca.
//
// El enriquecido vive acá y no en el controller a propósito: es la parte testeable (un hotel con
// teléfono tiene que llegar con teléfono a la fila) y el controller no debe saber de joins.

import {
  CHANNEL_REQUEST_LABELS, CLOSED_STATUSES, isOverdue, isAppointmentToday,
  type ChannelRequestRow, type ChannelRequestStatus, type ChannelRequestActivityRow,
} from './channel-requests'

/**
 * Los cortes de la bandeja (REQ-CAN-08). `all` es el escape para ver todo junto.
 *
 * `attention` es el corte por DEFECTO y no está en la lista del spec como filtro propio: el spec
 * pide que la bandeja abra en "Sin atender + Vencidas", y eso son dos filtros a la vez. Resolverlo
 * en el cliente (dos pedidos y merge) daba contadores que no cerraban, así que es un corte más.
 */
export const CHANNEL_REQUEST_FILTERS = ['attention', 'all', 'pending', 'today', 'overdue', 'in_management', 'closed'] as const
export type ChannelRequestFilter = (typeof CHANNEL_REQUEST_FILTERS)[number]

export const CHANNEL_REQUEST_FILTER_LABELS: Record<ChannelRequestFilter, string> = {
  attention: 'Requieren atención',
  all: 'Todas',
  pending: 'Sin atender',
  today: 'Citas de hoy',
  overdue: 'Vencidas',
  in_management: 'En gestión',
  closed: 'Cerradas',
}

const IN_MANAGEMENT: ChannelRequestStatus[] = ['scheduled', 'in_progress', 'waiting_hotel']

export interface AdminChannelRequestRow extends ChannelRequestRow {
  /** Cita `scheduled` cuya hora ya pasó: el hotel quedó esperando la llamada. */
  overdue: boolean
  appointmentToday: boolean
  statusLabel: string
  hotelPhone: string
  hotelEmail: string
  /** Property del hotel en Channex, o vacío si nunca sincronizó (no se puede crear el canal). */
  channexPropertyId: string
  channexUrl: string
  assignedToName: string
  /** Tipos de habitación mapeados en Channex: sin esto el canal no se puede mapear. */
  mappedRoomTypes: number
}

export interface AdminChannelRequestList {
  data: AdminChannelRequestRow[]
  total: number
  counts: Record<ChannelRequestFilter, number>
}

/** Todo lo que la bandeja necesita leer. Un solo `findMany(model, query)` como en el resto del módulo. */
export interface AdminChannelRequestDeps {
  findMany: (model: string, query: Record<string, unknown>) => Promise<Record<string, unknown>[]>
  /** Entorno de la cuenta Channex (`staging` | `production`), para armar los enlaces del dashboard. */
  environment?: string
}

const STAGING_DASHBOARD = 'https://staging.channex.io'
const PROD_DASHBOARD = 'https://app.channex.io'

/** Raíz del dashboard de Channex del entorno configurado. */
export function channexDashboardUrl(environment?: string): string {
  return environment === 'production' ? PROD_DASHBOARD : STAGING_DASHBOARD
}

/**
 * Enlace directo a la property del hotel, o a la raíz si todavía no sincronizó.
 *
 * Sin property no hay a dónde ir: el hotel tiene que apretar "Sincronizar" en su panel primero, y
 * mandar al admin a una URL rota es peor que decírselo.
 */
export function channexPropertyUrl(environment?: string, propertyId?: string): string {
  const base = channexDashboardUrl(environment)
  return propertyId ? `${base}/properties/${propertyId}` : base
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** ¿Esta fila entra en el corte pedido? */
export function matchesFilter(row: AdminChannelRequestRow, filter: ChannelRequestFilter): boolean {
  switch (filter) {
    // Lo que le toca hacer al admin AHORA: nadie lo atendió, o le prometimos una llamada y no salió.
    case 'attention': return row.status === 'pending' || row.overdue
    case 'pending': return row.status === 'pending'
    case 'today': return row.appointmentToday && !CLOSED_STATUSES.includes(row.status)
    case 'overdue': return row.overdue
    case 'in_management': return IN_MANAGEMENT.includes(row.status)
    case 'closed': return CLOSED_STATUSES.includes(row.status)
    default: return true
  }
}

/**
 * La bandeja completa: solicitudes de todos los hoteles, enriquecidas y ordenadas por urgencia.
 *
 * Orden: primero lo vencido (alguien está esperando una llamada que no llegó), después lo que no
 * tiene dueño, y recién ahí por fecha. Ordenar solo por fecha dejaba una cita vencida de la semana
 * pasada abajo de todo.
 */
export async function listChannelRequestsForAdmin(
  deps: AdminChannelRequestDeps,
  options: { filter?: string; now?: Date } = {},
): Promise<AdminChannelRequestList> {
  const now = options.now ?? new Date()
  const rows = (await deps.findMany('ChannelRequests', {})) as unknown as ChannelRequestRow[]

  // Un findMany por tabla y se resuelve en memoria: son decenas de filas, no millones, y el ORM
  // del framework no sabe hacer `IN (...)` (ver la nota de difusión del CLAUDE.md).
  const [hotels, configs, users] = await Promise.all([
    deps.findMany('Hotels', {}),
    deps.findMany('Canales', {}),
    deps.findMany('Users', {}),
  ])
  const hotelById = new Map(hotels.map((h) => [str(h.id), h]))
  const configByHotel = new Map(configs.map((c) => [str(c.hotelId), c]))
  const userById = new Map(users.map((u) => [str(u.id), u]))

  // Tipos de habitación publicados por hotel: el mapeo del canal se arma contra estos.
  const mappings = await deps.findMany('ChannelMapping', { kind: 'room_type' })
  const mappedByHotel = new Map<string, number>()
  for (const m of mappings) {
    const h = str(m.hotelId)
    mappedByHotel.set(h, (mappedByHotel.get(h) ?? 0) + 1)
  }

  const data: AdminChannelRequestRow[] = rows.map((row) => {
    const hotel = hotelById.get(row.hotelId)
    const cfg = configByHotel.get(row.hotelId)
    const propertyId = str(cfg?.channexPropertyId)
    return {
      ...row,
      overdue: isOverdue(row, now),
      appointmentToday: isAppointmentToday(row, now),
      statusLabel: CHANNEL_REQUEST_LABELS[row.status] ?? row.status,
      hotelPhone: str(hotel?.phone),
      hotelEmail: str(hotel?.email),
      channexPropertyId: propertyId,
      channexUrl: channexPropertyUrl(deps.environment, propertyId),
      assignedToName: str(userById.get(str(row.assignedTo))?.name),
      mappedRoomTypes: mappedByHotel.get(row.hotelId) ?? 0,
    }
  })

  const counts = {} as Record<ChannelRequestFilter, number>
  for (const f of CHANNEL_REQUEST_FILTERS) counts[f] = data.filter((r) => matchesFilter(r, f)).length

  const filter = (CHANNEL_REQUEST_FILTERS as readonly string[]).includes(options.filter ?? '')
    ? (options.filter as ChannelRequestFilter)
    : 'all'
  const visible = data.filter((r) => matchesFilter(r, filter)).sort(byUrgency)

  return { data: visible, total: visible.length, counts }
}

function byUrgency(a: AdminChannelRequestRow, b: AdminChannelRequestRow): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
  const aSinDueno = a.status === 'pending' ? 0 : 1
  const bSinDueno = b.status === 'pending' ? 0 : 1
  if (aSinDueno !== bSinDueno) return aSinDueno - bSinDueno
  return str(b.createdAt).localeCompare(str(a.createdAt))
}

/** El caso con su historial, para el detalle. Actividades de la más nueva a la más vieja. */
export async function getChannelRequestForAdmin(
  deps: AdminChannelRequestDeps & { listActivities: (requestId: string) => Promise<ChannelRequestActivityRow[]> },
  id: string,
  now: Date = new Date(),
): Promise<(AdminChannelRequestRow & { activities: ChannelRequestActivityRow[] }) | null> {
  const { data } = await listChannelRequestsForAdmin(deps, { filter: 'all', now })
  const row = data.find((r) => r.id === id)
  if (!row) return null
  const activities = (await deps.listActivities(id))
    .slice()
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))
  return { ...row, activities }
}
