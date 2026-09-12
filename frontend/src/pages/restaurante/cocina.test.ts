/**
 * cocina.test.ts — #207: cocina NO cancela platos de un toque.
 *
 * Antes, "Cancelar" en el KDS era una transición directa (`setLineStatus(line, 'cancelled')`): un dedo
 * que rozaba el botón en la tablet y el plato desaparecía sin motivo ni rastro. Ahora abre un modal de
 * motivo (VoidReasonModal) y recién al confirmar llama a `voidLine` con ese motivo.
 *
 * Dos capas:
 *  1. El modal montado de verdad (@vue/test-utils + happy-dom): cerrar no emite nada, confirmar exige
 *     motivo, "Otro" exige texto, y el motivo elegido viaja tal cual en el evento.
 *  2. El fuente de cocina.vue (mismo criterio que carta-ui.test.ts): no queda ninguna transición a
 *     `cancelled` y el botón "Cancelar" pasa por `openVoid` → `confirmVoid` → `RestaurantService.voidLine`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import VoidReasonModal from '@/components/features/restaurante/VoidReasonModal.vue'

const RAW_PAGES = import.meta.glob('./*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const COCINA = RAW_PAGES['./cocina.vue']

const REASONS = ['Sin stock', 'Cliente se arrepintió', 'Error de carga', 'Otro']

let wrapper: VueWrapper | null = null
function mountModal(props: Partial<InstanceType<typeof VoidReasonModal>['$props']> = {}) {
  wrapper = mount(VoidReasonModal, { props: { title: 'Cancelar plato', reasons: REASONS, ...props } })
  return wrapper
}
const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.trim() === text)
const confirmBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="void-confirm"]')

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('VoidReasonModal — el motivo es obligatorio', () => {
  it('muestra un botón grande por motivo y confirmar arranca deshabilitado', () => {
    mountModal()
    for (const r of REASONS) expect(buttonByText(r), `falta el botón "${r}"`).toBeDefined()
    expect(confirmBtn()?.disabled).toBe(true)
  })

  it('cerrar (Volver) emite close y NUNCA confirm — no cambia nada', async () => {
    const w = mountModal()
    buttonByText('Sin stock')!.click()
    await w.vm.$nextTick()
    buttonByText('Volver')!.click()
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('elegir un motivo y confirmar emite confirm con ese motivo exacto', async () => {
    const w = mountModal()
    buttonByText('Cliente se arrepintió')!.click()
    await w.vm.$nextTick()
    expect(confirmBtn()?.disabled).toBe(false)
    confirmBtn()!.click()
    await w.vm.$nextTick()
    expect(w.emitted('confirm')).toEqual([['Cliente se arrepintió']])
  })

  it('"Otro" exige texto: sin escribir no confirma; con texto emite el texto', async () => {
    const w = mountModal()
    buttonByText('Otro')!.click()
    await w.vm.$nextTick()
    expect(confirmBtn()?.disabled, '"Otro" sin texto no es un motivo').toBe(true)
    const ta = document.body.querySelector<HTMLTextAreaElement>('#void-other-reason')
    expect(ta).not.toBeNull()
    ta!.value = '  Se cayó al piso  '
    ta!.dispatchEvent(new Event('input'))
    await w.vm.$nextTick()
    expect(confirmBtn()?.disabled).toBe(false)
    confirmBtn()!.click()
    await w.vm.$nextTick()
    expect(w.emitted('confirm')).toEqual([['Se cayó al piso']])
  })

  it('mientras procesa (loading) no se puede confirmar ni cerrar', async () => {
    const w = mountModal({ loading: true })
    buttonByText('Sin stock')!.click()
    await w.vm.$nextTick()
    expect(confirmBtn()?.disabled).toBe(true)
    expect(buttonByText('Volver')?.disabled).toBe(true)
  })
})

describe('cocina.vue — Cancelar pasa por el modal de motivo', () => {
  it('no queda ninguna transición directa a cancelled/voided en el KDS', () => {
    expect(COCINA, 'no se pudo leer el fuente de cocina.vue').toBeTypeOf('string')
    expect(COCINA).not.toMatch(/to:\s*'cancelled'/)
    expect(COCINA).not.toMatch(/setLineStatus\([^)]*'(cancelled|voided)'/)
  })

  it('el botón Cancelar abre el modal (openVoid) y solo confirmVoid llama a voidLine con el motivo', () => {
    const tpl = COCINA.match(/<template>([\s\S]*)<\/template>/)![1]
    const cancelBtn = (tpl.match(/<button[^>]*data-testid="kds-void"[^>]*>[\s\S]*?<\/button>/g) ?? [])[0]
    expect(cancelBtn, 'no se encontró el botón Anular del KDS').toBeDefined()
    expect(cancelBtn).toMatch(/@click="openVoid\(c\.line, c\.ticket\.order\.id\)"/)
    expect(tpl).toMatch(/<VoidReasonModal[\s\S]*@confirm="confirmVoid"[\s\S]*@close="closeVoid"/)
    expect(COCINA).toMatch(/RestaurantService\.voidLine\(voidTarget\.value\.orderId, voidTarget\.value\.line\.id, reason\)/)
  })

  it('el botón Cancelar exige restaurant:delete (el backend devolvería 403 sin él)', () => {
    expect(COCINA).toMatch(/const deletePerm = computed\(\(\) => can\('restaurant', 'delete'\)\)/)
    const tpl = COCINA.match(/<template>([\s\S]*)<\/template>/)![1]
    const cancelBtn = (tpl.match(/<button[^>]*data-testid="kds-void"[^>]*>[\s\S]*?<\/button>/g) ?? [])[0]
    expect(cancelBtn).toMatch(/v-if="deletePerm && /)
  })
})

// #282 (M2): en la tablet los botones Preparar/Listo/Cancelar medían 72×28 px — por debajo de los 44 px táctiles.
describe('cocina.vue — botones de la línea aptos para el dedo (#282)', () => {
  it('Preparar/Listo y Cancelar tienen min-h-11 (44 px) y ya no py-1/text-xs', () => {
    const tpl = COCINA.match(/<template>([\s\S]*)<\/template>/)![1]
    const advanceBtn = (tpl.match(/<button[^>]*data-testid="kds-advance"[^>]*>[\s\S]*?<\/button>/g) ?? [])[0]
    const cancelBtn = (tpl.match(/<button[^>]*data-testid="kds-void"[^>]*>[\s\S]*?<\/button>/g) ?? [])[0]
    expect(advanceBtn, 'no se encontró el botón de avance del KDS').toBeDefined()
    expect(cancelBtn, 'no se encontró el botón Anular del KDS').toBeDefined()
    for (const btn of [advanceBtn, cancelBtn]) {
      expect(btn).toMatch(/min-h-11/)
      expect(btn).not.toMatch(/\bpy-1\b/)
      expect(btn).not.toMatch(/text-xs/)
    }
  })
})

describe('cocina.vue — el KDS suena también sin stream (#211, polling de respaldo)', () => {
  it('refresh() detecta comandas nuevas por diff de ids y hace beep cuando el canal no está en vivo', () => {
    const script = COCINA.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!
    const refreshFn = script.match(/async function refresh\([\s\S]*?\n}\n/)?.[0]
    expect(refreshFn, 'no se encontró refresh()').toBeDefined()
    expect(refreshFn).toMatch(/knownOrderIds/)
    expect(refreshFn).toMatch(/!knownOrderIds!\.has\(t\.order\.id\)/)
    expect(refreshFn).toMatch(/if \(arrived && live\.state\.value !== 'live'\) beep\(\)/)
    // La primera carga y el cambio de estación (spinner) no suenan.
    expect(refreshFn).toMatch(/knownOrderIds && !showSpinner/)
    // En vivo sigue sonando por el evento order.sent de la estación que se mira.
    expect(script).toMatch(/if \(e\.type === 'order\.sent' && concernsThisStation\(e\.stationIds\)\) beep\(\)/)
  })
})

describe('cocina.vue — #216 imprimir la comanda de cocina por ticket', () => {
  it('cada ticket tiene un botón de imprimir que pide la comanda de cocina de ESA orden con la estación que se mira', () => {
    const script = COCINA.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!
    const tpl = COCINA.match(/<template>([\s\S]*)<\/template>/)![1]!
    const btn = (tpl.match(/<button[^>]*data-testid="print-kitchen"[^>]*>/g) ?? [])[0]
    expect(btn, 'falta el botón de imprimir en el ticket').toBeDefined()
    expect(btn).toMatch(/@click="printTicket\(c\.ticket\)"/)
    expect(btn, 'un botón de solo ícono necesita nombre accesible').toMatch(/:aria-label=/)
    expect(script).toMatch(/import \{ openPrintTab \} from '\.\/imprimir'/)
    // Reimpresión desde el KDS: todo lo enviado (`batch: 'all'`), como el ticket en pantalla.
    expect(script).toMatch(/openPrintTab\(t\.order\.id, 'kitchen', \{ station: station\.value \|\| undefined, batch: 'all' \}\)/)
  })
})

// Tablero tipo kanban con receta: una tarjeta por PLATO en tres columnas (Pendiente → Preparando →
// Listo), se arrastra a la columna siguiente, y cada tarjeta despliega la receta del plato con
// quitar/agregar ingredientes (persistido en la línea, sin tocar precio).
describe('cocina.vue — tablero kanban con receta', () => {
  const script = () => COCINA.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!
  const tpl = () => COCINA.match(/<template>([\s\S]*)<\/template>/)![1]!

  it('tres columnas fijas new → preparing → ready y una tarjeta por línea (no por comanda)', () => {
    expect(script()).toMatch(/\{ status: 'new', label: 'Pendiente'/)
    expect(script()).toMatch(/\{ status: 'preparing', label: 'Preparando'/)
    expect(script()).toMatch(/\{ status: 'ready', label: 'Listo'/)
    expect(script()).toMatch(/tickets\.value\.flatMap\(\(t\) => t\.lines\.map\(\(line\) => \(\{ line, ticket: t \}\)\)\)/)
    expect(tpl()).toMatch(/<section v-for="col in COLUMNS"[\s\S]*@drop="onDrop\(\$event, col\.status\)"/)
    expect(tpl()).toMatch(/<article v-for="c in cardsOf\(col\.status\)"[\s\S]*:draggable="editPerm"/)
  })

  it('soltar solo avanza UN paso (misma regla que el backend) y va por setLineStatus; otra columna avisa y no llama', () => {
    const drop = script().match(/async function onDrop\([\s\S]*?\n}\n/)?.[0]
    expect(drop, 'no se encontró onDrop()').toBeDefined()
    expect(drop).toMatch(/if \(NEXT\[from\]\?\.to !== status\) \{[\s\S]*toast\.warning\([\s\S]*return/)
    expect(drop).toMatch(/await advance\(card\.line, status\)/)
    expect(script()).toMatch(/RestaurantService\.setLineStatus\(line\.id, to\)/)
  })

  it('la receta se despliega por tarjeta; quitar/agregar persiste con setLineIngredients (estado final, sin precio)', () => {
    expect(tpl()).toMatch(/data-testid="kds-recipe-toggle"[\s\S]*@click="toggleRecipe\(c\.line\.id\)"|@click="toggleRecipe\(c\.line\.id\)"[\s\S]*data-testid="kds-recipe-toggle"/)
    expect(tpl()).toMatch(/v-for="ing in c\.line\.ingredients"/)
    expect(tpl()).toMatch(/data-testid="kds-ingredient-toggle"[\s\S]*\{\{ isRemoved\(c\.line, ing\.name\) \? '↺ Poner' : '− Quitar' \}\}/)
    expect(tpl()).toMatch(/data-testid="kds-ingredient-add"/)
    expect(tpl()).toMatch(/data-testid="kds-ingredient-remove"/)
    expect(script()).toMatch(/RestaurantService\.setLineIngredients\(l\.id, changes\)/)
    // Lo que cocina ya cambió se ve siempre, aunque la receta esté plegada.
    expect(tpl()).toMatch(/data-testid="kds-changes"[\s\S]*SIN \{\{ n \}\}[\s\S]*CON \{\{ n \}\}/)
    // Sin permiso de edición no se ofrece ni quitar ni agregar (el backend daría 403).
    expect(tpl()).toMatch(/<button v-if="editPerm" type="button" @click="toggleRemoved/)
    expect(tpl()).toMatch(/<form v-if="editPerm"/)
  })

  it('modo kiosco: la ruta /panel/kds monta el mismo componente sin layout y con el mismo permiso', () => {
    expect(script()).toMatch(/const kiosk = computed\(\(\) => route\.meta\.kiosk === true\)/)
    expect(tpl()).toMatch(/<router-link v-if="!kiosk" to="\/panel\/kds"/)
    expect(tpl()).toMatch(/<router-link v-else to="\/panel\/restaurante\/cocina"/)
  })
})
