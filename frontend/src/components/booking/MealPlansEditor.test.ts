// MealPlansEditor.test.ts — REQ "Mover la gestión completa de Regímenes a Página pública":
// el componente es el mismo desde #360 (catálogo abierto por hotel), solo cambió DÓNDE se monta
// (antes Configuración Base → Regímenes, ahora Página pública → Motor de reservas). El test se
// monta directo, sin pasar por ninguna página — el componente no toma props ni depende de dónde
// vive, así el test no se rompe si vuelve a mudarse de pantalla.
//
// Contratos cubiertos:
//   1. Con lista vacía se ve el estado vacío y el botón "+ Agregar régimen".
//   2. Completar el formulario y guardar llama MealPlansService.create con
//      {name, description, priceMode, price, active}.
//   3. Eliminar (con confirm) llama MealPlansService.remove(id).
//   4. Cambiar el checkbox activo llama MealPlansService.update(id, {active}).
//   5. Editar precarga el formulario y guardar llama update(id, payload).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const mealPlanListMock = vi.fn(async (): Promise<unknown[]> => [])
const mealPlanCreateMock = vi.fn(async (_input: Record<string, unknown>) => ({}))
const mealPlanUpdateMock = vi.fn(async (_id: string, _input: Record<string, unknown>) => ({}))
const mealPlanRemoveMock = vi.fn(async (_id: string) => undefined)

vi.mock('@/services/MealPlans.service', () => ({
  MealPlansService: {
    list: () => mealPlanListMock(),
    create: (input: Record<string, unknown>) => mealPlanCreateMock(input),
    update: (id: string, input: Record<string, unknown>) => mealPlanUpdateMock(id, input),
    remove: (id: string) => mealPlanRemoveMock(id),
  },
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {}, warning: () => {} }),
}))

import MealPlansEditor from './MealPlansEditor.vue'

// Se clona en cada mock (`{ ...ROW }`): el editor muta la fila en el toggle optimista.
const ROW = {
  id: 'mp-1', hotelId: 'h1', code: 'breakfast', name: 'Desayuno incluido',
  description: 'Buffet de 7 a 10', active: true, priceMode: 'per_person_per_night', price: 12,
  sortOrder: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

async function mountEditor() {
  const w = mount(MealPlansEditor)
  await flushPromises()
  await flushPromises()
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  mealPlanListMock.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MealPlansEditor — CRUD de regímenes', () => {
  it('con lista vacía se ve el estado vacío y el botón "+ Agregar régimen"', async () => {
    const w = await mountEditor()
    expect(mealPlanListMock).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('Todavía no hay regímenes')
    const add = w.findAll('[data-testid="meal-plan-add"]')
    expect(add.length).toBeGreaterThan(0)
    expect(add[0]!.text()).toBe('+ Agregar régimen')
    expect(w.findAll('[data-testid="meal-plan-row"]')).toHaveLength(0)
  })

  it('completar el formulario y guardar llama MealPlansService.create con el payload completo', async () => {
    const w = await mountEditor()
    await w.find('[data-testid="meal-plan-add"]').trigger('click')
    await flushPromises()

    const form = w.find('[data-testid="meal-plan-form"]')
    expect(form.exists()).toBe(true)

    await form.find('[data-testid="meal-plan-name"]').setValue('Media pensión')
    await form.find('[data-testid="meal-plan-mode-supplement"]').setValue(true)
    await flushPromises()
    await form.find('[data-testid="meal-plan-price"]').setValue(15)
    await flushPromises()

    await form.find('[data-testid="meal-plan-save"]').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(mealPlanCreateMock).toHaveBeenCalledTimes(1)
    expect(mealPlanCreateMock).toHaveBeenCalledWith({
      name: 'Media pensión',
      description: '',
      priceMode: 'per_person_per_night',
      price: 15,
      active: true,
    })
    // Tras crear se recarga la lista y el formulario se cierra.
    expect(mealPlanListMock).toHaveBeenCalledTimes(2)
    expect(w.find('[data-testid="meal-plan-form"]').exists()).toBe(false)
  })

  it('guardar con nombre vacío no llama a create', async () => {
    const w = await mountEditor()
    await w.find('[data-testid="meal-plan-add"]').trigger('click')
    await flushPromises()
    await w.find('[data-testid="meal-plan-save"]').trigger('submit')
    await flushPromises()
    expect(mealPlanCreateMock).not.toHaveBeenCalled()
    expect(w.find('[data-testid="meal-plan-form"]').text()).toContain('El nombre es obligatorio')
  })

  it('con una fila, muestra nombre/descripción/precio y eliminar (confirm → true) llama remove(id)', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const w = await mountEditor()

    const rows = w.findAll('[data-testid="meal-plan-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('Desayuno incluido')
    expect(rows[0]!.text()).toContain('Buffet de 7 a 10')
    expect(rows[0]!.text()).toContain('+ $12 por persona/noche')

    await rows[0]!.find('[data-testid="meal-plan-delete"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(mealPlanRemoveMock).toHaveBeenCalledTimes(1)
    expect(mealPlanRemoveMock).toHaveBeenCalledWith('mp-1')
  })

  it('eliminar con confirm → false NO llama remove', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    vi.stubGlobal('confirm', vi.fn(() => false))
    const w = await mountEditor()
    await w.find('[data-testid="meal-plan-delete"]').trigger('click')
    await flushPromises()
    expect(mealPlanRemoveMock).not.toHaveBeenCalled()
  })

  it('cambiar el checkbox activo llama update(id, {active:false})', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    const w = await mountEditor()

    const active = w.find('[data-testid="meal-plan-active"]')
    expect((active.element as HTMLInputElement).checked).toBe(true)
    await active.setValue(false)
    await flushPromises()
    await flushPromises()

    expect(mealPlanUpdateMock).toHaveBeenCalledTimes(1)
    expect(mealPlanUpdateMock).toHaveBeenCalledWith('mp-1', { active: false })
  })

  it('Editar abre el formulario con los datos de la fila y guardar llama update(id, payload)', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    const w = await mountEditor()
    await w.find('[data-testid="meal-plan-edit"]').trigger('click')
    await flushPromises()

    const form = w.find('[data-testid="meal-plan-form"]')
    expect(form.exists()).toBe(true)
    expect((form.find('[data-testid="meal-plan-name"]').element as HTMLInputElement).value).toBe('Desayuno incluido')

    await form.find('[data-testid="meal-plan-mode-included"]').setValue(true)
    await flushPromises()
    await form.find('[data-testid="meal-plan-save"]').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(mealPlanUpdateMock).toHaveBeenCalledWith('mp-1', {
      name: 'Desayuno incluido',
      description: 'Buffet de 7 a 10',
      priceMode: 'included',
      price: 0,
      active: true,
    })
    expect(mealPlanCreateMock).not.toHaveBeenCalled()
  })
})
