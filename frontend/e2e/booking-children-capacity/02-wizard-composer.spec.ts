import { test, expect } from '@playwright/test'
import { SLUG, STAY, roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// Escenarios funcionales sobre /book/:slug (widget embebible, wizard de 6 pasos): adultos+niños+
// edades, niño libre vs con plaza, límites de capacidad (física y por tipo), precio según
// ocupación, multi-habitación. Corre contra el backend real (SQLite local) — sin mocks.

test.describe('/book/:slug — composer de huéspedes', () => {
  let errors: string[]
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('adultos + niños + edades: el composer muestra un desplegable de edad POR NIÑO', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Adultos' }).click()
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')

    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(page.getByLabel('Edad del niño 1')).toBeVisible()

    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(page.getByLabel('Edad del niño 1')).toBeVisible()
    await expect(page.getByLabel('Edad del niño 2')).toBeVisible()
  })

  test('niño que NO consume plaza (edad ≤ maxFreeAge=3): la ocupación y el precio NO suben', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    // 2 adultos → "para 2" ($100/noche, $200 total con el fixture sembrado).
    await card.getByRole('button', { name: '+ Double · Adultos' }).click()
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')
    const priceBefore = await card.locator('[data-occupancy]').innerText()
    expect(priceBefore).toContain('200,00')

    // +1 niño, edad default (0, libre) — la ocupación chargeable NO debe subir a 3.
    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')
    const priceAfter = await card.locator('[data-occupancy]').innerText()
    expect(priceAfter).toContain('200,00')
  })

  // Double tiene capacity FÍSICA = 2 — un adulto+niño con plaza (chargeable=3) ya excedería esa
  // capacidad, así que este escenario usa Triple (capacity=3, sin tocar su maxAdults=2 override).
  test('niño que SÍ consume plaza (edad > maxFreeAge, ≤ maxChildAge=12): sube la ocupación y el precio', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Triple')
    await expect(card).toBeVisible({ timeout: 15000 })

    // 1 adulto (default) + 1 niño de 8 (> maxFreeAge=3, ≤ maxChildAge=12 → con plaza).
    await card.getByRole('button', { name: '+ Triple · Niños' }).click()
    await page.getByLabel('Edad del niño 1').selectOption('8')

    // chargeable = 1 adulto + 1 niño con plaza = 2 → tarifa sembrada para occupancy=2 ($115/noche → $230 total)
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')
    await expect(card.locator('[data-occupancy]')).toContainText('230,00')
    await expect(card.getByRole('button', { name: 'Agregar esta habitación' })).toBeEnabled()
  })

  // Single (capacity física=1, sin maxAdults/maxChildren propios): el stepper de ADULTOS ya
  // capea en 1 (max = maxAdults ?? capacity), así que ese camino nunca llega a excederse por UI.
  // El de NIÑOS sí permite sumar 1 (max = maxChildren ?? capacity = 1) sin saber la edad — recién
  // al declararla "con plaza" la combinación (1 adulto + 1 niño con plaza = 2) excede capacity=1,
  // y ahí aparece el motivo reactivo (nunca lo oculta, "regla del dueño").
  test('límite de capacidad FÍSICA (Single, capacity=1): "Agregar" se deshabilita y explica el motivo, nunca lo oculta', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Single')
    await expect(card).toBeVisible({ timeout: 15000 })

    // El stepper de adultos ya está en su tope (max=1) — no se puede exceder por ahí.
    await expect(card.getByRole('button', { name: '+ Single · Adultos' })).toBeDisabled()

    await card.getByRole('button', { name: '+ Single · Niños' }).click() // 1 adulto + 1 niño
    await page.getByLabel('Edad del niño 1').selectOption('8') // con plaza → chargeable=2 > capacity=1

    await expect(card.getByText('Supera la capacidad de la habitación')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Agregar esta habitación' })).toBeDisabled()
  })

  // Requerimiento 2 (capacidad por tipo) — 'triple' tiene room_type_capacity sembrada:
  // {capacity:3, maxAdults:2, maxChildren:1}. El límite se aplica DIRECTO en el stepper de niños
  // (max = rt.maxChildren, que /rates ya devuelve con el override aplicado — no el físico, que es
  // null): con 1 niño con plaza ya en el tope, el botón "+" de niños queda deshabilitado — el
  // composer no deja ni PLANTEAR una composición que el tipo no admite.
  test('límite POR TIPO (maxChildren de "triple", vía room_type_capacity): el stepper de niños respeta el override, no el físico', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Triple')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Triple · Niños' }).click() // 1 adulto + 1 niño
    await page.getByLabel('Edad del niño 1').selectOption('5') // con plaza
    await expect(card.getByRole('button', { name: 'Agregar esta habitación' })).toBeEnabled()

    // maxChildren=1 (override, NO el físico=3): el stepper de niños ya no deja sumar un 2do.
    await expect(card.getByRole('button', { name: '+ Triple · Niños' })).toBeDisabled()
  })

  test('multi-habitación: dos tarjetas distintas al carrito, cada una con SU composición', async ({ page }) => {
    await gotoWizardWithDates(page)

    const doubleCard = roomCard(page, 'Double')
    await expect(doubleCard).toBeVisible({ timeout: 15000 })
    await doubleCard.getByRole('button', { name: '+ Double · Adultos' }).click() // 2 adultos
    await doubleCard.getByRole('button', { name: '+ Double · Niños' }).click()
    await page.getByLabel('Edad del niño 1').selectOption('2') // libre
    await doubleCard.getByRole('button', { name: 'Agregar esta habitación' }).click()

    const singleCard = roomCard(page, 'Single')
    await singleCard.getByRole('button', { name: 'Agregar esta habitación' }).click() // 1 adulto, default

    // Resumen del carrito: 2 habitaciones, huéspedes totales = 2 (Double, niño libre no cuenta) + 1 (Single) = 3.
    await expect(page.getByText(/2 habitaci/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible()
    // Cada línea del carrito lista un tipo distinto — no se mezclan en una sola.
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).toContain('Double')
    expect(bodyText).toContain('Single')
  })
})
