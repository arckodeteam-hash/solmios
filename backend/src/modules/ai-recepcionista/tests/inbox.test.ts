// ai-recepcionista/tests/inbox.test.ts — Bandeja de conversaciones de WhatsApp.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import {
  listarBandeja, abrirConversacion, tomarConversacion, soltarConversacion,
  responderConversacion, registrarEntrante,
} from '../usecases/inbox'
import { estadoDeVentana, ventanaAbierta, VENTANA_MS } from '../usecases/conversation-window'

const log = silentLogger()
const HOTEL = 'h1'
const hace = (ms: number) => new Date(Date.now() - ms).toISOString()

const CONV = {
  id: 'c1', hotelId: HOTEL, channel: 'whatsapp', status: 'active',
  guestName: 'María', guestPhone: '18095550000', guestId: 'g1',
  lastMessageAt: '2026-09-07T10:00:00.000Z', lastInboundAt: hace(3600_000), unreadCount: 2,
}

function makeDeps(opts: { conv?: any; convs?: any[]; mensajes?: any[]; enviar?: () => Promise<{ messageId: string }> } = {}) {
  let conv = opts.conv === undefined ? { ...CONV } : opts.conv
  const escrituras: any[] = []
  const enviados: any[] = []
  const registrados: any[] = []

  const deps: any = {
    logger: log,
    conversationRepo: {
      findById: async (id: string) => (conv && conv.id === id ? conv : null),
      findMany: async () => opts.convs ?? (conv ? [conv] : []),
      update: async (id: string, patch: any) => { escrituras.push({ id, patch }); conv = { ...conv, ...patch }; return conv },
    },
    messageRepo: {
      findMany: async () => opts.mensajes ?? [],
      create: async (d: any) => ({ id: 'm1', ...d }),
    },
    whatsapp: {
      credentialsFor: async () => ({ wabaId: 'W', phoneNumberId: 'P', accessToken: 'T' }),
      sendText: async (_c: any, i: any) => { enviados.push(i); return opts.enviar ? opts.enviar() : { messageId: 'wamid.R1' } },
      explicarError: (e: any) => e?.message ?? 'error',
    },
    registrarEnvio: async (dto: any) => { registrados.push(dto) },
  }
  return { deps, escrituras, enviados, registrados, conv: () => conv }
}

describe('listarBandeja', () => {
  it('devuelve la ventana ya calculada, para no depender del reloj del navegador', async () => {
    const { deps } = makeDeps()
    const filas = await listarBandeja(deps, HOTEL)
    expect(filas[0].ventana).toMatchObject({ abierta: true })
    expect(filas[0].unreadCount).toBe(2)
  })

  it('ordena por actividad, la más reciente primero', async () => {
    const { deps } = makeDeps({
      convs: [
        { ...CONV, id: 'vieja', lastMessageAt: '2026-09-01T10:00:00.000Z' },
        { ...CONV, id: 'nueva', lastMessageAt: '2026-09-07T10:00:00.000Z' },
      ],
    })
    const filas = await listarBandeja(deps, HOTEL)
    expect(filas.map(f => f.id)).toEqual(['nueva', 'vieja'])
  })

  // Esta lista va al navegador: el teléfono del huésped sí, pero nada de credenciales del hotel.
  it('no filtra datos de otro hotel', async () => {
    const { deps } = makeDeps({ conv: { ...CONV, hotelId: 'otro' } })
    expect(await abrirConversacion(deps, 'c1', HOTEL).catch(e => e.message)).toContain('no encontrada')
  })
})

describe('abrirConversacion', () => {
  it('marca leída la conversación al abrirla', async () => {
    const { deps, escrituras } = makeDeps()
    await abrirConversacion(deps, 'c1', HOTEL)
    expect(escrituras[0].patch).toEqual({ unreadCount: 0 })
  })

  it('devuelve el hilo en orden cronológico', async () => {
    const { deps } = makeDeps({
      mensajes: [
        { id: 'm2', sender: 'agent', content: 'Hola', createdAt: '2026-09-07T11:00:00.000Z' },
        { id: 'm1', sender: 'guest', content: '¿Tienen lugar?', createdAt: '2026-09-07T10:00:00.000Z' },
      ],
    })
    const out: any = await abrirConversacion(deps, 'c1', HOTEL)
    expect(out.mensajes.map((m: any) => m.id)).toEqual(['m1', 'm2'])
  })

  it('no escribe si ya estaba leída', async () => {
    const { deps, escrituras } = makeDeps({ conv: { ...CONV, unreadCount: 0 } })
    await abrirConversacion(deps, 'c1', HOTEL)
    expect(escrituras.length).toBe(0)
  })
})

describe('tomar y soltar', () => {
  it('tomarla la pasa a human con el agente asignado', async () => {
    const { deps, escrituras } = makeDeps()
    await tomarConversacion(deps, 'c1', HOTEL, 'u1')
    expect(escrituras[0].patch).toEqual({ status: 'human', assignedAgentId: 'u1' })
  })

  // Dos personas escribiendo a la vez le llegan al huésped como dos voces distintas.
  it('no se le puede quitar a otra persona que ya la tomó', async () => {
    const { deps } = makeDeps({ conv: { ...CONV, status: 'human', assignedAgentId: 'otro' } })
    expect(tomarConversacion(deps, 'c1', HOTEL, 'u1')).rejects.toThrow(/ya está atendiendo/)
  })

  it('quien la tomó puede volver a tomarla sin error', async () => {
    const { deps } = makeDeps({ conv: { ...CONV, status: 'human', assignedAgentId: 'u1' } })
    await tomarConversacion(deps, 'c1', HOTEL, 'u1')
  })

  it('soltarla devuelve el control al bot', async () => {
    const { deps, escrituras } = makeDeps({ conv: { ...CONV, status: 'human', assignedAgentId: 'u1' } })
    await soltarConversacion(deps, 'c1', HOTEL)
    expect(escrituras[0].patch).toEqual({ status: 'active', assignedAgentId: null })
  })
})

