// modules/payment-gateways/tests/paypal-gateway.test.ts
//
// Cubre el adapter de PayPal (services/payment-gateway/paypal-gateway.ts) mockeando `fetch`
// global: sin credenciales de PayPal ni red, igual que cardnet-gateway.test.ts. Las respuestas
// mockeadas tienen la forma documentada de Orders v2 / Payments v2.
//
// Para el camino de `confirm()` con firma VÁLIDA se genera un par RSA en el test y se firma el
// mensaje exactamente como lo firma PayPal (misma técnica que paypal-webhook.test.ts): el "cert"
// se sirve como PEM de clave pública desde una URL de api.paypal.com, que es lo único que la
// allowlist del verificador acepta.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createSign, generateKeyPairSync } from 'node:crypto'
import {
  PayPalGateway,
  toPayPalCredentials,
  toPayPalAmount,
  fromPayPalAmount,
  type PayPalCredentials,
} from '../../../services/payment-gateway/paypal-gateway'
import {
  buildVerificationMessage,
  clearPayPalCertCache,
} from '../../../services/payment-gateway/paypal-webhook'

const WEBHOOK_ID = 'WH-77D19822CH2334701-1TU21456UF8'
const CERT_URL = 'https://api.paypal.com/v1/notifications/certs/CERT-360caa42'
const TRANSMISSION_ID = '69cd13f0-d67a-11e5-baa3-778b53f4ae55'

const creds: PayPalCredentials = {
  clientId: 'AXcId', clientSecret: 'ELsecreto', webhookId: WEBHOOK_ID, currency: 'usd',
}

function gw(overrides: Partial<PayPalCredentials> = {}) {
  return new PayPalGateway({ ...creds, ...overrides }, 'test')
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const originalFetch = globalThis.fetch

interface FetchCall { url: string; method: string; headers: Record<string, string>; body?: any }

/**
 * Router de `fetch` doble: devuelve lo que corresponde según la URL y registra cada llamada para
 * poder afirmar A QUÉ endpoint se pegó (que es la mitad de lo que hay que probar de un adapter).
 */
function mockFetch(routes: Array<{ match: RegExp; respond: (call: FetchCall) => Response }>) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const rawHeaders = (init.headers || {}) as Record<string, string>
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v)
    let body: any
    if (typeof init.body === 'string' && init.body.startsWith('{')) body = JSON.parse(init.body)
    else body = init.body
    const call: FetchCall = { url, method: String(init.method || 'GET'), headers, body }
    calls.push(call)
    const route = routes.find(r => r.match.test(url))
    if (!route) return new Response('no route', { status: 404 })
    return route.respond(call)
  }) as any
  return calls
}

const tokenRoute = (accessToken = 'A21AA-token', expiresIn = 32400) => ({
  match: /\/v1\/oauth2\/token$/,
  respond: () => new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), { status: 200 }),
})

const orderRoute = (body: any, status = 201) => ({
  match: /\/v2\/checkout\/orders$/,
  respond: () => new Response(JSON.stringify(body), { status }),
})

