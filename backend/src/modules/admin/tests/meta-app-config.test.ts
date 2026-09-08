// admin/tests/meta-app-config.test.ts — Credenciales de la app de Meta (plataforma).
import { describe, it, expect, afterEach } from 'bun:test'
import { resolverCredencialesApp, estadoMetaApp, guardarMetaApp, APP_ID_POR_DEFECTO } from '../../../infrastructure/meta-app-config'

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
    const e = await estadoMetaApp(makeRepo().repo)
    expect(e.configurado).toBe(false)
    expect(e.origen).toBeNull()
  })
})
