// scripts/seed-default-roles.ts — Roles de sistema para hoteles que todavía no tienen ninguno.
// Los permisos salen de DEFAULT_ROLE_PERMISSIONS (incluye `restaurant:pay` desde #205: hotel_admin,
// receptionist y waiter cobran; kitchen no). Este script SALTA los hoteles que ya tienen roles.
// Para llevar un permiso nuevo a filas existentes NO alcanza con `sync-system-roles.ts`: sólo toca
// filas `system = 1` con huella, y las que creó el alta hasta #205 tienen `system = 0` (signup
// escribía `isSystem`, campo que el modelo no declara). El camino que sí corre en cada deploy es un
// backfill dentro de `migrate-db.ts` (ej. `scripts/backfill-restaurant-pay-permission.ts`).
import { Pool } from 'pg'
import { DEFAULT_ROLE_PERMISSIONS } from '../src/shared/permissions'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://solmios:solmios123@localhost:5432/solmios'
})

async function seed() {
  const client = await pool.connect()
  try {
    // Get all hotels
    const hotels = await client.query('SELECT id FROM hotels')
    console.log(`Found ${hotels.rowCount} hotels`)

    for (const hotel of hotels.rows) {
      const hotelId = hotel.id

      // Check if hotel already has roles
      const existingRoles = await client.query(
        'SELECT COUNT(*) as count FROM roles WHERE "hotelid" = $1',
        [hotelId]
      )

      if (parseInt(existingRoles.rows[0].count) > 0) {
        console.log(`Hotel ${hotelId} already has roles, skipping...`)
        continue
      }

      // Create default roles for this hotel
      const defaultRoles = [
        {
          id: `role-${hotelId}-admin`,
          name: 'hotel_admin',
          icon: '👑',
          color: 'bg-purple-100 text-purple-700',
          system: 1,
          hotelId,
          permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.hotel_admin),
          users: 0,
        },
        {
          id: `role-${hotelId}-receptionist`,
          name: 'receptionist',
          icon: '🔑',
          color: 'bg-blue-100 text-blue-700',
          system: 1,
          hotelId,
          permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.receptionist),
          users: 0,
        },
        {
          id: `role-${hotelId}-housekeeper`,
          name: 'housekeeper',
          icon: '🧹',
          color: 'bg-green-100 text-green-700',
          system: 1,
          hotelId,
          permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.housekeeper),
          users: 0,
        },
        {
          id: `role-${hotelId}-supervisor`,
          name: 'supervisor',
          icon: '🔍',
          color: 'bg-teal-100 text-teal-700',
          system: 1,
          hotelId,
          permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.supervisor),
          users: 0,
        },
        {
          id: `role-${hotelId}-maintenance`,
          name: 'maintenance',
          icon: '🔧',
          color: 'bg-orange-100 text-orange-700',
          system: 1,
          hotelId,
          permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.maintenance),
          users: 0,
        },
        {
          id: `role-${hotelId}-waiter`,
          name: 'waiter',
          icon: '🍽️',
          color: 'bg-blue-100 text-blue-700',
          system: 1,
          hotelId,
          permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.waiter),
          users: 0,
        },
        {
          id: `role-${hotelId}-kitchen`,
          name: 'kitchen',
          icon: '👨‍🍳',
          color: 'bg-red-100 text-red-700',
          system: 1,
          hotelId,
          permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen),
          users: 0,
        },
      ]

      for (const role of defaultRoles) {
        await client.query(
          `INSERT INTO roles (id, name, icon, color, system, "hotelid", permissions, users, "createdat", "updatedat")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [role.id, role.name, role.icon, role.color, role.system, role.hotelId, role.permissions, role.users]
        )
      }

      console.log(`✅ Default roles created for hotel ${hotelId}`)
    }

    console.log('✅ Seeding completed')
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch(console.error)
