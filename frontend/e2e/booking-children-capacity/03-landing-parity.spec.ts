import { test, expect, type Page } from '@playwright/test'
import { SLUG, STAY, logConsoleAndHttpErrors } from './helpers'

// BookingModal.vue NO usa heading-role para el nombre del tipo (es un <span>, ver
// BookingModal.vue:186), a diferencia de RoomsStep.vue — así que el `roomCard()` de helpers.ts
// (que busca un heading) resuelve la tarjeta de "Habitaciones" ESTÁTICA de la landing (fuera del
// modal), no la del composer. Acá se escopea directo al overlay del modal.
function modalRoot(page: Page) {
  return page.locator('div.fixed.inset-0.z-50')
}
function modalRoomCard(page: Page, typeName: string) {
  return modalRoot(page).locator('article').filter({ hasText: typeName }).first()
}

// Escenario 9 (/h/:slug): la landing pública abre BookingModal.vue, que comparte
// useGuestComposer.ts/useBooking.ts con el widget (/book/:slug) — paridad ya probada a fondo por
// unit/component tests (booking-wizard-landing-parity.test.ts) y por el Requerimiento 15. Acá se
// verifica que la INTEGRACIÓN real (calendario propio de la landing, RateCalendar.vue, distinto
// del CalendarView.vue del widget) llega al mismo composer y produce el mismo resultado.

function shortDateEs(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(y!, m! - 1, d))
    .replace(/\./g, '')
}

test.describe('/h/:slug — landing, paridad con el widget', () => {
  let errors: string[]
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('abre el modal de reserva, elige fechas por el calendario propio y llega al MISMO composer', async ({ page }) => {
    await page.goto(`/h/${SLUG}`)
    await page.getByRole('button', { name: 'Reservar ahora' }).first().click()

    // Paso "fechas": calendario propio de la landing (RateCalendar.vue).
    await expect(page.getByRole('heading', { name: '¿Cuándo venís?' })).toBeVisible({ timeout: 15000 })
    // El buscador del hero (#hero) tiene el MISMO botón de fechas — escopear al modal.
    await page.locator('button[aria-haspopup="dialog"]').last().click()
    await page.getByRole('button', { name: new RegExp('^' + shortDateEs(STAY.checkIn)) }).click()
    await page.getByRole('button', { name: new RegExp('^' + shortDateEs(STAY.checkOut)) }).click()

    await page.getByRole('button', { name: 'Ver disponibilidad' }).click()

    // Mismo composer que /book/:slug: mismos aria-label de Stepper, mismo [data-occupancy].
    const card = modalRoomCard(page, 'Double')
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.getByRole('button', { name: '+ Double · Adultos' }).click()
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')
    await expect(card.locator('[data-occupancy]')).toContainText('200,00') // misma tarifa sembrada que el widget

    await card.getByRole('button', { name: '+ Double · Niños' }).click()
    await expect(card.getByLabel('Edad del niño 1')).toBeVisible()
    await card.getByLabel('Edad del niño 1').selectOption('2') // libre — no debe subir el precio
    await expect(card.locator('[data-occupancy]')).toHaveAttribute('data-occupancy', '2')
    await expect(card.locator('[data-occupancy]')).toContainText('200,00')

    await expect(card.getByRole('button', { name: 'Agregar esta habitación' })).toBeEnabled()
  })
})
