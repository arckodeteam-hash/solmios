// channel-requests.test.ts — "Solicitar Conexión" tiene que llegarle a alguien, y el caso tiene
// que tener un ciclo de vida de verdad.
//
// Antes ese botón abría el asistente embebido de Channex y ahí moría: el hotelero veía una
// pantalla en inglés pidiendo credenciales de OTA que no tiene, y del lado nuestro nadie se
// enteraba de que ese hotel quería conectarse.
//
// Y cuando ya llegaba, el admin podía mover el estado con un `<select>` libre: `pending →
// connected` sin cita, sin haber hablado con nadie y sin dejar rastro de quién lo hizo. Estos
// tests fijan las reglas que impiden las dos cosas.
import { describe, it, expect } from 'bun:test'
import { ConflictError, ValidationError } from 'arckode-framework'
import {
  requestChannel, updateChannelRequest, scheduleAppointment, addChannelRequestNote, forHotel,
  assertTransition, isOverdue, isAppointmentToday,
  CHANNEL_REQUEST_STATUSES, CHANNEL_REQUEST_LABELS, CHANNEL_REQUEST_TRANSITIONS, OPEN_STATUSES,
  type ChannelRequestDeps, type ChannelRequestRow, type ChannelRequestActivityRow,
} from '../usecases/channel-requests'

function makeDeps(existing: ChannelRequestRow[] = []) {
  const rows = [...existing]
  const notified: ChannelRequestRow[] = []
  const activities: ChannelRequestActivityRow[] = []
  const hotelNotices: Array<{ id: string; event: string }> = []
  const deps: ChannelRequestDeps = {
    findMany: async (q: any) => rows.filter((r) =>
      (q.id === undefined || r.id === q.id)
      && (q.hotelId === undefined || r.hotelId === q.hotelId)
      && (q.channel === undefined || r.channel === q.channel)),
    create: async (row) => { rows.push(row); return row },
    update: async (id, patch) => {
      const i = rows.findIndex((r) => r.id === id)
      rows[i] = { ...rows[i]!, ...patch } as ChannelRequestRow
      return rows[i]!
    },
    createActivity: async (a) => { activities.push(a); return a },
    listActivities: async (requestId) => activities.filter((a) => a.requestId === requestId),
    notify: async (row) => { notified.push(row) },
    notifyHotel: async (row, event) => { hotelNotices.push({ id: row.id, event }); return { sent: true, to: 'dueño@hotel.com' } },
  }
  return { deps, rows, notified, activities, hotelNotices }
}

const BOOKING = { hotelId: 'h1', hotelName: 'Hotel Frente Sol', channel: 'booking', channelName: 'Booking.com', requestedByEmail: 'dueño@hotel.com' }
const ADMIN = { id: 'u-admin', name: 'Ana Soporte' }

/** Una fila en el estado que pida el test, sin pasar por los usecases. */
const fila = (patch: Partial<ChannelRequestRow> = {}): ChannelRequestRow => ({
  id: 'r1', hotelId: 'h1', channel: 'booking', channelName: 'Booking.com', status: 'pending', ...patch,
} as ChannelRequestRow)

const enUnaHora = () => new Date(Date.now() + 3600_000).toISOString()
const CITA = { at: '', medium: 'call', contactName: 'Luis Pérez', contactPhone: '809-555-0000' }

