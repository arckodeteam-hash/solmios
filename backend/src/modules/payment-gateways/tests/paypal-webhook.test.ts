// modules/payment-gateways/tests/paypal-webhook.test.ts
//
// Cubre la verificación offline de la firma de los webhooks de PayPal
// (services/payment-gateway/paypal-webhook.ts). Es un test de SEGURIDAD: cada caso negativo tiene
// que fallar si se saca el chequeo que lo cubre, porque un webhook aceptado de más marca una
// reserva como pagada sin que haya entrado plata.
//
// Sin credenciales de PayPal (.env.test sólo trae JWT_SECRET) y sin red: se genera un par RSA de
// verdad con generateKeyPairSync, se firma el mensaje exactamente como lo firma PayPal y el
// "certificado" se sirve por `fetchImpl`. Se inyecta la CLAVE PÚBLICA en PEM en vez de un X.509
// autofirmado porque ni Node ni Bun traen forma de emitir un certificado — por eso el módulo acepta
// tanto un PEM `CERTIFICATE` (lo real de PayPal) como uno `PUBLIC KEY` (esto). Mismo criterio que
// wallet-pass/tests/generate-pass.test.ts: llaves on-the-fly, cero fixtures pegadas al repo.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createSign, generateKeyPairSync } from 'node:crypto'
import {
  crc32,
  buildVerificationMessage,
  isTrustedCertUrl,
  verifyPayPalWebhookSignature,
  clearPayPalCertCache,
} from '../../../services/payment-gateway/paypal-webhook'

const WEBHOOK_ID = 'WH-77D19822CH2334701-1TU21456UF8'
const CERT_URL = 'https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270'
const TRANSMISSION_ID = '69cd13f0-d67a-11e5-baa3-778b53f4ae55'
const TRANSMISSION_TIME = '2026-09-05T20:00:00Z'
const NOW_MS = Date.parse(TRANSMISSION_TIME)

const RAW_BODY = JSON.stringify({
  id: 'WH-2WR32451HC0233532-67976317FL4543714',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: 'CAPTURE-1', amount: { currency_code: 'USD', value: '250.00' } },
})

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
// Un segundo par: sirve para probar que una firma hecha con OTRA llave no pasa.
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey

/** Firma como firma PayPal: RSA-SHA256 sobre `id|time|webhookId|crc32(body)`, base64. */
function sign(opts: {
  transmissionId?: string
  transmissionTime?: string
  webhookId?: string
  body?: string
  key?: typeof privateKey
} = {}): string {
  const message = buildVerificationMessage(
    opts.transmissionId ?? TRANSMISSION_ID,
    opts.transmissionTime ?? TRANSMISSION_TIME,
    opts.webhookId ?? WEBHOOK_ID,
    opts.body ?? RAW_BODY,
  )
  const signer = createSign('RSA-SHA256')
  signer.update(message, 'utf8')
  signer.end()
  return signer.sign(opts.key ?? privateKey).toString('base64')
}

function headers(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'paypal-transmission-id': TRANSMISSION_ID,
    'paypal-transmission-time': TRANSMISSION_TIME,
    'paypal-transmission-sig': sign(),
    'paypal-cert-url': CERT_URL,
    'paypal-auth-algo': 'SHA256withRSA',
    ...overrides,
  }
}

