// ai-recepcionista/tests/webhook-verify.test.ts — El GET con el que Meta da de alta la URL del
// webhook. El token de la plataforma sale del panel del super_admin (o del entorno de respaldo).
import { describe, it, expect, afterEach } from 'bun:test'
import { AiRecepcionistaController } from '../controller'
import { guardarMetaApp } from '../../../infrastructure/meta-app-config'

const antesEnv = { ...process.env }
afterEach(() => {
  process.env = { ...antesEnv }
})

function makeRepo(filas: any[] = []) {
  return {
    findMany: async (f: any) => filas.filter((x) => Object.entries(f).every(([k, v]) => x[k] === v)),
    create: async (d: any) => { filas.push(d); return d },
    update: async (id: string, d: any) => {
      const i = filas.findIndex((x) => x.id === id)
      filas[i] = { ...filas[i], ...d }
      return filas[i]
    },
  }
}

function makeController(configRepo: any) {
  const service = { configRepo, whatsappConfigRepo: makeRepo([]) }
  const logger = { info() {}, warn() {}, error() {}, debug() {} }
  return new AiRecepcionistaController(service as any, logger as any)
}

const altaDeMeta = (token: string) => ({
  query: { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': 'DESAFIO-4711' },
})

describe('GET /api/ai/whatsapp/webhook (alta de Meta)', () => {
  it('con el token guardado en el panel devuelve el desafío pelado, como texto', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = 'x'.repeat(32)
    delete process.env.META_WEBHOOK_VERIFY_TOKEN
    const configRepo = makeRepo()
    await guardarMetaApp(configRepo, { webhookVerifyToken: 'token-del-panel' })

    const res: any = await makeController(configRepo).whatsappWebhookVerify(altaDeMeta('token-del-panel'))
    expect(res.status).toBe(200)
    expect(Buffer.isBuffer(res.body)).toBe(true)
    expect(res.body.toString('utf8')).toBe('DESAFIO-4711')
    expect(res.headers['Content-Type']).toBe('text/plain')
  })

  it('sin token en el panel, acepta el del entorno', async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-del-servidor'
    const res: any = await makeController(makeRepo()).whatsappWebhookVerify(altaDeMeta('token-del-servidor'))
    expect(res.status).toBe(200)
  })

  // El panel gana: una vez cargado ahí, el del .env deja de abrir la puerta.
  it('con token en el panel, el del entorno ya no sirve', async () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = 'x'.repeat(32)
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-del-servidor'
    const configRepo = makeRepo()
    await guardarMetaApp(configRepo, { webhookVerifyToken: 'token-del-panel' })

    const c = makeController(configRepo)
    expect((await c.whatsappWebhookVerify(altaDeMeta('token-del-servidor')) as any).status).toBe(403)
    expect((await c.whatsappWebhookVerify(altaDeMeta('token-del-panel')) as any).status).toBe(200)
  })

  it('token equivocado o sin token en ningún lado → 403', async () => {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN
    const c = makeController(makeRepo())
    expect((await c.whatsappWebhookVerify(altaDeMeta('cualquiera')) as any).status).toBe(403)
    expect((await c.whatsappWebhookVerify({ query: {} }) as any).status).toBe(403)
  })
})
