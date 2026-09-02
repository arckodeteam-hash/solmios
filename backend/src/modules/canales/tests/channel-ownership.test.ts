// channel-ownership.test.ts — Un canal de otro hotel NO existe para este hotel.
//
// La cuenta de Channex es una sola para toda la plataforma (white-label), así que un `channelId`
// es global. Las operaciones por id lo mandaban tal cual a Channex sin comprobar de quién era:
// verificado en producción el 2026-09-02 con dos hoteles reales, "Hotel Frente Sol" leyó el
// detalle COMPLETO del canal del hotel de certificación (título, mapeo y 12 rate plans) con un
// `GET /api/channels/:id/detail`. El id no es secreto: está en la URL del panel.
//
// Peor que leer: `PUT /:id/mapping` y `POST /:id/deactivate` son escrituras — un hotel podía
// desmapear o desconectar el canal de otro.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const log = silentLogger()
/** El hotel que pregunta: su property es `prop-mia`. */
const CFG = { id: 'c1', hotelId: 'h1', channexPropertyId: 'prop-mia', syncEnabled: 1 } as any

/** Channex responde con el canal `ch-ajeno`, que cuelga de la property de OTRO hotel. */
function installFetch(calls: string[]) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, opts: any) => {
    const u = String(url)
    const method = opts?.method || 'GET'
    calls.push(`${method} ${u.split('/api/v1')[1]}`)
    const json = (d: any) => new Response(JSON.stringify(d), { status: 200 })
    if (u.includes('/channels/ch-ajeno')) {
      return json({ data: { id: 'ch-ajeno', attributes: { title: 'SolmiOS Open', channel: 'OpenChannel', is_active: true, properties: ['prop-de-otro'] } } })
    }
    if (u.includes('/channels/ch-mio')) {
      return json({ data: { id: 'ch-mio', attributes: { title: 'SolmiOS Open', channel: 'OpenChannel', is_active: true, properties: ['prop-mia'] } } })
    }
    return json({ data: [] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
let restore: (() => void) | undefined
beforeEach(() => resetChannexHttpForTests())
afterEach(() => { restore?.(); restore = undefined; resetChannexHttpForTests() })

describe('un canal de otra property', () => {
  it('no se puede leer', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    expect(await uc().getChannelDetail(CFG, 'ch-ajeno')).toBeNull()
  })

  it('no se puede re-mapear, y no sale ni un PUT', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const res = await uc().updateChannelMapping(CFG, 'ch-ajeno', [{ ratePlanId: 'rp', roomTypeCode: 'x', ratePlanCode: 'y' }])
    expect(res.success).toBe(false)
    expect(calls.some((c) => c.startsWith('PUT'))).toBe(false)
  })

  it('no se puede desconectar', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const res = await uc().deactivateChannel(CFG, 'ch-ajeno')
    expect(res.success).toBe(false)
    expect(calls.some((c) => c.includes('deactivate'))).toBe(false)
  })

  it('no se puede activar: la verificación previa ya lo frena', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const res = await uc().activateChannel(CFG, 'ch-ajeno')
    expect(res.success).toBe(false)
    expect(calls.some((c) => c.includes('activate'))).toBe(false)
  })

  it('un hotel SIN property no puede tocar ningún canal', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    expect(await uc().getChannelDetail({ hotelId: 'h9' } as any, 'ch-mio')).toBeNull()
  })
})

describe('el canal propio sigue funcionando igual', () => {
  it('se lee', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const detail = await uc().getChannelDetail(CFG, 'ch-mio')
    expect(detail?.title).toBe('SolmiOS Open')
    expect(detail?.isActive).toBe(true)
  })

  it('se re-mapea', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const res = await uc().updateChannelMapping(CFG, 'ch-mio', [{ ratePlanId: 'rp', roomTypeCode: 'twin', ratePlanCode: 'twin-bar' }])
    expect(res).toMatchObject({ success: true, mapped: 1 })
    expect(calls.some((c) => c.startsWith('PUT /channels/ch-mio'))).toBe(true)
  })
})
