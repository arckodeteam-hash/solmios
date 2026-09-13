import { test, expect } from '../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'
import { readFileSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from '../booking-children-capacity/helpers'

// #361 — Catálogo ABIERTO de regímenes + switch `showMealPlans` (Página pública → Motor de reservas).
//
//   (a) switch apagado  → el widget público NO renderiza nada de régimen (ni título ni radios).
//   (b) switch prendido → un radio por habitación con los NOMBRES del catálogo, sólo los activos:
//       "Desayuno incluido" (activo) aparece, "Desayuno y cena" (desactivado) no.
//   (c) un régimen nuevo creado por API ("Pensión gourmet", 7 por persona y noche) aparece con su
//       nombre y su importe (7 × personas × noches); elegirlo cambia el importe de la tarjeta y
//       elegir otro lo REEMPLAZA (una tarjeta = un régimen, nunca se acumulan).
//
// Sin correo ni Stripe: sólo la API admin (siembra/undo) y el paso de habitaciones del widget.
// Serial: los tres tests comparten el fixture (switch, filas del catálogo) y el orden importa.
//
// ── Cómo correrlo (backend aislado, ver USE_CASES.md → RES-17) ─────────────────────────────
//   E2E_PORT=5174 E2E_BACKEND_URL=http://localhost:3011 \
//     bunx playwright test e2e/reservations/meal-plans-switch.spec.ts --project=chromium
//
// Todo vuelve a su valor anterior al final (undo registrado ANTES de cada mutación, deshecho en
// orden inverso aunque la siembra falle a mitad): `showMealPlans`, la fila `breakfast`, la fila
// `half_board` y el régimen creado (se borra por nombre, único por corrida).

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'

const RUN = Date.now().toString(36)
const NIGHTS = 2
const ROOM_TYPE_NAME = 'Double'
/** Seeds de #361 (`DEFAULT_MEAL_PLANS`, backend/src/modules/bookingengine/usecases/meal-plans-crud.ts). */
const BREAKFAST = { code: 'breakfast', name: 'Desayuno incluido', price: 5 }
const HALF_BOARD = { code: 'half_board', name: 'Desayuno y cena' }
/** Régimen nuevo, con sufijo único por corrida por si el cleanup no llega. */
const GOURMET = { name: `Pensión gourmet ${RUN}`, price: 7 }
/** Composición por defecto de la tarjeta: 1 adulto (useGuestComposer.ts). */
const PERSONS = 1

// ─── helpers (mismos que public-booking-circuit.spec.ts) ─────────────────────────────────────

function authHeaders(): Record<string, string> {
  const state = JSON.parse(readFileSync(ADMIN_STORAGE_STATE, 'utf-8'))
  const entries: Array<{ name: string; value: string }> = state.origins?.flatMap((o: any) => o.localStorage ?? []) ?? []
  const jwt = entries.find((kv) => kv.name === 'token')?.value
  if (!jwt) throw new Error(`No hay token en ${ADMIN_STORAGE_STATE} — ¿corrió el globalSetup?`)
  return { Authorization: `Bearer ${jwt}` }
}

/** Desenvuelve `{success,data}` (y el doble envelope `{data:{data}}` de algunos controllers). */
function unwrap(body: any): any {
  const d = body?.data ?? body
  return d && typeof d === 'object' && 'data' in d && !Array.isArray(d) ? d.data : d
}

async function adminGet(request: APIRequestContext, path: string): Promise<any> {
  const res = await request.get(`${BACKEND}${path}`, { headers: authHeaders() })
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy()
  return unwrap(await res.json())
}

/** 2 noches en una ventana lejana (2028): fechas propias por corrida, sin chocar con reservas de
 *  otras corridas (la disponibilidad pública cachea 60 s). */
function randomFutureStay(): { checkIn: string; checkOut: string } {
  const start = Date.UTC(2028, 2, 1) + Math.floor(Math.random() * 365) * 86_400_000
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { checkIn: iso(start), checkOut: iso(start + NIGHTS * 86_400_000) }
}

/** Importe formateado como lo pinta el widget (`formatPrice`): `14.00` / `14,00`. */
const money = (n: number) => new RegExp(n.toFixed(2).replace('.', '[.,]'))

// ─── candado de `booking_config` entre archivos (mismo que public-booking-circuit.spec.ts) ───
// Los dos specs pisan la MISMA config del hotel (`showMealPlans`) y Playwright corre los archivos
// en workers paralelos (`fullyParallel`): sin candado, el circuito enciende el switch mientras
// acá se asegura que está apagado. Directorio creado con `mkdirSync` (atómico: EEXIST si ya está
// tomado) en e2e/.auth (gitignored, lo crea global-setup). Un candado viejo (worker muerto) se
// descarta por antigüedad.
const CONFIG_LOCK = 'e2e/.auth/booking-config.lock'
const CONFIG_LOCK_STALE_MS = 15 * 60_000

async function acquireConfigLock(owner: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      mkdirSync(CONFIG_LOCK)
      writeFileSync(`${CONFIG_LOCK}/owner`, owner)
      return
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    let stale = false
    try { stale = Date.now() - statSync(CONFIG_LOCK).mtimeMs > CONFIG_LOCK_STALE_MS } catch { /* lo soltaron entre medio */ }
    if (stale) { rmSync(CONFIG_LOCK, { recursive: true, force: true }); continue }
    if (Date.now() > deadline) throw new Error(`${owner}: el candado ${CONFIG_LOCK} sigue tomado después de ${Math.round(timeoutMs / 1000)}s`)
    await new Promise((r) => setTimeout(r, 2_000))
  }
}