describe('responderConversacion', () => {
  it('manda el texto y lo guarda en el hilo como del agente', async () => {
    const { deps, enviados, registrados } = makeDeps()
    const out: any = await responderConversacion(deps, 'c1', HOTEL, 'Sí, tenemos lugar', 'u1')
    expect(enviados[0]).toEqual({ to: '18095550000', text: 'Sí, tenemos lugar' })
    expect(out.providerMessageId).toBe('wamid.R1')
    // Sin el rastro, la respuesta no aparecería en Historial de Envíos junto al resto.
    expect(registrados[0].channel).toBe('whatsapp_api')
  })

  // La verdad la tiene el servidor: un navegador con la hora adelantada haría intentar un envío
  // que Meta rechaza y cobra igual.
  it('con la ventana cerrada no deja responder, aunque el cliente insista', async () => {
    const { deps, enviados } = makeDeps({ conv: { ...CONV, lastInboundAt: hace(VENTANA_MS + 60_000) } })
    expect(responderConversacion(deps, 'c1', HOTEL, 'Hola', 'u1')).rejects.toThrow(/24 horas/)
    await Promise.resolve()
    expect(enviados.length).toBe(0)
  })

  it('una conversación sin mensajes entrantes tiene la ventana cerrada', async () => {
    const { deps } = makeDeps({ conv: { ...CONV, lastInboundAt: null } })
    expect(responderConversacion(deps, 'c1', HOTEL, 'Hola', 'u1')).rejects.toThrow(/24 horas/)
  })

  it('un texto vacío no sale', async () => {
    const { deps, enviados } = makeDeps()
    expect(responderConversacion(deps, 'c1', HOTEL, '   ', 'u1')).rejects.toThrow(/Escribí el mensaje/)
    await Promise.resolve()
    expect(enviados.length).toBe(0)
  })

  it('si Meta rechaza, el error llega con su motivo', async () => {
    const { deps } = makeDeps({ enviar: async () => { throw new Error('Ese número no tiene WhatsApp') } })
    expect(responderConversacion(deps, 'c1', HOTEL, 'Hola', 'u1')).rejects.toThrow(/no tiene WhatsApp/)
  })
})

describe('registrarEntrante', () => {
  it('reabre la ventana y suma a los no leídos', async () => {
    const { deps, escrituras } = makeDeps()
    await registrarEntrante(deps, 'c1', HOTEL)
    expect(escrituras[0].patch.unreadCount).toBe(3)
    expect(escrituras[0].patch.lastInboundAt).toBeTruthy()
  })

  // Si el bot contesta mientras una persona atiende, el huésped recibe dos respuestas distintas.
  it('avisa que el bot debe callarse cuando alguien tomó la conversación', async () => {
    const { deps } = makeDeps({ conv: { ...CONV, status: 'human', assignedAgentId: 'u1' } })
    expect(await registrarEntrante(deps, 'c1', HOTEL)).toBe(true)
  })

  it('con el bot a cargo, no lo silencia', async () => {
    const { deps } = makeDeps()
    expect(await registrarEntrante(deps, 'c1', HOTEL)).toBe(false)
  })

  // Para el huésped es la misma charla: dejarla cerrada la haría invisible para el hotel.
  it('una conversación cerrada vuelve a la bandeja', async () => {
    const { deps, escrituras } = makeDeps({ conv: { ...CONV, status: 'closed' } })
    await registrarEntrante(deps, 'c1', HOTEL)
    expect(escrituras[0].patch.status).toBe('active')
  })

  it('ignora una conversación de otro hotel', async () => {
    const { deps, escrituras } = makeDeps({ conv: { ...CONV, hotelId: 'otro' } })
    expect(await registrarEntrante(deps, 'c1', HOTEL)).toBe(false)
    expect(escrituras.length).toBe(0)
  })
})

describe('estadoDeVentana', () => {
  const ahora = Date.parse('2026-09-07T12:00:00.000Z')

  it('informa cuánto queda, no solo si está abierta', () => {
    const v = estadoDeVentana(new Date(ahora - 60 * 60_000).toISOString(), ahora)
    expect(v.abierta).toBe(true)
    expect(v.minutosRestantes).toBe(23 * 60)
  })

  it('cerrada pasadas las 24 h', () => {
    expect(ventanaAbierta(new Date(ahora - VENTANA_MS - 1).toISOString(), ahora)).toBe(false)
  })

  it('sin entrantes, cerrada', () => {
    expect(estadoDeVentana(null, ahora)).toEqual({ abierta: false, minutosRestantes: 0, expiraEn: null })
    expect(estadoDeVentana('cualquier cosa', ahora).abierta).toBe(false)
  })
})
