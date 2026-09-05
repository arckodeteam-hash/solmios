// modules/payment-gateways/tests/x509-fixture.ts — Emisor mínimo de certificados X.509 para tests.
//
// `paypal-webhook.ts` sólo acepta material de clave que venga dentro de un CERTIFICADO (es lo
// único que sirve PayPal, y es lo que pasa por `isAcceptablePayPalCert`: vigencia, CN de
// paypal.com, issuer distinto del subject). Los tests, entonces, necesitan certificados de verdad
// para el par RSA que generan en el momento — y ni Node ni Bun saben EMITIR un X.509.
//
// Las dos alternativas eran peores: pegar una clave PRIVADA al repo junto al certificado, o
// depender de `openssl` en el PATH de CI. Acá se arma el DER a mano (ASN.1 mínimo: sólo lo que
// pide RFC 5280 para un cert v3 con un solo CN) y se firma con una CA de fixture generada en el
// import. Mismo criterio que wallet-pass/tests/generate-pass.test.ts: llaves on-the-fly, cero
// secretos versionados.

import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// ASN.1 / DER

function tlv(tag: number, content: Buffer): Buffer {
  if (content.length < 0x80) return Buffer.concat([Buffer.from([tag, content.length]), content])
  const len: number[] = []
  for (let n = content.length; n > 0; n = Math.floor(n / 256)) len.unshift(n % 256)
  return Buffer.concat([Buffer.from([tag, 0x80 | len.length, ...len]), content])
}

const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts))
const set = (...parts: Buffer[]) => tlv(0x31, Buffer.concat(parts))
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'))
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0x00]), b]))
const explicit = (n: number, content: Buffer) => tlv(0xa0 | n, content)
const nullValue = () => tlv(0x05, Buffer.alloc(0))

/** INTEGER positivo; el 0x00 de guarda evita que el byte alto lo vuelva negativo. */
function integer(value: number): Buffer {
  const bytes: number[] = []
  for (let n = value; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256)
  if (bytes.length === 0) bytes.push(0)
  if (bytes[0]! & 0x80) bytes.unshift(0)
  return tlv(0x02, Buffer.from(bytes))
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number)
  const bytes: number[] = [parts[0]! * 40 + parts[1]!]
  for (const part of parts.slice(2)) {
    const chunk: number[] = []
    let v = part
    do { chunk.unshift(v & 0x7f); v = v >>> 7 } while (v > 0)
    for (let i = 0; i < chunk.length - 1; i++) chunk[i]! |= 0x80
    bytes.push(...chunk)
  }
  return tlv(0x06, Buffer.from(bytes))
}

/** UTCTime hasta 2049 y GeneralizedTime desde 2050, como manda RFC 5280 §4.1.2.5. */
function time(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = date.getUTCFullYear()
  const rest = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  return year < 2050
    ? tlv(0x17, Buffer.from(`${pad(year % 100)}${rest}`, 'ascii'))
    : tlv(0x18, Buffer.from(`${year}${rest}`, 'ascii'))
}

/** Name con un solo RDN CN=…, que es lo único que mira `isAcceptablePayPalCert`. */
const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), utf8(cn))))

/** sha256WithRSAEncryption. */
const SIGNATURE_ALGORITHM = seq(oid('1.2.840.113549.1.1.11'), nullValue())

function toPem(der: Buffer): string {
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`
}

// ─────────────────────────────────────────────────────────────────────────────
// Emisión

/** CN del certificado de firma de webhooks que publica PayPal de verdad. */
export const PAYPAL_CERT_CN = 'messageverificationcerts.paypal.com'
/** CN de la CA de fixture: cualquiera menos el del sujeto, que es lo que separa un cert emitido
 *  de un autofirmado. */
export const FIXTURE_CA_CN = 'Fixture Test CA'

/** CA del fixture: firma los certs de prueba para que issuer !== subject, como el cert real. */
const ca = generateKeyPairSync('rsa', { modulusLength: 2048 })

let serial = 1

export interface CertificateOptions {
  /** La clave que va DENTRO del certificado (la que verificará la firma del webhook). */
  publicKey: KeyObject
  subjectCN?: string
  issuerCN?: string
  /** Privada que firma el cert. Pasar la del propio sujeto = autofirmado. */
  signWith?: KeyObject
  validFrom?: Date
  validTo?: Date
}

/**
 * Certificado X.509 v3 en PEM. Por defecto: CN de PayPal, emitido por la CA del fixture y vigente
 * de 2020 a 2126, o sea la forma del cert real. Los casos negativos se piden cambiando una sola
 * cosa (`validTo` en el pasado, otro `subjectCN`, `signWith` = la propia privada).
 */
export function makeCertificate(opts: CertificateOptions): string {
  const subjectCN = opts.subjectCN ?? PAYPAL_CERT_CN
  const issuerCN = opts.issuerCN ?? FIXTURE_CA_CN
  const validFrom = opts.validFrom ?? new Date('2020-01-01T00:00:00Z')
  const validTo = opts.validTo ?? new Date('2126-01-01T00:00:00Z')

  const tbs = seq(
    explicit(0, integer(2)), // version v3
    integer(serial++),
    SIGNATURE_ALGORITHM,
    name(issuerCN),
    seq(time(validFrom), time(validTo)),
    name(subjectCN),
    // El SubjectPublicKeyInfo ya es DER: se inyecta tal cual, sin re-encodear nada.
    opts.publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
  )

  const signer = createSign('RSA-SHA256')
  signer.update(tbs)
  signer.end()
  const signature = signer.sign(opts.signWith ?? ca.privateKey)

  return toPem(seq(tbs, SIGNATURE_ALGORITHM, bitString(signature)))
}
