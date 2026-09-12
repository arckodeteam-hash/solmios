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

/** El payload REAL de Channex con `send_data: true`: `payload` trae los ids (con `false` no viene `payload`, #342). */
const PAYLOAD = {
  event: 'booking',
  payload: { booking_id: 'bk-1', property_id: 'prop-1', revision_id: 'rev-42' },
  user_id: null,
  timestamp: '2099-10-01T10:00:00Z',
}

function deps(opciones: {
  store?: ChannexWebhookConfigStore
  ingest?: (id: string) => Promise<{ success: boolean; errors: string[] }>
  /** Plan B del #342. `undefined` = sin cablear (comportamiento viejo: 400). */
  syncFeed?: () => Promise<{ success: boolean; errors: string[] }>
} = {}) {
  const ingested: string[] = []
  const logger = fakeLogger()
  const store = opciones.store ?? fakeStore({ webhookSecret: SECRETO }).store
  const ingestRevision = async (id: string) => {
    ingested.push(id)
    return opciones.ingest ? opciones.ingest(id) : { success: true, errors: [] }
  }
  return { d: { store, ingestRevision, syncFeed: opciones.syncFeed, logger }, ingested, logger }
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

// #342 — el body REAL que manda Channex cuando el webhook se registró con `send_data: false`:
// sin `payload`. Así llegó a prod el 2026-09-12T04:58:48Z (`event: booking_new`) y respondimos 400.
const SIN_PAYLOAD = { event: 'booking_new', property_id: 'prop-1', user_id: null, timestamp: '2099-10-01T10:00:00Z' }

describe('handleChannexWebhook — #342: callback sin payload (webhook con send_data:false)', () => {
  it('con syncFeed cableado: 200, barre el feed y NO ingesta por revisión', async () => {
    let feedRuns = 0
    const { d, ingested, logger } = deps({ syncFeed: async () => { feedRuns++; return { success: true, errors: [] } } })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: SIN_PAYLOAD })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, ingested: false, fallback: 'feed', synced: true })
    expect(feedRuns).toBe(1)
    expect(ingested).toHaveLength(0)
    expect(logger.lines.some((l) => l.level === 'warn' && /send_data/.test(l.msg))).toBe(true)
  })

  it('las tres variantes de evento de reserva disparan el plan B', async () => {
    for (const event of ['booking', 'booking_new', 'booking_modification', 'booking_cancellation']) {
      let feedRuns = 0
      const { d } = deps({ syncFeed: async () => { feedRuns++; return { success: true, errors: [] } } })
      const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: { ...SIN_PAYLOAD, event } })
      expect(res.status).toBe(200)
      expect(feedRuns).toBe(1)
    }
  })

  it('un evento que NO es de reserva y sin payload sigue siendo 400 aunque haya syncFeed', async () => {
    let feedRuns = 0
    const { d } = deps({ syncFeed: async () => { feedRuns++; return { success: true, errors: [] } } })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: { ...SIN_PAYLOAD, event: 'ari' } })
    expect(res.status).toBe(400)
    expect(feedRuns).toBe(0)
  })

  it('el sync del feed falla → sigue 200 (el cron lo recupera) y queda logueado como error', async () => {
    const { d, logger } = deps({ syncFeed: async () => ({ success: false, errors: ['feed caído'] }) })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: SIN_PAYLOAD })
    expect(res.status).toBe(200)
    expect(res.body.synced).toBe(false)
    expect(logger.lines.some((l) => l.level === 'error')).toBe(true)
  })

  it('el sync del feed lanza → sigue 200', async () => {
    const { d } = deps({ syncFeed: async () => { throw new Error('boom') } })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: SIN_PAYLOAD })
    expect(res.status).toBe(200)
    expect(res.body.synced).toBe(false)
  })

  it('con revision_id presente NO usa el plan B: ingesta la revisión', async () => {
    let feedRuns = 0
    const { d, ingested } = deps({ syncFeed: async () => { feedRuns++; return { success: true, errors: [] } } })
    const res = await handleChannexWebhook(d, { headers: { 'api-key': SECRETO }, body: PAYLOAD })
    expect(res.status).toBe(200)
    expect(ingested).toEqual(['rev-42'])
    expect(feedRuns).toBe(0)
  })
})

