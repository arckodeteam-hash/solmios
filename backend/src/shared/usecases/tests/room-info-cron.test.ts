import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createRoomInfoCron, roomInfoDates } from '../room-info-cron'
import { ROOM_INFO_CONFIG_KEY } from '../room-info-notice'

const HOTEL = { id: 'h1', name: 'Hotel Paraíso', checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo', country: 'DO' }
// Llegada real: 2026-09-12 15:00 RD = 19:00 UTC.
const ARRIVAL = Date.parse('2026-09-12T19:00:00.000Z')
const RESERVA = { id: 'res1', hotelId: 'h1', guestId: 'g1', roomId: 'r1', checkIn: '2026-09-12', checkOut: '2026-09-13', status: 'confirmed' }
const ROOM = { id: 'r1', hotelId: 'h1', number: '204', name: 'Suite Jardín' }
const GUEST = { id: 'g1', hotelId: 'h1', name: 'Ana Pérez', email: 'ana@example.com', phone: '+18095550000' }
const LOCK = { id: 'lc1', hotelId: 'h1', reservationId: 'res1', code: '458219', status: 'active' }
const TEMPLATE = { id: 'wt1', hotelId: 'h1', name: 'Tu habitación', language: 'es', approvalStatus: 'approved', metaTemplateName: 'tu_habitacion', metaVariableOrder: ['room_number', 'lock_codes'] }

const hoursBefore = (h: number) => new Date(ARRIVAL - h * 3_600_000)

interface HarnessOptions {
  config?: Record<string, unknown> | null
  reservations?: any[]
  rooms?: any[]
  lockCodes?: any[]
  guests?: any[]
  templates?: any[]
  emailService?: 'ok' | 'throws' | 'none'
  whatsapp?: 'ok' | 'throws' | 'none'
  publicUrl?: string
}

function harness(over: HarnessOptions = {}) {
  const tables: Record<string, any[]> = {
    Hotels: [HOTEL],
    Configuration: over.config === null ? [] : [{ id: 'c1', hotelId: 'h1', key: ROOM_INFO_CONFIG_KEY, value: over.config ?? { enabled: true, hoursBefore: 12, channel: 'email' } }],
    Reservations: over.reservations ?? [RESERVA],
    Rooms: over.rooms ?? [ROOM],
    LockCodes: over.lockCodes ?? [LOCK],
    Guests: over.guests ?? [GUEST],
    MessageLogs: [],
    WhatsappTemplates: over.templates ?? [TEMPLATE],
  }
  let seq = 0
  const orm = {
    findMany: async (t: string, filter: Record<string, unknown> = {}) =>
      (tables[t] ?? []).filter(row => Object.entries(filter).every(([k, v]) => row[k] === v)),
    findById: async (t: string, id: string) => (tables[t] ?? []).find(row => row.id === id) ?? null,
    create: async (t: string, data: any) => {
      const row = { id: `${t}-${++seq}`, ...data }
      tables[t].push(row)
      return row
    },
  }

  const emails: any[] = []
  const emailService = over.emailService === 'none' ? null : {
    enqueue: async (input: any) => {
      if (over.emailService === 'throws') throw new Error('SMTP caído')
      emails.push(input)
      return `q-${emails.length}`
    },
  }

  const sends: any[] = []
  const whatsappPort = over.whatsapp === 'none' ? null : {
    credentialsFor: async () => ({ wabaId: 'w', phoneNumberId: 'p', accessToken: 't' }),
    sendTemplate: async (_creds: any, input: any) => {
      if (over.whatsapp === 'throws') throw new Error('meta rechazó')
      sends.push(input)
      return { messageId: `wamid.${sends.length}` }
    },
    sendText: async () => ({ messageId: 'x' }),
    explicarError: (e: unknown) => `Meta: ${(e as Error).message}`,
  }

  const cron = createRoomInfoCron({
    orm,
    resolveModule: (n: string) => (n === 'reservas' ? { whatsappPort } : null),
    emailService,
    logger: silentLogger(),
    publicUrl: over.publicUrl ?? 'https://pms.example.com',
    env: {},
  })
  return { cron, tables, emails, sends, logs: () => tables.MessageLogs }
}

describe('room-info-cron (#297)', () => {
  it('(a) faltan 13 h con hoursBefore 12 → no manda', async () => {
    const h = harness()
    const r = await h.cron(hoursBefore(13))
    expect(r.sent).toBe(0)
    expect(h.emails).toHaveLength(0)
    expect(h.logs()).toHaveLength(0)
  })

  it('(b) faltan 11 h → 1 email con habitación y código, registrado en message_logs', async () => {
    const h = harness()
    const r = await h.cron(hoursBefore(11))
    expect(r.sent).toBe(1)
    expect(h.emails).toHaveLength(1)
    expect(h.emails[0].to).toBe('ana@example.com')
    expect(h.emails[0].hotelId).toBe('h1')
    expect(h.emails[0].relatedType).toBe('room_info')
    expect(h.emails[0].relatedId).toBe('res1')
    expect(h.emails[0].html).toContain('204')
    expect(h.emails[0].html).toContain('458219')

    const logs = h.logs()
    expect(logs).toHaveLength(1)
    expect(logs[0].channel).toBe('email')
    expect(logs[0].messageType).toBe('email')
    expect(logs[0].status).toBe('sent')
    expect(logs[0].reservationId).toBe('res1')
    expect(logs[0].guestId).toBe('g1')
    expect(logs[0].recipient).toBe('ana@example.com')
    expect(logs[0].response).toMatch(/^auto:room_info:[0-9a-f]{16}$/)
    expect(logs[0].id).toBeTruthy()
  })

  it('(c) dos ticks seguidos → un solo envío (dedup por huella)', async () => {
    const h = harness()
    await h.cron(hoursBefore(11))
    const r2 = await h.cron(hoursBefore(10))
    expect(r2.sent).toBe(0)
    expect(h.emails).toHaveLength(1)
    expect(h.logs()).toHaveLength(1)
  })

  it('(d) sin habitación asignada → no manda ni registra (CA13)', async () => {
    const h = harness({ reservations: [{ ...RESERVA, roomId: null }] })
    const r = await h.cron(hoursBefore(11))
    expect(r.sent).toBe(0)
    expect(r.skipped).toBe(1)
    expect(h.emails).toHaveLength(0)
    expect(h.logs()).toHaveLength(0)
  })

  it('(e) cambio de habitación entre ticks → segundo envío con la habitación nueva (CA14)', async () => {
    const h = harness({ rooms: [ROOM, { id: 'r2', hotelId: 'h1', number: '305', name: 'Doble' }] })
    await h.cron(hoursBefore(11))
    h.tables.Reservations[0] = { ...RESERVA, roomId: 'r2' }
    const r2 = await h.cron(hoursBefore(10))
    expect(r2.sent).toBe(1)
    expect(h.emails).toHaveLength(2)
    expect(h.emails[1].html).toContain('305')
    const logs = h.logs()
    expect(logs).toHaveLength(2)
    expect(logs[0].response).not.toBe(logs[1].response)
  })

  it('(f) config disabled → nada', async () => {
    const h = harness({ config: { enabled: false, hoursBefore: 12, channel: 'email' } })
    expect((await h.cron(hoursBefore(11))).sent).toBe(0)
    expect(h.emails).toHaveLength(0)
  })

  it('(f bis) hotel sin config → apagado por default', async () => {
    const h = harness({ config: null })
    expect((await h.cron(hoursBefore(1))).sent).toBe(0)
    expect(h.emails).toHaveLength(0)
  })

  it('(g) hoursBefore configurable: con 48 manda a 40 h', async () => {
    const h = harness({ config: { enabled: true, hoursBefore: 48, channel: 'email' } })
    expect((await h.cron(hoursBefore(40))).sent).toBe(1)
    expect(h.emails).toHaveLength(1)
  })

  it('(h) enqueue lanza → fila failed con motivo, reintenta al tick siguiente y para tras 3 fallos', async () => {
    const h = harness({ emailService: 'throws' })
    const r1 = await h.cron(hoursBefore(11))
    expect(r1.failed).toBe(1)
    expect(r1.sent).toBe(0)
    let logs = h.logs()
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe('failed')
    expect(logs[0].channel).toBe('email')
    expect(logs[0].errorMessage).toBe('SMTP caído')

    const r2 = await h.cron(hoursBefore(10.5))
    expect(r2.failed).toBe(1)
    expect(h.logs().filter(l => l.status === 'failed')).toHaveLength(2)

    await h.cron(hoursBefore(10))
    expect(h.logs().filter(l => l.status === 'failed')).toHaveLength(3)

    const r4 = await h.cron(hoursBefore(9.5))
    expect(r4.failed).toBe(0)
    expect(r4.sent).toBe(0)
    expect(r4.skipped).toBe(1)
    logs = h.logs()
    expect(logs).toHaveLength(3)
  })

  it('(i) channel both con plantilla aprobada → email + WhatsApp con el código en los parámetros', async () => {
    const h = harness({ config: { enabled: true, hoursBefore: 12, channel: 'both', whatsappTemplateId: 'wt1' } })
    const r = await h.cron(hoursBefore(11))
    expect(r.sent).toBe(2)
    expect(r.failed).toBe(0)
    expect(h.emails).toHaveLength(1)
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].to).toBe('18095550000')
    expect(h.sends[0].name).toBe('tu_habitacion')
    expect(h.sends[0].language).toBe('es')
    expect(h.sends[0].parameters).toEqual(['204', '458219'])

    const wa = h.logs().find(l => l.channel === 'whatsapp_api')
    expect(wa).toBeTruthy()
    expect(wa.status).toBe('sent')
    expect(wa.messageType).toBe('whatsapp')
    expect(wa.providerMessageId).toBe('wamid.1')
    expect(wa.templateId).toBe('wt1')
    expect(wa.recipient).toBe('18095550000')
    expect(wa.response).toBe(h.logs().find(l => l.channel === 'email').response)

    // Segundo tick: ninguno de los dos canales se repite.
    const r2 = await h.cron(hoursBefore(10))
    expect(r2.sent).toBe(0)
    expect(h.sends).toHaveLength(1)
  })

  it('(j) channel whatsapp sin plantilla configurada → fila whatsapp_api failed con motivo', async () => {
    const h = harness({ config: { enabled: true, hoursBefore: 12, channel: 'whatsapp' } })
    const r = await h.cron(hoursBefore(11))
    expect(r.sent).toBe(0)
    expect(r.failed).toBe(1)
    expect(h.sends).toHaveLength(0)
    expect(h.emails).toHaveLength(0)
    const logs = h.logs()
    expect(logs).toHaveLength(1)
    expect(logs[0].channel).toBe('whatsapp_api')
    expect(logs[0].status).toBe('failed')
    expect(logs[0].errorMessage).toBe('sin plantilla de WhatsApp configurada')
  })

  it('(j bis) plantilla no aprobada → failed; Meta rechaza → failed con explicarError', async () => {
    const pendiente = harness({
      config: { enabled: true, hoursBefore: 12, channel: 'whatsapp', whatsappTemplateId: 'wt1' },
      templates: [{ ...TEMPLATE, approvalStatus: 'pending' }],
    })
    await pendiente.cron(hoursBefore(11))
    expect(pendiente.logs()[0].errorMessage).toBe('la plantilla de WhatsApp no está aprobada por Meta')
    expect(pendiente.sends).toHaveLength(0)

    const rechazo = harness({
      config: { enabled: true, hoursBefore: 12, channel: 'whatsapp', whatsappTemplateId: 'wt1' },
      whatsapp: 'throws',
    })
    const r = await rechazo.cron(hoursBefore(11))
    expect(r.failed).toBe(1)
    expect(rechazo.logs()[0].status).toBe('failed')
    expect(rechazo.logs()[0].errorMessage).toBe('Meta: meta rechazó')
    expect(rechazo.logs()[0].templateId).toBe('wt1')
  })

  it('(k) reserva pending (sin pagar) → nada', async () => {
    const h = harness({ reservations: [{ ...RESERVA, status: 'pending' }] })
    expect((await h.cron(hoursBefore(11))).sent).toBe(0)
    expect(h.emails).toHaveLength(0)
    expect(h.logs()).toHaveLength(0)
  })

  it('una llegada de hace más de 24 h ya no se avisa', async () => {
    const h = harness()
    const r = await h.cron(new Date(ARRIVAL + 30 * 3_600_000))
    expect(r.sent).toBe(0)
    expect(h.emails).toHaveLength(0)
  })

  it('huésped sin email → failed con motivo, sin encolar', async () => {
    const h = harness({ guests: [{ ...GUEST, email: '' }] })
    const r = await h.cron(hoursBefore(11))
    expect(r.failed).toBe(1)
    expect(h.emails).toHaveLength(0)
    expect(h.logs()[0].errorMessage).toBe('el huésped no tiene email')
  })

  it('sin código de cerradura igual manda la habitación (huella con código vacío)', async () => {
    const h = harness({ lockCodes: [] })
    expect((await h.cron(hoursBefore(11))).sent).toBe(1)
    expect(h.emails[0].html).toContain('204')
    expect(h.emails[0].html).not.toContain('Código de acceso')
  })

  it('kill-switch ROOM_INFO_NOTICE_DISABLED=1 → no toca nada', async () => {
    const h = harness()
    const cron = createRoomInfoCron({
      orm: { findMany: async () => { throw new Error('no debería consultar') }, findById: async () => null, create: async () => ({}) },
      resolveModule: () => null, emailService: null, logger: silentLogger(), publicUrl: '',
      env: { ROOM_INFO_NOTICE_DISABLED: '1' },
    })
    expect(await cron(hoursBefore(11))).toEqual({ sent: 0, failed: 0, skipped: 0 })
    expect(h.emails).toHaveLength(0)
  })

  it('(l) roomInfoDates devuelve hoy-1 .. hoy+ceil(h/24)+1 en la zona del hotel', () => {
    // 2026-09-12 01:00Z = 2026-09-11 21:00 en Santo Domingo: "hoy" es el 11, no el 12.
    const now = new Date('2026-09-12T01:00:00.000Z')
    expect(roomInfoDates(HOTEL, now, 12)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'])
    expect(roomInfoDates(HOTEL, now, 48)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'])
    expect(roomInfoDates(HOTEL, now, 168)).toHaveLength(1 + 1 + 7 + 1)
  })
})
