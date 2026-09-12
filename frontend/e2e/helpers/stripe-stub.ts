// e2e/helpers/stripe-stub.ts — Doble HTTP mínimo de la API de Stripe para los E2E (epic #265).
//
// El backend apunta el SDK real de stripe-node a este servidor (STRIPE_API_HOST/PORT/PROTOCOL,
// ver backend/src/services/payment-gateway/stripe-gateway.ts) y el spec firma los webhooks con
// `signStripeEvent` usando el mismo STRIPE_WEBHOOK_SECRET que recibe el backend. Sólo cubre las
// llamadas que hace StripeGateway: crear/leer Checkout Sessions, leer/cancelar PaymentIntents,
// crear refunds y leer la cuenta. Sin dependencias nuevas: `node:http` + `node:crypto`, así corre
// igual bajo Node (Playwright levanta el stub dentro del spec) y bajo Bun (el selftest).
//
// Los ids llevan un prefijo aleatorio por proceso (`cs_test_<rand8>_<n>`): `payments.stripeSessionId`
// es clave de idempotencia en el backend y dos corridas contra la misma base no deben repetir id.
//
//   bun run e2e/helpers/stripe-stub.ts --selftest   → OK (valida el contrato con el SDK real)

import { createHmac, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

/** Prefijo aleatorio de esta corrida: 8 hex, común a sessions, PIs, charges, refunds y eventos. */
const RUN_ID = randomBytes(4).toString('hex')
let seq = 0
function nextId(prefix: string): string {
  return `${prefix}_test_${RUN_ID}_${++seq}`
}

/** Charge mínimo: lo que `enrichFromCharge` lee tras expandir `latest_charge`. */
export interface StubCharge {
  id: string
  object: 'charge'
  payment_intent: string
  amount: number
  currency: string
  status: 'succeeded'
  receipt_url: string
  payment_method_details: { type: 'card'; card: { brand: string; last4: string } }
}

export interface StubPaymentIntent {
  id: string
  object: 'payment_intent'
  amount: number
  currency: string
  status: 'requires_payment_method' | 'succeeded' | 'canceled'
  metadata: Record<string, string>
  latest_charge: StubCharge
  /** Ids de los refunds hechos sobre este PI (lo marca POST /v1/refunds). */
  refunds: string[]
  amount_refunded: number
}

export interface StubSession {
  id: string
  object: 'checkout.session'
  url: string
  status: 'open' | 'complete' | 'expired'
  payment_status: 'unpaid' | 'paid'
  mode: string
  payment_intent: string
  amount_total: number
  currency: string
  metadata: Record<string, string>
  client_reference_id: string | null
  customer_email: string | null
  success_url: string | null
  cancel_url: string | null
  expires_at: number
  created: number
  livemode: false
}

export interface RefundRecord {
  id: string
  object: 'refund'
  payment_intent: string
  charge: string
  amount: number
  currency: string
  status: 'succeeded'
  reason: string | null
  created: number
}

export interface StubRequest { method: string; path: string; body: Record<string, unknown> }

export interface StripeStub {
  port: number
  baseUrl: string
  sessions: Map<string, StubSession>
  paymentIntents: Map<string, StubPaymentIntent>
  refunds: RefundRecord[]
  /** Todo lo recibido, en orden: sirve para afirmar "el backend pidió el refund" en el spec. */
  requests: StubRequest[]
  stop(): void
}

type FormValue = string | FormObject
interface FormObject { [key: string]: FormValue }

/**
 * Parsea el body `application/x-www-form-urlencoded` con claves anidadas al estilo qs que manda
 * stripe-node (`metadata[reservationId]=r1`, `line_items[0][price_data][unit_amount]=1000`).
 * Los índices numéricos quedan como claves de objeto: `line_items` → `{ '0': {...} }`.
 */
export function parseStripeForm(raw: string): FormObject {
  const out: FormObject = {}
  for (const [key, value] of new URLSearchParams(raw)) {
    const parts = key.replace(/\]/g, '').split('[')
    let cursor: FormObject = out
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cursor[parts[i]!]
      if (typeof next !== 'object') cursor[parts[i]!] = {}
      cursor = cursor[parts[i]!] as FormObject
    }
    cursor[parts[parts.length - 1]!] = value
  }
  return out
}

function asRecord(v: FormValue | undefined): FormObject {
  return typeof v === 'object' && v !== null ? v : {}
}

