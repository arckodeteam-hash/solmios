// e2e/helpers/mailbox.ts — Buzón real por IMAP para los E2E que verifican correo saliente.
//
// Lee el INBOX de la casilla de pruebas y espera el mensaje dirigido a una dirección única
// generada por la corrida, para poder afirmar "el correo llegó" con evidencia en vez de
// asumirlo. Credenciales y servidor salen SIEMPRE del entorno (MAILBOX_*), nunca del código.
//
//   MAILBOX_PASS=… bun run e2e/helpers/mailbox.ts --list
//   MAILBOX_PASS=… bun run e2e/helpers/mailbox.ts --find autowork+alta-<uuid>@bot.zx89.site

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const HOST = process.env.MAILBOX_IMAP_HOST || 'mail'
const PORT = Number(process.env.MAILBOX_IMAP_PORT || 143)
const USER = process.env.MAILBOX_USER || 'autowork@bot.zx89.site'
const DOMAIN = process.env.MAILBOX_DOMAIN || 'bot.zx89.site'

/** Mensaje encontrado. `received` (primera cabecera Received) es la evidencia de entrega:
 *  dice qué servidor lo aceptó y cuándo. `html`/`text` vienen ya decodificados. */
export interface MailboxMessage {
  subject: string
  to: string
  received: string
  html: string
  text: string
  raw: string
}

/** El spec lo usa para saltarse la prueba con motivo explícito: sin clave no hay buzón que leer
 *  y un test que "pasa" sin haber mirado el correo es peor que uno saltado. */
export function mailboxConfigured(): boolean {
  return !!process.env.MAILBOX_PASS
}

function requirePass(): string {
  const pass = process.env.MAILBOX_PASS
  if (!pass) {
    throw new Error(
      'Falta MAILBOX_PASS: el helper de buzón necesita la clave IMAP de ' +
        `${USER} en el entorno (nunca en el código). Usá mailboxConfigured() para saltar el test.`,
    )
  }
  return pass
}

/** Dirección única por corrida usando sub-direccionamiento (+tag): el buzón NO tiene catch-all,
 *  así que un destinatario inventado rebotaría. `autowork+alta-<uuid>@dominio` sí entra al INBOX
 *  de autowork con el To: intacto, y eso es lo que permite buscar el mensaje de ESTA corrida. */
export function uniqueRecipient(prefix = 'alta'): string {
  const localPart = USER.split('@')[0]
  return `${localPart}+${prefix}-${crypto.randomUUID()}@${DOMAIN}`
}

let client: ImapFlow | null = null

/** El servidor de pruebas escucha IMAP en claro (143, sin TLS ni STARTTLS): con `secure: true`
 *  el handshake muere antes del saludo. Conexión única reutilizada entre polls para no pagar
 *  login en cada reintento. */
async function getClient(): Promise<ImapFlow> {
  const pass = requirePass()
  if (client?.usable) return client
  client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    tls: { rejectUnauthorized: false },
    auth: { user: USER, pass },
    logger: false,
  })
  await client.connect()
  return client
}

/** Cierra la conexión IMAP. Sin esto el proceso de Playwright/bun queda colgado del socket. */
export async function closeMailbox(): Promise<void> {
  if (!client) return
  const c = client
  client = null
  try {
    await c.logout()
  } catch {
    c.close()
  }
}

/** Cantidad de mensajes en el INBOX. Chequeo de humo de credenciales + conectividad. */
export async function countInbox(): Promise<number> {
  const c = await getClient()
  const lock = await c.getMailboxLock('INBOX')
  try {
    return c.mailbox ? c.mailbox.exists : 0
  } finally {
    lock.release()
  }
}

function headerLine(lines: ReadonlyArray<{ key: string; line: string }>, key: string): string {
  const found = lines.find((h) => h.key === key)
  if (!found) return ''
  return found.line.slice(found.line.indexOf(':') + 1).trim()
}

/** Un SEARCH por cabecera hace match parcial (y el servidor puede normalizar direcciones), así
 *  que el candidato se confirma acá contra el To: ya parseado: la corrida vecina usa el mismo
 *  prefijo y sólo cambia el uuid. */
