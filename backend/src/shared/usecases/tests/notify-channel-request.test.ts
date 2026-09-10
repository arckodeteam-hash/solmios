// notify-channel-request.test.ts — El pedido tiene que llegarle a alguien, y el hotel tiene que
// enterarse de lo que pasa con el suyo.
//
// Antes el aviso al admin era una línea de log: el hotel apretaba "Solicitar Conexión", veía
// "listo, te contactamos" y del otro lado no pasaba nada hasta que alguien entraba a la bandeja
// por casualidad. Y el hotel nunca supo cuándo lo iban a llamar ni por qué lo rechazaron.

import { describe, it, expect } from 'bun:test'
import {
  notifyAdminOfChannelRequest, notifyHotelOfChannelRequest, formatAppointment, mediumLabel,
  CHANNEL_REQUEST_EMAIL_EVENTS,
} from '../notify-channel-request'
import { CHANNEL_REQUEST_EMAIL_TEMPLATES } from '../channel-request-email-templates'
import { renderTemplate } from '../../../services/notification-renderer'
import type { ChannelRequestRow } from '../../../modules/canales/usecases/channel-requests'

const IDENTIDAD = { platformName: 'Mi Plataforma', supportEmail: 'soporte@ejemplo.com', supportPhone: '809-000-0000' }

const pedido = (patch: Partial<ChannelRequestRow> = {}): ChannelRequestRow => ({
  id: 'r1', hotelId: 'h1', hotelName: 'Hotel Frente Sol', channel: 'booking', channelName: 'Booking.com',
  status: 'pending', requestedByEmail: 'dueño@hotel.com', ...patch,
} as ChannelRequestRow)

function fakeSender() {
  const sent: any[] = []
  return { sent, enqueue: async (m: any) => { sent.push(m); return 'id' } }
}