function asStringMap(v: FormValue | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(asRecord(v))) if (typeof val === 'string') out[k] = val
  return out
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** Suma unit_amount × quantity de `line_items` (qs indexado), o `amount_total` si no hay líneas. */
function amountTotalOf(body: FormObject): number {
  const items = Object.values(asRecord(body.line_items))
  if (items.length === 0) return Number(body.amount_total ?? 0)
  return items.reduce((sum, item) => {
    const it = asRecord(item)
    const unit = Number(asRecord(it.price_data).unit_amount ?? 0)
    const qty = Number(it.quantity ?? 1)
    return sum + unit * qty
  }, 0)
}

function currencyOf(body: FormObject): string {
  const first = Object.values(asRecord(body.line_items))[0]
  const c = asRecord(asRecord(first).price_data).currency ?? body.currency
  return typeof c === 'string' && c ? c.toLowerCase() : 'usd'
}

interface StubResponse { status: number; contentType: string; body: string }

function json(status: number, data: unknown): StubResponse {
  return { status, contentType: 'application/json', body: JSON.stringify(data) }
}

function stripeError(status: number, type: string, message: string): StubResponse {
  return json(status, { error: { type, message } })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Expande `latest_charge`, `payment_intent`, etc. según `expand[]` — Stripe devuelve el id pelado
 *  si no se pide la expansión. */
function withExpand(obj: StubSession | StubPaymentIntent, expand: string[], stub: StripeStub): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj }
  if ('latest_charge' in out) {
    const charge = out.latest_charge as StubCharge
    out.latest_charge = expand.includes('latest_charge') ? charge : charge.id
  }
  if (typeof out.payment_intent === 'string' && expand.includes('payment_intent')) {
    const pi = stub.paymentIntents.get(out.payment_intent)
    if (pi) out.payment_intent = withExpand(pi, [], stub)
  }
  // `refunds` interno no forma parte del objeto público de Stripe.
  delete out.refunds
  return out
}

