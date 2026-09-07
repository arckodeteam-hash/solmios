// reservas/tests/season-pricing.e2e.test.ts — E2E DE CADENA del precio por temporada.
//
// A diferencia de quote.test.ts (unit: funciones puras con repos fake), acá el flujo corre
// sobre una SQLite REAL con el ORM real de arckode y los services/usecases REALES del módulo
// pricing + reservas — las mismas piezas que atiende el server en producción, sin HTTP ni
// browser. Es la automatización de lo que se verificó a mano contra la app corriendo:
//
//   cargar grilla (updateRates) → asignar temporada a fechas (assignSeason)
//     → cotizar (quoteStay) → crear reserva (createReservation, priceFrom:'rates')
//     → el total persistido sale de la grilla, NO del cliente
//     → reasignar temporada cambia el quote de NUEVAS reservas pero no el precio pactado
//     → override de canal no contamina el precio base
//     → estadía mixta (temporada + noches sin asignar) suma noche a noche
//
// Corre con `bun test` (CI incluido): cero pasos manuales. Si alguna conexión de la cadena
// se rompe (modelo sin campo declarado, fórmula cambiada, fallback roto), este test lo grita.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerSharedModels } from '../../../shared/models'
import { registerHotelesModels } from '../../hoteles/model'
import { registerHabitacionesModels } from '../../habitaciones/model'
import { registerReservasModels } from '../model'
import { PricingService } from '../../pricing/service'
import { assignSeason } from '../../pricing/usecases/season-assignments'
import { quoteStay } from '../usecases/quote'
import { createReservation } from '../usecases/crud'

const HOTEL_ID = 'e2e-hotel-1'
const ROOM_ID = 'e2e-room-1'
const USER = { id: 'e2e-user-1', role: 'hotel_admin' as const, hotelId: HOTEL_ID }

const logger = { child: () => logger, info: () => {}, warn: () => {}, error: () => {} } as any
const cache = { get: async () => null, set: async () => {}, delete: async () => {} } as any
const notifyDeps = () => ({}) as any

let orm: any
let dbPath: string
let pricing: PricingService
let reservationsRepo: any
let roomsRepo: any
let seasonAssignmentsRepo: any

