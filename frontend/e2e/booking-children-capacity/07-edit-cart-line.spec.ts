import { test, expect } from '../fixtures'
import type { APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// REQ-02 (#234, 2026-09-11) — dos cosas sobre el resumen "Tu reserva" del paso Habitaciones:
//   1. Cada menor de una línea agregada se muestra con su edad Y su clasificación según la
//      política del hotel: "1 año · bebé", "2 años · niño, no consume plaza",
//      "8 años · niño, consume plaza" — así el huésped confirma cómo quedó contado cada uno.
//   2. Botón "Editar" (`cart-edit`) en la línea: devuelve UNA unidad de esa línea al composer de
//      SU tarjeta con adultos/edades/cuna/amenidades tal como estaban, para corregirla sin
//      rearmarla desde cero. No debe tocar ni las otras líneas ni los composers de otras tarjetas.
//
// Fixture (sembrado por la API admin en `beforeAll`, idempotente — mismo fixture que
// 06-crib-and-child-amenities.spec.ts, nunca en una migración ni en prod): child_policy del hotel
// demo con maxChildAge=12, maxFreeAge=3, maxBabyAge=1 — 1 año → bebé, 2 años → niño que no
// consume plaza, 8 años → niño que consume plaza — y la cuna POR HABITACIÓN (#292): amenidad
// `RoomAmenities` `custom:cuna` ('Cuna', 15, activa) en todas las habitaciones del tipo Double y en
// ninguna del tipo Triple (ya no existe `childPolicy.cribAvailable`). "¿Necesita cuna?" aparece
// sólo con un bebé en la tarjeta de un tipo que publica `custom:cuna`; "Sí" agrega esa key a las
// amenidades de la línea, que es lo que "Editar" tiene que devolver intacto al composer.

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

/** Mismo seed que 06-crib-and-child-amenities.spec.ts (los specs no pueden importarse entre sí sin
 *  registrar dos veces sus tests). Idempotente: sólo escribe si falta, así N workers de Playwright
 *  (fullyParallel) no se pisan. Conserva las keys fijas y las demás custom de cada room. */
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
    const items = wantCrib ? [...otherCustom, CRIB] : otherCustom
    const res = await request.put(`${BACKEND}/api/amenities/room/${room.id}`, { headers, data: { amenities, items } })
    expect(res.ok(), `seed custom:cuna en room ${room.number ?? room.id}`).toBeTruthy()
  }
}

/** Arma en la tarjeta Double: 1 adulto (default) + 2 niños de 1 y 8 años, cuna Sí. */
async function composeDoubleWithBabyAndChild(page: Parameters<typeof roomCard>[0]) {
  const card = roomCard(page, 'Double')
  await expect(card).toBeVisible({ timeout: 15000 })
  await card.getByRole('button', { name: '+ Double · Niños' }).click()
  await card.getByRole('button', { name: '+ Double · Niños' }).click()
  await card.getByLabel('Edad del niño 1').selectOption('1') // 1 año → bebé
  await card.getByLabel('Edad del niño 2').selectOption('8') // 8 años → niño, consume plaza
  await expect(card.getByTestId('baby-badge')).toHaveCount(1)
  await card.getByTestId('crib-yes').click()
  await expect(card.getByTestId('crib-yes')).toHaveClass(/bg-cyan/)
  return card
}

