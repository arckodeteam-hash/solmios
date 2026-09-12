// bookingengine/tests/backfill-crib-room-amenity.test.ts — revisión del PR #329 (#292): la transición
// de datos del toggle global `child_policy.cribAvailable` a la amenidad `custom:cuna` por habitación
// llega CON el deploy (`migrate-db.ts`), no con un script que alguien tenga que correr.
//
// SQLite real en memoria (mismo patrón que `restaurant/tests/restaurant-pay-backfill.test.ts`) con
// las columnas que el ORM crea para `configuration`, `rooms` y `room_amenities`; se cierra el círculo
// con `roomsOfferCrib`, que es lo que el catálogo público evalúa.
import { describe, it, expect } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { backfillCribRoomAmenity, cribFromChildPolicy, CRIB_AMENITY_NAME } from '../../../../scripts/backfill-crib-room-amenity'
import { CRIB_AMENITY_KEY, roomsOfferCrib, groupAmenitiesByRoom } from '../usecases/public-room-amenities'

interface TestDb extends DbAdapter { connect(): Promise<void> }

async function makeDb(): Promise<TestDb> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as TestDb
  await db.connect()
  await db.run(`CREATE TABLE configuration (id TEXT PRIMARY KEY, hotelId TEXT NOT NULL, key TEXT NOT NULL, value TEXT, createdAt TEXT, updatedAt TEXT)`)
  await db.run(`CREATE TABLE rooms (id TEXT PRIMARY KEY, hotelId TEXT NOT NULL, number TEXT, type TEXT, status TEXT, createdAt TEXT, updatedAt TEXT)`)
  await db.run(`CREATE TABLE room_amenities (id TEXT PRIMARY KEY, roomId TEXT NOT NULL, amenityKey TEXT NOT NULL, isShared INTEGER, name TEXT, price REAL, isActive INTEGER, createdAt TEXT, updatedAt TEXT)`)
  return db
}

const policy = async (db: TestDb, hotelId: string, value: unknown) =>
  db.run(`INSERT INTO configuration (id, hotelId, key, value) VALUES (?, ?, 'child_policy', ?)`, [`cfg-${hotelId}`, hotelId, typeof value === 'string' ? value : JSON.stringify(value)])
const room = async (db: TestDb, id: string, hotelId: string) =>
  db.run(`INSERT INTO rooms (id, hotelId, number, type, status) VALUES (?, ?, ?, 'double', 'available')`, [id, hotelId, id])
const amenity = async (db: TestDb, roomId: string, amenityKey: string, name: string, isActive = 1) =>
  db.run(`INSERT INTO room_amenities (id, roomId, amenityKey, isShared, name, price, isActive) VALUES (?, ?, ?, 0, ?, 0, ?)`, [`${roomId}-${amenityKey}`, roomId, amenityKey, name, isActive])
const amenitiesOf = async (db: TestDb, roomId: string) =>
  (await db.query(`SELECT roomId, amenityKey, name, price, isActive, isShared FROM room_amenities WHERE roomId = ? ORDER BY amenityKey`, [roomId])) as any[]

describe('cribFromChildPolicy — la regla, caso por caso', () => {
  it('cribAvailable:true → cuna a 0; con cribPrice numérico → ese precio; false/ausente/corrupto → nada', () => {
    expect(cribFromChildPolicy(JSON.stringify({ acceptChildren: true, cribAvailable: true }))).toEqual({ price: 0 })
    expect(cribFromChildPolicy({ cribAvailable: true, cribPrice: 12.5 })).toEqual({ price: 12.5 })
    expect(cribFromChildPolicy({ cribAvailable: true, cribPrice: -3 })).toEqual({ price: 0 })
    expect(cribFromChildPolicy({ cribAvailable: true, cribPrice: 'x' })).toEqual({ price: 0 })
    expect(cribFromChildPolicy({ cribAvailable: false })).toBeNull()
    expect(cribFromChildPolicy({ cribAvailable: 1 })).toBeNull()
    expect(cribFromChildPolicy({ acceptChildren: true })).toBeNull()
    expect(cribFromChildPolicy('{not json')).toBeNull()
    expect(cribFromChildPolicy(null)).toBeNull()
    expect(cribFromChildPolicy('[]')).toBeNull()
  })
})