describe('handleChannexWebhook — payload incompleto y fallos de ingesta', () => {
  it('sin revision_id y SIN syncFeed cableado → 400 y ninguna ingesta', async () => {
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
function fakeChannex(iniciales: Array<{ id: string; callbackUrl: string; sendData?: boolean }> = [], opts: { sinUpdate?: boolean; updateFalla?: boolean } = {}) {
  const webhooks = iniciales.map((w) => ({ ...w, eventMask: CHANNEX_BOOKING_EVENT_MASK, propertyId: null as string | null, sendData: w.sendData ?? true }))
  const creados: any[] = []
  const actualizados: Array<{ id: string; patch: any }> = []
  const base = {
    webhooks,
    creados,
    actualizados,
    listWebhooks: async () => webhooks.map((w) => ({ ...w })),
    createWebhook: async (_key: string, input: any) => {
      creados.push(input)
      const id = `wh-${webhooks.length + 1}`
      webhooks.push({ id, callbackUrl: input.callbackUrl, eventMask: input.eventMask, propertyId: input.propertyId ?? null, sendData: true })
      return { id }
    },
  }
  if (opts.sinUpdate) return base
  return {
    ...base,
    updateWebhook: async (_key: string, id: string, patch: { sendData?: boolean }) => {
      actualizados.push({ id, patch })
      if (opts.updateFalla) return { ok: false, error: 'Channex: 422' }
      const w = webhooks.find((x) => x.id === id)
      if (w && patch.sendData !== undefined) w.sendData = patch.sendData
      return { ok: true }
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

  // #342 — el callback que la versión anterior dio de alta con send_data:false no manda ids.
  it('un callback existente con send_data:false se corrige a true en vez de duplicarse', async () => {
    const s = fakeStore({ webhookSecret: SECRETO })
    const channex = fakeChannex([
      { id: 'wh-viejo', callbackUrl: `https://app.solmios.com${CHANNEX_WEBHOOK_PATH}?api_key=${SECRETO}`, sendData: false },
    ])
    const logger = fakeLogger()
    const res = await registerChannexWebhook({ store: s.store, channex, logger }, 'https://app.solmios.com')

    expect(res).toEqual({ created: false, id: 'wh-viejo', callbackUrl: `https://app.solmios.com${CHANNEX_WEBHOOK_PATH}?api_key=${SECRETO}`, error: undefined })
    expect(channex.creados).toHaveLength(0)
    expect(channex.actualizados).toEqual([{ id: 'wh-viejo', patch: { sendData: true } }])
    expect(channex.webhooks[0]!.sendData).toBe(true)
    expect(logger.lines.some((l) => /corregido a send_data:true/.test(l.msg))).toBe(true)
  })

  it('si Channex rechaza la corrección, el motivo viaja en `error` y no se crea otro', async () => {
    const s = fakeStore({ webhookSecret: SECRETO })
    const channex = fakeChannex([
      { id: 'wh-viejo', callbackUrl: `https://app.solmios.com${CHANNEX_WEBHOOK_PATH}?api_key=${SECRETO}`, sendData: false },
    ], { updateFalla: true })
    const res = await registerChannexWebhook({ store: s.store, channex, logger: fakeLogger() }, 'https://app.solmios.com')

    expect(res.created).toBe(false)
    expect(res.id).toBe('wh-viejo')
    expect(res.error).toBe('Channex: 422')
    expect(channex.creados).toHaveLength(0)
  })

  it('un callback existente ya con send_data:true no se toca', async () => {
    const s = fakeStore({ webhookSecret: SECRETO })
    const channex = fakeChannex([
      { id: 'wh-ok', callbackUrl: `https://app.solmios.com${CHANNEX_WEBHOOK_PATH}?api_key=${SECRETO}`, sendData: true },
    ])
    const res = await registerChannexWebhook({ store: s.store, channex, logger: fakeLogger() }, 'https://app.solmios.com')
    expect(res.id).toBe('wh-ok')
    expect(channex.actualizados).toHaveLength(0)
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
