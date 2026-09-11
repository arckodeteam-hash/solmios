// PillTabs.test.ts — #203: pestañas compartidas. Render con contadores, cambio por click, cambio por
// teclado (← → Home End, activación automática) y sincronía con `?tab=` de la URL (enlace directo abre la
// pestaña, cambiar de pestaña actualiza la URL con replace, back del navegador la sigue, `tab` repetido
// toma el último, un valor inválido no toca nada).
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h, ref } from 'vue'
import PillTabs, { type PillTab } from './PillTabs.vue'

const TABS: PillTab[] = [
  { value: 'items', label: 'Ítems', count: 42 },
  { value: 'categories', label: 'Categorías', count: 3 },
  { value: 'stations', label: 'Estaciones' },
]

const tabButtons = (w: ReturnType<typeof mount>) => w.findAll('[role="tab"]')

describe('PillTabs — sin router', () => {
  it('renderiza un tab por entrada, con contador cuando lo hay, y marca la activa con aria-selected', () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'categories' } })
    const tabs = tabButtons(w)
    expect(tabs).toHaveLength(3)
    expect(w.find('[role="tablist"]').exists()).toBe(true)
    expect(tabs[0].text()).toBe('Ítems(42)')
    expect(tabs[2].text()).toBe('Estaciones')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(tabs[0].attributes('aria-selected')).toBe('false')
    // Roving tabindex: solo la activa entra en el orden de tabulación.
    expect(tabs[1].attributes('tabindex')).toBe('0')
    expect(tabs[0].attributes('tabindex')).toBe('-1')
  })

  it('click emite update:modelValue con el value de la pestaña; click en la activa no emite', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' } })
    await tabButtons(w)[2].trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([['stations']])
    await tabButtons(w)[0].trigger('click')
    expect(w.emitted('update:modelValue')).toHaveLength(1)
  })

  it('teclado: → ← avanzan/retroceden en círculo, Home/End van a los extremos', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' }, attachTo: document.body })
    const tabs = tabButtons(w)
    await tabs[0].trigger('keydown', { key: 'ArrowRight' })
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['categories'])
    await tabs[0].trigger('keydown', { key: 'ArrowLeft' })   // desde la primera → circular a la última
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['stations'])
    // Una tecla ajena no emite nada nuevo.
    const before = w.emitted('update:modelValue')?.length
    await tabs[1].trigger('keydown', { key: 'Enter' })
    expect(w.emitted('update:modelValue')?.length).toBe(before)
    w.unmount()

    // Home/End desde la del medio (la activa no re-emite: por eso se monta con 'categories').
    const w2 = mount(PillTabs, { props: { tabs: TABS, modelValue: 'categories' }, attachTo: document.body })
    await tabButtons(w2)[1].trigger('keydown', { key: 'End' })
    expect(w2.emitted('update:modelValue')?.at(-1)).toEqual(['stations'])
    await tabButtons(w2)[1].trigger('keydown', { key: 'Home' })
    expect(w2.emitted('update:modelValue')?.at(-1)).toEqual(['items'])
    w2.unmount()
  })
})

// Host mínimo con v-model real para probar la sincronía con la URL de punta a punta.
const Host = defineComponent({
  props: { initial: { type: String, default: 'items' } },
  setup(props) {
    const tab = ref(props.initial)
    return { tab }
  },
  render() {
    return h('div', [
      h(PillTabs, { tabs: TABS, modelValue: this.tab, queryParam: 'tab', 'onUpdate:modelValue': (v: string) => { this.tab = v } }),
      h('output', { 'data-testid': 'active' }, this.tab),
    ])
  },
})

async function mountWithRouter(initialUrl: string, initial = 'items') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/carta', component: Host }] })
  router.push(initialUrl)
  await router.isReady()
  const w = mount(Host, { props: { initial }, global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

describe('PillTabs — sincronía con ?tab= (queryParam)', () => {
  it('un enlace directo ?tab=stations abre esa pestaña al montar', async () => {
    const { w } = await mountWithRouter('/carta?tab=stations')
    expect(w.find('[data-testid="active"]').text()).toBe('stations')
    expect(tabButtons(w)[2].attributes('aria-selected')).toBe('true')
  })

  it('un ?tab= inválido se ignora y queda la pestaña por defecto', async () => {
    const { w, router } = await mountWithRouter('/carta?tab=nope')
    expect(w.find('[data-testid="active"]').text()).toBe('items')
    expect(router.currentRoute.value.query.tab).toBe('nope')   // no reescribe la URL sola
  })

  it('cambiar de pestaña actualiza la URL (replace) conservando el resto de la query', async () => {
    const { w, router } = await mountWithRouter('/carta?foo=1')
    await tabButtons(w)[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ foo: '1', tab: 'categories' })
    expect(w.find('[data-testid="active"]').text()).toBe('categories')
  })

  it('si la URL cambia por fuera (back del navegador), la pestaña la sigue', async () => {
    const { w, router } = await mountWithRouter('/carta?tab=combos-no')
    await router.push('/carta?tab=stations')
    await flushPromises()
    expect(w.find('[data-testid="active"]').text()).toBe('stations')
  })

  it('con ?tab repetido toma el último', async () => {
    const { w } = await mountWithRouter('/carta?tab=items&tab=categories')
    expect(w.find('[data-testid="active"]').text()).toBe('categories')
  })
})
