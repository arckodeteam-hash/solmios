// Recorrido en producción del epic "Reserva web — pago confirmado" (#243, cierre #250).
//
// Correr desde la raíz del repo:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/playwright node docs/evidencia/reserva-web-pago-confirmado/recorrido-prod.mjs [--from=N] [--only=N]
//
// Usa el Chromium de `frontend/node_modules/playwright` (v1.61.1). Las capturas quedan en el
// directorio de este archivo. El estado entre pasos (id de la reserva, checkoutUrl) se guarda en
// STATE_FILE (default: $TMPDIR/recorrido-250-state.json) para poder reanudar con --from=N.
//
// Credenciales: las del hotel demo público (hotel@solmios.com / demo123, documentadas en el
// runbook). Stripe está en modo TEST: las tarjetas 4000 0000 0000 0002 (rechazo) y 4242 4242
// 4242 4242 (ok) son las de prueba de Stripe. No hay ningún secreto en este archivo.
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://hotel.zx89.site'
const SLUG = 'hotel-boutique-palma'
const HOTEL_ID = 'bca45933-075b-4f0b-bed2-322c3cd7a216'
const DEMO_LOGIN = { email: 'hotel@solmios.com', password: 'demo123' }
// Reserva OTA simulada ya ingestada en prod (Open Channel de Channex staging → /api/channels/bookings/ingest).
const OTA_RESERVATION_ID = '5f4a6d57-18c4-490f-bb62-b24ac8abc881'
const GUEST = { name: 'Autowork Recorrido 250', email: 'autowork+250@bot.zx89.site', phone: '+18095550250' }
const CARD_DECLINED = '4000000000000002'
const CARD_OK = '4242424242424242'

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = process.env.STATE_FILE || path.join(os.tmpdir(), 'recorrido-250-state.json')
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const FROM = Number(args.from || 1)
const ONLY = args.only ? Number(args.only) : null

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {}
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, name), fullPage: false })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Fechas: check-in dentro de 30 días, 2 noches.
function plusDays(n) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const CHECK_IN = plusDays(30)
const CHECK_OUT = plusDays(32)

