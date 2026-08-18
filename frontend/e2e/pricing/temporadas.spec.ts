import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_STORAGE_STATE } from '../global-setup'

// E2E del flujo COMPLETO de temporadas, todo por UI (lo que hace el operador de verdad):
//
//   1. GRILLA   — /panel/config/tarifas: en la matriz suite × 2 huéspedes carga ALTA +100%
//                 (= $240) y MEDIA +25% (= $150) sobre el precio base, y GUARDA.
//   2. PLANNING — navega al rango futuro, abre "Asignación de temporadas" y pinta ALTA en
//                 las noches del stay → los headers de esas fechas quedan con temporada.
//   3. RESERVA  — wizard con esas fechas y una suite → "Temporada Alta · 2 noches — $480"
//                 (2 × $240, el precio QUE CARGÓ EN LA GRILLA) → crea y verifica el total.
//   4. REASIGNA — el planning cambia esas fechas a MEDIA → un wizard nuevo cotiza $300.
//
// Solo usa la API para verificaciones discretas (leer lo persistido) y cleanup. La grilla
// UI es percentage-based (+X% sobre el precio base del tipo): ALTA +100% de $120 = $240.

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'
const BASE_SUITE = 120 // precio base sembrado del tipo suite (migrate-db.ts)

// Sesión admin pre-autenticada por globalSetup.
test.use({ storageState: ADMIN_STORAGE_STATE })

function authHeaders(): Record<string, string> {
  const state = JSON.parse(readFileSync(ADMIN_STORAGE_STATE, 'utf-8'))
  const token = state.origins?.flatMap((o: any) => o.localStorage ?? []).find((kv: any) => kv.name === 'token')?.value
  if (!token) throw new Error(`No hay token en ${ADMIN_STORAGE_STATE} — ¿corrió el globalSetup?`)
  return { Authorization: `Bearer ${token}` }
}

