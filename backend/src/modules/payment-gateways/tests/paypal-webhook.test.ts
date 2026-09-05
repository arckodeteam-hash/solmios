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
import { createSign, generateKeyPairSync, X509Certificate } from 'node:crypto'
import {
  crc32,
  buildVerificationMessage,
  isTrustedCertUrl,
  isAcceptablePayPalCert,
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
// Un segundo par: la llave del "atacante". Sirve para probar que una firma hecha con OTRA llave no
// pasa, y para el caso del redirect (donde el PEM del atacante se sirve desde su propio host).
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherKey = otherPair.privateKey
const otherPublicPem = otherPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()

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


// ─────────────────────────────────────────────────────────────────────────────
// Certificados X.509 de fixture. Generados una vez con openssl (EC P-256 para que entren en
// pantalla) y pegados acá a propósito: son datos, no secretos, y las fechas están fijadas para que
// el test signifique lo mismo dentro de cien años. Ni Node ni Bun saben EMITIR un X.509, así que la
// alternativa sería depender de openssl en el PATH de CI.
//
//   PAYPAL_CERT_PEM          → CN=messageverificationcerts.paypal.com, emitido por una CA, vigente
//                              2020-01-01 → 2126-01-01 (la forma del cert real de PayPal).
//   EXPIRED_PAYPAL_CERT_PEM  → el MISMO subject e issuer, pero vencido en 2016.
//   OTHER_SUBJECT_CERT_PEM   → vigente y emitido por la misma CA, pero CN=cert.evil.example.com.
//   SELF_SIGNED_PAYPAL_PEM   → CN de PayPal y vigente, pero autofirmado (issuer === subject).

const PAYPAL_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB7TCCAZQCFBWvn/+WdlKwzyZkyFQhGACvDupEMAoGCCqGSM49BAMCMFoxCzAJ
BgNVBAYTAlVTMRUwEwYDVQQKDAxEaWdpQ2VydCBJbmMxNDAyBgNVBAMMK0RpZ2lD
ZXJ0IFNIQTIgRXh0ZW5kZWQgVmFsaWRhdGlvbiBTZXJ2ZXIgQ0EwIBcNMjAwMTAx
MDAwMDAwWhgPMjEyNjAxMDEwMDAwMDBaMIGWMQswCQYDVQQGEwJVUzETMBEGA1UE
CAwKQ2FsaWZvcm5pYTERMA8GA1UEBwwIU2FuIEpvc2UxFTATBgNVBAoMDFBheVBh
bCwgSW5jLjEaMBgGA1UECwwRUGF5UGFsIFByb2R1Y3Rpb24xLDAqBgNVBAMMI21l
c3NhZ2V2ZXJpZmljYXRpb25jZXJ0cy5wYXlwYWwuY29tMFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEtuUOBhzdcUFmGgOjZ0Ydwy8uuEgnDOD0T16lbASD9r+I0/DP
In2HYHXlohVykokszdeB1RB1v4tjIC8vDn7+ajAKBggqhkjOPQQDAgNHADBEAiBx
cP+/6rYbKeHtXzbj4eIMb8rLz6Yl8ZwhEOU8QS4h8AIgafJ84NxuN5ezngvZY0R9
R7/pfcZPZC06XabkLLFniQc=
-----END CERTIFICATE-----`

const EXPIRED_PAYPAL_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB6zCCAZICFH6Zm+1/Tc6fWnYV2183JviQsjsHMAoGCCqGSM49BAMCMFoxCzAJ
BgNVBAYTAlVTMRUwEwYDVQQKDAxEaWdpQ2VydCBJbmMxNDAyBgNVBAMMK0RpZ2lD
ZXJ0IFNIQTIgRXh0ZW5kZWQgVmFsaWRhdGlvbiBTZXJ2ZXIgQ0EwHhcNMTUwMTAx
MDAwMDAwWhcNMTYwMTAxMDAwMDAwWjCBljELMAkGA1UEBhMCVVMxEzARBgNVBAgM
CkNhbGlmb3JuaWExETAPBgNVBAcMCFNhbiBKb3NlMRUwEwYDVQQKDAxQYXlQYWws
IEluYy4xGjAYBgNVBAsMEVBheVBhbCBQcm9kdWN0aW9uMSwwKgYDVQQDDCNtZXNz
YWdldmVyaWZpY2F0aW9uY2VydHMucGF5cGFsLmNvbTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABLblDgYc3XFBZhoDo2dGHcMvLrhIJwzg9E9epWwEg/a/iNPwzyJ9
h2B15aIVcpKJLM3XgdUQdb+LYyAvLw5+/mowCgYIKoZIzj0EAwIDRwAwRAIgKmI3
nNAf0KWWdh5oGDRQOVf1ve+2xSgJ727yOn623lkCIF7NOO8GsAEulMiLZcHt7ErG
RX/xZZNVuqC0vHDpjFHT
-----END CERTIFICATE-----`

const OTHER_SUBJECT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBlzCCAT0CFEkJVZZ/0HVFSocXz9OVi/YUyITjMAoGCCqGSM49BAMCMFoxCzAJ
BgNVBAYTAlVTMRUwEwYDVQQKDAxEaWdpQ2VydCBJbmMxNDAyBgNVBAMMK0RpZ2lD
ZXJ0IFNIQTIgRXh0ZW5kZWQgVmFsaWRhdGlvbiBTZXJ2ZXIgQ0EwIBcNMjAwMTAx
MDAwMDAwWhgPMjEyNjAxMDEwMDAwMDBaMEAxCzAJBgNVBAYTAlVTMREwDwYDVQQK
DAhFdmlsIEluYzEeMBwGA1UEAwwVY2VydC5ldmlsLmV4YW1wbGUuY29tMFkwEwYH
KoZIzj0CAQYIKoZIzj0DAQcDQgAEtuUOBhzdcUFmGgOjZ0Ydwy8uuEgnDOD0T16l
bASD9r+I0/DPIn2HYHXlohVykokszdeB1RB1v4tjIC8vDn7+ajAKBggqhkjOPQQD
AgNIADBFAiEAjWdc3XSYY+w/y0LxhaY4SVrcKRnA3pL5/6hVbIKwuXoCIB5CNtlT
aM5/Fv4WgoLUcbXX5ZaXrKAfqtLF1DsLkHkM
-----END CERTIFICATE-----`

const SELF_SIGNED_PAYPAL_PEM = `-----BEGIN CERTIFICATE-----
MIIB+zCCAaGgAwIBAgIUeJjkGmoqq2SiLEyq33K9obZxlfowCgYIKoZIzj0EAwIw
UjELMAkGA1UEBhMCVVMxFTATBgNVBAoMDFBheVBhbCwgSW5jLjEsMCoGA1UEAwwj
bWVzc2FnZXZlcmlmaWNhdGlvbmNlcnRzLnBheXBhbC5jb20wIBcNMjYwOTA1MjA1
NDU1WhgPMjEyNjA4MTIyMDU0NTVaMFIxCzAJBgNVBAYTAlVTMRUwEwYDVQQKDAxQ
YXlQYWwsIEluYy4xLDAqBgNVBAMMI21lc3NhZ2V2ZXJpZmljYXRpb25jZXJ0cy5w
YXlwYWwuY29tMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtuUOBhzdcUFmGgOj
Z0Ydwy8uuEgnDOD0T16lbASD9r+I0/DPIn2HYHXlohVykokszdeB1RB1v4tjIC8v
Dn7+aqNTMFEwHQYDVR0OBBYEFBjZk+bR6ZgleKoB7VIoVMfYaYH2MB8GA1UdIwQY
MBaAFBjZk+bR6ZgleKoB7VIoVMfYaYH2MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZI
zj0EAwIDSAAwRQIhALsZYmjE7Co1zDah/R4I2HXzrfbu3EiNekAJJz8ZtGsEAiAJ
ggJ5eeugZIt/aOrUdIMB63cSOCs2JXDeJ4bLVaFQOg==
-----END CERTIFICATE-----`

describe('isAcceptablePayPalCert — el cert, no sólo el host que lo sirve', () => {
  it('acepta el cert de PayPal vigente emitido por una CA', () => {
    expect(isAcceptablePayPalCert(new X509Certificate(PAYPAL_CERT_PEM), NOW_MS)).toBe(true)
  })

  it('rechaza el cert VENCIDO (misma CA, mismo subject): la llave ya rotó', () => {
    expect(isAcceptablePayPalCert(new X509Certificate(EXPIRED_PAYPAL_CERT_PEM), NOW_MS)).toBe(false)
  })

  it('rechaza el cert que todavía no empezó a valer', () => {
    const cert = new X509Certificate(PAYPAL_CERT_PEM)
    expect(isAcceptablePayPalCert(cert, Date.parse(cert.validFrom) - 1)).toBe(false)
    // Los bordes exactos de la ventana sí valen.
    expect(isAcceptablePayPalCert(cert, Date.parse(cert.validFrom))).toBe(true)
    expect(isAcceptablePayPalCert(cert, Date.parse(cert.validTo))).toBe(true)
    expect(isAcceptablePayPalCert(cert, Date.parse(cert.validTo) + 1)).toBe(false)
  })

  it('rechaza un cert vigente y bien emitido cuyo subject NO es de paypal.com', () => {
    expect(isAcceptablePayPalCert(new X509Certificate(OTHER_SUBJECT_CERT_PEM), NOW_MS)).toBe(false)
  })

  it('rechaza el autofirmado que se pone CN de PayPal (el cert real lo emite una CA)', () => {
    const cert = new X509Certificate(SELF_SIGNED_PAYPAL_PEM)
    // Se evalúa dentro de SU ventana de vigencia: lo que lo rechaza es el issuer, no la fecha.
    expect(isAcceptablePayPalCert(cert, Date.parse(cert.validFrom) + 1000)).toBe(false)
  })
})

describe('verifyPayPalWebhookSignature — el certificado descargado también se valida', () => {
  const serve = (pemBody: string) => {
    const calls: string[] = []
    const impl = (async (url: any) => {
      calls.push(String(url))
      return new Response(pemBody, { status: 200 })
    }) as unknown as typeof fetch
    return { impl, calls }
  }

  it('cert VENCIDO servido desde api.paypal.com → false y no queda cacheado', async () => {
    const vencido = serve(EXPIRED_PAYPAL_CERT_PEM)
    const args = {
      headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS,
    }
    expect(await verifyPayPalWebhookSignature({ ...args, fetchImpl: vencido.impl })).toBe(false)
    // Un cert rechazado no se cachea: si PayPal rota, el próximo evento vuelve a pedirlo.
    expect(await verifyPayPalWebhookSignature({ ...args, fetchImpl: vencido.impl })).toBe(false)
    expect(vencido.calls.length).toBe(2)
  })

  it('el cert vigente de PayPal SÍ se acepta y se cachea (la validación no rechaza todo)', async () => {
    const bueno = serve(PAYPAL_CERT_PEM)
    const args = {
      headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS,
      fetchImpl: bueno.impl,
    }
    // La firma no valida porque el fixture no es la llave con la que firmamos (no se puede pegar
    // una privada al repo), pero un solo fetch en dos eventos prueba que la clave del cert se
    // ACEPTÓ y quedó en caché: sin eso, la validación estaría rechazando incluso al cert bueno.
    await verifyPayPalWebhookSignature(args)
    await verifyPayPalWebhookSignature(args)
    expect(bueno.calls.length).toBe(1)
  })
})

describe('verifyPayPalWebhookSignature — el cert-url no se sigue por redirect', () => {
  /**
   * El ataque que tapa `redirect: 'manual'`: el header apunta a api.paypal.com (pasa la allowlist),
   * pero ese host devuelve un 302 al servidor del atacante, que sirve SU clave pública. Si el fetch
   * sigue redirecciones, la firma del impostor "valida" y el folio se marca pagado.
   */
  function redirectingFetch() {
    const calls: Array<{ url: string; redirect: unknown }> = []
    // El doble sigue el 302 por su cuenta cuando el caller no pide 'manual', que es lo que hace un
    // fetch real: así este test da TRUE (o sea, falla) si alguien saca el `redirect: 'manual'`.
    async function serve(url: string, init: any = {}): Promise<Response> {
      calls.push({ url, redirect: init?.redirect })
      if (url.includes('paypal.com')) {
        const manual = init?.redirect === 'manual' || init?.redirect === 'error'
        if (!manual) return serve(EVIL_CERT_URL, init)
        return new Response('', { status: 302, headers: { location: EVIL_CERT_URL } })
      }
      return new Response(otherPublicPem, { status: 200 })
    }
    const impl = ((url: any, init: any = {}) => serve(String(url), init)) as unknown as typeof fetch
    return { impl, calls }
  }
  const EVIL_CERT_URL = 'https://evil.example.com/cert.pem'

  it('un 302 desde paypal.com hacia otro host → false, y la redirección NO se sigue', async () => {
    const { impl, calls } = redirectingFetch()
    const ok = await verifyPayPalWebhookSignature({
      // Firmado con la llave del atacante: si se siguiera el redirect, esto daría true.
      headers: headers({ 'paypal-transmission-sig': sign({ key: otherKey }) }),
      rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
    })
    expect(ok).toBe(false)
    expect(calls.length).toBe(1)
    expect(calls[0]!.url).toBe(CERT_URL)
    expect(calls[0]!.redirect).toBe('manual')
    expect(calls.some(c => c.url === EVIL_CERT_URL)).toBe(false)
  })

  it('cualquier respuesta que no sea 2xx es fallo de verificación, sin lanzar', async () => {
    for (const status of [301, 302, 307, 308, 401, 500]) {
      clearPayPalCertCache()
      const impl = (async () => new Response('', {
        status, headers: { location: EVIL_CERT_URL },
      })) as unknown as typeof fetch
      expect(await verifyPayPalWebhookSignature({
        headers: headers(), rawBody: RAW_BODY, webhookId: WEBHOOK_ID, now: () => NOW_MS, fetchImpl: impl,
      })).toBe(false)
    }
  })
})
