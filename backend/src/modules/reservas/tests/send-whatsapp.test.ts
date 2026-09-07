// reservas/tests/send-whatsapp.test.ts — Envío real por WhatsApp desde la ficha de la reserva.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { sendWhatsappForReservation, resolverVariables, ventanaAbierta, VENTANA_MS } from '../usecases/send-whatsapp'

const log = silentLogger()
const HOTEL = 'h1'
const USER = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL } as any

const RESERVA = { id: 'r1', hotelId: HOTEL, guestId: 'g1', checkIn: '2026-09-10', checkOut: '2026-09-12', code: 'HX-1' }
const HUESPED = { id: 'g1', name: 'María García', phone: '809-555-0000' }
const HOTELDATA = { id: HOTEL, name: 'Hotel Paraíso', country: 'DO' }
const PLANTILLA = {
  id: 't1', hotelId: HOTEL, name: 'Bienvenida', language: 'es',
  approvalStatus: 'approved', metaVariableOrder: ['guest_name', 'hotel_name'],
}

function makeDeps(opts: {
  reserva?: any; huesped?: any; hotel?: any; plantilla?: any
  credenciales?: any; enviar?: () => Promise<{ messageId: string }>
} = {}) {
  const logs: any[] = []
  const enviados: any[] = []
  const repo = (row: any) => ({
    findById: async () => row, findMany: async () => (row ? [row] : []),
    create: async (d: any) => d, update: async () => row, delete: async () => true,
    findOne: async () => row, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }) as any

  const deps: any = {
    logger: log,
    auth: { assertOwnership: (owner: string, req: string) => { if (owner !== req) { const e: any = new Error('Forbidden'); e.name = 'AuthError'; throw e } } },
    reservationRepo: repo(opts.reserva === undefined ? RESERVA : opts.reserva),
    // `assertReservationOwned` resuelve el hotel del usuario POR SU ID: un mock que devuelve
    // siempre el mismo usuario haría pasar el test de ownership sin probar nada.
    userRepo: { ...repo(null), findById: async (id: string) => ({ id, hotelId: id === 'u1' ? HOTEL : 'h2' }) },
    guestRepo: repo(opts.huesped === undefined ? HUESPED : opts.huesped),
    hotelRepo: repo(opts.hotel === undefined ? HOTELDATA : opts.hotel),
    templateRepo: repo(opts.plantilla === undefined ? PLANTILLA : opts.plantilla),
    messageLogRepo: {
      ...repo(null),
      create: async (d: any) => { const row = { id: `log${logs.length + 1}`, ...d }; logs.push(row); return row },
      update: async (id: string, patch: any) => { const row = logs.find(l => l.id === id); Object.assign(row, patch); return row },
      findById: async (id: string) => logs.find(l => l.id === id) ?? null,
    },
    whatsapp: {
      credentialsFor: async () => (opts.credenciales === undefined
        ? { wabaId: 'W', phoneNumberId: 'P', accessToken: 'T' } : opts.credenciales),
      sendTemplate: async (_c: any, i: any) => { enviados.push({ tipo: 'template', ...i }); return opts.enviar ? opts.enviar() : { messageId: 'wamid.ABC' } },
      sendText: async (_c: any, i: any) => { enviados.push({ tipo: 'text', ...i }); return opts.enviar ? opts.enviar() : { messageId: 'wamid.TXT' } },
      explicarError: (e: any) => e?.message ?? 'error',
    },
  }
  return { deps, logs, enviados }
}

