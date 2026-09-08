// ai-recepcionista/tests/whatsapp-connection.test.ts — Conexión y baja del WhatsApp de un hotel.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { connectWhatsapp, disconnectWhatsapp, proyectarConexion, listarConexiones } from '../usecases/whatsapp-connection'
import type { ConnectionDeps } from '../usecases/whatsapp-connection'
import { WhatsappCloudError } from '../../../services/whatsapp-cloud-client'

const log = silentLogger()
const APP = { appId: '1727869705161184', appSecret: 'secreto' }
const INPUT = { code: 'AQB-codigo-de-un-solo-uso', phoneNumberId: '1194399700434439', wabaId: '2631160424009333' }

/**
 * Arma las dependencias con un repo en memoria y un cliente de Meta simulado.
 * `fallar` permite reventar un paso concreto para verificar que la fila NO queda a medio escribir.
 */
function makeDeps(opts: {
  fila?: any
  app?: any
  fallar?: 'exchange' | 'subscribe' | 'phone' | 'unsubscribe'
  error?: Error
} = {}) {
  let fila = opts.fila === undefined ? null : { ...opts.fila }
  const llamadas: string[] = []
  const boom = () => { throw opts.error ?? new WhatsappCloudError('El permiso de Meta venció', 400, 100) }

  const deps: ConnectionDeps = {
    logger: log,
    app: opts.app === undefined ? APP : opts.app,
    configRepo: {
      findMany: async () => (fila ? [fila] : []),
      findById: async () => fila,
      create: async (data: any) => { fila = { ...data }; llamadas.push('create'); return fila },
      update: async (_id: string, data: any) => { fila = { ...fila, ...data }; llamadas.push('update'); return fila },
    },
    client: {
      exchangeCode: async () => { llamadas.push('exchange'); if (opts.fallar === 'exchange') boom(); return { accessToken: 'TOKEN-PERMANENTE' } },
      subscribeApp: async () => { llamadas.push('subscribe'); if (opts.fallar === 'subscribe') boom() },
      unsubscribeApp: async () => { llamadas.push('unsubscribe'); if (opts.fallar === 'unsubscribe') boom() },
      registerPhoneNumber: async () => { llamadas.push('register'); return true },
      getPhoneNumber: async () => {
        llamadas.push('phone'); if (opts.fallar === 'phone') boom()
        return { displayPhoneNumber: '+1 555-678-1103', verifiedName: 'Test Number', qualityRating: 'GREEN', messagingLimit: 'TIER_250' }
      },
      getWabaInfo: async () => { llamadas.push('waba'); return { name: 'Test WhatsApp Business Account', accountReviewStatus: 'APPROVED' } },
    },
  }
  return { deps, llamadas, fila: () => fila }
}

describe('connectWhatsapp', () => {
  it('canjea el código, suscribe la app y guarda la identidad del número', async () => {
    const { deps, llamadas, fila } = makeDeps()
    await connectWhatsapp(deps, INPUT, 'h1', 'u1')

    // El orden importa: sin la suscripción el hotel queda sordo aunque la tarjeta diga "conectado".
    expect(llamadas.slice(0, 5)).toEqual(['exchange', 'subscribe', 'register', 'phone', 'waba'])
    const f = fila()!
    expect(f.connectionMode).toBe('meta')
    expect(f.accessToken).toBe('TOKEN-PERMANENTE')
    expect(f.displayPhoneNumber).toBe('+1 555-678-1103')
    expect(f.businessName).toBe('Test WhatsApp Business Account')
    expect(f.connectedByUserId).toBe('u1')
    expect(f.connectedAt).toBeTruthy()
  })

  it('actualiza la fila del hotel si ya existía, sin duplicarla', async () => {
    const { deps, llamadas } = makeDeps({ fila: { id: 'c1', hotelId: 'h1', connectionMode: 'baileys' } })
    await connectWhatsapp(deps, INPUT, 'h1')
    expect(llamadas).toContain('update')
    expect(llamadas).not.toContain('create')
  })

  // Un hotel "conectado" con un token que no sirve es PEOR que uno sin conectar: se ve verde y
  // nadie sospecha. Por eso nada se persiste hasta que Meta confirmó todos los pasos.
  it('si el código venció, no deja la conexión a medio escribir', async () => {
    const { deps, fila } = makeDeps({ fallar: 'exchange' })
    expect(connectWhatsapp(deps, INPUT, 'h1')).rejects.toThrow(/venció/)
    await Promise.resolve()
    expect(fila()).toBeNull()
  })

  it('si falla la suscripción, tampoco marca el hotel como conectado', async () => {
    const { deps, fila } = makeDeps({ fila: { id: 'c1', hotelId: 'h1', connectionMode: 'baileys' }, fallar: 'subscribe' })
    expect(connectWhatsapp(deps, INPUT, 'h1')).rejects.toThrow()
    await Promise.resolve()
    expect(fila()!.connectionMode).toBe('baileys')
  })

  it('anota el motivo del fallo para que la tarjeta pueda mostrarlo', async () => {
    const { deps, fila } = makeDeps({ fila: { id: 'c1', hotelId: 'h1' }, fallar: 'exchange' })
    try { await connectWhatsapp(deps, INPUT, 'h1') } catch { /* esperado */ }
    expect(String(fila()!.connectionError)).toContain('Meta')
  })

  // Falta de configuración del SERVIDOR, no del hotel: el mensaje tiene que distinguirlo o el
  // usuario se queda tocando el botón sin entender.
  it('sin el secreto de la app avisa que es un problema del servidor', async () => {
    const { deps, llamadas } = makeDeps({ app: null })
    expect(connectWhatsapp(deps, INPUT, 'h1')).rejects.toThrow(/no está configurada en este servidor/)
    await Promise.resolve()
    expect(llamadas).not.toContain('exchange')
  })

  it('sin código no sale a la red', async () => {
    const { deps, llamadas } = makeDeps()
    expect(connectWhatsapp(deps, { ...INPUT, code: '' }, 'h1')).rejects.toThrow(/Falta el permiso/)
    await Promise.resolve()
    expect(llamadas.length).toBe(0)
  })

  it('sin cuenta ni número no sale a la red', async () => {
    const { deps, llamadas } = makeDeps()
    expect(connectWhatsapp(deps, { ...INPUT, wabaId: '' }, 'h1')).rejects.toThrow(/no devolvió/)
    await Promise.resolve()
    expect(llamadas.length).toBe(0)
  })
})