/** Levanta el doble en `opts.port` (0 = puerto libre). Recordá `stop()` al terminar el spec. */
export async function startStripeStub(opts: { port?: number } = {}): Promise<StripeStub> {
  const stub: StripeStub = {
    port: 0,
    baseUrl: '',
    sessions: new Map(),
    paymentIntents: new Map(),
    refunds: [],
    requests: [],
    stop: () => {},
  }

  const handle = async (req: IncomingMessage): Promise<StubResponse> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()

    // Página de checkout "hosted": lo único que se sirve sin API key.
    const checkout = path.match(/^\/checkout\/([^/]+)$/)
    if (method === 'GET' && checkout) {
      const id = checkout[1]!
      const session = stub.sessions.get(id)
      if (!session) return { status: 404, contentType: 'text/plain', body: 'Not found' }
      const html = `<!doctype html><html><body>`
        + `<h1 data-testid="stripe-stub-checkout">Stripe stub checkout</h1>`
        + `<p data-testid="stripe-stub-session-id">${id}</p>`
        + `<p>${session.amount_total} ${session.currency}</p>`
        + `</body></html>`
      return { status: 200, contentType: 'text/html; charset=utf-8', body: html }
    }

    // Autenticación al estilo Stripe: sin Bearer no hay API.
    const auth = req.headers.authorization || ''
    if (!auth.startsWith('Bearer ')) {
      return stripeError(401, 'invalid_request_error',
        'You did not provide an API key. You need to provide your API key in the Authorization header, using Bearer auth (e.g. \'Authorization: Bearer YOUR_SECRET_KEY\').')
    }

    // stripe-node manda los params de GET en la query string y los de POST en el body form-urlencoded.
    const body: FormObject = method === 'GET' || method === 'DELETE'
      ? parseStripeForm(url.search.replace(/^\?/, ''))
      : parseStripeForm(await readBody(req))
    stub.requests.push({ method, path, body })
    const expand = Object.values(asRecord(body.expand)).filter((v): v is string => typeof v === 'string')

    let m: RegExpMatchArray | null

    if (method === 'POST' && path === '/v1/checkout/sessions') {
      const id = nextId('cs')
      const piId = nextId('pi')
      const amount = amountTotalOf(body)
      const currency = currencyOf(body)
      const metadata = asStringMap(body.metadata)
      const pi: StubPaymentIntent = {
        id: piId,
        object: 'payment_intent',
        amount,
        currency,
        status: 'requires_payment_method',
        // El PI hereda el metadata de la session (más `payment_intent_data[metadata]` si vino).
        metadata: { ...metadata, ...asStringMap(asRecord(body.payment_intent_data).metadata) },
        latest_charge: {
          id: nextId('ch'),
          object: 'charge',
          payment_intent: piId,
          amount,
          currency,
          status: 'succeeded',
          receipt_url: `${stub.baseUrl}/receipts/${piId}`,
          payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
        },
        refunds: [],
        amount_refunded: 0,
      }
      const created = now()
      const session: StubSession = {
        id,
        object: 'checkout.session',
        url: `${stub.baseUrl}/checkout/${id}`,
        status: 'open',
        payment_status: 'unpaid',
        mode: typeof body.mode === 'string' ? body.mode : 'payment',
        payment_intent: piId,
        amount_total: amount,
        currency,
        metadata,
        client_reference_id: typeof body.client_reference_id === 'string' ? body.client_reference_id : null,
        customer_email: typeof body.customer_email === 'string' ? body.customer_email : null,
        success_url: typeof body.success_url === 'string' ? body.success_url : null,
        cancel_url: typeof body.cancel_url === 'string' ? body.cancel_url : null,
        expires_at: body.expires_at ? Number(body.expires_at) : created + 24 * 60 * 60,
        created,
        livemode: false,
      }
      stub.paymentIntents.set(piId, pi)
      stub.sessions.set(id, session)
      return json(200, withExpand(session, expand, stub))
    }

    if (method === 'GET' && (m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) {
      const session = stub.sessions.get(m[1]!)
      if (!session) return stripeError(404, 'invalid_request_error', `No such checkout.session: '${m[1]}'`)
      return json(200, withExpand(session, expand, stub))
    }

    if (method === 'GET' && (m = path.match(/^\/v1\/payment_intents\/([^/]+)$/))) {
      const pi = stub.paymentIntents.get(m[1]!)
      if (!pi) return stripeError(404, 'invalid_request_error', `No such payment_intent: '${m[1]}'`)
      return json(200, withExpand(pi, expand, stub))
    }

    if (method === 'POST' && (m = path.match(/^\/v1\/payment_intents\/([^/]+)\/cancel$/))) {
      const pi = stub.paymentIntents.get(m[1]!)
      if (!pi) return stripeError(404, 'invalid_request_error', `No such payment_intent: '${m[1]}'`)
      pi.status = 'canceled'
      return json(200, withExpand(pi, expand, stub))
    }

    if (method === 'POST' && path === '/v1/refunds') {
      let pi: StubPaymentIntent | undefined
      if (typeof body.payment_intent === 'string') {
        pi = stub.paymentIntents.get(body.payment_intent)
      } else if (typeof body.charge === 'string') {
        pi = [...stub.paymentIntents.values()].find(p => p.latest_charge.id === body.charge)
      }
      if (!pi) {
        return stripeError(400, 'invalid_request_error',
          `No such ${typeof body.charge === 'string' ? 'charge' : 'payment_intent'}: '${body.charge ?? body.payment_intent ?? ''}'`)
      }
      const amount = body.amount ? Number(body.amount) : pi.amount - pi.amount_refunded
      const refund: RefundRecord = {
        id: nextId('re'),
        object: 'refund',
        payment_intent: pi.id,
        charge: pi.latest_charge.id,
        amount,
        currency: pi.currency,
        status: 'succeeded',
        reason: typeof body.reason === 'string' ? body.reason : null,
        created: now(),
      }
      pi.refunds.push(refund.id)
      pi.amount_refunded += amount
      stub.refunds.push(refund)
      return json(200, refund)
    }

    if (method === 'GET' && (path === '/v1/account' || path === '/v1/accounts' || /^\/v1\/accounts\/[^/]+$/.test(path))) {
      return json(200, { id: 'acct_test', object: 'account', settings: { dashboard: { display_name: 'Stub' } } })
    }

    return stripeError(404, 'invalid_request_error', `Unrecognized request URL (${method}: ${path}).`)
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req)
      .catch((e: unknown) => stripeError(500, 'api_error', String(e)))
      .then((out) => {
        res.writeHead(out.status, { 'content-type': out.contentType, 'content-length': Buffer.byteLength(out.body) })
        res.end(out.body)
      })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address !== 'object') throw new Error('stripe-stub: el servidor no expone su puerto')
  stub.port = address.port
  stub.baseUrl = `http://127.0.0.1:${address.port}`
  stub.stop = () => {
    server.closeAllConnections()
    server.close()
  }
  return stub
}

/** Simula que el huésped pagó: session completa/paid y PI succeeded. Devuelve la session (para
 *  armar el evento `checkout.session.completed`). */
