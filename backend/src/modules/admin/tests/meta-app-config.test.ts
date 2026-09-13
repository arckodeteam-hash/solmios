// admin/tests/meta-app-config.test.ts — Credenciales de la app de Meta (plataforma).
import { describe, it, expect, afterEach } from 'bun:test'
import { resolverCredencialesApp, resolverTokenVerificacionWebhook, estadoMetaApp, guardarMetaApp, APP_ID_POR_DEFECTO, RUTA_WEBHOOK_WHATSAPP } from '../../../infrastructure/meta-app-config'

const CLAVE_CIFRADO = 'x'.repeat(32)
const antesEnv = { ...process.env }

afterEach(() => {
  process.env = { ...antesEnv }
})

function makeRepo(filas: any[] = []) {
  const escrituras: any[] = []
  return {
    escrituras,
    filas,
    repo: {
      findMany: async (f: any) => filas.filter((x) => Object.entries(f).every(([k, v]) => x[k] === v)),
      create: async (d: any) => { filas.push(d); escrituras.push({ tipo: 'create', d }); return d },
      update: async (id: string, d: any) => {
        const i = filas.findIndex((x) => x.id === id)
        filas[i] = { ...filas[i], ...d }
        escrituras.push({ tipo: 'update', d })
        return filas[i]
      },
    },
  }
}

describe('resolverCredencialesApp', () => {
  it('sin secreto en ningún lado devuelve null', async () => {
    delete process.env.META_APP_SECRET
    expect(await resolverCredencialesApp(makeRepo().repo)).toBeNull()
  })

  it('toma el secreto del entorno', async () => {
    process.env.META_APP_SECRET = 'secreto-del-servidor'
    const r = await resolverCredencialesApp(makeRepo().repo)
    expect(r?.appSecret).toBe('secreto-del-servidor')
    expect(r?.appId).toBe(APP_ID_POR_DEFECTO)
  })

  // El entorno gana sobre el panel. Si no, un cambio desde el navegador rompería la firma de los
  // webhooks de todos los hoteles sin que nadie con acceso al servidor se entere.
  it('el entorno gana sobre lo guardado en el panel', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    const { repo } = makeRepo()
    await guardarMetaApp(repo, { appSecret: 'secreto-del-panel-largo' })

    process.env.META_APP_SECRET = 'secreto-del-servidor'
    expect((await resolverCredencialesApp(repo))?.appSecret).toBe('secreto-del-servidor')
  })

  it('sin entorno, usa el guardado en el panel', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    delete process.env.META_APP_SECRET
    const { repo } = makeRepo()
    await guardarMetaApp(repo, { appSecret: 'secreto-del-panel-largo' })
    expect((await resolverCredencialesApp(repo))?.appSecret).toBe('secreto-del-panel-largo')
  })
})

describe('guardarMetaApp', () => {
  it('guarda CIFRADO, nunca en claro', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    const { repo, filas } = makeRepo()
    await guardarMetaApp(repo, { appSecret: 'un-secreto-bien-largo' })
    expect(JSON.stringify(filas)).not.toContain('un-secreto-bien-largo')
    expect(JSON.stringify(filas)).toContain('enc')
  })

  // Un dump de la tabla entregaría la llave que firma los webhooks de TODOS los hoteles.
  it('sin clave de cifrado se niega a guardar', async () => {
    delete process.env.PAYMENTS_ENCRYPTION_KEY
    const { repo, escrituras } = makeRepo()
    expect(guardarMetaApp(repo, { appSecret: 'un-secreto-bien-largo' })).rejects.toThrow(/PAYMENTS_ENCRYPTION_KEY/)
    await Promise.resolve()
    expect(escrituras.length).toBe(0)
  })

  it('rechaza algo que no parece un secreto', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    expect(guardarMetaApp(makeRepo().repo, { appSecret: 'corto' })).rejects.toThrow(/demasiado corto/)
  })

  it('reemplaza el valor anterior en vez de acumular filas', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    const { repo, filas } = makeRepo()
    await guardarMetaApp(repo, { appSecret: 'primer-secreto-largo' })
    await guardarMetaApp(repo, { appSecret: 'segundo-secreto-largo' })
    expect(filas.length).toBe(1)
  })

  it('sin clave ni token no guarda nada', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    const { repo, escrituras } = makeRepo()
    expect(guardarMetaApp(repo, {})).rejects.toThrow(/nada que guardar/)
    await Promise.resolve()
    expect(escrituras.length).toBe(0)
  })

  // Los dos valores viven en la misma fila cifrada: tocar uno no puede borrar el otro.
  it('guardar el token del webhook conserva la clave secreta, y al revés', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    delete process.env.META_APP_SECRET
    const { repo } = makeRepo()
    await guardarMetaApp(repo, { appSecret: 'secreto-del-panel-largo' })
    await guardarMetaApp(repo, { webhookVerifyToken: 'token-del-panel' })
    expect((await resolverCredencialesApp(repo))?.appSecret).toBe('secreto-del-panel-largo')
    expect(await resolverTokenVerificacionWebhook(repo)).toBe('token-del-panel')

    await guardarMetaApp(repo, { appSecret: 'otro-secreto-del-panel' })
    expect(await resolverTokenVerificacionWebhook(repo)).toBe('token-del-panel')
  })

  it('rechaza un token de verificación demasiado corto', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    expect(guardarMetaApp(makeRepo().repo, { webhookVerifyToken: 'abc' })).rejects.toThrow(/demasiado corto/)
  })
})