describe('requestChannel', () => {
  it('registra el pedido y avisa al admin', async () => {
    const { deps, rows, notified } = makeDeps()
    const { request, created } = await requestChannel(deps, BOOKING)
    expect(created).toBe(true)
    expect(request).toMatchObject({ hotelId: 'h1', channel: 'booking', status: 'pending', hotelName: 'Hotel Frente Sol' })
    expect(rows).toHaveLength(1)
    expect(notified).toHaveLength(1)
  })

  it('guarda el mensaje y el teléfono que dejó el hotel (REQ-CAN-06)', async () => {
    const { deps } = makeDeps()
    const { request } = await requestChannel(deps, { ...BOOKING, message: 'Hotel ID en Booking: 123456', contactPhone: '809-111-2222' })
    expect(request.message).toBe('Hotel ID en Booking: 123456')
    expect(request.contactPhone).toBe('809-111-2222')
  })

  it('deja la actividad de creación: el historial arranca con el pedido', async () => {
    const { deps, activities } = makeDeps()
    await requestChannel(deps, { ...BOOKING, requestedByName: 'Luis', message: 'Somos 12 habitaciones' })
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({ kind: 'created', toStatus: 'pending', actorName: 'Luis', note: 'Somos 12 habitaciones' })
  })

  it('apretar dos veces NO genera dos pedidos', async () => {
    const { deps, rows } = makeDeps()
    const primero = await requestChannel(deps, BOOKING)
    const segundo = await requestChannel(deps, BOOKING)
    expect(segundo.created).toBe(false)
    expect(segundo.request.id).toBe(primero.request.id)
    expect(rows).toHaveLength(1)
  })

  it('una solicitud con cita agendada también cuenta como abierta', async () => {
    const { deps, rows } = makeDeps([fila({ status: 'scheduled' })])
    const { created } = await requestChannel(deps, BOOKING)
    expect(created).toBe(false)
    expect(rows).toHaveLength(1)
  })

  it('pero si la anterior se cerró, se puede volver a pedir', async () => {
    const { deps, rows } = makeDeps([fila({ id: 'vieja', status: 'rejected' })])
    const { created } = await requestChannel(deps, BOOKING)
    expect(created).toBe(true)
    expect(rows).toHaveLength(2)
  })

  it('otro canal es otro pedido', async () => {
    const { deps, rows } = makeDeps()
    await requestChannel(deps, BOOKING)
    await requestChannel(deps, { ...BOOKING, channel: 'airbnb', channelName: 'Airbnb' })
    expect(rows.map((r) => r.channel)).toEqual(['booking', 'airbnb'])
  })

  it('un fallo del aviso no pierde la solicitud', async () => {
    const { deps, rows } = makeDeps()
    deps.notify = async () => { throw new Error('SMTP caído') }
    const { created } = await requestChannel(deps, BOOKING)
    expect(created).toBe(true)
    expect(rows).toHaveLength(1)
  })
})

// ── REQ-CAN-02: la máquina de estados ────────────────────────────────────────────────────────
describe('updateChannelRequest — transiciones', () => {
  it('pending → connected es 409: nadie conecta un hotel con el que no habló', async () => {
    const { deps, rows } = makeDeps([fila()])
    const error = await updateChannelRequest(deps, 'r1', { status: 'connected' }, ADMIN).catch((e) => e)
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).httpStatus).toBe(409)
    expect(rows[0]!.status).toBe('pending')   // la fila no cambió
  })

  it('pending → rejected sin motivo es 400', async () => {
    const { deps, rows } = makeDeps([fila()])
    const error = await updateChannelRequest(deps, 'r1', { status: 'rejected' }, ADMIN).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).httpStatus).toBe(400)
    expect(rows[0]!.status).toBe('pending')
  })

  it('pending → rejected CON motivo cierra el caso y guarda el porqué', async () => {
    const { deps } = makeDeps([fila()])
    const updated = await updateChannelRequest(deps, 'r1', { status: 'rejected', resolutionReason: 'El hotel no tiene contrato con Booking' }, ADMIN)
    expect(updated.status).toBe('rejected')
    expect(updated.resolutionReason).toBe('El hotel no tiene contrato con Booking')
    expect(updated.closedAt).toBeTruthy()
  })

  it('un caso cerrado no se reabre por PUT', async () => {
    for (const cerrado of ['connected', 'rejected'] as const) {
      const { deps } = makeDeps([fila({ status: cerrado })])
      const error = await updateChannelRequest(deps, 'r1', { status: 'in_progress' }, ADMIN).catch((e) => e)
      expect(error).toBeInstanceOf(ConflictError)
    }
  })

  it('in_progress solo ofrece waiting_hotel, connected y rejected', () => {
    expect(CHANNEL_REQUEST_TRANSITIONS.in_progress).toEqual(['waiting_hotel', 'connected', 'rejected'])
    expect(() => assertTransition('in_progress', 'scheduled')).toThrow(ConflictError)
    expect(() => assertTransition('in_progress', 'connected')).not.toThrow()
  })

  it('un estado inventado se rechaza con 400 en vez de guardarse', async () => {
    const { deps } = makeDeps([fila()])
    const error = await updateChannelRequest(deps, 'r1', { status: 'lo-que-sea' }, ADMIN).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
  })

  it('el primer cambio de estado le pone dueño al caso', async () => {
    const { deps } = makeDeps([fila({ status: 'scheduled', appointmentAt: enUnaHora() })])
    const updated = await updateChannelRequest(deps, 'r1', { status: 'in_progress' }, ADMIN)
    expect(updated.assignedTo).toBe('u-admin')
  })
})

