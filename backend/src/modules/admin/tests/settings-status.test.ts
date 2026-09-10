// settings-status.test.ts — GET /api/admin/settings/status (estado por servicio, plataforma).
//
// El endpoint le dice al super_admin qué servicio está configurado y de dónde sale (entorno o
// panel), sin devolver NUNCA un valor ni una pista. El test monta el módulo admin REAL sobre un
// Router/HotelAuth reales (route-permission-helpers) y verifica:
//   (a) el guard de plataforma: solo super_admin con userType admin;
//   (b) la forma: exactamente las 9 claves, cada una `{configured, source}`;
//   (c) que no se filtra nada: ningún string del body supera 20 caracteres;
//   (d) que lee la misma fuente que el código que consume el servicio (p. ej. stripe SOLO env:
//       `StripeService.getConfig()` sin hotelId ignora `configuration.stripe_config`).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Router } from 'arckode-framework'
import { makeAuth, fakeOrm, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AdminModule } from '../index'

/**
 * El fakeOrm de los helpers es sin estado (findMany siempre devuelve []), y acá el GET tiene que
 * ver filas sembradas. Se envuelve con una tabla Configuration en memoria; todo lo demás sigue
 * siendo el fake genérico. Mismo montaje que resend-config.test.ts.
 */
function mountAdminConStore() {
  const filas: any[] = []
  const base = fakeOrm()
  const orm: any = {
    ...base,
    findMany: async (table: string, filters?: any) => {
      if (table !== 'Configuration') return base.findMany(table, filters)
      return filas.filter((x) => Object.entries(filters || {}).every(([k, v]) => x[k] === v))
    },
    create: async (table: string, data: any) => {
      if (table !== 'Configuration') return base.create(table, data)
      filas.push(data)
      return data
    },
    update: async (table: string, id: string, data: any) => {
      if (table !== 'Configuration') return base.update(table, id, data)
      const i = filas.findIndex((x) => x.id === id)
      filas[i] = { ...filas[i], ...data }
      return filas[i]
    },
    delete: async (table: string, id: string) => {
      if (table !== 'Configuration') return base.delete(table, id)
      const i = filas.findIndex((x) => x.id === id)
      if (i >= 0) filas.splice(i, 1)
      return i >= 0
    },
  }
  const router = new Router()
  const auth = makeAuth()
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const mod = AdminModule() as any
  mod.create({ logger: fakeLogger(), orm, cache, router, auth })
  return { router, auth, filas }
}

const { router, auth, filas } = mountAdminConStore()

/** Token directo (tokenFor de los helpers hardcodea userType merchant — acá importa el userType). */
const headersFor = (role: string, userType: string) => ({
  authorization: `Bearer ${auth.createToken({ id: `user-${role}`, role, hotelId: 'platform', userType })}`,
})
const sa = headersFor('super_admin', 'admin')

const CLAVES = ['stripe', 'stripeWebhook', 'turnstile', 'publicUrl', 'metaApp', 'resend', 'smtp', 'googleMaps', 'channex']

/** Variables que el endpoint mira. Se limpian por test para que el resultado no dependa del .env de quien corre. */
const VARS_ENV = [
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET_PLATFORM', 'TURNSTILE_SECRET', 'PUBLIC_URL',
  'META_APP_SECRET', 'CHANNEX_API_KEY',
]
const guardado: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const v of VARS_ENV) { guardado[v] = process.env[v]; delete process.env[v] }
  filas.length = 0
})
afterEach(() => {
  for (const v of VARS_ENV) {
    if (guardado[v] === undefined) delete process.env[v]
    else process.env[v] = guardado[v]
  }
})

/** Recorre el JSON y junta todos los strings (claves y valores). */
function strings(x: unknown, acc: string[] = []): string[] {
  if (typeof x === 'string') acc.push(x)
  else if (Array.isArray(x)) x.forEach((v) => strings(v, acc))
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) { acc.push(k); strings(v, acc) }
  }
  return acc
}

describe('/api/admin/settings/status — guard de plataforma', () => {
  // Mappeo del framework: AuthError → 401 (sin token / userType rechazado por
  // requireUserType), ForbiddenError → 403 (rol rechazado por authenticate).
  it('super_admin con userType merchant → 401 (requireUserType admin lo corta)', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/status', { headers: headersFor('super_admin', 'merchant') })
    expect(res.status).toBe(401)
  })

  it('hotel_admin (merchant) → 403 (authenticate super_admin)', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/status', { headers: headersFor('hotel_admin', 'merchant') })
    expect(res.status).toBe(403)
  })

  it('sin token → 401', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/status')
    expect(res.status).toBe(401)
  })
})

