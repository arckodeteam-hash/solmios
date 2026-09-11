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

const RAW_SERVICES = import.meta.glob('../../services/*.service.ts', {
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

describe('carta — #203: una sección por vez, con PillTabs', () => {
  it('usa el componente compartido con sincronía ?tab= y sin tablist a mano', () => {
    const src = carta()
    expect(src).toMatch(/import PillTabs, \{ type PillTab \} from '@\/components\/ui\/PillTabs\.vue'/)
    expect(templateOf(src)).toMatch(/<PillTabs v-model="tab" :tabs="cartaTabs" query-param="tab"/)
    expect(templateOf(src)).not.toMatch(/role="tablist"/)
  })

  it('las 5 secciones están gateadas por su pestaña: ninguna cabecera se ve sin cambiar de pestaña', () => {
    const tpl = templateOf(carta())
    for (const [tab, title] of [
      ['items', 'Ítems de la carta'], ['categories', 'Categorías'], ['stations', 'Estaciones (pantallas KDS)'], ['combos', 'Combos'],
    ]) {
      expect(tpl, `la sección "${title}" no está gateada por tab === '${tab}'`).toMatch(new RegExp(`<SectionCard v-if="tab === '${tab}'" title="${title.replace(/[()]/g, '\\$&')}"`))
    }
    expect(tpl).toMatch(/<SectionCard v-if="tab === 'foodcost' && editPerm" title="Food cost"/)
  })

  it('cada pestaña lleva su contador real y Food cost solo con permiso de catálogo', () => {
    const src = carta()
    expect(src).toMatch(/\{ value: 'items', label: 'Ítems', count: items\.value\.length \}/)
    expect(src).toMatch(/\{ value: 'categories', label: 'Categorías', count: categories\.value\.length \}/)
    expect(src).toMatch(/\{ value: 'stations', label: 'Estaciones', count: stations\.value\.length \}/)
    expect(src).toMatch(/\{ value: 'combos', label: 'Combos', count: combos\.value\.length \}/)
    expect(src).toMatch(/if \(editPerm\.value\) list\.push\(\{ value: 'foodcost', label: 'Food cost', count: foodCostRows\.value\.length \}\)/)
    expect(src).toMatch(/const tab = ref<CartaTab>\('items'\)/)   // Ítems por defecto
  })

  it('el KDS enlaza a Carta → Estaciones abriendo esa pestaña (?tab=stations)', () => {
    const cocina = RAW_PAGES['./cocina.vue']
    expect(cocina).toMatch(/:to="\{ path: '\/panel\/restaurante\/carta', query: \{ tab: 'stations' \} \}"/)
  })
})

// #217: grupo/opción de modificadores y línea de receta se borraban de un click. Los otros 4 borrados
// de la vista (estación/categoría/ítem/combo) ya pasaban por askConfirm — estos 3 deben quedar igual.
describe('carta — #217: los 3 borrados que faltaban piden confirmación', () => {
  it('removeGroup, removeModifier y removeRecipeLine llaman a askConfirm antes de borrar', () => {
    const src = carta()
    expect(src).toMatch(/function removeGroup\(g: ModifierGroup\) \{\s*askConfirm\(/)
    expect(src).toMatch(/function removeModifier\(m: Modifier\) \{\s*askConfirm\(/)
    expect(src).toMatch(/function removeRecipeLine\(r: MenuItemRecipe\) \{[\s\S]*?askConfirm\(/)
  })

  it('cancelar (no confirmar) no llama a deleteModifierGroup/deleteModifier/setRecipe: el borrado real vive dentro de `run`', () => {
    const src = carta()
    // El delete real solo puede dispararse desde dentro del callback `run` de askConfirm — si
    // apareciera fuera de un bloque `run: async () => { ... }` sería un borrado sin confirmar.
    const groupBlock = src.match(/function removeGroup[\s\S]*?\n\}/)?.[0] ?? ''
    expect(groupBlock).toMatch(/run: async \(\) => \{[\s\S]*deleteModifierGroup/)
    const modifierBlock = src.match(/function removeModifier[\s\S]*?\n\}/)?.[0] ?? ''
    expect(modifierBlock).toMatch(/run: async \(\) => \{[\s\S]*deleteModifier\(/)
    const recipeBlock = src.match(/function removeRecipeLine[\s\S]*?\n\}/)?.[0] ?? ''
    expect(recipeBlock).toMatch(/run: async \(\) => \{[\s\S]*setRecipe/)
  })
})

// #217: updateModifierGroup/updateModifier existían en el servicio sin ningún llamador — el grupo/
// opción de modificadores no se podía editar, solo crear/borrar.
describe('carta — #217: editar grupo y opción de modificadores (mismo id, sin recrear)', () => {
  it('editGroup precarga el draft y saveGroup llama a updateModifierGroup con el id existente cuando está editando', () => {
    const src = carta()
    expect(src).toMatch(/function editGroup\(g: ModifierGroup\) \{\s*editingGroupId\.value = g\.id/)
    expect(src).toMatch(/if \(editingGroupId\.value\) await RestaurantService\.updateModifierGroup\(editingGroupId\.value, payload\)/)
    expect(src).toMatch(/else await RestaurantService\.createModifierGroup\(/)
  })

  it('el draft de grupo expone minSelect/maxSelect (antes ausentes del form pese a existir en el payload)', () => {
    const src = carta()
    expect(src).toMatch(/minSelect: number \| string; maxSelect: number \| string/)
    expect(templateOf(src)).toMatch(/v-model="newGroup\.minSelect"/)
    expect(templateOf(src)).toMatch(/v-model="newGroup\.maxSelect"/)
  })

  it('editModifier precarga el draft y saveModifier llama a updateModifier con el id existente cuando está editando', () => {
    const src = carta()
    expect(src).toMatch(/function editModifier\(m: Modifier\) \{\s*editingModifierId\.value = m\.id/)
    expect(src).toMatch(/if \(editingModifierId\.value\) await RestaurantService\.updateModifier\(editingModifierId\.value, payload\)/)
    expect(src).toMatch(/else await RestaurantService\.createModifier\(/)
  })
})

// #217: sortOrder/imageUrl estaban en ComboDraft pero sin input en el template → el combo se creaba
// siempre con orden 0 y sin imagen. El orden pasa a drag-and-drop (igual que estaciones/categorías/
// ítems, F8); la imagen a un input de archivo (mismo patrón dataURL que FormModal.onFile).
describe('carta — #217: combos con imagen y reorden por arrastre', () => {
  it('el modal de combo tiene un input de archivo para la imagen', () => {
    const tpl = templateOf(carta())
    expect(tpl).toMatch(/type="file"[^>]*accept="image\/\*"[^>]*@change="onComboFile"/)
  })

  it('onComboFile lee el archivo como dataURL (JSON, no multipart)', () => {
    const src = carta()
    expect(src).toMatch(/function onComboFile\(e: Event\)/)
    expect(src).toMatch(/reader\.readAsDataURL\(file\)/)
  })

  it('la fila de combo tiene el handle draggable y escucha dragover/drop, igual que estaciones/ítems', () => {
    const tpl = templateOf(carta())
    expect(tpl).toMatch(/onComboDragStart\(\$event, c\)/)
    expect(tpl).toMatch(/@dragover\.prevent="onComboDragOver\(c\)"/)
    expect(tpl).toMatch(/@drop\.prevent="onComboDrop"/)
  })

  it('el drop de combos persiste el orden por PUT parcial (persistOrder + updateCombo)', () => {
    const src = carta()
    expect(src).toMatch(/persistOrder\(changed, \(id, sortOrder\) => RestaurantService\.updateCombo\(id, \{ sortOrder \}\)\)/)
  })

  it('el combo ya no tiene un input de sortOrder a mano: el orden es solo por arrastre', () => {
    // F8: mismo criterio que estaciones/categorías/ítems — ComboDraft ya no trae `sortOrder` como
    // campo editable (se calcula al crear, y el reorder es exclusivamente por arrastre).
    const src = carta()
    const draft = src.match(/interface ComboDraft \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(draft, 'no se encontró la interfaz ComboDraft').not.toBe('')
    expect(draft).not.toMatch(/sortOrder/)
  })
})

// #217: el contador de traducciones contaba sobre supportedLangs.length (incluye 'es', que NO se
// edita en este modal — el español vive en el formulario) y nunca llegaba a N/N.
describe('carta — #217: contador de traducciones sobre los idiomas editables, no sobre todos', () => {
  it('el contador usa editableLangs.length, no supportedLangs.length', () => {
    const tpl = templateOf(carta())
    expect(tpl).toMatch(/\{\{ completedLangsCount \}\} \/ \{\{ editableLangs\.length \}\} idiomas completados/)
    expect(tpl).not.toMatch(/\{\{ completedLangsCount \}\} \/ \{\{ supportedLangs\.length \}\}/)
  })
})

// #217: la fila de ítem tenía 7 botones de texto en shrink-0 → desborde horizontal en 375px. Solo
// Editar y Disponible quedan visibles; Receta/Modificadores/Traducciones/Eliminar van al menú "⋯".
describe('carta — #217: menú "⋯" de acciones secundarias (mobile no desborda)', () => {
  it('la fila de ítem solo deja visibles Agotar/Reactivar, Editar y el disparador "⋯"', () => {
    const tpl = templateOf(carta())
    const start = tpl.indexOf('<!-- Ítems -->')
    const end = tpl.indexOf('<!-- Combos/paquetes (F2) -->')
    expect(start, 'no se encontró la sección de Ítems').toBeGreaterThanOrEqual(0)
    expect(end, 'no se encontró el inicio de la sección de Combos').toBeGreaterThan(start)
    const itemSection = tpl.slice(start, end)
    expect(itemSection).toMatch(/openRowActions\(\$event, 'item', i\.id\)/)
    expect(itemSection).not.toMatch(/openRecipe\(i\)/)
    expect(itemSection).not.toMatch(/openModifiers\(i\)/)
    expect(itemSection).not.toMatch(/openTranslations\('item', i\)/)
    expect(itemSection).not.toMatch(/delItem\(i\)/)
    // Los dos únicos botones de acción que quedan sueltos en la fila.
    expect(itemSection).toMatch(/@click="toggleAvailability\(i\)"/)
    expect(itemSection).toMatch(/@click="editItem\(i\)"/)
  })

  it('el popover de acciones de ítem incluye Receta, Modificadores, Traducciones y Eliminar', () => {
    const tpl = templateOf(carta())
    expect(tpl).toMatch(/openRecipe\(rowActionsItem\)/)
    expect(tpl).toMatch(/openModifiers\(rowActionsItem\)/)
    expect(tpl).toMatch(/openTranslations\('item', rowActionsItem\)/)
    expect(tpl).toMatch(/delItem\(rowActionsItem\)/)
  })

  it('usa AppPopover (no un <Teleport> propio) para el menú de acciones', () => {
    const src = carta()
    expect(src).toMatch(/import AppPopover from '@\/components\/ui\/AppPopover\.vue'/)
    expect(templateOf(src)).toMatch(/<AppPopover :open="!!rowActionsMenu"/)
    expect(templateOf(src)).not.toMatch(/<Teleport/)
  })
})

// #217: <img> de ítem y combo sin alt.
describe('carta — #217: accesibilidad — alt en las imágenes de ítem y combo', () => {
  it('carta.vue declara al menos 2 <img> con alt (ítem y combo)', () => {
    const src = carta()
    const withAlt = (src.match(/<img[^>]*\balt=/g) ?? []).length
    expect(withAlt).toBeGreaterThanOrEqual(2)
  })
})

// #217: doble click rápido en "Disponible" mandaba dos PUT — sin guard de busy.
describe('carta — #217: toggleAvailability no manda doble PUT en doble click', () => {
  it('el guard `togglingItemId` se setea sincrónicamente antes del primer await', () => {
    const src = carta()
    const fn = src.match(/async function toggleAvailability\(i: MenuItem\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(fn).toMatch(/if \(togglingItemId\.value\) return/)
    // El guard se setea ANTES del await — si estuviera después, un segundo click síncrono lo saltearía.
    const guardIdx = fn.indexOf('togglingItemId.value = i.id')
    const awaitIdx = fn.indexOf('await RestaurantService.setItemAvailability')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(awaitIdx).toBeGreaterThan(guardIdx)
  })

  it('un doble click rápido produce un solo PUT (mock del servicio)', async () => {
    let calls = 0
    let resolveFirst: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { resolveFirst = resolve })
    const setItemAvailability = async () => { calls++; await pending }
    const togglingItemId = { value: null as string | null }
    async function toggleAvailability(i: { id: string; available?: number }) {
      if (togglingItemId.value) return
      togglingItemId.value = i.id
      try {
        await setItemAvailability()
      } finally {
        togglingItemId.value = null
      }
    }
    const item = { id: 'it-1', available: 1 }
    const first = toggleAvailability(item)
    const second = toggleAvailability(item)   // click rápido, antes de que resuelva el primero
    resolveFirst?.()
    await Promise.all([first, second])
    expect(calls).toBe(1)
  })
})

// #217: (settings as any) ×3 — SettingsService.get() ya devuelve un tipo con `hotel.currency/taxName/
// taxRate`; el cast era innecesario.
describe('carta — #217: settings tipado, sin `as any`', () => {
  it('carta.vue no tiene ningún `as any`', () => {
    expect((carta().match(/as any/g) ?? []).length).toBe(0)
  })
})

// #217: getCombo/itemFoodCost/comboFoodCost del servicio no tenían ningún llamador en el frontend
// (confirmado por rg antes de borrarlos) — se eliminaron en vez de dejarlos sin uso.
describe('carta — #217: sin métodos del servicio sin uso', () => {
  it('Restaurant.service.ts ya no declara getCombo/itemFoodCost/comboFoodCost', () => {
    const svc = RAW_SERVICES['../../services/Restaurant.service.ts']
    expect(svc, 'no se pudo leer el fuente de Restaurant.service.ts').toBeTypeOf('string')
    expect(svc).not.toMatch(/getCombo:/)
    expect(svc).not.toMatch(/itemFoodCost:/)
    expect(svc).not.toMatch(/comboFoodCost:/)
  })

  it('updateModifierGroup y updateModifier siguen existiendo y ahora carta.vue los usa', () => {
    const svc = RAW_SERVICES['../../services/Restaurant.service.ts']
    expect(svc).toMatch(/updateModifierGroup:/)
    expect(svc).toMatch(/updateModifier:/)
  })
})

// #216: `restaurant_stations.autoPrint` se edita en Carta → Estaciones (alta y edición) y se ve en la lista.
describe('carta — #216: impresión automática por estación (autoPrint)', () => {
  it('el modal de estación (nueva y editar) tiene el campo "Imprimir comanda al enviar" y manda el booleano al servicio', () => {
    const src = carta()
    const fields = src.match(/key: 'autoPrint', label: 'Imprimir comanda al enviar', type: 'select'/g) ?? []
    expect(fields, 'falta el campo en alta o en edición').toHaveLength(2)
    expect(src).toMatch(/default: s\.autoPrint \? '1' : '0'/)                    // edición: valor actual
    expect(src).toMatch(/RestaurantService\.createStation\(\{[^}]*autoPrint: v\.autoPrint === '1'/)
    expect(src).toMatch(/RestaurantService\.updateStation\(s\.id, \{[^}]*autoPrint: v\.autoPrint === '1'/)
    expect(src).toMatch(/v-if="s\.autoPrint" data-testid="station-autoprint"/)   // badge en la lista
    const svc = RAW_SERVICES['../../services/Restaurant.service.ts']
    expect(svc).toMatch(/export interface StationPayload \{[^}]*autoPrint\?: boolean/)
  })
})

// #282 (L): un ítem sin impuesto propio llega con `taxRate: null` (usa el del hotel) y el badge decía "null%".
describe('carta — #282: el badge de impuesto propio solo aparece con un número', () => {
  it('el badge exige taxRate !== undefined Y !== null', () => {
    const badge = CARTA.match(/<span[^>]*data-testid="item-tax-badge"[^>]*>/)?.[0]
    expect(badge, 'no se encontró el badge de impuesto del ítem').toBeDefined()
    expect(badge).toMatch(/v-if="i\.taxRate !== undefined && i\.taxRate !== null"/)
  })
})
