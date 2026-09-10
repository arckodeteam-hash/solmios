// channex-webhook.test.ts — El receptor del webhook de reservas, sin HTTP ni base de datos: el
// usecase recibe sus puertos por parámetro, así que los fakes son objetos a mano. Es el único
// lugar donde se prueban el 401 y el 200 del endpoint público (la ruta de `index.ts` es un
// adaptador de 3 líneas sobre esto).
import { describe, it, expect } from 'bun:test'
import {
  CHANNEX_BOOKING_EVENT_MASK,
  CHANNEX_WEBHOOK_PATH,
  buildCallbackUrl,
  getOrCreateWebhookSecret,
  handleChannexWebhook,
  registerChannexWebhook,
  type ChannexWebhookConfigStore,
} from '../usecases/channex-webhook'

const SECRETO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

/** Config de plataforma en memoria, contando escrituras (para probar la idempotencia). */
function fakeStore(inicial: { webhookSecret?: string; channexUserId?: string } | null = null) {
  let valor = inicial ? { ...inicial } : null
  const writes: any[] = []
  const store: ChannexWebhookConfigStore = {
    async read() { return valor ? { ...valor } : null },
    async write(patch) { writes.push(patch); valor = { ...(valor || {}), ...patch } },
  }
  return { store, writes, get value() { return valor } }
}

function fakeLogger() {
  const lines: Array<{ level: string; msg: string; ctx?: any }> = []
  return {
    lines,
    info: (msg: string, ctx?: any) => lines.push({ level: 'info', msg, ctx }),
    warn: (msg: string, ctx?: any) => lines.push({ level: 'warn', msg, ctx }),
    error: (msg: string, ctx?: any) => lines.push({ level: 'error', msg, ctx }),
  }
}

/** El payload REAL de Channex con `send_data: false`: solo ids. */
const PAYLOAD = {
  event: 'booking',
  payload: { booking_id: 'bk-1', property_id: 'prop-1', revision_id: 'rev-42' },
  user_id: null,
  timestamp: '2099-10-01T10:00:00Z',
}

function deps(opciones: {
  store?: ChannexWebhookConfigStore
  ingest?: (id: string) => Promise<{ success: boolean; errors: string[] }>
} = {}) {
  const ingested: string[] = []
  const logger = fakeLogger()
  const store = opciones.store ?? fakeStore({ webhookSecret: SECRETO }).store
  const ingestRevision = async (id: string) => {
    ingested.push(id)
    return opciones.ingest ? opciones.ingest(id) : { success: true, errors: [] }
  }
  return { d: { store, ingestRevision, logger }, ingested, logger }
}

describe('handleChannexWebhook — CA-1: callback válido ingesta la revisión', () => {
  it('acepta la credencial por header api-key', async () => {
    const { d, ingested } = deps()
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: PAYLOAD })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(ingested).toEqual(['rev-42'])
  })

  it('acepta la credencial por query api_key (la que va en el callback_url)', async () => {
    const { d, ingested } = deps()
    const res = await handleChannexWebhook(d, { query: { api_key: SECRETO }, body: PAYLOAD })

    expect(res.status).toBe(200)
    expect(ingested).toEqual(['rev-42'])
  })

  it('tolera el header con otra capitalización', async () => {
    const { d, ingested } = deps()
    const res = await handleChannexWebhook(d, { headers: { 'Api-Key': SECRETO }, body: PAYLOAD })

    expect(res.status).toBe(200)
    expect(ingested).toHaveLength(1)
  })
})

describe('handleChannexWebhook — CA-2: sin credencial válida es 401 y no ingesta', () => {
  it('sin credencial', async () => {
    const { d, ingested, logger } = deps()
    const res = await handleChannexWebhook(d, { body: PAYLOAD })

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ success: false })
    expect(ingested).toHaveLength(0)
    expect(logger.lines.some((l) => l.level === 'warn')).toBe(true)
  })

  it('con credencial incorrecta', async () => {
    const { d, ingested } = deps()
    const res = await handleChannexWebhook(d, { headers: { 'api-key': 'no-es-el-secreto' }, body: PAYLOAD })

    expect(res.status).toBe(401)
    expect(ingested).toHaveLength(0)
  })

  it('con una credencial que es prefijo del secreto (la comparación no es por longitud)', async () => {
    const { d, ingested } = deps()
    const res = await handleChannexWebhook(d, { query: { api_key: SECRETO.slice(0, 8) }, body: PAYLOAD })

    expect(res.status).toBe(401)
    expect(ingested).toHaveLength(0)
  })

  it('con el store SIN secreto configurado todavía', async () => {
    const { d, ingested } = deps({ store: fakeStore(null).store })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: PAYLOAD })

    expect(res.status).toBe(401)
    expect(ingested).toHaveLength(0)
  })
})

