// Recorrido en producción del epic "Habitación asignada al check-in" (#255, cierre #263).
//
// Correr desde la raíz del repo:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/playwright node docs/evidencia/habitacion-asignada-al-checkin/recorrido-prod.mjs [--from=N] [--only=N]
//
// Usa el Chromium de `frontend/node_modules/playwright` (v1.61.1). Si Playwright pide una revisión
// que no está instalada (1228) se toma el headless shell 1243 de /opt/playwright vía
// CHROME_PATH. Las capturas quedan en el directorio de este archivo. El estado entre pasos (ids
// de las reservas creadas, respuestas resumidas de la API) se guarda en STATE_FILE (default:
// $TMPDIR/recorrido-263-state.json) para poder reanudar con --from=N.
//
// Credenciales: las del hotel demo público (hotel@solmios.com / demo123, documentadas en el
// runbook / CLAUDE.md). `open_channel_api_key` es el literal público del sandbox de Channex.
// No hay ningún secreto en este archivo; los PIN de TTLock nunca se imprimen ni se guardan.
//
// Pasos:
//   1. Reserva web por el widget (double, 2 noches) → nace con roomId null.
//   2. Listado (badge "Sin asignar") + planning (banda "Sin asignar").
//   3. Dos OTA simuladas del MISMO tipo y MISMAS fechas → confirmadas, sin roomId, sin colisión.
//   4. Drag de una OTA desde la banda a una fila de habitación → assign-room.
//   5. Reserva single de HOY sin habitación → Check-in pide habitación (RoomAssignModal) → 103.
//   6. Código TTLock generado al asignar (hab. 103 es la única con cerradura real).
//   7. Reasignar en estadía (103 → 208, otro tipo): el folio sigue a la reserva.
//   8. Reportes (ocupación) coherentes con reservas sin asignar.
//   9. Limpieza: check-out / cancelación de lo creado.
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://hotel.zx89.site'
const SLUG = 'hotel-boutique-palma'
const HOTEL_ID = 'bca45933-075b-4f0b-bed2-322c3cd7a216'
const DEMO_LOGIN = { email: 'hotel@solmios.com', password: 'demo123' }
const GUEST_PREFIX = 'Autowork Recorrido 263'
const GUEST = { email: 'autowork+263@bot.zx89.site', phone: '+18095550263' }
// Habitaciones del demo (GET /api/planning): 103 = única con cerradura TTLock; 208 = double libre.
const ROOM_103 = 'room-0003-0000-0000-000000000003'
const ROOM_208 = 'ea644081-739f-4fda-8c2f-60f19ec5210e'
const TTLOCK_LOCK_ID = '9a9797c8-282a-4e0b-8ad7-8421d950e75b'

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = process.env.STATE_FILE || path.join(os.tmpdir(), 'recorrido-263-state.json')
const CHROME_PATH = process.env.CHROME_PATH || '/opt/playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const FROM = Number(args.from || 1)
const ONLY = args.only ? Number(args.only) : null

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {}
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, name), fullPage: false })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Fechas en UTC (misma noción de "hoy" que el backend: new Date().toISOString().slice(0,10)).
function plusDays(n) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const TODAY = plusDays(0)
// Web: +10/+12 · OTA: +5/+7 (distintas de la web, dentro de los 14 días que muestra el planning).
const WEB_IN = plusDays(10), WEB_OUT = plusDays(12)
const OTA_IN = plusDays(5), OTA_OUT = plusDays(7)
const STAY_IN = TODAY, STAY_OUT = plusDays(1)

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
const unwrap = (b) => (b && typeof b === 'object' && 'data' in b && b.success !== false ? b.data : b)
const detail = async (id) => unwrap((await api('GET', `/api/reservations/${id}`)).body)
const listRows = async () => (await api('GET', '/api/reservas?limit=200')).body.data || []
const listRow = async (id) => (await listRows()).find((r) => r.id === id)
/**
 * Listado SIN la caché de 300 s (reservas/usecases/cache.ts): la clave incluye `limit`, así que un
 * límite distinto en cada llamada fuerza la consulta. Hace falta para ver una fila que ingresó
 * por Channex (webhook/ingest), que no bumpea la versión del listado como sí lo hace el POST del
 * panel. (`?search=` filtra por externalLocator en el código pero en prod devuelve 0 filas.)
 */
