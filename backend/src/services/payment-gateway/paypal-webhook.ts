// services/payment-gateway/paypal-webhook.ts — Verificación offline de la firma RSA de los webhooks de PayPal.
//
// PayPal confirma en modo push: el único dato que dice "esta reserva se pagó" llega por POST a una
// URL nuestra. Sin verificar la firma, cualquiera que conozca (o adivine) esa URL marca folios como
// pagados. Este módulo es la puerta: el adapter no debe mirar el payload antes de que esto devuelva
// true.
//
// Se implementa la verificación OFFLINE (la misma que hace el SDK): en vez de preguntarle a
// /v1/notifications/verify-webhook-signature — que cuesta un round-trip y un token OAuth por evento,
// y que si PayPal está lento deja el webhook sin responder — se valida acá la firma RSA sobre
// `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}` con la clave pública del
// certificado que PayPal publica en `paypal-cert-url`.
//
// Regla de oro: NUNCA lanza. Cualquier duda (header faltante, cert que no baja, reloj corrido) es
// `false`, o sea "no confirmes el pago". Un falso negativo se reintenta; un falso positivo regala
// una noche de hotel.

import { createVerify, createPublicKey, X509Certificate, type KeyObject } from 'node:crypto'

/** Único algoritmo que PayPal usa hoy. Allowlist a propósito: un `paypal-auth-algo` desconocido
 *  (o débil, tipo SHA1) no se "intenta igual", se rechaza. */
const SUPPORTED_AUTH_ALGOS: Record<string, string> = {
  SHA256withRSA: 'RSA-SHA256',
}

/** Ventana de tolerancia del `paypal-transmission-time`, en segundos. Acota el replay: una firma
 *  capturada deja de servir pasados ~5 minutos aunque siga siendo criptográficamente válida. */
const DEFAULT_TOLERANCE_SECONDS = 300

/** TTL de la caché de certificados. PayPal rota el suyo muy de vez en cuando, pero cachear para
 *  siempre significa que una rotación nos deja rechazando todo hasta el próximo deploy. */
const CERT_CACHE_TTL_MS = 60 * 60 * 1000

// ─────────────────────────────────────────────────────────────────────────────
// CRC-32

/**
 * Tabla CRC-32 (polinomio reflejado 0xEDB88320) construida una sola vez y en lazy: armarla son 256
 * iteraciones que no tienen por qué correr en el arranque de un proceso que quizá nunca reciba un
 * webhook de PayPal.
 */
let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  crcTable = table
  return table
}

/**
 * CRC-32 sin signo (decimal) sobre los BYTES del body. Escrito a mano en vez de `zlib.crc32`
 * porque esa función es de Node ≥20 y no está garantizada en Bun, que es lo que corre en prod.
 * Vector de control: crc32('123456789') === 3421780262 (0xCBF43926).
 */