function releaseConfigLock(): void {
  rmSync(CONFIG_LOCK, { recursive: true, force: true })
}

// ─── fixture por API admin ───────────────────────────────────────────────────────────────────

interface Fixture {
  undo: Array<[name: string, run: (request: APIRequestContext) => Promise<unknown>]>
}

/** Snapshot editable de una fila del catálogo (lo que acepta `PUT /api/meal-plans/:id`). */
function planSnapshot(row: any) {
  return {
    name: String(row.name ?? ''), active: !!row.active,
    priceMode: row.priceMode ?? 'included', price: Number(row.price) || 0,
  }
}

async function setShowMealPlans(request: APIRequestContext, fx: Fixture, on: boolean): Promise<void> {
  const headers = authHeaders()
  const config = await adminGet(request, '/api/booking-engine/config')
  const prev = { enabled: !!config.enabled, language: String(config.language ?? 'es'), showMealPlans: !!config.showMealPlans }
  fx.undo.push(['booking_config', (r) => r.put(`${BACKEND}/api/booking-engine/config`, { headers, data: prev })])
  const res = await request.put(`${BACKEND}/api/booking-engine/config`, {
    headers, data: { enabled: true, language: 'es', showMealPlans: on },
  })
  expect(res.ok(), `seed booking_config.showMealPlans=${on}`).toBeTruthy()
}

/** Pisa una fila del catálogo por `code` (con undo del snapshot previo). Falla si no existe. */
async function patchPlan(request: APIRequestContext, fx: Fixture, code: string, patch: Record<string, unknown>): Promise<any> {
  const headers = authHeaders()
  const rows = ((await adminGet(request, '/api/meal-plans')) ?? []) as any[]
  const row = rows.find((p) => p.code === code)
  expect(row, `el catálogo debe traer la fila '${code}' (seed de #361)`).toBeTruthy()
  const prev = planSnapshot(row)
  fx.undo.push([`meal plan ${code}`, (r) => r.put(`${BACKEND}/api/meal-plans/${row.id}`, { headers, data: prev })])
  const res = await request.put(`${BACKEND}/api/meal-plans/${row.id}`, { headers, data: patch })
  expect(res.ok(), `PUT /api/meal-plans/${row.id} (${code}): ${await res.text()}`).toBeTruthy()
  return unwrap(await res.json())
}

