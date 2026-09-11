// restaurant/tests/restaurant-pay-backfill.test.ts — #205: `restaurant:pay` llega a las filas
// existentes de `roles` CON el deploy (migrate-db.ts), no con un script que alguien tiene que correr.
//
// Lo que el gate marcó (INT-1/INT-2/SEC-3/REG-1/REG-4): los permisos efectivos salen de la fila de
// `roles` (`getRolePermissions` la usa en lugar del mapa estático cuando trae permisos válidos), así
// que un deploy sin backfill dejaba a mozo/recepción/hotel_admin de todo hotel existente con 403 al
// cobrar; y el script de rescate anterior escribía `['restaurant:pay']` pelado sobre filas vacías o
// con formato viejo, dejando al rol SOLO con ese permiso. Acá se pinea la regla completa sobre una
// SQLite in-memory (mismo patrón que payments/tests/reservation-link.test.ts) y se cierra el círculo
// con `getRolePermissions`, que es lo que `loadPermissions` evalúa en runtime.
import { describe, it, expect } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { backfillRestaurantPayPermission, payPermissionsFor } from '../../../../scripts/backfill-restaurant-pay-permission'
import { DEFAULT_ROLE_PERMISSIONS, getRolePermissions, hasPermission } from '../../../shared/permissions'

interface TestDb extends DbAdapter { connect(): Promise<void> }

/** Lista explícita que `signup.ts` sembró en cada hotel ANTES de #205 (sin `restaurant:pay`). */
const legacy = (role: string) => DEFAULT_ROLE_PERMISSIONS[role].filter((p) => p !== 'restaurant:pay')

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

describe('payPermissionsFor — la regla, caso por caso', () => {
  it('fila sembrada antes de #205 (con restaurant:edit) → original + restaurant:pay, sin quitar nada', () => {
    const next = payPermissionsFor('waiter', JSON.stringify(legacy('waiter')))
    expect(next).toEqual([...legacy('waiter'), 'restaurant:pay'])
  })

  it('kitchen tiene restaurant:edit pero su default NO trae pay → no se toca (es lo que #205 corrige)', () => {
    expect(payPermissionsFor('kitchen', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen))).toBeNull()
  })

  it('rol custom ("Cajero") con restaurant:edit → recibe pay: hoy cobra y no debe perderlo', () => {
    expect(payPermissionsFor('Cajero', JSON.stringify(['restaurant:view', 'restaurant:edit']))).toEqual(['restaurant:view', 'restaurant:edit', 'restaurant:pay'])
  })

  it('rol custom sin restaurant:edit → no cobraba, no se le regala', () => {
    expect(payPermissionsFor('Mirón', JSON.stringify(['restaurant:view']))).toBeNull()
  })

  it('permissions = [] → no se toca (en runtime cae al default, que ya trae pay)', () => {
    expect(payPermissionsFor('waiter', '[]')).toBeNull()
  })

  it('formato viejo con punto (billing.read) → no se toca: escribir [pay] pelado dejaría al rol SOLO con eso', () => {
    expect(payPermissionsFor('receptionist', JSON.stringify(['reservations.admin', 'billing.read']))).toBeNull()
  })

  it('JSON corrupto o no-array → no se toca', () => {
    expect(payPermissionsFor('waiter', '{not json')).toBeNull()
    expect(payPermissionsFor('waiter', '{"a":1}')).toBeNull()
    expect(payPermissionsFor('waiter', null)).toBeNull()
  })

  it('fila que ya tiene restaurant:pay → no se toca (idempotencia)', () => {
    expect(payPermissionsFor('waiter', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.waiter))).toBeNull()
  })

  it('mezcla válido + viejo: conserva el array original entero y sólo agrega pay', () => {
    const mixed = ['billing.read', 'restaurant:view', 'restaurant:edit']
    expect(payPermissionsFor('Cajero', JSON.stringify(mixed))).toEqual([...mixed, 'restaurant:pay'])
  })
})

describe('backfillRestaurantPayPermission — sobre la tabla real', () => {
  it('estado de prod: waiter/receptionist/hotel_admin reciben pay; kitchen, vacía y formato viejo quedan igual', async () => {
    const db = await makeDb([
      ['r-waiter', 'waiter', JSON.stringify(legacy('waiter'))],
      ['r-recep', 'receptionist', JSON.stringify(legacy('receptionist'))],
      ['r-admin', 'hotel_admin', JSON.stringify(legacy('hotel_admin'))],
      ['r-kitchen', 'kitchen', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen)],
      ['r-empty', 'waiter', '[]'],
      ['r-old', 'Gerente', JSON.stringify(['reservations.admin', 'billing.admin'])],
      ['r-corrupt', 'waiter', '{oops'],
    ])

    expect(await backfillRestaurantPayPermission(db)).toBe(3)

    expect(await perms(db, 'r-waiter')).toEqual([...legacy('waiter'), 'restaurant:pay'])
    expect(await perms(db, 'r-recep')).toEqual([...legacy('receptionist'), 'restaurant:pay'])
    expect(await perms(db, 'r-admin')).toEqual([...legacy('hotel_admin'), 'restaurant:pay'])
    expect(await perms(db, 'r-kitchen')).toEqual(DEFAULT_ROLE_PERMISSIONS.kitchen)
    expect(await perms(db, 'r-empty')).toEqual([])
    expect(await perms(db, 'r-old')).toEqual(['reservations.admin', 'billing.admin'])
    const corrupt = (await db.query(`SELECT permissions FROM roles WHERE id = 'r-corrupt'`)) as Array<{ permissions: string }>
    expect(corrupt[0]!.permissions).toBe('{oops')
  })

  it('es idempotente: la segunda corrida no escribe nada', async () => {
    const db = await makeDb([
      ['r-waiter', 'waiter', JSON.stringify(legacy('waiter'))],
      ['r-kitchen', 'kitchen', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen)],
    ])
    expect(await backfillRestaurantPayPermission(db)).toBe(1)
    expect(await backfillRestaurantPayPermission(db)).toBe(0)
    expect(await perms(db, 'r-waiter')).toEqual([...legacy('waiter'), 'restaurant:pay'])
  })

  it('cierra el círculo con getRolePermissions (lo que loadPermissions evalúa): antes 403 al cobrar, después no', async () => {
    const db = await makeDb([['r-waiter', 'waiter', JSON.stringify(legacy('waiter'))]])
    const before = getRolePermissions('waiter', (await perms(db, 'r-waiter')) as string[])
    expect(hasPermission(before, 'restaurant', 'pay')).toBe(false) // el estado real de prod antes del deploy

    await backfillRestaurantPayPermission(db)
    const after = getRolePermissions('waiter', (await perms(db, 'r-waiter')) as string[])
    expect(hasPermission(after, 'restaurant', 'pay')).toBe(true)
    expect(hasPermission(after, 'restaurant', 'create')).toBe(true) // no perdió nada
  })

  it('una fila vacía sigue cayendo al default (con pay) — el backfill NO la convierte en [pay] pelado', async () => {
    const db = await makeDb([['r-empty', 'receptionist', '[]']])
    await backfillRestaurantPayPermission(db)
    const effective = getRolePermissions('receptionist', (await perms(db, 'r-empty')) as string[])
    expect(effective).toEqual(DEFAULT_ROLE_PERMISSIONS.receptionist)
    expect(hasPermission(effective, 'reservations', 'view')).toBe(true)
  })
})