describe('/api/admin/settings/status — forma de la respuesta', () => {
  it('super_admin → 200 con exactamente las 9 claves, cada una {configured, source}', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/status', { headers: sa })
    expect(res.status).toBe(200)
    const body = res.body as Record<string, any>
    expect(Object.keys(body).sort()).toEqual([...CLAVES].sort())
    for (const clave of CLAVES) {
      const v = body[clave]
      expect(Object.keys(v).sort()).toEqual(['configured', 'source'])
      expect(typeof v.configured).toBe('boolean')
      expect([null, 'env', 'configuration']).toContain(v.source)
      // source null ⇔ configured false: no puede decir "configurado" sin origen ni al revés.
      expect(v.source === null).toBe(v.configured === false)
    }
  })

  it('no filtra nada: ningún string del body (claves o valores) supera 20 caracteres', async () => {
    // Se siembran secretos largos en todas las fuentes de panel (stripe_config incluida, aunque la
    // plataforma no la use: el punto es que nada de lo que hay en la tabla viaje). Si alguno viajara, se nota.
    const LARGO = 'VALOR_FALSO_LARGUISIMO_1234567890' // > 20 chars, no es una credencial real
    filas.push(
      { id: 's', hotelId: 'platform', key: 'stripe_config', value: JSON.stringify({ secretKey: LARGO }) },
      { id: 'r', hotelId: 'platform', key: 'resend_api_key', value: LARGO },
      { id: 'e', hotelId: 'platform', key: 'email_config', value: { host: 'smtp.example.com', user: 'usuario@example.com', pass: LARGO } },
      { id: 'g', hotelId: 'platform', key: 'google_maps', value: { apiKey: LARGO } },
      { id: 'c', hotelId: 'platform', key: 'channex', value: { apiKey: LARGO, environment: 'staging' } },
    )
    process.env.STRIPE_WEBHOOK_SECRET_PLATFORM = LARGO
    process.env.TURNSTILE_SECRET = LARGO
    process.env.PUBLIC_URL = 'https://solmios.example.com/una/url/larga'
    const res = await router.resolve('GET', '/api/admin/settings/status', { headers: sa })
    expect(res.status).toBe(200)
    const todos = strings(res.body)
    expect(todos.length).toBeGreaterThan(0)
    for (const s of todos) expect(s.length).toBeLessThanOrEqual(20)
    expect(JSON.stringify(res.body)).not.toContain('LARGUISIM')
  })
})

describe('/api/admin/settings/status — fuentes', () => {
  it('sin nada configurado → todo configured:false, source:null', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/status', { headers: sa })
    const body = res.body as Record<string, any>
    expect(body.turnstile.configured).toBe(false)
    for (const clave of CLAVES) expect(body[clave]).toEqual({ configured: false, source: null })
  })

  it('fila stripe_config en configuration NO cuenta para la plataforma (StripeService.getConfig() sin hotelId → solo env)', async () => {
    filas.push({ id: 's', hotelId: 'platform', key: 'stripe_config', value: { secretKey: 'FAKE_STRIPE_x' } })
    const res = await router.resolve('GET', '/api/admin/settings/status', { headers: sa })
    expect((res.body as any).stripe).toEqual({ configured: false, source: null })
  })

  it('STRIPE_SECRET_KEY en env → stripe: env', async () => {
    process.env.STRIPE_SECRET_KEY = 'FAKE_STRIPE_env'
    const res = await router.resolve('GET', '/api/admin/settings/status', { headers: sa })
    expect((res.body as any).stripe).toEqual({ configured: true, source: 'env' })
  })

  it('variables de entorno → source env (turnstile, webhook, publicUrl, metaApp, channex)', async () => {
    process.env.TURNSTILE_SECRET = 'x'
    process.env.STRIPE_WEBHOOK_SECRET_PLATFORM = 'x'
    process.env.PUBLIC_URL = 'https://x'
    process.env.META_APP_SECRET = 'x'
    process.env.CHANNEX_API_KEY = 'x'
    const body = (await router.resolve('GET', '/api/admin/settings/status', { headers: sa })).body as Record<string, any>
    for (const clave of ['turnstile', 'stripeWebhook', 'publicUrl', 'metaApp', 'channex']) {
      expect(body[clave]).toEqual({ configured: true, source: 'env' })
    }
  })

  it('filas de panel → source configuration (resend, smtp, googleMaps, channex)', async () => {
    filas.push(
      { id: 'r', hotelId: 'platform', key: 'resend_api_key', value: 're_abcd' },
      { id: 'e', hotelId: 'platform', key: 'email_config', value: { host: 'smtp.x', user: 'u', pass: 'p' } },
      { id: 'g', hotelId: 'platform', key: 'google_maps', value: { apiKey: 'AIza' } },
      { id: 'c', hotelId: 'platform', key: 'channex', value: { apiKey: 'chx' } },
    )
    const body = (await router.resolve('GET', '/api/admin/settings/status', { headers: sa })).body as Record<string, any>
    for (const clave of ['resend', 'smtp', 'googleMaps', 'channex']) {
      expect(body[clave]).toEqual({ configured: true, source: 'configuration' })
    }
  })

  it('smtp: mismo criterio que EmailService (sin host/user/pass no cuenta; key `smtp` vieja sí)', async () => {
    filas.push({ id: 'e', hotelId: 'platform', key: 'email_config', value: { host: 'smtp.x' } })
    let body = (await router.resolve('GET', '/api/admin/settings/status', { headers: sa })).body as Record<string, any>
    expect(body.smtp).toEqual({ configured: false, source: null })
    filas.length = 0
    filas.push({ id: 'e', hotelId: 'platform', key: 'smtp', value: { server: 'smtp.x', user: 'u', password: 'p' } })
    body = (await router.resolve('GET', '/api/admin/settings/status', { headers: sa })).body as Record<string, any>
    expect(body.smtp).toEqual({ configured: true, source: 'configuration' })
  })

  it('channex: la fila del panel gana sobre CHANNEX_API_KEY (es lo que usa ChannexUseCase.platform)', async () => {
    process.env.CHANNEX_API_KEY = 'x'
    filas.push({ id: 'c', hotelId: 'platform', key: 'channex', value: { apiKey: 'chx' } })
    const body = (await router.resolve('GET', '/api/admin/settings/status', { headers: sa })).body as Record<string, any>
    expect(body.channex).toEqual({ configured: true, source: 'configuration' })
  })
})