describe('backfillCribRoomAmenity — SQLite real', () => {
  it('hotel con cribAvailable:true → custom:cuna ("Cuna", activa, 0) en cada habitación sin cuna; segunda corrida → 0; el catálogo público la ve', async () => {
    const db = await makeDb()
    await policy(db, 'h1', { acceptChildren: true, maxBabyAge: 1, cribAvailable: true })
    await room(db, 'r1', 'h1')
    await room(db, 'r2', 'h1')
    await room(db, 'r3', 'h1')
    // r2 ya tiene la cuna con OTRO slug ("Cuna para bebé"), r3 la tiene desactivada: ninguna se toca.
    await amenity(db, 'r2', 'custom:cuna_para_bebe', 'Cuna para bebé')
    await amenity(db, 'r3', CRIB_AMENITY_KEY, 'Cuna', 0)
    await amenity(db, 'r1', 'wifi', '')

    expect(await backfillCribRoomAmenity(db)).toBe(1)
    expect(await amenitiesOf(db, 'r1')).toEqual([
      { roomId: 'r1', amenityKey: CRIB_AMENITY_KEY, name: CRIB_AMENITY_NAME, price: 0, isActive: 1, isShared: 0 },
      { roomId: 'r1', amenityKey: 'wifi', name: '', price: 0, isActive: 1, isShared: 0 },
    ])
    expect(await amenitiesOf(db, 'r2')).toHaveLength(1)
    expect((await amenitiesOf(db, 'r3'))[0]).toMatchObject({ amenityKey: CRIB_AMENITY_KEY, isActive: 0 })

    // Idempotente.
    expect(await backfillCribRoomAmenity(db)).toBe(0)
    expect(await amenitiesOf(db, 'r1')).toHaveLength(2)

    // Lo que evalúa el motor: r1 y r2 ofrecen cuna, r3 (desactivada) no.
    const byRoom = groupAmenitiesByRoom((await db.query(`SELECT * FROM room_amenities`)) as any[])
    expect(roomsOfferCrib(byRoom, ['r1'])).toBe(true)
    expect(roomsOfferCrib(byRoom, ['r2'])).toBe(true)
    expect(roomsOfferCrib(byRoom, ['r3'])).toBe(false)
    await db.close()
  })

  it('hotel sin el flag (false o sin child_policy) → 0 filas; hoteles mezclados sólo tocan al que lo tenía, con su cribPrice', async () => {
    const db = await makeDb()
    await policy(db, 'h-off', { acceptChildren: true, cribAvailable: false })
    await room(db, 'r-off', 'h-off')
    await room(db, 'r-none', 'h-none') // sin fila child_policy
    await policy(db, 'h-on', { cribAvailable: true, cribPrice: 15 })
    await room(db, 'r-on-a', 'h-on')
    await room(db, 'r-on-b', 'h-on')

    expect(await backfillCribRoomAmenity(db)).toBe(2)
    expect(await amenitiesOf(db, 'r-off')).toEqual([])
    expect(await amenitiesOf(db, 'r-none')).toEqual([])
    expect((await amenitiesOf(db, 'r-on-a'))[0]).toMatchObject({ amenityKey: CRIB_AMENITY_KEY, name: 'Cuna', price: 15, isActive: 1 })
    expect((await amenitiesOf(db, 'r-on-b'))[0]).toMatchObject({ amenityKey: CRIB_AMENITY_KEY, price: 15 })
    expect(await backfillCribRoomAmenity(db)).toBe(0)
    await db.close()
  })

  it('hotel con el flag pero sin habitaciones, o child_policy corrupto → 0 filas sin error', async () => {
    const db = await makeDb()
    await policy(db, 'h-empty', { cribAvailable: true })
    await policy(db, 'h-bad', '{corrupto')
    await room(db, 'r-bad', 'h-bad')
    expect(await backfillCribRoomAmenity(db)).toBe(0)
    await db.close()
  })
})