// ── REQ-CAN-04: historial ────────────────────────────────────────────────────────────────────
describe('historial de actividades', () => {
  it('tres cambios dejan tres actividades, más la de la creación', async () => {
    const { deps, activities } = makeDeps()
    const { request } = await requestChannel(deps, BOOKING)
    await scheduleAppointment(deps, request.id, { ...CITA, at: enUnaHora() }, ADMIN)
    await updateChannelRequest(deps, request.id, { status: 'in_progress' }, ADMIN)
    await updateChannelRequest(deps, request.id, { status: 'connected' }, ADMIN)

    const propias = activities.filter((a) => a.requestId === request.id)
    const kinds = propias.map((a) => a.kind)
    expect(kinds).toContain('created')
    expect(kinds).toContain('appointment_scheduled')
    expect(kinds.filter((k) => k === 'status_changed')).toHaveLength(2)
    // Creación + cita + 2 cambios de estado = los 4 movimientos del caso.
    expect(propias.filter((a) => ['created', 'appointment_scheduled', 'status_changed'].includes(a.kind))).toHaveLength(4)
    expect(propias.every((a) => a.kind === 'created' || a.actorName === 'Ana Soporte' || a.kind === 'notified_hotel')).toBe(true)
  })

  it('el cambio de estado guarda de dónde venía y a dónde fue', async () => {
    const { deps, activities } = makeDeps([fila({ status: 'in_progress' })])
    await updateChannelRequest(deps, 'r1', { status: 'waiting_hotel' }, ADMIN)
    expect(activities[0]).toMatchObject({ kind: 'status_changed', fromStatus: 'in_progress', toStatus: 'waiting_hotel', actorId: 'u-admin' })
  })

  it('una actividad que falla NO deshace el cambio que registra', async () => {
    const { deps, rows } = makeDeps([fila({ status: 'in_progress' })])
    deps.createActivity = async () => { throw new Error('tabla caída') }
    const updated = await updateChannelRequest(deps, 'r1', { status: 'connected' }, ADMIN)
    expect(updated.status).toBe('connected')
    expect(rows[0]!.status).toBe('connected')
  })

  it('la nota interna queda en el caso y en el historial, con los saltos de línea', async () => {
    const { deps, activities } = makeDeps([fila()])
    const nota = 'Llamé y no atendieron.\nReintentar el jueves.'
    const updated = await addChannelRequestNote(deps, 'r1', nota, ADMIN)
    expect(updated.notes).toBe(nota)
    expect(updated.notes).toContain('\n')
    expect(activities[0]).toMatchObject({ kind: 'note_added', actorName: 'Ana Soporte', note: nota })
  })
})

