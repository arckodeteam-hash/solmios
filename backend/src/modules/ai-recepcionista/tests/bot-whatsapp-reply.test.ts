// ai-recepcionista/tests/bot-whatsapp-reply.test.ts — El bot contesta al WhatsApp del huésped.
//
// Cubre el envío que le faltaba a la vía Meta: la respuesta que el pipeline genera se manda por
// el mismo puerto de la bandeja, se registra con el wamid (para que los acuses lo actualicen) y
// NUNCA tira: un error de Meta se loguea y se devuelve como motivo.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { enviarRespuestaDelBot } from '../usecases/bot-whatsapp-reply'

const log = silentLogger()
const CREDS = { wabaId: 'w1', phoneNumberId: 'p1', accessToken: 't1' }

function makeDeps(opts: {
  conCredenciales?: boolean
  fallaEnvio?: Error
} = {}) {
  const enviados: Array<{ to: string; text: string }> = []
  const registrados: any[] = []

  const whatsapp: any = {
    credentialsFor: async () => (opts.conCredenciales === false ? null : CREDS),
    sendText: async (_creds: any, input: { to: string; text: string }) => {
      if (opts.fallaEnvio) throw opts.fallaEnvio
      enviados.push(input)
      return { messageId: 'wamid.TEST' }
    },
    explicarError: (err: unknown) => `explicado: ${String(err)}`,
  }

  const deps = {
    whatsapp,
    registrarEnvio: async (dto: any) => { registrados.push(dto) },
    logger: log,
  }
  return { deps, enviados, registrados }
}

const INPUT = { conversationId: 'c1', hotelId: 'h1', phone: '18095550000', text: '¡Hola! Soy Sofía.' }

describe('enviarRespuestaDelBot', () => {
  it('envía la respuesta por el puerto de WhatsApp y la registra con el wamid', async () => {
    const { deps, enviados, registrados } = makeDeps()

    const r = await enviarRespuestaDelBot(deps, INPUT)

    expect(r.enviado).toBe(true)
    expect(enviados).toHaveLength(1)
    expect(enviados[0]).toEqual({ to: '18095550000', text: '¡Hola! Soy Sofía.' })
    // Sin el providerMessageId los acuses de entrega del webhook no encuentran la fila.
    expect(registrados[0].providerMessageId).toBe('wamid.TEST')
    expect(registrados[0].channel).toBe('whatsapp')
    expect(registrados[0].status).toBe('sent')
  })

  it('sin texto no envía nada', async () => {
    const { deps, enviados } = makeDeps()
    const r = await enviarRespuestaDelBot(deps, { ...INPUT, text: '   ' })
    expect(r).toEqual({ enviado: false, motivo: 'sin-texto' })
    expect(enviados).toHaveLength(0)
  })

  it('sin puerto de WhatsApp (connector no montado) no envía y no explota', async () => {
    const r = await enviarRespuestaDelBot({ whatsapp: null, logger: log }, INPUT)
    expect(r).toEqual({ enviado: false, motivo: 'sin-puerto' })
  })

  it('hotel sin credenciales conectadas no envía', async () => {
    const { deps, enviados } = makeDeps({ conCredenciales: false })
    const r = await enviarRespuestaDelBot(deps, INPUT)
    expect(r).toEqual({ enviado: false, motivo: 'sin-credenciales' })
    expect(enviados).toHaveLength(0)
  })

  it('un error de Meta no tira: falla blanda con motivo, para no romper el webhook', async () => {
    const { deps, enviados } = makeDeps({ fallaEnvio: new Error('(#131030) recipient phone number not in allowed list') })

    const r = await enviarRespuestaDelBot(deps, INPUT)

    expect(r).toEqual({ enviado: false, motivo: 'error-de-envio' })
    expect(enviados).toHaveLength(0)
  })
})