const ORDER_OK = {
  id: 'ORDER-1',
  status: 'PAYER_ACTION_REQUIRED',
  links: [
    { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1' },
    { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1' },
  ],
}

function charge(over: Record<string, any> = {}) {
  return {
    hotelId: 'h1', amountMinor: 12345, currency: 'USD', description: 'Pago de reserva',
    reference: 'RES-42', successUrl: 'https://hotel.test/ok', cancelUrl: 'https://hotel.test/cancel',
    ...over,
  } as any
}

beforeEach(() => {
  clearPayPalCertCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  clearPayPalCertCache()
})

describe('toPayPalCredentials', () => {
  it('traduce el JSON genérico de payment_gateways.credentials', () => {
    expect(toPayPalCredentials({
      publishableKey: 'client-id', secretKey: 'client-secret', webhookSecret: 'WH-1', currency: 'eur',
      merchantId: 'no-usado', certPem: 'no-usado',
    })).toEqual({ clientId: 'client-id', clientSecret: 'client-secret', webhookId: 'WH-1', currency: 'eur' })
  })

  it('campos ausentes → cadena vacía (y currency undefined)', () => {
    expect(toPayPalCredentials({})).toEqual({ clientId: '', clientSecret: '', webhookId: '', currency: undefined })
  })
})

describe('PayPalGateway — capacidades y validación de credenciales', () => {
  it('declara exactamente las capacidades del catálogo (refund/void sí, links no, push)', () => {
    const g = gw()
    expect(g.provider).toBe('paypal')
    expect(g.capabilities).toEqual({ refund: true, void: true, paymentLinks: false, confirmation: 'push' })
  })

  it('exige clientId y clientSecret al construir', () => {
    expect(() => new PayPalGateway({ ...creds, clientId: '' }, 'test')).toThrow(/clientId/)
    expect(() => new PayPalGateway({ ...creds, clientSecret: '' }, 'test')).toThrow(/clientSecret/)
  })
})

describe('conversión de montos (unidades menores ↔ decimal de PayPal)', () => {
  it('monedas de 2 decimales', () => {
    expect(toPayPalAmount(12345, 'USD')).toBe('123.45')
    expect(toPayPalAmount(5, 'USD')).toBe('0.05')
    expect(toPayPalAmount(0, 'usd')).toBe('0.00')
  })

  it('las TRES monedas sin decimales de PayPal (HUF, JPY, TWD): 5000 JPY es ¥5000, no ¥50', () => {
    expect(toPayPalAmount(5000, 'JPY')).toBe('5000')
    expect(toPayPalAmount(150000, 'HUF')).toBe('150000')
    expect(toPayPalAmount(3000, 'twd')).toBe('3000')
    expect(fromPayPalAmount('150000', 'HUF')).toBe(150000)
  })

  it('KRW, CLP y VND llevan DOS decimales en PayPal (la lista de cero decimales es la de Stripe)', () => {
    // Tratarlas como de cero decimales cobraba 100 veces de más: 150000 (=$1500,00) viajaba
    // como '150000'. PayPal sólo exceptúa HUF/JPY/TWD.
    expect(toPayPalAmount(150000, 'CLP')).toBe('1500.00')
    expect(toPayPalAmount(150000, 'KRW')).toBe('1500.00')
    expect(toPayPalAmount(150000, 'VND')).toBe('1500.00')
    expect(fromPayPalAmount('1500.00', 'CLP')).toBe(150000)
  })

  it('la vuelta es exacta y sin float suelto', () => {
    expect(fromPayPalAmount('123.45', 'USD')).toBe(12345)
    expect(fromPayPalAmount('119.95', 'USD')).toBe(11995)
    expect(fromPayPalAmount('250', 'USD')).toBe(25000)
    expect(fromPayPalAmount('5000', 'JPY')).toBe(5000)
    expect(fromPayPalAmount(undefined, 'USD')).toBe(0)
  })
})

describe('PayPalGateway — createCharge', () => {
  it('pide el token una sola vez y reusa el cacheado en la segunda llamada', async () => {
    const calls = mockFetch([tokenRoute(), orderRoute(ORDER_OK)])
    const g = gw()
    await g.createCharge(charge())
    await g.createCharge(charge())
    expect(calls.filter(c => c.url.includes('/v1/oauth2/token')).length).toBe(1)
    expect(calls.filter(c => c.url.includes('/v2/checkout/orders')).length).toBe(2)
  })

  it('pide el token con Basic auth y grant_type=client_credentials contra el host de sandbox', async () => {
    const calls = mockFetch([tokenRoute(), orderRoute(ORDER_OK)])
    await gw().createCharge(charge())
    const tokenCall = calls[0]!
    expect(tokenCall.url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token')
    expect(tokenCall.method).toBe('POST')
    expect(tokenCall.body).toBe('grant_type=client_credentials')
    const basic = Buffer.from('AXcId:ELsecreto').toString('base64')
    expect(tokenCall.headers.authorization).toBe(`Basic ${basic}`)
  })

  it('usa el host live en modo live', async () => {
    const calls = mockFetch([tokenRoute(), orderRoute(ORDER_OK)])
    await new PayPalGateway(creds, 'live').createCharge(charge())
    expect(calls.every(c => c.url.startsWith('https://api-m.paypal.com/'))).toBe(true)
  })

  it('manda el amount decimal correcto y la referencia, y devuelve el href de "approve"', async () => {
    const calls = mockFetch([tokenRoute(), orderRoute(ORDER_OK)])
    const res = await gw().createCharge(charge())
    expect(res.status).toBe('redirect')
    if (res.status !== 'redirect') throw new Error('unreachable')
    expect(res.redirectUrl).toBe('https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1')
    expect(res.providerRef).toBe('ORDER-1')

    const order = calls.find(c => c.url.includes('/v2/checkout/orders'))!
    expect(order.body.intent).toBe('CAPTURE')
    expect(order.body.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '123.45' })
    expect(order.body.purchase_units[0].custom_id).toBe('RES-42')
    expect(order.body.payment_source.paypal.experience_context.return_url).toBe('https://hotel.test/ok')
    expect(order.body.payment_source.paypal.experience_context.cancel_url).toBe('https://hotel.test/cancel')
    expect(order.headers.authorization).toBe('Bearer A21AA-token')
  })

  it('moneda de 0 decimales: 5000 JPY viaja como "5000"', async () => {
    const calls = mockFetch([tokenRoute(), orderRoute(ORDER_OK)])
    await gw().createCharge(charge({ amountMinor: 5000, currency: 'JPY' }))
    const order = calls.find(c => c.url.includes('/v2/checkout/orders'))!
    expect(order.body.purchase_units[0].amount).toEqual({ currency_code: 'JPY', value: '5000' })
  })

  it('acepta también el link "payer-action" (variante de Orders v2 con payment_source)', async () => {
    mockFetch([tokenRoute(), orderRoute({
      id: 'ORDER-2', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/pay/ORDER-2' }],
    })])
    const res = await gw().createCharge(charge())
    expect(res.status).toBe('redirect')
    if (res.status !== 'redirect') throw new Error('unreachable')
    expect(res.redirectUrl).toBe('https://www.sandbox.paypal.com/pay/ORDER-2')
  })

  it('manda PayPal-Request-Id cuando hay idempotencyKey (y no lo manda si no hay)', async () => {
    const calls = mockFetch([tokenRoute(), orderRoute(ORDER_OK)])
    const g = gw()
    await g.createCharge(charge({ idempotencyKey: 'RES-42' }))
    await g.createCharge(charge())
    const orders = calls.filter(c => c.url.includes('/v2/checkout/orders'))
    expect(orders[0]!.headers['paypal-request-id']).toBe('RES-42')
    expect(orders[1]!.headers['paypal-request-id']).toBeUndefined()
  })

  it('si PayPal responde error → {status:"failed"} y NO lanza', async () => {
    mockFetch([tokenRoute(), orderRoute({ message: 'CURRENCY_NOT_SUPPORTED' }, 422)])
    const res = await gw().createCharge(charge())
    expect(res.status).toBe('failed')
    if (res.status !== 'failed') throw new Error('unreachable')
    expect(res.reason).toContain('CURRENCY_NOT_SUPPORTED')
  })

  it('si el OAuth falla → {status:"failed"}, la excepción no sale del adapter', async () => {
    mockFetch([{ match: /\/v1\/oauth2\/token$/, respond: () => new Response(JSON.stringify({ error_description: 'Client Authentication failed' }), { status: 401 }) }])
    const res = await gw().createCharge(charge())
    expect(res.status).toBe('failed')
    if (res.status !== 'failed') throw new Error('unreachable')
    expect(res.reason).toContain('Client Authentication failed')
  })

  it('orden sin link de aprobación → failed (no se puede mandar al huésped a ningún lado)', async () => {
    mockFetch([tokenRoute(), orderRoute({ id: 'ORDER-3', links: [] })])
    const res = await gw().createCharge(charge())
    expect(res.status).toBe('failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// confirm(): webhook firmado

function eventBody(over: Record<string, any> = {}): string {
  return JSON.stringify({
    id: 'WH-EVENT-1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE-1',
      custom_id: 'RES-42',
      amount: { currency_code: 'USD', value: '250.00' },
    },
    ...over,
  })
}

/**
 * Un CHECKOUT.ORDER.*: el `resource` es la ORDEN, no la captura. El monto y el `custom_id` viven
 * en `purchase_units[0]` y el id de la captura en `purchase_units[0].payments.captures[0]`. Es la
 * forma real que manda PayPal, y es la que un mock plano (todo colgado de la raíz del resource)
 * deja pasar: con ella, leer sólo la raíz devuelve amountMinor 0 y reference ''.
 */
function orderEventBody(eventType: string, unitOver: Record<string, any> = {}): string {
  return JSON.stringify({
    id: 'WH-EVENT-ORDER-1',
    event_type: eventType,
    resource: {
      id: 'ORDER-77',
      status: 'COMPLETED',
      purchase_units: [{
        reference_id: 'default',
        custom_id: 'RES-77',
        amount: { currency_code: 'USD', value: '180.50' },
        payments: {
          captures: [{
            id: 'CAPTURE-77', status: 'COMPLETED',
            amount: { currency_code: 'USD', value: '180.50' },
          }],
        },
        ...unitOver,
      }],
    },
  })
}

/** Firma como firma PayPal: RSA-SHA256 sobre `id|time|webhookId|crc32(body)`, base64. */
function sign(body: string, transmissionTime: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(buildVerificationMessage(TRANSMISSION_ID, transmissionTime, WEBHOOK_ID, body), 'utf8')
  signer.end()
  return signer.sign(privateKey).toString('base64')
}

/** Headers de un webhook auténtico, con timestamp dentro de la ventana de tolerancia (300s). */
function signedHeaders(body: string): Record<string, string> {
  const transmissionTime = new Date().toISOString()
  return {
    'paypal-transmission-id': TRANSMISSION_ID,
    'paypal-transmission-time': transmissionTime,
    'paypal-transmission-sig': sign(body, transmissionTime),
    'paypal-cert-url': CERT_URL,
    'paypal-auth-algo': 'SHA256withRSA',
  }
}

/** El verificador baja el "certificado" por el fetch global: se lo servimos desde paypal.com. */
function mockCertFetch() {
  return mockFetch([{ match: /^https:\/\/api\.paypal\.com\//, respond: () => new Response(publicPem, { status: 200 }) }])
}

describe('PayPalGateway — confirm()', () => {
  it('sin header de firma → null (no es un webhook de PayPal)', async () => {
    expect(await gw().confirm({ hotelId: 'h1', headers: {}, rawBody: eventBody() })).toBeNull()
  })

  it('sin rawBody → tira: es configuración rota, no un impostor', async () => {
    const body = eventBody()
    await expect(gw().confirm({ hotelId: 'h1', headers: signedHeaders(body) }))
      .rejects.toThrow(/rawBody/)
  })

  it('sin webhookId en credenciales → tira', async () => {
    const body = eventBody()
    await expect(gw({ webhookId: '' }).confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body }))
      .rejects.toThrow(/webhookId/)
  })

  it('firma que no valida → null (impostor), sin lanzar', async () => {
    mockCertFetch()
    const body = eventBody()
    const headers = { ...signedHeaders(body), 'paypal-transmission-sig': Buffer.from('firma-trucha').toString('base64') }
    expect(await gw().confirm({ hotelId: 'h1', headers, rawBody: body })).toBeNull()
  })

  it('body alterado después de firmar → null', async () => {
    mockCertFetch()
    const body = eventBody()
    const headers = signedHeaders(body)
    const tampered = eventBody({ resource: { id: 'CAPTURE-1', custom_id: 'RES-42', amount: { currency_code: 'USD', value: '2.00' } } })
    expect(await gw().confirm({ hotelId: 'h1', headers, rawBody: tampered })).toBeNull()
  })

  it('cert-url de un host ajeno → null y NO se descarga nada', async () => {
    const calls = mockFetch([{ match: /.*/, respond: () => new Response(publicPem, { status: 200 }) }])
    const body = eventBody()
    const headers = { ...signedHeaders(body), 'paypal-cert-url': 'https://paypal.com.attacker.test/cert.pem' }
    expect(await gw().confirm({ hotelId: 'h1', headers, rawBody: body })).toBeNull()
    expect(calls.length).toBe(0)
  })

  it('firma válida → PaymentOutcome con eventId = id del EVENTO, no el de la captura', async () => {
    mockCertFetch()
    const body = eventBody()
    const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })
    expect(outcome).not.toBeNull()
    expect(outcome!.eventId).toBe('WH-EVENT-1')
    expect(outcome!.providerRef).toBe('CAPTURE-1')
    expect(outcome!.status).toBe('paid')
    expect(outcome!.amountMinor).toBe(25000)
    expect(outcome!.currency).toBe('USD')
    expect(outcome!.reference).toBe('RES-42')
  })

  it('el monto vuelve a unidades menores respetando las monedas de 0 decimales', async () => {
    mockCertFetch()
    const body = eventBody({
      resource: { id: 'CAPTURE-9', custom_id: 'RES-9', amount: { currency_code: 'JPY', value: '5000' } },
    })
    const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })
    expect(outcome!.amountMinor).toBe(5000)
    expect(outcome!.currency).toBe('JPY')
  })

  it('mapea los cinco estados del dominio, con el payload REAL de cada familia de evento', async () => {
    const cases: Array<[string, string]> = [
      ['PAYMENT.CAPTURE.COMPLETED', 'paid'],
      ['CHECKOUT.ORDER.COMPLETED', 'paid'],
      ['PAYMENT.CAPTURE.DENIED', 'failed'],
      ['PAYMENT.CAPTURE.DECLINED', 'failed'],
      ['PAYMENT.CAPTURE.PENDING', 'pending'],
      ['CHECKOUT.ORDER.APPROVED', 'pending'],
      ['PAYMENT.CAPTURE.REFUNDED', 'refunded'],
      ['PAYMENT.CAPTURE.REVERSED', 'refunded'],
      ['CHECKOUT.ORDER.VOIDED', 'expired'],
    ]
    for (const [eventType, expected] of cases) {
      clearPayPalCertCache()
      mockCertFetch()
      // Los CHECKOUT.ORDER.* traen purchase_units; los PAYMENT.CAPTURE.* traen la captura pelada.
      const isOrder = eventType.startsWith('CHECKOUT.ORDER.')
      const body = isOrder ? orderEventBody(eventType) : eventBody({ event_type: eventType })
      const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })
      expect(outcome?.status).toBe(expected as any)
      // Ningún evento puede salir con monto 0 ni sin referencia: así no se concilia con el folio.
      expect(outcome!.amountMinor).toBe(isOrder ? 18050 : 25000)
      expect(outcome!.reference).toBe(isOrder ? 'RES-77' : 'RES-42')
    }
  })

  it('CHECKOUT.ORDER.COMPLETED: monto y custom_id salen de purchase_units, y el ref es la CAPTURA', async () => {
    mockCertFetch()
    const body = orderEventBody('CHECKOUT.ORDER.COMPLETED')
    const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })
    expect(outcome!.status).toBe('paid')
    expect(outcome!.eventId).toBe('WH-EVENT-ORDER-1')
    expect(outcome!.amountMinor).toBe(18050)
    expect(outcome!.currency).toBe('USD')
    expect(outcome!.reference).toBe('RES-77')
    // El id que aceptan /payments/captures/{id}/refund y el void, no el de la orden.
    expect(outcome!.providerRef).toBe('CAPTURE-77')
  })

  it('CHECKOUT.ORDER.APPROVED (todavía sin captura): monto y referencia igual, ref = id de la orden', async () => {
    mockCertFetch()
    const body = orderEventBody('CHECKOUT.ORDER.APPROVED', { payments: undefined })
    const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })
    expect(outcome!.status).toBe('pending')
    expect(outcome!.amountMinor).toBe(18050)
    expect(outcome!.reference).toBe('RES-77')
    expect(outcome!.providerRef).toBe('ORDER-77')
  })

  it('CHECKOUT.ORDER.VOIDED en moneda sin decimales: 5000 JPY vuelve como 5000', async () => {
    mockCertFetch()
    const body = orderEventBody('CHECKOUT.ORDER.VOIDED', {
      payments: undefined, amount: { currency_code: 'JPY', value: '5000' },
    })
    const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })
    expect(outcome!.status).toBe('expired')
    expect(outcome!.amountMinor).toBe(5000)
    expect(outcome!.currency).toBe('JPY')
  })

  it('si el purchase_unit no trae custom_id se cae al invoice_id y después al reference_id', async () => {
    mockCertFetch()
    const body = orderEventBody('CHECKOUT.ORDER.COMPLETED', { custom_id: undefined, invoice_id: 'INV-77' })
    const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })
    expect(outcome!.reference).toBe('INV-77')
  })

  it('evento que no nos interesa (aunque venga bien firmado) → null', async () => {
    mockCertFetch()
    const body = eventBody({ event_type: 'BILLING.SUBSCRIPTION.CREATED' })
    expect(await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: body })).toBeNull()
  })

  it('acepta el rawBody como Buffer (que es como llega del framework)', async () => {
    mockCertFetch()
    const body = eventBody()
    const outcome = await gw().confirm({ hotelId: 'h1', headers: signedHeaders(body), rawBody: Buffer.from(body, 'utf8') })
    expect(outcome?.status).toBe('paid')
  })
})