// ── REQ-CAN-03: la cita ──────────────────────────────────────────────────────────────────────
describe('scheduleAppointment', () => {
  it('agendar deja el caso en scheduled con fecha, medio y contacto', async () => {
    const { deps } = makeDeps([fila()])
    const at = enUnaHora()
    const updated = await scheduleAppointment(deps, 'r1', { at, medium: 'whatsapp', contactName: 'Luis Pérez', contactPhone: '809-555-0000', contactEmail: 'luis@hotel.com' }, ADMIN)
    expect(updated).toMatchObject({
      status: 'scheduled', appointmentMedium: 'whatsapp', contactName: 'Luis Pérez',
      contactPhone: '809-555-0000', contactEmail: 'luis@hotel.com', assignedTo: 'u-admin',
    })
    expect(updated.appointmentAt).toBe(new Date(at).toISOString())
  })

  it('una cita en el pasado es 400', async () => {
    const { deps, rows } = makeDeps([fila()])
    const error = await scheduleAppointment(deps, 'r1', { ...CITA, at: '2020-01-01T10:00:00Z' }, ADMIN).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).httpStatus).toBe(400)
    expect(rows[0]!.status).toBe('pending')
  })

  it('un medio que no existe es 400', async () => {
    const { deps } = makeDeps([fila()])
    const error = await scheduleAppointment(deps, 'r1', { ...CITA, at: enUnaHora(), medium: 'paloma-mensajera' }, ADMIN).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
  })

  it('reprogramar deja una SEGUNDA actividad, de tipo distinto', async () => {
    const { deps, activities } = makeDeps([fila()])
    await scheduleAppointment(deps, 'r1', { ...CITA, at: enUnaHora() }, ADMIN)
    await scheduleAppointment(deps, 'r1', { ...CITA, at: new Date(Date.now() + 7200_000).toISOString() }, ADMIN)
    const citas = activities.filter((a) => a.kind.startsWith('appointment_'))
    expect(citas.map((a) => a.kind)).toEqual(['appointment_scheduled', 'appointment_rescheduled'])
    expect(citas[1]!.payload?.previousAt).toBeTruthy()
  })

  it('reprogramar limpia la marca del recordatorio: la cita nueva vuelve a avisar', async () => {
    const { deps } = makeDeps([fila({ status: 'scheduled', appointmentAt: '2020-01-01T10:00:00Z', reminderSentFor: '2020-01-01T10:00:00Z' })])
    const updated = await scheduleAppointment(deps, 'r1', { ...CITA, at: enUnaHora() }, ADMIN)
    expect(updated.reminderSentFor).toBeNull()
  })

  it('no se agenda sobre un caso cerrado', async () => {
    const { deps } = makeDeps([fila({ status: 'connected' })])
    const error = await scheduleAppointment(deps, 'r1', { ...CITA, at: enUnaHora() }, ADMIN).catch((e) => e)
    expect(error).toBeInstanceOf(ConflictError)
  })
})

// ── REQ-CAN-07: los avisos al hotel ──────────────────────────────────────────────────────────
describe('avisos al hotel', () => {
  it('agendar avisa al hotel y lo deja registrado con el destinatario', async () => {
    const { deps, activities, hotelNotices } = makeDeps([fila()])
    await scheduleAppointment(deps, 'r1', { ...CITA, at: enUnaHora() }, ADMIN)
    expect(hotelNotices).toEqual([{ id: 'r1', event: 'scheduled' }])
    const aviso = activities.find((a) => a.kind === 'notified_hotel')
    expect(aviso?.note).toContain('dueño@hotel.com')
    expect(aviso?.payload?.to).toBe('dueño@hotel.com')
  })

  it('reprogramar avisa como reprogramación, no como cita nueva', async () => {
    const { deps, hotelNotices } = makeDeps([fila({ status: 'scheduled', appointmentAt: enUnaHora() })])
    await scheduleAppointment(deps, 'r1', { ...CITA, at: new Date(Date.now() + 7200_000).toISOString() }, ADMIN)
    expect(hotelNotices.map((n) => n.event)).toEqual(['rescheduled'])
  })

  it('conectar y rechazar avisan al hotel', async () => {
    const conectado = makeDeps([fila({ status: 'in_progress' })])
    await updateChannelRequest(conectado.deps, 'r1', { status: 'connected' }, ADMIN)
    expect(conectado.hotelNotices.map((n) => n.event)).toEqual(['connected'])

    const rechazado = makeDeps([fila({ status: 'in_progress' })])
    await updateChannelRequest(rechazado.deps, 'r1', { status: 'rejected', resolutionReason: 'Sin contrato' }, ADMIN)
    expect(rechazado.hotelNotices.map((n) => n.event)).toEqual(['rejected'])
  })

  it('un correo que no sale no deshace el cambio de estado', async () => {
    const { deps, rows } = makeDeps([fila({ status: 'in_progress' })])
    deps.notifyHotel = async () => { throw new Error('SMTP caído') }
    const updated = await updateChannelRequest(deps, 'r1', { status: 'connected' }, ADMIN)
    expect(updated.status).toBe('connected')
    expect(rows[0]!.status).toBe('connected')
  })
})

