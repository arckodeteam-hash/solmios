// canales/usecases/channel-requests.ts — Solicitudes de conexión de una OTA.
//
// Conectar Booking, Airbnb o Expedia NO es algo que el hotelero pueda hacer solo: hace falta un
// contrato con la OTA y credenciales que gestiona la plataforma. El botón "Solicitar Conexión"
// abría el asistente embebido de Channex —en inglés, con adaptadores y campos de credenciales que
// el hotelero no tiene— y ahí moría: nadie del lado nuestro se enteraba de que ese hotel quería
// conectarse.
//
// Ahora el pedido queda por escrito, con estado, y lo atiende el admin de la plataforma. Para el
// hotel es un botón que responde "listo, te contactamos"; para nosotros, una fila con quién,
// cuándo y para qué canal.

export const CHANNEL_REQUEST_STATUSES = ['pending', 'in_progress', 'connected', 'rejected'] as const
export type ChannelRequestStatus = (typeof CHANNEL_REQUEST_STATUSES)[number]

/** Lo que ve el hotelero. El admin ve además `notes`, que son internas. */
export const CHANNEL_REQUEST_LABELS: Record<ChannelRequestStatus, string> = {
  pending: 'Solicitada',
  in_progress: 'En gestión',
  connected: 'Conectada',
  rejected: 'Rechazada',
}

/** Una solicitud sigue "abierta" mientras nadie la cerró: no se pide dos veces lo mismo. */
export const OPEN_STATUSES: ChannelRequestStatus[] = ['pending', 'in_progress']

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
  notes?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface ChannelRequestInput {
  hotelId: string
  hotelName?: string
  channel: string
  channelName?: string
  requestedByName?: string
  requestedByEmail?: string
  message?: string
}

export interface ChannelRequestDeps {
  findMany: (query: Record<string, unknown>) => Promise<ChannelRequestRow[]>
  create: (row: ChannelRequestRow) => Promise<ChannelRequestRow>
  update: (id: string, patch: Partial<ChannelRequestRow>) => Promise<ChannelRequestRow>
  /** Aviso al admin de la plataforma. Best-effort: si falla, la solicitud igual queda registrada. */
  notify?: (row: ChannelRequestRow) => Promise<unknown>
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

  const now = new Date().toISOString()
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
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
  if (deps.notify) await deps.notify(row).catch(() => { /* el aviso no puede perder la solicitud */ })
  return { request: row, created: true }
}

/** Cambio de estado del admin. Devuelve `null` si el estado no es uno de los cuatro. */
export async function updateChannelRequest(
  deps: Pick<ChannelRequestDeps, 'update'>,
  id: string,
  patch: { status?: string; notes?: string },
): Promise<ChannelRequestRow | null> {
  const next: Partial<ChannelRequestRow> = { updatedAt: new Date().toISOString() }
  if (patch.status !== undefined) {
    if (!CHANNEL_REQUEST_STATUSES.includes(patch.status as ChannelRequestStatus)) return null
    next.status = patch.status as ChannelRequestStatus
  }
  if (patch.notes !== undefined) next.notes = patch.notes
  return deps.update(id, next)
}

/** Lo que ve el hotel: sin las notas internas del admin. */
export function forHotel(row: ChannelRequestRow): Omit<ChannelRequestRow, 'notes'> {
  const { notes: _notes, ...visible } = row
  return visible
}
