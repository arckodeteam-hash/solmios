import { test, expect } from '../fixtures'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { SLUG, roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// Escenarios 11-14: creación y persistencia de una reserva pública real (composición con
// niños), su visualización posterior en Administración (composición + estado de pago), rechazo
// de una reserva ADMINISTRATIVA que excede capacidad (el fix del cierre de auditoría de
// integridad), y estado de pago reflejado en el Planning/Calendario.

function uniqueGuestName(): string {
  return `E2E Niños ${Date.now()}`
}

test.describe('Persistencia + Administración + rechazo de capacidad', () => {
  let errors: string[]
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('crear una reserva pública con niños, persiste, y se ve correctamente en Administración', async ({ page }) => {
    const guestName = uniqueGuestName()
    // OJO: el nombre lleva "ñ" ("Niños") — un email derivado de él con esa letra falla la
    // validación de email del form (no navega a "Pago"). El email de prueba va aparte, en ASCII.
    const guestEmail = `e2e.ninos.${Date.now()}@example.com`

    // ── Público: /book/:slug, composición 2 adultos + 1 niño CON PLAZA (edad 8) ──
    // Triple (capacity=3, override room_type_capacity maxAdults=2/maxChildren=1): 2 adultos + 1
    // niño con plaza = ocupación cobrable 3, encaja justo. Double (capacity=2) NO alcanza para
    // esta composición — mismo error de tipo de habitación ya corregido en 02-wizard-composer.
    // Fechas propias, lejos de otros tests — Triple solo tiene 1 unidad en el seed. Este test
    // persiste una reserva REAL cada corrida (sin reset de DB entre corridas locales): si se
    // vuelve a correr, hay que mover este rango a fechas libres (o cancelar la reserva vieja).
    await gotoWizardWithDates(page, { checkIn: '2027-01-15', checkOut: '2027-01-17' })
    const card = roomCard(page, 'Triple')
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.getByRole('button', { name: '+ Triple · Adultos' }).click()
    await card.getByRole('button', { name: '+ Triple · Niños' }).click()
    await page.getByLabel('Edad del niño 1').selectOption('8')
    await card.getByRole('button', { name: 'Agregar esta habitación' }).click()

    await page.getByRole('button', { name: 'Continuar' }).click() // carrito → upsells
    await expect(page.getByText('Sumá extras a tu estadía')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar' }).click() // upsells → huésped

    await expect(page.getByLabel('Nombre completo *')).toBeVisible()
    await page.getByLabel('Nombre completo *').fill(guestName)
    await page.getByLabel('Email *').fill(guestEmail)
    await page.getByLabel('Teléfono *').fill('8095550000')
    await page.getByRole('button', { name: 'Continuar al pago' }).click()

    await page.getByTestId('accept-terms').check()
    const createResponse = page.waitForResponse((r) => r.url().includes('/api/public/booking') && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Reservar y pagar/ }).click()
    const res = await createResponse
    expect(res.status()).toBe(201)
    const body = await res.json()
    // Forma real de la respuesta (public-reservation.ts): { reservation: { id, ... } }, envuelta
    // en el envelope { success, data, ... } del framework.
    const reservationId = body.data?.reservation?.id ?? body.reservation?.id
    expect(reservationId).toBeTruthy()
    // Sin Stripe configurado en local (STRIPE_SECRET_KEY vacía): sin checkoutUrl, la reserva
    // queda creada ('pending') y el widget lo informa en vez de redirigir — no hay que seguir
    // ninguna navegación externa para probar la persistencia.

    // ── Administración: la MISMA reserva, composición y estado de pago correctos ──
    const adminPage = await page.context().browser()!.newPage({ storageState: ADMIN_STORAGE_STATE })
    try {
      const adminErrors: string[] = []
      logConsoleAndHttpErrors(adminPage, adminErrors)

      await adminPage.goto('/panel/reservas')
      await expect(adminPage.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15000 })
      await adminPage.getByTestId('reservations-search').fill(guestName)
      await expect(adminPage.getByTestId('reservation-guest-name').filter({ hasText: guestName })).toBeVisible()
      await adminPage.getByTestId('reservation-row').filter({ hasText: guestName }).click()
      // El modal muestra "Cargando reserva…" mientras trae el detalle — esperar el badge de pago
      // (que solo se renderiza con los datos ya cargados) antes de leer el texto.
      await expect(adminPage.getByTestId('payment-state-badge')).toBeVisible({ timeout: 10000 })

      // Composición: 2 adultos + 1 niño de 8 años, con plaza (política del hotel: maxFreeAge=3).
      const modalText = await adminPage.locator('body').innerText()
      expect(modalText).toContain('2 pax')
      expect(modalText).toContain('8 año(s) declarado(s)')
      expect(modalText).toContain('consume plaza')

      // Estado de pago: nada cobrado (Stripe no configurado en local) → "Pendiente".
      await expect(adminPage.getByTestId('payment-state-badge')).toHaveText('Pendiente')

      // ── Planning/Calendario: la MISMA reserva, mismo estado de pago (Escenario 14) ──
      // `OperationsService.planning()` trae TODAS las reservas del hotel (sin filtro de fecha),
      // así que "Buscar" la encuentra sin tener que navegar semana a semana hasta 2026-11-10.
      await adminPage.goto('/panel/planning')
      await adminPage.getByRole('button', { name: 'Buscar' }).click()
      await expect(adminPage.getByRole('heading', { name: 'Buscar reserva' })).toBeVisible()
      await adminPage.getByPlaceholder('Nombre, localizador o habitación…').fill(guestName)
      // La fila clicable (@click="quickOpenRes") es el único div.cursor-pointer del resultado —
      // el nombre está anidado 2 niveles adentro, así que un filtro por texto sin más ambigüa
      // entre el wrapper y el div de texto interno.
      const searchResult = adminPage.locator('div.cursor-pointer').filter({ hasText: guestName })
      await expect(searchResult).toBeVisible()
      await searchResult.click()
      await expect(adminPage.getByTestId('payment-state-badge')).toBeVisible({ timeout: 10000 })
      await expect(adminPage.getByTestId('payment-state-badge')).toHaveText('Pendiente')

      if (adminErrors.length) console.log('Errores (admin, ver reserva):', adminErrors)
    } finally {
      await adminPage.close()
    }
  })
})