describe('citas vencidas', () => {
  const ayer = new Date(Date.now() - 86_400_000).toISOString()

  it('una cita de ayer todavía en scheduled está vencida', () => {
    expect(isOverdue({ status: 'scheduled', appointmentAt: ayer })).toBe(true)
  })

  it('si el caso avanzó, la cita vieja ya no está vencida', () => {
    expect(isOverdue({ status: 'in_progress', appointmentAt: ayer })).toBe(false)
    expect(isOverdue({ status: 'connected', appointmentAt: ayer })).toBe(false)
  })

  it('sin cita no hay nada vencido', () => {
    expect(isOverdue({ status: 'scheduled', appointmentAt: null })).toBe(false)
  })

  it('isAppointmentToday compara el día, no la hora', () => {
    const hoy = new Date()
    const masTarde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 30).toISOString()
    expect(isAppointmentToday({ appointmentAt: masTarde }, hoy)).toBe(true)
    expect(isAppointmentToday({ appointmentAt: ayer }, hoy)).toBe(false)
    expect(isAppointmentToday({ appointmentAt: null }, hoy)).toBe(false)
  })
})

// ── REQ-CAN-10: los 6 estados están completos de este lado también ───────────────────────────
describe('catálogo de estados', () => {
  it('cada estado tiene etiqueta y fila de transiciones', () => {
    for (const status of CHANNEL_REQUEST_STATUSES) {
      expect(CHANNEL_REQUEST_LABELS[status]).toBeTruthy()
      expect(Array.isArray(CHANNEL_REQUEST_TRANSITIONS[status])).toBe(true)
    }
  })

  it('abiertas = todo lo que no está cerrado', () => {
    expect(OPEN_STATUSES).toEqual(['pending', 'scheduled', 'in_progress', 'waiting_hotel'])
  })

  it('ninguna transición apunta a un estado inexistente', () => {
    for (const destinos of Object.values(CHANNEL_REQUEST_TRANSITIONS)) {
      for (const destino of destinos) expect(CHANNEL_REQUEST_STATUSES).toContain(destino)
    }
  })
})

describe('forHotel', () => {
  it('las notas del admin y el responsable no salen hacia el hotel', () => {
    const visible = forHotel(fila({
      notes: 'ojo, este hotel debe 2 meses', assignedTo: 'u-admin',
      appointmentAt: '2026-09-12T14:00:00Z', appointmentMedium: 'whatsapp',
    }))
    expect('notes' in visible).toBe(false)
    expect('assignedTo' in visible).toBe(false)
    // Pero sí ve en qué anda su pedido y cuándo lo llaman (REQ-CAN-06).
    expect(visible.status).toBe('pending')
    expect(visible.appointmentAt).toBe('2026-09-12T14:00:00Z')
    expect(visible.appointmentMedium).toBe('whatsapp')
  })
})