describe('notifyAdminOfChannelRequest', () => {
  const base = {
    platformIdentity: async () => IDENTIDAD,
    findAdminUsers: async () => [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Beto' }],
    publicUrl: 'https://hotel.example',
  }

  it('manda el correo al soporte con el mensaje y el teléfono del hotel', async () => {
    const sender = fakeSender()
    const notificaciones = { creadas: [] as any[], create: async (dto: any) => { notificaciones.creadas.push(dto) } }
    const r = await notifyAdminOfChannelRequest(
      { ...base, emailSender: sender, notificaciones },
      pedido({ message: 'Hotel ID en Booking: 123456', contactPhone: '809-555-0000', requestedByName: 'Luis' }),
    )
    expect(r).toEqual({ emailed: true, notified: 2 })
    expect(sender.sent[0].to).toBe('soporte@ejemplo.com')
    expect(sender.sent[0].subject).toContain('Mi Plataforma')
    expect(sender.sent[0].html).toContain('Hotel ID en Booking: 123456')
    expect(sender.sent[0].html).toContain('809-555-0000')
    expect(sender.sent[0].html).toContain('/admin/channels')
  })

  it('la campanita del admin es de la PLATAFORMA, no del hotel que pidió', async () => {
    const notificaciones = { creadas: [] as any[], create: async (dto: any) => { notificaciones.creadas.push(dto) } }
    await notifyAdminOfChannelRequest({ ...base, notificaciones }, pedido({}))
    expect(notificaciones.creadas).toHaveLength(2)
    expect(notificaciones.creadas[0]).toMatchObject({ hotelId: 'platform', userId: 'u1', type: 'system' })
    expect(notificaciones.creadas[0].title).toContain('Booking.com')
  })

  it('sin correo de soporte cargado no se inventa un destinatario', async () => {
    const sender = fakeSender()
    const r = await notifyAdminOfChannelRequest(
      { ...base, platformIdentity: async () => ({ ...IDENTIDAD, supportEmail: '' }), emailSender: sender },
      pedido({}),
    )
    expect(r.emailed).toBe(false)
    expect(sender.sent).toHaveLength(0)
  })

  it('un correo que explota no impide la campanita (ni al revés)', async () => {
    const notificaciones = { create: async () => { throw new Error('tabla caída') } }
    const r = await notifyAdminOfChannelRequest(
      { ...base, emailSender: { enqueue: async () => { throw new Error('SMTP caído') } }, notificaciones },
      pedido({}),
    )
    expect(r).toEqual({ emailed: false, notified: 0 })
  })
})

describe('notifyHotelOfChannelRequest', () => {
  function capture() {
    const calls: Array<{ event: string; to: string; vars: Record<string, string> }> = []
    return {
      calls,
      sendPlatformEvent: async (event: string, to: string, _h: string, vars: Record<string, string>) => {
        calls.push({ event, to, vars }); return { sent: true }
      },
    }
  }
  const base = { platformIdentity: async () => IDENTIDAD, publicUrl: 'https://hotel.example' }

  it('la cita viaja con fecha, hora y medio legibles', async () => {
    const cap = capture()
    const at = new Date(2026, 8, 12, 10, 30).toISOString()
    const r = await notifyHotelOfChannelRequest(
      { ...base, sendPlatformEvent: cap.sendPlatformEvent },
      pedido({ appointmentAt: at, appointmentMedium: 'whatsapp', contactName: 'Ana Soporte', contactEmail: 'luis@hotel.com' }),
      'scheduled',
    )
    expect(r).toEqual({ sent: true, to: 'luis@hotel.com' })
    expect(cap.calls[0]!.event).toBe('channel_request_scheduled')
    expect(cap.calls[0]!.vars.appointment_date).toContain('12')
    expect(cap.calls[0]!.vars.appointment_time).toBeTruthy()
    expect(cap.calls[0]!.vars.appointment_medium).toBe('WhatsApp')
    expect(cap.calls[0]!.vars.contact_name).toBe('Ana Soporte')
    expect(cap.calls[0]!.vars.platform_name).toBe('Mi Plataforma')
  })

  it('reprogramar usa la misma plantilla que agendar (el texto ya lleva la fecha)', () => {
    expect(CHANNEL_REQUEST_EMAIL_EVENTS.rescheduled).toBe(CHANNEL_REQUEST_EMAIL_EVENTS.scheduled)
  })

  it('el rechazo lleva el motivo', async () => {
    const cap = capture()
    await notifyHotelOfChannelRequest(
      { ...base, sendPlatformEvent: cap.sendPlatformEvent },
      pedido({ status: 'rejected', resolutionReason: 'El hotel no tiene contrato con Booking' }),
      'rejected',
    )
    expect(cap.calls[0]!.event).toBe('channel_request_rejected')
    expect(cap.calls[0]!.vars.reason).toBe('El hotel no tiene contrato con Booking')
  })

  it('sin destinatario en la solicitud cae al correo del hotel', async () => {
    const cap = capture()
    const r = await notifyHotelOfChannelRequest(
      { ...base, sendPlatformEvent: cap.sendPlatformEvent, findHotel: async () => ({ name: 'Hotel Frente Sol', email: 'hola@frentesol.com' }) },
      pedido({ requestedByEmail: null }),
      'connected',
    )
    expect(r.to).toBe('hola@frentesol.com')
  })

  it('sin ningún correo no se manda nada', async () => {
    const cap = capture()
    const r = await notifyHotelOfChannelRequest(
      { ...base, sendPlatformEvent: cap.sendPlatformEvent, findHotel: async () => null },
      pedido({ requestedByEmail: null }),
      'connected',
    )
    expect(r).toEqual({ sent: false })
    expect(cap.calls).toHaveLength(0)
  })
})

describe('las plantillas del hotel (REQ-CAN-07)', () => {
  const VARS = {
    hotel_name: 'Hotel Frente Sol', channel_name: 'Booking.com',
    appointment_date: '12 de septiembre de 2026', appointment_time: '10:30',
    appointment_medium: 'WhatsApp', contact_name: 'Ana Soporte',
    reason: 'El hotel no tiene contrato con Booking', link: 'https://hotel.example/panel/channel-manager',
    platform_name: 'Mi Plataforma', support_email: 'soporte@ejemplo.com', support_phone: '809-000-0000',
  }

  it('están las tres, y son las que el usecase dispara', () => {
    const eventos = CHANNEL_REQUEST_EMAIL_TEMPLATES.map((t) => t.event)
    expect(eventos).toEqual(['channel_request_scheduled', 'channel_request_connected', 'channel_request_rejected'])
    for (const evento of Object.values(CHANNEL_REQUEST_EMAIL_EVENTS)) expect(eventos).toContain(evento)
  })

  it('ninguna tiene el nombre de la plataforma escrito a mano', () => {
    for (const t of CHANNEL_REQUEST_EMAIL_TEMPLATES) {
      expect(`${t.subject} ${t.body}`.toLowerCase()).not.toContain('solmios')
      expect(`${t.subject} ${t.body}`).toContain('{platform_name}')
    }
  })

  it('renderizan sin dejar un {placeholder} colgado', () => {
    for (const t of CHANNEL_REQUEST_EMAIL_TEMPLATES) {
      const subject = renderTemplate(t.subject, VARS, false)
      const body = renderTemplate(t.body, VARS, true)
      expect(subject).not.toMatch(/\{[a-z_]+\}/)
      expect(body).not.toMatch(/\{[a-z_]+\}/)
      expect(body).toContain('Mi Plataforma')
    }
  })

  it('la de la cita dice cuándo, a qué hora y por dónde', () => {
    const t = CHANNEL_REQUEST_EMAIL_TEMPLATES.find((x) => x.event === 'channel_request_scheduled')!
    const body = renderTemplate(t.body, VARS, true)
    expect(body).toContain('12 de septiembre de 2026')
    expect(body).toContain('10:30')
    expect(body).toContain('WhatsApp')
  })
})

describe('formatAppointment / mediumLabel', () => {
  it('una fecha inválida no rompe el correo, sale vacía', () => {
    expect(formatAppointment('no-es-fecha')).toEqual({ date: '', time: '' })
    expect(formatAppointment(null)).toEqual({ date: '', time: '' })
  })

  it('los medios tienen nombre en español', () => {
    expect(mediumLabel('call')).toBe('Llamada')
    expect(mediumLabel('video')).toBe('Videollamada')
    expect(mediumLabel('humo')).toBe('')
  })
})
