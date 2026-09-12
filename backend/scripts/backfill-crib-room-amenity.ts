// scripts/backfill-crib-room-amenity.ts — UNIVERSAL (PostgreSQL + SQLite). Revisión del PR #329 (#292).
//
// Por qué existe: #292 dio de baja el toggle global `configuration.child_policy.cribAvailable`
// ("¿el hotel ofrece cuna?") — la cuna pasó a ser la amenidad personalizada de CADA habitación
// (`room_amenities` con key `custom:cuna`, nombre "Cuna", precio). El motor público pregunta
// "¿Necesita cuna?" sólo si el tipo publica esa amenidad. Sin transición de datos, un hotel de
// producción que tenía `cribAvailable: true` dejaba de ofrecer la cuna al día siguiente del deploy,
// sin ningún error a la vista, hasta que alguien cargara la amenidad a mano en cada habitación.
//
// Qué hace: por cada hotel cuya `configuration(key='child_policy')` tenga `cribAvailable: true`,
// crea la fila `custom:cuna` ("Cuna", activa, `isShared` 0) — exactamente la que arma el panel al
// tocar la sugerencia "+ Cuna" del formulario de habitación (`amenities/service.ts
// updateRoomAmenities`) — en TODAS las habitaciones del hotel que todavía no tengan una cuna.
// Precio: el `cribPrice` de `child_policy` si alguna vez lo tuvo (numérico, >= 0); si no, 0
// (gratis, como era el toggle). Una habitación que YA tiene una fila cuna (reconocida por
// `isCribAmenityKey`: `custom:cuna`, `custom:crib`, "Cuna para bebé"…, activa o inactiva) no se
// toca: si el hotel la desactivó, fue una decisión.
//
// Por eso NO es un script aparte que alguien tenga que acordarse de correr: lo llama
// `migrate-db.ts`, que el auto-deploy ejecuta en cada deploy. Idempotente: la segunda corrida
// escribe 0 filas. No toca `configuration` (el flag viejo queda como está, nadie lo lee) ni el
// CSV vestigial `rooms.amenities` (se re-sincroniza solo cuando el hotel vuelve a guardar la
// habitación; el motor lee `room_amenities`).
//
// Columnas con alias en minúsculas en los SELECT a propósito (`hotelId AS hotel_id`): los adapters
// crudos no remapean y Postgres pliega `hotelId` a `hotelid` — un `row.hotelId` daría undefined en
// prod. En el INSERT los nombres van sin comillas: PG los pliega a como los creó el ORM.
//
// Local (SQLite):  DB_PATH=data/managerhotel.db bun run scripts/backfill-crib-room-amenity.ts
// Prod (Postgres): DATABASE_URL=postgres://... bun run scripts/backfill-crib-room-amenity.ts

import type { DbAdapter } from 'arckode-framework'
import { CRIB_AMENITY_KEY, isCribAmenityKey } from '../src/shared/usecases/crib-amenity'

/** Mismo nombre que la sugerencia "+ Cuna" del panel (`pages/rooms/index.vue`). */
export const CRIB_AMENITY_NAME = 'Cuna'

interface ChildPolicyRow { hotel_id: string; value: unknown }
interface RoomAmenityRow { room_id: string; amenity_key: string; name: string | null }

/** `value` llega como string (columna TEXT del ORM `json`) o como objeto si el driver lo parsea. */
function parseValue(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Decide, para un `child_policy` crudo, si el hotel ofrecía cuna y a qué precio. `null` = no la
 * ofrecía (o el JSON está corrupto): no se crea nada. Puro y exportado para el test.
 */
export function cribFromChildPolicy(raw: unknown): { price: number } | null {
  const policy = parseValue(raw)
  if (!policy || policy.cribAvailable !== true) return null
  const price = Number(policy.cribPrice)
  return { price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0 }
}

/**
 * Crea `custom:cuna` en las habitaciones sin cuna de los hoteles con `cribAvailable: true`.
 * Devuelve cuántas filas escribió (0 en la segunda corrida). Sólo se llama desde `migrate-db.ts`
 * y su test.
 */
export async function backfillCribRoomAmenity(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  const policies = (await db.query(
    `SELECT hotelId AS hotel_id, value FROM configuration WHERE key = 'child_policy'`,
  )) as ChildPolicyRow[]
  let written = 0
  for (const row of policies) {
    const crib = cribFromChildPolicy(row.value)
    if (!crib || !row.hotel_id) continue
    const rooms = (await db.query(`SELECT id FROM rooms WHERE hotelId = ?`, [row.hotel_id])) as Array<{ id: string }>
    if (rooms.length === 0) continue
    const existing = (await db.query(
      `SELECT ra.roomId AS room_id, ra.amenityKey AS amenity_key, ra.name AS name
         FROM room_amenities ra JOIN rooms r ON r.id = ra.roomId
        WHERE r.hotelId = ?`,
      [row.hotel_id],
    )) as RoomAmenityRow[]
    const withCrib = new Set(existing.filter((a) => isCribAmenityKey(a.amenity_key, a.name)).map((a) => a.room_id))
    for (const room of rooms) {
      if (withCrib.has(room.id)) continue
      const now = new Date().toISOString()
      await db.run(
        `INSERT INTO room_amenities (id, roomId, amenityKey, isShared, name, price, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, 0, ?, ?, 1, ?, ?)`,
        [crypto.randomUUID(), room.id, CRIB_AMENITY_KEY, CRIB_AMENITY_NAME, crib.price, now, now],
      )
      written++
    }
  }
  return written
}

// Ejecutable suelto (además de lo que llama migrate-db.ts): mismo selector de motor que el resto
// de los scripts de esta carpeta.
if (import.meta.main) {
  const { SqliteAdapter } = await import('arckode-framework/adapters/sqlite')
  const { PostgresAdapter } = await import('arckode-framework/adapters/postgres')
  const DATABASE_URL = process.env.DATABASE_URL
  const db: DbAdapter & { connect(): Promise<void> } = DATABASE_URL
    ? new PostgresAdapter({ connectionString: DATABASE_URL })
    : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })
  await db.connect()
  try {
    const n = await backfillCribRoomAmenity(db)
    console.log(`room_amenities custom:cuna (desde child_policy.cribAvailable): ${n} fila(s) creada(s)`)
  } finally {
    await db.close()
  }
}
