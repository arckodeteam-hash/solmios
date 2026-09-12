import { mkdirSync, readFileSync } from 'node:fs'
import { request, type APIRequestContext, type Request as PwRequest } from '@playwright/test'
import { test, expect } from '../fixtures'
import { localISO, uniqueGuestName } from '../helpers/reservation-flow'
import { ADMIN_STORAGE_STATE } from '../global-setup'

// Sesión admin pre-autenticada por globalSetup — ver checkout.spec.ts para el detalle del patrón.
test.use({ storageState: ADMIN_STORAGE_STATE })

// REQ-HAC-04 (issue #259) — Check-in exige habitación y la asigna en el MISMO paso.
//
// Una reserva que vendió un TIPO llega hoy sin unidad. En Recepción Digital (/panel/reservas/checkin)
// la fila dice "Sin habitación · {tipo}" y el botón de check-in, en vez del modal de confirmación de
// siempre, abre RoomAssignModal en modo check-in:
//   - lista las habitaciones libres del tipo vendido, con la sugerida preseleccionada (radio);
//   - una `occupied` que no solapa (sale hoy) aparece pero va deshabilitada con su motivo;
//   - "Asignar y hacer check-in" dispara UN solo POST /api/reservas/:id/checkin { roomId } — nada
//     de POST /assign-room previo — y la reserva pasa a "In House" con su número de habitación.
//
// Datos: huésped + reserva por API (checkIn HOY, 1 noche, en una unidad libre cuyo tipo tenga otra
// unidad libre) y des-asignada con DELETE /assign-room; esa otra habitación del tipo se marca
// `occupied` por PUT para que el modal tenga una fila deshabilitada. No se usa el wizard
// (createReservationToday): su waitForResponse de POST /api/reservas atrapa el POST /reservas/quote
// que el wizard dispara al cotizar y devuelve un id vacío. Todo se revierte en afterAll (reserva y
// huésped borrados, statuses restaurados).

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'
const SHOTS = 'test-results/checkin-assign'
const GUEST_PREFIX = 'E2E HAC04'

type Room = { id: string; number: string; type: string; status: string }
type AssignableRoom = { id: string; number: string; status: string; suggested: boolean; typeMismatch: boolean }

let api: APIRequestContext
let hotelId = ''
let reservationId = ''
let guestName = ''
let guestId = ''
let roomType = ''
/** Unidad que el wizard eligió y que se suelta con DELETE /assign-room. */
let originalRoom: Room | null = null
/** Otra del mismo tipo, libre esas noches, marcada `occupied` para que el modal la deshabilite. */
let occupiedRoom: Room | null = null
/** Sin una segunda habitación del tipo vendido, la ocupada sale de otro tipo y se usa el toggle. */
let usedAllTypes = false
let chosenRoomId = ''
let chosenRoomNumber = ''
let folioId = ''
/** Status previo de cada habitación que se toca, para restaurarlo al final. */
const statusToRestore = new Map<string, string>()

function unwrap<T = any>(body: any): T {
  return (body?.data ?? body) as T
}

async function getReservation(id: string): Promise<any> {
  const res = await api.get(`/api/reservas/${id}`)
  expect(res.ok(), `GET /api/reservas/${id} → ${res.status()}`).toBeTruthy()
  return unwrap(await res.json())
}

async function getRoom(id: string): Promise<Room> {
  const res = await api.get(`/api/habitaciones/${id}`)
  expect(res.ok(), `GET /api/habitaciones/${id} → ${res.status()}`).toBeTruthy()
  const r = unwrap(await res.json())
  return { id: String(r.id), number: String(r.number), type: String(r.type), status: String(r.status) }
}

async function listRooms(): Promise<Room[]> {
  const body = await (await api.get('/api/habitaciones?limit=50')).json()
  const raw = unwrap(body)
  return (Array.isArray(raw) ? raw : raw.data ?? []).map((r: any) => ({
    id: String(r.id), number: String(r.number), type: String(r.type), status: String(r.status),
  }))
}

async function listAssignable(id: string, allTypes = false): Promise<AssignableRoom[]> {
  const res = await api.get(`/api/reservas/${id}/assignable-rooms${allTypes ? '?allTypes=1' : ''}`)
  expect(res.ok(), `GET /api/reservas/${id}/assignable-rooms → ${res.status()}`).toBeTruthy()
  const raw = unwrap(await res.json())
  return Array.isArray(raw) ? raw : raw.data ?? []
}

