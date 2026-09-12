import { mkdirSync, readFileSync } from 'node:fs'
import { request, type APIRequestContext, type Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { ADMIN_STORAGE_STATE } from '../global-setup'

// Sesión admin pre-autenticada por globalSetup — ver checkout.spec.ts para el detalle del patrón.
test.use({ storageState: ADMIN_STORAGE_STATE })

// REQ-HAC-06 (issue #261) — Habitación al check-in: reservas que vendieron un TIPO y todavía no
// tienen unidad asignada.
//
// Lo que un QA humano comprobaría, en orden (serial: cada test parte del estado que dejó el
// anterior):
//   1. Planning — las reservas sin habitación aparecen en la banda "Sin asignar" de su tipo (dos
//      carriles porque dos se solapan) y el encabezado del tipo dice "3 sin asignar".
//   2. Drag a una habitación OCUPADA — el backend rechaza (409 room_overlap), el toast dice
//      "Ocupada por {locator}", la barra sigue en la banda y la reserva sigue sin roomId.
//   3. Drag a una habitación LIBRE del mismo tipo — toast "asignada", la barra sale de la banda,
//      el contador baja a 2 y GET /api/reservas/:id trae el roomId. Sin confirm() (mismo tipo).
//   4. Listado — badge "Sin asignar · Doble" + filtro de estado "Sin asignar"; la asignada
//      muestra su número. Capturas a 1440 y 390.
//   5. Ficha — "Sin asignar" + "Asignar habitación" → RoomAssignModal (sólo las libres del tipo:
//      la 205 sí, la 202 no porque ya la ocupa la reserva del paso 3) → "(asignada el … por …)".
//
// Datos: 3 reservas Doble creadas por API y des-asignadas con DELETE /assign-room. La 102 la
// ocupa res-0002 del seed (confirmed, 13→16/09) y NO se toca. Todo lo creado se borra al final.

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'
const SHOTS = 'test-results/room-assign'
const OCCUPIED_RES_ID = 'res-0002-0000-0000-000000000002'
const GUEST_PREFIX = 'E2E Asig'

// Ventana fija dentro de la semana visible del planning (hoy es 2026-09-12 en la BD de prueba;
// el planning arranca en "hoy" y muestra 14 días). A y B se solapan (→ 2 carriles), C no.
const STAY_AB = { checkIn: '2026-09-13', checkOut: '2026-09-15' }
const STAY_C = { checkIn: '2026-09-16', checkOut: '2026-09-18' }

type Room = { id: string; number: string; type: string }

let api: APIRequestContext
let hotelId = ''
let adminName = ''
let guestId = ''
let rooms: Room[] = []
let room102: Room, room202: Room, room205: Room
let resA = '', resB = '', resC = ''
const createdReservations: string[] = []

function unwrap<T = any>(body: any): T {
  return (body?.data ?? body) as T
}

async function getReservation(id: string): Promise<any> {
  const res = await api.get(`/api/reservas/${id}`)
  expect(res.ok(), `GET /api/reservas/${id} → ${res.status()}`).toBeTruthy()
  return unwrap(await res.json())
}

async function createUnassignedDouble(name: string, roomId: string, stay: { checkIn: string; checkOut: string }): Promise<string> {
  const create = await api.post('/api/reservas', {
    data: { hotelId, roomId, guestId, checkIn: stay.checkIn, checkOut: stay.checkOut, totalAmount: 200, status: 'confirmed', adults: 2 },
  })
  const body = await create.json().catch(() => ({}))
  expect(create.status(), `POST /api/reservas (${name}) → ${JSON.stringify(body)}`).toBe(201)
  const id: string = unwrap(body).id
  createdReservations.push(id)
  const unassign = await api.delete(`/api/reservas/${id}/assign-room`)
  expect(unassign.ok(), `DELETE /api/reservas/${id}/assign-room → ${unassign.status()}`).toBeTruthy()
  const after = await getReservation(id)
  expect(after.roomId, `${name} debió quedar sin habitación`).toBeNull()
  expect(after.roomType).toBe('double')
  return id
}

/** Reservas (y huéspedes) de corridas anteriores que fallaron antes del cleanup: se borran para
 *  que las habitaciones 202/205 estén libres en la ventana. El listado de reservas no trae el
 *  nombre del huésped, así que se resuelve por los huéspedes con el prefijo E2E. Best-effort. */
async function purgeLeftovers() {
  const guestsRes = await api.get('/api/huespedes?limit=500')
  if (!guestsRes.ok()) return
  const guestsRaw = unwrap(await guestsRes.json())
  const guests: any[] = Array.isArray(guestsRaw) ? guestsRaw : guestsRaw?.data ?? []
  const mine = new Set(guests.filter((g) => String(g.name || '').startsWith(GUEST_PREFIX)).map((g) => String(g.id)))
  if (!mine.size) return
  const res = await api.get('/api/reservas?limit=500')
  if (res.ok()) {
    const list: any[] = unwrap(await res.json())
    await Promise.all(list.filter((r) => mine.has(String(r.guestId))).map((r) => api.delete(`/api/reservas/${r.id}`).catch(() => {})))
  }
  await Promise.all([...mine].map((id) => api.delete(`/api/huespedes/${id}`).catch(() => {})))
}

async function gotoPlanning(page: Page) {
  await page.goto('/panel/planning')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Planning' })).toBeVisible({ timeout: 15_000 })
  // La semana visible arranca en "hoy" (12/09): cubre 13→18. Si el rango cambiara, el contador
  // no aparecería — se espera explícitamente para que el fallo diga qué falta.
  await expect(page.locator('[data-testid="unassigned-lane"][data-room-type="double"]').first()).toBeVisible({ timeout: 15_000 })
}

/** Arrastra la barra de la banda `reservationId` hasta la fila de `room` (mismo mecanismo de
 *  mouse que usa el componente: mousedown en la barra, mousemove con pasos, mouseup sobre una
 *  celda [data-rid][data-date] de la habitación destino). */
async function dragBarToRoom(page: Page, reservationId: string, room: Room, dropDate: string) {
  const bar = page.locator(`[data-testid="unassigned-bar"][data-reservation-id="${reservationId}"]`)
  const cell = page.locator(`[data-rid="${room.id}"][data-date="${dropDate}"]`)
  await cell.scrollIntoViewIfNeeded()
  await bar.scrollIntoViewIfNeeded()
  const barBox = await bar.boundingBox()
  const cellBox = await cell.boundingBox()
  expect(barBox, 'la barra de la banda debe estar visible').toBeTruthy()
  expect(cellBox, `la celda de la hab. ${room.number} debe estar visible`).toBeTruthy()
  const from = { x: barBox!.x + Math.min(30, barBox!.width / 2), y: barBox!.y + barBox!.height / 2 }
  const to = { x: cellBox!.x + cellBox!.width / 2, y: cellBox!.y + cellBox!.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 5, from.y + 5, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.mouse.up()
}

test.describe.configure({ mode: 'serial' })

test.describe('RES-HAC-06 — habitación al check-in: banda sin asignar, drag, listado y ficha', () => {
  test.setTimeout(90_000)

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true })
    const state = JSON.parse(readFileSync(ADMIN_STORAGE_STATE, 'utf8'))
    const token: string = state.origins?.[0]?.localStorage?.find((e: any) => e.name === 'token')?.value
    expect(token, 'globalSetup debió dejar el token en el storageState').toBeTruthy()
    api = await request.newContext({
      baseURL: BACKEND,
      extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })

    const me = unwrap(await (await api.get('/api/auth/me')).json())
    hotelId = me.hotelId
    adminName = me.name
    expect(hotelId).toBeTruthy()

    const roomsBody = await (await api.get('/api/habitaciones?limit=50')).json()
    const raw = unwrap(roomsBody)
    rooms = (Array.isArray(raw) ? raw : raw.data ?? []).map((r: any) => ({ id: String(r.id), number: String(r.number), type: String(r.type) }))
    const byNumber = (n: string) => {
      const r = rooms.find((x) => x.number === n)
      expect(r, `el seed debe tener la habitación ${n}`).toBeTruthy()
      return r!
    }
    room102 = byNumber('102'); room202 = byNumber('202'); room205 = byNumber('205')
    for (const r of [room102, room202, room205]) expect(r.type, `la ${r.number} debe ser double`).toBe('double')

    // La 102 tiene que estar ocupada por res-0002 (confirmed 13→16) para el drag a "ocupada".
    const occupied = await getReservation(OCCUPIED_RES_ID)
    expect(occupied.roomId).toBe(room102.id)
    expect(occupied.status).toBe('confirmed')

    await purgeLeftovers()

    const ts = Date.now()
    const guest = await api.post('/api/huespedes', {
      data: { hotelId, name: `${GUEST_PREFIX} ${ts}`, email: `e2e.asig.${ts}@example.com` },
    })
    expect(guest.status(), 'POST /api/huespedes').toBe(201)
    guestId = unwrap(await guest.json()).id

    // POST /api/reservas todavía exige roomId: se crean en una habitación libre del tipo y
    // enseguida se des-asignan (DELETE /assign-room) → quedan con roomType 'double' y sin unidad.
    resA = await createUnassignedDouble('A', room202.id, STAY_AB)
    resB = await createUnassignedDouble('B', room205.id, STAY_AB)
    resC = await createUnassignedDouble('C', room202.id, STAY_C)
  })

  test.afterAll(async () => {
    if (!api) return
    for (const id of createdReservations) {
      const res = await api.delete(`/api/reservas/${id}`).catch(() => null)
      if (!res || !res.ok()) console.warn(`[room-assign] no se pudo borrar la reserva ${id} (${res?.status()})`)
    }
    if (guestId) await api.delete(`/api/huespedes/${guestId}`).catch(() => {})
    await api.dispose()
  })

  test('1. planning: banda "Sin asignar" del tipo Doble con 3 reservas en 2 carriles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await gotoPlanning(page)

    const count = page.locator('[data-testid="unassigned-count"]', { hasText: '3 sin asignar' })
    await expect(count).toBeVisible()
    await expect(count).toHaveText(/^\s*3 sin asignar\s*$/)

    const lanes = page.locator('[data-testid="unassigned-lane"][data-room-type="double"]')
    expect(await lanes.count(), 'A y B se solapan → al menos 2 carriles').toBeGreaterThanOrEqual(2)
    for (const id of [resA, resB, resC]) {
      await expect(page.locator(`[data-testid="unassigned-bar"][data-reservation-id="${id}"]`)).toBeVisible()
    }
    // Ningún carril está fuera del grupo Doble: la banda general (sin tipo) no aparece.
    await expect(page.locator('[data-testid="unassigned-lane"]:not([data-room-type="double"])')).toHaveCount(0)

    await lanes.first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/planning-3-unassigned.png`, fullPage: false })
  })

  test('2. drag a la 102 (ocupada por res-0002): toast "Ocupada por", sigue en la banda y sin roomId', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await gotoPlanning(page)

    const assignCall = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${resA}/assign-room`) && r.request().method() === 'POST',
      { timeout: 15_000 },
    )
    await dragBarToRoom(page, resA, room102, '2026-09-17')
    expect((await assignCall).status()).toBe(409)

    const toast = page.getByTestId('toast-error').filter({ hasText: 'Ocupada por' })
    await expect(toast).toBeVisible({ timeout: 10_000 })
    await expect(toast).toContainText(OCCUPIED_RES_ID)

    const barA = page.locator(`[data-testid="unassigned-bar"][data-reservation-id="${resA}"]`)
    await expect(barA).toBeVisible()
    await expect(page.locator('[data-testid="unassigned-count"]', { hasText: '3 sin asignar' })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/planning-drag-occupied-toast.png`, fullPage: false })

    const a = await getReservation(resA)
    expect(a.roomId).toBeNull()
    const occupied = await getReservation(OCCUPIED_RES_ID)
    expect(occupied.roomId, 'res-0002 no se toca').toBe(room102.id)
  })

  test('3. drag a la 202 (libre, mismo tipo): se asigna sin confirm(), sale de la banda y persiste', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const dialogs: string[] = []
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept() })
    await gotoPlanning(page)

    const assignCall = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${resA}/assign-room`) && r.request().method() === 'POST',
      { timeout: 15_000 },
    )
    await dragBarToRoom(page, resA, room202, '2026-09-14')
    expect((await assignCall).status()).toBe(200)

    await expect(page.getByTestId('toast-success').filter({ hasText: /asignada/ })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('toast-success').filter({ hasText: /asignada/ })).toContainText('202')

    const barA = page.locator(`[data-testid="unassigned-bar"][data-reservation-id="${resA}"]`)
    await expect(barA).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('[data-testid="unassigned-count"]', { hasText: '2 sin asignar' })).toBeVisible()
    for (const id of [resB, resC]) {
      await expect(page.locator(`[data-testid="unassigned-bar"][data-reservation-id="${id}"]`)).toBeVisible()
    }
    // Mismo tipo vendido → no hay confirm() de cambio de tipo.
    expect(dialogs, 'no debió dispararse ningún confirm()').toEqual([])

    const a = await getReservation(resA)
    expect(a.roomId).toBe(room202.id)
    expect(a.roomAssignedAt).toBeTruthy()
    await page.screenshot({ path: `${SHOTS}/planning-after-assign.png`, fullPage: false })
  })

  test('4. listado: badge "Sin asignar · Doble", filtro "Sin asignar" y número de la asignada', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/panel/reservas')
    await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15_000 })

    const rowOf = (id: string) => page.locator(`[data-testid="reservation-row"][data-res-id="${id}"]`)

    // Sin filtro: A ya tiene la 202; B y C siguen con el badge.
    await expect(rowOf(resA)).toBeVisible({ timeout: 15_000 })
    await expect(rowOf(resA)).toContainText('202')
    await expect(rowOf(resA).getByTestId('unassigned-badge')).toHaveCount(0)
    await expect(rowOf(resB).getByTestId('unassigned-badge')).toHaveText(/Sin asignar · Doble/)
    await expect(rowOf(resC).getByTestId('unassigned-badge')).toHaveText(/Sin asignar · Doble/)

    // Filtro de estado "Sin asignar" (local: vigentes sin roomId).
    const filter = page.locator('#reservations-filter-status')
    await expect(filter.locator('option[value="unassigned"]')).toHaveText('Sin asignar')
    await filter.selectOption('unassigned')
    await expect(rowOf(resB)).toBeVisible()
    await expect(rowOf(resC)).toBeVisible()
    await expect(rowOf(resA)).toHaveCount(0)
    const rows = page.getByTestId('reservation-row')
    const n = await rows.count()
    for (let i = 0; i < n; i++) {
      await expect(rows.nth(i).getByTestId('unassigned-badge')).toBeVisible()
    }
    await page.screenshot({ path: `${SHOTS}/list-1440.png`, fullPage: false })

    // Móvil: el badge sigue visible en la columna de habitación.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rowOf(resB).getByTestId('unassigned-badge')).toBeVisible()
    await rowOf(resB).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/list-390.png`, fullPage: false })
  })

  test('5. ficha: "Sin asignar" + Asignar habitación → RoomAssignModal → "(asignada el … por …)"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/panel/reservas')
    await expect(page.getByRole('heading', { name: 'Listado de reservas' })).toBeVisible({ timeout: 15_000 })

    const rowB = page.locator(`[data-testid="reservation-row"][data-res-id="${resB}"]`)
    await expect(rowB).toBeVisible({ timeout: 15_000 })
    await rowB.click()

    const unassigned = page.getByTestId('room-unassigned')
    await expect(unassigned).toBeVisible({ timeout: 15_000 })
    await expect(unassigned).toHaveText(/Sin asignar/)
    await expect(page.getByTestId('room-type-label')).toHaveText('Doble')
    const assignBtn = page.getByTestId('assign-room-btn')
    await expect(assignBtn).toBeVisible()
    await expect(page.getByTestId('change-room-btn')).toHaveCount(0)
    await unassigned.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/modal-unassigned-1440.png`, fullPage: false })

    await page.setViewportSize({ width: 390, height: 844 })
    await unassigned.scrollIntoViewIfNeeded()
    await expect(unassigned).toBeVisible()
    await expect(assignBtn).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/modal-unassigned-390.png`, fullPage: false })
    await page.setViewportSize({ width: 1440, height: 1000 })

    // RoomAssignModal: sólo las Doble libres para 13→15. La 205 sí; la 202 no (A la ocupa);
    // la 102 no (res-0002).
    const assignable = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${resB}/assignable-rooms`) && r.status() === 200,
      { timeout: 15_000 },
    )
    await assignBtn.click()
    await assignable
    const list = page.getByTestId('room-assign-list')
    await expect(list).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId(`room-assign-row-${room205.id}`)).toBeVisible()
    await expect(page.getByTestId(`room-assign-row-${room205.id}`)).toContainText('205')
    await expect(page.getByTestId(`room-assign-row-${room202.id}`)).toHaveCount(0)
    await expect(page.getByTestId(`room-assign-row-${room102.id}`)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/modal-room-assign-list.png`, fullPage: false })

    const assignCall = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${resB}/assign-room`) && r.request().method() === 'POST',
      { timeout: 15_000 },
    )
    await page.getByTestId(`room-assign-btn-${room205.id}`).click()
    expect((await assignCall).status()).toBe(200)

    // La ficha recarga: número, "(asignada el … por {admin})" y botón Cambiar.
    await expect(list).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByTestId('room-number')).toHaveText('205', { timeout: 15_000 })
    const meta = page.getByTestId('room-assigned-meta')
    await expect(meta).toBeVisible({ timeout: 15_000 })
    await expect(meta).toContainText('asignada el')
    await expect(meta).toContainText(`por ${adminName}`)
    await expect(page.getByTestId('change-room-btn')).toBeVisible()
    await expect(page.getByTestId('assign-room-btn')).toHaveCount(0)
    await expect(page.getByTestId('room-unassigned')).toHaveCount(0)
    await meta.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/modal-assigned.png`, fullPage: false })

    const b = await getReservation(resB)
    expect(b.roomId).toBe(room205.id)
    expect(b.roomAssignedAt).toBeTruthy()
    expect(b.roomAssignedBy).toBeTruthy()
  })
})