/** 2 noches futuras en ventana corta (40-80 días) para que el planning llegue con pocos ▶. */
function randomStay(): { checkIn: string; checkOut: string } {
  const start = 40 + Math.floor(Math.random() * 40)
  const toISO = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
  }
  return { checkIn: toISO(start), checkOut: toISO(start + 2) }
}
const lastNightOf = (stay: { checkOut: string }) =>
  new Date(Date.parse(`${stay.checkOut}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/** Mes abreviado en español (label del planning "4 Oct — 17 Oct, 2026") → número. */
function mes(abr: string): string {
  const map: Record<string, string> = { Ene: '01', Feb: '02', Mar: '03', Abr: '04', May: '05', Jun: '06', Jul: '07', Ago: '08', Sep: '09', Oct: '10', Nov: '11', Dic: '12' }
  return map[abr] ?? '01'
}

/** Grilla: setea el % de una celda (roomType × ocupación × temporada) en la matriz de
 *  /panel/config/tarifas y devuelve la celda (para assert del "= $X" calculado). */
async function setSeasonPercentage(page: Page, roomType: string, occupancy: number, seasonLabel: string, pct: number) {
  // Índice de columna por el th de la temporada (el orden de columnas lo decide el backend).
  const headers = page.locator('table thead th')
  const nCols = await headers.count()
  let colIdx = -1
  for (let i = 0; i < nCols; i++) {
    if ((await headers.nth(i).innerText()).includes(seasonLabel)) { colIdx = i; break }
  }
  expect(colIdx, `columna "${seasonLabel}" en la matriz`).toBeGreaterThan(-1)

  // Fila de ocupación: la primera con "N huésped(es)" tras la separadora del tipo pedido.
  const groupRow = page.locator('tbody tr', { hasText: roomType }).filter({ hasText: 'Precio Base' }).first()
  await expect(groupRow).toBeVisible()
  // El flujo UI real: PRIMERO el "Precio Base $" del tipo (setBasePrice pisa el base de TODAS
  // las temporadas del tipo) y DESPUÉS los % — con base en 0, cualquier % da "=$0".
  await groupRow.locator('label:has-text("Precio Base") input').fill(String(BASE_SUITE))
  const occRow = groupRow.locator(`xpath=following-sibling::tr[contains(., "${occupancy} huésped")][1]`)
  await expect(occRow).toBeVisible()

  const cell = occRow.locator('td').nth(colIdx)
  await cell.locator('input[type=number]').fill(String(pct))
  return cell
}

test('flujo completo por UI: grilla → planning asigna temporada → la reserva cuesta esa temporada', async ({ page, request }) => {
  test.setTimeout(150_000) // 4 pantallas + 2 wizards + navegación del planning: no entra en los 30s default
  const stay = randomStay()

  // ── 1. GRILLA: cargar precios por temporada en la matriz y guardar ──────────────────────
  await page.goto('/panel/config/tarifas')
  await expect(page.getByRole('heading', { name: 'Matriz de Tarifas' })).toBeVisible()

  const cellAlta = await setSeasonPercentage(page, 'suite', 2, 'Temporada Alta', 100)
  await expect(cellAlta.getByText(`= $${BASE_SUITE * 2}`)).toBeVisible() // 120 + 100% = 240
  const cellMedia = await setSeasonPercentage(page, 'suite', 2, 'Temporada Media', 25)
  await expect(cellMedia.getByText(`= $${BASE_SUITE * 1.25}`)).toBeVisible() // 120 + 25% = 150

  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  // Verificación discreta: lo que GUARDÓ la UI es lo que la API lee.
  await expect.poll(async () => {
    const rates = await (await request.get(`${BACKEND}/api/rates`, { headers: authHeaders() })).json()
    const fila = (rates.data ?? []).find((r: any) => r.roomType === 'suite' && r.occupancy === 2 && r.season === 'alta' && !r.channel)
    return fila?.price
  }, { timeout: 15_000 }).toBe(240)

  // ── 2. PLANNING: asignar ALTA a las noches del stay con el diálogo de temporadas ────────
  const rangeLabel = page.locator('text=/\\d{1,2} [A-Z][a-z]{2} — \\d{1,2} [A-Z][a-z]{2}, \\d{4}/').first()
  const navegarHasta = async (fechaISO: string) => {
    for (let i = 0; i < 15; i++) {
      const label = await rangeLabel.innerText()
      const m = label.match(/—\s*(\d{1,2})\s([A-Z][a-z]{2})\s*,\s*(\d{4})/)
      const visibleEnd = m ? Date.parse(`${m[3]}-${mes(m[2])}-${m[1].padStart(2, '0')}T00:00:00Z`) : 0
      if (visibleEnd >= Date.parse(`${fechaISO}T00:00:00Z`)) return
      await page.locator('button', { hasText: '▶' }).first().click()
      await page.waitForTimeout(400)
    }
  }
  await page.goto('/panel/planning')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Planning' })).toBeVisible()
  await navegarHasta(stay.checkIn)

  await page.getByRole('button', { name: 'Temporadas' }).click()
  await expect(page.getByRole('heading', { name: 'Asignación de temporadas' })).toBeVisible()
  const fechasDlg = page.locator('input[type=date]')  // solo existen los del diálogo en esta vista
  await fechasDlg.first().fill(stay.checkIn)
  await fechasDlg.nth(1).fill(lastNightOf(stay))
  await page.getByRole('button', { name: 'Temporada Alta', exact: true }).click()
  // Los headers de esas fechas quedan marcados con la temporada (title del header del día).
  await expect(async () => expect(await page.locator('[title="Temporada: Temporada Alta"]').count()).toBeGreaterThanOrEqual(2)).toPass({ timeout: 10_000 })

  // ── 3. RESERVA: el wizard cotiza lo que cargó la grilla para ESA temporada ──────────────
  await page.goto('/panel/reservas')
  await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible()
  await page.getByTestId('reservations-new-button').click()
  await expect(page.getByTestId('wizard-title')).toHaveText('Nueva Reserva')
  const guest = `E2E Temporada UI ${Date.now()}`

  await page.locator('#wiz-name').fill(guest)
  await page.locator('#wiz-email').fill(`${guest.toLowerCase().replace(/\s+/g, '.')}@example.com`)
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByRole('button', { name: 'Siguiente' }).click() // Detalles (opcional)
  await page.getByRole('button', { name: 'Siguiente' }).click() // Emergencia (opcional)
  await expect(page.getByText('Paso 4 de 5')).toBeVisible()

  const availabilityLoaded = page.waitForResponse((r) =>
    r.url().includes('/api/habitaciones') && r.url().includes(`checkIn=${stay.checkIn}`))
  await page.locator('#wiz-checkin').fill(stay.checkIn)
  await page.locator('#wiz-checkout').fill(stay.checkOut)
  await availabilityLoaded
  const roomSelect = page.getByTestId('wiz-room-select')
  await roomSelect.locator('input').click()
  await roomSelect.locator('input').fill('suite')
  const suiteLibre = page.locator('body > ul li', { hasText: '— suite' }).filter({ hasNotText: 'Ocupada' }).first()
  await expect(suiteLibre, 'suite libre en esas fechas').toBeVisible()
  await suiteLibre.click()

  // EL corazón del test: el precio de la reserva salió de la grilla que cargamos en el paso 1.
  await expect(page.getByText('Temporada Alta · 2 noches')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('$480')).toBeVisible() // 2 × $240 (ALTA +100% por UI)

  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByRole('button', { name: 'Crear Reserva' }).click()
  await expect(page.getByTestId('wizard-title')).not.toBeAttached({ timeout: 15_000 })

  // Verificación discreta del total persistido: alojamiento 480 + impuestos del hotel.
  const tax = await (await request.get(`${BACKEND}/api/facturas/tax-rate`, { headers: authHeaders() })).json()
  const taxPct = Number(tax?.data?.rate ?? 0) || 0
  const rows = ((await (await request.get(`${BACKEND}/api/reservas?limit=50`, { headers: authHeaders() })).json()).data ?? []) as any[]
  const created = rows.find((r) => r.checkIn === stay.checkIn && r.checkOut === stay.checkOut)
  expect(created, 'reserva creada').toBeTruthy()
  expect(Number(created.totalAmount)).toBe(480 + Math.round(480 * taxPct / 100))
  await request.delete(`${BACKEND}/api/reservas/${created.id}`, { headers: authHeaders() }) // cleanup

  // ── 4. REASIGNAR: el planning cambia a MEDIA y un wizard nuevo cotiza $300 ───────────────
  await page.goto('/panel/planning')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Planning' })).toBeVisible()
  await navegarHasta(stay.checkIn)
  await page.getByRole('button', { name: 'Temporadas' }).click()
  await expect(page.getByRole('heading', { name: 'Asignación de temporadas' })).toBeVisible()
  const fechasDlg2 = page.locator('input[type=date]')
  await fechasDlg2.first().fill(stay.checkIn)
  await fechasDlg2.nth(1).fill(lastNightOf(stay))
  await page.getByRole('button', { name: 'Temporada Media', exact: true }).click()
  await expect(async () => expect(await page.locator('[title="Temporada: Temporada Media"]').count()).toBeGreaterThanOrEqual(2)).toPass({ timeout: 10_000 })

  await page.goto('/panel/reservas')
  await page.getByTestId('reservations-new-button').click()
  await page.locator('#wiz-name').fill(`E2E Reasign UI ${Date.now()}`)
  await page.locator('#wiz-email').fill(`e2e.reasign.${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.locator('#wiz-checkin').fill(stay.checkIn)
  await page.locator('#wiz-checkout').fill(stay.checkOut)
  const roomSelect2 = page.getByTestId('wiz-room-select')
  await roomSelect2.locator('input').click()
  await roomSelect2.locator('input').fill('suite')
  await page.locator('body > ul li', { hasText: '— suite' }).filter({ hasNotText: 'Ocupada' }).first().click()
  await expect(page.getByText('Temporada Media · 2 noches')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('$300')).toBeVisible() // 2 × $150 — el precio siguió a la temporada
})
