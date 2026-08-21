/**
 * Auditoría del módulo restaurante — regresiones de UI de la carta (BUG-resto-fin).
 *
 * Dos hallazgos menores que quedaron abiertos:
 *  1. El input de cantidad de la receta (BOM) declaraba `min="0"` mientras el negocio exige
 *     qty > 0 por línea (0 = "Quitar", que es otro botón): el input anunciaba 0 como válido y
 *     lo salvaba el guard del handler (`addRecipeLine`).
 *  2. Las ESTACIONES conservaban orden manual por número (`sortOrder` a mano en el modal)
 *     cuando el spec F8 ya había migrado categorías e ítems al drag-and-drop HTML5 nativo.
 *
 * Test sobre el FUENTE (mismo criterio que form-fields-a11y.test.ts): el defecto que cuidamos
 * es declarativo — montar la página exige router, Pinia y ~7 services mockeados.
 */
import { describe, it, expect } from 'vitest'

const RAW_PAGES = import.meta.glob('./*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const CARTA = RAW_PAGES['./carta.vue']

function carta(): string {
  expect(CARTA, 'no se pudo leer el fuente de carta.vue').toBeTypeOf('string')
  return CARTA
}

function templateOf(src: string): string {
  const m = src.match(/<template>([\s\S]*)<\/template>/)
  expect(m, 'carta.vue: no se encontró el bloque <template>').not.toBeNull()
  return m![1]
}

describe('carta — la cantidad de receta exige qty > 0', () => {
  it('el input de cantidad de la receta NO declara min="0"', () => {
    const tpl = templateOf(carta())
    const tag = (tpl.match(/<input[^>]*newRecipe\.quantity[^>]*>/g) ?? [])[0]
    expect(tag, 'no se encontró el input de cantidad de receta').toBeDefined()
    expect(tag, 'min="0" anuncia 0 como válido: 0 es "Quitar", no una cantidad').not.toMatch(/min="0"/)
  })

  it('el input de cantidad de receta declara un min que excluye el 0', () => {
    const tpl = templateOf(carta())
    const tag = (tpl.match(/<input[^>]*newRecipe\.quantity[^>]*>/g) ?? [])[0]
    expect(tag).toBeDefined()
    expect(tag).toMatch(/min="0\.0\d+"/)
  })
})

describe('carta — F8: las estaciones se reordenan por arrastre, no por número', () => {
  it('la fila de estación tiene el handle draggable y escucha dragover/drop', () => {
    const tpl = templateOf(carta())
    expect(tpl).toMatch(/onStationDragStart\(\$event, s\)/)
    expect(tpl).toMatch(/@dragover\.prevent="onStationDragOver\(s\)"/)
    expect(tpl).toMatch(/@drop\.prevent="onStationDrop"/)
  })

  it('el drop persiste el orden por PUT parcial de sortOrder (persistOrder + updateStation)', () => {
    const src = carta()
    expect(src).toMatch(/persistOrder\(changed, \(id, sortOrder\) => RestaurantService\.updateStation\(id, \{ sortOrder \}\)\)/)
  })

  it('ningún modal de la carta ofrece escribir sortOrder a mano (categorías, ítems y estaciones)', () => {
    // F8: el orden se calcula al crear y se mueve arrastrando. Si algún modal vuelve a exponer
    // `key: 'sortOrder'`, está pisando el resultado del último reorder apenas se guarde.
    expect(carta()).not.toMatch(/key:\s*'sortOrder'/)
  })
})