describe('handleChannexWebhook — CA-5: los eventos que causamos nosotros se descartan', () => {
  it('user_id propio con channexUserId configurado → 200 sin ingestar', async () => {
    const { store } = fakeStore({ webhookSecret: SECRETO, channexUserId: 'user-nuestro' })
    const { d, ingested } = deps({ store })
    const res = await handleChannexWebhook(d, {
      headers: { 'api-key': SECRETO },
      body: { ...PAYLOAD, user_id: 'user-nuestro' },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, ignored: 'own_event' })
    expect(ingested).toHaveLength(0)
  })

  it('user_id presente SIN channexUserId configurado → también se descarta', async () => {
    const { d, ingested } = deps()
    const res = await handleChannexWebhook(d, {
      headers: { 'api-key': SECRETO },
      body: { ...PAYLOAD, user_id: 'cualquiera' },
    })

    expect(res.status).toBe(200)
    expect(res.body.ignored).toBe('own_event')
    expect(ingested).toHaveLength(0)
  })

  it('contraste: user_id null (evento originado por la OTA) SÍ ingesta', async () => {
    const { store } = fakeStore({ webhookSecret: SECRETO, channexUserId: 'user-nuestro' })
    const { d, ingested } = deps({ store })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: PAYLOAD })

    expect(res.status).toBe(200)
    expect(ingested).toEqual(['rev-42'])
  })

  it('contraste: user_id de OTRA cuenta con el nuestro configurado SÍ ingesta', async () => {
    const { store } = fakeStore({ webhookSecret: SECRETO, channexUserId: 'user-nuestro' })
    const { d, ingested } = deps({ store })
    const res = await handleChannexWebhook(d, {
      headers: { 'api-key': SECRETO },
      body: { ...PAYLOAD, user_id: 'user-ajeno' },
    })

    expect(res.status).toBe(200)
    expect(ingested).toEqual(['rev-42'])
  })
})

describe('handleChannexWebhook — payload incompleto y fallos de ingesta', () => {
  it('sin revision_id → 400 y ninguna ingesta', async () => {
    const { d, ingested, logger } = deps()
    const res = await handleChannexWebhook(d, {
      headers: { 'api-key': SECRETO },
      body: { event: 'booking', payload: { booking_id: 'bk-1' }, user_id: null },
    })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(ingested).toHaveLength(0)
    expect(logger.lines.some((l) => l.level === 'warn')).toBe(true)
  })

  it('body vacío (con credencial válida) → 400', async () => {
    const { d, ingested } = deps()
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO } })

    expect(res.status).toBe(400)
    expect(ingested).toHaveLength(0)
  })

  // CA-7: la revisión NO se ackeó, así que sigue en el feed y el cron la recupera; un 5xx solo
  // haría que Channex reintente contra algo que ya sabemos que está fallando.
  it('ingestRevision rechaza → sigue siendo 200 y queda logueado como error', async () => {
    const { d, ingested, logger } = deps({ ingest: async () => { throw new Error('channex 500') } })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: PAYLOAD })

    expect(res.status).toBe(200)
    expect(ingested).toEqual(['rev-42'])
    const err = logger.lines.find((l) => l.level === 'error')
    expect(err).toBeDefined()
    expect(err!.ctx.revisionId).toBe('rev-42')
    expect(err!.ctx.errors).toContain('channex 500')
  })

  it('ingestRevision devuelve success:false → 200 y error logueado con la revisión', async () => {
    const { d, logger } = deps({ ingest: async () => ({ success: false, errors: ['rev-42: no encontrada'] }) })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: PAYLOAD })

    expect(res.status).toBe(200)
    expect(res.body.ingested).toBe(false)
    const err = logger.lines.find((l) => l.level === 'error')
    expect(err!.ctx.revisionId).toBe('rev-42')
  })
})

describe('getOrCreateWebhookSecret', () => {
  it('genera una vez y después devuelve el mismo', async () => {
    const s = fakeStore(null)
    const primero = await getOrCreateWebhookSecret(s.store)
    const segundo = await getOrCreateWebhookSecret(s.store)

    expect(primero).toBe(segundo)
    expect(primero.length).toBeGreaterThanOrEqual(16)
    expect(s.writes).toHaveLength(1)
    expect(s.value!.webhookSecret).toBe(primero)
  })

  it('respeta el secreto ya guardado sin reescribirlo', async () => {
    const s = fakeStore({ webhookSecret: SECRETO })
    expect(await getOrCreateWebhookSecret(s.store)).toBe(SECRETO)
    expect(s.writes).toHaveLength(0)
  })

  it('el secreto generado sirve para autenticar el callback siguiente', async () => {
    const s = fakeStore(null)
    const secreto = await getOrCreateWebhookSecret(s.store)
    const { d, ingested } = deps({ store: s.store })
    const res = await handleChannexWebhook(d, { query: { api_key: secreto }, body: PAYLOAD })

    expect(res.status).toBe(200)
    expect(ingested).toEqual(['rev-42'])
  })
})

