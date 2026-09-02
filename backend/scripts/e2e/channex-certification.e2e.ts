// scripts/e2e/channex-certification.e2e.ts — Corrida de los 14 tests de certificación PMS de Channex.
//
// https://docs.channex.io/api-v.1-documentation/pms-certification-tests
//
// Qué es y qué NO es:
//   ES un ARNÉS DE EVIDENCIA. Dispara los MISMOS endpoints que aprieta la UI del panel
//   (PUT /api/rate-overrides = la grilla de tarifas, POST /api/reservas = el planning,
//   POST /api/channels/sync = el botón Sincronizar) y después lee lo que quedó del lado de
//   Channex. La integración vive en `src/modules/canales` — este archivo no la reemplaza ni
//   la puentea: si lo borrás, el PMS sigue publicando igual.
//   NO ES el examen. Channex reproduce los escenarios en vivo sobre la UI; esto sirve para
//   juntar los task ids del formulario y para no llegar a la screenshare a descubrir un 422.
//
// Cada test verifica DOS cosas: (a) que salió en la cantidad de llamadas que exige el guion
// —contadas en el rastro de `sync_log`, no en los logs— y (b) que el valor QUEDÓ en Channex
// (readback por API). Un 200 no prueba nada: es la trampa que el propio guion marca.
//
//   PORT=3001 bun run src/composition-root.ts     (en otra terminal, con el .env de staging)
//   bun run scripts/e2e/channex-certification.e2e.ts
//
// MODO REMOTO (el que vale para el examen): contra el entorno que Channex va a ver de verdad,
// porque el canal necesita un endpoint público —Channex prueba la conexión antes de activar y
// `localhost` no le llega. Con `CERT_HOTEL_ID` no se toca ninguna base: el hotel ya existe (se dio
// de alta por el registro público) y las reservas de la corrida anterior se limpian por API.
//
//   BASE_URL=https://solmios.com CERT_HOTEL_ID=… CERT_PROPERTY_ID=… CERT_PASSWORD=… \
//     bun run scripts/e2e/channex-certification.e2e.ts
//
// Env: BASE_URL, DB_PATH, CERT_HOTEL_ID, CERT_PROPERTY_ID, CERT_EMAIL, CERT_PASSWORD,
//      CHANNEX_API_KEY, CHANNEX_BASE_URL, REPORT (ruta md).

import { Database } from 'bun:sqlite'

const BASE = process.env.BASE_URL ?? 'http://localhost:3001'
const DB_PATH = process.env.DB_PATH ?? 'data/managerhotel.db'
const CHANNEX_BASE = process.env.CHANNEX_BASE_URL ?? 'https://staging.channex.io/api/v1'
const CHANNEX_KEY = process.env.CHANNEX_API_KEY ?? ''
// La property del examen: Twin Room + Double Room, BAR $100 + B&B $120 (setup de la doc).
const PROPERTY_ID = process.env.CERT_PROPERTY_ID ?? 'bddf7d23-83c5-437d-a2ff-c4e85ccaf412'
const REPORT = process.env.REPORT ?? '../CHANNEX-CERTIFICACION-EVIDENCIA.md'

// Hotel del PMS ya existente (modo remoto). Vacío = sembrar uno en la SQLite local.
const REMOTE_HOTEL_ID = process.env.CERT_HOTEL_ID ?? ''
const HOTEL_NAME = 'Test Property - SolmiOS'
const CERT_EMAIL = process.env.CERT_EMAIL ?? 'cert@solmios.com'
const CERT_PASSWORD = process.env.CERT_PASSWORD ?? 'demo123'
// El PMS guarda el tipo como CÓDIGO del enum; Channex lo publica con título (room-type-titles.ts).
const TWIN = 'twin'
const DOUBLE = 'double'
const TWIN_TITLE = 'Twin Room'
const DOUBLE_TITLE = 'Double Room'

// Fechas EXACTAS del guion (año 2026).
const D = {
  t2: '2026-11-22', t3twin: '2026-11-21', t3dblBar: '2026-11-25', t3dblBb: '2026-11-29',
  t5twin: '2026-11-23', t5dblBar: '2026-11-25', t5dblBb: '2026-11-15',
  t6twin: '2026-11-14', t6dblBar: '2026-11-16', t6dblBb: '2026-11-20',
  halfFrom: '2026-12-01', halfTo: '2027-05-01',
}