describe('sendWhatsappForReservation', () => {
  it('envía la plantilla con las variables en el orden que registró Meta', async () => {
    const { deps, logs, enviados } = makeDeps()
    await sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)

    expect(enviados[0].to).toBe('18095550000')
    expect(enviados[0].name).toBe('bienvenida')
    expect(enviados[0].parameters).toEqual(['María García', 'Hotel Paraíso'])
    expect(logs[0].status).toBe('sent')
    expect(logs[0].providerMessageId).toBe('wamid.ABC')
    expect(logs[0].channel).toBe('whatsapp_api')
  })

  // Si la fila se creara DESPUÉS del envío, un proceso que muere en el medio dejaría al huésped
  // con un mensaje que el hotel no ve en ningún lado — y que se volvería a mandar, y a cobrar.
  it('deja el rastro ANTES de salir a la red', async () => {
    const orden: string[] = []
    const { deps } = makeDeps()
    const crearOriginal = deps.messageLogRepo.create
    deps.messageLogRepo.create = async (d: any) => { orden.push('log'); return crearOriginal(d) }
    const enviarOriginal = deps.whatsapp.sendTemplate
    deps.whatsapp.sendTemplate = async (c: any, i: any) => { orden.push('envio'); return enviarOriginal(c, i) }

    await sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)
    expect(orden).toEqual(['log', 'envio'])
  })

  it('un fallo de Meta queda como failed con el motivo, nunca como enviado', async () => {
    const { deps, logs } = makeDeps({ enviar: async () => { throw new Error('Ese número no tiene WhatsApp') } })
    expect(sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)).rejects.toThrow(/no tiene WhatsApp/)
    await new Promise(r => setTimeout(r, 5))
    expect(logs[0].status).toBe('failed')
    expect(logs[0].errorMessage).toContain('no tiene WhatsApp')
  })

  it('sin WhatsApp conectado corta antes de crear el registro', async () => {
    const { deps, logs } = makeDeps({ credenciales: null })
    expect(sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)).rejects.toThrow(/no conectó su WhatsApp/)
    await Promise.resolve()
    expect(logs.length).toBe(0)
  })

  // Meta cobra el intento y lo rechaza igual: frenar antes ahorra plata y un rechazo en la cuenta.
  it('una plantilla sin aprobar no se manda', async () => {
    const { deps, enviados } = makeDeps({ plantilla: { ...PLANTILLA, approvalStatus: 'pending' } })
    expect(sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)).rejects.toThrow(/todavía no aprobó/)
    await Promise.resolve()
    expect(enviados.length).toBe(0)
  })

  it('una plantilla de otro hotel no se puede usar', async () => {
    const { deps } = makeDeps({ plantilla: { ...PLANTILLA, hotelId: 'otro' } })
    expect(sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)).rejects.toThrow(/no encontrada/)
  })

  // Mandarle la reserva de un huésped a un número inventado no se deshace.
  it('un teléfono que no se puede normalizar frena el envío', async () => {
    const { deps, enviados } = makeDeps({ huesped: { ...HUESPED, phone: '123' } })
    expect(sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)).rejects.toThrow(/teléfono válido/)
    await Promise.resolve()
    expect(enviados.length).toBe(0)
  })

  it('un huésped sin teléfono frena el envío', async () => {
    const { deps } = makeDeps({ huesped: { ...HUESPED, phone: null } })
    expect(sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, USER)).rejects.toThrow(/teléfono válido/)
  })

  it('un usuario de otro hotel no puede enviar', async () => {
    const { deps } = makeDeps()
    expect(sendWhatsappForReservation(deps, 'r1', { templateId: 't1' }, { id: 'u2', role: 'hotel_admin', hotelId: 'h2' } as any))
      .rejects.toThrow(/Forbidden/)
  })

  describe('ventana de 24 horas', () => {
    it('sin plantilla y con la ventana cerrada, no deja escribir texto libre', async () => {
      const { deps, enviados } = makeDeps()
      expect(sendWhatsappForReservation(deps, 'r1', { text: 'Hola' }, USER)).rejects.toThrow(/24 horas/)
      await Promise.resolve()
      expect(enviados.length).toBe(0)
    })

    it('con la ventana abierta, el texto libre sale como texto', async () => {
      const { deps, enviados } = makeDeps({ reserva: { ...RESERVA, lastInboundAt: new Date().toISOString() } })
      await sendWhatsappForReservation(deps, 'r1', { text: 'Hola María' }, USER)
      expect(enviados[0].tipo).toBe('text')
      expect(enviados[0].text).toBe('Hola María')
    })

    it('sin texto ni plantilla, pide uno de los dos', async () => {
      const { deps } = makeDeps()
      expect(sendWhatsappForReservation(deps, 'r1', {}, USER)).rejects.toThrow(/Escribí el mensaje/)
    })
  })
})

describe('ventanaAbierta', () => {
  const ahora = Date.parse('2026-09-07T12:00:00.000Z')

  it('abierta dentro de las 24 h', () => {
    expect(ventanaAbierta(new Date(ahora - 23 * 3600_000).toISOString(), ahora)).toBe(true)
  })

  it('cerrada pasadas las 24 h', () => {
    expect(ventanaAbierta(new Date(ahora - VENTANA_MS - 1000).toISOString(), ahora)).toBe(false)
  })

  // Sin bandeja de entrada todavía no hay entrantes registrados. Asumir abierta produciría un
  // rechazo de Meta y una conversación cobrada que no se entrega.
  it('sin ningún mensaje entrante se asume cerrada', () => {
    expect(ventanaAbierta(null, ahora)).toBe(false)
    expect(ventanaAbierta('no es una fecha', ahora)).toBe(false)
  })
})

describe('resolverVariables', () => {
  it('devuelve los valores en el orden que pide Meta', () => {
    expect(resolverVariables(['hotel_name', 'guest_name'], { guest: HUESPED, hotel: HOTELDATA }))
      .toEqual(['Hotel Paraíso', 'María García'])
  })

  // Meta rechaza un parámetro vacío: el mensaje no saldría por un dato que la reserva no tiene.
  it('un dato que falta va como guión, no vacío', () => {
    expect(resolverVariables(['room_number'], { reservation: {} })).toEqual(['—'])
  })

  it('sin huésped cargado usa un tratamiento genérico', () => {
    expect(resolverVariables(['guest_name'], {})).toEqual(['Huésped'])
  })
})
