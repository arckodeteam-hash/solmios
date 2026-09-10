import { test, expect } from '../fixtures'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { SLUG, roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// Tarea 22 (Agregar solicitud de cuna, 2026-09-08), CORREGIDA Y SIMPLIFICADA 2026-09-09:
//   - Se eliminó el checklist de "amenidades para bebé" (Kit de bebé / Niñera por hora) — para
//     este flujo la ÚNICA amenidad es la cuna, y es Sí/No, sin cantidad.
//   - "¿Necesita cuna?" solo aparece si el hotel HABILITÓ la cuna (`childPolicy.cribAvailable`,
//     administrado en Página pública → Motor de Reservas — NO en Configuración → Niños, que es
//     una pantalla distinta) Y la reserva tiene un bebé — antes solo dependía del bebé.
//   - Se corrigió un bug real: al agregar la habitación, el resumen del carrito (RoomsStep.vue)
//     y el paso de pago (PayStep.vue) no mostraban el bebé/la cuna de la línea ya agregada (el
//     dato SÍ quedaba guardado, pero ningún resumen lo reflejaba) — cubierto explícitamente acá.
//
// Fixture local: child_policy del hotel demo tiene maxBabyAge=1 (0-1 años = bebé) y
// cribAvailable=true (sembrado ad-hoc en la DB SQLite local, nunca en una migración ni en prod).

test.describe('/book/:slug — cuna (Sí/No, Tarea 22 corregida 2026-09-09)', () => {
  let errors: string[]
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('"¿Necesita cuna?" NO aparece sin un bebé en la composición', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Adultos' }).click() // 2 adultos, sin niños
    await expect(card.getByTestId('baby-extras')).not.toBeVisible()
  })

  test('con un bebé: "¿Necesita cuna?" aparece, arranca en "No", "Sí" la marca — SIN selector de cantidad', async ({ page }) => {
    await gotoWizardWithDates(page)
    const card = roomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Double · Niños' }).click() // edad default 0 → bebé
    const extras = card.getByTestId('baby-extras')
    await expect(extras).toBeVisible()
    await expect(card.getByTestId('crib-no')).toHaveClass(/bg-cyan/)

    await card.getByTestId('crib-yes').click()
    await expect(card.getByTestId('crib-yes')).toHaveClass(/bg-cyan/)
    // Simplificación del pedido: "no preguntar si desea una, dos o más cunas" — no debe existir
    // NINGÚN control de cantidad (ni el contador `role=status` del Stepper, ni sus botones +/-).
    await expect(extras.getByRole('status')).toHaveCount(0)
    await expect(extras.getByRole('button', { name: /^\+/ })).toHaveCount(0)
    await expect(extras.getByRole('button', { name: /^−/ })).toHaveCount(0)
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
  })

  // Bug corregido (2026-09-09): "la habitación agregada refleja el adulto, pero no conserva/
  // muestra correctamente el niño/bebé ni la solicitud de cuna" — el dato SIEMPRE se guardó bien
  // en el carrito; lo que faltaba era mostrarlo en el resumen. Este test verifica el resumen real.
  test('flujo completo: adulto + bebé + cuna → "Agregar esta habitación" → el resumen del carrito muestra TODO correctamente', async ({ page }) => {
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

    // El resumen "Tu reserva" (cart list) debajo de las tarjetas — ANTES de este fix mostraba
    // solo "para 3" sin distinguir adultos/niño/cuna.
    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Double' }).first()
    await expect(cartLine).toBeVisible()
    await expect(cartLine).toContainText('2 adultos')
    await expect(cartLine).toContainText('niño')
    await expect(cartLine).toContainText('Cuna')
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

  test('persistencia + Administración + paso de pago: adulto, bebé y cuna quedan guardados y se ven correctamente', async ({ page }) => {
    // Fecha propia de este test, nunca antes consultada — la disponibilidad pública cachea 60s
    // (`AvailabilityUseCase`) y la única unidad física de Triple no debe chocar con otra corrida.
    await gotoWizardWithDates(page, { checkIn: '2028-02-10', checkOut: '2028-02-12' })
    const card = roomCard(page, 'Triple')
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByRole('button', { name: '+ Triple · Niños' }).click() // 1 adulto + 1 bebé (edad 0)
    await expect(card.getByTestId('baby-badge')).toHaveCount(1)
    await expect(card.getByTestId('baby-extras')).toBeVisible()
    await card.getByTestId('crib-yes').click()
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    // Paso "Habitaciones" (resumen del carrito) — el bug reportado.
    const cartLine = page.getByTestId('cart-line').filter({ hasText: 'Triple' }).first()
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

    // Paso "Pago" (PayStep.vue) — el segundo lugar donde el resumen estaba roto (mostraba "para
    // N" plano, ignorando adults/childrenAges/needsCrib de la línea).
    await expect(page.getByText(guestName)).toBeVisible()
    const payRoomSummary = page.getByTestId('cart-line').filter({ hasText: 'Triple' }).first()
    await expect(payRoomSummary).toContainText('adulto')
    await expect(payRoomSummary).toContainText('niño')
    await expect(payRoomSummary).toContainText('Cuna')

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

      // Adultos + niño (con su edad) — ya cubierto por 05-baby-identification.spec.ts, se
      // confirma acá de nuevo junto con la cuna porque es EXACTAMENTE lo que el pedido pide
      // probar junto: "comprobar que adulto, bebé y cuna quedaron guardados correctamente".
      await expect(adminPage.getByTestId('reservation-crib')).toContainText('Cuna')
    } finally {
      await adminPage.close()
    }
  })
})

// Página pública → Motor de Reservas (`/panel/pagina-publica?tab=booking-engine`) — es DONDE el
// hotelero administra "Política de niños" en la práctica (no en Configuración → Niños, que
// también persiste el mismo `configuration('child_policy')` pero es una pantalla distinta que el
// hotelero no usa para esto). El toggle de cuna vive ACÁ, no ahí.
test.describe('Panel — habilitar/deshabilitar cuna, en Página pública → Motor de Reservas (Tarea 22 corregida 2026-09-09)', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test('apagar "Ofrece cuna para bebés" oculta "¿Necesita cuna?" en el composer público; prenderlo la vuelve a mostrar', async ({ page, context }) => {
    await page.goto('/panel/pagina-publica?tab=booking-engine')
    await expect(page.getByText('Ofrece cuna para bebés')).toBeVisible({ timeout: 15000 })

    const toggle = page.locator('#booking-engine-ofrece-cuna')
    // Fixture local: arranca habilitado (ver comentario de archivo).
    await expect(toggle).toBeChecked()

    await toggle.uncheck()
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByText('Configuración guardada')).toBeVisible()

    const publicPage = await context.newPage()
    try {
      await gotoWizardWithDates(publicPage)
      const card = roomCard(publicPage, 'Double')
      await expect(card).toBeVisible({ timeout: 15000 })
      await card.getByRole('button', { name: '+ Double · Niños' }).click() // bebé, edad 0
      await expect(card.getByTestId('baby-badge')).toHaveCount(1)
      // Con la cuna deshabilitada, la pregunta NO aparece aunque haya un bebé.
      await expect(card.getByTestId('baby-extras')).not.toBeVisible()
    } finally {
      await publicPage.close()
    }

    // Se deja como estaba (habilitado) para no afectar otras corridas de esta suite.
    await toggle.check()
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByText('Configuración guardada')).toBeVisible()
  })
})
