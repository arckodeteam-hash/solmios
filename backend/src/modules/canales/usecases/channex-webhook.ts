// canales/usecases/channex-webhook.ts — El receptor del webhook de reservas de Channex.
//
// Channex avisa "hay una revisión nueva" con `payload.revision_id` (el callback se registra con
// `send_data: true`; con `false` Channex OMITE `payload` entero — #342); la ingesta real la hace el
// MISMO camino del cron (`BookingSyncUseCase.runOne` → GET → apply → ack), así la reserva que entra
// por webhook es idéntica a la del cron y hereda su dedupe por externalLocator. Si el callback llega
// sin `payload` (un webhook viejo con `send_data: false`), se dispara el sync del feed completo en
// vez de responder 400: la reserva entra igual, sin esperar al cron.
// Acá vive únicamente lo que el cron no necesita: verificar quién llama, descartar los eventos que
// causamos nosotros mismos y dar de alta el callback una sola vez.
//
// Todo el archivo es PURO: recibe puertos por parámetro y no importa ni el ORM ni el router. Esa es
// la razón de que exista — el módulo no tiene tests HTTP, así que "responde 200" y "responde 401"
// se prueban contra estas funciones y la ruta de `index.ts` queda como un adaptador de 3 líneas.

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

/** Los tres eventos de reserva de Channex; el mask es una lista separada por `;`. */
export const CHANNEX_BOOKING_EVENT_MASK = 'booking_new;booking_modification;booking_cancellation'

/** Path público del receptor. Lo comparten el router y el callback_url que registramos. */
export const CHANNEX_WEBHOOK_PATH = '/api/channels/channex/webhook'

export interface ChannexWebhookLogger {
  info: (m: string, c?: any) => void
  warn: (m: string, c?: any) => void
  error: (m: string, c?: any) => void
}

/**
 * Acceso a la configuración de PLATAFORMA (una sola fila `Configuration(hotelId='platform',
 * key='channex')`). El webhook es de la cuenta de plataforma, no de un hotel: el secreto y el
 * `channexUserId` son únicos para toda la instalación.
 */
export interface ChannexWebhookConfigStore {
  read(): Promise<{ webhookSecret?: string; channexUserId?: string } | null>
  write(patch: { webhookSecret?: string; channexUserId?: string }): Promise<void>
}

// ─── Secreto de plataforma ───────────────────────────────────────────────────────────────────

/**
 * El secreto que autentica al callback. Se genera UNA vez y se persiste: si ya existe se devuelve
 * tal cual, porque rotarlo en cada arranque invalidaría el `callback_url` ya registrado en Channex
 * (que lo lleva embebido en el query string) y dejaría de entrar ninguna reserva por webhook.
 */
export async function getOrCreateWebhookSecret(store: ChannexWebhookConfigStore): Promise<string> {
  const actual = String((await store.read())?.webhookSecret || '').trim()
  if (actual) return actual
  const secreto = randomBytes(16).toString('hex')   // 128 bits opacos, sin estructura que adivinar
  await store.write({ webhookSecret: secreto })
  return secreto
}

/**
 * Comparación en tiempo constante. Se hashea primero para que los dos buffers midan siempre lo
 * mismo: `timingSafeEqual` tira si difieren en longitud, y comparar el largo antes filtraría por
 * tamaño del candidato. Mismo criterio que `apikeys/usecases/validate-key.ts`.
 */
