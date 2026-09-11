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
    const cancelBtn = (tpl.match(/<button[^>]*>Cancelar<\/button>/g) ?? [])[0]
    expect(cancelBtn, 'no se encontró el botón Cancelar del KDS').toBeDefined()
    expect(cancelBtn).toMatch(/@click="openVoid\(l, t\.order\.id\)"/)
    expect(tpl).toMatch(/<VoidReasonModal[\s\S]*@confirm="confirmVoid"[\s\S]*@close="closeVoid"/)
    expect(COCINA).toMatch(/RestaurantService\.voidLine\(voidTarget\.value\.orderId, voidTarget\.value\.line\.id, reason\)/)
  })

  it('el botón Cancelar exige restaurant:delete (el backend devolvería 403 sin él)', () => {
    expect(COCINA).toMatch(/const deletePerm = computed\(\(\) => can\('restaurant', 'delete'\)\)/)
    const tpl = COCINA.match(/<template>([\s\S]*)<\/template>/)![1]
    const cancelBtn = (tpl.match(/<button[^>]*>Cancelar<\/button>/g) ?? [])[0]
    expect(cancelBtn).toMatch(/v-if="deletePerm && /)
  })
})