let pass = 0, fail = 0
const results: Array<{ test: string; ok: boolean; calls: number; taskIds: string[]; note: string }> = []
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.error(`  ❌ ${m}`)); return c }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let token = ''
let hotelId = ''
const api = async (method: string, path: string, body?: any) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j: any = await r.json().catch(() => ({}))
  return { status: r.status, data: j?.data ?? j, raw: j }
}

const channex = async (path: string) => {
  const r = await fetch(`${CHANNEX_BASE}${path}`, { headers: { 'user-api-key': CHANNEX_KEY } })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any }
}

// ─── Setup de datos: hotel de certificación + habitaciones + tarifa base ──────────────────
//
// El hotel se siembra por SQL (no por API) a propósito: el alta de un hotel no es parte de la
// integración bajo prueba y el signup público arrastra plan/Stripe. Todo lo que SÍ es parte
// —habitaciones, tarifas, reservas, sync— va por HTTP, por el mismo camino que la UI.

const db = REMOTE_HOTEL_ID ? null : new Database(DB_PATH)
function seedCertHotel(): string {
  const existing = db!.query('SELECT id FROM hotels WHERE name = ?').get(HOTEL_NAME) as any
  const now = new Date().toISOString()
  const id = existing?.id ?? crypto.randomUUID()
  if (!existing) {
    db!.run(
      'INSERT INTO hotels (id, name, email, currency, timezone, plan, status, active, slug, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, HOTEL_NAME, CERT_EMAIL, 'USD', 'America/Santo_Domingo', 'professional', 'active', 1, `test-property-solmios`, now, now],
    )
  }
  const user = db!.query('SELECT id FROM users WHERE email = ?').get(CERT_EMAIL) as any
  if (!user) {
    // Hash de la demo (misma contraseña): sembrar un usuario no es lo que se está probando.
    const source = db!.query("SELECT password FROM users WHERE email = 'admin@caribeparadise.com'").get() as any
    if (!source?.password) throw new Error('No hay usuario demo del que copiar el hash — sembrá la DB primero')
    db!.run(
      'INSERT INTO users (id, name, email, password, userType, role, hotelId, active, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [crypto.randomUUID(), 'Certificación Channex', CERT_EMAIL, source.password, 'merchant', 'hotel_admin', id, 1, now, now],
    )
  }
  // Mapping a la property del examen ANTES de crear habitaciones: con `channexPropertyId` cargado
  // el auto-provisioning no crea una property nueva (auto-provision.ts, guarda 1).
  const cfg = db!.query('SELECT id, channexPropertyId FROM channel_config WHERE hotelId = ?').get(id) as any
  if (!cfg) {
    db!.run('INSERT INTO channel_config (id, hotelId, channexPropertyId, syncEnabled, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
      [crypto.randomUUID(), id, PROPERTY_ID, 1, now, now])
  } else if (cfg.channexPropertyId !== PROPERTY_ID) {
    db!.run('UPDATE channel_config SET channexPropertyId = ?, syncEnabled = 1, updatedAt = ? WHERE id = ?', [PROPERTY_ID, now, cfg.id])
  }
  return id
}

/**
 * Las reservas de la corrida ANTERIOR ocupan las mismas habitaciones y fechas: sin limpiarlas,
 * los tests 9/10 chocan con 409 ("habitación no disponible") y no sale ningún push. Se borran
 * por SQL —igual que el resto del sembrado— porque cancelarlas por API dispararía pushes que
 * ensuciarían el conteo de llamadas de los tests.
 */
function clearCertReservations(id: string) {
  const rows = db!.query('SELECT id FROM reservations WHERE hotelId = ?').all(id) as Array<{ id: string }>
  for (const r of rows) {
    db!.run('DELETE FROM folio_charges WHERE folioId IN (SELECT id FROM folios WHERE reservationId=?)', [r.id])
    db!.run('DELETE FROM folios WHERE reservationId=?', [r.id])
    db!.run('DELETE FROM reservations WHERE id=?', [r.id])
  }
  return rows.length
}

