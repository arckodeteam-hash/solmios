import { test, expect } from '../fixtures'
import { apiGet, apiPost, freeRoomForStay, localISO, uniqueGuestName } from '../helpers/reservation-flow'
import { ADMIN_STORAGE_STATE } from '../global-setup'

// Sesión admin pre-autenticada por globalSetup — ver checkout.spec.ts para el detalle del patrón.
test.use({ storageState: ADMIN_STORAGE_STATE })

// #246 — Aviso de reserva web/OTA en la campanita.
//
// El backend crea la notificación con metadata.link = '/panel/reservations?open=<reservationId>'.
// Al clickear el aviso, el router redirige /panel/reservations → /panel/reservas conservando la
// query, y la página abre el modal "Ver" de esa reserva. Acá ejercemos el destino del link (no la
// campana en sí, que ya está cubierta por notification-route.test.ts): navegar a la URL que manda
// el backend tiene que dejar el detalle de la reserva a la vista.
//
// La reserva se crea por API (mismo patrón que la reserva B de edit.spec.ts): lo que se prueba es
// el deep-link, no el wizard.

test.describe('#246 — abrir reserva desde la campanita', () => {
  test('/panel/reservations?open=<id> abre el modal Ver de esa reserva', async ({ page }) => {
    // localStorage recién es accesible con una página de la app cargada (no en about:blank).
    await page.goto('/panel/reservas')
    await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible()

    const checkIn = localISO(0)
    const checkOut = localISO(1)
    await freeRoomForStay(page, checkIn, checkOut)
    const roomsRes = await apiGet<any>(page, `/api/habitaciones?checkIn=${checkIn}&checkOut=${checkOut}`)
    const roomsList: any[] = roomsRes.data ?? roomsRes
    const room = roomsList.find((r) => r.available)
    expect(room, `debe haber habitación libre para ${checkIn}→${checkOut}`).toBeTruthy()

    const hotelId = await page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}').hotelId)
    expect(hotelId, 'el admin debe tener hotelId en localStorage').toBeTruthy()

    // Huésped primero (como hace el wizard): sin guestId el detalle muestra "Sin huésped asociado"
    // y no habría nombre con el que confirmar que abrió LA reserva pedida.
    const guestName = uniqueGuestName('E2E Campana')
    const guest = await apiPost<any>(page, '/api/huespedes', {
      hotelId,
      name: guestName,
      email: `e2e.campana.${Date.now()}@example.com`,
    })
    expect(guest.status, 'el huésped debe crearse').toBeLessThan(300)
    const guestId: string = guest.body?.data?.id ?? guest.body?.id
    expect(guestId, 'el POST /api/huespedes debió devolver el id').toBeTruthy()

    const created = await apiPost<any>(page, '/api/reservas', {
      hotelId,
      roomId: room.id,
      guestId,
      guestName,
      checkIn, checkOut,
      adults: 2, children: 0,
      source: 'web', status: 'confirmed',
      totalAmount: 100, paymentMethod: 'cash',
    })
    expect(created.status, 'la reserva debe crearse').toBeLessThan(300)
    const reservationId: string = created.body?.data?.id ?? created.body?.id
    expect(reservationId, 'el POST /api/reservas debió devolver el id').toBeTruthy()

    // Misma URL que arma el backend en metadata.link (ruta vieja + query).
    await page.goto(`/panel/reservations?open=${reservationId}`)

    // La ruta vieja redirige al listado nuevo; la query ?open se consume y se limpia.
    await expect(page).toHaveURL(/\/panel\/reservas/)
    await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible()

    // El modal de detalle carga por id (no depende de que la fila esté en el listado filtrado).
    // `reservation-schedule` siempre se renderiza cuando el detalle terminó de cargar; el nombre del
    // huésped confirma que es LA reserva pedida y no otra.
    await expect(page.getByTestId('reservation-schedule')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(guestName, { exact: false }).first()).toBeVisible()
    await expect(page).not.toHaveURL(/open=/)

    // Evidencia visual. El modal entra con un fade de 200ms: sin la pausa la captura sale a medias.
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/open-from-notification.png', fullPage: false })
  })
})