/** Reservas (y huéspedes) de corridas anteriores que fallaron antes del cleanup — mismo criterio
 *  que room-assign.spec.ts: se resuelven por los huéspedes con el prefijo. Best-effort. */
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

async function setRoomStatus(room: Room, status: string) {
  if (!statusToRestore.has(room.id)) statusToRestore.set(room.id, room.status)
  const res = await api.put(`/api/habitaciones/${room.id}`, { data: { status } })
  expect(res.ok(), `PUT /api/habitaciones/${room.id} {status:${status}} → ${res.status()}`).toBeTruthy()
}

test.describe.configure({ mode: 'serial' })

test.describe('REQ-HAC-04 — check-in sin habitación: asigna y hace check-in en un paso', () => {
  test.setTimeout(120_000)

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
    expect(hotelId).toBeTruthy()
    await purgeLeftovers()
  })

  test.afterAll(async () => {
    if (!api) return
    if (reservationId) {
      const res = await api.delete(`/api/reservas/${reservationId}`).catch(() => null)
      if (!res || !res.ok()) console.warn(`[checkin-assign] no se pudo borrar la reserva ${reservationId} (${res?.status()})`)
    }
    if (guestId) await api.delete(`/api/huespedes/${guestId}`).catch(() => {})
    for (const [roomId, status] of statusToRestore) {
      const res = await api.put(`/api/habitaciones/${roomId}`, { data: { status } }).catch(() => null)
      if (!res || !res.ok()) console.warn(`[checkin-assign] no se pudo restaurar la hab. ${roomId} a ${status} (${res?.status()})`)
    }
    await api.dispose()
  })

  test('1. setup: reserva de hoy sin habitación + otra del mismo tipo marcada ocupada', async () => {
    const checkIn = localISO(0)
    const checkOut = localISO(1)

    // Unidad libre para esta noche cuyo TIPO tenga otra unidad libre: la primera es la que vende
    // la reserva (y se suelta), la segunda es la que se marca ocupada.
    const availRaw = unwrap(await (await api.get(`/api/habitaciones?checkIn=${checkIn}&checkOut=${checkOut}`)).json())
    const avail: any[] = (Array.isArray(availRaw) ? availRaw : availRaw.data ?? []).filter((r) => r.available)
    const byType = new Map<string, any[]>()
    for (const r of avail) byType.set(String(r.type), [...(byType.get(String(r.type)) ?? []), r])
    let pair = [...byType.values()].find((list) => list.length >= 2)
    if (!pair) {
      // El hotel demo no tiene dos unidades libres del mismo tipo: la ocupada será de otro tipo y
      // en el modal hay que prender "Ver todos los tipos" para verla.
      usedAllTypes = true
      pair = avail
      console.warn('[checkin-assign] sin dos habitaciones libres del mismo tipo: se usa allTypes')
    }
    expect(pair.length, `deben quedar 2 habitaciones libres para ${checkIn}→${checkOut}`).toBeGreaterThanOrEqual(2)
    originalRoom = await getRoom(String(pair[0].id))
    occupiedRoom = await getRoom(String(pair[1].id))
    roomType = originalRoom.type

    guestName = uniqueGuestName(GUEST_PREFIX)
    const guest = await api.post('/api/huespedes', {
      data: { hotelId, name: guestName, email: `e2e.hac04.${Date.now()}@example.com` },
    })
    expect(guest.status(), 'POST /api/huespedes').toBe(201)
    guestId = unwrap(await guest.json()).id

    // POST /api/reservas todavía exige roomId: se crea en la unidad y enseguida se des-asigna.
    const create = await api.post('/api/reservas', {
      data: { hotelId, roomId: originalRoom.id, guestId, checkIn, checkOut, totalAmount: 200, status: 'confirmed', adults: 2 },
    })
    const createBody = await create.json().catch(() => ({}))
    expect(create.status(), `POST /api/reservas → ${JSON.stringify(createBody)}`).toBe(201)
    reservationId = String(unwrap(createBody).id)
    expect(reservationId).toBeTruthy()

    // DELETE /assign-room: queda sin unidad pero conserva el tipo vendido.
    const unassign = await api.delete(`/api/reservas/${reservationId}/assign-room`)
    expect(unassign.ok(), `DELETE /api/reservas/${reservationId}/assign-room → ${unassign.status()}`).toBeTruthy()
    const after = await getReservation(reservationId)
    expect(after.roomId, 'la reserva debió quedar sin habitación').toBeNull()
    expect(after.roomType).toBe(roomType)

    // La otra del tipo, libre esas noches, pasa a `occupied` (status previo guardado para restaurar).
    const assignable = await listAssignable(reservationId, usedAllTypes)
    expect(assignable.map((r) => r.id), 'la que se marca ocupada debe ser asignable (libre esas noches)').toContain(occupiedRoom.id)
    await setRoomStatus(occupiedRoom, 'occupied')
    expect((await getRoom(occupiedRoom.id)).status).toBe('occupied')
    // La original puede terminar siendo la elegida (pasa a `occupied` con el check-in): se anota.
    statusToRestore.set(originalRoom.id, originalRoom.status)
  })

  test('2. la llegada sin habitación abre RoomAssignModal: sugerida preseleccionada, ocupada deshabilitada', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/panel/reservas/checkin')
    await expect(page.getByRole('heading', { name: 'Llegadas Hoy' })).toBeVisible({ timeout: 15_000 })

    const arrivalRow = page.getByTestId('arrival-row').filter({ hasText: guestName })
    await expect(arrivalRow).toBeVisible({ timeout: 15_000 })
    await expect(arrivalRow.getByTestId('arrival-no-room')).toBeVisible()
    await expect(arrivalRow.getByTestId('arrival-no-room')).toContainText('Sin habitación')

    const assignable = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${reservationId}/assignable-rooms`) && r.status() === 200,
      { timeout: 15_000 },
    )
    await arrivalRow.getByTestId('checkin-arrival-button').click()
    await assignable
    // El modal de confirmación de siempre NO aparece: sin unidad se elige y se hace check-in en uno.
    await expect(page.getByTestId('checkin-modal')).toHaveCount(0)

    const list = page.getByTestId('room-assign-list')
    if (usedAllTypes) {
      const reload = page.waitForResponse(
        (r) => r.url().includes(`/api/reservas/${reservationId}/assignable-rooms`) && r.url().includes('allTypes') && r.status() === 200,
        { timeout: 15_000 },
      )
      await page.getByTestId('room-assign-all-types').check()
      await reload
    }
    await expect(list).toBeVisible({ timeout: 15_000 })

    const rows = list.locator('[data-testid^="room-assign-row-"]')
    const total = await rows.count()
    expect(total, 'el modal debe listar al menos una habitación').toBeGreaterThanOrEqual(1)

    // La ocupada aparece (no solapa) pero deshabilitada, con su motivo.
    const occupiedRow = page.getByTestId(`room-assign-row-${occupiedRoom!.id}`)
    await expect(occupiedRow).toBeVisible()
    await expect(occupiedRow).toContainText(occupiedRoom!.number)
    await expect(occupiedRow.getByTestId('room-assign-disabled-reason')).toBeVisible()
    await expect(page.getByTestId(`room-assign-select-${occupiedRoom!.id}`)).toBeDisabled()

    // Exactamente un radio marcado, habilitado, y es la que el backend sugiere (si sugiere alguna).
    const radios = list.locator('input[type="radio"]')
    const checked = list.locator('input[type="radio"]:checked')
    await expect(checked).toHaveCount(1)
    await expect(checked).toBeEnabled()
    chosenRoomId = String(await checked.getAttribute('value'))
    expect(chosenRoomId).toBeTruthy()
    expect(chosenRoomId).not.toBe(occupiedRoom!.id)
    const chosenRow = page.getByTestId(`room-assign-row-${chosenRoomId}`)
    await expect(chosenRow).toBeVisible()
    chosenRoomNumber = (await chosenRow.locator('span', { hasText: /^Hab\. / }).first().innerText()).replace(/^Hab\.\s*/, '').trim()
    expect(chosenRoomNumber).toBeTruthy()
    // El check-in la pasa a `occupied`: se guarda su status previo para restaurarlo al final.
    if (!statusToRestore.has(chosenRoomId)) statusToRestore.set(chosenRoomId, (await getRoom(chosenRoomId)).status)
    const suggested = (await listAssignable(reservationId, usedAllTypes)).find((r) => r.suggested)
    if (suggested) {
      expect(chosenRoomId, 'la preseleccionada debe ser la sugerida').toBe(suggested.id)
      await expect(chosenRow).toContainText('Sugerida')
    }

    const enabledCount = total - (await list.locator('input[type="radio"]:disabled').count())
    expect(enabledCount, 'debe haber al menos una habitación elegible').toBeGreaterThanOrEqual(1)
    console.info(`[checkin-assign] modal: ${total} filas, ${enabledCount} habilitadas, ${await radios.count() - enabledCount} deshabilitadas (ocupada: ${occupiedRoom!.number}; elegida: ${chosenRoomNumber})`)
    await expect(page.getByTestId('room-assign-checkin-btn')).toBeEnabled()

    await page.screenshot({ path: `${SHOTS}/01-modal-sugerida-y-ocupada.png`, fullPage: true })
  })

  test('3. "Asignar y hacer check-in": un solo POST /checkin { roomId } y la reserva pasa a In House', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const posts: string[] = []
    page.on('request', (req: PwRequest) => { if (req.method() === 'POST') posts.push(req.url()) })

    await page.goto('/panel/reservas/checkin')
    await expect(page.getByRole('heading', { name: 'Llegadas Hoy' })).toBeVisible({ timeout: 15_000 })
    const arrivalRow = page.getByTestId('arrival-row').filter({ hasText: guestName })
    await expect(arrivalRow).toBeVisible({ timeout: 15_000 })

    const assignable = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${reservationId}/assignable-rooms`) && r.status() === 200,
      { timeout: 15_000 },
    )
    await arrivalRow.getByTestId('checkin-arrival-button').click()
    await assignable
    if (usedAllTypes) {
      const reload = page.waitForResponse(
        (r) => r.url().includes(`/api/reservas/${reservationId}/assignable-rooms`) && r.url().includes('allTypes') && r.status() === 200,
        { timeout: 15_000 },
      )
      await page.getByTestId('room-assign-all-types').check()
      await reload
    }
    const list = page.getByTestId('room-assign-list')
    await expect(list).toBeVisible({ timeout: 15_000 })
    // Misma preselección que en el paso anterior (el estado del backend no cambió).
    await expect(page.getByTestId(`room-assign-select-${chosenRoomId}`)).toBeChecked()

    const checkinRequest = page.waitForRequest(
      (r) => r.url().includes(`/api/reservas/${reservationId}/checkin`) && r.method() === 'POST',
      { timeout: 15_000 },
    )
    const checkinResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/reservas/${reservationId}/checkin`) && r.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByTestId('room-assign-checkin-btn').click()

    const req = await checkinRequest
    const body = req.postDataJSON()
    expect(body.roomId, 'el POST /checkin debe llevar la habitación elegida').toBe(chosenRoomId)
    expect(body.allowTypeChange ?? false).toBe(false)
    const res = await checkinResponse
    expect(res.status(), `POST /checkin → ${res.status()} ${await res.text().catch(() => '')}`).toBe(200)
    const resBody = await res.json()
    folioId = resBody.folioId ?? resBody.data?.folioId
    expect(folioId, 'el check-in debió devolver el folioId').toBeTruthy()

    await expect(page.getByTestId('toast-success').filter({ hasText: 'Check-in confirmado' })).toBeVisible({ timeout: 15_000 })
    await expect(list).toHaveCount(0, { timeout: 10_000 })

    // Un solo request de escritura: ningún POST /assign-room por separado.
    expect(posts.filter((u) => u.includes('/assign-room')), 'no debe haber POST /assign-room').toEqual([])
    expect(posts.filter((u) => u.includes(`/api/reservas/${reservationId}/checkin`))).toHaveLength(1)

    // La fila sale de "Llegadas Hoy" y aparece en "In House" con su número de habitación.
    await expect(arrivalRow).toHaveCount(0, { timeout: 15_000 })
    const inHouseRow = page.getByTestId('inhouse-row').filter({ hasText: guestName })
    await expect(inHouseRow).toBeVisible({ timeout: 15_000 })
    await expect(inHouseRow).toContainText(`Hab ${chosenRoomNumber}`)
    await inHouseRow.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/02-in-house.png`, fullPage: true })
  })

  test('4. persistencia: reserva checked_in con la habitación, folio abierto en esa habitación, habitación occupied', async () => {
    const reservation = await getReservation(reservationId)
    expect(reservation.status).toBe('checked_in')
    expect(reservation.roomId).toBe(chosenRoomId)
    expect(reservation.roomAssignedAt).toBeTruthy()

    const folioRes = await api.get(`/api/folios/${folioId}`)
    expect(folioRes.ok(), `GET /api/folios/${folioId} → ${folioRes.status()}`).toBeTruthy()
    const folio = unwrap(await folioRes.json())
    expect(folio.status).toBe('open')
    expect(folio.reservationId).toBe(reservationId)
    expect(folio.roomId).toBe(chosenRoomId)
    expect(folio.chargeCount, 'el check-in debió postear el cargo de la noche').toBeGreaterThanOrEqual(1)

    const room = await getRoom(chosenRoomId)
    expect(room.status).toBe('occupied')
    expect(room.number).toBe(chosenRoomNumber)
  })
})