describe('resolverTokenVerificacionWebhook', () => {
  it('sin token en ningún lado devuelve null', async () => {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN
    expect(await resolverTokenVerificacionWebhook(makeRepo().repo)).toBeNull()
  })

  it('sin nada en el panel, usa el del entorno', async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-del-servidor'
    expect(await resolverTokenVerificacionWebhook(makeRepo().repo)).toBe('token-del-servidor')
  })

  // Al revés que el secreto: quien opera el panel de Meta elige el token sin tocar el .env ni
  // reiniciar. Un token equivocado sólo hace fallar el alta de la URL; no rompe nada vigente.
  it('el PANEL gana sobre el entorno', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-del-servidor'
    const { repo } = makeRepo()
    await guardarMetaApp(repo, { webhookVerifyToken: 'token-del-panel' })
    expect(await resolverTokenVerificacionWebhook(repo)).toBe('token-del-panel')
  })
})

describe('estadoMetaApp', () => {
  it('nunca devuelve el secreto, solo una pista', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    delete process.env.META_APP_SECRET
    const { repo } = makeRepo()
    await guardarMetaApp(repo, { appSecret: 'un-secreto-bien-largo' })

    const e = await estadoMetaApp(repo)
    expect(JSON.stringify(e)).not.toContain('un-secreto-bien-largo')
    expect(e.configurado).toBe(true)
    expect(e.origen).toBe('panel')
    expect(e.pista).toBeTruthy()
  })

  it('dice cuándo la clave viene del servidor', async () => {
    process.env.META_APP_SECRET = 'secreto-del-servidor'
    const e = await estadoMetaApp(makeRepo().repo)
    expect(e.origen).toBe('entorno')
  })

  it('sin nada cargado lo dice claro', async () => {
    delete process.env.META_APP_SECRET
    delete process.env.META_WEBHOOK_VERIFY_TOKEN
    const e = await estadoMetaApp(makeRepo().repo)
    expect(e.configurado).toBe(false)
    expect(e.origen).toBeNull()
    expect(e.webhookToken).toEqual({ configurado: false, origen: null, pista: null })
  })

  it('informa el token del webhook sin revelarlo y con su origen', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-del-servidor-xyz'
    const { repo } = makeRepo()

    let e = await estadoMetaApp(repo)
    expect(e.webhookToken.origen).toBe('entorno')
    expect(e.webhookToken.configurado).toBe(true)

    await guardarMetaApp(repo, { webhookVerifyToken: 'token-del-panel-abc' })
    e = await estadoMetaApp(repo)
    expect(e.webhookToken.origen).toBe('panel')
    expect(JSON.stringify(e)).not.toContain('token-del-panel-abc')
    expect(e.webhookToken.pista).toBeTruthy()
  })

  // Aunque el secreto venga del servidor, el token del webhook puede estar en el panel: la fila
  // se lee siempre.
  it('con el secreto en el entorno, igual ve el token guardado en el panel', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = CLAVE_CIFRADO
    process.env.META_APP_SECRET = 'secreto-del-servidor'
    delete process.env.META_WEBHOOK_VERIFY_TOKEN
    const { repo } = makeRepo()
    await guardarMetaApp(repo, { webhookVerifyToken: 'token-del-panel-abc' })
    const e = await estadoMetaApp(repo)
    expect(e.origen).toBe('entorno')
    expect(e.webhookToken.origen).toBe('panel')
  })

  it('arma la URL del webhook desde PUBLIC_URL', async () => {
    process.env.PUBLIC_URL = 'https://solmios.com/'
    const e = await estadoMetaApp(makeRepo().repo)
    expect(e.webhookUrl).toBe('https://solmios.com' + RUTA_WEBHOOK_WHATSAPP)
    delete process.env.PUBLIC_URL
    expect((await estadoMetaApp(makeRepo().repo)).webhookUrl).toBe('')
  })
})
