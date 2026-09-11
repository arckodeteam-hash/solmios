// restaurant/tests/restaurant-discount-backfill.test.ts — #215: `restaurant:discount` llega a las filas
// existentes de `roles` CON el deploy (migrate-db.ts), no con un script que alguien tiene que correr.
// Mismo harness que restaurant-pay-backfill (#205): SQLite in-memory + `getRolePermissions`, que es lo
// que `loadPermissions` evalúa en runtime. La regla es más conservadora que la de `pay`: solo roles de
// SISTEMA cuyo default trae `discount` (hotel_admin, receptionist) y que siguen cobrando (`pay`).
import { describe, it, expect } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { backfillRestaurantDiscountPermission, discountPermissionsFor } from '../../../../scripts/backfill-restaurant-discount-permission'
import { DEFAULT_ROLE_PERMISSIONS, getRolePermissions, hasPermission } from '../../../shared/permissions'

interface TestDb extends DbAdapter { connect(): Promise<void> }

/** Lo que las filas de prod tienen ANTES de #215 (con `pay` de #205, sin `discount`). */
const legacy = (role: string) => DEFAULT_ROLE_PERMISSIONS[role].filter((p) => p !== 'restaurant:discount')

async function makeDb(rows: Array<[id: string, name: string, permissions: string]>): Promise<TestDb> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as TestDb
  await db.connect()
  await db.run(`CREATE TABLE roles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT, system INTEGER, hotelId TEXT,
    permissions TEXT, defaultsHash TEXT, users INTEGER, createdAt TEXT, updatedAt TEXT)`)
  for (const [id, name, permissions] of rows) {
    await db.run(`INSERT INTO roles (id, name, hotelId, system, permissions, users) VALUES (?,?,?,?,?,0)`, [id, name, 'h1', 0, permissions])
  }
  return db
}

const perms = async (db: TestDb, id: string): Promise<unknown> => {
  const rows = (await db.query(`SELECT permissions FROM roles WHERE id = ?`, [id])) as Array<{ permissions: string }>
  return JSON.parse(rows[0]!.permissions)
}

describe('discountPermissionsFor — la regla, caso por caso', () => {
  it('hotel_admin y receptionist con la fila de antes (con pay) → original + restaurant:discount, sin quitar nada', () => {
    expect(discountPermissionsFor('hotel_admin', JSON.stringify(legacy('hotel_admin')))).toEqual([...legacy('hotel_admin'), 'restaurant:discount'])
    expect(discountPermissionsFor('receptionist', JSON.stringify(legacy('receptionist')))).toEqual([...legacy('receptionist'), 'restaurant:discount'])
  })

  it('waiter y kitchen → no se tocan (su default no trae discount: el mozo no descuenta salvo que el hotel lo habilite)', () => {
    expect(discountPermissionsFor('waiter', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.waiter))).toBeNull()
    expect(discountPermissionsFor('kitchen', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen))).toBeNull()
  })

  it('rol custom ("Cajero") con pay → no se toca: decidir cobrar menos lo habilita el hotel en Roles', () => {
    expect(discountPermissionsFor('Cajero', JSON.stringify(['restaurant:view', 'restaurant:pay']))).toBeNull()
  })

  it('receptionist a la que le sacaron el POS (sin pay) → no se le devuelve una parte', () => {
    expect(discountPermissionsFor('receptionist', JSON.stringify(['reservations:view', 'guests:view']))).toBeNull()
  })

  it('permissions = [], formato viejo con punto, JSON corrupto → no se toca', () => {
    expect(discountPermissionsFor('receptionist', '[]')).toBeNull()
    expect(discountPermissionsFor('receptionist', JSON.stringify(['reservations.admin', 'billing.read']))).toBeNull()
    expect(discountPermissionsFor('hotel_admin', '{not json')).toBeNull()
    expect(discountPermissionsFor('hotel_admin', null)).toBeNull()
  })

  it('fila que ya tiene restaurant:discount → no se toca (idempotencia)', () => {
    expect(discountPermissionsFor('receptionist', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.receptionist))).toBeNull()
  })

  it('mezcla válido + viejo: conserva el array original entero y sólo agrega discount', () => {
    const mixed = ['billing.read', 'restaurant:view', 'restaurant:pay']
    expect(discountPermissionsFor('receptionist', JSON.stringify(mixed))).toEqual([...mixed, 'restaurant:discount'])
  })
})