test.describe('/book/:slug — REQ-02 (#234): editar una habitación agregada y clasificación en el resumen', () => {
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

  test('el resumen del carrito muestra cada menor con su edad y clasificación (bebé / consume plaza) y la cuna', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = await composeDoubleWithBabyAndChild(page)
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(cartLine).toBeVisible()
    await expect(cartLine).toContainText('1 adulto')
    await expect(cartLine).toContainText('2 niños')
    await expect(cartLine).toContainText('1 año · bebé')
    await expect(cartLine).toContainText('8 años · niño, consume plaza')
    await expect(cartLine).toContainText('Cuna')
  })

  test('"Editar" devuelve la línea al composer con adultos, edades y cuna intactos; corregir una edad y re-agregar actualiza el resumen', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = await composeDoubleWithBabyAndChild(page)
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' })
    await expect(cartLine).toHaveCount(1)
    await cartLine.first().getByTestId('cart-edit').click()

    // La única unidad de la línea vuelve al composer → la línea desaparece del carrito.
    await expect(cartLine).toHaveCount(0)

    // El composer de Double recupera EXACTAMENTE lo que tenía la línea.
    await expect(card.getByRole('status', { name: 'Double · Adultos: 1' })).toBeVisible()
    await expect(card.getByRole('status', { name: 'Double · Niños: 2' })).toBeVisible()
    await expect(card.getByLabel('Edad del niño 1')).toHaveValue('1')
    await expect(card.getByLabel('Edad del niño 2')).toHaveValue('8')
    await expect(card.getByTestId('baby-badge')).toHaveCount(1)
    await expect(card.getByTestId('crib-yes')).toHaveClass(/bg-cyan/)

    // Corrección: el segundo niño tiene 2 años (≤ maxFreeAge=3 → no consume plaza).
    await card.getByLabel('Edad del niño 2').selectOption('2')
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const updated = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(updated).toBeVisible()
    await expect(updated).toContainText('1 adulto')
    await expect(updated).toContainText('2 niños')
    await expect(updated).toContainText('1 año · bebé')
    await expect(updated).toContainText('2 años · niño, no consume plaza')
    await expect(updated).not.toContainText('8 años')
    await expect(updated).toContainText('Cuna')
  })

  test('editar la línea Double NO mezcla datos con la línea Triple ni con el composer de Triple', async ({ page }) => {
    await gotoWizardWithDates(page)

    // Double: 1 adulto + bebé de 1 año, cuna Sí.
    const doubleCard = roomCard(page, 'Double')
    await expect(doubleCard).toBeVisible({ timeout: 15000 })
    await doubleCard.getByRole('button', { name: '+ Double · Niños' }).click()
    await doubleCard.getByLabel('Edad del niño 1').selectOption('1')
    await expect(doubleCard.getByTestId('baby-badge')).toHaveCount(1)
    await doubleCard.getByTestId('crib-yes').click()
    await doubleCard.getByRole('button', { name: 'Agregar esta habitación' }).click()

    // Triple: 2 adultos + niño de 8 años, sin cuna (sin bebé no se ofrece — y el tipo tampoco
    // publica `custom:cuna`).
    const tripleCard = roomCard(page, 'Triple')
    await expect(tripleCard).toBeVisible()
    await tripleCard.getByRole('button', { name: '+ Triple · Adultos' }).click()
    await tripleCard.getByRole('button', { name: '+ Triple · Niños' }).click()
    await tripleCard.getByLabel('Edad del niño 1').selectOption('8')
    await expect(tripleCard.getByTestId('baby-extras')).not.toBeVisible()
    await tripleCard.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const doubleLine = page.getByTestId('cart-line').filter({ hasText: 'Double' })
    const tripleLine = page.getByTestId('cart-line').filter({ hasText: 'Triple' })
    await expect(doubleLine).toHaveCount(1)
    await expect(tripleLine).toHaveCount(1)

    await doubleLine.first().getByTestId('cart-edit').click()
    await expect(doubleLine).toHaveCount(0)

    // La línea Triple sigue tal cual en el carrito.
    await expect(tripleLine).toHaveCount(1)
    await expect(tripleLine.first()).toContainText('2 adultos')
    await expect(tripleLine.first()).toContainText('8 años · niño, consume plaza')
    await expect(tripleLine.first()).not.toContainText('Cuna')

    // El composer de Triple quedó en su estado fresco (1 adulto / 0 niños) — la edición de
    // Double no le "cayó" encima.
    await expect(tripleCard.getByRole('status', { name: 'Triple · Adultos: 1' })).toBeVisible()
    await expect(tripleCard.getByRole('status', { name: 'Triple · Niños: 0' })).toBeVisible()
    await expect(tripleCard.getByLabel('Edad del niño 1')).not.toBeVisible()

    // Y el de Double tiene lo suyo: 1 adulto, el bebé de 1 año y la cuna marcada.
    await expect(doubleCard.getByRole('status', { name: 'Double · Adultos: 1' })).toBeVisible()
    await expect(doubleCard.getByRole('status', { name: 'Double · Niños: 1' })).toBeVisible()
    await expect(doubleCard.getByLabel('Edad del niño 1')).toHaveValue('1')
    await expect(doubleCard.getByTestId('baby-badge')).toHaveCount(1)
    await expect(doubleCard.getByTestId('crib-yes')).toHaveClass(/bg-cyan/)
  })

  test('tras Editar y volver a agregar, la clasificación y la cuna llegan intactas al resumen del paso de pago', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = await composeDoubleWithBabyAndChild(page)
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' })
    await expect(cartLine).toHaveCount(1)
    await cartLine.first().getByTestId('cart-edit').click()
    await expect(cartLine).toHaveCount(0)

    // Sin cambios: se vuelve a agregar tal cual volvió al composer.
    await expect(card.getByLabel('Edad del niño 2')).toHaveValue('8')
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()
    await expect(cartLine).toHaveCount(1)
    await expect(cartLine.first()).toContainText('8 años · niño, consume plaza')

    await page.getByRole('button', { name: 'Continuar' }).click() // carrito → upsells
    await expect(page.getByText('Sumá extras a tu estadía')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar' }).click() // upsells → huésped

    const guestName = `E2E Editar ${Date.now()}`
    await expect(page.getByLabel('Nombre completo *')).toBeVisible()
    await page.getByLabel('Nombre completo *').fill(guestName)
    await page.getByLabel('Email *').fill(`e2e.editar.${Date.now()}@example.com`)
    await page.getByLabel('Teléfono *').fill('8095550000')
    await page.getByRole('button', { name: 'Continuar al pago' }).click()

    // Paso "Pago" (PayStep.vue): mismo formato de resumen que el carrito. NO se paga.
    await expect(page.getByText(guestName)).toBeVisible()
    const payLine = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(payLine).toContainText('1 adulto')
    await expect(payLine).toContainText('2 niños')
    await expect(payLine).toContainText('1 año · bebé')
    await expect(payLine).toContainText('8 años · niño, consume plaza')
    await expect(payLine).toContainText('Cuna')
    // #292 — la cuna viaja como amenidad `custom:cuna` de la línea: tras Editar + re-agregar sigue
    // UNA sola fila "Cuna" en el desglose (no se duplicó ni se perdió la key).
    await expect(page.getByTestId('room-amenity-line').filter({ hasText: 'Cuna' })).toHaveCount(1)
  })
})
