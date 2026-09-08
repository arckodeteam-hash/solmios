#!/usr/bin/env bun
// scripts/seed-hotel-demo-meta.ts — El hotel de prueba que va a revisar Meta.
//
// Meta pide un usuario y contraseña para que su revisor entre al PMS y compruebe lo que muestra el
// vídeo. Ese revisor navega TODO lo que puede: no puede caer en datos de huéspedes reales.
//
// Crea un hotel aislado, con nombre y datos inventados, tres habitaciones y dos reservas cuyos
// teléfonos son los que se registran como números de prueba en la consola de Meta.
//
//   bun run scripts/seed-hotel-demo-meta.ts
//   DEMO_PHONE=18095551234 bun run scripts/seed-hotel-demo-meta.ts   # tu celular de prueba
//   DATABASE_URL=postgres://... bun run scripts/seed-hotel-demo-meta.ts
//
// Idempotente: correrlo dos veces no duplica nada.
//
// La CONTRASEÑA no se fija acá ni se escribe en el repositorio: se pasa por `DEMO_PASSWORD` y se
// le entrega a Meta por su formulario. Sin esa variable el script no crea el usuario.

import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import type { DbAdapter } from 'arckode-framework'

const DATABASE_URL = process.env.DATABASE_URL
const db: DbAdapter & { connect(): Promise<void> } = DATABASE_URL
  ? new PostgresAdapter({ connectionString: DATABASE_URL })
  : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })

const now = () => new Date().toISOString()
const dia = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

/** Ids fijos: sin esto no habría forma de saber si ya se corrió. */
const HOTEL_ID = 'demo-meta-0000-0000-000000000001'
const USER_ID = 'demo-meta-user-0000-000000000001'

/**
 * Teléfono de los huéspedes de prueba. Tiene que ser un número REGISTRADO en la consola de Meta:
 * en modo desarrollo, Meta solo entrega a esos. Si no, el mensaje "se envía" y no llega a ningún
 * lado, y parece un fallo del PMS cuando no lo es.
 */
const DEMO_PHONE = process.env.DEMO_PHONE || '18095550199'

async function existe(tabla: string, id: string): Promise<boolean> {
  const filas = (await db.query(`SELECT id FROM ${tabla} WHERE id=?`, [id])) as Array<{ id: string }>
  return filas.length > 0
}

async function main(): Promise<void> {
  await db.connect()

  const password = process.env.DEMO_PASSWORD
  if (!password) {
    console.error('Falta DEMO_PASSWORD. La contraseña del revisor no va en el repositorio:')
    console.error('  DEMO_PASSWORD="..." bun run scripts/seed-hotel-demo-meta.ts')
    process.exit(1)
  }

  // ── Hotel ──────────────────────────────────────────────────────────────────
  if (!(await existe('hotels', HOTEL_ID))) {
    await db.run(
      'INSERT INTO hotels (id, name, address, phone, email, country, currency, timezone, checkIn, checkOut, plan, status, roomsCount, active, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [HOTEL_ID, 'Hotel Demo Solmios', 'Av. de Prueba 100, Punta Cana', '+1 809 555 0199',
       'demo@solmios.com', 'DO', 'USD', 'America/Santo_Domingo', '15:00', '12:00',
       'professional', 'active', 3, 1, now(), now()],
    )
    console.log('  hotel creado')
  } else {
    console.log('  hotel ya existía')
  }

  // ── Usuario del revisor ────────────────────────────────────────────────────
  // El hash se calcula con el mismo algoritmo que usa el login (bcrypt vía Bun).
  const hash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 })
  if (!(await existe('users', USER_ID))) {
    await db.run(
      'INSERT INTO users (id, name, email, password, role, hotelId, userType, active, isDemo, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,1,1,?,?)',
      [USER_ID, 'Revisor Meta', 'revisor@solmios.com', hash, 'hotel_admin', HOTEL_ID, 'merchant', now(), now()],
    )
    console.log('  usuario creado: revisor@solmios.com')
  } else {
    // Si ya existía, se actualiza la contraseña: permite rotarla sin borrar nada.
    await db.run('UPDATE users SET password=?, updatedAt=? WHERE id=?', [hash, now(), USER_ID])
    console.log('  usuario ya existía — contraseña actualizada')
  }

  // ── Habitaciones ───────────────────────────────────────────────────────────
  const habitaciones: Array<[string, string, string, number, number]> = [
    ['demo-meta-room-000000000000001', '101', 'single', 80, 2],
    ['demo-meta-room-000000000000002', '102', 'double', 120, 3],
    ['demo-meta-room-000000000000003', '201', 'suite', 220, 4],
  ]
  for (const [id, numero, tipo, precio, capacidad] of habitaciones) {
    if (await existe('rooms', id)) continue
    await db.run(
      'INSERT INTO rooms (id, number, name, type, basePrice, status, hotelId, capacity, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, numero, `Habitación ${numero}`, tipo, precio, 'available', HOTEL_ID, capacidad, now(), now()],
    )
  }

  // ── Huéspedes de prueba ────────────────────────────────────────────────────
  // Nombres y correos inventados. El TELÉFONO es el que importa: tiene que estar registrado en la
  // consola de Meta o el mensaje no se entrega.
  const huespedes: Array<[string, string, string]> = [
    ['demo-meta-guest-00000000000001', 'Ana Prueba', DEMO_PHONE],
    ['demo-meta-guest-00000000000002', 'Carlos Demo', DEMO_PHONE],
  ]
  for (const [id, nombre, telefono] of huespedes) {
    if (await existe('guests', id)) continue
    await db.run(
      'INSERT INTO guests (id, name, email, phone, document, nationality, totalStays, totalSpent, tier, hotelId, active, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)',
      [id, nombre, `${id}@ejemplo.test`, telefono, 'DEMO-000', 'DO', 0, 0, 'standard', HOTEL_ID, now(), now()],
    )
  }

  // ── Reservas ───────────────────────────────────────────────────────────────
  const reservas: Array<[string, string, string, string, string, string, number]> = [
    ['demo-meta-res-0000000000000001', 'demo-meta-guest-00000000000001', 'demo-meta-room-000000000000002', dia(1), dia(4), 'confirmed', 360],
    ['demo-meta-res-0000000000000002', 'demo-meta-guest-00000000000002', 'demo-meta-room-000000000000001', dia(-1), dia(2), 'checked_in', 240],
  ]
  for (const [id, guestId, roomId, entra, sale, estado, monto] of reservas) {
    if (await existe('reservations', id)) continue
    await db.run(
      "INSERT INTO reservations (id, guestId, roomId, hotelId, checkIn, checkOut, status, channel, totalAmount, deposit, adults, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,'direct',?,0,2,'USD',?,?)",
      [id, guestId, roomId, HOTEL_ID, entra, sale, estado, monto, now(), now()],
    )
  }

  console.log(`
Hotel de prueba listo.

  URL            la del entorno donde corriste esto
  Usuario        revisor@solmios.com
  Contraseña     la que pasaste en DEMO_PASSWORD
  Teléfono demo  ${DEMO_PHONE}

Antes de dárselo a Meta:
  1. Registrá ${DEMO_PHONE} en la consola de WhatsApp de la app, o el mensaje no se entrega.
  2. Entrá con ese usuario y conectá el WhatsApp del hotel (Configuración → Integraciones).
  3. Creá las plantillas recomendadas y mandalas a aprobar.
`)
  await db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