function secretosCoinciden(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** Header case-insensitive: Bun normaliza a minúsculas, pero un proxy puede mandar `Api-Key`. */
function leerHeader(headers: Record<string, any> | undefined, nombre: string): string {
  if (!headers) return ''
  const directo = headers[nombre]
  if (directo != null) return String(directo)
  const clave = Object.keys(headers).find((k) => k.toLowerCase() === nombre)
  return clave ? String(headers[clave] ?? '') : ''
}

// ─── El handler ──────────────────────────────────────────────────────────────────────────────

export interface ChannexWebhookDeps {
  store: ChannexWebhookConfigStore
  /** Dispara la ingesta de UNA revisión: en producción es `bookingSync.runOne`. */
  ingestRevision: (revisionId: string) => Promise<{ success: boolean; errors: string[] }>
  /**
   * Plan B cuando el callback viene SIN `payload.revision_id` (#342): el sync del feed entero, el
   * mismo `bookingSync.run` del cron. Opcional para no romper a quien arma los deps en tests;
   * sin él, el caso sigue siendo 400.
   */
  syncFeed?: () => Promise<{ success: boolean; errors: string[] }>
  /** Registro en `sync_log` de lo que se hizo con cada callback (#347). Opcional; nunca frena la respuesta. */
  trail?: { logWebhook: (input: { outcome: 'ingested' | 'ingest_failed' | 'feed_fallback' | 'rejected' | 'no_payload' | 'own_event'; propertyId?: string | null; revisionId?: string | null; event?: string | null; detail?: Record<string, unknown> }) => Promise<void> }
  logger: ChannexWebhookLogger
}

/** Los eventos que pueden traer una reserva: `booking` y sus tres variantes. */
const esEventoDeReserva = (event: unknown): boolean => /^booking(_new|_modification|_cancellation)?$/.test(String(event ?? ''))

/**
 * Recibe el callback de Channex. El body real es:
 * `{"event":"booking","payload":{"booking_id":"…","property_id":"…","revision_id":"…"},"user_id":null,…}`
 *
 * Devuelve `{status, body}` para que el router sea un adaptador y esto se pueda testear sin HTTP.
 */
export async function handleChannexWebhook(
  deps: ChannexWebhookDeps,
  req: { headers?: Record<string, any>; query?: Record<string, any>; body?: any },
): Promise<{ status: number; body: any }> {
  const { store, logger } = deps
  const anotar = (input: Parameters<NonNullable<ChannexWebhookDeps['trail']>['logWebhook']>[0]): void => {
    if (!deps.trail) return
    deps.trail.logWebhook(input).catch(() => { /* registrar nunca frena la respuesta */ })
  }

  // 1. La credencial PRIMERO, antes de mirar el body: un endpoint público no puede gastar trabajo
  // (ni loguear payloads ajenos) por una request que no está autenticada.
  let cfg: { webhookSecret?: string; channexUserId?: string } | null = null
  try {
    cfg = await store.read()
  } catch (e: any) {
    logger.error('channex-webhook: no se pudo leer la config de plataforma', { error: e?.message || String(e) })
    return { status: 401, body: { success: false } }
  }

  const esperado = String(cfg?.webhookSecret || '').trim()
  // Dos vías a propósito: el header `api-key` es el mismo que usan las rutas `/api/channels/
  // open-ari/*`, y el query `api_key` va embebido en el callback_url que registramos — así no
  // dependemos de que Channex propague headers custom.
  const recibido = (leerHeader(req.headers, 'api-key') || String(req.query?.api_key ?? '')).trim()
  if (!esperado || !recibido || !secretosCoinciden(esperado, recibido)) {
    logger.warn('channex-webhook: credencial inválida', { conCredencial: Boolean(recibido), configurado: Boolean(esperado) })
    anotar({ outcome: 'rejected', event: req.body?.event ?? null, propertyId: req.body?.property_id ?? null, detail: { conCredencial: Boolean(recibido) } })
    return { status: 401, body: { success: false } }
  }

  const body = req.body || {}
  const propertyId: string | null = body?.payload?.property_id ?? body?.property_id ?? null

  // 2. Eventos propios. Los eventos de booking los origina la OTA y llegan con `user_id: null`;
  // un `user_id` seteado en una cuenta de plataforma que es SOLO nuestra significa que el evento
  // lo causó nuestra propia API (los pushes de ARI). Ingerirlos sería trabajo en círculo.
  // Mientras no tengamos guardado nuestro `channexUserId`, cualquier `user_id` presente se
  // descarta: es el criterio conservador (mejor perder un eco que ingestar de más).
  const userId = String(body?.user_id ?? '').trim()
  if (userId) {
    const propio = String(cfg?.channexUserId || '').trim()
    if (!propio || propio === userId) {
      logger.info('channex-webhook: evento propio descartado', { userId })
      anotar({ outcome: 'own_event', event: body?.event ?? null, propertyId, detail: { userId } })
      return { status: 200, body: { success: true, ignored: 'own_event' } }
    }
  }

  // 3. El id de la revisión es lo único que necesitamos del payload: el resto lo trae el GET.
  const revisionId = String(body?.payload?.revision_id ?? '').trim()
  if (!revisionId) {
    // Sin `payload` es un webhook registrado con `send_data: false` (#342). Antes esto era un 400
    // y la reserva de la OTA se quedaba esperando al cron; ahora se barre el feed entero, que es
    // exactamente lo que hace el cron, pero ya. Siempre 200: un 4xx/5xx no le enseña nada a Channex.
    if (deps.syncFeed && esEventoDeReserva(body?.event)) {
      logger.warn('channex-webhook: callback sin revision_id, se sincroniza el feed completo (webhook con send_data:false, #342)', { event: body?.event ?? null, propertyId: body?.property_id ?? null })
      try {
        const res = await deps.syncFeed()
        if (!res?.success) logger.error('channex-webhook: el sync del feed falló, queda para el cron', { errors: res?.errors || [] })
        anotar({ outcome: 'feed_fallback', event: body?.event ?? null, propertyId, detail: { synced: Boolean(res?.success), errors: res?.errors || [] } })
        return { status: 200, body: { success: true, ingested: false, fallback: 'feed', synced: Boolean(res?.success) } }
      } catch (e: any) {
        logger.error('channex-webhook: excepción sincronizando el feed, queda para el cron', { error: e?.message || String(e) })
        anotar({ outcome: 'feed_fallback', event: body?.event ?? null, propertyId, detail: { synced: false, error: e?.message || String(e) } })
        return { status: 200, body: { success: true, ingested: false, fallback: 'feed', synced: false } }
      }
    }
    logger.warn('channex-webhook: callback sin revision_id', { event: body?.event ?? null })
    anotar({ outcome: 'no_payload', event: body?.event ?? null, propertyId })
    return { status: 400, body: { success: false, error: 'revision_id ausente' } }
  }

  // 4. Ingesta. Siempre 200, también cuando falla: `runOne` NO ackea si algo salió mal, así que la
  // revisión sigue en el feed y el cron de 15 minutos la recupera. Un 5xx solo haría que Channex
  // reintente contra un sistema que ya sabemos que está fallando, y a los reintentos fallidos
  // Channex les desactiva el webhook.
  try {
    const res = await deps.ingestRevision(revisionId)
    if (!res?.success) {
      logger.error('channex-webhook: la ingesta falló, queda para el cron', { revisionId, errors: res?.errors || [] })
      anotar({ outcome: 'ingest_failed', event: body?.event ?? null, propertyId, revisionId, detail: { errors: res?.errors || [] } })
      return { status: 200, body: { success: true, revisionId, ingested: false } }
    }
    logger.info('channex-webhook: revisión ingestada', { revisionId })
    anotar({ outcome: 'ingested', event: body?.event ?? null, propertyId, revisionId })
    return { status: 200, body: { success: true, revisionId, ingested: true } }
  } catch (e: any) {
    logger.error('channex-webhook: excepción ingestando la revisión, queda para el cron', {
      revisionId, errors: [e?.message || String(e)],
    })
    anotar({ outcome: 'ingest_failed', event: body?.event ?? null, propertyId, revisionId, detail: { error: 'excepción' } })
    return { status: 200, body: { success: true, revisionId, ingested: false } }
  }
}

// ─── Registro idempotente del callback ───────────────────────────────────────────────────────

export interface ChannexWebhookRegistrar {
  listWebhooks: (key: string) => Promise<Array<{ id: string; callbackUrl: string; eventMask: string; propertyId: string | null; sendData?: boolean }>>
  createWebhook: (key: string, input: { callbackUrl: string; eventMask: string; propertyId?: string | null }) => Promise<{ id: string | null; error?: string }>
  /** Corrige `send_data` de un callback existente (#342). Opcional: sin él, el viejo queda como está y se avisa. */
  updateWebhook?: (key: string, id: string, patch: { sendData?: boolean }) => Promise<{ ok: boolean; error?: string }>
}

/** `<base sin barra final>/api/channels/channex/webhook?api_key=<secreto>`. */
export function buildCallbackUrl(baseUrl: string, secret: string): string {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  return `${base}${CHANNEX_WEBHOOK_PATH}?api_key=${encodeURIComponent(secret)}`
}

/** Origen + path sin query ni barra final: la identidad del callback, que el secreto no cambia. */
function endpointDe(url: string): string {
  const crudo = String(url || '')
  try {
    const u = new URL(crudo)
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return (crudo.split('?')[0] || '').replace(/\/+$/, '')
  }
}

/**
 * Da de alta el callback en Channex una sola vez. Compara IGNORANDO el query string: el secreto
 * viaja ahí, y comparar la URL completa registraría un webhook nuevo cada vez que rote —
 * terminaríamos con N callbacks activos y N ingestas por reserva.
 *
 * `key` vacía = credencial de plataforma (mismo convenio que el resto del cliente).
 */
export async function registerChannexWebhook(
  deps: { store: ChannexWebhookConfigStore; channex: ChannexWebhookRegistrar; logger: ChannexWebhookLogger },
  baseUrl: string,
): Promise<{ created: boolean; id: string | null; callbackUrl: string; error?: string }> {
  const secreto = await getOrCreateWebhookSecret(deps.store)
  const callbackUrl = buildCallbackUrl(baseUrl, secreto)
  const objetivo = endpointDe(callbackUrl)

  const existentes = await deps.channex.listWebhooks('')
  const yaEsta = existentes.find((w) => endpointDe(w.callbackUrl) === objetivo)
  if (yaEsta) {
    // Autocorrección (#342): un callback dado de alta por la versión anterior tiene `send_data:
    // false` y Channex le manda el aviso sin ids. Se arregla acá, en el mismo "Registrar/verificar"
    // del admin, para no obligar a borrarlo y crearlo de nuevo.
    if (yaEsta.sendData === false && deps.channex.updateWebhook) {
      const fix = await deps.channex.updateWebhook('', yaEsta.id, { sendData: true })
      if (fix.ok) deps.logger.info('channex-webhook: callback existente corregido a send_data:true', { id: yaEsta.id })
      else deps.logger.error('channex-webhook: no se pudo corregir send_data del callback existente', { id: yaEsta.id, error: fix.error })
      return { created: false, id: yaEsta.id, callbackUrl, error: fix.ok ? undefined : fix.error }
    }
    deps.logger.info('channex-webhook: callback ya registrado', { id: yaEsta.id, callbackUrl: objetivo })
    return { created: false, id: yaEsta.id, callbackUrl }
  }

  const creado = await deps.channex.createWebhook('', {
    callbackUrl,
    eventMask: CHANNEX_BOOKING_EVENT_MASK,
    propertyId: null,                              // de cuenta: aplica a todas las properties
  })
  if (!creado?.id) {
    // El motivo VIAJA hasta el operador (log y respuesta del endpoint): un "rechazó el alta" pelado
    // obligaba a reproducir el POST a mano contra Channex para enterarse de qué campo faltaba.
    const error = creado?.error || 'Channex rechazó el alta del callback'
    deps.logger.error('channex-webhook: Channex rechazó el alta del callback', { callbackUrl: objetivo, error })
    return { created: false, id: null, callbackUrl, error }
  }
  deps.logger.info('channex-webhook: callback registrado', { id: creado.id, callbackUrl: objetivo })
  return { created: true, id: creado.id, callbackUrl }
}
