// PillTabs.test.ts — render, cambio por click, cambio por teclado, sincronía con ?tab= (REST-01).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'

const mockRoute = reactive<{ query: Record<string, unknown> }>({ query: {} })
const replaceMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ replace: replaceMock }),
}))

import PillTabs from './PillTabs.vue'

const TABS = [
  { value: 'items', label: 'Ítems', count: 42 },
  { value: 'categorias', label: 'Categorías', count: 3 },
  { value: 'combos', label: 'Combos' },
]

beforeEach(() => {
  mockRoute.query = {}
  replaceMock.mockClear()
})

describe('PillTabs — render', () => {
  it('renderiza una pestaña por tab, con el contador cuando viene', () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' } })
    const tabs = w.findAll('[role="tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].text()).toBe('Ítems (42)')
    expect(tabs[1].text()).toBe('Categorías (3)')
    expect(tabs[2].text()).toBe('Combos') // sin count: sin paréntesis
  })

  it('aria-selected refleja la pestaña activa; role="tablist" en el contenedor', () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'categorias' } })
    expect(w.find('[role="tablist"]').exists()).toBe(true)
    const tabs = w.findAll('[role="tab"]')
    expect(tabs[0].attributes('aria-selected')).toBe('false')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(tabs[2].attributes('aria-selected')).toBe('false')
  })

  it('roving tabindex: solo la pestaña activa tiene tabindex 0', () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'combos' } })
    const tabs = w.findAll('[role="tab"]')
    expect(tabs[0].attributes('tabindex')).toBe('-1')
    expect(tabs[2].attributes('tabindex')).toBe('0')
  })
})

describe('PillTabs — cambio por click', () => {
  it('click en otra pestaña emite update:modelValue', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' } })
    await w.findAll('[role="tab"]')[2].trigger('click')
    expect(w.emitted('update:modelValue')![0]).toEqual(['combos'])
  })

  it('click en la pestaña ya activa no emite de nuevo', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' } })
    await w.findAll('[role="tab"]')[0].trigger('click')
    expect(w.emitted('update:modelValue')).toBeFalsy()
  })
})

describe('PillTabs — cambio por teclado', () => {
  it('ArrowRight mueve a la siguiente pestaña (con wraparound)', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'combos' } })
    await w.find('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    expect(w.emitted('update:modelValue')![0]).toEqual(['items'])
  })

  it('ArrowLeft mueve a la pestaña anterior', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'combos' } })
    await w.find('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(w.emitted('update:modelValue')![0]).toEqual(['categorias'])
  })

  it('Home va a la primera pestaña', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'categorias' } })
    await w.find('[role="tablist"]').trigger('keydown', { key: 'Home' })
    expect(w.emitted('update:modelValue')![0]).toEqual(['items'])
  })

  it('End va a la última pestaña', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'categorias' } })
    await w.find('[role="tablist"]').trigger('keydown', { key: 'End' })
    expect(w.emitted('update:modelValue')![0]).toEqual(['combos'])
  })

  it('una tecla que no es de navegación no emite nada', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' } })
    await w.find('[role="tablist"]').trigger('keydown', { key: 'Tab' })
    expect(w.emitted('update:modelValue')).toBeFalsy()
  })
})

describe('PillTabs — sincronía con query', () => {
  it('sin syncQuery, ignora la query aunque traiga un tab válido', () => {
    mockRoute.query = { tab: 'combos' }
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' } })
    expect(w.emitted('update:modelValue')).toBeFalsy()
  })

  it('con syncQuery, adopta el tab de la URL si es válido (F5 conserva la pestaña)', () => {
    mockRoute.query = { tab: 'combos' }
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items', syncQuery: true } })
    expect(w.emitted('update:modelValue')![0]).toEqual(['combos'])
  })

  it('tolera query.tab como array (toma el último valor)', () => {
    mockRoute.query = { tab: ['items', 'combos'] }
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items', syncQuery: true } })
    expect(w.emitted('update:modelValue')![0]).toEqual(['combos'])
  })

  it('un tab inválido en la query no pisa el modelValue', () => {
    mockRoute.query = { tab: 'no-existe' }
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items', syncQuery: true } })
    expect(w.emitted('update:modelValue')).toBeFalsy()
  })

  it('con syncQuery, cambiar de pestaña actualiza la URL vía router.replace', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items', syncQuery: true } })
    await w.findAll('[role="tab"]')[2].trigger('click')
    expect(replaceMock).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ tab: 'combos' }) }))
  })

  it('sin syncQuery, cambiar de pestaña NO toca el router', async () => {
    const w = mount(PillTabs, { props: { tabs: TABS, modelValue: 'items' } })
    await w.findAll('[role="tab"]')[2].trigger('click')
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
