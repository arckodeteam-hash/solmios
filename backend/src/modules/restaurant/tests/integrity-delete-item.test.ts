// restaurant/tests/integrity-delete-item.test.ts — #208 (REST-06): borrar un ítem de la carta.
//
// Lo que estaba mal: `deleteItem` borraba la fila y nada más. Si el ítem era componente de un combo,
// el combo quedaba roto (al venderlo, order-lines.ts lanza por componente inexistente) y sus grupos
// de modificadores + opciones quedaban huérfanos apuntando a un menuItemId que ya no existe.
//
// Se prueba con el ORM REAL sobre SQLite in-memory (mismo harness que menu-items-f6-persistence):
// el transactor es el `orm.transaction` de verdad, así que "no quedan filas" es lo que pasa en la
// base, no lo que devuelve un mock.
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository, ConflictError } from 'arckode-framework'
import type { Auth } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerRestaurantModels } from '../model'
import { deleteItem, type ItemsCrudDeps } from '../usecases/items-crud'
import type { MenuItemDTO, CategoryDTO, StationDTO, ComboDTO, ComboItemDTO, ModifierGroupDTO, ModifierDTO, CurrentUser } from '../types'

const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth

interface Harness {
  deps: ItemsCrudDeps
  items: OrmRepository<MenuItemDTO>
  groups: OrmRepository<ModifierGroupDTO>
  modifiers: OrmRepository<ModifierDTO>
  combos: OrmRepository<ComboDTO>
  comboItems: OrmRepository<ComboItemDTO>
  orm: ORM
}

async function withOrm(fn: (h: Harness) => Promise<void>): Promise<void> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerRestaurantModels(orm)
  await orm.migrate()
  const items = new OrmRepository<MenuItemDTO>(orm, 'MenuItems')
  const groups = new OrmRepository<ModifierGroupDTO>(orm, 'MenuItemModifierGroups')
  const modifiers = new OrmRepository<ModifierDTO>(orm, 'MenuItemModifiers')
  const combos = new OrmRepository<ComboDTO>(orm, 'MenuCombos')
  const comboItems = new OrmRepository<ComboItemDTO>(orm, 'MenuComboItems')
  const userRepo = { findById: async () => ({ id: 'u1', hotelId: 'h1' }) } as any
  const deps: ItemsCrudDeps = {
    items,
    categories: new OrmRepository<CategoryDTO>(orm, 'MenuCategories'),
    stations: new OrmRepository<StationDTO>(orm, 'RestaurantStations'),
    userRepo, auth: strictAuth,
    comboItems, combos, modifierGroups: groups, modifiers,
    transactor: { transaction: (fn) => orm.transaction(fn as any) },
  }
  try {
    await fn({ deps, items, groups, modifiers, combos, comboItems, orm })
  } finally {
    await db.close?.()
  }
}

/** Ítem con 2 grupos de modificadores (3 opciones en total). Devuelve el id del ítem. */
async function seedItemWithModifiers(h: Harness, name = 'Hamburguesa'): Promise<string> {
  const item = await h.items.create({ hotelId: 'h1', categoryId: 'c1', name, price: 100 } as any)
  const size = await h.groups.create({ hotelId: 'h1', menuItemId: item.id, name: 'Tamaño', selectionType: 'single' } as any)
  const extras = await h.groups.create({ hotelId: 'h1', menuItemId: item.id, name: 'Extras', selectionType: 'multiple' } as any)
  await h.modifiers.create({ hotelId: 'h1', groupId: size.id, name: 'Grande', priceDelta: 20 } as any)
  await h.modifiers.create({ hotelId: 'h1', groupId: extras.id, name: 'Tocino', priceDelta: 15 } as any)
  await h.modifiers.create({ hotelId: 'h1', groupId: extras.id, name: 'Queso', priceDelta: 10 } as any)
  return item.id
}

describe('#208 — deleteItem: ítem usado en un combo', () => {
  it('→ 409 con el nombre del combo; el ítem, sus grupos y el combo quedan intactos', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      const combo = await h.combos.create({ hotelId: 'h1', name: 'Combo Familiar', price: 300 } as any)
      await h.comboItems.create({ hotelId: 'h1', comboId: combo.id, menuItemId: itemId, quantity: 2 } as any)

      let err: unknown
      try { await deleteItem(h.deps, itemId, user) } catch (e) { err = e }
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).httpStatus).toBe(409)
      expect((err as Error).message).toContain('Combo Familiar')

      expect(await h.items.findById(itemId)).not.toBeNull()
      expect(await h.groups.count({ menuItemId: itemId })).toBe(2)
      expect(await h.comboItems.count({ menuItemId: itemId })).toBe(1)
    })
  })

  it('el mensaje lista cada combo UNA vez aunque el ítem aparezca en varios', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      for (const name of ['Combo A', 'Combo B']) {
        const combo = await h.combos.create({ hotelId: 'h1', name, price: 300 } as any)
        await h.comboItems.create({ hotelId: 'h1', comboId: combo.id, menuItemId: itemId, quantity: 1 } as any)
      }
      await expect(deleteItem(h.deps, itemId, user)).rejects.toThrow('"Combo A", "Combo B"')
    })
  })
})