const listRowsFresh = async () => (await api('GET', `/api/reservas?limit=${150 + Math.floor(Math.random() * 50)}`)).body.data || []
/** Resumen de una reserva para las notas (sin datos de tarjeta ni PIN). */
const brief = (d) => d && ({
  id: d.id, status: d.status, source: d.source, channel: d.channel, externalLocator: d.externalLocator ?? null,
  checkIn: d.checkIn, checkOut: d.checkOut, roomType: d.roomType ?? null, roomId: d.roomId ?? null,
  roomNumber: d.room?.number ?? d.roomNumber ?? null, roomAssignedAt: d.roomAssignedAt ?? null, roomAssignedBy: d.roomAssignedBy ?? null,
  folioId: d.folioId ?? null, totalAmount: d.totalAmount, paymentState: d.paymentState ?? null, checkedInAt: d.checkedInAt ?? null,
  guest: d.guest?.name ?? d.guestName ?? null, createdAt: d.createdAt,
})
/**
 * Folios de una reserva. El listado `GET /api/folios?reservationId=` se cachea por versión
 * (folios/usecases/cache.ts) y assign-room no la bumpea: tras reasignar en estadía seguía
 * mostrando la habitación vieja. Por eso cada folio se relee con `GET /api/folios/:id`.
 */
async function foliosOf(id) {
  const listed = unwrap((await api('GET', `/api/folios?reservationId=${id}`)).body) || []
  const d = await detail(id)
  const ids = [...new Set([...(listed.map((f) => f.id)), ...(d?.folioId ? [d.folioId] : [])])]
  return Promise.all(ids.map(async (fid) => unwrap((await api('GET', `/api/folios/${fid}`)).body)))
}
const codesOf = async (id) => (unwrap((await api('GET', '/api/ttlock/codes')).body) || [])
  .filter((c) => c.reservationId === id)
  .map((c) => ({ id: c.id, status: c.status, lockId: c.lockId, reservationId: c.reservationId, codeType: c.codeType, startDate: c.startDate, endDate: c.endDate, ttlockKeyboardPwdId: c.ttlockKeyboardPwdId ? '***' : null, code: c.code ? '******' : null, createdAt: c.createdAt, updatedAt: c.updatedAt }))
/** Sondeo con TECHO: evalúa `fn` cada `everyMs` hasta que devuelva algo truthy o venza `maxMs`. */
async function waitUntil(fn, maxMs, everyMs = 3000) {
  const deadline = Date.now() + maxMs
  let last = await fn()
  for (; !last && Date.now() < deadline; last = await fn()) await sleep(everyMs)
  return last
}

/**
 * Reserva OTA simulada: Open Channel API de Channex staging + ingesta en SolmiOs. Devuelve la
 * fila del PMS (por `externalLocator` = reservation_id de la OTA). Si el open channel de staging
 * falla, cae al alta del panel (`POST /api/reservas`, source 'ota') y lo deja anotado en `via`.
 */
