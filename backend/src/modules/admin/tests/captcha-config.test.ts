// admin/tests/captcha-config.test.ts — El captcha se prende desde el panel, no recompilando (#12).
//
// La barrera del alta existía pero estaba apagada: su site key era `VITE_TURNSTILE_SITE_KEY`, una
// variable de BUILD, así que activarla exigía SSH, editar dos .env y recompilar el frontend. Estos
// tests fijan las reglas del camino nuevo, que son las que hacen que prenderlo no sea peligroso.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  resolveCaptchaConfig, verifyCaptcha, estadoCaptcha, guardarCaptcha, publicCaptchaConfig,
  isCaptchaProvider, CAPTCHA_PROVIDERS, CAPTCHA_PROVIDER_META,
} from '../../../infrastructure/captcha'

const antesEnv = { ...process.env }

/** Repo de `configuration` en memoria, con la misma forma que usa el resto del proyecto. */
function fakeConfigRepo(filas: Array<Record<string, any>> = []) {
  const rows = [...filas]
  return {
    rows,
    findMany: async (q: any) => rows.filter((r) => r.hotelId === q.hotelId && r.key === q.key),
    update: async (id: string, patch: any) => { const i = rows.findIndex((r) => r.id === id); rows[i] = { ...rows[i]!, ...patch } },
    create: async (row: any) => { rows.push(row) },
  } as any
}

beforeEach(() => {
  delete process.env.TURNSTILE_SECRET
  // Clave de cifrado válida: el secreto NUNCA se persiste en claro.
  process.env.PAYMENTS_ENCRYPTION_KEY = 'x'.repeat(32)
})
afterEach(() => { process.env = { ...antesEnv } })

describe('captcha — sin configurar', () => {
  it('el alta NO exige captcha: es lo que permite levantar en local y desplegar sin claves', async () => {
    const cfg = await resolveCaptchaConfig(fakeConfigRepo())
    expect(cfg.enabled).toBe(false)
    expect(cfg.origin).toBeNull()
    expect((await verifyCaptcha(cfg, '')).ok).toBe(true)
  })

  it('la página de registro recibe enabled:false y ninguna clave', async () => {
    expect(await publicCaptchaConfig(fakeConfigRepo())).toMatchObject({ enabled: false, siteKey: '' })
  })
})

describe('captcha — el entorno gana sobre el panel', () => {
  it('con TURNSTILE_SECRET en el servidor se usa ese, aunque el panel tenga otra cosa', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'recaptcha', siteKey: 'sk-panel', secret: 'secreto-del-panel' })
    process.env.TURNSTILE_SECRET = 'secreto-del-servidor'

    const cfg = await resolveCaptchaConfig(repo)
    expect(cfg.origin).toBe('entorno')
    expect(cfg.provider).toBe('turnstile')
    expect(cfg.secret).toBe('secreto-del-servidor')
  })

  it('y la pantalla queda de sólo lectura: no puede pisar lo del servidor', async () => {
    process.env.TURNSTILE_SECRET = 'secreto-del-servidor'
    const repo = fakeConfigRepo()
    expect((await estadoCaptcha(repo)).puedeGuardar).toBe(false)
    await expect(guardarCaptcha(repo, { enabled: false })).rejects.toThrow('variables de entorno')
  })
})

describe('captcha — guardar desde el panel', () => {
  it('prende el captcha y el alta empieza a exigirlo, sin reiniciar nada', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'recaptcha', siteKey: '6Lc-sitekey', secret: '6Lc-secretkey' })
    expect(await resolveCaptchaConfig(repo)).toMatchObject({ enabled: true, provider: 'recaptcha', siteKey: '6Lc-sitekey', origin: 'panel' })
  })

  it('el secreto se persiste CIFRADO: un dump de configuration no lo entrega', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'turnstile', siteKey: 'sk', secret: 'secreto-en-claro-jamas' })
    const guardado = repo.rows[0]!.value
    expect(guardado).not.toContain('secreto-en-claro-jamas')
    expect(JSON.parse(guardado).enc).toBeTruthy()
    // Pero sigue siendo legible por quien tiene la clave.
    expect((await resolveCaptchaConfig(repo)).secret).toBe('secreto-en-claro-jamas')
  })

  it('el estado para la pantalla nunca devuelve el secreto, sólo una pista', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'turnstile', siteKey: 'sk', secret: 'secreto-larguisimo-1234' })
    const estado = await estadoCaptcha(repo)
    expect(JSON.stringify(estado)).not.toContain('secreto-larguisimo-1234')
    expect(estado.pista).toBeTruthy()
    expect(estado.configurado).toBe(true)
  })

  it('guardar sin secreto CONSERVA el ya cargado: apagar no obliga a recargar las claves', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'turnstile', siteKey: 'sk', secret: 'el-secreto' })
    await guardarCaptcha(repo, { enabled: false })
    expect((await estadoCaptcha(repo)).configurado).toBe(true)
    await guardarCaptcha(repo, { enabled: true })
    expect((await resolveCaptchaConfig(repo)).secret).toBe('el-secreto')
  })

  it('prender sin claves se rechaza: dejaría el registro pidiendo un captcha que no se puede dibujar', async () => {
    const repo = fakeConfigRepo()
    await expect(guardarCaptcha(repo, { enabled: true, provider: 'turnstile', siteKey: '' })).rejects.toThrow('clave pública')
  })

  it('sin clave de cifrado se niega a guardar en vez de persistir el secreto en claro', async () => {
    delete process.env.PAYMENTS_ENCRYPTION_KEY
    const repo = fakeConfigRepo()
    await expect(guardarCaptcha(repo, { enabled: true, siteKey: 'sk', secret: 'xxxxxxxxx' })).rejects.toThrow('PAYMENTS_ENCRYPTION_KEY')
    expect(repo.rows).toHaveLength(0)
  })

  it('apagado desde el interruptor, el alta deja de exigirlo aunque las claves sigan puestas', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'turnstile', siteKey: 'sk', secret: 'el-secreto' })
    await guardarCaptcha(repo, { enabled: false })
    const cfg = await resolveCaptchaConfig(repo)
    expect(cfg.enabled).toBe(false)
    expect((await verifyCaptcha(cfg, '')).ok).toBe(true)
  })
})

