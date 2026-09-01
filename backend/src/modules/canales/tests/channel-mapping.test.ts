// channel-mapping.test.ts — Mapeo de rate plans de un canal EXISTENTE, verificación y activación.
//
// Un canal que Channex muestra con "Rate Plans Mapeados (0)" no intercambia nada y no se puede
// activar. Hasta ahora el sistema solo sabía CREAR un canal nuevo con su mapeo: uno ya existente
// (armado a mano en Channex, o al que se le agregaron rate plans después) no tenía arreglo desde
// el panel. Y el activate salía a ciegas, sin decir por qué fallaba.
import { describe, it, expect, afterEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const CFG = { channexPropertyId: 'prop-1', channexApiKey: 'k' } as any

interface Captured { puts: any[]; posts: Array<{ path: string; body: any }> }

function installFetch(captured: Captured, responses: Record<string, { status?: number; body: any }> = {}) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, opts: any) => {
    const u = String(url)
    const json = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
    if (opts?.method === 'PUT') { captured.puts.push(JSON.parse(opts.body)); const r = responses.put; return json(r?.body ?? { data: {} }, r?.status ?? 200) }
    if (u.includes('/check_readiness')) { captured.posts.push({ path: 'readiness', body: null }); const r = responses.readiness; return json(r?.body ?? { data: { attributes: { errors: [] } } }, r?.status ?? 200) }
    if (u.includes('/activate')) { captured.posts.push({ path: 'activate', body: null }); const r = responses.activate; return json(r?.body ?? { data: {} }, r?.status ?? 200) }
    return json({ data: [] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(silentLogger() as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)

describe('updateChannelMapping — PUT /channels/:id', () => {
  let restore: (() => void) | undefined
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  it('manda el mapeo completo con los códigos del canal', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured)
    const res = await uc().updateChannelMapping(CFG, 'ch-1', [
      { ratePlanId: 'rp-double-bar', roomTypeCode: 'double', ratePlanCode: 'double-bar', occupancy: 2, pricingType: 'per_person', primaryOcc: true },
      { ratePlanId: 'rp-double-bb', roomTypeCode: 'double', ratePlanCode: 'double-bb' },
    ])

    expect(res).toMatchObject({ success: true, mapped: 2 })
    expect(captured.puts[0]).toEqual({
      channel: {
        rate_plans: [
          { rate_plan_id: 'rp-double-bar', settings: { room_type_code: 'double', rate_plan_code: 'double-bar', occupancy: 2, pricing_type: 'per_person', primary_occ: true } },
          // Lo que no se declara NO se manda: Channex aplica defaults del adaptador.
          { rate_plan_id: 'rp-double-bb', settings: { room_type_code: 'double', rate_plan_code: 'double-bb' } },
        ],
      },
    })
  })

  it('un rechazo de Channex vuelve con el motivo, no como éxito silencioso', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured, { put: { status: 422, body: { errors: { title: 'rate_plan_code is invalid' } } } })
    const res = await uc().updateChannelMapping(CFG, 'ch-1', [{ ratePlanId: 'rp-1', roomTypeCode: 1, ratePlanCode: 1 }])
    expect(res).toMatchObject({ success: false, mapped: 0, message: 'rate_plan_code is invalid' })
  })

  it('mandar una lista vacía BORRA el mapeo — es la semántica de reemplazo de Channex', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured)
    const res = await uc().updateChannelMapping(CFG, 'ch-1', [])
    expect(captured.puts[0]).toEqual({ channel: { rate_plans: [] } })
    expect(res.mapped).toBe(0)
  })
})

describe('checkChannelReadiness — qué falta para activar', () => {
  let restore: (() => void) | undefined
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  it('sin problemas: listo', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured)
    expect(await uc().checkChannelReadiness(CFG, 'ch-1')).toEqual({ ready: true, issues: [] })
  })

  it('devuelve los problemas como texto legible, venga la forma que venga', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured, {
      readiness: { body: { data: { attributes: { errors: ['No mapped rate plans', { title: 'Missing credentials' }] } } } },
    })
    expect(await uc().checkChannelReadiness(CFG, 'ch-1')).toEqual({
      ready: false, issues: ['No mapped rate plans', 'Missing credentials'],
    })
  })

  it('si Channex responde error, no se reporta como listo', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured, { readiness: { status: 422, body: { errors: { title: 'Channel not found' } } } })
    const res = await uc().checkChannelReadiness(CFG, 'ch-1')
    expect(res.ready).toBe(false)
    expect(res.issues).toEqual(['Channel not found'])
  })
})

describe('activateChannel — verifica ANTES de activar', () => {
  let restore: (() => void) | undefined
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  it('con el canal listo: verifica y activa', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured)
    expect(await uc().activateChannel(CFG, 'ch-1')).toMatchObject({ success: true })
    expect(captured.posts.map((p) => p.path)).toEqual(['readiness', 'activate'])
  })

  it('sin mapeo: NO llama a activate y devuelve el motivo', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured, { readiness: { body: { data: { attributes: { errors: ['No mapped rate plans'] } } } } })
    const res = await uc().activateChannel(CFG, 'ch-1')

    expect(res.success).toBe(false)
    expect(res.issues).toEqual(['No mapped rate plans'])
    // La clave: no sale a activar a ciegas. Antes el usuario solo veía "pendiente de activación".
    expect(captured.posts.map((p) => p.path)).toEqual(['readiness'])
  })

  it('si el activate falla igual, vuelve el motivo de Channex', async () => {
    const captured: Captured = { puts: [], posts: [] }
    restore = installFetch(captured, { activate: { status: 422, body: { errors: { title: 'Channel is already active' } } } })
    expect(await uc().activateChannel(CFG, 'ch-1')).toMatchObject({ success: false, message: 'Channel is already active' })
  })
})
