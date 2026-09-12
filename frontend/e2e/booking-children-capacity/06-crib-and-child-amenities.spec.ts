import { test, expect } from '../fixtures'
import type { APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// Tarea 22 (Agregar solicitud de cuna, 2026-09-08), simplificada 2026-09-09 a Sí/No sin cantidad,
// y REESCRITA en #292 (cuna POR HABITACIÓN, sin configuración global):
//   - Ya no existe `childPolicy.cribAvailable` ni el catálogo global `child_amenities`. La cuna de
//     una habitación ES su amenidad personalizada `RoomAmenities` con `amenityKey='custom:cuna'`
//     (name, price, isActive) — la misma que el admin de habitaciones sugiere.
//   - "¿Necesita cuna?" aparece en la tarjeta de un TIPO sólo si la composición tiene ≥1 bebé Y
//     el tipo publica `custom:cuna` (`GET /api/public/hotels/:slug/room-amenities`). Con precio
//     > 0 la pregunta lo muestra: "¿Necesita cuna? (+ 15,00 US$)".
//   - "Sí" agrega `custom:cuna` a las amenidades de la línea: su precio entra al total estimado
//     y, al reservar, el backend cobra el precio REAL de la habitación asignada y persiste
//     `needsCrib=true` + la línea en `roomAmenities`/`roomAmenitiesTotal`.
//   - La cuna NO se lista en el checklist genérico "Amenidades de la habitación".
//
// Fixture (sembrado por la API admin en `beforeAll`, idempotente — nunca en una migración ni en
// prod): child_policy del hotel demo con maxChildAge=12/maxFreeAge=3/maxBabyAge=1 (0-1 años =
// bebé, lo que asume toda esta carpeta) y `custom:cuna` ('Cuna', 15, activa) en TODAS las
// habitaciones del tipo Double (así la ofrece cualquiera que se asigne) y en NINGUNA del tipo
// Triple, que queda como el tipo "sin cuna".

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'
const CRIB_KEY = 'custom:cuna'
const CRIB = { key: CRIB_KEY, name: 'Cuna', price: 15, isActive: true }
const CRIB_TYPE = 'double' // tarjeta "Double"
const NO_CRIB_TYPE = 'triple' // tarjeta "Triple"
const CHILD_POLICY = {
  acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1,
  childrenDiscountEnabled: false, childrenRatePercent: 50, maxFreeChildrenPerRoom: null,
}

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

/** Siembra la política de niños que asume la carpeta y la cuna por habitación: `custom:cuna` en
 *  todas las rooms de `CRIB_TYPE`, ninguna (activa) en las de `NO_CRIB_TYPE`. Idempotente: sólo
 *  escribe si falta, así N workers de Playwright (fullyParallel) no se pisan. Conserva las keys
 *  fijas (wifi, ac…) y las demás custom que ya tenga cada room. */
async function seedCribFixture(request: APIRequestContext) {
  const headers = authHeaders()

  const policy = unwrap(await (await request.get(`${BACKEND}/api/configuracion/child_policy`, { headers })).json())?.valor
  if (!policy || policy.acceptChildren !== true || policy.maxChildAge !== 12 || policy.maxFreeAge !== 3 || policy.maxBabyAge !== 1) {
    const res = await request.post(`${BACKEND}/api/configuracion`, { headers, data: { clave: 'child_policy', valor: CHILD_POLICY } })
    expect(res.ok(), 'seed child_policy').toBeTruthy()
  }

  // Idioma default del widget en ES (`booking_config.language`): los textos que buscan estos
  // specs son en español y el widget arranca en `navigator.language` (en-US en Playwright) si el
  // hotel no publica un default. El GET ya crea la fila con 'es' si no existía.
  const bookingConfig = unwrap(await (await request.get(`${BACKEND}/api/booking-engine/config`, { headers })).json())
  if (bookingConfig?.language !== 'es') {
    const res = await request.put(`${BACKEND}/api/booking-engine/config`, { headers, data: { language: 'es' } })
    expect(res.ok(), 'seed booking_config.language=es').toBeTruthy()
  }

  const rooms = (unwrap(await (await request.get(`${BACKEND}/api/habitaciones?limit=100`, { headers })).json()) ?? []) as any[]
  expect(rooms.length, 'habitaciones del hotel demo').toBeGreaterThan(0)
  for (const room of rooms) {
    if (room.type !== CRIB_TYPE && room.type !== NO_CRIB_TYPE) continue
    const wantCrib = room.type === CRIB_TYPE
    const rows = (unwrap(await (await request.get(`${BACKEND}/api/amenities/room/${room.id}`, { headers })).json()) ?? []) as any[]
    const isOn = (v: unknown) => v === true || v === 1 || v === '1'
    const crib = rows.find((a) => a.amenityKey === CRIB_KEY)
    const cribOk = wantCrib
      ? !!crib && isOn(crib.isActive) && Number(crib.price) === CRIB.price && crib.name === CRIB.name
      : !crib || !isOn(crib.isActive)
    if (cribOk) continue

    const amenities = rows.filter((a) => !String(a.amenityKey).startsWith('custom:') && isOn(a.isActive)).map((a) => a.amenityKey)
    const otherCustom = rows
      .filter((a) => String(a.amenityKey).startsWith('custom:') && a.amenityKey !== CRIB_KEY)
      .map((a) => ({ key: a.amenityKey, name: a.name, price: Number(a.price) || 0, isActive: isOn(a.isActive) }))
    // Sin la cuna en `items` la fila existente queda inactiva (el hotel "la quitó del form").
    const items = wantCrib ? [...otherCustom, CRIB] : otherCustom
    const res = await request.put(`${BACKEND}/api/amenities/room/${room.id}`, { headers, data: { amenities, items } })
    expect(res.ok(), `seed custom:cuna en room ${room.number ?? room.id}`).toBeTruthy()
  }
}

/** "15,00 US$" / "$15.00" — el formato lo decide Intl según el locale del widget. */
const PRICE_15 = /15[.,]00/

test.describe('/book/:slug — cuna por habitación (custom:cuna, #292)', () => {
  let errors: string[]
  test.beforeAll(async ({ request }) => {
    await seedCribFixture(request)
  })
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('el catálogo público publica custom:cuna sólo para el tipo con cuna', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/public/hotels/hotel-boutique-palma/room-amenities`)
    expect(res.status()).toBe(200)
    const byRoomType = unwrap(await res.json())?.byRoomType ?? {}
    expect(byRoomType[CRIB_TYPE]).toEqual(expect.arrayContaining([{ key: CRIB_KEY, name: 'Cuna', price: 15 }]))
    expect((byRoomType[NO_CRIB_TYPE] ?? []).some((a: any) => a.key === CRIB_KEY)).toBe(false)
  })

  test('(c) tipo CON cuna pero sin bebé: "¿Necesita cuna?" NO aparece', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Adultos' }).click() // 2 adultos, sin niños
    await expect(card.getByTestId('crib-question')).toHaveCount(0)
    await expect(card.getByTestId('baby-extras')).not.toBeVisible()

    // Un niño que NO es bebé (2 años > maxBabyAge=1) tampoco la dispara.
    await card.getByRole('button', { name: '− Double · Adultos' }).click()
    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await card.getByLabel('Edad del niño 1').selectOption('2')
    await expect(card.getByTestId('baby-badge')).toHaveCount(0)
    await expect(card.getByTestId('crib-question')).toHaveCount(0)
  })

  test('(b) tipo SIN cuna + bebé: NO aparece la pregunta aunque haya un bebé', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Triple')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Triple · Niños' }).click() // edad default 0 → bebé
    await expect(card.getByTestId('baby-badge')).toHaveCount(1)
    await expect(card.getByTestId('crib-question')).toHaveCount(0)
    await expect(card.getByTestId('baby-extras')).not.toBeVisible()

    // Mientras tanto, la tarjeta del tipo CON cuna sí la ofrece con el mismo bebé: la decisión es
    // por tipo de habitación, no del hotel entero.
    const doubleCard = roomCard(page, 'Double')
    await doubleCard.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(doubleCard.getByTestId('crib-question')).toBeVisible()
  })

  test('(a) tipo CON cuna + bebé: "¿Necesita cuna? (+ $15)" aparece, arranca en "No", "Sí" la marca — SIN selector de cantidad', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Niños' }).click() // edad default 0 → bebé
    const extras = card.getByTestId('baby-extras')
    await expect(extras).toBeVisible()
    await expect(card.getByTestId('crib-question')).toContainText('¿Necesita cuna?')
    await expect(card.getByTestId('crib-question')).toHaveText(/\(\+\s*.*15[.,]00.*\)/)
    await expect(card.getByTestId('crib-no')).toHaveClass(/bg-cyan/)

    await card.getByTestId('crib-yes').click()
    await expect(card.getByTestId('crib-yes')).toHaveClass(/bg-cyan/)
    // Simplificación del pedido: "no preguntar si desea una, dos o más cunas" — no debe existir
    // NINGÚN control de cantidad (ni el contador `role=status` del Stepper, ni sus botones +/-).
    await expect(extras.getByRole('status')).toHaveCount(0)
    await expect(extras.getByRole('button', { name: /^\+/ })).toHaveCount(0)
    await expect(extras.getByRole('button', { name: /^−/ })).toHaveCount(0)
  })

  test('(d) la cuna NO aparece en el checklist genérico "Amenidades de la habitación"', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    // Sin bebé: la tarjeta no ofrece la cuna por ningún lado (ni pregunta ni checklist).
    await expect(card.getByTestId('room-amenity-option').filter({ hasText: 'Cuna' })).toHaveCount(0)
    await expect(card.locator(`input[value="${CRIB_KEY}"]`)).toHaveCount(0)

    // Con bebé: la cuna se ofrece SÓLO como "¿Necesita cuna?", nunca como un checkbox más.
    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(card.getByTestId('crib-question')).toBeVisible()
    await expect(card.getByTestId('room-amenity-option').filter({ hasText: 'Cuna' })).toHaveCount(0)
    await expect(card.locator(`input[value="${CRIB_KEY}"]`)).toHaveCount(0)
  })

  test('sacar el único bebé destilda la cuna sola (defensa en profundidad)', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await card.getByTestId('crib-yes').click()
    await expect(card.getByTestId('crib-yes')).toHaveClass(/bg-cyan/)

    // Stepper.vue arma el label de decremento con el signo menos U+2212 ("−"), NO un guion ASCII.
    await card.getByRole('button', { name: '− Double · Niños' }).click()
    await expect(card.getByTestId('baby-extras')).not.toBeVisible()

    // Al volver a poner el bebé la cuna arranca de nuevo en "No" (no quedó pegada la key).
    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(card.getByTestId('crib-no')).toHaveClass(/bg-cyan/)
  })

  test('(a) "Sí" a la cuna: el carrito muestra "Cuna" y el total estimado suma los $15 de la amenidad', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Adultos' }).click() // 2 adultos
    await card.getByRole('button', { name: '+ Double · Niños' }).click() // 1 niño, edad default 0
    await expect(card.getByLabel('Edad del niño 1')).toBeVisible()
    await card.getByLabel('Edad del niño 1').selectOption('0') // 0 años → bebé
    await expect(card.getByTestId('baby-badge')).toHaveCount(1)
    await card.getByTestId('crib-yes').click()

    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    // El resumen "Tu reserva" (cart list) debajo de las tarjetas: adultos/niño/cuna de la línea.
    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(cartLine).toBeVisible()
    await expect(cartLine).toContainText('2 adultos')
    await expect(cartLine).toContainText('niño')
    await expect(cartLine).toContainText('Cuna')

    // Totales estimados: subtotal (sólo habitaciones) + amenidades (cuna 15) + impuestos = total.
    // Se despeja la cuna de las cifras que muestra el widget: total − Σ impuestos − subtotal = 15.
    const num = async (testId: string) => parseMoney(await page.getByTestId(testId).innerText())
    const subtotal = await num('cart-subtotal')
    const total = await num('estimated-total')
    const taxLines = page.getByTestId('tax-line')
    let taxes = 0
    for (let i = 0; i < await taxLines.count(); i++) taxes += parseMoney(await taxLines.nth(i).locator('span').last().innerText())
    expect(Math.round((total - taxes - subtotal) * 100) / 100).toBe(CRIB.price)
  })

  test('avanzar y volver entre pasos NO elimina el bebé, su edad ni la cuna ya agregados al carrito', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await card.getByTestId('crib-yes').click()
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(cartLine).toContainText('Cuna')

    // Avanza al step de Extras y vuelve CON EL BOTÓN PROPIO DEL WIZARD ("← Volver", store.back())
    // — este widget no navega por URL entre steps (todo vive en `store.status`), así que
    // `page.goBack()` del navegador no aplica acá. El carrito vive en el store (Pinia), no en el
    // componente del step, así que no debería perder nada al cambiar de step de todos modos.
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByText('Sumá extras a tu estadía')).toBeVisible()
    await page.getByRole('button', { name: '← Volver' }).click()

    await expect(roomCard(page, 'Double')).toBeVisible({ timeout: 15000 })
    const cartLineAfter = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(cartLineAfter).toContainText('niño')
    await expect(cartLineAfter).toContainText('Cuna')
  })

  test('(a) reserva creada: paso de pago con la línea "Cuna" a $15, needsCrib=true y custom:cuna cobrada en la reserva', async ({ page, request }) => {
    // Fecha propia de este test y distinta en cada corrida — la disponibilidad pública cachea 60s
    // (`AvailabilityUseCase`) y las 3 unidades de Double no deben agotarse con las reservas REALES
    // que deja cada corrida (no hay reset de DB entre corridas locales).
    await gotoWizardWithDates(page, randomFutureStay())
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Niños' }).click() // 1 adulto + 1 bebé (edad 0)
    await expect(card.getByTestId('baby-badge')).toHaveCount(1)
    await expect(card.getByTestId('crib-question')).toHaveText(PRICE_15)
    await card.getByTestId('crib-yes').click()
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(cartLine).toContainText('adulto')
    await expect(cartLine).toContainText('niño')
    await expect(cartLine).toContainText('Cuna')

    await page.getByRole('button', { name: 'Continuar' }).click() // carrito → upsells
    await expect(page.getByText('Sumá extras a tu estadía')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar' }).click() // upsells → huésped

    const guestName = `E2E Cuna ${Date.now()}`
    await expect(page.getByLabel('Nombre completo *')).toBeVisible()
    await page.getByLabel('Nombre completo *').fill(guestName)
    await page.getByLabel('Email *').fill(`e2e.cuna.${Date.now()}@example.com`)
    await page.getByLabel('Teléfono *').fill('8095550000')
    await page.getByRole('button', { name: 'Continuar al pago' }).click()

    // Paso "Pago" (PayStep.vue): resumen de la línea + la fila de amenidad "Cuna" con su precio.
    await expect(page.getByText(guestName)).toBeVisible()
    const payRoomSummary = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(payRoomSummary).toContainText('adulto')
    await expect(payRoomSummary).toContainText('niño')
    await expect(payRoomSummary).toContainText('Cuna')
    const cribLine = page.getByTestId('room-amenity-line').filter({ hasText: 'Cuna' })
    await expect(cribLine).toHaveCount(1)
    await expect(cribLine).toContainText(PRICE_15)

    await page.getByTestId('accept-terms').check()
    const createResponse = page.waitForResponse((r) => r.url().includes('/api/public/booking') && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Reservar y pagar/ }).click()
    const res = await createResponse
    expect(res.status()).toBe(201)
    const created = unwrap(await res.json())
    // El backend cobró la cuna como amenidad de la habitación asignada (precio del server, no del body).
    expect(created.totalBreakdown.roomAmenitiesTotal).toBe(CRIB.price)

    // Lo persistido: needsCrib=true, cribCount=1 y la línea `custom:cuna` con precio real.
    const saved = unwrap(await (await request.get(`${BACKEND}/api/reservas/${created.reservation.id}`, { headers: authHeaders() })).json())
    expect([true, 1, '1']).toContain(saved.needsCrib)
    expect(Number(saved.cribCount)).toBe(1)
    const roomAmenities = typeof saved.roomAmenities === 'string' ? JSON.parse(saved.roomAmenities) : saved.roomAmenities
    expect(roomAmenities).toEqual(expect.arrayContaining([expect.objectContaining({ key: CRIB_KEY, price: CRIB.price })]))
    expect(Number(saved.roomAmenitiesTotal)).toBe(CRIB.price)

    // Y Administración lo muestra: "Bebé: Cuna" en el detalle de la reserva.
    const adminPage = await page.context().browser()!.newPage({ storageState: ADMIN_STORAGE_STATE })
    try {
      await adminPage.goto('/panel/reservas')
      await expect(adminPage.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15000 })
      await adminPage.getByTestId('reservations-search').fill(guestName)
      await expect(adminPage.getByTestId('reservation-row').filter({ hasText: guestName })).toBeVisible()
      await adminPage.getByTestId('reservation-row').filter({ hasText: guestName }).click()
      await expect(adminPage.getByTestId('payment-state-badge')).toBeVisible({ timeout: 10000 })
      await expect(adminPage.getByTestId('reservation-crib')).toContainText('Cuna')
    } finally {
      await adminPage.close()
    }
  })
})

/** 2 noches en una ventana lejana (2028-03-01 + 0..364 días): cada corrida reserva fechas propias. */
function randomFutureStay(): { checkIn: string; checkOut: string } {
  const start = Date.UTC(2028, 2, 1) + Math.floor(Math.random() * 365) * 86_400_000
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { checkIn: iso(start), checkOut: iso(start + 2 * 86_400_000) }
}

/** "1.234,56 US$" / "$1,234.56" → 1234.56 (el separador decimal es el ÚLTIMO . o ,). */
function parseMoney(text: string): number {
  const cleaned = text.replace(/[^\d.,-]/g, '')
  const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','))
  const intPart = (lastSep >= 0 ? cleaned.slice(0, lastSep) : cleaned).replace(/[.,]/g, '')
  const decPart = lastSep >= 0 ? cleaned.slice(lastSep + 1) : ''
  return Number(decPart ? `${intPart}.${decPart}` : intPart)
}
