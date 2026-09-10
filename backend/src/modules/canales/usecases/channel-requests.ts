// canales/usecases/channel-requests.ts — El caso de "conectame Booking", de punta a punta.
//
// Conectar Booking, Airbnb o Expedia NO es algo que el hotelero pueda hacer solo: hace falta un
// contrato con la OTA y credenciales que gestiona la plataforma. El botón "Solicitar Conexión"
// abría el asistente embebido de Channex —en inglés, con adaptadores y campos de credenciales que
// el hotelero no tiene— y ahí moría: nadie del lado nuestro se enteraba de que ese hotel quería
// conectarse.
//
// Que quede la fila no alcanzaba. El alta real es MANUAL y arranca con una llamada al hotel, pero
// el admin podía mover el estado con un `<select>` libre: `pending → connected` sin cita, sin
// contacto y sin que quedara registro de quién lo hizo. Este archivo es el modelo del caso:
//
//   · una máquina de estados (nadie "conecta" un hotel con el que nunca habló),
//   · una cita con fecha, medio y contacto (REQ-CAN-03),
//   · e historial: toda mutación deja actividad con actor (REQ-CAN-04).
//
// Sin BD ni HTTP: todo entra por `deps`, así se testea sin levantar nada.

import { ConflictError, ValidationError } from 'arckode-framework'

export const CHANNEL_REQUEST_STATUSES = [
  'pending', 'scheduled', 'in_progress', 'waiting_hotel', 'connected', 'rejected',
] as const
export type ChannelRequestStatus = (typeof CHANNEL_REQUEST_STATUSES)[number]

/** Lo que ve el hotelero. El admin ve además `notes`, que son internas. */
export const CHANNEL_REQUEST_LABELS: Record<ChannelRequestStatus, string> = {
  pending: 'Solicitada',
  scheduled: 'Cita agendada',
  in_progress: 'En configuración',
  waiting_hotel: 'Esperando al hotel',
  connected: 'Conectada',
  rejected: 'Rechazada',
}

/**
 * Qué se puede hacer desde cada estado (REQ-CAN-02). Todo lo que no esté acá es 409.
 *
 * `connected` y `rejected` no salen a ningún lado: un caso cerrado se reabre pidiendo de nuevo, no
 * reescribiendo el historial. `scheduled → scheduled` es reprogramar, que es legítimo y frecuente.
 */
export const CHANNEL_REQUEST_TRANSITIONS: Record<ChannelRequestStatus, ChannelRequestStatus[]> = {
  pending: ['scheduled', 'rejected'],
  scheduled: ['scheduled', 'in_progress', 'waiting_hotel', 'rejected'],
  in_progress: ['waiting_hotel', 'connected', 'rejected'],
  waiting_hotel: ['in_progress', 'scheduled', 'rejected'],
  connected: [],
  rejected: [],
}

/** Cerrado = sin transiciones de salida. */
export const CLOSED_STATUSES: ChannelRequestStatus[] = ['connected', 'rejected']

/** Una solicitud sigue "abierta" mientras nadie la cerró: no se pide dos veces lo mismo. */
export const OPEN_STATUSES: ChannelRequestStatus[] = CHANNEL_REQUEST_STATUSES
  .filter((s) => !CLOSED_STATUSES.includes(s))

export const CHANNEL_REQUEST_MEDIUMS = ['call', 'whatsapp', 'video'] as const
export type ChannelRequestMedium = (typeof CHANNEL_REQUEST_MEDIUMS)[number]

export const CHANNEL_REQUEST_MEDIUM_LABELS: Record<ChannelRequestMedium, string> = {
  call: 'Llamada',
  whatsapp: 'WhatsApp',
  video: 'Videollamada',
}

export const CHANNEL_REQUEST_ACTIVITY_KINDS = [
  'created', 'status_changed', 'appointment_scheduled', 'appointment_rescheduled',
  'note_added', 'notified_hotel', 'notified_admin', 'reminder_sent',
] as const
export type ChannelRequestActivityKind = (typeof CHANNEL_REQUEST_ACTIVITY_KINDS)[number]