async function findMessageTo(recipient: string): Promise<MailboxMessage | null> {
  const c = await getClient()
  const lock = await c.getMailboxLock('INBOX')
  try {
    const uids = await c.search({ header: { to: recipient } }, { uid: true })
    if (!Array.isArray(uids) || uids.length === 0) return null
    // Del más nuevo al más viejo: si el destinatario se repitiera, interesa el último.
    for (const uid of [...uids].reverse()) {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) continue
      const parsed = await simpleParser(msg.source)
      const to = headerLine(parsed.headerLines, 'to')
      if (!to.toLowerCase().includes(recipient.toLowerCase())) continue
      return {
        subject: parsed.subject ?? '',
        to,
        received: headerLine(parsed.headerLines, 'received'),
        html: parsed.html === false ? '' : parsed.html,
        text: parsed.text ?? '',
        raw: msg.source.toString('utf8'),
      }
    }
    return null
  } finally {
    lock.release()
  }
}

/**
 * Espera a que llegue al INBOX un mensaje cuyo To: contenga exactamente `recipient`.
 * El correo sale de una cola (SMTP + amavis + LMTP) y tarda segundos, de ahí el reintento.
 * Si vence el plazo tira: ese error en rojo ES el resultado buscado — significa que la app
 * no mandó el correo o que el servidor lo descartó.
 */
export async function waitForMessageTo(
  recipient: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<MailboxMessage> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const pollMs = opts.pollMs ?? 2_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  do {
    try {
      const found = await findMessageTo(recipient)
      if (found) return found
      lastError = null
    } catch (err) {
      // Un corte de conexión a mitad de la espera no debe abortar: se reconecta en el próximo
      // intento. Sólo importa si al final no llegó nada.
      lastError = err
      client = null
    }
    await new Promise((r) => setTimeout(r, pollMs))
  } while (Date.now() < deadline)

  const detail = lastError instanceof Error ? ` Último error IMAP: ${lastError.message}.` : ''
  throw new Error(
    `No llegó ningún correo a ${recipient} tras esperar ${Math.round(timeoutMs / 1000)}s ` +
      `(INBOX de ${USER} en ${HOST}:${PORT}).${detail}`,
  )
}

const VERIFY_PATH = '/api/public/verify-email'

/**
 * Saca del cuerpo el enlace de verificación. El link viaja dentro de un href y con las `&`
 * escapadas como `&amp;` en la parte HTML, por eso se desescapan antes de buscar.
 */
export function extractVerificationLink(body: string): string {
  const plain = body.replace(/&amp;/g, '&')
  const absolute = plain.match(
    new RegExp(`https?://[^\\s"'<>]*${VERIFY_PATH}\\?token=[^\\s"'<>]+`, 'i'),
  )
  // El regex puede arrastrar puntuación de cierre del texto ("… verificá acá.").
  if (absolute) return absolute[0].replace(/[.,;)\]]+$/, '')

  const relative = plain.match(new RegExp(`${VERIFY_PATH}\\?token=[^\\s"'<>]+`, 'i'))
  if (relative) {
    throw new Error(
      `El enlace de verificación salió sin host (${relative[0].slice(0, 60)}…): el backend arma ` +
        'la URL con PUBLIC_URL y esa variable está vacía. Definila en el .env del backend.',
    )
  }
  throw new Error(
    `No se encontró ningún enlace ${VERIFY_PATH}?token=… en el cuerpo del correo ` +
      `(${body.length} caracteres). ¿Cambió la plantilla de verificación?`,
  )
}

// ─── Modo CLI ────────────────────────────────────────────────────────────────────────────────
// Para depurar a mano cuando una corrida falla: dice si el problema es el buzón o la app.
const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const findIdx = args.indexOf('--find')
  try {
    if (findIdx !== -1) {
      const target = args[findIdx + 1]
      if (!target) throw new Error('Uso: --find <direccion>')
      const msg = await waitForMessageTo(target)
      console.log(`asunto: ${msg.subject}`)
      console.log(`received: ${msg.received}`)
    } else {
      const n = await countInbox()
      console.log(`mailbox OK: ${n} mensaje(s) en INBOX`)
    }
    await closeMailbox()
    process.exit(0)
  } catch (err) {
    await closeMailbox()
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