export function markSessionPaid(stub: StripeStub, sessionId: string): StubSession {
  const session = stub.sessions.get(sessionId)
  if (!session) throw new Error(`stripe-stub: no existe la session ${sessionId}`)
  session.status = 'complete'
  session.payment_status = 'paid'
  const pi = stub.paymentIntents.get(session.payment_intent)
  if (pi) pi.status = 'succeeded'
  return session
}

/**
 * Firma un evento igual que Stripe: `t=<ts>,v1=HMAC-SHA256(secret, "<ts>.<payload>")`. El
 * `payload` devuelto es EXACTAMENTE lo que hay que mandar como body (la firma es sobre los bytes
 * crudos; re-serializar rompe la verificación).
 */
export function signStripeEvent(
  secret: string,
  event: object,
  timestamp: number = now(),
): { payload: string; signature: string } {
  const payload = JSON.stringify(event)
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return { payload, signature: `t=${timestamp},v1=${v1}` }
}

export interface StubEvent {
  id: string
  object: 'event'
  type: string
  created: number
  data: { object: StubSession }
  api_version: string
  livemode: false
}

function buildEvent(type: string, session: StubSession): StubEvent {
  return {
    id: nextId('evt'),
    object: 'event',
    type,
    created: now(),
    data: { object: session },
    api_version: '2025-08-27.basil',
    livemode: false,
  }
}

export function buildCheckoutCompletedEvent(session: StubSession): StubEvent {
  return buildEvent('checkout.session.completed', session)
}

export function buildCheckoutExpiredEvent(session: StubSession): StubEvent {
  return buildEvent('checkout.session.expired', session)
}

// ─── Self-test: `bun run e2e/helpers/stripe-stub.ts --selftest` ────────────────────────────────
// Valida el contrato con el SDK REAL de stripe-node (el del backend) apuntado al stub, más un
// fetch a mano con el mismo form-urlencoded que manda el SDK.

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`selftest: ${msg}`)
}

