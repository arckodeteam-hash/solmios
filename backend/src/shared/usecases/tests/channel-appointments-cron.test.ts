// channel-appointments-cron.test.ts — El recordatorio diario de citas con hoteles.
//
// Una cita agendada que nadie mira es peor que no haberla agendado: el hotel se queda esperando
// la llamada. Y un recordatorio que se repite cada tick es ruido que se aprende a ignorar — por eso
// la dedup es parte del contrato, no un detalle.

import { describe, it, expect } from 'bun:test'
import { createChannelAppointmentsCron, CHANNEL_APPOINTMENT_REMINDER_HOUR } from '../channel-appointments-cron'

// Fechas construidas en hora LOCAL a propósito: `isAppointmentToday` compara el día del servidor
// (que es el que ve el admin), así que un literal UTC haría que el test pase o falle según el TZ.
const local = (dia: number, hora: number) => new Date(2026, 8, dia, hora, 0, 0)
const iso = (dia: number, hora: number) => local(dia, hora).toISOString()
const AHORA = local(10, 8)

function fakeOrm(rows: any[], config: any[] = [{ id: 'c1', hotelId: 'platform', key: 'plataforma', value: { platformName: 'SolmiOS', supportEmail: 'soporte@ejemplo.com' } }]) {
  const activities: any[] = []
  return {
    rows, activities,
    findMany: async (model: string, q: any) => {
      if (model === 'ChannelRequests') return rows.filter((r) => !q?.status || r.status === q.status)
      if (model === 'Configuration') return config.filter((c) => c.key === q?.key && c.hotelId === q?.hotelId)
      return []
    },
    update: async (_model: string, id: string, patch: any) => {
      const i = rows.findIndex((r) => r.id === id)
      rows[i] = { ...rows[i], ...patch }
    },
    create: async (_model: string, row: any) => { activities.push(row) },
  }
}

const silencioso = { info: () => {}, warn: () => {} }

function fakeSender() {
  const sent: Array<{ to: string; subject: string; html: string }> = []
  return { sent, enqueue: async (m: any) => { sent.push(m); return 'id' } }
}

const cita = (patch: any) => ({
  id: 'r1', hotelId: 'h1', hotelName: 'Hotel Frente Sol', channel: 'booking', channelName: 'Booking.com',
  status: 'scheduled', contactName: 'Luis', contactPhone: '809-555-0000', appointmentMedium: 'call', ...patch,
})

describe('createChannelAppointmentsCron', () => {
  it('avisa de las citas de hoy y de las vencidas', async () => {
    const orm = fakeOrm([
      cita({ id: 'hoy', appointmentAt: iso(10, 15) }),
      cita({ id: 'vencida', appointmentAt: iso(8, 15) }),
      cita({ id: 'manana', appointmentAt: iso(11, 15) }),
    ])
    const sender = fakeSender()
    const r = await createChannelAppointmentsCron(orm, sender, silencioso)(AHORA)
    expect(r).toMatchObject({ today: 1, overdue: 1, sent: true })
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.to).toBe('soporte@ejemplo.com')
    expect(sender.sent[0]!.html).toContain('Hotel Frente Sol')
    expect(sender.sent[0]!.html).toContain('VENCIDA')
  })

  it('correrlo dos veces manda UN solo correo (dedup por cita)', async () => {
    const orm = fakeOrm([cita({ appointmentAt: iso(10, 15) })])
    const sender = fakeSender()
    const cron = createChannelAppointmentsCron(orm, sender, silencioso)
    await cron(AHORA)
    const segunda = await cron(AHORA)
    expect(sender.sent).toHaveLength(1)
    expect(segunda).toMatchObject({ today: 0, overdue: 0, sent: false })
    expect(orm.rows[0]!.reminderSentFor).toBe(iso(10, 15))
  })

  it('reprogramar la cita vuelve a habilitar el aviso', async () => {
    const orm = fakeOrm([cita({ appointmentAt: iso(10, 15) })])
    const sender = fakeSender()
    const cron = createChannelAppointmentsCron(orm, sender, silencioso)
    await cron(AHORA)
    // Lo que hace `scheduleAppointment` al reprogramar: nueva fecha y marca limpia.
    orm.rows[0]!.appointmentAt = iso(10, 18)
    orm.rows[0]!.reminderSentFor = null
    await cron(AHORA)
    expect(sender.sent).toHaveLength(2)
  })

  it('deja la actividad en el historial del caso', async () => {
    const orm = fakeOrm([cita({ appointmentAt: iso(8, 15) })])
    await createChannelAppointmentsCron(orm, fakeSender(), silencioso)(AHORA)
    expect(orm.activities).toHaveLength(1)
    expect(orm.activities[0]).toMatchObject({ kind: 'reminder_sent', requestId: 'r1', hotelId: 'h1' })
    expect(orm.activities[0]!.payload.overdue).toBe(true)
  })

  it('sin citas pendientes no manda nada', async () => {
    const orm = fakeOrm([cita({ appointmentAt: iso(20, 15) })])
    const sender = fakeSender()
    const r = await createChannelAppointmentsCron(orm, sender, silencioso)(AHORA)
    expect(r.sent).toBe(false)
    expect(sender.sent).toHaveLength(0)
  })

  it('sin correo de soporte configurado no reintenta para siempre: marca igual', async () => {
    const orm = fakeOrm([cita({ appointmentAt: iso(10, 15) })], [])
    const sender = fakeSender()
    const cron = createChannelAppointmentsCron(orm, sender, silencioso)
    await cron(AHORA)
    expect(sender.sent).toHaveLength(0)
    expect(orm.rows[0]!.reminderSentFor).toBe(iso(10, 15))
  })

  it('una base caída no tumba el cron', async () => {
    const roto = { findMany: async () => { throw new Error('DB caída') } }
    const r = await createChannelAppointmentsCron(roto, fakeSender(), silencioso)(AHORA)
    expect(r).toEqual({ today: 0, overdue: 0, sent: false })
  })

  it('el recordatorio sale a las 8 de la mañana del servidor', () => {
    expect(CHANNEL_APPOINTMENT_REMINDER_HOUR).toBe(8)
  })
})