describe('disconnectWhatsapp', () => {
  const CONECTADO = {
    id: 'c1', hotelId: 'h1', connectionMode: 'meta', accessToken: 'TOK',
    wabaId: 'W1', phoneNumberId: 'P1', baileysCredentials: { algo: true },
  }

  it('quita la suscripción en Meta ANTES de limpiar lo local', async () => {
    const { deps, llamadas, fila } = makeDeps({ fila: CONECTADO })
    await disconnectWhatsapp(deps, 'h1')
    expect(llamadas.indexOf('unsubscribe')).toBeLessThan(llamadas.indexOf('update'))
    expect(fila()!.accessToken).toBe('')
    expect(fila()!.connectionMode).toBe('none')
  })

  // Un hotel "desconectado" acá pero suscripto en Meta seguiría recibiendo webhooks que ya nadie
  // atiende, y desde el panel no habría forma de reintentar la baja.
  it('si Meta rechaza la baja, no borra nada', async () => {
    const { deps, fila } = makeDeps({ fila: CONECTADO, fallar: 'unsubscribe' })
    expect(disconnectWhatsapp(deps, 'h1')).rejects.toThrow(/no aceptó dar de baja/)
    await Promise.resolve()
    expect(fila()!.accessToken).toBe('TOK')
  })

  it('no toca las credenciales de la vinculación vieja', async () => {
    const { deps, fila } = makeDeps({ fila: CONECTADO })
    await disconnectWhatsapp(deps, 'h1')
    expect(fila()!.baileysCredentials).toEqual({ algo: true })
  })

  it('un hotel sin conexión avisa en vez de fallar en silencio', async () => {
    const { deps } = makeDeps({ fila: { id: 'c1', hotelId: 'h1' } })
    expect(disconnectWhatsapp(deps, 'h1')).rejects.toThrow(/no tiene una conexión/)
  })
})

describe('proyectarConexion', () => {
  // Esta salida va al navegador: el token no puede estar, por el mismo motivo que en
  // `redactWhatsappConfig`.
  it('nunca incluye el token ni las credenciales', () => {
    const p = proyectarConexion({ connectionMode: 'meta', accessToken: 'SECRETO', baileysCredentials: { x: 1 } })
    expect(JSON.stringify(p)).not.toContain('SECRETO')
    expect(JSON.stringify(p)).not.toContain('baileys')
  })

  it('hotel conectado por Meta', () => {
    expect(proyectarConexion({ connectionMode: 'meta', accessToken: 'T', displayPhoneNumber: '+1 555' }).estado).toBe('connected')
  })

  it('hotel con la vinculación vieja por QR se distingue de una conexión real', () => {
    expect(proyectarConexion({ connectionMode: 'baileys', baileysCredentials: { x: 1 } }).estado).toBe('legacy_baileys')
  })

  it('hotel sin nada', () => {
    expect(proyectarConexion(null).estado).toBe('disconnected')
    expect(proyectarConexion({ connectionMode: 'none' }).estado).toBe('disconnected')
  })

  it('un intento fallido queda como error, no como "sin conectar"', () => {
    expect(proyectarConexion({ connectionMode: 'none', connectionError: 'El permiso venció' }).estado).toBe('error')
  })
})


describe('listarConexiones (soporte de la plataforma)', () => {
  const repo = (filas: any[]) => ({ findMany: async () => filas })

  it('lista solo los hoteles que conectaron algo', async () => {
    const out = await listarConexiones(repo([
      { hotelId: 'h1', connectionMode: 'meta', accessToken: 'T', displayPhoneNumber: '+1 555' },
      { hotelId: 'h2', connectionMode: 'none' },
      { hotelId: 'h3', connectionMode: 'baileys', baileysCredentials: { x: 1 } },
    ]))
    expect(out.map((c: any) => c.hotelId)).toEqual(['h1', 'h3'])
  })

  // Es una vista de SOPORTE: sirve para responder "¿este hotel puede mandar mensajes?", no para
  // manipular credenciales de nadie.
  it('nunca expone tokens', async () => {
    const out = await listarConexiones(repo([
      { hotelId: 'h1', connectionMode: 'meta', accessToken: 'SECRETO', baileysCredentials: { y: 2 } },
    ]))
    expect(JSON.stringify(out)).not.toContain('SECRETO')
    expect(JSON.stringify(out)).not.toContain('baileys')
  })

  it('ordena por conexión más reciente', async () => {
    const out = await listarConexiones(repo([
      { hotelId: 'viejo', connectionMode: 'meta', accessToken: 'T', connectedAt: '2026-01-01T00:00:00.000Z' },
      { hotelId: 'nuevo', connectionMode: 'meta', accessToken: 'T', connectedAt: '2026-09-01T00:00:00.000Z' },
    ]))
    expect(out.map((c: any) => c.hotelId)).toEqual(['nuevo', 'viejo'])
  })
})