export function crc32(data: Buffer | string): number {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * El mensaje exacto que PayPal firmó. El body entra como CRC-32 de los bytes CRUDOS: cualquier
 * re-serialización del JSON (orden de claves, espacios, unicode escapado) cambia el CRC y tira la
 * verificación abajo. Quien llame tiene que pasar el body tal cual llegó por la red.
 */
export function buildVerificationMessage(
  transmissionId: string,
  transmissionTime: string,
  webhookId: string,
  rawBody: Buffer | string,
): string {
  return `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Allowlist de cert-url

/**
 * El `paypal-cert-url` viene DENTRO del request que estamos por autenticar: si lo seguimos a
 * ciegas, el atacante firma el evento con su propia llave, apunta el header a su servidor y la
 * firma "valida" — bypass total. Además sería un SSRF con URL controlada por el atacante.
 * Sólo https y hostname exactamente paypal.com o subdominio de .paypal.com.
 */
export function isTrustedCertUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return host === 'paypal.com' || host.endsWith('.paypal.com')
}

// ─────────────────────────────────────────────────────────────────────────────
// Caché de certificados

const certCache = new Map<string, { key: KeyObject; cachedAt: number }>()

/** Los tests (y una rotación forzada a mano) necesitan poder vaciar la caché. */
export function clearPayPalCertCache(): void {
  certCache.clear()
}

/** ¿Este nombre es un host de PayPal? Mismo criterio que `isTrustedCertUrl`. */
function isPayPalName(name: string): boolean {
  const host = name.trim().toLowerCase()
  return host === 'paypal.com' || host.endsWith('.paypal.com')
}

/** Los CN del subject más los dNSName del SAN: los nombres por los que el cert dice ser PayPal. */
function certNames(cert: X509Certificate): string[] {
  const names: string[] = []
  for (const line of (cert.subject || '').split('\n')) {
    const [attr, ...rest] = line.split('=')
    if (attr?.trim().toUpperCase() === 'CN') names.push(rest.join('=').replace(/\\,/g, ','))
  }
  for (const entry of (cert.subjectAltName || '').split(',')) {
    const value = entry.trim()
    if (value.toLowerCase().startsWith('dns:')) names.push(value.slice(4))
  }
  return names
}

/**
 * ¿El certificado que bajamos es aceptable como certificado de firma de PayPal? Es la segunda
 * defensa detrás de `isTrustedCertUrl`, que hasta acá era la ÚNICA: si mañana un subdominio de
 * paypal.com sirve contenido de terceros (un bucket, un CDN mal configurado, un open redirect ya
 * cerrado por `redirect: 'manual'`), la allowlist de host sola deja pasar cualquier PEM. Se validan
 * las dos cosas que se pueden validar sin inventar red nueva:
 *
 *   1. VIGENCIA: `validFrom`/`validTo` tienen que cubrir el momento del evento. Un cert que PayPal
 *      ya rotó (y cuya llave privada, por eso mismo, dejó de estar custodiada) no firma nada.
 *   2. NOMBRE: el subject tiene que ser un host de paypal.com, y el issuer tiene que ser OTRO —
 *      el cert real lo emite una CA pública, así que un autofirmado que se pone CN de PayPal es
 *      exactamente el ataque que esto tapa. NO se exige que el issuer diga "PayPal": pinnear eso
 *      rechazaría los certs reales (hoy DigiCert) en la próxima rotación de CA.
 *
 * No se recorre la cadena hasta la raíz: eso ya lo hizo TLS al bajar el cert de un host de PayPal.
 */
export function isAcceptablePayPalCert(cert: X509Certificate, nowMs: number): boolean {
  const from = Date.parse(cert.validFrom)
  const to = Date.parse(cert.validTo)
  if (Number.isNaN(from) || Number.isNaN(to)) return false
  if (nowMs < from || nowMs > to) return false
  if (!cert.subject || !cert.issuer || cert.issuer === cert.subject) return false
  return certNames(cert).some(isPayPalName)
}

/**
 * Acepta un PEM de CERTIFICATE (lo que sirve PayPal) o de PUBLIC KEY. Lo segundo es para poder
 * testear la verificación con un par RSA generado en el test: Node/Bun no traen forma de emitir un
 * X.509 autofirmado, así que sin esta rama los tests dependerían de openssl en el PATH. Esa rama no
 * pasa por `isAcceptablePayPalCert` porque una clave pelada no trae vigencia ni nombre; el camino
 * real de producción es siempre el CERTIFICATE.
 */
function parsePublicKey(pem: string, nowMs: number): KeyObject | null {
  try {
    if (pem.includes('BEGIN CERTIFICATE')) {
      const cert = new X509Certificate(pem)
      return isAcceptablePayPalCert(cert, nowMs) ? cert.publicKey : null
    }
    if (pem.includes('BEGIN PUBLIC KEY') || pem.includes('BEGIN RSA PUBLIC KEY')) {
      return createPublicKey({ key: pem, format: 'pem' })
    }
    return null
  } catch {
    return null
  }
}

async function loadPublicKey(certUrl: string, fetchImpl: typeof fetch, now: number): Promise<KeyObject | null> {
  const hit = certCache.get(certUrl)
  if (hit && now - hit.cachedAt < CERT_CACHE_TTL_MS) return hit.key

  let pem: string
  try {
    // `redirect: 'manual'` no es un detalle: sin esto, un 3xx servido desde un host de PayPal
    // (open redirect, CDN mal configurado) manda el fetch a un servidor del atacante y la
    // allowlist de `isTrustedCertUrl` queda burlada — se verificaría la firma contra SU llave.
    // Cualquier respuesta que no sea 2xx (incluido el 3xx que no seguimos) es fallo, no reintento.
    const res = await fetchImpl(certUrl, { redirect: 'manual' })
    if (!res.ok) return null
    pem = await res.text()
  } catch {
    // PayPal caído, DNS, timeout: no hay con qué verificar → no se confirma nada.
    return null
  }

  const key = parsePublicKey(pem, now)
  if (!key) return null
  certCache.set(certUrl, { key, cachedAt: now })
  return key
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación

export interface PayPalWebhookVerifyParams {
  /** Headers del request tal como llegaron. La búsqueda es case-insensitive. */
  headers: Record<string, string>
  /** Body CRUDO (Buffer o el string exacto); NO el objeto ya parseado y re-serializado. */
  rawBody: Buffer | string
  /** El webhookId que PayPal asignó a NUESTRA suscripción; va firmado dentro del mensaje. */
  webhookId: string
  toleranceSeconds?: number
  /** Inyectable para tests y para no depender del reloj del proceso en los cálculos de ventana. */
  now?: () => number
  /** Inyectable para tests; por defecto el fetch global. */
  fetchImpl?: typeof fetch
}

function header(headers: Record<string, string>, name: string): string {
  const direct = headers[name]
  if (typeof direct === 'string' && direct) return direct
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name && typeof v === 'string') return v
  }
  return ''
}

/**
 * ¿Este webhook lo mandó PayPal y llegó intacto? true sólo si TODO cierra. Ver el encabezado del
 * archivo: cualquier anomalía es false, nunca una excepción que el caller pueda terminar tragándose
 * con un try/catch que responda 200.
 */
export async function verifyPayPalWebhookSignature(params: PayPalWebhookVerifyParams): Promise<boolean> {
  try {
    const { headers, rawBody, webhookId } = params
    if (!headers || !webhookId) return false

    const transmissionId = header(headers, 'paypal-transmission-id')
    const transmissionTime = header(headers, 'paypal-transmission-time')
    const signatureB64 = header(headers, 'paypal-transmission-sig')
    const certUrl = header(headers, 'paypal-cert-url')
    const authAlgo = header(headers, 'paypal-auth-algo')
    if (!transmissionId || !transmissionTime || !signatureB64 || !certUrl || !authAlgo) return false

    const nodeAlgo = SUPPORTED_AUTH_ALGOS[authAlgo]
    if (!nodeAlgo) return false

    // Antes de tocar la red: si la URL no es de PayPal no se descarga NADA (ver isTrustedCertUrl).
    if (!isTrustedCertUrl(certUrl)) return false

    const nowMs = params.now ? params.now() : Date.now()
    const sentMs = Date.parse(transmissionTime)
    if (Number.isNaN(sentMs)) return false
    const tolerance = (params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS) * 1000
    // En las dos direcciones: un timestamp futuro delata un reloj corrido o un replay armado.
    if (Math.abs(nowMs - sentMs) > tolerance) return false

    const fetchImpl = params.fetchImpl ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') return false

    const publicKey = await loadPublicKey(certUrl, fetchImpl, nowMs)
    if (!publicKey) return false

    const signature = Buffer.from(signatureB64, 'base64')
    if (signature.length === 0) return false

    const message = buildVerificationMessage(transmissionId, transmissionTime, webhookId, rawBody)
    const verifier = createVerify(nodeAlgo)
    verifier.update(message, 'utf8')
    verifier.end()
    return verifier.verify(publicKey, signature)
  } catch {
    return false
  }
}
