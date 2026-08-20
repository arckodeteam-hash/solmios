// Deuda "CORS sin headers en 401" del spec de reservas: un ErrorContract lanzado dentro del
// pipeline NO puede llegar sin Access-Control-Allow-Origin — el browser lo leería como error
// de CORS y no como el status real (401/403/409/429).
import { describe, it, expect } from 'bun:test'
import { Router, AuthError, ForbiddenError } from 'arckode-framework'
import { cors } from 'arckode-framework/middlewares'
import { corsWithErrorHeaders } from '../cors-error-headers'

const ORIGIN = 'https://panel.example'
const req = (method = 'GET'): any => ({ method, path: '/api/x', headers: { origin: ORIGIN } })
const okNext = async () => ({ status: 200, body: { ok: true } })
const unauthorizedNext = async () => {
  throw new AuthError('Invalid or expired token')
}

describe('corsWithErrorHeaders (CORS en respuestas de error)', () => {
  it('un 401 lanzado por next() llega con Access-Control-Allow-Origin', async () => {
    const mw = corsWithErrorHeaders({ origins: [ORIGIN] })
    const res = await mw(req(), unauthorizedNext)
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Invalid or expired token', code: 'AUTH_ERROR' })
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe(ORIGIN)
  })

  it('la misma forma de respuesta que construiría el catch del Router (status + toJSON)', async () => {
    const mw = corsWithErrorHeaders({ origins: [ORIGIN] })
    const res = await mw(req(), async () => {
      throw new ForbiddenError('Acceso denegado. Tipo de usuario requerido: admin')
    })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Acceso denegado. Tipo de usuario requerido: admin', code: 'FORBIDDEN' })
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe(ORIGIN)
  })

  it('origen fuera de la allowlist sigue SIN header (no se relaja la política)', async () => {
    const mw = corsWithErrorHeaders({ origins: ['https://otro.example'] })
    const res = await mw(req(), unauthorizedNext)
    expect(res.status).toBe(401)
    expect(res.headers?.['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('errores no-contrato se relanzan (el Router los loguea con stack antes del 500)', async () => {
    const mw = corsWithErrorHeaders({ origins: [ORIGIN] })
    await expect(mw(req(), async () => { throw new Error('boom inesperado') })).rejects.toThrow('boom inesperado')
  })

  it('happy path y preflight OPTIONS quedan igual que con el cors del framework', async () => {
    const mw = corsWithErrorHeaders({ origins: [ORIGIN] })
    const ok = await mw(req(), okNext)
    expect(ok.status).toBe(200)
    expect(ok.headers?.['Access-Control-Allow-Origin']).toBe(ORIGIN)

    const pre = await mw(req('OPTIONS'), okNext)
    expect(pre.status).toBe(204)
    expect(pre.headers?.['Access-Control-Allow-Origin']).toBe(ORIGIN)
    expect(pre.headers?.['Access-Control-Allow-Methods']).toContain('GET')
  })

  it('integración con Router.resolve: el 401 que escapa del handler conserva los headers', async () => {
    // Regresión del bug real: sin el wrapper, el catch de runAll construye la respuesta
    // de error fuera del cors y el 401 llega sin headers.
    const router = new Router()
    router.use(corsWithErrorHeaders({ origins: [ORIGIN] }))
    router.get('/api/x', async () => { throw new AuthError('Authentication required') })

    const res = await router.resolve('GET', '/api/x', { headers: { origin: ORIGIN } })
    expect(res.status).toBe(401)
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe(ORIGIN)

    // Control: el cors solo del framework deja pasar el bug (documenta por qué existe el wrapper).
    const bare = new Router()
    bare.use(cors({ origins: [ORIGIN] }))
    bare.get('/api/x', async () => { throw new AuthError('Authentication required') })
    const bareRes = await bare.resolve('GET', '/api/x', { headers: { origin: ORIGIN } })
    expect(bareRes.status).toBe(401)
    // El catch del Router arma la respuesta de error sin headers: ni la clave existe.
    expect(bareRes.headers?.['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