/** fetch doble que sirve el PEM de la clave pública y cuenta cuántas veces lo llamaron. */
function certFetch(pem: string = publicPem) {
  const calls: string[] = []
  const impl = (async (url: any) => {
    calls.push(String(url))
    return new Response(pem, { status: 200 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  // La caché de certificados es por URL y vive en el módulo: sin esto un test le presta el
  // certificado al siguiente y los contadores de fetch dejan de significar algo.
  clearPayPalCertCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  clearPayPalCertCache()
})

describe('crc32', () => {
  it('da el vector conocido: crc32("123456789") === 3421780262', () => {
    expect(crc32('123456789')).toBe(3421780262)
  })

  it('es sin signo y sobre los bytes crudos (Buffer y string utf8 coinciden)', () => {
    expect(crc32('')).toBe(0)
    expect(crc32(Buffer.from(RAW_BODY, 'utf8'))).toBe(crc32(RAW_BODY))
    expect(crc32('ñandú')).toBeGreaterThan(0)
    expect(crc32(RAW_BODY)).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('buildVerificationMessage', () => {
  it('arma id|time|webhookId|crc32(body)', () => {
    expect(buildVerificationMessage('id1', 't1', 'wh1', '123456789')).toBe('id1|t1|wh1|3421780262')
  })
})

describe('isTrustedCertUrl — allowlist', () => {
  it('acepta https sobre paypal.com y sus subdominios', () => {
    expect(isTrustedCertUrl('https://api.paypal.com/v1/notifications/certs/CERT-1')).toBe(true)
    expect(isTrustedCertUrl('https://paypal.com/cert.pem')).toBe(true)
    expect(isTrustedCertUrl('https://api.sandbox.paypal.com/cert.pem')).toBe(true)
  })

  it('rechaza otro host, http plano y los parecidos que engañan a un endsWith mal escrito', () => {
    expect(isTrustedCertUrl('https://evil.example.com/cert.pem')).toBe(false)
    expect(isTrustedCertUrl('http://api.paypal.com/cert.pem')).toBe(false)
    expect(isTrustedCertUrl('https://api.paypal.com.evil.com/cert.pem')).toBe(false)
    expect(isTrustedCertUrl('https://notpaypal.com/cert.pem')).toBe(false)
    expect(isTrustedCertUrl('no-es-una-url')).toBe(false)
    expect(isTrustedCertUrl('')).toBe(false)
  })
})

describe('verifyPayPalWebhookSignature — firma válida', () => {
  it('acepta el webhook firmado sobre el body real', async () => {
    const { impl, calls } = certFetch()
    const ok = await verifyPayPalWebhookSignature({
      headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID,
      now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(true)
    expect(calls).toEqual([CERT_URL])
  })

  it('el body puede venir como Buffer (bytes crudos) y da lo mismo', async () => {
    const { impl } = certFetch()
    const ok = await verifyPayPalWebhookSignature({
      headers: headers(), rawBody: Buffer.from(RAW_BODY, 'utf8'), webhookId: WEBHOOK_ID,
      now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(true)
  })

  it('los headers en mayúsculas también valen (Node los baja, un proxy puede no hacerlo)', async () => {
    const { impl } = certFetch()
    const upper: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers())) upper[k.toUpperCase()] = v
    const ok = await verifyPayPalWebhookSignature({
      headers: upper, rawBody: RAW_BODY, webhookId: WEBHOOK_ID,
      now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(true)
  })

  it('sin fetchImpl usa el fetch global', async () => {
    const { impl } = certFetch()
    globalThis.fetch = impl
    const ok = await verifyPayPalWebhookSignature({
      headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS,
    })
    expect(ok).toBe(true)
  })

  it('cachea el certificado: dos eventos seguidos, un solo fetch', async () => {
    const { impl, calls } = certFetch()
    const args = {
      headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID,
      now: () => NOW_MS, fetchImpl: impl,
    }
    expect(await verifyPayPalWebhookSignature(args)).toBe(true)
    expect(await verifyPayPalWebhookSignature(args)).toBe(true)
    expect(calls.length).toBe(1)
  })
})

describe('verifyPayPalWebhookSignature — rechazos (cada uno tapa un agujero real)', () => {
  it('body alterado en un solo byte con la misma firma → false', async () => {
    const { impl } = certFetch()
    const tampered = RAW_BODY.replace('250.00', '250.01')
    expect(tampered).not.toBe(RAW_BODY)
    const ok = await verifyPayPalWebhookSignature({
      headers: headers(), rawBody: tampered, webhookId: WEBHOOK_ID,
      now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(false)
  })

  it('paypal-transmission-id distinto del que se firmó → false (no se puede reusar una firma ajena)', async () => {
    const { impl } = certFetch()
    const ok = await verifyPayPalWebhookSignature({
      headers: headers({ 'paypal-transmission-id': 'otro-id-cualquiera' }),
      rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(false)
  })

  it('webhookId distinto del firmado → false (una firma para otro comercio no vale acá)', async () => {
    const { impl } = certFetch()
    const ok = await verifyPayPalWebhookSignature({
      headers: headers(), rawBody: RAW_BODY, webhookId: 'WH-OTRO-COMERCIO',
      now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(false)
  })

  it('timestamp fuera de la ventana → false, en las DOS direcciones (replay y reloj adelantado)', async () => {
    const { impl } = certFetch()
    const base = {
      headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID, fetchImpl: impl,
    }
    // Viejo por 10 minutos: firma válida pero rancia.
    expect(await verifyPayPalWebhookSignature({ ...base, now: () => NOW_MS + 600_000 })).toBe(false)
    // Del "futuro" por 10 minutos.
    expect(await verifyPayPalWebhookSignature({ ...base, now: () => NOW_MS - 600_000 })).toBe(false)
    // Dentro de la ventana por defecto (~300s) sí pasa: la ventana no rechaza todo.
    expect(await verifyPayPalWebhookSignature({ ...base, now: () => NOW_MS + 120_000 })).toBe(true)
  })

  it('toleranceSeconds a medida se respeta', async () => {
    const { impl } = certFetch()
    const base = { headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID, fetchImpl: impl }
    expect(await verifyPayPalWebhookSignature({ ...base, now: () => NOW_MS + 60_000, toleranceSeconds: 30 })).toBe(false)
    expect(await verifyPayPalWebhookSignature({ ...base, now: () => NOW_MS + 10_000, toleranceSeconds: 30 })).toBe(true)
  })

  it('timestamp que no parsea → false', async () => {
    const { impl } = certFetch()
    const ok = await verifyPayPalWebhookSignature({
      headers: headers({ 'paypal-transmission-time': 'ayer a la tarde' }),
      rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(false)
  })

  it('paypal-cert-url de un host ajeno → false y NI SIQUIERA se pide el certificado', async () => {
    const { impl, calls } = certFetch()
    const ok = await verifyPayPalWebhookSignature({
      headers: headers({ 'paypal-cert-url': 'https://evil.example.com/cert.pem' }),
      rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(false)
    // Sin esto sería, además del bypass de firma, un SSRF con URL elegida por el atacante.
    expect(calls.length).toBe(0)
  })

  it('firma hecha con otra llave privada → false', async () => {
    const { impl } = certFetch()
    const ok = await verifyPayPalWebhookSignature({
      headers: headers({ 'paypal-transmission-sig': sign({ key: otherKey }) }),
      rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(false)
  })

  it('cualquier header de firma faltante o vacío → false', async () => {
    const { impl } = certFetch()
    const names = [
      'paypal-transmission-id', 'paypal-transmission-time', 'paypal-transmission-sig',
      'paypal-cert-url', 'paypal-auth-algo',
    ]
    for (const name of names) {
      const h = headers()
      delete h[name]
      expect(await verifyPayPalWebhookSignature({
        headers: h, rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
      })).toBe(false)
    }
    expect(await verifyPayPalWebhookSignature({
      headers: headers(), rawBody: RAW_BODY, webhookId: '', now: () => NOW_MS, fetchImpl: impl,
    })).toBe(false)
  })

  it('auth-algo no soportado → false (no se "intenta igual" con un algo desconocido)', async () => {
    const { impl } = certFetch()
    for (const algo of ['SHA1withRSA', 'none', 'HS256']) {
      expect(await verifyPayPalWebhookSignature({
        headers: headers({ 'paypal-auth-algo': algo }),
        rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
      })).toBe(false)
    }
  })

  it('firma que no es base64 válido → false, sin explotar', async () => {
    const { impl } = certFetch()
    for (const sig of ['', '!!!no-base64!!!']) {
      expect(await verifyPayPalWebhookSignature({
        headers: headers({ 'paypal-transmission-sig': sig }),
        rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
      })).toBe(false)
    }
  })
})

describe('verifyPayPalWebhookSignature — problemas al traer el certificado', () => {
  const args = (fetchImpl: typeof fetch) => ({
    headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID,
    now: () => NOW_MS, fetchImpl,
  })

  it('PayPal inalcanzable → false (nunca se asume pagado)', async () => {
    const impl = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    expect(await verifyPayPalWebhookSignature(args(impl))).toBe(false)
  })

  it('el cert responde 404 → false', async () => {
    const impl = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
    expect(await verifyPayPalWebhookSignature(args(impl))).toBe(false)
  })

  it('el cert no es un PEM parseable → false', async () => {
    for (const body of ['<html>error</html>', '-----BEGIN CERTIFICATE-----\nbasura\n-----END CERTIFICATE-----']) {
      const impl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch
      expect(await verifyPayPalWebhookSignature(args(impl))).toBe(false)
    }
  })

  it('un cert que no parsea no queda cacheado: el siguiente intento vuelve a pedirlo', async () => {
    const roto = certFetch('basura')
    expect(await verifyPayPalWebhookSignature(args(roto.impl))).toBe(false)
    const bueno = certFetch()
    expect(await verifyPayPalWebhookSignature(args(bueno.impl))).toBe(true)
    expect(bueno.calls.length).toBe(1)
  })
})
