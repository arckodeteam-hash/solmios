// ChannelRequest.service.ts — La bandeja de solicitudes de conexión de OTA (super-admin).
//
// Separado de `Channel.service.ts` porque son otras rutas (`/admin/*`) y otro consumidor: el panel
// del hotel nunca llama a esto. La pantalla anterior hablaba con `http.get` desde el componente,
// que además dejaba el tipo de la fila escrito adentro del .vue.

import { http } from './http'
import type { ChannelRequestStatus } from './Channel.service'

/**
 * `attention` es el corte por defecto ("Sin atender + Vencidas" del REQ-CAN-08): lo que el admin
 * tiene que mirar hoy. Los otros cinco son los cortes del spec, más `all`.
 */
export type ChannelRequestFilter = 'attention' | 'all' | 'pending' | 'today' | 'overdue' | 'in_management' | 'closed'

export const CHANNEL_REQUEST_FILTERS: Array<{ value: ChannelRequestFilter; label: string }> = [
  { value: 'attention', label: 'Requieren atención' },
  { value: 'pending', label: 'Sin atender' },
  { value: 'today', label: 'Citas de hoy' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'in_management', label: 'En gestión' },
  { value: 'closed', label: 'Cerradas' },
  { value: 'all', label: 'Todas' },
]

export type ChannelRequestMedium = 'call' | 'whatsapp' | 'video'

export const CHANNEL_REQUEST_MEDIUMS: Array<{ value: ChannelRequestMedium; label: string }> = [
  { value: 'call', label: 'Llamada' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'video', label: 'Videollamada' },
]

/** Una fila de la bandeja: el pedido + lo que hace falta para el alta manual (REQ-CAN-05). */
export interface AdminChannelRequest {
  id: string
  hotelId: string
  hotelName?: string | null
  channel: string
  channelName?: string | null
  requestedByName?: string | null
  requestedByEmail?: string | null
  status: ChannelRequestStatus
  statusLabel: string
  message?: string | null
  contactPhone?: string | null
  notes?: string | null
  appointmentAt?: string | null
  appointmentMedium?: ChannelRequestMedium | null
  contactName?: string | null
  contactEmail?: string | null
  assignedTo?: string | null
  assignedToName: string
  resolutionReason?: string | null
  closedAt?: string | null
  createdAt?: string
  /** Cita agendada cuya hora ya pasó: el hotel quedó esperando la llamada. */
  overdue: boolean
  appointmentToday: boolean
  hotelPhone: string
  hotelEmail: string
  /** Vacío = el hotel nunca sincronizó, así que en Channex no hay property donde crear el canal. */
  channexPropertyId: string
  channexUrl: string
  mappedRoomTypes: number
}

export interface ChannelRequestActivity {
  id: string
  requestId: string
  kind: string
  actorId?: string | null
  actorName?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  note?: string | null
  payload?: Record<string, unknown>
  createdAt?: string
}

export interface ChannelRequestList {
  data: AdminChannelRequest[]
  total: number
  counts: Record<ChannelRequestFilter, number>
  /** Qué transiciones permite el backend desde cada estado: la UI no las duplica, las lee. */
  transitions: Record<ChannelRequestStatus, ChannelRequestStatus[]>
}

export interface ScheduleAppointmentPayload {
  at: string
  medium: ChannelRequestMedium
  contactName: string
  contactPhone: string
  contactEmail?: string
  note?: string
}

/**
 * Los mismos estados, contados desde el lado del admin. `waiting_hotel` para el hotel es
 * "Esperando tu respuesta" y para el admin "Esperando al hotel": usar las etiquetas del panel del
 * hotel en la bandeja hacía que el botón de avanzar dijera "Esperando tu respuesta" al admin.
 */
export const CHANNEL_REQUEST_ADMIN_LABELS: Record<ChannelRequestStatus, string> = {
  pending: 'Solicitada',
  scheduled: 'Cita agendada',
  in_progress: 'En configuración',
  waiting_hotel: 'Esperando al hotel',
  connected: 'Conectada',
  rejected: 'Rechazada',
}

export const ChannelRequestsAdminService = {
  list(filter: ChannelRequestFilter = 'attention'): Promise<ChannelRequestList> {
    return http.get<ChannelRequestList>(`/admin/channel-requests?filter=${filter}`)
  },

  get(id: string): Promise<AdminChannelRequest & { activities: ChannelRequestActivity[] }> {
    return http.get(`/admin/channel-requests/${id}`)
  },

  /** Cambio de estado. El backend rechaza con 409 lo que no está en la tabla de transiciones. */
  update(id: string, patch: { status?: ChannelRequestStatus; resolutionReason?: string; assignedTo?: string }): Promise<AdminChannelRequest> {
    return http.put(`/admin/channel-requests/${id}`, patch)
  },

  /** Agendar o reprogramar: es el único camino al estado "Cita agendada". */
  schedule(id: string, payload: ScheduleAppointmentPayload): Promise<AdminChannelRequest> {
    return http.post(`/admin/channel-requests/${id}/appointment`, payload)
  },

  addNote(id: string, note: string): Promise<AdminChannelRequest> {
    return http.post(`/admin/channel-requests/${id}/notes`, { note })
  },
}