export interface ChannelRequestRow {
  id: string
  hotelId: string
  hotelName?: string | null
  channel: string
  channelName?: string | null
  requestedByName?: string | null
  requestedByEmail?: string | null
  status: ChannelRequestStatus
  message?: string | null
  contactPhone?: string | null
  notes?: string | null
  appointmentAt?: string | null
  appointmentMedium?: ChannelRequestMedium | null
  contactName?: string | null
  contactEmail?: string | null
  assignedTo?: string | null
  resolutionReason?: string | null
  closedAt?: string | null
  reminderSentFor?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface ChannelRequestActivityRow {
  id: string
  requestId: string
  hotelId: string
  kind: ChannelRequestActivityKind
  actorId?: string | null
  actorName?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  note?: string | null
  payload?: Record<string, unknown>
  createdAt?: string
}

export interface ChannelRequestInput {
  hotelId: string
  hotelName?: string
  channel: string
  channelName?: string
  requestedByName?: string
  requestedByEmail?: string
  message?: string
  contactPhone?: string
}

/** Quién está haciendo el cambio. El id es `users.id`; el nombre se copia para el historial. */
export interface ChannelRequestActor {
  id?: string
  name?: string
}

/** Aviso al hotel. Best-effort: devuelve a quién se le mandó para dejarlo en el historial. */
export type ChannelRequestHotelNotifier = (
  row: ChannelRequestRow,
  event: 'scheduled' | 'rescheduled' | 'connected' | 'rejected',
) => Promise<{ sent: boolean; to?: string } | void>

export interface ChannelRequestDeps {
  findMany: (query: Record<string, unknown>) => Promise<ChannelRequestRow[]>
  create: (row: ChannelRequestRow) => Promise<ChannelRequestRow>
  update: (id: string, patch: Partial<ChannelRequestRow>) => Promise<ChannelRequestRow>
  findById?: (id: string) => Promise<ChannelRequestRow | null>
  /** Historial (REQ-CAN-04). Opcional para que un test de alta no tenga que cablearlo. */
  createActivity?: (row: ChannelRequestActivityRow) => Promise<unknown>
  listActivities?: (requestId: string) => Promise<ChannelRequestActivityRow[]>
  /** Aviso al admin de la plataforma. Best-effort: si falla, la solicitud igual queda registrada. */
  notify?: (row: ChannelRequestRow) => Promise<unknown>
  /** Aviso al hotel (correo). Best-effort, igual que el de arriba. */
  notifyHotel?: ChannelRequestHotelNotifier
}

const nowIso = () => new Date().toISOString()

/**
 * Escribe una actividad sin poder tumbar la operación que la generó.
 *
 * El historial es importante, pero no más que el cambio en sí: si la tabla de actividades falla,
 * el caso igual tiene que quedar movido — al revés se pierde el trabajo del admin por un log.
 */
async function record(
  deps: Pick<ChannelRequestDeps, 'createActivity'>,
  row: Pick<ChannelRequestRow, 'id' | 'hotelId'>,
  entry: Omit<ChannelRequestActivityRow, 'id' | 'requestId' | 'hotelId' | 'createdAt'>,
): Promise<void> {
  if (!deps.createActivity) return
  try {
    await deps.createActivity({
      id: crypto.randomUUID(),
      requestId: row.id,
      hotelId: row.hotelId,
      createdAt: nowIso(),
      payload: {},
      ...entry,
    })
  } catch { /* el historial no puede hacer fracasar el cambio que registra */ }
}

/** Avisa al hotel y deja la constancia. Nunca tira. */
async function notifyHotelAndRecord(
  deps: Pick<ChannelRequestDeps, 'notifyHotel' | 'createActivity'>,
  row: ChannelRequestRow,
  event: 'scheduled' | 'rescheduled' | 'connected' | 'rejected',
): Promise<void> {
  if (!deps.notifyHotel) return
  try {
    const result = await deps.notifyHotel(row, event)
    if (!result || !result.sent) return
    await record(deps, row, {
      kind: 'notified_hotel',
      note: result.to ? `Aviso enviado a ${result.to}` : 'Aviso enviado al hotel',
      payload: { event, to: result.to ?? '' },
    })
  } catch { /* un correo que no sale no puede deshacer el cambio de estado */ }
}

/** Lee el caso. Sin `findById` cableado, cae al `findMany` por id (mismo resultado, un filtro más). */
async function readOne(deps: ChannelRequestDeps, id: string): Promise<ChannelRequestRow> {
  const row = deps.findById
    ? await deps.findById(id)
    : (await deps.findMany({ id }))[0] ?? null
  if (!row) throw new ValidationError('La solicitud no existe')
  return row
}

/**
 * Registra el pedido. Si el hotel ya tiene uno ABIERTO para ese mismo canal, devuelve ese —
 * apretar el botón dos veces no puede generar dos pedidos que después alguien tenga que
 * desduplicar a mano.
 */
export async function requestChannel(
  deps: ChannelRequestDeps, input: ChannelRequestInput,
): Promise<{ request: ChannelRequestRow; created: boolean }> {
  const abiertas = (await deps.findMany({ hotelId: input.hotelId, channel: input.channel }))
    .filter((r) => OPEN_STATUSES.includes(r.status))
  if (abiertas.length) return { request: abiertas[0]!, created: false }

  const now = nowIso()
  const row = await deps.create({
    id: crypto.randomUUID(),
    hotelId: input.hotelId,
    hotelName: input.hotelName ?? null,
    channel: input.channel,
    channelName: input.channelName ?? input.channel,
    requestedByName: input.requestedByName ?? null,
    requestedByEmail: input.requestedByEmail ?? null,
    status: 'pending',
    message: input.message ?? null,
    contactPhone: input.contactPhone ?? null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
  await record(deps, row, {
    kind: 'created',
    actorName: input.requestedByName ?? null,
    toStatus: 'pending',
    note: input.message ?? null,
    payload: { channel: row.channel, channelName: row.channelName ?? '' },
  })
  if (deps.notify) await deps.notify(row).catch(() => { /* el aviso no puede perder la solicitud */ })
  return { request: row, created: true }
}

/** ¿Se puede ir de `from` a `to`? Tira 409 con el motivo si no. */
export function assertTransition(from: ChannelRequestStatus, to: ChannelRequestStatus): void {
  const allowed = CHANNEL_REQUEST_TRANSITIONS[from] ?? []
  if (allowed.includes(to)) return
  if (CLOSED_STATUSES.includes(from)) {
    throw new ConflictError(
      `La solicitud está ${CHANNEL_REQUEST_LABELS[from].toLowerCase()} y ya no se puede modificar. Si hace falta retomarla, el hotel la pide de nuevo.`,
    )
  }
  throw new ConflictError(
    `No se puede pasar de "${CHANNEL_REQUEST_LABELS[from]}" a "${CHANNEL_REQUEST_LABELS[to]}". Desde acá solo: ${allowed.map((s) => CHANNEL_REQUEST_LABELS[s]).join(', ') || 'ninguno'}.`,
  )
}

export interface UpdateChannelRequestPatch {
  status?: string
  resolutionReason?: string
  assignedTo?: string
}

/**
 * Cambio de estado del admin, con la máquina de estados puesta.
 *
 * Antes esto aceptaba cualquiera de los cuatro estados sin mirar el actual: un caso saltaba de
 * "Solicitada" a "Conectada" sin que nadie hubiera hablado con el hotel, y sin rastro de quién.
 */
export async function updateChannelRequest(
  deps: ChannelRequestDeps,
  id: string,
  patch: UpdateChannelRequestPatch,
  actor: ChannelRequestActor = {},
): Promise<ChannelRequestRow> {
  const current = await readOne(deps, id)
  const next: Partial<ChannelRequestRow> = { updatedAt: nowIso() }

  if (patch.assignedTo !== undefined) next.assignedTo = patch.assignedTo || null

  if (patch.status === undefined) {
    if (patch.resolutionReason !== undefined) next.resolutionReason = patch.resolutionReason || null
    return deps.update(id, next)
  }

  const to = patch.status as ChannelRequestStatus
  if (!CHANNEL_REQUEST_STATUSES.includes(to)) {
    throw new ValidationError(`Estado desconocido: "${patch.status}"`)
  }
  assertTransition(current.status, to)

  // Rechazar sin motivo deja al hotel sin saber qué le falta y al próximo admin sin saber qué pasó.
  const reason = (patch.resolutionReason ?? '').trim()
  if (to === 'rejected' && !reason) {
    throw new ValidationError('Falta el motivo del rechazo', { resolutionReason: ['El motivo es obligatorio para rechazar'] })
  }

  next.status = to
  if (reason) next.resolutionReason = reason
  if (CLOSED_STATUSES.includes(to)) next.closedAt = nowIso()
  if (!actor.id) { /* sin actor identificado el caso no cambia de responsable */ }
  else if (patch.assignedTo === undefined && !current.assignedTo) next.assignedTo = actor.id

  const updated = await deps.update(id, next)
  await record(deps, updated, {
    kind: 'status_changed',
    actorId: actor.id ?? null,
    actorName: actor.name ?? null,
    fromStatus: current.status,
    toStatus: to,
    note: reason || null,
  })
  if (to === 'connected') await notifyHotelAndRecord(deps, updated, 'connected')
  if (to === 'rejected') await notifyHotelAndRecord(deps, updated, 'rejected')
  return updated
}

export interface ScheduleAppointmentInput {
  at: string
  medium: string
  contactName: string
  contactPhone: string
  contactEmail?: string
  note?: string
}

/**
 * Agenda (o reprograma) la llamada con el hotel. Es el único camino a `scheduled`: la cita no es
 * un adorno del caso, es el caso — sin fecha, medio y a quién llamar, "en gestión" no significa nada.
 */
export async function scheduleAppointment(
  deps: ChannelRequestDeps,
  id: string,
  input: ScheduleAppointmentInput,
  actor: ChannelRequestActor = {},
  now: Date = new Date(),
): Promise<ChannelRequestRow> {
  const current = await readOne(deps, id)
  assertTransition(current.status, 'scheduled')

  const at = Date.parse(input.at)
  if (Number.isNaN(at)) throw new ValidationError('La fecha de la cita no es válida', { at: ['Fecha inválida'] })
  if (at <= now.getTime()) {
    throw new ValidationError('La cita tiene que ser a futuro', { at: ['La fecha y hora ya pasaron'] })
  }
  if (!CHANNEL_REQUEST_MEDIUMS.includes(input.medium as ChannelRequestMedium)) {
    throw new ValidationError('Medio de contacto inválido', { medium: [`Debe ser uno de: ${CHANNEL_REQUEST_MEDIUMS.join(', ')}`] })
  }

  const reprograma = current.status === 'scheduled' && !!current.appointmentAt
  const updated = await deps.update(id, {
    status: 'scheduled',
    appointmentAt: new Date(at).toISOString(),
    appointmentMedium: input.medium as ChannelRequestMedium,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail || null,
    assignedTo: actor.id || current.assignedTo || null,
    // La cita cambió: el recordatorio de la anterior ya no aplica (ver `reminderSentFor`).
    reminderSentFor: null,
    updatedAt: nowIso(),
  })

  await record(deps, updated, {
    kind: reprograma ? 'appointment_rescheduled' : 'appointment_scheduled',
    actorId: actor.id ?? null,
    actorName: actor.name ?? null,
    fromStatus: current.status,
    toStatus: 'scheduled',
    note: input.note || null,
    payload: {
      at: updated.appointmentAt ?? '',
      medium: input.medium,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      ...(current.appointmentAt ? { previousAt: current.appointmentAt } : {}),
    },
  })
  await notifyHotelAndRecord(deps, updated, reprograma ? 'rescheduled' : 'scheduled')
  return updated
}

/**
 * Nota interna del admin. Reemplaza el campo `notes` (que es "el estado actual de la nota") y deja
 * la versión en el historial, que es donde se lee la conversación completa.
 */
export async function addChannelRequestNote(
  deps: ChannelRequestDeps,
  id: string,
  note: string,
  actor: ChannelRequestActor = {},
): Promise<ChannelRequestRow> {
  const current = await readOne(deps, id)
  const updated = await deps.update(id, { notes: note, updatedAt: nowIso() })
  await record(deps, current, {
    kind: 'note_added',
    actorId: actor.id ?? null,
    actorName: actor.name ?? null,
    note,
  })
  return updated
}

/** Una cita `scheduled` cuya hora ya pasó: el hotel quedó esperando. */
export function isOverdue(row: Pick<ChannelRequestRow, 'status' | 'appointmentAt'>, now: Date = new Date()): boolean {
  if (row.status !== 'scheduled' || !row.appointmentAt) return false
  const at = Date.parse(row.appointmentAt)
  return !Number.isNaN(at) && at < now.getTime()
}

/** ¿La cita cae hoy? Se compara por día local del servidor (que es el que ve el admin). */
export function isAppointmentToday(row: Pick<ChannelRequestRow, 'appointmentAt'>, now: Date = new Date()): boolean {
  if (!row.appointmentAt) return false
  const at = new Date(row.appointmentAt)
  if (Number.isNaN(at.getTime())) return false
  return at.getFullYear() === now.getFullYear()
    && at.getMonth() === now.getMonth()
    && at.getDate() === now.getDate()
}

/** Lo que ve el hotel: sin las notas internas, el responsable ni el historial del admin. */
export function forHotel(row: ChannelRequestRow): Omit<ChannelRequestRow, 'notes' | 'assignedTo'> {
  const { notes: _notes, assignedTo: _assignedTo, ...visible } = row
  return visible
}
