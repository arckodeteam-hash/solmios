import { test, expect } from '../fixtures'
import type { APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { SLUG, roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from '../booking-children-capacity/helpers'
import {
  mailboxConfigured, uniqueRecipient, waitForMessageTo, closeMailbox, type MailboxMessage,
} from '../helpers/mailbox'
import {
  startStripeStub, markSessionPaid, signStripeEvent, buildCheckoutCompletedEvent, type StripeStub,
} from '../helpers/stripe-stub'

// Epic #265 — Motor de reservas web: el circuito COMPLETO, punta a punta y sin mocks del producto.
//
//   reservar por /book/:slug con desayuno (régimen, #268) + un extra (upsell) + bebé con cuna
//   → la reserva queda `pending` y el widget manda al huésped al checkout de la pasarela
//   → el pago entra por el webhook FIRMADO de Stripe → `confirmed` + asiento en `payments`
//   → aviso al hotel: campanita (#267) + correo al buzón del hotel
//   → recibo al huésped: correo de pago confirmado con el desglose (#270) + PDF descargable
//   → check-in: el folio nace con la noche Y los extras pagados online (#269)
//   → segunda reserva pagada, cancelada desde la página pública del huésped: `cancelled`,
//     reembolso real en la pasarela (#272), asiento `refund` en `payments` y correo de cancelación.
//
// Dobles de INFRAESTRUCTURA externa (nunca del producto):
//   - Stripe: `e2e/helpers/stripe-stub.ts` en :4242, levantado en este mismo proceso (así el spec
//     lee `stub.sessions` / `stub.refunds` como evidencia). El backend apunta su SDK real ahí
//     (STRIPE_API_HOST/PORT/PROTOCOL, subtarea 1) y verifica la firma del webhook con el MISMO
//     STRIPE_WEBHOOK_SECRET que usa este spec para firmar. Los ids del doble llevan un prefijo
//     aleatorio por proceso: dos corridas contra la misma base nunca repiten `stripeSessionId`
//     (clave de idempotencia del asiento en `payments`) ni `eventId` (dedupe en `payment_events`).
//   - Correo: buzón IMAP real (`e2e/helpers/mailbox.ts`). Sin `MAILBOX_PASS` el spec se SALTA:
//     un circuito "verde" sin haber mirado el correo sería exactamente el falso positivo que este
//     spec viene a evitar.
//
// ── Cómo correrlo (backend aislado, ver USE_CASES.md → RES-17) ─────────────────────────────
//   backend: PORT=3011 PUBLIC_URL=http://localhost:5174 PUBLIC_BASE_URL=http://localhost:5174
//            STRIPE_SECRET_KEY=sk_test_stub STRIPE_WEBHOOK_SECRET=whsec_stub
//            STRIPE_API_HOST=127.0.0.1 STRIPE_API_PORT=4242 STRIPE_API_PROTOCOL=http
//   vite:    :5174 con proxy /api → :3011
//   spec:    E2E_PORT=5174 E2E_BACKEND_URL=http://localhost:3011 MAILBOX_PASS=… \
//              bunx playwright test e2e/reservations/public-booking-circuit.spec.ts --project=chromium
//
// Efectos que persisten en la base de prueba: 2 reservas pagadas (una checked_in, una cancelada
// con reembolso) en fechas aleatorias de 2028, el huésped y sus cobros. El upsell creado se borra
// al final; el régimen, el email del hotel y la config SMTP vuelven a su valor anterior.

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'
const FRONTEND = `http://localhost:${process.env.E2E_PORT || '5173'}`
const STRIPE_STUB_PORT = Number(process.env.E2E_STRIPE_STUB_PORT || 4242)
const STRIPE_WEBHOOK_SECRET = process.env.E2E_STRIPE_WEBHOOK_SECRET || 'whsec_stub'

/** Fixture de esta corrida. El nombre del upsell lleva un sufijo único por si el cleanup no llega. */
const RUN = Date.now().toString(36)
const UPSELL = { name: `Traslado aeropuerto E2E ${RUN}`, kind: 'per_stay', price: 30 }
const BREAKFAST = { code: 'breakfast', priceMode: 'per_person_per_night', price: 12 }
const CRIB_KEY = 'custom:cuna'
const CRIB = { key: CRIB_KEY, name: 'Cuna', price: 15, isActive: true }
const CRIB_TYPE = 'double' // tarjeta "Double"
const NIGHTS = 2
const CHILD_POLICY = {
  acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1,
  childrenDiscountEnabled: false, childrenRatePercent: 50, maxFreeChildrenPerRoom: null,
}
/** Correo hasta que sale por SMTP + amavis + LMTP y entra al INBOX: segundos, a veces un minuto. */
const MAIL_TIMEOUT_MS = 150_000

// ─── helpers ─────────────────────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const state = JSON.parse(readFileSync(ADMIN_STORAGE_STATE, 'utf-8'))
  const token = state.origins?.flatMap((o: any) => o.localStorage ?? []).find((kv: any) => kv.name === 'token')?.value
  if (!token) throw new Error(`No hay token en ${ADMIN_STORAGE_STATE} — ¿corrió el globalSetup?`)
  return { Authorization: `Bearer ${token}` }
}

/** Desenvuelve `{success,data}` (y el doble envelope `{data:{data}}` de algunos controllers). */
function unwrap(body: any): any {
  const d = body?.data ?? body
  return d && typeof d === 'object' && 'data' in d && !Array.isArray(d) ? d.data : d
}

async function adminGet(request: APIRequestContext, path: string): Promise<any> {
  const res = await request.get(`${BACKEND}${path}`, { headers: authHeaders() })
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy()
  return unwrap(await res.json())
}

/** 2 noches en una ventana lejana (2028-03-01 + 0..364 días): cada corrida reserva fechas propias
 *  (la disponibilidad pública cachea 60 s y las reservas de corridas anteriores no se borran). */
function randomFutureStay(): { checkIn: string; checkOut: string } {
  const start = Date.UTC(2028, 2, 1) + Math.floor(Math.random() * 365) * 86_400_000
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { checkIn: iso(start), checkOut: iso(start + NIGHTS * 86_400_000) }
}

/** Teléfono único por corrida: `find-or-create-guest` reutiliza la ficha por teléfono E.164, y
 *  con el 809555… fijo de otros specs el correo del huésped iría a la ficha vieja. */
function uniquePhone(): string {
  return `+1809${String(Date.now()).slice(-7)}`
}

function plainText(m: MailboxMessage): string {
  const src = m.text || m.html.replace(/<[^>]+>/g, ' ')
  return src.replace(/&amp;/g, '&').replace(/\s+/g, ' ')
}

/**
 * El buzón del hotel recibe VARIOS avisos por reserva (alta, pago, cancelación) y `waitForMessageTo`
 * devuelve el más nuevo: se reintenta hasta que el más nuevo sea el que se busca.
 */
async function waitForMail(
  recipient: string,
  label: string,
  matches: (m: MailboxMessage) => boolean,
  timeoutMs = MAIL_TIMEOUT_MS,
): Promise<MailboxMessage> {
  const deadline = Date.now() + timeoutMs
  let last: MailboxMessage | null = null
  while (Date.now() < deadline) {
    try {
      last = await waitForMessageTo(recipient, { timeoutMs: Math.min(20_000, Math.max(5_000, deadline - Date.now())) })
      if (matches(last)) return last
    } catch {
      // Todavía no llegó nada: se sigue esperando hasta el plazo total.
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  throw new Error(
    `No llegó "${label}" a ${recipient} en ${Math.round(timeoutMs / 1000)}s` +
      (last ? ` (último asunto visto: "${last.subject}")` : ' (no llegó ningún correo)'),
  )
}

// ─── seed / cleanup por API admin ────────────────────────────────────────────────────────────

interface Fixture {
  hotelId: string
  upsellId: string
  hotelEmail: string
  previous: { hotelEmail: string; emailConfig: unknown; breakfast: { active: boolean; priceMode: string; price: number } | null }
}

/** Política de niños + `custom:cuna` en TODAS las habitaciones del tipo Double (mismo fixture,
 *  idempotente, que usa e2e/booking-children-capacity/06-crib-and-child-amenities.spec.ts). */
async function seedCribFixture(request: APIRequestContext): Promise<void> {
  const headers = authHeaders()
  const policy = (await adminGet(request, '/api/configuracion/child_policy'))?.valor
  if (!policy || policy.acceptChildren !== true || policy.maxChildAge !== 12 || policy.maxFreeAge !== 3 || policy.maxBabyAge !== 1) {
    const res = await request.post(`${BACKEND}/api/configuracion`, { headers, data: { clave: 'child_policy', valor: CHILD_POLICY } })
    expect(res.ok(), 'seed child_policy').toBeTruthy()
  }
  const rooms = ((await adminGet(request, '/api/habitaciones?limit=100')) ?? []) as any[]
  const isOn = (v: unknown) => v === true || v === 1 || v === '1'
  for (const room of rooms) {
    if (room.type !== CRIB_TYPE) continue
    const rows = ((await adminGet(request, `/api/amenities/room/${room.id}`)) ?? []) as any[]
    const crib = rows.find((a) => a.amenityKey === CRIB_KEY)
    if (crib && isOn(crib.isActive) && Number(crib.price) === CRIB.price && crib.name === CRIB.name) continue
    // Conserva las keys fijas (wifi, ac…) y las demás custom que ya tenga la habitación.
    const amenities = rows.filter((a) => !String(a.amenityKey).startsWith('custom:') && isOn(a.isActive)).map((a) => a.amenityKey)
    const otherCustom = rows
      .filter((a) => String(a.amenityKey).startsWith('custom:') && a.amenityKey !== CRIB_KEY)
      .map((a) => ({ key: a.amenityKey, name: a.name, price: Number(a.price) || 0, isActive: isOn(a.isActive) }))
    const res = await request.put(`${BACKEND}/api/amenities/room/${room.id}`, { headers, data: { amenities, items: [...otherCustom, CRIB] } })
    expect(res.ok(), `seed custom:cuna en room ${room.number ?? room.id}`).toBeTruthy()
  }
}

async function seedFixture(request: APIRequestContext): Promise<Fixture> {
  const headers = authHeaders()

  // Motor habilitado, en español y con confirmación instantánea: el pago confirma directo, sin
  // aprobación manual del hotel (#271 queda fuera de este circuito).
  const config = await adminGet(request, '/api/booking-engine/config')
  const hotelId = String(config?.hotelId ?? '')
  expect(hotelId, 'booking_config.hotelId').toBeTruthy()
  if (config.enabled !== true || config.language !== 'es' || config.instantConfirmation !== true) {
    const res = await request.put(`${BACKEND}/api/booking-engine/config`, { headers, data: { enabled: true, language: 'es', instantConfirmation: true } })
    expect(res.ok(), 'seed booking_config').toBeTruthy()
  }

  await seedCribFixture(request)

  // Régimen "desayuno" activo, por persona y noche (MR-03 #268).
  const plans = ((await adminGet(request, '/api/meal-plans')) ?? []) as any[]
  const prevBreakfast = plans.find((p) => p.code === BREAKFAST.code)
  const mealRes = await request.put(`${BACKEND}/api/meal-plans/${BREAKFAST.code}`, {
    headers, data: { active: true, priceMode: BREAKFAST.priceMode, price: BREAKFAST.price },
  })
  expect(mealRes.ok(), 'seed meal plan breakfast').toBeTruthy()

  // Un extra por estadía.
  const upsellRes = await request.post(`${BACKEND}/api/upsells`, {
    headers, data: { name: UPSELL.name, kind: UPSELL.kind, price: UPSELL.price, active: true, description: 'Ida y vuelta al aeropuerto' },
  })
  expect(upsellRes.status(), 'seed upsell').toBe(201)
  const upsellId = String(unwrap(await upsellRes.json())?.id ?? '')
  expect(upsellId).toBeTruthy()

  // SMTP del hotel (`configuration.email_config`, ver backend/src/services/email-service.ts):
  // sin esta fila el correo queda `pending` con "no provider configured" y no llega nunca. La
  // clave sale SIEMPRE del entorno. Se guarda lo anterior para restaurarlo al final.
  const prevEmailConfig = (await adminGet(request, '/api/configuracion/email_config'))?.valor ?? null
  const smtpRes = await request.post(`${BACKEND}/api/configuracion`, {
    headers,
    data: {
      clave: 'email_config',
      valor: {
        host: process.env.MAILBOX_SMTP_HOST || 'mx.bot.zx89.site',
        // 587 autenticado (el 25 no ofrece AUTH), sin TLS: el servidor de pruebas anuncia AUTH sin STARTTLS.
        port: Number(process.env.MAILBOX_SMTP_PORT || 587),
        secure: false,
        user: process.env.MAILBOX_USER || 'autowork@bot.zx89.site',
        pass: process.env.MAILBOX_PASS,
        from: process.env.MAILBOX_FROM || 'autowork@bot.zx89.site',
        fromName: 'SolmiOS Pruebas',
      },
    },
  })
  expect(smtpRes.ok(), 'seed email_config').toBeTruthy()

  // Buzón del hotel (`hotels.email`): a él van el aviso de reserva nueva y el de pago recibido.
  const settings = await adminGet(request, '/api/settings')
  const prevHotelEmail = String(settings?.hotel?.email ?? '')
  const hotelEmail = uniqueRecipient('hotel')
  const hotelRes = await request.put(`${BACKEND}/api/settings/hotel`, { headers, data: { email: hotelEmail } })
  expect(hotelRes.ok(), 'seed hotels.email').toBeTruthy()

  return {
    hotelId, upsellId, hotelEmail,
    previous: {
      hotelEmail: prevHotelEmail,
      emailConfig: prevEmailConfig,
      breakfast: prevBreakfast ? { active: !!prevBreakfast.active, priceMode: prevBreakfast.priceMode, price: Number(prevBreakfast.price) || 0 } : null,
    },
  }
}

/** Best-effort: cada paso independiente, un fallo no tapa a los demás. */
async function cleanupFixture(request: APIRequestContext, f: Fixture | null): Promise<void> {
  if (!f) return
  const headers = authHeaders()
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['upsell', () => request.delete(`${BACKEND}/api/upsells/${f.upsellId}`, { headers })],
    ['hotels.email', () => request.put(`${BACKEND}/api/settings/hotel`, { headers, data: { email: f.previous.hotelEmail } })],
    // La clave SMTP no se queda en la base de prueba: vuelve lo anterior (o una config vacía).
    ['email_config', () => request.post(`${BACKEND}/api/configuracion`, { headers, data: { clave: 'email_config', valor: f.previous.emailConfig ?? {} } })],
    ['meal plan', () => request.put(`${BACKEND}/api/meal-plans/${BREAKFAST.code}`, {
      headers, data: f.previous.breakfast ?? { active: false, priceMode: 'included', price: 0 },
    })],
  ]
  for (const [name, run] of steps) {
    try { await run() } catch (e) { console.log(`cleanup ${name} falló:`, (e as Error).message) }
  }
}

// ─── pago por webhook firmado ────────────────────────────────────────────────────────────────

/**
 * Simula el pago en el doble y le entrega al backend el `checkout.session.completed` firmado como
 * lo haría Stripe (HMAC sobre los bytes crudos). El backend deduplica por (hotel, proveedor, eventId)
 * en `payment_events`: el id del evento sale del doble, único por proceso.
 */
async function payByWebhook(request: APIRequestContext, stub: StripeStub, sessionId: string, hotelId: string): Promise<void> {
  const session = markSessionPaid(stub, sessionId)
  const event = buildCheckoutCompletedEvent(session)
  const { payload, signature } = signStripeEvent(STRIPE_WEBHOOK_SECRET, event)
  const res = await request.post(`${BACKEND}/api/public/webhook/stripe/${hotelId}`, {
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    data: payload,
  })
  expect(res.status(), `webhook: ${await res.text()}`).toBe(200)
  const body = unwrap(await res.json())
  expect(body?.type, 'el webhook debió confirmar la reserva (no already_processed)').toBe('reservation_confirmed')
}

async function expectReservationStatus(request: APIRequestContext, reservationId: string, status: string): Promise<any> {
  let row: any = null
  await expect.poll(async () => {
    row = await adminGet(request, `/api/reservas/${reservationId}`)
    return row?.status
  }, { timeout: 15_000, message: `reserva ${reservationId} → ${status}` }).toBe(status)
  return row
}

// ─── el spec ─────────────────────────────────────────────────────────────────────────────────

test.describe('Epic #265 — circuito completo del motor de reservas web', () => {
  test.skip(
    !mailboxConfigured(),
    'MAILBOX_PASS no está definida: sin buzón no se puede comprobar que el hotel y el huésped reciben sus correos',
  )
  let stub: StripeStub
  let fixture: Fixture | null = null
  let errors: string[] = []

  test.beforeAll(async ({ request }) => {
    stub = await startStripeStub({ port: STRIPE_STUB_PORT })
    // El backend pega a este mismo puerto (STRIPE_API_HOST/PORT): si no responde, nada de lo que
    // sigue tiene sentido.
    const alive = await request.get(`${stub.baseUrl}/v1/account`, { headers: { authorization: 'Bearer sk_test_stub' }, timeout: 5_000 })
    expect(alive.status(), 'el doble de Stripe no responde en :' + STRIPE_STUB_PORT).toBe(200)
    fixture = await seedFixture(request)
  })

  // Siempre: restaurar la config del hotel, soltar el :4242 y cerrar el IMAP aunque el test falle.
  test.afterAll(async ({ request }) => {
    await cleanupFixture(request, fixture)
    stub?.stop()
    await closeMailbox()
  })

  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('reservar con desayuno + extra + cuna → pagar → aviso al hotel → recibo → check-in con extras en folio → cancelar con reembolso', async ({ page, request }) => {
    // 3 correos reales (segundos cada uno) + 2 reservas + webhook + check-in + cancelación con reembolso.
    test.setTimeout(480_000)
    const f = fixture!
    const stay = randomFutureStay()
    const guestName = `E2E Circuito ${RUN}`
    const guestEmail = uniqueRecipient('circuito')
    let reservationId = ''
    let accessToken = ''
    let sessionId = ''
    let totalAmount = 0
    let breakdown: any = null

    await test.step('1. /book/:slug — Double con bebé + cuna + desayuno, extra en el carrito, datos del huésped', async () => {
      await gotoWizardWithDates(page, stay)
      const card = roomCard(page, 'Double')
      await expect(card).toBeVisible({ timeout: 15_000 })

      // 1 adulto + 1 niño de 0 años (bebé) → aparece "¿Necesita cuna?" (la Double publica custom:cuna).
      await card.getByRole('button', { name: '+ Double · Niños' }).click()
      await expect(card.getByTestId('baby-badge')).toHaveCount(1)
      await card.getByTestId('crib-yes').click()
      await expect(card.getByTestId('crib-yes')).toHaveClass(/bg-cyan/)

      // Régimen: el desayuno activo del hotel, cotizado para la composición (1 persona × 2 noches).
      const breakfast = card.getByTestId('meal-plan-option').filter({ hasText: 'Desayuno incluido' })
      await expect(breakfast).toHaveCount(1)
      await breakfast.click()
      await expect(breakfast).toHaveClass(/bg-navy/)
      await expect(breakfast.getByTestId('meal-plan-price')).toContainText(/24[.,]00/)

      await card.getByRole('button', { name: 'Agregar esta habitación' }).click()
      const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
      await expect(cartLine).toContainText('niño')
      await expect(cartLine).toContainText('Cuna')

      // Extras: el upsell sembrado, tildado.
      await page.getByRole('button', { name: 'Continuar' }).click()
      await expect(page.getByText('Sumá extras a tu estadía')).toBeVisible()
      const upsell = page.getByRole('checkbox', { name: UPSELL.name })
      await expect(upsell).toBeVisible()
      await upsell.check()
      await expect(upsell).toBeChecked()
      await page.getByRole('button', { name: 'Continuar' }).click()

      await expect(page.getByLabel('Nombre completo *')).toBeVisible()
      await page.getByLabel('Nombre completo *').fill(guestName)
      await page.getByLabel('Email *').fill(guestEmail)
      await page.getByLabel('Teléfono *').fill(uniquePhone())
      await page.getByRole('button', { name: 'Continuar al pago' }).click()

      // Resumen de pago: la cuna y el extra están a la vista antes de cobrar.
      await expect(page.getByText(guestName)).toBeVisible()
      await expect(page.getByTestId('room-amenity-line').filter({ hasText: 'Cuna' })).toContainText(/15[.,]00/)
      await expect(page.getByText(UPSELL.name).first()).toBeVisible()
    })

    await test.step('2. "Reservar y pagar" → reserva pending + redirección al checkout de la pasarela', async () => {
      await page.getByTestId('accept-terms').check()
      const createResponse = page.waitForResponse((r) => r.url().includes('/api/public/booking') && r.request().method() === 'POST')
      await page.getByRole('button', { name: /Reservar y pagar/ }).click()
      // Sólo el status: apenas llega el 201 el widget se va al checkout y el body deja de estar
      // disponible (Network.getResponseBody). El id sale de la session del doble y el resto, de la API.
      expect((await createResponse).status()).toBe(201)

      // El widget manda al huésped a la página hospedada de la pasarela (acá, la del doble).
      await expect(page.getByTestId('stripe-stub-checkout')).toBeVisible({ timeout: 15_000 })
      sessionId = (await page.getByTestId('stripe-stub-session-id').innerText()).trim()
      const session = stub.sessions.get(sessionId)
      expect(session, `la session ${sessionId} debe existir en el doble`).toBeTruthy()
      expect(session!.payment_status).toBe('unpaid')
      reservationId = String(session!.client_reference_id ?? '')
      expect(reservationId, 'la session debe referenciar la reserva (client_reference_id)').toBeTruthy()

      const pending = await expectReservationStatus(request, reservationId, 'pending')
      accessToken = String(pending.accessToken ?? '')
      totalAmount = Number(pending.totalAmount)
      breakdown = typeof pending.priceBreakdown === 'string' ? JSON.parse(pending.priceBreakdown) : pending.priceBreakdown
      expect(accessToken).toBeTruthy()
      expect(session!.amount_total).toBe(Math.round(totalAmount * 100))
      // Desglose cobrado por el server: desayuno 12 × 1 persona × 2 noches, extra 30, cuna 15.
      // `mealPlan` viaja desde el carrito (useBooking.ts) por `BookingService.createBooking`: si acá
      // llega `room_only`, el widget mostró el desayuno pero no lo mandó al POST /api/public/booking.
      expect(pending.mealPlan, 'el régimen elegido en el widget debe llegar a la reserva').toBe(BREAKFAST.code)
      expect(Number(pending.mealPlanTotal)).toBe(BREAKFAST.price * NIGHTS)
      expect(breakdown.mealPlanTotal).toBe(BREAKFAST.price * NIGHTS)
      expect(breakdown.upsellsTotal).toBe(UPSELL.price)
      expect(breakdown.roomAmenitiesTotal).toBe(CRIB.price)
      expect([true, 1, '1']).toContain(pending.needsCrib)
    })

    await test.step('3. Pago por webhook firmado → confirmed + cobro asentado en payments', async () => {
      await payByWebhook(request, stub, sessionId, f.hotelId)
      const confirmed = await expectReservationStatus(request, reservationId, 'confirmed')
      expect(confirmed.paymentMethod).toBe('card')
      expect(Number(confirmed.deposit)).toBe(totalAmount)
      expect(Number(confirmed.pendingAmount)).toBe(0)

      await expect.poll(async () => {
        const detail = await adminGet(request, `/api/reservations/${reservationId}`)
        return (detail?.paymentHistory ?? []).map((p: any) => `${p.type}:${p.status}:${Number(p.amount)}`)
      }, { timeout: 15_000, message: 'el cobro debe quedar en payments' }).toContain(`charge:completed:${totalAmount}`)
    })

    await test.step('4. Aviso al hotel: campanita + correo al buzón del hotel', async () => {
      const adminPage = await page.context().browser()!.newPage({ storageState: ADMIN_STORAGE_STATE })
      try {
        await adminPage.goto('/panel/reservas')
        await expect(adminPage.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15_000 })
        await adminPage.getByRole('button', { name: 'Notificaciones' }).first().click()
        await expect(adminPage.getByRole('button', { name: `Nueva reserva web — ${guestName}` }).first()).toBeVisible({ timeout: 10_000 })
        await expect(adminPage.getByRole('button', { name: `Pago recibido — ${guestName}` }).first()).toBeVisible()
      } finally {
        await adminPage.close()
      }

      const mail = await waitForMail(f.hotelEmail, 'Pago recibido', (m) => /Pago recibido/i.test(m.subject) && m.subject.includes(guestName))
      const text = plainText(mail)
      expect(text).toContain(guestName)
      expect(text).toContain('Pagado')
      expect(text).toContain(totalAmount.toFixed(2))
    })

    let manageUrl = ''
    await test.step('5. Recibo al huésped: correo de pago confirmado con desayuno, extra y cuna + PDF', async () => {
      const mail = await waitForMail(guestEmail, 'confirmación de pago', (m) => /confirmada/i.test(m.subject))
      expect(mail.subject).toContain(reservationId.slice(0, 8))
      const text = plainText(mail)
      expect(text).toMatch(/Régimen:?\s*Desayuno/)
      expect(text).toContain(`× ${NIGHTS} noches = ${(BREAKFAST.price * NIGHTS).toFixed(2)}`)
      expect(text).toContain(`${UPSELL.name} × 1 = ${UPSELL.price.toFixed(2)}`)
      expect(text).toContain(`Cuna × 1 = ${CRIB.price.toFixed(2)}`)
      expect(text).toContain(`Pagado ${totalAmount.toFixed(2)}`)

      // Los dos enlaces del huésped: gestionar la reserva y descargar el recibo PDF.
      const html = mail.html.replace(/&amp;/g, '&')
      const manage = html.match(new RegExp(`https?://[^"'\\s<>]*/h/${SLUG}/confirm\\?booking=${reservationId}&token=[^"'\\s<>]+`))
      expect(manage, 'el correo debe traer el enlace "Ver mi reserva"').toBeTruthy()
      manageUrl = manage![0]
      const receipt = html.match(new RegExp(`https?://[^"'\\s<>]*/api/public/reservations/${reservationId}/receipt\\.pdf\\?token=[^"'\\s<>]+`))
      expect(receipt, 'el correo debe traer el enlace al recibo PDF').toBeTruthy()
      const pdf = await request.get(receipt![0].replace(FRONTEND, BACKEND), { timeout: 60_000 })
      expect(pdf.status()).toBe(200)
      expect(pdf.headers()['content-type']).toContain('application/pdf')
      expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
    })

    await test.step('6. Check-in → el folio incluye la noche y los extras pagados (desayuno, extra, cuna)', async () => {
      const res = await request.post(`${BACKEND}/api/reservas/${reservationId}/checkin`, { headers: authHeaders(), data: {} })
      expect(res.status(), await res.text()).toBe(200)
      const checkin = unwrap(await res.json())
      const folioId = String(checkin.folioId ?? '')
      expect(folioId, 'el check-in debió abrir un folio').toBeTruthy()
      expect(Number(checkin.extrasCharge)).toBe(BREAKFAST.price * NIGHTS + UPSELL.price + CRIB.price)
      await expectReservationStatus(request, reservationId, 'checked_in')

      const folio = await adminGet(request, `/api/folios/${folioId}`)
      expect(folio.status).toBe('open')
      expect(folio.reservationId).toBe(reservationId)
      const charges = (folio.charges ?? []) as any[]
      const extra = (pattern: RegExp) => charges.find((c) => c.category === 'extra' && pattern.test(String(c.description)))
      const breakfastLine = extra(/^Régimen: Desayuno/)
      const upsellLine = extra(new RegExp(`^${UPSELL.name}`))
      const cribLine = extra(/^Cuna/)
      expect(breakfastLine, `falta el desayuno en el folio: ${JSON.stringify(charges.map((c) => c.description))}`).toBeTruthy()
      expect(upsellLine, 'falta el extra en el folio').toBeTruthy()
      expect(cribLine, 'falta la cuna en el folio').toBeTruthy()
      expect(Number(breakfastLine.amount)).toBe(BREAKFAST.price * NIGHTS)
      expect(Number(upsellLine.amount)).toBe(UPSELL.price)
      expect(Number(cribLine.amount)).toBe(CRIB.price)
      expect(charges.some((c) => c.category === 'room' && c.kind === 'charge')).toBe(true)
      // El prepago del motor cubre la noche + los extras: el folio nace saldado.
      expect(charges.some((c) => c.category === 'payment' && c.source === 'prepaid')).toBe(true)
      expect(Number(folio.balance)).toBe(0)
    })

    // La primera reserva ya está checked_in y la cancelación pública sobre ella devuelve 409
    // (public-cancel.ts): la cancelación con reembolso se prueba con una SEGUNDA reserva pagada.
    let secondId = ''
    let secondToken = ''
    let secondSession = ''
    let secondTotal = 0
    const secondEmail = uniqueRecipient('cancela')
    await test.step('7a. Segunda reserva pagada (misma forma, por API) con desayuno + extra', async () => {
      const stay2 = randomFutureStay()
      const res = await request.post(`${BACKEND}/api/public/booking`, {
        headers: { Origin: FRONTEND },
        data: {
          hotelId: f.hotelId, roomType: CRIB_TYPE,
          guestName: `E2E Cancela ${RUN}`, guestEmail: secondEmail, guestPhone: uniquePhone(),
          checkIn: stay2.checkIn, checkOut: stay2.checkOut, adults: 2,
          mealPlan: BREAKFAST.code,
          upsells: [{ id: f.upsellId, quantity: 1 }],
          successUrl: `${FRONTEND}/h/${SLUG}/confirm?booking=:id&token=:token`,
          cancelUrl: `${FRONTEND}/book/${SLUG}`,
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const created = unwrap(await res.json())
      secondId = String(created.reservation.id)
      secondToken = String(created.reservation.accessToken)
      secondTotal = Number(created.reservation.totalAmount)
      expect(created.totalBreakdown.mealPlanTotal).toBe(BREAKFAST.price * 2 * NIGHTS)
      expect(created.totalBreakdown.upsellsTotal).toBe(UPSELL.price)
      secondSession = String(created.checkoutUrl).split('/').pop() ?? ''
      expect(stub.sessions.has(secondSession)).toBe(true)

      await payByWebhook(request, stub, secondSession, f.hotelId)
      await expectReservationStatus(request, secondId, 'confirmed')
    })

    await test.step('7b. El huésped cancela desde el enlace del correo → reembolso en la pasarela + correo de cancelación', async () => {
      const mail = await waitForMail(secondEmail, 'confirmación de pago (2ª reserva)', (m) => /confirmada/i.test(m.subject))
      const link = mail.html.replace(/&amp;/g, '&').match(new RegExp(`https?://[^"'\\s<>]*/h/${SLUG}/confirm\\?booking=${secondId}&token=[^"'\\s<>]+`))
      expect(link, 'el correo debe traer el enlace "Ver mi reserva"').toBeTruthy()
      expect(link![0]).toContain(`token=${secondToken}`)

      await page.goto(link![0])
      await expect(page.getByTestId('confirm-success')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('confirm-payment-state')).toContainText('Pago recibido')
      await page.getByTestId('confirm-cancel-link').click()
      await page.getByTestId('confirm-cancel-yes').click()
      await expect(page.getByTestId('confirm-cancelled')).toBeVisible({ timeout: 15_000 })
      // Política flexible del hotel demo: 100 % reembolsado, y el doble ya lo aceptó.
      await expect(page.getByTestId('confirm-refund-state')).toContainText(/Reembolso de .* procesado/)

      const cancelled = await expectReservationStatus(request, secondId, 'cancelled')
      expect(cancelled.refundStatus).toBe('done')
      expect(Number(cancelled.refundAmount)).toBe(secondTotal)

      // El reembolso salió DE VERDAD hacia la pasarela: sobre el PaymentIntent de esa session.
      const session = stub.sessions.get(secondSession)!
      const refund = stub.refunds.find((r) => r.payment_intent === session.payment_intent)
      expect(refund, `refunds recibidos por el doble: ${JSON.stringify(stub.refunds)}`).toBeTruthy()
      expect(refund!.amount).toBe(Math.round(secondTotal * 100))
      expect(stub.requests.some((r) => r.method === 'POST' && r.path === '/v1/refunds')).toBe(true)

      // …y quedó asentado en payments como fila `refund` sobre el cobro original.
      const detail = await adminGet(request, `/api/reservations/${secondId}`)
      const history = (detail?.paymentHistory ?? []) as any[]
      expect(history.some((p) => p.type === 'refund' && p.status === 'completed' && Math.abs(Number(p.amount)) === secondTotal)).toBe(true)
      expect(history.some((p) => p.type === 'charge' && p.status === 'refunded')).toBe(true)

      const cancelMail = await waitForMail(secondEmail, 'cancelación', (m) => /cancelada/i.test(m.subject))
      expect(plainText(cancelMail)).toContain(`Reembolso de ${secondTotal.toFixed(2)}`)
    })

    // Lo que dejó la corrida, para quien lea el reporte.
    console.log(`#265 circuito OK — reserva 1 ${reservationId} (checked_in, folio con extras), reserva 2 ${secondId} (cancelada, reembolso ${secondTotal}); huésped ${guestEmail}, hotel ${f.hotelEmail}`)
    expect(manageUrl).toContain(reservationId)
  })
})
