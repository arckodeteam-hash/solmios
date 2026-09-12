import { mkdirSync } from 'node:fs'
import { test, expect } from '../fixtures'
import { apiGet, apiPost, localISO } from '../helpers/reservation-flow'
import { ADMIN_STORAGE_STATE } from '../global-setup'

// Sesión admin pre-autenticada por globalSetup — ver checkout.spec.ts para el detalle del patrón.
test.use({ storageState: ADMIN_STORAGE_STATE })

// RES-06 — Registrar pago manual con evidencia (REQ-RWP-06, aceptación 6.2 del issue #249).
//
// Un huésped reservó por la web y pagó por transferencia (o en efectivo / TPV físico): recepción
// tiene que poder marcar la reserva como cobrada desde la ficha, dejando evidencia de quién lo
// registró y con qué referencia. Este spec verifica lo que un QA humano comprobaría:
//   1. Validación — con "Transferencia" elegida, el botón "Confirmar" está deshabilitado hasta
//      cargar una referencia (el backend también lo rechaza con 400; acá se cubre la UI).
//   2. Prellenado — el importe viene con el saldo pendiente (354 sobre 354).
//   3. Notificación — toast "Pago registrado".
//   4. Efecto en la ficha — el badge pasa de "Pendiente" a "Pagada" y el "Historial de cobros"
//      muestra la fila con método, referencia y "Registró: {nombre del usuario}".
//   5. Persistencia — GET de la reserva: status confirmed / paymentState paid / pendingAmount 0;
//      y el pago existe en /api/payments como completed/transfer con la referencia.
//   6. Captura de la tarjeta "Importe y Pago" con el historial (e2e/.artifacts/).
//
// Los datos se crean por API (huésped + reserva pending de 354) y no con el wizard de la UI:
// el select de habitación del wizard se desmonta con HMR y hace frágil la preparación, y lo que
// se prueba acá es el pago manual, no el alta. La ventana de fechas es lejana y varía con la
// hora para no chocar con la disponibilidad de otros specs que corren en paralelo.

const TOTAL = 354

test.describe('RES-06 — registrar pago manual (REQ-RWP-06)', () => {
  test.setTimeout(60_000)

  test('transferencia con referencia deja la reserva "Pagada" y la fila en el historial', async ({ page }) => {
    const ts = Date.now()
    const guestName = `E2E MarkPaid ${ts}`
    const reference = `TRF-E2E-${ts}`

    // apiGet/apiPost leen el token de localStorage → hace falta una página del origen cargada.
    await page.goto('/panel/reservas')
    await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15_000 })

    // ── Preparación por API: huésped + reserva pending con saldo 354 ──
    const me = await apiGet<any>(page, '/api/auth/me')
    const hotelId: string = me.data?.hotelId ?? me.hotelId
    const userName: string = me.data?.name ?? me.name
    expect(hotelId).toBeTruthy()

    const guestRes = await apiPost<any>(page, '/api/huespedes', {
      hotelId,
      name: guestName,
      email: `e2e.markpaid.${ts}@example.com`,
    })
    expect(guestRes.status, JSON.stringify(guestRes.body)).toBe(201)
    const guestId: string = guestRes.body.data?.id ?? guestRes.body.id

    const roomsRes = await apiGet<any>(page, '/api/habitaciones?limit=50')
    const rooms: any[] = Array.isArray(roomsRes.data) ? roomsRes.data : roomsRes.data?.data ?? []
    expect(rooms.length).toBeGreaterThan(0)

    // Ventana lejana y distinta por corrida; si una habitación está ocupada se prueba la siguiente.
    const offset = 200 + (ts % 100)
    const checkIn = localISO(offset)
    const checkOut = localISO(offset + 2)
    let reservationId = ''
    for (const room of rooms) {
      const res = await apiPost<any>(page, '/api/reservas', {
        hotelId,
        roomId: room.id,
        guestId,
        checkIn,
        checkOut,
        totalAmount: TOTAL,
        status: 'pending',
        adults: 2,
      })
      if (res.status === 201) {
        reservationId = res.body.data?.id ?? res.body.id
        break
      }
      expect([400, 409], `POST /api/reservas inesperado: ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status)
    }
    expect(reservationId, 'no se pudo crear la reserva en ninguna habitación').toBeTruthy()

    const before = await apiGet<any>(page, `/api/reservations/${reservationId}`)
    const beforeBody = before.data ?? before
    expect(beforeBody.paymentState).toBe('pending')
    expect(Number(beforeBody.pendingAmount)).toBe(TOTAL)

    // ── Ficha de la reserva ──
    // El listado se cargó antes de crear la reserva y el buscador filtra en cliente → recargar.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('reservations-search').fill(guestName)
    const row = page.getByTestId('reservation-row').filter({ hasText: guestName })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()

    const badge = page.getByTestId('payment-state-badge')
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await expect(badge).toHaveText('Pendiente')

    await page.getByTestId('mark-paid-button').click()
    await page.getByTestId('mark-paid-method-transfer').click()

    // (2) Prellenado con el saldo pendiente.
    await expect(page.getByTestId('mark-paid-amount')).toHaveValue(String(TOTAL))

    // (1) Validación: transferencia sin referencia no se puede confirmar.
    const confirmBtn = page.getByTestId('mark-paid-confirm')
    await expect(confirmBtn).toBeDisabled()
    await page.getByTestId('mark-paid-reference').fill(reference)
    await expect(confirmBtn).toBeEnabled()
    await page.getByTestId('mark-paid-note').fill('Booking.com')

    const markPaidResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${reservationId}/mark-paid`) && r.request().method() === 'POST',
    )
    await confirmBtn.click()
    expect((await markPaidResponse).status()).toBe(201)

    // (3) Notificación de éxito.
    await expect(
      page.getByTestId('toast-success').filter({ hasText: 'Pago registrado' }),
    ).toBeVisible({ timeout: 15_000 })

    // (4) Efecto en la ficha: badge "Pagada" + fila del historial con evidencia.
    await expect(badge).toHaveText('Pagada', { timeout: 15_000 })
    const historyRow = page.getByTestId('payment-history-row').filter({ hasText: reference })
    await expect(historyRow).toBeVisible({ timeout: 15_000 })
    await expect(historyRow).toContainText('Transferencia')
    await expect(historyRow).toContainText(`Registró: ${userName}`)

    // (6) Captura de la tarjeta "Importe y Pago" con el historial abierto.
    const history = page.getByTestId('payment-history')
    if (!(await history.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await history.locator('summary').click()
    }
    await history.scrollIntoViewIfNeeded()
    mkdirSync('e2e/.artifacts', { recursive: true })
    await history
      .locator('xpath=ancestor::div[contains(@class,"rm-card")][1]')
      .screenshot({ path: 'e2e/.artifacts/mark-paid-historial.png' })

    // (5) Persistencia por API.
    const after = await apiGet<any>(page, `/api/reservations/${reservationId}`)
    const afterBody = after.data ?? after
    expect(afterBody.status).toBe('confirmed')
    expect(afterBody.paymentState).toBe('paid')
    expect(Number(afterBody.pendingAmount)).toBe(0)

    const paymentsRes = await apiGet<any>(page, '/api/payments?limit=200')
    const payments: any[] = Array.isArray(paymentsRes.data) ? paymentsRes.data : paymentsRes.data?.data ?? []
    const payment = payments.find((p) => p.reservationId === reservationId)
    expect(payment, 'el pago manual debió persistir en /api/payments').toBeTruthy()
    expect(payment.status).toBe('completed')
    expect(payment.method).toBe('transfer')
    expect(payment.reference).toBe(reference)
  })
})