test.describe('Rechazo de reservas administrativas que excedan capacidad', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })
  let errors: string[]
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('el panel NO permite crear una reserva que excede la capacidad de la habitación (409 del backend)', async ({ page }) => {
    const guestName = `E2E Capacidad ${Date.now()}`

    await page.goto('/panel/reservas')
    await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15000 })
    await page.getByTestId('reservations-new-button').click()
    await expect(page.getByTestId('wizard-title')).toHaveText('Nueva Reserva')

    // Paso 1: Huésped.
    await page.locator('#wiz-name').fill(guestName)
    await page.locator('#wiz-email').fill(`${guestName.toLowerCase().replace(/\s+/g, '.')}@example.com`)
    await page.getByRole('button', { name: 'Siguiente' }).click()
    // Paso 2/3: sin campos obligatorios.
    await expect(page.getByText('Paso 2 de 5')).toBeVisible()
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByText('Paso 3 de 5')).toBeVisible()
    await page.getByRole('button', { name: 'Siguiente' }).click()

    // Paso 4: Alojamiento — fechas lejos de lo usado en otros tests + habitación "Single" (capacity=1).
    await expect(page.getByText('Paso 4 de 5')).toBeVisible()
    const checkIn = '2026-10-05'
    const checkOut = '2026-10-07'
    const availabilityLoaded = page.waitForResponse((r) => r.url().includes('/api/habitaciones') && r.url().includes(`checkIn=${checkIn}`))
    await page.locator('#wiz-checkin').fill(checkIn)
    await page.locator('#wiz-checkout').fill(checkOut)
    await availabilityLoaded

    const roomSelect = page.getByTestId('wiz-room-select')
    await roomSelect.locator('input').click()
    const singleOption = page.locator('body > ul li:not([aria-disabled="true"])', { hasText: '103' }) // Single, número 103
    await expect(singleOption).toBeVisible()
    await singleOption.click()
    await expect(roomSelect.locator('input')).not.toHaveValue('')

    // El formulario NO avisa de ningún límite de capacidad (decisión de producto: el panel no
    // migra al composer de edades en esta tarea) — 2 adultos en una Single (capacity=1) se puede
    // TIPEAR sin ningún freno de UI; el backend es quien tiene que rechazarlo.
    await page.locator('#wiz-adults').fill('2')
    await page.getByRole('button', { name: 'Siguiente' }).click()

    // Paso 5: Pago.
    await expect(page.getByText('Paso 5 de 5')).toBeVisible()
    // OJO: el wizard también pega a POST /api/reservas/quote al elegir habitación/fechas — el
    // filtro tiene que excluirlo explícitamente o el waitForResponse puede resolver con ESA
    // respuesta (200) en vez de la del alta real.
    const createResponse = page.waitForResponse((r) => /\/api\/reservas$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Crear Reserva' }).click()
    const res = await createResponse

    // Rechazado por el backend (auditoría de integridad, cierre): 409, "admite hasta 1".
    expect(res.status()).toBe(409)
    await expect(page.getByTestId('wizard-error')).toBeVisible()
    await expect(page.getByTestId('wizard-error')).toContainText(/admite hasta 1/)
    // El wizard NO se cerró (no se creó nada) — sigue en Paso 5.
    await expect(page.getByText('Paso 5 de 5')).toBeVisible()
  })
})