describe('PayPalGateway — refund / voidCharge', () => {
  it('refund total pega a /v2/payments/captures/{id}/refund con body vacío', async () => {
    const calls = mockFetch([
      tokenRoute(),
      { match: /\/refund$/, respond: () => new Response(JSON.stringify({ id: 'REFUND-1', status: 'COMPLETED' }), { status: 201 }) },
    ])
    const r = await gw().refund('CAPTURE-1')
    expect(r).toEqual({ refundId: 'REFUND-1', status: 'COMPLETED' })
    const call = calls.find(c => c.url.includes('/refund'))!
    expect(call.url).toBe('https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-1/refund')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({})
  })

  it('refund parcial manda el monto como decimal de PayPal', async () => {
    const calls = mockFetch([
      tokenRoute(),
      { match: /\/refund$/, respond: () => new Response(JSON.stringify({ id: 'REFUND-2', status: 'PENDING' }), { status: 201 }) },
    ])
    await gw().refund('CAPTURE-1', 10000)
    const call = calls.find(c => c.url.includes('/refund'))!
    expect(call.body).toEqual({ amount: { currency_code: 'USD', value: '100.00' } })
  })

  it('refund con respuesta no-ok tira con el mensaje de PayPal', async () => {
    mockFetch([
      tokenRoute(),
      { match: /\/refund$/, respond: () => new Response(JSON.stringify({ message: 'CAPTURE_FULLY_REFUNDED' }), { status: 422 }) },
    ])
    await expect(gw().refund('CAPTURE-1')).rejects.toThrow(/CAPTURE_FULLY_REFUNDED/)
  })

  it('voidCharge pega a /v2/payments/authorizations/{id}/void', async () => {
    const calls = mockFetch([
      tokenRoute(),
      { match: /\/void$/, respond: () => new Response('', { status: 204 }) },
    ])
    await expect(gw().voidCharge('AUTH-1')).resolves.toBeUndefined()
    const call = calls.find(c => c.url.includes('/void'))!
    expect(call.url).toBe('https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/void')
    expect(call.method).toBe('POST')
  })

  it('voidCharge tira si PayPal rechaza la anulación', async () => {
    mockFetch([
      tokenRoute(),
      { match: /\/void$/, respond: () => new Response(JSON.stringify({ message: 'AUTHORIZATION_ALREADY_CAPTURED' }), { status: 422 }) },
    ])
    await expect(gw().voidCharge('AUTH-1')).rejects.toThrow(/AUTHORIZATION_ALREADY_CAPTURED/)
  })
})