/** Channex fake: guarda lo creado y lo devuelve en el listado, como el real. */
function fakeChannex(iniciales: Array<{ id: string; callbackUrl: string }> = []) {
  const webhooks = iniciales.map((w) => ({ ...w, eventMask: CHANNEX_BOOKING_EVENT_MASK, propertyId: null as string | null }))
  const creados: any[] = []
  return {
    webhooks,
    creados,
    listWebhooks: async () => webhooks.map((w) => ({ ...w })),
    createWebhook: async (_key: string, input: any) => {
      creados.push(input)
      const id = `wh-${webhooks.length + 1}`
      webhooks.push({ id, callbackUrl: input.callbackUrl, eventMask: input.eventMask, propertyId: input.propertyId ?? null })
      return { id }
    },
  }
}

describe('buildCallbackUrl', () => {
  it('arma la URL con el path público y el secreto en el query', () => {
    expect(buildCallbackUrl('https://app.solmios.com/', SECRETO))
      .toBe(`https://app.solmios.com${CHANNEX_WEBHOOK_PATH}?api_key=${SECRETO}`)
  })

  it('escapa el secreto', () => {
    expect(buildCallbackUrl('https://app.solmios.com', 'a b/c')).toContain('api_key=a%20b%2Fc')
  })
})

describe('registerChannexWebhook — CA-8: el alta es idempotente', () => {
  it('dos corridas seguidas dan de alta UN solo webhook', async () => {
    const s = fakeStore(null)
    const channex = fakeChannex()
    const logger = fakeLogger()
    const d = { store: s.store, channex, logger }

    const primera = await registerChannexWebhook(d, 'https://app.solmios.com')
    const segunda = await registerChannexWebhook(d, 'https://app.solmios.com')

    expect(primera.created).toBe(true)
    expect(primera.id).toBe('wh-1')
    expect(segunda).toEqual({ created: false, id: 'wh-1', callbackUrl: primera.callbackUrl })
    expect(channex.creados).toHaveLength(1)
    expect(channex.webhooks).toHaveLength(1)
    expect(channex.creados[0].eventMask).toBe(CHANNEX_BOOKING_EVENT_MASK)
    expect(channex.creados[0].propertyId).toBe(null)
  })

  it('un webhook ya registrado con OTRO secreto en el query tampoco se duplica', async () => {
    const s = fakeStore({ webhookSecret: SECRETO })
    const channex = fakeChannex([
      { id: 'wh-viejo', callbackUrl: `https://app.solmios.com${CHANNEX_WEBHOOK_PATH}?api_key=secreto-anterior` },
    ])
    const res = await registerChannexWebhook({ store: s.store, channex, logger: fakeLogger() }, 'https://app.solmios.com')

    expect(res.created).toBe(false)
    expect(res.id).toBe('wh-viejo')
    expect(channex.creados).toHaveLength(0)
    expect(channex.webhooks).toHaveLength(1)
  })

  it('un callback de OTRO host sí se da de alta', async () => {
    const s = fakeStore({ webhookSecret: SECRETO })
    const channex = fakeChannex([
      { id: 'wh-otro', callbackUrl: `https://otro-pms.com${CHANNEX_WEBHOOK_PATH}?api_key=x` },
    ])
    const res = await registerChannexWebhook({ store: s.store, channex, logger: fakeLogger() }, 'https://app.solmios.com')

    expect(res.created).toBe(true)
    expect(channex.creados).toHaveLength(1)
    expect(channex.webhooks).toHaveLength(2)
  })

  it('si Channex rechaza el alta devuelve created:false sin id y lo loguea', async () => {
    const s = fakeStore({ webhookSecret: SECRETO })
    const logger = fakeLogger()
    const channex = {
      listWebhooks: async () => [],
      createWebhook: async () => ({ id: null, error: 'Validation Error — property_id: is required when is_global is false' }),
    }
    const res = await registerChannexWebhook({ store: s.store, channex, logger }, 'https://app.solmios.com')

    expect(res).toMatchObject({ created: false, id: null })
    // El motivo llega al operador por las dos vías: la respuesta del endpoint y el log.
    expect(res.error).toContain('property_id')
    expect(logger.lines.some((l) => l.level === 'error')).toBe(true)
  })
})
