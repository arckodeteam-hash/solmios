// bookingengine/tests/mealplans-permission-backfill.test.ts — REQ "Gestionar Regímenes desde
// Configuración Base" (#360/#375): `mealplans:view`/`edit` llega a las filas EXISTENTES de `roles`
// CON el deploy (migrate-db.ts), no con algo que alguien tiene que correr a mano.
//
// El bug reportado: Configuración Base → Regímenes mostraba "Sin permiso: mealplans:view" para el
// hotel_admin de un hotel ya operando — la fila de `roles` fue sembrada antes de que `mealplans`
// existiera como permiso, y `getRolePermissions` usa esa fila EN LUGAR del mapa estático en cuanto
// trae permisos válidos (agregar el permiso al mapa no la toca). Mismo patrón de test que
// restaurant/tests/restaurant-pay-backfill.test.ts: se pinea la regla sobre una SQLite in-memory y
// se cierra el círculo con `getRolePermissions`, que es lo que `loadPermissions` evalúa en runtime.
import { describe, it, expect } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { backfillMealPlansPermission, mealPlansPermissionsFor } from '../../../../scripts/backfill-mealplans-permission'
import { DEFAULT_ROLE_PERMISSIONS, getRolePermissions, hasPermission } from '../../../shared/permissions'

interface TestDb extends DbAdapter { connect(): Promise<void> }

/** Lista explícita de lo que `signup.ts` sembraba en cada hotel ANTES de que `mealplans` existiera. */
const legacy = (role: string) => DEFAULT_ROLE_PERMISSIONS[role].filter((p) => !p.startsWith('mealplans:'))

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

describe('mealPlansPermissionsFor — la regla, caso por caso', () => {
  it('hotel_admin sembrado antes del permiso → original + mealplans:view/edit, sin quitar nada', () => {
    const next = mealPlansPermissionsFor('hotel_admin', JSON.stringify(legacy('hotel_admin')))
    expect(next).toEqual([...legacy('hotel_admin'), 'mealplans:view', 'mealplans:edit'])
  })

  it('receptionist: su default NO trae mealplans → no se toca (regalarlo sería de más)', () => {
    expect(mealPlansPermissionsFor('receptionist', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.receptionist))).toBeNull()
  })

  it('kitchen/waiter/housekeeper/maintenance/supervisor: ninguno administra Configuración Base → no se tocan', () => {
    for (const role of ['kitchen', 'waiter', 'housekeeper', 'maintenance', 'supervisor']) {
      expect(mealPlansPermissionsFor(role, JSON.stringify(DEFAULT_ROLE_PERMISSIONS[role]))).toBeNull()
    }
  })

  it('rol custom ("Gerente General") con settings:edit → recibe mealplans: ya administra Configuración Base', () => {
    const original = ['settings:view', 'settings:edit', 'reservations:view']
    expect(mealPlansPermissionsFor('Gerente General', JSON.stringify(original))).toEqual([...original, 'mealplans:view', 'mealplans:edit'])
  })

  it('rol custom SIN settings:edit → no administraba Configuración Base, no se le regala', () => {
    expect(mealPlansPermissionsFor('Cajero', JSON.stringify(['restaurant:view', 'restaurant:pay']))).toBeNull()
  })

  it('permissions = [] → no se toca (en runtime cae al default)', () => {
    expect(mealPlansPermissionsFor('hotel_admin', '[]')).toBeNull()
  })

  it('formato viejo con punto (billing.read) → no se toca: escribir el permiso pelado dejaría al rol SOLO con eso', () => {
    expect(mealPlansPermissionsFor('hotel_admin', JSON.stringify(['reservations.admin', 'billing.read']))).toBeNull()
  })

  it('JSON corrupto o no-array → no se toca', () => {
    expect(mealPlansPermissionsFor('hotel_admin', '{not json')).toBeNull()
    expect(mealPlansPermissionsFor('hotel_admin', '{"a":1}')).toBeNull()
    expect(mealPlansPermissionsFor('hotel_admin', null)).toBeNull()
  })

  it('fila que ya tiene mealplans:view y mealplans:edit → no se toca (idempotencia)', () => {
    expect(mealPlansPermissionsFor('hotel_admin', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.hotel_admin))).toBeNull()
  })

  it('fila con mealplans:view pero sin mealplans:edit → agrega SOLO lo que falta', () => {
    const original = [...legacy('hotel_admin'), 'mealplans:view']
    expect(mealPlansPermissionsFor('hotel_admin', JSON.stringify(original))).toEqual([...original, 'mealplans:edit'])
  })

  it('mezcla válido + viejo: conserva el array original entero y sólo agrega lo que falta', () => {
    const mixed = ['billing.read', 'settings:view', 'settings:edit']
    expect(mealPlansPermissionsFor('Gerente General', JSON.stringify(mixed))).toEqual([...mixed, 'mealplans:view', 'mealplans:edit'])
  })
})