/** Deshace en orden inverso, best-effort (cada paso independiente). */
async function cleanupFixture(request: APIRequestContext, fx: Fixture): Promise<void> {
  for (const [name, run] of fx.undo.reverse()) {
    try { await run(request) } catch (e) { console.log(`cleanup ${name} falló:`, (e as Error).message) }
  }
  fx.undo = []
}

// ─── widget ──────────────────────────────────────────────────────────────────────────────────

/** Abre /book/:slug con fechas, busca, y devuelve la tarjeta "Double" ya visible. */
async function openRoomsStep(page: Page) {
  await gotoWizardWithDates(page, randomFutureStay())
  const card = roomCard(page, ROOM_TYPE_NAME)
  await expect(card).toBeVisible({ timeout: 15_000 })
  return card
}

// ─── el spec ─────────────────────────────────────────────────────────────────────────────────

test.describe.serial('#361 — switch showMealPlans + catálogo abierto en el motor público', () => {
  const fixture: Fixture = { undo: [] }
  let errors: string[] = []

  test.beforeAll(async ({ request }) => {
    // El candado puede estar en manos del circuito completo (~8 min con correos reales).
    test.setTimeout(900_000)
    await acquireConfigLock('meal-plans-switch', 840_000)
    // Punto de partida: switch APAGADO, "Desayuno incluido" activo con costo, "Desayuno y cena"
    // desactivado. El precio del desayuno (5) permite ver que cambiar de régimen REEMPLAZA el
    // importe (14 → 10) y no sólo lo apaga.
    await setShowMealPlans(request, fixture, false)
    await patchPlan(request, fixture, BREAKFAST.code, { name: BREAKFAST.name, active: true, priceMode: 'per_person_per_night', price: BREAKFAST.price })
    await patchPlan(request, fixture, HALF_BOARD.code, { name: HALF_BOARD.name, active: false })
  })

  test.afterAll(async ({ request }) => {
    try {
      await cleanupFixture(request, fixture)
    } finally {
      releaseConfigLock()
    }
  })

  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('(a) switch apagado → el widget no muestra nada de régimen', async ({ page, request }) => {
    // La API pública ya lo dice: catálogo vacío.
    const pub = await request.get(`${BACKEND}/api/public/hotels/hotel-boutique-palma/meal-plans`)
    expect(pub.status()).toBe(200)
    expect(unwrap(await pub.json())).toEqual([])

    const card = await openRoomsStep(page)
    // La tarjeta terminó de cotizar (importe de la composición) — y aun así no hay régimen.
    await expect(card.getByRole('button', { name: 'Agregar esta habitación' })).toBeEnabled({ timeout: 15_000 })
    await expect(page.getByTestId('meal-plan-options')).toHaveCount(0)
    await expect(page.getByTestId('meal-plan-option')).toHaveCount(0)
    await expect(page.getByText('Régimen', { exact: true })).toHaveCount(0)
    await expect(page.getByText(BREAKFAST.name)).toHaveCount(0)
  })

  test('(b) switch prendido → sólo los activos, con el nombre del catálogo', async ({ page, request }) => {
    await setShowMealPlans(request, fixture, true)

    const pub = unwrap(await (await request.get(`${BACKEND}/api/public/hotels/hotel-boutique-palma/meal-plans`)).json()) as any[]
    expect(pub.map((p) => p.code)).toContain(BREAKFAST.code)
    expect(pub.map((p) => p.code)).not.toContain(HALF_BOARD.code)
    expect(pub.find((p) => p.code === BREAKFAST.code)?.name).toBe(BREAKFAST.name)

    const card = await openRoomsStep(page)
    await expect(card.getByTestId('meal-plan-options')).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText('Régimen', { exact: true })).toBeVisible()
    const breakfast = card.getByTestId('meal-plan-option').filter({ hasText: BREAKFAST.name })
    await expect(breakfast).toHaveCount(1)
    await expect(breakfast.getByTestId('meal-plan-price')).toContainText(money(BREAKFAST.price * PERSONS * NIGHTS))
    await expect(card.getByTestId('meal-plan-option').filter({ hasText: HALF_BOARD.name })).toHaveCount(0)
    await expect(page.getByText(HALF_BOARD.name)).toHaveCount(0)
  })

  test('(c) un régimen nuevo aparece con nombre y precio; elegirlo cambia el importe y otro lo reemplaza', async ({ page, request }) => {
    const headers = authHeaders()
    // Undo ANTES del alta, por nombre (único por corrida): si el POST creó la fila pero la
    // respuesta no se pudo leer, igual se borra.
    fixture.undo.push(['meal plan gourmet', async (r) => {
      const rows = (unwrap(await (await r.get(`${BACKEND}/api/meal-plans`, { headers })).json()) ?? []) as any[]
      for (const p of rows.filter((p) => p.name === GOURMET.name)) await r.delete(`${BACKEND}/api/meal-plans/${p.id}`, { headers })
    }])
    const created = await request.post(`${BACKEND}/api/meal-plans`, {
      headers, data: { name: GOURMET.name, price: GOURMET.price, active: true },
    })
    expect(created.status(), await created.text()).toBe(201)
    const gourmetRow = unwrap(await created.json())
    expect(gourmetRow.priceMode, 'con precio > 0 el modo se deriva a por persona y noche').toBe('per_person_per_night')
    expect(gourmetRow.code).toBeTruthy()

    const card = await openRoomsStep(page)
    const options = card.getByTestId('meal-plan-options')
    await expect(options).toBeVisible({ timeout: 15_000 })
    const gourmet = card.getByTestId('meal-plan-option').filter({ hasText: GOURMET.name })
    const breakfast = card.getByTestId('meal-plan-option').filter({ hasText: BREAKFAST.name })
    await expect(gourmet).toHaveCount(1)
    const gourmetTotal = GOURMET.price * PERSONS * NIGHTS // 7 × 1 × 2 = 14
    const breakfastTotal = BREAKFAST.price * PERSONS * NIGHTS // 5 × 1 × 2 = 10
    await expect(gourmet.getByTestId('meal-plan-price')).toContainText(money(gourmetTotal))

    // Elegir el nuevo: el importe del régimen de la tarjeta pasa a ser el suyo.
    await gourmet.click()
    await expect(gourmet).toHaveClass(/bg-navy/)
    await expect(card.getByTestId('meal-plan-total')).toContainText(money(gourmetTotal))
    await expect(card.getByTestId('meal-plan-total')).toContainText(GOURMET.name)
    await expect(card.getByTestId('meal-plan-hint')).toContainText(money(GOURMET.price))

    // Elegir otro REEMPLAZA el importe (no se suma al anterior).
    await breakfast.click()
    await expect(breakfast).toHaveClass(/bg-navy/)
    await expect(gourmet).not.toHaveClass(/bg-navy/)
    await expect(card.getByTestId('meal-plan-total')).toContainText(money(breakfastTotal))
    await expect(card.getByTestId('meal-plan-total')).not.toContainText(money(gourmetTotal))
    await expect(card.getByTestId('meal-plan-total')).not.toContainText(money(gourmetTotal + breakfastTotal))
    await expect(card.getByTestId('meal-plan-total')).toContainText(BREAKFAST.name)

    // …y de vuelta al nuevo, por si el primer click sólo pareció funcionar por ser el primero.
    await gourmet.click()
    await expect(card.getByTestId('meal-plan-total')).toContainText(money(gourmetTotal))
    await expect(card.getByTestId('meal-plan-total')).not.toContainText(money(breakfastTotal))
  })
})