async function selftest(): Promise<void> {
  const stub = await startStripeStub()
  try {
    const headers = { authorization: 'Bearer sk_test_stub', 'content-type': 'application/x-www-form-urlencoded' }

    // 1. Sin API key → 401 al estilo Stripe.
    const unauth = await fetch(`${stub.baseUrl}/v1/checkout/sessions`, { method: 'POST', body: '' })
    assert(unauth.status === 401, `sin Bearer esperaba 401, vino ${unauth.status}`)

    // 2. Crear session con fetch (form-urlencoded, claves anidadas qs).
    const form = 'mode=payment&metadata[reservationId]=r1&client_reference_id=ref-1'
      + '&line_items[0][price_data][currency]=usd&line_items[0][price_data][unit_amount]=1000&line_items[0][quantity]=2'
    const created = await fetch(`${stub.baseUrl}/v1/checkout/sessions`, { method: 'POST', headers, body: form })
    assert(created.status === 200, `crear session: ${created.status}`)
    const s1 = await created.json() as StubSession
    assert(/^cs_test_[0-9a-f]{8}_\d+$/.test(s1.id), `id de session con prefijo por proceso: ${s1.id}`)
    assert(/^pi_test_[0-9a-f]{8}_\d+$/.test(s1.payment_intent), `id de PI: ${s1.payment_intent}`)
    assert(s1.amount_total === 2000, `amount_total 1000×2 esperaba 2000, vino ${s1.amount_total}`)
    assert(s1.metadata.reservationId === 'r1', 'metadata[reservationId] no llegó')
    assert(s1.client_reference_id === 'ref-1', 'client_reference_id no llegó')
    assert(s1.url === `${stub.baseUrl}/checkout/${s1.id}`, `url de checkout: ${s1.url}`)

    // 3. Recuperarla y leer el PI con expand.
    const got = await (await fetch(`${stub.baseUrl}/v1/checkout/sessions/${s1.id}`, { headers })).json() as StubSession
    assert(got.payment_intent === s1.payment_intent, 'retrieve session no coincide')
    const piRes = await fetch(`${stub.baseUrl}/v1/payment_intents/${s1.payment_intent}?expand[0]=latest_charge`, { headers })
    const pi = await piRes.json() as StubPaymentIntent
    assert(pi.latest_charge.payment_method_details.card.last4 === '4242', 'latest_charge no expandido')
    assert(pi.metadata.reservationId === 'r1', 'el PI no heredó el metadata')

    // 4. Refund por payment_intent + página de checkout.
    const refRes = await fetch(`${stub.baseUrl}/v1/refunds`, { method: 'POST', headers, body: `payment_intent=${s1.payment_intent}&amount=500` })
    const refund = await refRes.json() as RefundRecord
    assert(refund.status === 'succeeded' && refund.amount === 500, 'refund por fetch')
    assert(/^re_test_[0-9a-f]{8}_\d+$/.test(refund.id), `id de refund: ${refund.id}`)
    assert(stub.refunds.length === 1, 'refunds no registrado')
    assert(stub.refunds[0]!.payment_intent === s1.payment_intent, 'refunds: PI equivocado')
    const page = await (await fetch(s1.url)).text()
    assert(page.includes('data-testid="stripe-stub-checkout"') && page.includes(s1.id), 'página de checkout')

    // 5. El contrato que importa: SDK real de stripe-node contra el stub.
    const { default: Stripe } = await import('../../../backend/node_modules/stripe/esm/stripe.esm.node.js')
    const stripe = new Stripe('sk_test_stub', { host: '127.0.0.1', port: stub.port, protocol: 'http', maxNetworkRetries: 0 })
    const sdkSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Reserva' }, unit_amount: 12345 }, quantity: 1 }],
      success_url: 'http://localhost/ok',
      cancel_url: 'http://localhost/cancel',
      client_reference_id: 'ref-sdk',
      metadata: { reference: 'ref-sdk', hotelId: 'h1' },
      payment_intent_data: { metadata: { reference: 'ref-sdk' } },
    }, { idempotencyKey: 'idem-1' })
    assert(sdkSession.url === `${stub.baseUrl}/checkout/${sdkSession.id}`, 'SDK: url de session')
    assert(sdkSession.amount_total === 12345, `SDK: amount_total ${sdkSession.amount_total}`)
    assert(typeof sdkSession.payment_intent === 'string', 'SDK: payment_intent sin expandir debe ser string')

    const sdkPi = await stripe.paymentIntents.retrieve(sdkSession.payment_intent, { expand: ['latest_charge'] })
    const charge = sdkPi.latest_charge
    assert(charge && typeof charge === 'object', 'SDK: latest_charge no expandido')
    assert(charge.payment_method_details?.card?.brand === 'visa', 'SDK: brand de la tarjeta')

    const paid = markSessionPaid(stub, sdkSession.id)
    assert(paid.status === 'complete' && paid.payment_status === 'paid', 'markSessionPaid')
    assert(stub.paymentIntents.get(paid.payment_intent)?.status === 'succeeded', 'markSessionPaid: PI')

    const sdkRefund = await stripe.refunds.create({ payment_intent: sdkSession.payment_intent }, { idempotencyKey: 'idem-2' })
    assert(sdkRefund.status === 'succeeded' && sdkRefund.amount === 12345, 'SDK: refund')
    assert(stub.refunds.at(-1)?.id === sdkRefund.id, 'SDK: refund no registrado')

    const acct = await (stripe.accounts as unknown as { retrieve(): Promise<{ id: string }> }).retrieve()
    assert(acct.id === 'acct_test', 'SDK: account')

    const cancelled = await stripe.paymentIntents.cancel(sdkSession.payment_intent)
    assert(cancelled.status === 'canceled', 'SDK: cancel')

    // 6. La firma valida con el verificador real del SDK (constructEventAsync, como en el backend).
    const event = buildCheckoutCompletedEvent(paid)
    assert(/^evt_test_[0-9a-f]{8}_\d+$/.test(event.id), `id de evento: ${event.id}`)
    const { payload, signature } = signStripeEvent('whsec_stub', event)
    const verified = await stripe.webhooks.constructEventAsync(payload, signature, 'whsec_stub')
    assert(verified.type === 'checkout.session.completed' && verified.id === event.id, 'firma: evento no coincide')
    const obj = verified.data.object as unknown as StubSession
    assert(obj.id === paid.id && obj.payment_status === 'paid', 'firma: session en data.object')
    let rejected = false
    try { await stripe.webhooks.constructEventAsync(payload, signature, 'whsec_otro') } catch { rejected = true }
    assert(rejected, 'firma con otro secreto tendría que fallar')
    assert(buildCheckoutExpiredEvent(paid).type === 'checkout.session.expired', 'evento expired')

    // 7. Ruta desconocida → 404 Stripe-like; registro de requests.
    const nf = await fetch(`${stub.baseUrl}/v1/customers`, { headers })
    assert(nf.status === 404 && (await nf.json() as { error: { type: string } }).error.type === 'invalid_request_error', '404')
    assert(stub.requests.some(r => r.method === 'POST' && r.path === '/v1/refunds'), 'requests no registra')
  } finally {
    stub.stop()
  }
  console.log('OK')
}

if (import.meta.main && process.argv.includes('--selftest')) {
  selftest().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