async function crearReservaOtaSimulada({ roomType, checkIn, checkOut, guestSurname, price = '120.00' }) {
  const ts = Date.now()
  const locator = `AW263-${ts}`
  const days = []
  for (let d = checkIn; d < checkOut; d = plusDaysFrom(d, 1)) days.push({ date: d, price, rate_plan_code: `${roomType}-bar` })
  const booking = {
    status: 'new', provider_code: 'OpenChannel', ota_name: 'OpenChannel', hotel_code: HOTEL_ID,
    reservation_id: locator, arrival_date: checkIn, departure_date: checkOut, currency: 'USD',
    customer: { name: GUEST_PREFIX, surname: guestSurname, mail: GUEST.email, phone: GUEST.phone },
    rooms: [{ room_type_code: roomType, occupancy: { adults: roomType === 'single' ? 1 : 2, children: 0, infants: 0 }, days }],
  }
  const r = await fetch('https://secure-staging.channex.io/api/v1/channel_webhooks/open_channel/new_booking', {
    method: 'POST', headers: { 'content-type': 'application/json', 'api-key': 'open_channel_api_key' }, body: JSON.stringify({ booking }),
  })
  const chText = await r.text()
  log('channex new_booking →', r.status, chText.slice(0, 200))
  let ingest = null
  if (r.ok) {
    // Channex staging suele empujar el booking por webhook antes de que corra el ingest (feedSize 0).
    ingest = await api('POST', '/api/channels/bookings/ingest', {})
    ingest.body = unwrap(ingest.body)
    log('ingest →', ingest.status, JSON.stringify(ingest.body).slice(0, 200))
  }
  let row = r.ok ? await waitUntil(async () => (await listRowsFresh()).find((x) => x.externalLocator === locator && x.channel === 'OpenChannel'), 60000, 4000) : null
  let via = 'channex-open-channel+ingest'
  if (!row) {
    // Alternativa documentada: alta del panel marcada como OTA. `channel` sólo admite el enum del
    // validador (no 'OpenChannel'), así que va `booking` + source 'ota' + externalLocator.
    via = `panel POST /api/reservas (fallback: channex ${r.status} ${chText.slice(0, 120)} / ingest ${ingest ? ingest.status + ' ' + JSON.stringify(ingest.body).slice(0, 120) : '-'})`
    const nights = days.length
    const created = await api('POST', '/api/reservas', {
      hotelId: HOTEL_ID, roomType, checkIn, checkOut, totalAmount: Number(price) * nights, currency: 'USD',
      guestName: `${GUEST_PREFIX} ${guestSurname}`, guestEmail: GUEST.email, guestPhone: GUEST.phone,
      channel: 'booking', source: 'ota', status: 'confirmed', externalLocator: locator, adults: booking.rooms[0].occupancy.adults, children: 0,
    })
    log('POST /api/reservas →', created.status, JSON.stringify(created.body).slice(0, 200))
    const c = unwrap(created.body)
    row = c?.id ? await listRow(c.id) : null
  }
  if (!row) throw new Error(`no se pudo crear la reserva OTA simulada ${locator}`)
  return { row, locator, via, channexStatus: r.status, channexBody: chText.slice(0, 200), ingest: ingest && { status: ingest.status, message: ingest.body?.message, ingested: ingest.body?.ingested, skipped: ingest.body?.skipped } }
}
function plusDaysFrom(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ─── Browser helpers ────────────────────────────────────────────────────────────────────────
async function newPage(browser) {
  // UTC: el "hoy" del planning y del widget coincide con el del backend.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES', timezoneId: 'UTC' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  page.on('dialog', (d) => { log('dialog:', d.message()); d.accept().catch(() => {}) })
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
  await page.waitForSelector('[data-testid="room-type-label"]', { timeout: 30000 })
  await sleep(800)
  await maskLockCodes(page)
}
/** Tapa los PIN de cerradura visibles (modal de la reserva y popover del planning) antes de capturar. */
async function maskLockCodes(page) {
  await page.evaluate(() => {
    const mask = (el) => { if (el && /\d{4,9}/.test(el.textContent || '')) el.textContent = (el.textContent || '').replace(/\d{4,9}/g, '******') }
    document.querySelectorAll('[data-testid="lock-code"], [data-testid="popup-lock-code"] *, [data-testid="popup-lock-code"]').forEach(mask)
    document.querySelectorAll('[data-testid="lock-code-box"] [title*="Código"], [title^="Cerradura:"]').forEach((el) => el.setAttribute('title', 'Cerradura: ******'))
  })
  await sleep(200)
}
/** Lleva la tarjeta "Elementos de la Reserva" (tipo vendido + habitación) a la vista. */
async function scrollToRoomCard(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="room-type-label"]')?.closest('.rm-card')
    if (el) el.scrollIntoView({ block: 'start' })
  })
  await sleep(400)
}
/** Listado filtrado por texto; deja la primera fila a la vista. */
async function searchList(page, text) {
  await page.goto(`${BASE}/panel/reservas`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.fill('[data-testid="reservations-search"]', text)
  await sleep(1000)
  await page.waitForSelector('[data-testid="reservation-row"]', { timeout: 20000 })
  await page.evaluate(() => document.querySelector('[data-testid="reservation-row"]')?.scrollIntoView({ block: 'center' }))
  await sleep(400)
}
/**
 * Planning en vista de 7 días (entra entero en 1280px, sin scroll horizontal), en la semana que
 * contiene `checkIn` (semanas de 7 días desde hoy); scrollea en vertical hasta la barra pedida.
 */
async function openPlanning(page, reservationId, checkIn = TODAY) {
  await page.goto(`${BASE}/panel/planning`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForSelector('[data-rid][data-date]', { timeout: 30000 })
  await page.selectOption('select:has(option:has-text("7 días"))', '7')
  const offset = Math.floor((Date.parse(`${checkIn}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86400000 / 7)
  for (let i = 0; i < offset; i++) { await page.click('button:has-text("▶")'); await sleep(300) }
  await sleep(1000)
  if (reservationId) {
    const bar = page.locator(`[data-reservation-id="${reservationId}"]`).first()
    await bar.waitFor({ timeout: 20000 })
    await bar.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
    await page.evaluate(() => { for (let el = document.querySelector('[data-rid][data-date]'); el; el = el.parentElement) if (el.scrollLeft) el.scrollLeft = 0 })
    await sleep(400)
  }
}

// ─── Pasos ──────────────────────────────────────────────────────────────────────────────────
const steps = {
  // 1. Reserva web por la UI del widget: fechas → Double 2 adultos → extras → datos → pago (se deja pendiente).
  async 1(browser) {
    const page = await newPage(browser)
    await page.goto(`${BASE}/book/${SLUG}`, { waitUntil: 'networkidle', timeout: 60000 })
    const monthOf = (iso) => Number(iso.slice(5, 7))
    const now = new Date()
    const hops = (monthOf(WEB_IN) - (now.getUTCMonth() + 1) + 12) % 12
    for (let i = 0; i < hops; i++) { await page.click('button[aria-label="Mes siguiente"]'); await sleep(1200) }
    const dayLabel = (iso) => {
      const d = new Date(`${iso}T12:00:00Z`)
      const wd = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getUTCDay()]
      const mo = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'][d.getUTCMonth()]
      return `${wd}, ${d.getUTCDate()} ${mo}`
    }
    if (monthOf(WEB_OUT) !== monthOf(WEB_IN)) throw new Error('check-out cruza de mes: ajustar plusDays')
    await page.click(`button[aria-label^="${dayLabel(WEB_IN)}"]`)
    await page.click(`button[aria-label^="${dayLabel(WEB_OUT)}"]`)
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
    await inputs.nth(0).fill(`${GUEST_PREFIX} web`)
    await inputs.nth(1).fill(GUEST.email)
    await inputs.nth(2).fill(GUEST.phone)
    await page.click('main button:has-text("Continuar al pago")')
    await page.waitForSelector('[data-testid="accept-terms"]')
    await page.check('[data-testid="accept-terms"]')
    await sleep(500)
    await shot(page, '01-reserva-web.png')
    // Si se reintenta el paso, la reserva anterior queda anotada para la limpieza.
    if (state.webReservationId) (state.extraIds ||= []).push(state.webReservationId)
    // El widget redirige a Stripe apenas recibe el 201: se intercepta la respuesta con `route`.
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
    state.dates = { today: TODAY, web: [WEB_IN, WEB_OUT], ota: [OTA_IN, OTA_OUT], stay: [STAY_IN, STAY_OUT] }
    // Pantalla de confirmación / redirección al pago: se captura lo que muestre el widget tras el POST.
    await page.waitForURL((u) => u.toString().includes('checkout.stripe.com') || /confirm|gracias|success/i.test(u.toString()), { timeout: 30000 }).catch(() => {})
    await sleep(2500)
    state.step1 = { bookingStatus: captured.status, bookingResponse: { reservationId: state.webReservationId, checkoutUrl: data.checkoutUrl ? data.checkoutUrl.slice(0, 40) + '…' : null, paymentDeadlineAt: data.paymentDeadlineAt ?? null }, landedOn: page.url().slice(0, 80) }
    await shot(page, '01b-stripe-checkout-pendiente.png')
    const d = await detail(state.webReservationId)
    state.step1.detail = brief(d)
    save()
    log('reserva web', JSON.stringify(state.step1.detail))
    if (d.roomId) throw new Error(`la reserva web nació CON habitación: ${d.roomId}`)
    if (d.roomType !== 'double') throw new Error(`roomType inesperado: ${d.roomType}`)
    await page.context().close()
  },

  // 2. Listado con badge "Sin asignar" (02a) + planning con la banda "Sin asignar" (02b).
  async 2(browser) {
    const page = await newPage(browser)
    await loginPanel(page)
    await searchList(page, GUEST_PREFIX)
    await page.waitForSelector(`[data-res-id="${state.webReservationId}"] [data-testid="unassigned-badge"]`, { timeout: 20000 })
    await shot(page, '02a-listado-sin-asignar.png')
    const row = await listRow(state.webReservationId)
    await openPlanning(page, state.webReservationId, WEB_IN)
    const lane = page.locator('[data-testid="unassigned-lane"][data-room-type="double"]').first()
    await lane.waitFor({ timeout: 20000 })
    await shot(page, '02b-planning-sin-asignar.png')
    state.step2 = { listRow: { id: row?.id, status: row?.status, roomType: row?.roomType, roomId: row?.roomId, roomAssignedAt: row?.roomAssignedAt }, planningUnassignedDoubleLanes: await page.locator('[data-testid="unassigned-lane"][data-room-type="double"]').count(), unassignedBarsVisible: await page.locator('[data-testid="unassigned-bar"]').count() }
    save()
    log(JSON.stringify(state.step2))
    await page.context().close()
  },

  // 3. Dos OTA del mismo tipo y mismas fechas → ambas confirmadas, sin roomId, sin overbooking.
  async 3(browser) {
    // Si el paso se reanuda con las OTA ya creadas (state.otaA/otaB) no se vuelven a crear.
    if (!state.otaA || !state.otaB) {
      const a = await crearReservaOtaSimulada({ roomType: 'double', checkIn: OTA_IN, checkOut: OTA_OUT, guestSurname: 'OTA-A' })
      const b = await crearReservaOtaSimulada({ roomType: 'double', checkIn: OTA_IN, checkOut: OTA_OUT, guestSurname: 'OTA-B' })
      state.otaA = a.row.id; state.otaB = b.row.id
      state.otaMeta = { a: { locator: a.locator, via: a.via, channex: a.channexStatus, ingest: a.ingest }, b: { locator: b.locator, via: b.via, channex: b.channexStatus, ingest: b.ingest } }
      save()
    }
    const da = await detail(state.otaA), db = await detail(state.otaB)
    state.step3 = { a: { ...brief(da), otaNotes: da.otaNotes, ...(state.otaMeta?.a || {}) }, b: { ...brief(db), otaNotes: db.otaNotes, ...(state.otaMeta?.b || {}) } }
    save()
    log(JSON.stringify(state.step3, null, 1))
    if (da.roomId || db.roomId) throw new Error('una OTA nació con habitación asignada')
    if (da.status !== 'confirmed' || db.status !== 'confirmed') throw new Error(`estados: ${da.status}/${db.status}`)
    const page = await newPage(browser)
    await loginPanel(page)
    await openPlanning(page, state.otaA, OTA_IN)
    await page.locator(`[data-reservation-id="${state.otaB}"]`).first().waitFor({ timeout: 20000 })
    await shot(page, '03-dos-ota-sin-asignar.png')
    // Las filas que entran por Channex no llevan `guestId` (el huésped viaja en `otaNotes`): el
    // buscador por nombre no las encuentra, se usa el filtro de estado "Sin asignar".
    await page.goto(`${BASE}/panel/reservas`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.selectOption('#reservations-filter-status', 'unassigned')
    await sleep(800)
    await page.waitForSelector(`[data-res-id="${state.otaA}"] [data-testid="unassigned-badge"]`, { timeout: 20000 })
    await page.evaluate((id) => document.querySelector(`[data-res-id="${id}"]`)?.scrollIntoView({ block: 'center' }), state.otaA)
    await sleep(400)
    await shot(page, '03b-listado-filtro-sin-asignar.png')
    await page.context().close()
  },

  // 4. Drag de la OTA-A desde la banda hasta la fila de la 208 (double libre) → POST assign-room.
  async 4(browser) {
    const page = await newPage(browser)
    await loginPanel(page)
    await openPlanning(page, state.otaA, OTA_IN)
    const bar = page.locator(`[data-testid="unassigned-bar"][data-reservation-id="${state.otaA}"]`).first()
    const cell = page.locator(`[data-rid="${ROOM_208}"][data-date="${OTA_IN}"]`).first()
    await cell.scrollIntoViewIfNeeded()
    const from = await bar.boundingBox(), to = await cell.boundingBox()
    if (!from || !to) throw new Error('no se ubicó la barra o la celda destino')
    const respP = page.waitForResponse((r) => r.url().includes('/assign-room') && r.request().method() === 'POST', { timeout: 30000 })
    // El calendario arrastra con mousedown/mousemove/mouseup (no HTML5 DnD): se mueve con pasos.
    await page.mouse.move(from.x + 20, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y + from.height / 2 + 5, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 })
    await sleep(300)
    await shot(page, '04a-planning-drag-preview.png')
    await page.mouse.up()
    const resp = await respP
    const respBody = await resp.text()
    log('POST assign-room →', resp.status(), respBody.slice(0, 200))
    await page.waitForSelector(`[data-testid="unassigned-bar"][data-reservation-id="${state.otaA}"]`, { state: 'detached', timeout: 20000 })
    await sleep(1200)
    await page.locator(`[data-reservation-id="${state.otaA}"]`).first().scrollIntoViewIfNeeded()
    await shot(page, '04-planning-drag-asignada.png')
    const d = await detail(state.otaA)
    state.step4 = { assignRoomStatus: resp.status(), after: brief(d), stillUnassignedB: brief(await detail(state.otaB)) }
    save()
    log(JSON.stringify(state.step4, null, 1))
    if (d.roomId !== ROOM_208) throw new Error(`roomId tras el drag: ${d.roomId}`)
    await page.context().close()
  },

  // 5. Reserva single de HOY sin habitación → botón Check-in del listado abre RoomAssignModal en
  //    modo check-in (05a) → 103 → "Asignar y hacer check-in" → checked_in en 103 (05b).
  async 5(browser) {
    if (!state.stayId) {
      const s = await crearReservaOtaSimulada({ roomType: 'single', checkIn: STAY_IN, checkOut: STAY_OUT, guestSurname: 'Estadia', price: '80.00' })
      state.stayId = s.row.id
      state.step5 = { created: { ...brief(await detail(s.row.id)), locator: s.locator, via: s.via, channex: s.channexStatus, ingest: s.ingest } }
      save()
      log('reserva de estadía', JSON.stringify(state.step5.created))
    }
    const page = await newPage(browser)
    await loginPanel(page)
    // Pantalla Check-in/out (llegadas de hoy desde GET /api/planning): la llegada sale "Sin
    // habitación · single" y su botón Check-in abre RoomAssignModal en modo check-in.
    await page.goto(`${BASE}/panel/reservas/checkin`, { waitUntil: 'networkidle', timeout: 60000 })
    const row = page.locator('[data-testid="arrival-row"]', { has: page.locator('[data-testid="arrival-no-room"]'), hasText: 'single' }).first()
    await row.waitFor({ timeout: 30000 })
    await row.scrollIntoViewIfNeeded()
    await row.locator('[data-testid="checkin-arrival-button"]').click()
    await page.waitForSelector('[data-testid="room-assign-list"]', { timeout: 30000 })
    await page.waitForSelector('[data-testid="room-assign-checkin-btn"]', { timeout: 10000 })
    await page.click(`[data-testid="room-assign-select-${ROOM_103}"]`)
    await sleep(500)
    await shot(page, '05a-checkin-pide-habitacion.png')
    const respP = page.waitForResponse((r) => r.url().includes('/checkin') && r.request().method() === 'POST', { timeout: 60000 })
    await page.click('[data-testid="room-assign-checkin-btn"]')
    const resp = await respP
    const respText = await resp.text()
    log('POST checkin →', resp.status(), respText.slice(0, 200))
    await page.waitForSelector('[data-testid="room-assign-list"]', { state: 'detached', timeout: 20000 }).catch(() => {})
    await sleep(1500)
    await openReservationModal(page, state.stayId)
    await scrollToRoomCard(page)
    await maskLockCodes(page)
    await shot(page, '05b-checked-in-hab-103.png')
    const d = await detail(state.stayId)
    state.step5 = { ...(state.step5 || {}), checkinStatus: resp.status(), checkinResponse: (() => { try { const j = unwrap(JSON.parse(respText)); return { folioId: j.folioId, guestId: j.guestId } } catch { return respText.slice(0, 120) } })(), after: brief(d), folios: (await foliosOf(state.stayId)).map((f) => ({ id: f.id, status: f.status, roomId: f.roomId, roomNumber: f.roomNumber ?? f.room?.number ?? null, balance: f.balance, charges: (f.charges || []).length })) }
    save()
    log(JSON.stringify(state.step5, null, 1))
    if (d.status !== 'checked_in' || d.roomId !== ROOM_103) throw new Error(`tras el check-in: ${d.status} / ${d.roomId}`)
    await page.context().close()
  },

  // 6. Código TTLock generado al asignar la 103: fila nueva en /api/ttlock/codes con el
  //    reservationId de la estadía. El PIN NO se imprime ni se guarda (se tapa en la captura).
  async 6(browser) {
    const codes = await waitUntil(async () => { const c = await codesOf(state.stayId); return c.length ? c : null }, 90000, 5000)
    state.step6 = { codes: codes || [], lockId: TTLOCK_LOCK_ID }
    save()
    log('códigos TTLock de la estadía:', JSON.stringify(state.step6.codes))
    const page = await newPage(browser)
    await loginPanel(page)
    // Bloque "Cerradura" → "Código de acceso" del modal de la reserva (estado + vigencia), PIN tapado.
    await openReservationModal(page, state.stayId)
    await page.evaluate(() => document.querySelector('[data-testid="lock-code-box"]')?.scrollIntoView({ block: 'center' }))
    await maskLockCodes(page)
    await sleep(300)
    const where = 'reservation-modal lock-code-box'
    await shot(page, '06-ttlock-codigo.png')
    state.step6.capturedFrom = where
    save()
    await page.context().close()
    if (!codes) throw new Error('no apareció ningún código TTLock para la reserva de estadía')
  },

  // 7. Reasignar en estadía: 103 (single) → 208 (double, allowTypeChange) desde el modal de la
  //    reserva; el folio abierto sigue a la reserva (roomId del folio = 208).
  async 7(browser) {
    const before = { detail: brief(await detail(state.stayId)), folios: (await foliosOf(state.stayId)).map((f) => ({ id: f.id, status: f.status, roomId: f.roomId })) }
    const page = await newPage(browser)
    await loginPanel(page)
    await openReservationModal(page, state.stayId)
    await scrollToRoomCard(page)
    await page.click('[data-testid="change-room-btn"]')
    await page.waitForSelector('[data-testid="room-assign-list"], [data-testid="room-assign-empty"]', { timeout: 30000 })
    await page.check('[data-testid="room-assign-all-types"]')
    await page.waitForSelector(`[data-testid="room-assign-btn-${ROOM_208}"]`, { timeout: 30000 })
    await sleep(500)
    await shot(page, '07a-reasignar-modal.png')
    const respP = page.waitForResponse((r) => r.url().includes('/assign-room') && r.request().method() === 'POST', { timeout: 60000 })
    await page.click(`[data-testid="room-assign-btn-${ROOM_208}"]`) // confirm() de "otro tipo" → aceptado por page.on('dialog')
    const resp = await respP
    log('POST assign-room (estadía) →', resp.status(), (await resp.text()).slice(0, 200))
    await page.waitForSelector('[data-testid="room-number"]:has-text("208")', { timeout: 30000 })
    await sleep(1000)
    await scrollToRoomCard(page)
    await maskLockCodes(page)
    await shot(page, '07-reasignada-208.png')
    const d = await detail(state.stayId)
    const folios = await foliosOf(state.stayId)
    const listedStale = (unwrap((await api('GET', `/api/folios?reservationId=${state.stayId}`)).body) || []).map((f) => ({ id: f.id, roomId: f.roomId, roomNumber: f.roomNumber ?? null }))
    state.step7 = { before, assignStatus: resp.status(), after: brief(d), folios: folios.map((f) => ({ id: f.id, status: f.status, roomId: f.roomId, roomNumber: f.roomNumber ?? f.room?.number ?? null, balance: f.balance ?? f.total ?? null, updatedAt: f.updatedAt, charges: (f.charges || []).map((c) => ({ description: c.description, amount: c.amount, total: c.total })) })), foliosListCached: listedStale, codesAfter: await codesOf(state.stayId), rooms: unwrap((await api('GET', `/api/planning?hotelId=${HOTEL_ID}`)).body)?.rooms?.filter((r) => [ROOM_103, ROOM_208].includes(r.id)).map((r) => ({ number: r.number, status: r.status })) }
    save()
    log(JSON.stringify(state.step7, null, 1))
    if (d.roomId !== ROOM_208) throw new Error(`roomId tras reasignar: ${d.roomId}`)
    await page.context().close()
  },

  // 8. Reportes: ocupación coherente con reservas sin asignar (cuentan por tipo, no rompen la vista).
  //    Re-ejecutable: si las reservas del recorrido ya no están vivas (tras la limpieza del paso 9)
  //    se crea una confirmada sin habitación sólo para la lectura y se cancela al final.
  async 8(browser) {
    const otaB = state.otaB ? await detail(state.otaB) : null
    let staged = null
    if (!(otaB && otaB.status === 'confirmed' && !otaB.roomId)) {
      const created = await api('POST', '/api/reservas', { hotelId: HOTEL_ID, roomType: 'double', checkIn: OTA_IN, checkOut: OTA_OUT, totalAmount: 240, currency: 'USD', guestName: `${GUEST_PREFIX} reports`, guestEmail: GUEST.email, guestPhone: GUEST.phone, channel: 'direct', source: 'direct', status: 'confirmed', adults: 2, children: 0 })
      staged = unwrap(created.body)?.id || null
      log('reserva temporal para reports →', created.status, staged)
    }
    const dash = (await api('GET', '/api/reports')).body
    const from = plusDays(-1), to = plusDays(14)
    const occ = unwrap((await api('GET', `/api/reports/advanced?type=ocupacion&from=${from}&to=${to}`)).body)
    const daily = (occ?.daily || []).filter((x) => [TODAY, OTA_IN, WEB_IN].includes(x.date))
    const unassignedLive = (await listRowsFresh()).filter((r) => !r.roomId && (r.status === 'confirmed' || r.status === 'pending')).map((r) => ({ id: r.id, status: r.status, roomType: r.roomType, checkIn: r.checkIn, checkOut: r.checkOut }))
    state.step8 = { stagedReservationId: staged, unassignedLive, reports: { totalReservations: dash.totalReservations, occupancyByType: dash.occupancyByType, todayCheckins: dash.todayCheckins, todayCheckouts: dash.todayCheckouts, channelBookings: dash.channelBookings }, ocupacion: { from, to, totalRooms: occ?.totalRooms, avgRealOccupancy: occ?.avgRealOccupancy, byRoomType: occ?.byRoomType, dailyMuestra: daily } }
    save()
    log(JSON.stringify(state.step8, null, 1))
    const page = await newPage(browser)
    await loginPanel(page)
    await page.goto(`${BASE}/panel/finanzas/reportes`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.click('button:has-text("Ocupación")')
    await page.waitForSelector('text=Hab. por tipo', { timeout: 30000 })
    await sleep(1500)
    await shot(page, '08-reports-ocupacion.png')
    // Gráfico de ocupación diaria del período (las noches con reservas sin asignar cuentan).
    await page.mouse.move(760, 500)
    await page.mouse.wheel(0, 1050)
    await sleep(1000)
    await shot(page, '08b-reports-ocupacion-diaria.png')
    await page.context().close()
    if (staged) {
      const c = await api('POST', `/api/reservas/${staged}/cancel`, { reason: 'Recorrido de evidencia #263 — reserva temporal del paso 8 (reports)' })
      state.step8.stagedCancelled = { status: c.status, after: brief(await detail(staged))?.status }
      save()
      log('reserva temporal cancelada →', c.status)
    }
  },

  // 9. Limpieza (sin captura): check-out de la estadía (folio con deuda reconocida) y cancelación
  //    de la web y las dos OTA. Se anota el estado final de cada una.
  async 9() {
    const out = {}
    if (state.stayId) {
      const co = await api('POST', `/api/reservas/${state.stayId}/checkout`, { settle: null, acknowledgeDebt: true })
      out.stay = { checkoutStatus: co.status, body: JSON.stringify(co.body).slice(0, 200), after: brief(await detail(state.stayId)), codes: await codesOf(state.stayId) }
    }
    for (const [k, id] of [['web', state.webReservationId], ['otaA', state.otaA], ['otaB', state.otaB], ...(state.extraIds || []).map((id, i) => [`extra${i}`, id])]) {
      if (!id) continue
      const c = await api('POST', `/api/reservas/${id}/cancel`, { reason: 'Recorrido de evidencia #263 — limpieza' })
      out[k] = { cancelStatus: c.status, body: JSON.stringify(c.body).slice(0, 200), after: brief(await detail(id)) }
    }
    out.rooms = unwrap((await api('GET', `/api/planning?hotelId=${HOTEL_ID}`)).body)?.rooms?.map((r) => ({ number: r.number, status: r.status }))
    state.step9 = out
    save()
    log(JSON.stringify(out, null, 1))
  },
}

const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined, args: ['--disable-blink-features=AutomationControlled'] })
try {
  const order = ONLY ? [ONLY] : [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => n >= FROM)
  for (const n of order) {
    log(`── paso ${n}`)
    await steps[n](browser)
  }
} finally {
  await browser.close()
}
log('estado en', STATE_FILE)
console.log('\nRESUMEN')
for (const k of ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'step8', 'step9']) {
  if (!state[k]) continue
  const s = state[k]
  const line = {
    step1: () => `web ${state.webReservationId} → status ${s.detail?.status}, roomType ${s.detail?.roomType}, roomId ${s.detail?.roomId}`,
    step2: () => `listado roomId ${s.listRow?.roomId} · planning carriles double sin asignar: ${s.planningUnassignedDoubleLanes}`,
    step3: () => `OTA A ${s.a?.id} (${s.a?.status}, roomId ${s.a?.roomId}) · OTA B ${s.b?.id} (${s.b?.status}, roomId ${s.b?.roomId}) · vía ${s.a?.via}`,
    step4: () => `drag → assign-room ${s.assignRoomStatus} · roomId ${s.after?.roomId} (${s.after?.roomNumber}) asignada ${s.after?.roomAssignedAt} por ${s.after?.roomAssignedBy}`,
    step5: () => `check-in ${s.checkinStatus} → ${s.after?.status} hab ${s.after?.roomNumber} folio ${s.after?.folioId}`,
    step6: () => `códigos TTLock: ${(s.codes || []).map((c) => `${c.status} ${c.startDate}→${c.endDate}`).join(', ') || 'ninguno'}`,
    step7: () => `reasignada → hab ${s.after?.roomNumber} · folio roomId ${s.folios?.[0]?.roomId} (${s.folios?.[0]?.status})`,
    step8: () => `reports occupancyByType ${JSON.stringify(s.reports?.occupancyByType)}`,
    step9: () => `limpieza: stay ${s.stay?.after?.status} · web ${s.web?.after?.status} · otaA ${s.otaA?.after?.status} · otaB ${s.otaB?.after?.status}`,
  }[k]
  console.log(`${k}: ${line()}`)
}