describe('backfillRestaurantDiscountPermission — sobre la tabla real', () => {
  it('estado de prod: hotel_admin y receptionist reciben discount; waiter, kitchen, custom, vacía y formato viejo quedan igual', async () => {
    const db = await makeDb([
      ['r-admin', 'hotel_admin', JSON.stringify(legacy('hotel_admin'))],
      ['r-recep', 'receptionist', JSON.stringify(legacy('receptionist'))],
      ['r-waiter', 'waiter', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.waiter)],
      ['r-kitchen', 'kitchen', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen)],
      ['r-cajero', 'Cajero', JSON.stringify(['restaurant:view', 'restaurant:pay'])],
      ['r-empty', 'receptionist', '[]'],
      ['r-old', 'hotel_admin', JSON.stringify(['reservations.admin', 'billing.admin'])],
      ['r-corrupt', 'receptionist', '{oops'],
    ])

    expect(await backfillRestaurantDiscountPermission(db)).toBe(2)

    expect(await perms(db, 'r-admin')).toEqual([...legacy('hotel_admin'), 'restaurant:discount'])
    expect(await perms(db, 'r-recep')).toEqual([...legacy('receptionist'), 'restaurant:discount'])
    expect(await perms(db, 'r-waiter')).toEqual(DEFAULT_ROLE_PERMISSIONS.waiter)
    expect(await perms(db, 'r-kitchen')).toEqual(DEFAULT_ROLE_PERMISSIONS.kitchen)
    expect(await perms(db, 'r-cajero')).toEqual(['restaurant:view', 'restaurant:pay'])
    expect(await perms(db, 'r-empty')).toEqual([])
    expect(await perms(db, 'r-old')).toEqual(['reservations.admin', 'billing.admin'])
    const corrupt = (await db.query(`SELECT permissions FROM roles WHERE id = 'r-corrupt'`)) as Array<{ permissions: string }>
    expect(corrupt[0]!.permissions).toBe('{oops')
  })

  it('es idempotente: la segunda corrida no escribe nada', async () => {
    const db = await makeDb([
      ['r-recep', 'receptionist', JSON.stringify(legacy('receptionist'))],
      ['r-waiter', 'waiter', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.waiter)],
    ])
    expect(await backfillRestaurantDiscountPermission(db)).toBe(1)
    expect(await backfillRestaurantDiscountPermission(db)).toBe(0)
    expect(await perms(db, 'r-recep')).toEqual([...legacy('receptionist'), 'restaurant:discount'])
  })

  it('cierra el círculo con getRolePermissions: antes 403 al descontar, después no, y no perdió nada', async () => {
    const db = await makeDb([['r-recep', 'receptionist', JSON.stringify(legacy('receptionist'))]])
    const before = getRolePermissions('receptionist', (await perms(db, 'r-recep')) as string[])
    expect(hasPermission(before, 'restaurant', 'discount')).toBe(false)

    await backfillRestaurantDiscountPermission(db)
    const after = getRolePermissions('receptionist', (await perms(db, 'r-recep')) as string[])
    expect(hasPermission(after, 'restaurant', 'discount')).toBe(true)
    expect(hasPermission(after, 'restaurant', 'pay')).toBe(true)
    expect(hasPermission(after, 'reservations', 'view')).toBe(true)
  })

  it('una fila vacía sigue cayendo al default (con discount) — el backfill NO la convierte en [discount] pelado', async () => {
    const db = await makeDb([['r-empty', 'hotel_admin', '[]']])
    await backfillRestaurantDiscountPermission(db)
    const effective = getRolePermissions('hotel_admin', (await perms(db, 'r-empty')) as string[])
    expect(effective).toEqual(DEFAULT_ROLE_PERMISSIONS.hotel_admin)
    expect(hasPermission(effective, 'restaurant', 'discount')).toBe(true)
  })
})