describe('captcha — proveedores', () => {
  it('los tres tienen URL de verificación, script y documentación', () => {
    for (const p of CAPTCHA_PROVIDERS) {
      const meta = CAPTCHA_PROVIDER_META[p]
      expect(meta.verifyUrl).toMatch(/^https:\/\//)
      expect(meta.scriptUrl).toMatch(/^https:\/\//)
      expect(meta.docsUrl).toMatch(/^https:\/\//)
      expect(meta.label).toBeTruthy()
      expect(meta.globalName).toBeTruthy()
    }
  })

  it('están los tres que se pueden elegir, Google incluido', () => {
    expect([...CAPTCHA_PROVIDERS]).toEqual(['turnstile', 'recaptcha', 'hcaptcha'])
    expect(CAPTCHA_PROVIDER_META.recaptcha.verifyUrl).toContain('google.com/recaptcha')
  })

  it('un proveedor inventado no se guarda: cae al de por defecto', async () => {
    expect(isCaptchaProvider('lo-que-sea')).toBe(false)
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'lo-que-sea', siteKey: 'sk', secret: 'el-secreto' })
    expect((await estadoCaptcha(repo)).provider).toBe('turnstile')
  })

  it('el catálogo del desplegable sale del backend: el frontend no duplica la lista', async () => {
    const estado = await estadoCaptcha(fakeConfigRepo())
    expect(estado.proveedores.map((p) => p.value)).toEqual([...CAPTCHA_PROVIDERS])
    expect(estado.proveedores.every((p) => p.label && p.docsUrl)).toBe(true)
  })

  it('la página de registro recibe el script y el global del proveedor elegido', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'hcaptcha', siteKey: 'sk', secret: 'el-secreto' })
    expect(await publicCaptchaConfig(repo)).toMatchObject({
      enabled: true, provider: 'hcaptcha', siteKey: 'sk',
      scriptUrl: CAPTCHA_PROVIDER_META.hcaptcha.scriptUrl, globalName: 'hcaptcha',
    })
  })

  it('el endpoint público NUNCA devuelve el secreto', async () => {
    const repo = fakeConfigRepo()
    await guardarCaptcha(repo, { enabled: true, provider: 'turnstile', siteKey: 'sk', secret: 'jamas-al-navegador' })
    expect(JSON.stringify(await publicCaptchaConfig(repo))).not.toContain('jamas-al-navegador')
  })
})

describe('captcha — verificación del token', () => {
  const cfg = { enabled: true, provider: 'turnstile' as const, siteKey: 'sk', secret: 's', origin: 'panel' as const }
  const conFetch = async (impl: any, fn: () => Promise<any>) => {
    const orig = globalThis.fetch
    globalThis.fetch = impl
    try { return await fn() } finally { globalThis.fetch = orig }
  }

  it('un token vacío se rechaza sin salir a la red', async () => {
    expect(await verifyCaptcha(cfg, '')).toMatchObject({ ok: false, reason: 'token vacío' })
  })

  it('token válido pasa', async () => {
    const r = await conFetch(async () => new Response(JSON.stringify({ success: true })), () => verifyCaptcha(cfg, 'tok'))
    expect(r.ok).toBe(true)
  })

  it('token rechazado devuelve el motivo del proveedor para el log', async () => {
    const r = await conFetch(async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] })), () => verifyCaptcha(cfg, 'tok'))
    expect(r).toMatchObject({ ok: false, reason: 'invalid-input-response' })
  })

  it('si el proveedor no responde se RECHAZA, no se deja pasar', async () => {
    // Abrir la puerta ante un fallo de red vuelve inútil la barrera justo cuando hay un ataque.
    const r = await conFetch(async () => { throw new Error('ECONNREFUSED') }, () => verifyCaptcha(cfg, 'tok'))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('inaccesible')
  })

  it('cada proveedor se valida contra SU endpoint', async () => {
    const urls: string[] = []
    const spy = async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify({ success: true })) }
    for (const provider of CAPTCHA_PROVIDERS) {
      await conFetch(spy, () => verifyCaptcha({ ...cfg, provider }, 'tok'))
    }
    expect(urls).toEqual(CAPTCHA_PROVIDERS.map((p) => CAPTCHA_PROVIDER_META[p].verifyUrl))
  })
})