beforeAll(async () => {
  dbPath = `/tmp/solmios-season-e2e-${crypto.randomUUID()}.db`
  const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  registerSharedModels(orm)
  registerHotelesModels(orm)
  registerHabitacionesModels(orm)
  registerReservasModels(orm)
  await orm.migrate()

  roomsRepo = new OrmRepository<any>(orm, 'Rooms')
  const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')
  await hotelsRepo.create({ id: HOTEL_ID, name: 'E2E Hotel', slug: 'e2e-hotel' } as any)
  await roomsRepo.create({ id: ROOM_ID, hotelId: HOTEL_ID, number: '101', type: 'suite', basePrice: 120, capacity: 2 } as any)

  seasonAssignmentsRepo = new OrmRepository<any>(orm, 'SeasonAssignments')
  const ratesRepo = new OrmRepository<any>(orm, 'RoomRates')
  const seasonsRepo = new OrmRepository<any>(orm, 'Seasons')
  const blocksRepo = new OrmRepository<any>(orm, 'RoomBlocks')
  const restrictionsRepo = new OrmRepository<any>(orm, 'RateRestrictions')
  reservationsRepo = new OrmRepository<any>(orm, 'Reservations')
  pricing = new PricingService(seasonsRepo, ratesRepo, blocksRepo, restrictionsRepo, logger)
  // Siembra el catálogo default (baja/media/alta/especial con labels) — mismo efecto que la
  // 1ª visita a Ajustes › Tarifas en la app real.
  await pricing.listSeasons(HOTEL_ID)
})

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('E2E de cadena — precio por temporada de punta a punta (DB real)', () => {
  it('1. cargar la grilla por temporada persiste el precio efectivo', async () => {
    const saved = await pricing.updateRates(HOTEL_ID, [
      { roomType: 'suite', occupancy: 2, season: 'alta', basePrice: 200, percentage: 0 },
      { roomType: 'suite', occupancy: 2, season: 'media', basePrice: 150, percentage: 0 },
    ])
    expect(saved).toBe(2)
    const rates = await ratesOf('alta')
    expect(rates.price).toBe(200) // price precalculado por el service, verificado en DB
  })

  it('2. asignar temporada a fechas + cotizar → precio de la grilla, no el base', async () => {
    await assignSeason(seasonAssignmentsRepo, HOTEL_ID, { from: '2027-03-01', to: '2027-03-04', season: 'alta' })
    const q = await quoteStay(
      { roomRepo: roomsRepo, seasonAssignmentRepo: seasonAssignmentsRepo, roomRateRepo: ratesRepoAny(), seasonsRepo: seasonsAny() },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2027-03-01', checkOut: '2027-03-03', guests: 2 },
    )
    expect(q.subtotal).toBe(400) // 2 × $200 (grilla alta) — NO 2 × $120 (base)
    expect(q.fromRates).toBe(true)
    expect(q.nights[0].seasonLabel).toBe('Temporada Alta') // label del catálogo sembrado por listSeasons
  })

  it('3. crear reserva con priceFrom=rates persiste el total de la grilla (server-side)', async () => {
    const created = await createReservation(
      reservationsRepo, undefined, logger, cache, {}, notifyDeps,
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2027-03-01', checkOut: '2027-03-03', totalAmount: 1, adults: 2, priceFrom: 'rates', taxesAmount: 36 },
      USER, roomsRepo, undefined, undefined, undefined,
      { seasonAssignmentRepo: seasonAssignmentsRepo, roomRateRepo: ratesRepoAny() },
    )
    expect(created.totalAmount).toBe(436) // 400 grilla + 36 impuestos — el `1` del cliente se pisó
    const reread = await reservationsRepo.findById(created.id)
    expect(Number(reread.totalAmount)).toBe(436) // persistido de verdad, releído de la DB
  })

  it('4. reasignar la temporada cambia el quote de NUEVAS cotizaciones, no el precio pactado', async () => {
    await assignSeason(seasonAssignmentsRepo, HOTEL_ID, { from: '2027-03-01', to: '2027-03-04', season: 'media' })
    const q = await quoteStay(
      { roomRepo: roomsRepo, seasonAssignmentRepo: seasonAssignmentsRepo, roomRateRepo: ratesRepoAny(), seasonsRepo: seasonsAny() },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2027-03-01', checkOut: '2027-03-03', guests: 2 },
    )
    expect(q.subtotal).toBe(300) // ahora media $150
    const all = (await reservationsRepo.findMany({ hotelId: HOTEL_ID })) as any[]
    expect(Number(all.find((r: any) => r.totalAmount === 436)?.totalAmount)).toBe(436) // pactado intacto
  })

  it('5. override de canal NO contamina el precio base del panel', async () => {
    await pricing.updateRates(HOTEL_ID, [
      { roomType: 'suite', occupancy: 2, season: 'media', basePrice: 999, percentage: 0, channel: 'airbnb' },
    ])
    const q = await quoteStay(
      { roomRepo: roomsRepo, seasonAssignmentRepo: seasonAssignmentsRepo, roomRateRepo: ratesRepoAny(), seasonsRepo: seasonsAny() },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2027-03-01', checkOut: '2027-03-03', guests: 2 },
    )
    expect(q.subtotal).toBe(300) // sigue la BASE ($150), no el override airbnb ($999)
  })

  it('6. estadía mixta (temporada + noches sin asignar) suma noche a noche', async () => {
    // Quito la temporada de las noches 2 y 3 ('none' borra la asignación → fallback basePrice)
    await assignSeason(seasonAssignmentsRepo, HOTEL_ID, { from: '2027-03-03', to: '2027-03-04', season: 'none' })
    const q = await quoteStay(
      { roomRepo: roomsRepo, seasonAssignmentRepo: seasonAssignmentsRepo, roomRateRepo: ratesRepoAny(), seasonsRepo: seasonsAny() },
      { hotelId: HOTEL_ID, roomId: ROOM_ID, checkIn: '2027-03-01', checkOut: '2027-03-04', guests: 2 },
    )
    expect(q.subtotal).toBe(420) // 150 + 150 (media) + 120 (sin temporada → base)
    expect(q.pricePerNight).toBeNull()
    expect(q.nights.map((n) => n.season)).toEqual(['media', 'media', null])
  })
})

// ── helpers: repos fresh por lectura (el ORM cachea defs, no data — pero así el test no
//    depende del orden de creación de los OrmRepository) ──────────────────────────────────
function ratesRepoAny(): any { return new OrmRepository<any>(orm, 'RoomRates') }
function seasonsAny(): any { return new OrmRepository<any>(orm, 'Seasons') }
async function ratesOf(season: string): Promise<any> {
  const rows = (await ratesRepoAny().findMany({ hotelId: HOTEL_ID, roomType: 'suite', occupancy: 2, season })) as any[]
  return rows[0]
}
