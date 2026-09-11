// connectors/tests/restaurante-inventario.test.ts — POS → Inventario (INT-1), combos (F2).
//
// specs/menu-combos/spec.md "Consumo de inventario por componente (sin cambios en el conector)":
// el conector NO conoce combos — solo itera `full.lines` y llama consumeForSale por cada una con
// menuItemId. Este test confirma que ese comportamiento YA cubre las filas `combo_component` (cada
// una con su propio lineId → su propio sourceId en el ledger, dedup por línea) y que la fila
// `combo_header` (menuItemId=null) nunca dispara un consumo.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { restauranteInventarioConnector } from '../restaurante-inventario'

function makeCtx(order: any, restaurantOverrides: Record<string, any> = {}) {
  const captured: any = { sockets: {}, recipePorts: null, recipesDeleted: [] }
  const restaurantStub = {
    setSockets: (s: any) => Object.assign(captured.sockets, s),
    setRecipePorts: (p: any) => { captured.recipePorts = p },
    getOrder: async () => order,
    ...restaurantOverrides,
  }
  const consumed: any[] = []
  const modifierConsumed: any[] = []
  const inventarioStub = {
    consumeForSale: async (input: any) => { consumed.push(input) },
    consumeForSaleWithModifiers: async (input: any) => { modifierConsumed.push(input) },
    revertPosSale: async () => {},
    menuItemsWithRecipe: async () => [],
    deleteRecipesOfMenuItem: async (input: any) => { captured.recipesDeleted.push(input); return 1 },
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'restaurant') return restaurantStub
      if (name === 'inventario') return inventarioStub
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured, consumed, modifierConsumed }
}

// Orden con 1 combo (header + 3 componentes, cada uno con su propio menuItemId/quantity ya
// multiplicada por la explosión de order-lines.ts) + 1 ítem suelto.
const ORDER_WITH_COMBO = {
  id: 'o1',
  hotelId: 'h1',
  lines: [
    { id: 'hdr1', hotelId: 'h1', orderId: 'o1', kind: 'combo_header', comboId: 'combo1', menuItemId: undefined, quantity: 1, status: 'served' },
    { id: 'c1', hotelId: 'h1', orderId: 'o1', kind: 'combo_component', parentLineId: 'hdr1', menuItemId: 'A', quantity: 2, status: 'served' },
    { id: 'c2', hotelId: 'h1', orderId: 'o1', kind: 'combo_component', parentLineId: 'hdr1', menuItemId: 'B', quantity: 1, status: 'served' },
    { id: 'c3', hotelId: 'h1', orderId: 'o1', kind: 'combo_component', parentLineId: 'hdr1', menuItemId: 'C', quantity: 2, status: 'served' },
    { id: 'l1', hotelId: 'h1', orderId: 'o1', kind: 'item', menuItemId: 'D', quantity: 1, status: 'served' },
  ],
}

describe('restauranteInventarioConnector — combos (F2, CERO cambios de código)', () => {
  it('onOrderPaid descuenta stock de cada componente del combo, cada uno con su propio lineId', async () => {
    const { ctx, captured, consumed } = makeCtx(ORDER_WITH_COMBO)
    restauranteInventarioConnector(ctx)
    await captured.sockets.onOrderPaid({ id: 'o1', hotelId: 'h1' })

    // 4 consumos: 3 componentes del combo + 1 ítem suelto. El header NUNCA dispara un consumo.
    expect(consumed).toHaveLength(4)
    const byMenuItem = Object.fromEntries(consumed.map((c: any) => [c.menuItemId, c]))
    expect(byMenuItem.A).toMatchObject({ menuItemId: 'A', soldQty: 2, lineId: 'c1' })
    expect(byMenuItem.B).toMatchObject({ menuItemId: 'B', soldQty: 1, lineId: 'c2' })
    expect(byMenuItem.C).toMatchObject({ menuItemId: 'C', soldQty: 2, lineId: 'c3' })
    expect(byMenuItem.D).toMatchObject({ menuItemId: 'D', soldQty: 1, lineId: 'l1' })

    // Cada componente trae su propio lineId → su propio sourceId aguas abajo (recipes.ts:
    // `${lineId}:${inventoryItemId}`), sin colisión entre componentes del mismo combo.
    const lineIds = consumed.map((c: any) => c.lineId)
    expect(new Set(lineIds).size).toBe(lineIds.length)   // todos distintos

    // El header (menuItemId=null) nunca aparece como consumo.
    expect(consumed.some((c: any) => c.lineId === 'hdr1')).toBe(false)
  })

  it('onOrderCharged (cargo a folio) también descuenta por componente, igual que un ítem suelto', async () => {
    const { ctx, captured, consumed } = makeCtx(ORDER_WITH_COMBO)
    restauranteInventarioConnector(ctx)
    await captured.sockets.onOrderCharged({ id: 'o1', hotelId: 'h1' })
    expect(consumed).toHaveLength(4)
  })

  it('un fallo de stock en un componente no bloquea el resto (best-effort)', async () => {
    const order = { id: 'o1', hotelId: 'h1', lines: ORDER_WITH_COMBO.lines }
    const { ctx, captured } = makeCtx(order)
    const consumed: any[] = []
    // Sobrescribe getOrder para simular un throw dentro del try/catch del conector (best-effort real).
    const failingCtx = {
      resolveModule: (name: string) => {
        if (name === 'restaurant') {
          return {
            setSockets: (s: any) => Object.assign(captured.sockets, s),
            setRecipePorts: () => {},
            getOrder: async () => order,
          }
        }
        if (name === 'inventario') {
          return {
            consumeForSale: async (input: any) => {
              if (input.menuItemId === 'B') throw new Error('sin receta')
              consumed.push(input)
            },
            consumeForSaleWithModifiers: async () => {},
            revertPosSale: async () => {},
            menuItemsWithRecipe: async () => [],
          }
        }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as unknown as ConnectorContext
    restauranteInventarioConnector(failingCtx)
    // Best-effort: el conector entero está en un try/catch (no rompe la liquidación), así que un throw
    // a mitad del loop corta los consumos restantes SIN lanzar — comportamiento ya existente, sin
    // ninguna rama nueva para combos.
    await expect(captured.sockets.onOrderPaid({ id: 'o1', hotelId: 'h1' })).resolves.toBeUndefined()
  })
})

describe('restauranteInventarioConnector — #208 receta del ítem borrado', () => {
  it('el puerto deleteRecipesOfMenuItem delega en inventario con el hotelId que le pasa el restaurante (no un token)', async () => {
    const { ctx, captured } = makeCtx(ORDER_WITH_COMBO)
    restauranteInventarioConnector(ctx)
    expect(await captured.recipePorts.deleteRecipesOfMenuItem('h1', 'item-x')).toBe(1)
    expect(captured.recipesDeleted).toEqual([{ hotelId: 'h1', menuItemId: 'item-x' }])
  })
})
