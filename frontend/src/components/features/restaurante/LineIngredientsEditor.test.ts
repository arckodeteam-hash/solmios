/**
 * LineIngredientsEditor.test.ts — receta de un plato con quitar / doble / agregar, compartida por el
 * KDS y la comanda. Monta el componente de verdad (@vue/test-utils + happy-dom) con el servicio
 * mockeado: cada toque manda el ESTADO FINAL de la anotación a setLineIngredients, "sin" y "doble"
 * del mismo ingrediente se excluyen, y sin `editable` no hay ningún control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LineIngredientsEditor from './LineIngredientsEditor.vue'
import type { OrderLine } from '@/services/Restaurant.service'

const setLineIngredients = vi.fn()
const menuItemIngredients = vi.fn()
vi.mock('@/services/Restaurant.service', () => ({
  RestaurantService: {
    setLineIngredients: (...a: unknown[]) => setLineIngredients(...a),
    menuItemIngredients: (...a: unknown[]) => menuItemIngredients(...a),
  },
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }))

const RECIPE = [{ name: 'Harina', quantity: 0.25, unit: 'kg' }, { name: 'Queso', quantity: 0.1, unit: 'kg' }]
const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 'l1', hotelId: 'h1', orderId: 'o1', menuItemId: 'm1', name: 'Pizza', unitPrice: 10, quantity: 2, status: 'new', lineTotal: 20, ...over,
})

beforeEach(() => {
  setLineIngredients.mockReset()
  menuItemIngredients.mockReset()
  setLineIngredients.mockImplementation(async (_id: string, c: unknown) => line({ ingredientChanges: c as OrderLine['ingredientChanges'] }))
})

describe('LineIngredientsEditor', () => {
  it('desplegado muestra la receta con la cantidad × unidades del plato; quitar manda SIN y emite la línea guardada', async () => {
    const w = mount(LineIngredientsEditor, { props: { line: line(), ingredients: RECIPE, editable: true, open: true } })
    expect(w.text()).toContain('Harina')
    expect(w.text()).toContain('0.5 kg')   // 0.25 × 2 unidades
    await w.findAll('[data-testid="ingredient-remove"]')[0]!.trigger('click')
    await Promise.resolve()
    expect(setLineIngredients).toHaveBeenCalledWith('l1', { removed: ['Harina'], added: [], doubled: [] })
    expect(w.emitted('updated')?.[0]?.[0]).toMatchObject({ ingredientChanges: { removed: ['Harina'] } })
  })

  it('doble manda DOBLE, duplica la cantidad mostrada y saca el SIN del mismo ingrediente', async () => {
    const w = mount(LineIngredientsEditor, { props: { line: line({ ingredientChanges: { removed: ['Queso'], added: [], doubled: [] } }), ingredients: RECIPE, editable: true, open: true } })
    await w.findAll('[data-testid="ingredient-double"]')[1]!.trigger('click')   // Queso
    expect(setLineIngredients).toHaveBeenCalledWith('l1', { removed: [], added: [], doubled: ['Queso'] })
    await w.setProps({ line: line({ ingredientChanges: { removed: [], added: [], doubled: ['Queso'] } }) })
    expect(w.text()).toContain('Queso ×2')
    expect(w.text()).toContain('0.4 kg')   // 0.1 × 2 unidades × 2 (doble)
    expect(w.text()).toContain('DOBLE Queso')
  })

  it('agregar por texto manda CON; el campo se vacía', async () => {
    const w = mount(LineIngredientsEditor, { props: { line: line(), ingredients: RECIPE, editable: true, open: true } })
    const input = w.find('[data-testid="ingredient-input"]')
    await input.setValue('Aceitunas')
    await w.find('[data-testid="ingredient-add"]').trigger('submit')
    expect(setLineIngredients).toHaveBeenCalledWith('l1', { removed: [], added: ['Aceitunas'], doubled: [] })
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('sin receta pasada por props la pide al desplegar (comanda del mozo), una sola vez', async () => {
    menuItemIngredients.mockResolvedValue(RECIPE)
    const w = mount(LineIngredientsEditor, { props: { line: line(), editable: true } })
    expect(menuItemIngredients).not.toHaveBeenCalled()
    await w.find('[data-testid="ingredients-toggle"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(menuItemIngredients).toHaveBeenCalledWith('m1')
    expect(w.text()).toContain('Harina')
    await w.find('[data-testid="ingredients-toggle"]').trigger('click')
    await w.find('[data-testid="ingredients-toggle"]').trigger('click')
    expect(menuItemIngredients).toHaveBeenCalledTimes(1)
  })

  it('sin `editable` muestra los cambios pero ningún botón ni campo', () => {
    const w = mount(LineIngredientsEditor, { props: { line: line({ ingredientChanges: { removed: ['Harina'], added: ['Aceitunas'], doubled: [] } }), ingredients: RECIPE, open: true } })
    expect(w.text()).toContain('SIN Harina')
    expect(w.text()).toContain('CON Aceitunas')
    expect(w.findAll('[data-testid="ingredient-remove"]').length).toBe(0)
    expect(w.find('[data-testid="ingredient-input"]').exists()).toBe(false)
  })
})