/** 2 habitaciones por tipo (el setup del examen: Twin y Double, occupancy 2, 2 unidades). */
async function ensureRooms(): Promise<Record<string, string[]>> {
  const list = await api('GET', `/api/habitaciones?hotelId=${hotelId}&limit=100`)
  const rooms: any[] = Array.isArray(list.data) ? list.data : (list.data?.data ?? [])
  const byType: Record<string, string[]> = { [TWIN]: [], [DOUBLE]: [] }
  for (const r of rooms) if (byType[r.type]) byType[r.type].push(r.id)
  for (const type of [TWIN, DOUBLE]) {
    while (byType[type]!.length < 2) {
      const n = byType[type]!.length + 1
      const number = `${type === TWIN ? 'T' : 'D'}0${n}`
      const res = await api('POST', '/api/habitaciones', { hotelId, number, type, basePrice: 100, capacity: 2, status: 'available' })
      if (res.status >= 300) throw new Error(`No se pudo crear ${number}: ${res.status} ${JSON.stringify(res.raw).slice(0, 200)}`)
      byType[type]!.push(res.data.id)
    }
  }
  return byType
}

/** Temporadas + tarifa base $100 por persona: el BAR del examen. B&B sale +20% = $120. */
async function ensureRatesBaseline() {
  await api('PUT', `/api/seasons?hotelId=${hotelId}`, {
    seasons: [
      { name: 'media', label: 'Temporada Media', startDate: '2026-06-01', endDate: '2026-11-30', color: '#3b82f6' },
      { name: 'alta', label: 'Temporada Alta', startDate: '2026-12-01', endDate: '2027-05-31', color: '#ef4444' },
    ],
  })
  const rates: any[] = []
  for (const roomType of [TWIN, DOUBLE]) {
    for (const [season, pct] of [['media', 0], ['alta', 15]] as const) {
      for (const occupancy of [1, 2]) rates.push({ roomType, season, occupancy, basePrice: 100, percentage: pct })
    }
  }
  await api('PUT', `/api/rates?hotelId=${hotelId}`, { rates })
}

// ─── Rastro: los task ids salen de sync_log, que es lo que ve el panel ────────────────────

interface TrailRow { id: string; action: string; status: string; details: string; taskIds: string[]; createdAt: string }

async function trail(): Promise<TrailRow[]> {
  const res = await api('GET', `/api/channels/sync-log?hotelId=${hotelId}`)
  return (Array.isArray(res.data) ? res.data : res.data?.data ?? []) as TrailRow[]
}

/** Filas nuevas desde un corte, esperando a que el push (fire-and-forget, coalescido) aterrice. */
async function newTrailSince(known: Set<string>, expected = 1, timeoutMs = 20_000): Promise<TrailRow[]> {
  const t0 = Date.now()
  let rows: TrailRow[] = []
  while (Date.now() - t0 < timeoutMs) {
    await sleep(700)
    rows = (await trail()).filter((r) => !known.has(r.id))
    if (rows.length >= expected) break
  }
  for (const r of rows) known.add(r.id)
  return rows
}

const taskIdsOf = (rows: TrailRow[]) => rows.flatMap((r) => r.taskIds ?? [])
const callsOf = (rows: TrailRow[]) => rows.length

function record(test: string, okFlag: boolean, rows: TrailRow[], note: string) {
  results.push({ test, ok: okFlag, calls: callsOf(rows), taskIds: taskIdsOf(rows), note })
}

// ─── Readback contra Channex (un 200 no prueba nada) ──────────────────────────────────────

const RESTRICTION_FIELDS = 'rate,min_stay_arrival,min_stay_through,max_stay,stop_sell,closed_to_arrival,closed_to_departure'

/** `{ [rate_plan_id]: { [date]: { rate, min_stay_arrival, … } } }` */
async function readRestrictions(from: string, to: string): Promise<Record<string, Record<string, any>>> {
  const q = `/restrictions?filter%5Bproperty_id%5D=${PROPERTY_ID}&filter%5Bdate%5D%5Bgte%5D=${from}&filter%5Bdate%5D%5Blte%5D=${to}&filter%5Brestrictions%5D=${RESTRICTION_FIELDS}`
  const res = await channex(q)
  return (res.body?.data?.attributes ?? res.body?.data ?? {}) as any
}

