import { test, expect } from '../fixtures'
import { roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// REQ-02 (#234, 2026-09-11) — dos cosas sobre el resumen "Tu reserva" del paso Habitaciones:
//   1. Cada menor de una línea agregada se muestra con su edad Y su clasificación según la
//      política del hotel: "1 año · bebé", "2 años · niño, no consume plaza",
//      "8 años · niño, consume plaza" — así el huésped confirma cómo quedó contado cada uno.
//   2. Botón "Editar" (`cart-edit`) en la línea: devuelve UNA unidad de esa línea al composer de
//      SU tarjeta con adultos/edades/cuna/amenidades tal como estaban, para corregirla sin
//      rearmarla desde cero. No debe tocar ni las otras líneas ni los composers de otras tarjetas.
//
// Fixture local: child_policy del hotel demo con maxChildAge=12, maxFreeAge=3, maxBabyAge=1 y
// cribAvailable=true (sembrado ad-hoc en la DB SQLite local, nunca en una migración ni en prod).
// Con eso: 1 año → bebé, 2 años → niño que no consume plaza, 8 años → niño que consume plaza.

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

    // Triple: 2 adultos + niño de 8 años, sin cuna (sin bebé no se ofrece).
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
  })
})
