// resend-config.test.ts — GET/PUT/DELETE /api/admin/settings/resend (API key de Resend, plataforma).
//
// Resend es el respaldo de correo cuando no hay SMTP. La key se guarda en configuration
// (hotelId 'platform', key 'resend_api_key') como string plano, que es lo que lee
// EmailService.resolveResendKey. El test monta el módulo admin REAL sobre un Router/HotelAuth
// reales (route-permission-helpers) y verifica:
//   (a) el guard de plataforma: solo super_admin con userType admin;
//   (b) el ciclo PUT → GET → DELETE: el estado refleja lo guardado, y la key NUNCA vuelve
//       al navegador (solo `configured` + últimos 4);
//   (c) un PUT con key vacía es 400, no un borrado silencioso.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { makeAuth, fakeOrm, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AdminModule } from '../index'

/**
 * El fakeOrm de los helpers es sin estado (findMany siempre devuelve []), y acá el GET después
 * del PUT tiene que ver la fila. Se envuelve con una tabla Configuration en memoria; todo lo
 * demás sigue siendo el fake genérico. Mismo montaje que mountModule, sin tocar los helpers.
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

const KEY = 're_abcd1234wxyz'

describe('/api/admin/settings/resend — guard de plataforma', () => {
  // Mappeo del framework: AuthError → 401 (sin token / userType rechazado por
  // requireUserType), ForbiddenError → 403 (rol rechazado por authenticate).
  it('super_admin con userType merchant → 401 (requireUserType admin lo corta)', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/resend', { headers: headersFor('super_admin', 'merchant') })
    expect(res.status).toBe(401)
  })

  it('hotel_admin (merchant) → 403 (authenticate super_admin)', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/resend', { headers: headersFor('hotel_admin', 'merchant') })
    expect(res.status).toBe(403)
  })

  it('sin token → 401', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/resend')
    expect(res.status).toBe(401)
  })

  it('PUT y DELETE también exigen super_admin admin', async () => {
    expect((await router.resolve('PUT', '/api/admin/settings/resend', { headers: headersFor('hotel_admin', 'merchant'), body: { apiKey: KEY } })).status).toBe(403)
    expect((await router.resolve('DELETE', '/api/admin/settings/resend', { headers: headersFor('super_admin', 'merchant') })).status).toBe(401)
  })
})

describe('/api/admin/settings/resend — ciclo PUT → GET → DELETE', () => {
  it('GET inicial: no configurada', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/resend', { headers: sa })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: false, last4: null })
  })

  it('PUT guarda la key como string plano y devuelve el estado con los últimos 4', async () => {
    const res = await router.resolve('PUT', '/api/admin/settings/resend', { headers: sa, body: { apiKey: KEY } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: true, last4: 'wxyz' })
    // Lo que lee resolveResendKey: string plano en platform/resend_api_key, sin cifrar ni envolver.
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ hotelId: 'platform', key: 'resend_api_key', value: KEY })
  })

  it('GET después del PUT: configurada, y la key NO viaja al navegador', async () => {
    const res = await router.resolve('GET', '/api/admin/settings/resend', { headers: sa })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: true, last4: 'wxyz' })
    expect(JSON.stringify(res.body)).not.toContain(KEY)
  })

  it('un segundo PUT actualiza la misma fila (no duplica)', async () => {
    const res = await router.resolve('PUT', '/api/admin/settings/resend', { headers: sa, body: { apiKey: '  re_otra_key_9999  ' } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: true, last4: '9999' })
    expect(filas).toHaveLength(1)
    expect(filas[0].value).toBe('re_otra_key_9999')
  })

  it('PUT con apiKey vacía → 400 {error} y no toca lo guardado', async () => {
    const res = await router.resolve('PUT', '/api/admin/settings/resend', { headers: sa, body: { apiKey: '' } })
    expect(res.status).toBe(400)
    expect(typeof (res.body as any).error).toBe('string')
    expect(filas[0].value).toBe('re_otra_key_9999')
  })

  it('DELETE quita la key → configured:false', async () => {
    const res = await router.resolve('DELETE', '/api/admin/settings/resend', { headers: sa })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: false, last4: null })
    expect(filas).toHaveLength(0)
    const after = await router.resolve('GET', '/api/admin/settings/resend', { headers: sa })
    expect(after.body).toEqual({ configured: false, last4: null })
  })
})

describe('estado — formas viejas del value', () => {
  // resolveResendKey acepta { key } / { api_key } además del string plano: la pantalla tiene que
  // decir lo mismo que el envío para no mostrar "no configurada" con una key que sí funciona.
  it('reconoce { key } y { api_key } como configurada', async () => {
    filas.push({ id: 'vieja', hotelId: 'platform', key: 'resend_api_key', value: { api_key: 're_legacy_key_abcd' } })
    const res = await router.resolve('GET', '/api/admin/settings/resend', { headers: sa })
    expect(res.body).toEqual({ configured: true, last4: 'abcd' })
    filas.length = 0
  })
})