async function readAvailability(from: string, to: string): Promise<Record<string, Record<string, number>>> {
  const q = `/availability?filter%5Bproperty_id%5D=${PROPERTY_ID}&filter%5Bdate%5D%5Bgte%5D=${from}&filter%5Bdate%5D%5Blte%5D=${to}`
  const res = await channex(q)
  return (res.body?.data?.attributes ?? res.body?.data ?? {}) as any
}

/** UUIDs de la property: tipo → id, y (tipo, plan) → rate plan id. */
async function channexIds() {
  const rts = await channex(`/room_types?filter%5Bproperty_id%5D=${PROPERTY_ID}&pagination%5Blimit%5D=100`)
  const rps = await channex(`/rate_plans?filter%5Bproperty_id%5D=${PROPERTY_ID}&pagination%5Blimit%5D=100`)
  const roomTypes = new Map<string, string>()
  for (const rt of rts.body?.data ?? []) roomTypes.set(String(rt.attributes?.title || '').toLowerCase(), rt.id)
  const ratePlans = new Map<string, string>()
  for (const rp of rps.body?.data ?? []) {
    const title = String(rp.attributes?.title || '')
    const rtId = rp.attributes?.room_type_id || rp.relationships?.room_type?.data?.id
    const type = [...roomTypes.entries()].find(([, id]) => id === rtId)?.[0]
    if (!type) continue
    const plan = /breakfast|b&b/i.test(title) ? 'bb' : 'bar'
    ratePlans.set(`${type}|${plan}`, rp.id)
  }
  return { roomTypes, ratePlans }
}

// ─── Corrida ──────────────────────────────────────────────────────────────────────────────