describe('#208 — deleteItem: cascada de modificadores', () => {
  it('sin combo → borra el ítem y NO quedan filas en menu_item_modifier_groups ni menu_item_modifiers con ese ítem', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      // Otro ítem con su propio grupo: la cascada NO debe tocarlo.
      const otherId = await seedItemWithModifiers(h, 'Pizza')
      const otherGroups = (await h.groups.findMany({ menuItemId: otherId })).map((g) => g.id)

      await deleteItem(h.deps, itemId, user)

      expect(await h.items.findById(itemId)).toBeNull()
      expect(await h.groups.count({ menuItemId: itemId })).toBe(0)
      // Ninguna opción huérfana: todas las que quedan cuelgan de un grupo que existe.
      const remaining = await h.modifiers.findMany({ hotelId: 'h1' })
      expect(remaining.length).toBe(3)
      for (const m of remaining) expect(otherGroups).toContain(m.groupId)
      expect(await h.groups.count({ menuItemId: otherId })).toBe(2)
    })
  })

  it('la cascada es atómica: si el borrado del ítem falla dentro de la transacción, los grupos y opciones siguen', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      // Transactor real, pero el `delete` del ítem revienta a mitad de la tx → rollback de los deleteMany previos.
      const deps: ItemsCrudDeps = {
        ...h.deps,
        transactor: {
          transaction: (fn) => h.orm.transaction((tx) => fn({
            deleteMany: (m, f) => tx.deleteMany(m, f),
            delete: async () => { throw new Error('disco lleno') },
          })),
        },
      }
      await expect(deleteItem(deps, itemId, user)).rejects.toThrow('disco lleno')
      expect(await h.items.findById(itemId)).not.toBeNull()
      expect(await h.groups.count({ menuItemId: itemId })).toBe(2)
      expect(await h.modifiers.count({ hotelId: 'h1' })).toBe(3)
    })
  })

  it('un menu_combo_items huérfano (su combo ya no existe) no bloquea: se limpia junto con el ítem', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      const orphan = await h.comboItems.create({ hotelId: 'h1', comboId: 'combo-que-ya-no-existe', menuItemId: itemId, quantity: 1 } as any)
      await deleteItem(h.deps, itemId, user)
      expect(await h.items.findById(itemId)).toBeNull()
      expect(await h.comboItems.findById(orphan.id)).toBeNull()
    })
  })

  it('ítem de OTRO hotel → IDOR antes de mirar combos o modificadores', async () => {
    await withOrm(async (h) => {
      const foreign = await h.items.create({ hotelId: 'OTRO', categoryId: 'c1', name: 'Ajeno', price: 1 } as any)
      await expect(deleteItem(h.deps, foreign.id, user)).rejects.toThrow('IDOR')
      expect(await h.items.findById(foreign.id)).not.toBeNull()
    })
  })
})

describe('#208 — deleteItem: la receta en inventario se va con el ítem (por puerto, nunca import directo)', () => {
  it('llama al puerto con (hotelId DEL ÍTEM, menuItemId) después de borrarlo', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      const calls: Array<[string, string, boolean]> = []
      const deps: ItemsCrudDeps = {
        ...h.deps,
        recipes: { deleteRecipesOfMenuItem: async (hotelId, menuItemId) => { calls.push([hotelId, menuItemId, (await h.items.findById(menuItemId)) === null]); return 2 } },
      }
      await deleteItem(deps, itemId, user)
      expect(calls).toEqual([['h1', itemId, true]])
    })
  })

  it('si el puerto falla, el ítem ya está borrado: se avisa en el log y no se devuelve error', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      const warned: string[] = []
      const deps: ItemsCrudDeps = {
        ...h.deps,
        recipes: { deleteRecipesOfMenuItem: async () => { throw new Error('inventario caído') } },
        logger: { warn: (m: string) => { warned.push(m) }, error: () => {} },
      }
      await deleteItem(deps, itemId, user)
      expect(await h.items.findById(itemId)).toBeNull()
      expect(warned.some((m) => m.includes('receta'))).toBe(true)
    })
  })

  it('no bloquea el borrado cuando el ítem sigue en un combo: el puerto no se toca si hay 409', async () => {
    await withOrm(async (h) => {
      const itemId = await seedItemWithModifiers(h)
      const combo = await h.combos.create({ hotelId: 'h1', name: 'Combo Familiar', price: 300 } as any)
      await h.comboItems.create({ hotelId: 'h1', comboId: combo.id, menuItemId: itemId, quantity: 1 } as any)
      let calls = 0
      const deps: ItemsCrudDeps = { ...h.deps, recipes: { deleteRecipesOfMenuItem: async () => { calls++; return 0 } } }
      await expect(deleteItem(deps, itemId, user)).rejects.toBeInstanceOf(ConflictError)
      expect(calls).toBe(0)
    })
  })
})