// ─── API helpers (Bearer del hotel demo) ────────────────────────────────────────────────────
let bearer = null
async function api(method, url, body) {
  if (!bearer) {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(DEMO_LOGIN) })
    bearer = await r.json() // { token, refreshToken, user }
  }
  const r = await fetch(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer.token}` }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  try { return { status: r.status, body: JSON.parse(text) } } catch { return { status: r.status, body: text } }
}
const detail = async (id) => (await api('GET', `/api/reservations/${id}`)).body
const listRow = async (id) => ((await api('GET', '/api/reservas?limit=200')).body.data || []).find((r) => r.id === id)
const notifications = async (n = 10) => (await api('GET', `/api/notificaciones?limit=${n}`)).body.data || []
const emailQueue = async (n = 10) => (await api('GET', `/api/email-queue?limit=${n}`)).body.data || []
/** Sondeo con TECHO: evalúa `fn` cada `everyMs` hasta que devuelva algo truthy o venza `maxMs`. */
async function waitUntil(fn, maxMs, everyMs = 3000) {
  const deadline = Date.now() + maxMs
  let last = await fn()
  for (; !last && Date.now() < deadline; last = await fn()) await sleep(everyMs)
  return last
}
async function pollAttempts(id, pred, maxMs) {
  const found = await waitUntil(async () => { const a = (await detail(id)).paymentAttempts || []; return a.some(pred) ? a : null }, maxMs)
  return found || (await detail(id)).paymentAttempts || []
}
/** Fila del listado con paymentState 'paid' (el listado se cachea 300 s: reservas/usecases/cache.ts). */
async function pollListPaid(id, maxMs) {
  const t0 = Date.now()
  const row = await waitUntil(async () => { const r = await listRow(id); return r?.paymentState === 'paid' ? r : null }, maxMs, 5000)
  return { row: row || (await listRow(id)), waitedMs: Date.now() - t0 }
}

// ─── Browser helpers ────────────────────────────────────────────────────────────────────────
async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  return page
}

/** Entra al panel con la sesión demo: el store de auth lee `token`/`refreshToken`/`user` de localStorage. */
async function loginPanel(page) {
  await api('GET', '/api/notificaciones?limit=1') // asegura bearer
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ token, refreshToken, user }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('refreshToken', refreshToken)
    localStorage.setItem('user', JSON.stringify(user))
  }, bearer)
}

async function openReservationModal(page, id) {
  await page.goto(`${BASE}/panel/reservas?open=${id}`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForSelector('[data-testid="payment-state-badge"]', { timeout: 30000 })
  await sleep(800)
}

/** Lleva la "Pasarela de pago" del modal a la vista (los cards van en columnas; scrollea el contenedor). */
async function scrollToAttempts(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="payment-attempts"]')
    if (el) el.scrollIntoView({ block: 'center' })
  })
  await sleep(400)
}

/** Deja la tarjeta "Importe y Pago" entera a la vista: badge de estado arriba, historial y pasarela abajo. */
async function scrollToPaymentCard(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="payment-state-badge"]')?.closest('.rm-card')
    if (el) el.scrollIntoView({ block: 'start' })
  })
  await sleep(400)
}

/** Completa el formulario de Stripe Checkout (hosted, modo test) con una tarjeta y envía. */
async function payWithCard(page, number) {
  // Si el checkout ofrece varios métodos, el de tarjeta puede estar plegado.
  const cardNumber = page.locator('#cardNumber, input[name="cardNumber"]').first()
  if (!(await cardNumber.isVisible().catch(() => false))) {
    const tab = page.locator('button:has-text("Card"), button:has-text("Tarjeta"), [data-testid="card-accordion-item-button"]').first()
    if (await tab.isVisible().catch(() => false)) await tab.click()
  }
  await cardNumber.waitFor({ state: 'visible', timeout: 30000 })
  // Stripe ofrece "Elige divisa" (adaptive pricing) según el país del navegador: se elige la
  // moneda de cobro del hotel (USD) para que el intento quede en la misma moneda que la reserva.
  const usd = page.locator('button:has-text("US$"), [role="radio"]:has-text("US$")').first()
  if (await usd.isVisible().catch(() => false) && (await usd.isEnabled().catch(() => false))) { await usd.click(); await sleep(800) }
  const email = page.locator('#email, input[name="email"]').first()
  if (await email.isVisible().catch(() => false) && !(await email.inputValue())) await email.fill(GUEST.email)
  await cardNumber.fill('')
  await cardNumber.type(number, { delay: 20 })
  await page.locator('#cardExpiry, input[name="cardExpiry"]').first().fill('12 / 34')
  await page.locator('#cardCvc, input[name="cardCvc"]').first().fill('123')
  const name = page.locator('#billingName, input[name="billingName"]').first()
  if (await name.isVisible().catch(() => false)) await name.fill(GUEST.name)
  const country = page.locator('#billingCountry, select[name="billingCountry"]').first()
  if (await country.isVisible().catch(() => false)) await country.selectOption('DO').catch(() => {})
  const zip = page.locator('#billingPostalCode, input[name="billingPostalCode"]').first()
  if (await zip.isVisible().catch(() => false)) await zip.fill('10101')
  // "Guardar mi información" (Link) — dejarlo apagado si aparece.
  const save = page.locator('#enableStripePass')
  if (await save.isVisible().catch(() => false) && (await save.isChecked().catch(() => false))) await save.uncheck().catch(() => {})
  await page.locator('button[type="submit"], .SubmitButton').first().click()
}

// ─── Pasos ──────────────────────────────────────────────────────────────────────────────────
const steps = {
  // 1. Reserva web por la UI del widget: fechas → Double 2 adultos → extras → datos → pago.
  async 1(browser) {
    const page = await newPage(browser)
    await page.goto(`${BASE}/book/${SLUG}`, { waitUntil: 'networkidle', timeout: 60000 })
    // Calendario: avanzar hasta el mes del check-in y clickear check-in y check-out por aria-label.
    const monthOf = (iso) => Number(iso.slice(5, 7))
    const now = new Date()
    let hops = (monthOf(CHECK_IN) - (now.getUTCMonth() + 1) + 12) % 12
    for (let i = 0; i < hops; i++) { await page.click('button[aria-label="Mes siguiente"]'); await sleep(1200) }
    const dayLabel = (iso) => {
      const d = new Date(`${iso}T12:00:00Z`)
      const wd = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getUTCDay()]
      const mo = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'][d.getUTCMonth()]
      return `${wd}, ${d.getUTCDate()} ${mo}`
    }
    if (monthOf(CHECK_OUT) !== monthOf(CHECK_IN)) throw new Error('check-out cruza de mes: ajustar plusDays')
    await page.click(`button[aria-label^="${dayLabel(CHECK_IN)}"]`)
    await page.click(`button[aria-label^="${dayLabel(CHECK_OUT)}"]`)
    await page.click('button:has-text("Ver disponibilidad")')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('h3:has-text("Double")')
    await page.click('button[aria-label="+ Double · Adultos"]')
    await sleep(300)
    const addBtns = page.locator('button:has-text("Agregar esta habitación")')
    const idx = await page.locator('main h3').allTextContents().then((t) => t.findIndex((x) => x.trim() === 'Double'))
    await addBtns.nth(idx).click()
    await page.waitForSelector('[data-testid="cart-line"]')
    await page.click('main button:has-text("Continuar")')
    await page.waitForSelector('h2:has-text("extras")')
    await page.click('main button:has-text("Continuar")')
    await page.waitForSelector('h2:has-text("Tus datos")')
    const inputs = page.locator('main input')
    await inputs.nth(0).fill(GUEST.name)
    await inputs.nth(1).fill(GUEST.email)
    await inputs.nth(2).fill(GUEST.phone)
    await page.click('main button:has-text("Continuar al pago")')
    await page.waitForSelector('[data-testid="accept-terms"]')
    await page.check('[data-testid="accept-terms"]')
    await sleep(500)
    await shot(page, '01-reserva-web.png')
    // Click en pagar: el widget redirige a Stripe apenas recibe el 201 y el body de la respuesta
    // se pierde con la navegación, así que se intercepta con `route` (fetch + fulfill) y se copia.
    let captured = null
    await page.route('**/api/public/booking', async (route) => {
      const res = await route.fetch()
      const text = await res.text()
      captured = { status: res.status(), body: JSON.parse(text) }
      await route.fulfill({ response: res, body: text })
    })
    await page.click('main button:has-text("Pagar")')
    await waitUntil(() => captured, 60000, 250)
    if (!captured) throw new Error('no llegó la respuesta de POST /api/public/booking')
    log('POST /api/public/booking →', captured.status, JSON.stringify(captured.body).slice(0, 300))
    const data = captured.body.data || captured.body
    state.webReservationId = data.reservationId || data.reservation?.id || data.id
    state.checkoutUrl = data.checkoutUrl
    state.checkIn = CHECK_IN; state.checkOut = CHECK_OUT
    save()
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 }).catch(() => {})
    await page.waitForSelector('#cardNumber, input[name="cardNumber"]', { timeout: 60000 }).catch(() => {})
    await sleep(1500)
    await shot(page, '01b-stripe-checkout.png')
    log('reserva web', state.webReservationId, 'checkout', state.checkoutUrl?.slice(0, 60))
    await page.context().close()
  },

  // 2. Campanita del panel con "Nueva reserva web — Autowork Recorrido 250".
  async 2(browser) {
    const page = await newPage(browser)
    await loginPanel(page)
    await page.goto(`${BASE}/panel/reservas`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.click('button[aria-label="Notificaciones"]')
    await page.waitForSelector('text=Nueva reserva web', { timeout: 20000 })
    await sleep(500)
    await shot(page, '02-campanita.png')
    const notif = (await notifications(10)).filter((n) => n.type === 'reservation')
    const mails = (await emailQueue(10)).map((m) => ({ recipient: m.recipient, subject: m.subject, status: m.status, createdAt: m.createdAt }))
    state.step2 = { notifications: notif.map((n) => ({ type: n.type, title: n.title, message: n.message, createdAt: n.createdAt })), emails: mails }
    save()
    log(JSON.stringify(state.step2, null, 1))
    await page.context().close()
  },

  // 3. Tarjeta rechazada en Stripe Checkout → fila "Rechazado" en Pasarela de pago.
  async 3(browser) {
    const stripe = await newPage(browser)
    await stripe.goto(state.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await payWithCard(stripe, CARD_DECLINED)
    await stripe.waitForSelector('text=/declined|rechazad/i', { timeout: 45000 })
    await sleep(800)
    await shot(stripe, '03a-stripe-rechazada.png')
    await stripe.context().close()
    const attempts = await pollAttempts(state.webReservationId, (a) => a.kind === 'failed', 80000)
    state.step3 = { attempts }
    save()
    log('intentos tras rechazo:', JSON.stringify(attempts))
    const page = await newPage(browser)
    await loginPanel(page)
    await openReservationModal(page, state.webReservationId)
    await scrollToAttempts(page)
    await shot(page, '03-rechazado.png')
    await page.context().close()
  },

  // 4. Pago OK con 4242 → modal "Pagada" + intento "Pagado" → listado con fila Pagada.
  async 4(browser) {
    const stripe = await newPage(browser)
    await stripe.goto(state.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await payWithCard(stripe, CARD_OK)
    await stripe.waitForURL((u) => !u.toString().includes('checkout.stripe.com'), { timeout: 90000 })
    await stripe.waitForLoadState('networkidle').catch(() => {})
    await sleep(2000)
    state.successUrl = stripe.url()
    await shot(stripe, '04a-confirmacion-huesped.png')
    await stripe.context().close()
    const attempts = await pollAttempts(state.webReservationId, (a) => a.kind === 'paid', 80000)
    const { row, waitedMs } = await pollListPaid(state.webReservationId, 60000)
    const d = await detail(state.webReservationId)
    state.step4 = { attempts, list: { waitedMs, paymentState: row?.paymentState, status: row?.status, paidAmount: row?.paidAmount, totalAmount: row?.totalAmount }, detail: { paymentState: d.paymentState, status: d.status, paidAmount: d.paidAmount, chargeableTotal: d.chargeableTotal, paymentHistory: d.paymentHistory } }
    state.step4.notifications = (await notifications(10)).filter((n) => n.type === 'reservation').map((n) => ({ title: n.title, message: n.message, createdAt: n.createdAt }))
    state.step4.emails = (await emailQueue(10)).map((m) => ({ recipient: m.recipient, subject: m.subject, status: m.status, createdAt: m.createdAt }))
    save()
    log(JSON.stringify(state.step4, null, 1))
  },

  // 5. Panel: modal "Pagada" + intento "Pagado" (04) y listado con la fila Pagada (05).
  async 5(browser) {
    const page = await newPage(browser)
    await loginPanel(page)
    await openReservationModal(page, state.webReservationId)
    await scrollToPaymentCard(page)
    await shot(page, '04-pago-confirmado.png')
    // El listado se cachea 300 s y el webhook no bumpea la versión: se espera a que la fila salga "paid".
    const { row, waitedMs } = await pollListPaid(state.webReservationId, 360000)
    state.step5 = { waitedMs, list: { paymentState: row?.paymentState, status: row?.status, paidAmount: row?.paidAmount } }
    save()
    log('listado:', JSON.stringify(state.step5))
    await page.goto(`${BASE}/panel/reservas`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.fill('[data-testid="reservations-search"]', GUEST.name)
    await sleep(800)
    await page.evaluate(() => document.querySelector('[data-testid="reservation-row"]')?.scrollIntoView({ block: 'center' }))
    await sleep(400)
    await shot(page, '05-listado-pagada.png')
    await page.context().close()
  },

  // 6. Reserva OTA simulada (ya ingestada): campanita con el aviso de OpenChannel + modal.
  async 6(browser) {
    const page = await newPage(browser)
    await loginPanel(page)
    await page.goto(`${BASE}/panel/reservas`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.click('button[aria-label="Notificaciones"]')
    const aviso = page.locator('text=Nueva reserva de OpenChannel').first()
    await aviso.waitFor({ timeout: 20000 })
    await aviso.scrollIntoViewIfNeeded()
    await sleep(500)
    await shot(page, '06-ota.png')
    await openReservationModal(page, OTA_RESERVATION_ID)
    await scrollToPaymentCard(page)
    await shot(page, '06a-ota-modal.png')
    const d = await detail(OTA_RESERVATION_ID)
    state.step6 = { id: d.id, source: d.source, channel: d.channel, status: d.status, paymentState: d.paymentState, totalAmount: d.totalAmount, currency: d.currency, checkIn: d.checkIn, checkOut: d.checkOut, otaNotes: d.otaNotes, guest: d.guest, externalLocator: d.externalLocator }
    save()
    log(JSON.stringify(state.step6, null, 1))
    await page.context().close()
  },

  // 7. Registrar pago por transferencia sobre la reserva OTA → Pagada.
  async 7(browser) {
    const page = await newPage(browser)
    await loginPanel(page)
    await openReservationModal(page, OTA_RESERVATION_ID)
    const before = await detail(OTA_RESERVATION_ID)
    await page.evaluate(() => document.querySelector('[data-testid="mark-paid-button"]')?.scrollIntoView({ block: 'center' }))
    await page.click('[data-testid="mark-paid-button"]')
    await page.waitForSelector('[data-testid="mark-paid-method-transfer"]')
    await page.click('[data-testid="mark-paid-method-transfer"]')
    await page.fill('[data-testid="mark-paid-reference"]', 'AW-250-TRANSFER')
    await sleep(300)
    await shot(page, '07a-registrar-pago-form.png')
    const respP = page.waitForResponse((r) => r.url().includes('/mark-paid') && r.request().method() === 'POST', { timeout: 30000 })
    await page.click('[data-testid="mark-paid-confirm"]')
    const resp = await respP
    log('POST mark-paid →', resp.status(), (await resp.text()).slice(0, 300))
    await page.waitForSelector('[data-testid="payment-state-badge"]:has-text("Pagada")', { timeout: 30000 })
    await page.evaluate(() => document.querySelector('[data-testid="payment-history"]')?.scrollIntoView({ block: 'center' }))
    await sleep(800)
    await shot(page, '07-registrar-pago.png')
    const after = await detail(OTA_RESERVATION_ID)
    state.step7 = { markPaidStatus: resp.status(), before: { paymentState: before.paymentState, paidAmount: before.paidAmount }, after: { paymentState: after.paymentState, paidAmount: after.paidAmount, status: after.status, paymentHistory: after.paymentHistory } }
    save()
    log(JSON.stringify(state.step7, null, 1))
    await page.context().close()
  },
}

/**
 * Receta (documental) con la que se creó la reserva OTA simulada: Open Channel API de Channex
 * staging + ingesta en SolmiOs. No se ejecuta en el recorrido (la reserva ya existe en prod).
 * `open_channel_api_key` es el literal público del sandbox de Channex, no un secreto.
 */
export async function crearReservaOtaSimulada(ts = Date.now()) {
  const day = (n) => plusDays(n)
  const booking = {
    status: 'new', provider_code: 'OpenChannel', ota_name: 'OpenChannel', hotel_code: HOTEL_ID,
    reservation_id: `AW250-${ts}`, arrival_date: day(38), departure_date: day(40), currency: 'USD',
    customer: { name: 'Autowork', surname: 'OTA Simulada', mail: GUEST.email, phone: GUEST.phone },
    rooms: [{ room_type_code: 'double', occupancy: { adults: 2, children: 0, infants: 0 },
      days: [{ date: day(38), price: '120.00', rate_plan_code: 'double-bar' }, { date: day(39), price: '120.00', rate_plan_code: 'double-bar' }] }],
  }
  const r = await fetch('https://secure-staging.channex.io/api/v1/channel_webhooks/open_channel/new_booking', {
    method: 'POST', headers: { 'content-type': 'application/json', 'api-key': 'open_channel_api_key' }, body: JSON.stringify({ booking }),
  })
  log('channex new_booking →', r.status, (await r.text()).slice(0, 200))
  const ing = await api('POST', '/api/channels/bookings/ingest', {})
  log('ingest →', ing.status, JSON.stringify(ing.body).slice(0, 200))
}

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] })
try {
  const order = ONLY ? [ONLY] : [1, 2, 3, 4, 5, 6, 7].filter((n) => n >= FROM)
  for (const n of order) {
    log(`── paso ${n}`)
    await steps[n](browser)
  }
} finally {
  await browser.close()
}
log('estado en', STATE_FILE)