describe('backfillMealPlansPermission — sobre la tabla real', () => {
  it('estado de prod: hotel_admin y custom con settings:edit reciben el permiso; el resto queda igual', async () => {
    const db = await makeDb([
      ['r-admin', 'hotel_admin', JSON.stringify(legacy('hotel_admin'))],
      ['r-recep', 'receptionist', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.receptionist)],
      ['r-kitchen', 'kitchen', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen)],
      ['r-gerente', 'Gerente General', JSON.stringify(['settings:view', 'settings:edit'])],
      ['r-cajero', 'Cajero', JSON.stringify(['restaurant:view', 'restaurant:pay'])],
      ['r-empty', 'hotel_admin', '[]'],
      ['r-old', 'Gerente', JSON.stringify(['reservations.admin', 'billing.admin'])],
      ['r-corrupt', 'hotel_admin', '{oops'],
    ])

    expect(await backfillMealPlansPermission(db)).toBe(2)

    expect(await perms(db, 'r-admin')).toEqual([...legacy('hotel_admin'), 'mealplans:view', 'mealplans:edit'])
    expect(await perms(db, 'r-recep')).toEqual(DEFAULT_ROLE_PERMISSIONS.receptionist)
    expect(await perms(db, 'r-kitchen')).toEqual(DEFAULT_ROLE_PERMISSIONS.kitchen)
    expect(await perms(db, 'r-gerente')).toEqual(['settings:view', 'settings:edit', 'mealplans:view', 'mealplans:edit'])
    expect(await perms(db, 'r-cajero')).toEqual(['restaurant:view', 'restaurant:pay'])
    expect(await perms(db, 'r-empty')).toEqual([])
    expect(await perms(db, 'r-old')).toEqual(['reservations.admin', 'billing.admin'])
    const corrupt = (await db.query(`SELECT permissions FROM roles WHERE id = 'r-corrupt'`)) as Array<{ permissions: string }>
    expect(corrupt[0]!.permissions).toBe('{oops')
  })

  it('es idempotente: la segunda corrida no escribe nada', async () => {
    const db = await makeDb([
      ['r-admin', 'hotel_admin', JSON.stringify(legacy('hotel_admin'))],
      ['r-kitchen', 'kitchen', JSON.stringify(DEFAULT_ROLE_PERMISSIONS.kitchen)],
    ])
    expect(await backfillMealPlansPermission(db)).toBe(1)
    expect(await backfillMealPlansPermission(db)).toBe(0)
    expect(await perms(db, 'r-admin')).toEqual([...legacy('hotel_admin'), 'mealplans:view', 'mealplans:edit'])
  })

  it('cierra el círculo con getRolePermissions (lo que loadPermissions evalúa): antes 403, después no', async () => {
    const db = await makeDb([['r-admin', 'hotel_admin', JSON.stringify(legacy('hotel_admin'))]])
    const before = getRolePermissions('hotel_admin', (await perms(db, 'r-admin')) as string[])
    expect(hasPermission(before, 'mealplans', 'view')).toBe(false) // el estado real de prod antes del deploy

    await backfillMealPlansPermission(db)
    const after = getRolePermissions('hotel_admin', (await perms(db, 'r-admin')) as string[])
    expect(hasPermission(after, 'mealplans', 'view')).toBe(true)
    expect(hasPermission(after, 'mealplans', 'edit')).toBe(true)
    expect(hasPermission(after, 'settings', 'edit')).toBe(true) // no perdió nada
  })

  it('una fila vacía sigue cayendo al default — el backfill NO la convierte en un permiso pelado', async () => {
    const db = await makeDb([['r-empty', 'hotel_admin', '[]']])
    await backfillMealPlansPermission(db)
    const effective = getRolePermissions('hotel_admin', (await perms(db, 'r-empty')) as string[])
    expect(effective).toEqual(DEFAULT_ROLE_PERMISSIONS.hotel_admin)
    expect(hasPermission(effective, 'mealplans', 'view')).toBe(true)
  })
})