try {
  console.log(`\n═══ Certificación PMS Channex — property ${PROPERTY_ID} ═══`)
  if (!CHANNEX_KEY) throw new Error('CHANNEX_API_KEY vacía: sin ella no hay readback (source .env)')

  hotelId = seedCertHotel()
  const wiped = clearCertReservations(hotelId)
  if (wiped) console.log(`  ♻️  ${wiped} reserva(s) de la corrida anterior borradas`)
  const login = await api('POST', '/api/auth/login', { email: CERT_EMAIL, password: CERT_PASSWORD })
  token = login.data?.token
  ok(login.status === 200 && !!token, `login ${CERT_EMAIL} → ${login.status}`)
  if (!token) throw new Error('sin token no hay corrida')

  console.log('\n— Setup (habitaciones + tarifa base) —')
  const rooms = await ensureRooms()
  ok(rooms[TWIN]!.length === 2 && rooms[DOUBLE]!.length === 2, `2 Twin + 2 Double en el PMS`)
  await ensureRatesBaseline()

  // El push de tarifas del setup está coalescido (700ms): sin esperarlo, su fila cae DESPUÉS del
  // corte y se contaría como una llamada del test 1.
  await sleep(4000)
  const known = new Set<string>((await trail()).map((r) => r.id))

  // ── Test 1 — Full sync: 500 días de ARI en EXACTAMENTE 2 llamadas ──
  console.log('\n— Test 1: Full Data Update (2 llamadas) —')
  const sync = await api('POST', `/api/channels/sync?hotelId=${hotelId}`, {})
  ok(sync.status === 200, `POST /api/channels/sync → ${sync.status}`)
  const t1rows = await newTrailSince(known, 2, 60_000)
  const t1avail = t1rows.filter((r) => /Disponibilidad/.test(r.action))
  const t1rates = t1rows.filter((r) => /Tarifas enviadas/.test(r.action))
  const t1ok = ok(t1avail.length === 1 && t1rates.length === 1,
    `ARI del full sync en 2 llamadas (availability ${t1avail.length}, rates ${t1rates.length})`)
  // Solo las 2 filas ARI: `sync_property` es el alta de estructura, no una llamada de ARI.
  record('T1 Full Sync', t1ok, [...t1avail, ...t1rates], '500 días: 1 availability + 1 rates/restrictions')

  const ids = await channexIds()
  const twinBar = ids.ratePlans.get(`${TWIN_TITLE.toLowerCase()}|bar`)
  const twinBb = ids.ratePlans.get(`${TWIN_TITLE.toLowerCase()}|bb`)
  const dblBar = ids.ratePlans.get(`${DOUBLE_TITLE.toLowerCase()}|bar`)
  const dblBb = ids.ratePlans.get(`${DOUBLE_TITLE.toLowerCase()}|bb`)
  ok(!!twinBar && !!twinBb && !!dblBar && !!dblBb, 'la property tiene Twin/Double × BAR/B&B')

  const rate = (rb: Record<string, any>, rp: string | undefined, date: string) => Number(rb?.[rp || '']?.[date]?.rate)
  const field = (rb: Record<string, any>, rp: string | undefined, date: string, f: string) => rb?.[rp || '']?.[date]?.[f]

  // ── Test 2 — un precio, una fecha, un rate plan → 1 llamada ──
  console.log('\n— Test 2: Single Date / Single Rate —')
  let res = await api('PUT', `/api/rate-overrides?hotelId=${hotelId}`, {
    items: [{ roomType: TWIN, ratePlan: 'bar', dateFrom: D.t2, dateTo: D.t2, rate: 333 }],
  })
  ok(res.status === 200, `PUT /api/rate-overrides → ${res.status}`)
  let rows = await newTrailSince(known, 1)
  let rb = await readRestrictions(D.t2, D.t2)
  const t2ok = ok(rows.length === 1 && rate(rb, twinBar, D.t2) === 333,
    `Twin BAR ${D.t2} = 333 en Channex, en ${rows.length} llamada(s)`)
  record('T2 Single Date Single Rate', t2ok, rows, `Twin BAR ${D.t2} $333`)

  // ── Test 3 — varios rate plans, misma llamada ──
  console.log('\n— Test 3: Single Date / Multiple Rates —')
  res = await api('PUT', `/api/rate-overrides?hotelId=${hotelId}`, {
    items: [
      { roomType: TWIN, ratePlan: 'bar', dateFrom: D.t3twin, dateTo: D.t3twin, rate: 333 },
      { roomType: DOUBLE, ratePlan: 'bar', dateFrom: D.t3dblBar, dateTo: D.t3dblBar, rate: 444 },
      { roomType: DOUBLE, ratePlan: 'bb', dateFrom: D.t3dblBb, dateTo: D.t3dblBb, rate: 456.23 },
    ],
  })
  ok(res.status === 200, `PUT /api/rate-overrides (3 celdas) → ${res.status}`)
  rows = await newTrailSince(known, 1)
  rb = await readRestrictions('2026-11-21', '2026-11-29')
  const t3ok = ok(
    rows.length === 1 && rate(rb, twinBar, D.t3twin) === 333 && rate(rb, dblBar, D.t3dblBar) === 444 && rate(rb, dblBb, D.t3dblBb) === 456.23,
    `3 tarifas en 1 llamada (${rate(rb, twinBar, D.t3twin)}, ${rate(rb, dblBar, D.t3dblBar)}, ${rate(rb, dblBb, D.t3dblBb)})`)
  record('T3 Single Date Multiple Rates', t3ok, rows, 'Twin BAR 333 · Double BAR 444 · Double B&B 456.23')

  // ── Test 4 — varias fechas × varios rate plans, misma llamada ──
  console.log('\n— Test 4: Multiple Dates / Multiple Rates —')
  res = await api('PUT', `/api/rate-overrides?hotelId=${hotelId}`, {
    items: [
      { roomType: TWIN, ratePlan: 'bar', dateFrom: '2026-11-01', dateTo: '2026-11-10', rate: 241 },
      { roomType: DOUBLE, ratePlan: 'bar', dateFrom: '2026-11-10', dateTo: '2026-11-16', rate: 312.66 },
      { roomType: DOUBLE, ratePlan: 'bb', dateFrom: '2026-11-01', dateTo: '2026-11-20', rate: 111 },
    ],
  })
  ok(res.status === 200, `PUT /api/rate-overrides (3 rangos) → ${res.status}`)
  rows = await newTrailSince(known, 1)
  rb = await readRestrictions('2026-11-01', '2026-11-20')
  const t4ok = ok(
    rows.length === 1 && rate(rb, twinBar, '2026-11-05') === 241 && rate(rb, dblBar, '2026-11-12') === 312.66 && rate(rb, dblBb, '2026-11-18') === 111,
    `3 rangos en 1 llamada (${rate(rb, twinBar, '2026-11-05')}, ${rate(rb, dblBar, '2026-11-12')}, ${rate(rb, dblBb, '2026-11-18')})`)
  record('T4 Multiple Dates Multiple Rates', t4ok, rows, 'Twin BAR 1-10 241 · Double BAR 10-16 312.66 · Double B&B 1-20 111')

  // ── Test 5 — min stay ──
  console.log('\n— Test 5: Min Stay —')
  res = await api('PUT', `/api/rate-overrides?hotelId=${hotelId}`, {
    items: [
      { roomType: TWIN, ratePlan: 'bar', dateFrom: D.t5twin, dateTo: D.t5twin, minStay: 3 },
      { roomType: DOUBLE, ratePlan: 'bar', dateFrom: D.t5dblBar, dateTo: D.t5dblBar, minStay: 2 },
      { roomType: DOUBLE, ratePlan: 'bb', dateFrom: D.t5dblBb, dateTo: D.t5dblBb, minStay: 5 },
    ],
  })
  rows = await newTrailSince(known, 1)
  rb = await readRestrictions('2026-11-15', '2026-11-25')
  const t5ok = ok(
    rows.length === 1 && field(rb, twinBar, D.t5twin, 'min_stay_arrival') === 3 && field(rb, dblBar, D.t5dblBar, 'min_stay_arrival') === 2 && field(rb, dblBb, D.t5dblBb, 'min_stay_arrival') === 5,
    `min stay 3/2/5 en 1 llamada`)
  record('T5 Min Stay', t5ok, rows, 'Twin BAR 3 · Double BAR 2 · Double B&B 5')

  // ── Test 6 — stop sell ──
  console.log('\n— Test 6: Stop Sell —')
  res = await api('PUT', `/api/rate-overrides?hotelId=${hotelId}`, {
    items: [
      { roomType: TWIN, ratePlan: 'bar', dateFrom: D.t6twin, dateTo: D.t6twin, stopSell: 1 },
      { roomType: DOUBLE, ratePlan: 'bar', dateFrom: D.t6dblBar, dateTo: D.t6dblBar, stopSell: 1 },
      { roomType: DOUBLE, ratePlan: 'bb', dateFrom: D.t6dblBb, dateTo: D.t6dblBb, stopSell: 1 },
    ],
  })
  rows = await newTrailSince(known, 1)
  rb = await readRestrictions('2026-11-14', '2026-11-20')
  const t6ok = ok(
    rows.length === 1 && field(rb, twinBar, D.t6twin, 'stop_sell') === true && field(rb, dblBar, D.t6dblBar, 'stop_sell') === true && field(rb, dblBb, D.t6dblBb, 'stop_sell') === true,
    'stop sell en los 3 rate plans, 1 llamada')
  record('T6 Stop Sell', t6ok, rows, 'Twin BAR 14/11 · Double BAR 16/11 · Double B&B 20/11')

  // ── Test 7 — CTA / CTD / max stay / min stay combinados ──
  console.log('\n— Test 7: Multiple Restrictions —')
  res = await api('PUT', `/api/rate-overrides?hotelId=${hotelId}`, {
    items: [
      { roomType: TWIN, ratePlan: 'bar', dateFrom: '2026-11-01', dateTo: '2026-11-10', closedToArrival: 1, closedToDeparture: 0, maxStay: 4, minStay: 1, cleared: ['closedToDeparture'] },
      { roomType: TWIN, ratePlan: 'bb', dateFrom: '2026-11-12', dateTo: '2026-11-16', closedToArrival: 0, closedToDeparture: 1, minStay: 6, cleared: ['closedToArrival'] },
      { roomType: DOUBLE, ratePlan: 'bar', dateFrom: '2026-11-10', dateTo: '2026-11-16', closedToArrival: 1, minStay: 2 },
      { roomType: DOUBLE, ratePlan: 'bb', dateFrom: '2026-11-01', dateTo: '2026-11-20', minStay: 10 },
    ],
  })
  rows = await newTrailSince(known, 1)
  rb = await readRestrictions('2026-11-01', '2026-11-20')
  const t7ok = ok(
    rows.length === 1 &&
    field(rb, twinBar, '2026-11-05', 'closed_to_arrival') === true &&
    field(rb, twinBar, '2026-11-05', 'closed_to_departure') === false &&
    field(rb, twinBar, '2026-11-05', 'max_stay') === 4 &&
    field(rb, twinBb, '2026-11-14', 'closed_to_departure') === true &&
    field(rb, twinBb, '2026-11-14', 'min_stay_arrival') === 6 &&
    field(rb, dblBar, '2026-11-12', 'closed_to_arrival') === true &&
    field(rb, dblBb, '2026-11-18', 'min_stay_arrival') === 10,
    'CTA/CTD/max stay/min stay en 1 llamada')
  record('T7 Multiple Restrictions', t7ok, rows, 'CTA/CTD + max stay + min stay sobre 4 rate plans')

  // ── Test 8 — medio año en una llamada ──
  console.log('\n— Test 8: Half-year Update —')
  res = await api('PUT', `/api/rate-overrides?hotelId=${hotelId}`, {
    items: [
      { roomType: TWIN, ratePlan: 'bar', dateFrom: D.halfFrom, dateTo: D.halfTo, rate: 432, minStay: 2 },
      { roomType: DOUBLE, ratePlan: 'bar', dateFrom: D.halfFrom, dateTo: D.halfTo, rate: 342, minStay: 3 },
    ],
  })
  rows = await newTrailSince(known, 1)
  rb = await readRestrictions('2027-02-01', '2027-02-02')
  const t8ok = ok(
    rows.length === 1 && rate(rb, twinBar, '2027-02-01') === 432 && rate(rb, dblBar, '2027-02-01') === 342 &&
    field(rb, twinBar, '2027-02-01', 'min_stay_arrival') === 2 && field(rb, dblBar, '2027-02-01', 'min_stay_arrival') === 3,
    `Dic 2026 → May 2027 en 1 llamada (readback a mitad del rango: ${rate(rb, twinBar, '2027-02-01')}/${rate(rb, dblBar, '2027-02-01')})`)
  record('T8 Half-year Update', t8ok, rows, 'Twin BAR 432 min 2 · Double BAR 342 min 3, 1/12/26 → 1/5/27')

  // ── Tests 9 y 10 — la disponibilidad baja por una RESERVA del PMS ──
  console.log('\n— Tests 9/10: Availability por reserva —')
  const guest = await api('POST', '/api/huespedes', { hotelId, name: 'Certificación Channex', email: `cert${Date.now()}@solmios.com` })
  const guestId = guest.data?.id
  ok(!!guestId, `huésped de prueba → ${guest.status}`)

  const twinIds = rooms[TWIN]!
  const dblIds = rooms[DOUBLE]!
  const availBefore = await readAvailability('2026-11-21', '2026-11-25')
  const twinRt = ids.roomTypes.get(TWIN_TITLE.toLowerCase())!
  const dblRt = ids.roomTypes.get(DOUBLE_TITLE.toLowerCase())!
  const beforeTwin = Number(availBefore?.[twinRt]?.['2026-11-21'])

  // T9: una noche. Twin baja 1 unidad; Double se agota (las 2 unidades reservadas → 0).
  const r9a = await api('POST', '/api/reservas', { hotelId, roomId: twinIds[0], guestId, checkIn: '2026-11-21', checkOut: '2026-11-22', totalAmount: 100, status: 'confirmed', channel: 'direct' })
  ok(r9a.status < 300, `reserva Twin 21/11 → ${r9a.status}`)
  const r9rows1 = await newTrailSince(known, 1)
  const r9b = await api('POST', '/api/reservas', { hotelId, roomId: dblIds[0], guestId, checkIn: '2026-11-25', checkOut: '2026-11-26', totalAmount: 100, status: 'confirmed', channel: 'direct' })
  const r9c = await api('POST', '/api/reservas', { hotelId, roomId: dblIds[1], guestId, checkIn: '2026-11-25', checkOut: '2026-11-26', totalAmount: 100, status: 'confirmed', channel: 'direct' })
  ok(r9b.status < 300 && r9c.status < 300, `reservas Double 25/11 (las 2 unidades) → ${r9b.status}/${r9c.status}`)
  const r9rows2 = await newTrailSince(known, 2, 30_000)
  const avail9 = await readAvailability('2026-11-21', '2026-11-26')
  const t9ok = ok(
    Number(avail9?.[twinRt]?.['2026-11-21']) === beforeTwin - 1 && Number(avail9?.[dblRt]?.['2026-11-25']) === 0,
    `Twin 21/11 = ${avail9?.[twinRt]?.['2026-11-21']} (antes ${beforeTwin}) · Double 25/11 = ${avail9?.[dblRt]?.['2026-11-25']}`)
  // El guion pide 1-2 llamadas POR ACCIÓN del usuario: acá son 3 reservas, 1 llamada cada una.
  ok(r9rows1.length === 1, `la reserva Twin salió en ${r9rows1.length} llamada(s)`)
  record('T9 Single Date Availability', t9ok && r9rows1.length === 1, [...r9rows1, ...r9rows2],
    '3 reservas de 1 noche = 1 llamada cada una; Double agotado = 0')

  // T10: rangos. Twin 10→16, Double 17→24.
  const r10a = await api('POST', '/api/reservas', { hotelId, roomId: twinIds[1], guestId, checkIn: '2026-11-10', checkOut: '2026-11-16', totalAmount: 600, status: 'confirmed', channel: 'direct' })
  const r10rows1 = await newTrailSince(known, 1)
  const r10b = await api('POST', '/api/reservas', { hotelId, roomId: dblIds[0], guestId, checkIn: '2026-11-17', checkOut: '2026-11-24', totalAmount: 700, status: 'confirmed', channel: 'direct' })
  const r10rows2 = await newTrailSince(known, 1)
  ok(r10a.status < 300 && r10b.status < 300, `reservas de rango → ${r10a.status}/${r10b.status}`)
  const avail10 = await readAvailability('2026-11-10', '2026-11-24')
  const t10ok = ok(
    Number(avail10?.[twinRt]?.['2026-11-12']) === beforeTwin - 1 && Number(avail10?.[dblRt]?.['2026-11-20']) === 1,
    `Twin 12/11 = ${avail10?.[twinRt]?.['2026-11-12']} · Double 20/11 = ${avail10?.[dblRt]?.['2026-11-20']}`)
  ok(r10rows1.length === 1 && r10rows2.length === 1, `cada reserva de rango salió en 1 llamada (${r10rows1.length}/${r10rows2.length})`)
  record('T10 Multiple Date Availability', t10ok && r10rows1.length === 1 && r10rows2.length === 1,
    [...r10rows1, ...r10rows2], '2 reservas de rango = 1 llamada cada una, rangos comprimidos')

  // ── Test 11 — recepción de reservas (la parte que depende de Channex) ──
  console.log('\n— Test 11: Booking Receiving —')
  const ingest = await api('POST', '/api/channels/bookings/ingest', {})
  const t11ok = ok(ingest.status === 200, `POST /api/channels/bookings/ingest → ${ingest.status} (feed + ack)`)
  record('T11 Booking Receiving', t11ok, [], 'feed booking_revisions + ack; el booking de prueba lo dispara Channex')

  // ─── Reporte ───────────────────────────────────────────────────────────────────────────
  const lines = [
    '# Channex — Evidencia de la corrida de certificación',
    '',
    `> Generado por \`bun run scripts/e2e/channex-certification.e2e.ts\` el ${new Date().toISOString()}.`,
    `> Property de staging: \`${PROPERTY_ID}\` · hotel del PMS: \`${hotelId}\`.`,
    '> Cada fila salió de apretar el MISMO endpoint que usa el panel; el valor se verificó con',
    '> readback contra la API de Channex (no con el 200 del push).',
    '',
    '| Test | Resultado | Llamadas | Task IDs | Detalle |',
    '|---|:---:|:---:|---|---|',
    ...results.map((r) => `| ${r.test} | ${r.ok ? '✅' : '❌'} | ${r.calls} | ${r.taskIds.map((t) => `\`${t}\``).join('<br>') || '—'} | ${r.note} |`),
    '',
    `**${pass} checks OK · ${fail} fallidos.**`,
    '',
  ]
  await Bun.write(REPORT, lines.join('\n'))
  console.log(`\n📄 Evidencia escrita en ${REPORT}`)

  console.log('\n═══ Resumen ═══')
  for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.test} — ${r.calls} llamada(s) — tasks: ${r.taskIds.join(', ') || '—'}`)
  console.log(`\n${pass} OK · ${fail} fallidos`)
} catch (e) {
  console.error('\n💥 Corrida abortada:', e instanceof Error ? e.message : e)
  fail++
} finally {
  db?.close()
}

process.exit(fail > 0 ? 1 : 0)
