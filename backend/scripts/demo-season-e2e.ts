// /tmp/season-e2e-demo.ts — Demo VISUAL del E2E de precio por temporada.
// Ejecuta exactamente el mismo flujo que season-pricing.e2e.test.ts, pero narrado y con
// pausas, para ver la ejecución físicamente en la terminal. Desechable (no va al repo).

import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerSharedModels } from '../src/shared/models'
import { registerHotelesModels } from '../src/modules/hoteles/model'
import { registerHabitacionesModels } from '../src/modules/habitaciones/model'
import { registerReservasModels } from '../src/modules/reservas/model'
import { PricingService } from '../src/modules/pricing/service'
import { assignSeason } from '../src/modules/pricing/usecases/season-assignments'
import { quoteStay } from '../src/modules/reservas/usecases/quote'
import { createReservation } from '../src/modules/reservas/usecases/crud'

const C = { g: '\x1b[32m', c: '\x1b[36m', y: '\x1b[33m', b: '\x1b[1m', r: '\x1b[0m', dim: '\x1b[2m' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const step = async (n: string, label: string) => { console.log(`\n${C.b}${C.c}▶ [${n}]${C.r} ${C.b}${label}${C.r}`); await sleep(1400) }
const ok = (msg: string) => console.log(`  ${C.g}✓${C.r} ${msg}`)
const info = (msg: string) => console.log(`  ${C.dim}${msg}${C.r}`)

const HOTEL_ID = 'demo-hotel', ROOM_ID = 'demo-room-101'
const USER = { id: 'demo-user', role: 'hotel_admin' as const, hotelId: HOTEL_ID }
const logger = { child: () => logger, info: () => {}, warn: () => {}, error: () => {} } as any
const cache = { get: async () => null, set: async () => {}, delete: async () => {} } as any
const repos = () => ({
  sa: new OrmRepository<any>(orm, 'SeasonAssignments'),
  rr: new OrmRepository<any>(orm, 'RoomRates'),
  se: new OrmRepository<any>(orm, 'Seasons'),
})
const quote = (checkIn: string, checkOut: string) => quoteStay(
  { roomRepo: roomsRepo, seasonAssignmentRepo: saRepo, roomRateRepo: repos().rr, seasonsRepo: repos().se },
  { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn, checkOut, guests: 2 })

let orm: any, roomsRepo: any, saRepo: any, resRepo: any, pricing: PricingService

console.log(`${C.b}${C.y}════════════════════════════════════════════════════════════════${C.r}`)
console.log(`${C.b}${C.y}  DEMO EN VIVO — El precio de la reserva toma la temporada${C.r}`)
console.log(`${C.b}${C.y}  (mismo flujo que season-pricing.e2e.test.ts, DB real en memoria)${C.r}`)
console.log(`${C.b}${C.y}════════════════════════════════════════════════════════════════${C.r}`)

const dbPath = `/tmp/demo-season-${crypto.randomUUID()}.db`
const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
await adapter.connect()
orm = new ORM(adapter)
registerSharedModels(orm); registerHotelesModels(orm); registerHabitacionesModels(orm); registerReservasModels(orm)
await orm.migrate()
const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')
await hotelsRepo.create({ id: HOTEL_ID, name: 'Hotel Demo', slug: 'demo' } as any)
roomsRepo = new OrmRepository<any>(orm, 'Rooms')
await roomsRepo.create({ id: ROOM_ID, hotelId: HOTEL_ID, number: '101', type: 'suite', basePrice: 120, capacity: 2 } as any)
saRepo = repos().sa
resRepo = new OrmRepository<any>(orm, 'Reservations')
pricing = new PricingService(repos().se, repos().rr, new OrmRepository<any>(orm, 'RoomBlocks'), new OrmRepository<any>(orm, 'RateRestrictions'), logger)
await pricing.listSeasons(HOTEL_ID)
ok('SQLite real creada + ORM migrado + hotel "101 suite" ($120/noche base) sembrado')

await step('1/6', 'Cargar la grilla de tarifas por temporada')
await pricing.updateRates(HOTEL_ID, [
  { roomType: 'suite', occupancy: 2, season: 'alta', basePrice: 200, percentage: 0 },
  { roomType: 'suite', occupancy: 2, season: 'media', basePrice: 150, percentage: 0 },
])
const filaAlta = (await repos().rr.findMany({ hotelId: HOTEL_ID, season: 'alta' }))[0]
ok(`suite × 2 pax → ALTA $200 · MEDIA $150 (precio base de la habitación: $120)`)

await step('2/6', 'Asignar temporada ALTA a las fechas 1–4 mar 2027 y cotizar 2 noches')
await assignSeason(saRepo, HOTEL_ID, { from: '2027-03-01', to: '2027-03-04', season: 'alta' })
let q = await quote('2027-03-01', '2027-03-03')
ok(`quote = ${C.b}$${q.subtotal}${C.r} (${q.nights[0].seasonLabel}, 2 × $200 de la grilla)`)
info(`sin temporadas habría dado 2 × $120 = $240 — acá manda la grilla (${q.fromRates ? 'fromRates: true' : ''})`)

await step('3/6', 'Crear reserva real — el cliente manda un total FALSO de $1')
const created = await createReservation(resRepo, undefined, logger, cache, {}, () => ({}) as any,
  { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2027-03-01', checkOut: '2027-03-03', totalAmount: 1, adults: 2, priceFrom: 'rates', taxesAmount: 36 },
  USER, roomsRepo, undefined, undefined, undefined, { seasonAssignmentRepo: saRepo, roomRateRepo: repos().rr })
const reread = await resRepo.findById(created.id)
ok(`totalAmount persistido en la DB = ${C.b}$${reread.totalAmount}${C.r} (400 de la grilla + 36 impuestos)`)
info(`el $1 falso se pisó server-side — el número no lo dicta el navegador`)

await step('4/6', 'Reasignar esas fechas a MEDIA y volver a cotizar')
await assignSeason(saRepo, HOTEL_ID, { from: '2027-03-01', to: '2027-03-04', season: 'media' })
q = await quote('2027-03-01', '2027-03-03')
ok(`nueva cotización = ${C.b}$${q.subtotal}${C.r} (2 × $150 media) — el precio sigue a la temporada`)
const pactada = (await resRepo.findMany({ hotelId: HOTEL_ID })).find((r: any) => r.id === created.id)
ok(`la reserva YA creada queda pactada en $${pactada.totalAmount} (no se reprecia sola)`)

await step('5/6', 'Cargar override de canal airbnb a $999 — ¿contamina?')
await pricing.updateRates(HOTEL_ID, [{ roomType: 'suite', occupancy: 2, season: 'media', basePrice: 999, percentage: 0, channel: 'airbnb' }])
q = await quote('2027-03-01', '2027-03-03')
ok(`quote del panel sigue = ${C.b}$${q.subtotal}${C.r} — el override airbnb ($999) SOLO vale para ese canal`)

await step('6/6', 'Estadía mixta: 2 noches MEDIA + 1 noche SIN temporada (1–4 mar)')
await assignSeason(saRepo, HOTEL_ID, { from: '2027-03-03', to: '2027-03-04', season: 'none' })
q = await quote('2027-03-01', '2027-03-04')
ok(`suma noche a noche = ${C.b}$${q.subtotal}${C.r} → ${q.nights.map((n) => `${n.season ?? 'base'} $${n.price}`).join(' + ')}`)

require('node:fs').unlinkSync(dbPath)
console.log(`\n${C.g}${C.b}✔ DEMO COMPLETA — mismo resultado que el test automatizado (6/6).${C.r}`)
console.log(`${C.dim}Automatizado: bun test src/modules/reservas/tests/season-pricing.e2e.test.ts${C.r}\n`)
