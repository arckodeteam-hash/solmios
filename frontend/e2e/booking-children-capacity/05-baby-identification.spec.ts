import { test, expect } from '../fixtures'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { SLUG, roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// Tarea 21 (Identificar bebés en la reserva pública, 2026-09-08) — sobre /book/:slug.
//
// Fixture local (ver helpers.ts): child_policy del hotel demo se actualizó ad-hoc en la DB SQLite
// local para incluir maxBabyAge=1 (además de maxChildAge=12/maxFreeAge=3 ya sembrados) — SOLO en
// este entorno de dev, nunca en una migración ni en prod. Con esos valores: 0-1 años = bebé,
// 2-3 años = niño libre (no bebé), 4-12 años = con plaza, >12 = adulto.

test.describe('/book/:slug — identificación de bebés (Tarea 21)', () => {
  let errors: string[]
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('un niño recién agregado (edad default 0, ≤ maxBabyAge=1) se muestra como bebé de entrada', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(page.getByLabel('Edad del niño 1')).toBeVisible()
    await expect(page.getByLabel('Edad del niño 1')).toHaveValue('0')
    await expect(card.getByTestId('baby-badge')).toBeVisible()
    await expect(card.getByTestId('baby-badge')).toContainText('Bebé')
  })

  test('cambiar la edad a un valor > maxBabyAge saca el badge (deja de ser bebé, sigue sin consumir plaza)', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(card.getByTestId('baby-badge')).toBeVisible() // edad 0 → bebé

    // 2 años: > maxBabyAge=1, pero ≤ maxFreeAge=3 → sigue sin consumir plaza, ya NO es "bebé".
    await page.getByLabel('Edad del niño 1').selectOption('2')
    await expect(card.getByTestId('baby-badge')).not.toBeVisible()

    // Aun así, la ocupación NO sube (mismo comportamiento que un niño libre) — Tarea 21: "no
    // asumir automáticamente que bebé ocupa una plaza" se cumple para el bebé Y para el rango
    // completo de "sin plaza" del que el bebé es subconjunto.
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '1')
  })

  test('un bebé (edad 0-1) NO sube el precio ni la ocupación chargeable — igual que un niño libre', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Adultos' }).click()
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')
    const priceBefore = await card.locator('[data-occupancy]').innerText()
    expect(priceBefore).toContain('200,00')

    // +1 bebé (edad default 0, ≤ maxBabyAge=1) — la ocupación chargeable y el precio no cambian.
    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(card.getByTestId('baby-badge')).toBeVisible()
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')
    const priceAfter = await card.locator('[data-occupancy]').innerText()
    expect(priceAfter).toContain('200,00')
  })

  // Single (capacity física=1): 1 adulto (default, tope del stepper) + 1 bebé (edad 0-1) NO debe
  // bloquear "Agregar" — el bebé no cuenta contra ningún límite de capacidad, tal como pide la
  // tarea ("la capacidad debe respetar las reglas configuradas... no asumir que bebé ocupa plaza").
  test('un bebé NO cuenta contra la capacidad física de la habitación', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Single')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Single · Niños' }).click() // 1 adulto + 1 bebé (edad 0)
    await expect(card.getByTestId('baby-badge')).toBeVisible()

    await expect(card.getByText('Supera la capacidad de la habitación')).not.toBeVisible()
    await expect(card.getByRole('button', { name: 'Agregar esta habitación' })).toBeEnabled()
  })

  test('persistencia + Administración: el bebé llega a la reserva creada y se muestra distinto de "no consume plaza"', async ({ page }) => {
    await gotoWizardWithDates(page, { checkIn: '2027-03-15', checkOut: '2027-03-17' })
    const card = roomCard(page, 'Triple')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Triple · Niños' }).click() // 1 adulto + 1 bebé (edad 0)
    await expect(card.getByTestId('baby-badge')).toBeVisible()
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    await page.getByRole('button', { name: 'Continuar' }).click() // carrito → upsells
    await expect(page.getByText('Sumá extras a tu estadía')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar' }).click() // upsells → huésped

    const guestName = `E2E Bebe ${Date.now()}`
    await expect(page.getByLabel('Nombre completo *')).toBeVisible()
    await page.getByLabel('Nombre completo *').fill(guestName)
    await page.getByLabel('Email *').fill(`e2e.bebe.${Date.now()}@example.com`)
    await page.getByLabel('Teléfono *').fill('8095550000')
    await page.getByRole('button', { name: 'Continuar al pago' }).click()

    await page.getByTestId('accept-terms').check()
    const createResponse = page.waitForResponse((r) => r.url().includes('/api/public/booking') && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Reservar y pagar/ }).click()
    const res = await createResponse
    expect(res.status()).toBe(201)

    const adminPage = await page.context().browser()!.newPage({ storageState: ADMIN_STORAGE_STATE })
    try {
      await adminPage.goto('/panel/reservas')
      await expect(adminPage.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15000 })
      await adminPage.getByTestId('reservations-search').fill(guestName)
      await expect(adminPage.getByTestId('reservation-row').filter({ hasText: guestName })).toBeVisible()
      await adminPage.getByTestId('reservation-row').filter({ hasText: guestName }).click()
      await expect(adminPage.getByTestId('payment-state-badge')).toBeVisible({ timeout: 10000 })

      const modalText = await adminPage.locator('body').innerText()
      // "bebé, no consume plaza" (childClassificationLabel en ReservationModal.vue) — distinto del
      // texto genérico "no consume plaza" que usa un niño libre que NO es bebé.
      expect(modalText).toContain('bebé, no consume plaza')
    } finally {
      await adminPage.close()
    }
  })
})
