// MealPlansEditor.test.ts — #361: CRUD ABIERTO de regímenes (Configuración Base → Regímenes).
// Antes era un enum fijo de 3 códigos con "Guardar regímenes"; ahora: lista, alta, edición,
// baja con confirmación y toggle activo/inactivo por fila, cada acción contra su endpoint.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { MealPlan } from '@/services/MealPlans.service'

const list = vi.fn<() => Promise<MealPlan[]>>()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()

vi.mock('@/services/MealPlans.service', () => ({
  MealPlansService: {
    list: () => list(),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}))
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: toastSuccess, error: toastError, info: () => {} }) }))

import MealPlansEditor from './MealPlansEditor.vue'

function plan(over: Partial<MealPlan> = {}): MealPlan {
  return {
    id: 'mp1', hotelId: 'h1', code: 'breakfast', name: 'Desayuno incluido', description: null,
    active: true, priceMode: 'included', price: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...over,
  }
}

const CATALOG: MealPlan[] = [
  plan(),
  plan({ id: 'mp2', code: 'media_pension', name: 'Media pensión', description: 'Desayuno y cena', priceMode: 'per_person_per_night', price: 25 }),
  plan({ id: 'mp3', code: 'todo_incluido', name: 'Todo incluido', active: false }),
]

// AppModal/ConfirmModal teleportan a body: con el stub el contenido queda dentro del wrapper.
const MOUNT_OPTS = { props: { currency: 'USD' }, global: { stubs: { teleport: true } } }

beforeEach(() => {
  list.mockReset().mockResolvedValue(CATALOG.map((p) => ({ ...p })))
  create.mockReset().mockImplementation(async (input: any) => plan({ id: 'new', code: 'nuevo', ...input }))
  update.mockReset().mockImplementation(async (id: string, input: any) => ({ ...CATALOG.find((p) => p.id === id)!, ...input }))
  remove.mockReset().mockResolvedValue({ id: 'x', deleted: true })
  toastError.mockClear()
  toastSuccess.mockClear()
})

async function mountEditor() {
  const w = mount(MealPlansEditor, MOUNT_OPTS)
  await flushPromises()
  return w
}

describe('MealPlansEditor (#361) — lista', () => {
  it('renderiza una fila por régimen con nombre, descripción, suplemento y estado', async () => {
    const w = await mountEditor()
    const rows = w.findAll('[data-testid=meal-plan-row]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Desayuno incluido')
    expect(rows[0].text()).toContain('Incluido en la tarifa')
    expect(rows[0].text()).toContain('Activo')
    expect(rows[1].text()).toContain('Media pensión')
    expect(rows[1].text()).toContain('Desayuno y cena')
    expect(rows[1].text()).toContain('$25.00 por persona y noche')
    expect(rows[2].text()).toContain('Inactivo')
    // Nada hardcodeado: ni el "Solo alojamiento" implícito de antes, ni "Guardar regímenes".
    expect(w.text()).not.toContain('Guardar regímenes')
    expect(w.text()).not.toContain('Siempre disponible')
  })

  it('lista vacía → estado vacío con invitación a agregar', async () => {
    list.mockResolvedValue([])
    const w = await mountEditor()
    expect(w.findAll('[data-testid=meal-plan-row]')).toHaveLength(0)
    expect(w.find('[data-testid=meal-plan-empty]').exists()).toBe(true)
    expect(w.text()).toContain('Todavía no cargaste regímenes')
    expect(w.find('[data-testid=meal-plan-add]').exists()).toBe(true)
  })

  it('error de carga → mensaje con reintentar', async () => {
    list.mockRejectedValueOnce(new Error('boom'))
    const w = await mountEditor()
    expect(w.text()).toContain('No pudimos cargar los regímenes')
    expect(w.text()).toContain('boom')
    await w.findAll('button').find((b) => b.text() === 'Reintentar')!.trigger('click')
    await flushPromises()
    expect(w.findAll('[data-testid=meal-plan-row]')).toHaveLength(3)
  })
})

describe('MealPlansEditor (#361) — alta', () => {
  it('"+ Agregar régimen" abre el formulario; nombre + precio → create({name, price, …})', async () => {
    const w = await mountEditor()
    expect(w.find('[data-testid=meal-plan-form]').exists()).toBe(false)
    await w.find('[data-testid=meal-plan-add]').trigger('click')
    expect(w.find('[data-testid=meal-plan-form]').exists()).toBe(true)
    await w.find('#meal-plan-name').setValue('Pensión completa')
    await w.find('#meal-plan-description').setValue('Desayuno, almuerzo y cena')
    await w.find('#meal-plan-price').setValue('40')
    await w.find('[data-testid=meal-plan-save]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toEqual({ name: 'Pensión completa', description: 'Desayuno, almuerzo y cena', price: 40, active: true })
    // No manda `code`: lo genera el backend.
    expect(create.mock.calls[0][0]).not.toHaveProperty('code')
    expect(toastSuccess).toHaveBeenCalled()
    // Cierra el formulario y recarga la lista.
    expect(w.find('[data-testid=meal-plan-form]').exists()).toBe(false)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('nombre vacío bloquea el alta con mensaje y no llama a create', async () => {
    const w = await mountEditor()
    await w.find('[data-testid=meal-plan-add]').trigger('click')
    await w.find('#meal-plan-price').setValue('10')
    await w.find('[data-testid=meal-plan-save]').trigger('click')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(w.find('[data-testid=meal-plan-form-error]').text()).toContain('El nombre es obligatorio')
  })

  it('precio negativo bloquea el alta', async () => {
    const w = await mountEditor()
    await w.find('[data-testid=meal-plan-add]').trigger('click')
    await w.find('#meal-plan-name').setValue('Raro')
    await w.find('#meal-plan-price').setValue('-5')
    await w.find('[data-testid=meal-plan-save]').trigger('click')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(w.find('[data-testid=meal-plan-form-error]').text()).toContain('mayor o igual a 0')
  })

  it('si el backend rechaza, el error queda en el formulario (sigue abierto)', async () => {
    create.mockRejectedValueOnce(new Error('name debe tener como máximo 80 caracteres'))
    const w = await mountEditor()
    await w.find('[data-testid=meal-plan-add]').trigger('click')
    await w.find('#meal-plan-name').setValue('X')
    await w.find('[data-testid=meal-plan-save]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid=meal-plan-form]').exists()).toBe(true)
    expect(w.find('[data-testid=meal-plan-form-error]').text()).toContain('80 caracteres')
  })
})

describe('MealPlansEditor (#361) — edición', () => {
  it('"Editar" carga la fila en el formulario y guarda con update(id, …)', async () => {
    const w = await mountEditor()
    await w.findAll('[data-testid=meal-plan-edit]')[1].trigger('click')
    expect((w.find('#meal-plan-name').element as HTMLInputElement).value).toBe('Media pensión')
    expect((w.find('#meal-plan-description').element as HTMLTextAreaElement).value).toBe('Desayuno y cena')
    expect((w.find('#meal-plan-price').element as HTMLInputElement).value).toBe('25')
    expect((w.find('#meal-plan-active').element as HTMLInputElement).checked).toBe(true)
    await w.find('#meal-plan-name').setValue('Media pensión premium')
    await w.find('#meal-plan-price').setValue('30')
    await w.find('[data-testid=meal-plan-save]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toBe('mp2')
    expect(update.mock.calls[0][1]).toEqual({ name: 'Media pensión premium', description: 'Desayuno y cena', price: 30, active: true })
    expect(create).not.toHaveBeenCalled()
    expect(w.find('[data-testid=meal-plan-form]').exists()).toBe(false)
  })

  it('vaciar la descripción al editar manda description: "" (no null: el backend descarta null y no la limpiaría)', async () => {
    const w = await mountEditor()
    await w.findAll('[data-testid=meal-plan-edit]')[1].trigger('click')
    expect((w.find('#meal-plan-description').element as HTMLTextAreaElement).value).toBe('Desayuno y cena')
    await w.find('#meal-plan-description').setValue('')
    await w.find('[data-testid=meal-plan-save]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('mp2', expect.objectContaining({ description: '' }))
    expect(update.mock.calls[0][1].description).not.toBeNull()
  })
})

describe('MealPlansEditor (#361) — baja', () => {
  it('"Eliminar" pide confirmación; al aceptar llama remove(id) y saca la fila', async () => {
    const w = await mountEditor()
    await w.findAll('[data-testid=meal-plan-delete]')[2].trigger('click')
    expect(remove).not.toHaveBeenCalled()
    expect(w.text()).toContain('Eliminar régimen')
    expect(w.text()).toContain('Todo incluido')
    const confirmBtn = w.findAll('button').filter((b) => b.text().trim() === 'Eliminar').at(-1)!
    await confirmBtn.trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('mp3')
    expect(w.findAll('[data-testid=meal-plan-row]')).toHaveLength(2)
    expect(w.text()).not.toContain('Todo incluido')
  })

  it('cancelar la confirmación no borra nada', async () => {
    const w = await mountEditor()
    await w.findAll('[data-testid=meal-plan-delete]')[0].trigger('click')
    await w.findAll('button').find((b) => b.text().trim() === 'Cancelar')!.trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    expect(w.findAll('[data-testid=meal-plan-row]')).toHaveLength(3)
  })
})

describe('MealPlansEditor (#361) — toggle activo', () => {
  it('apagar el toggle llama update(id, {active:false}) directo, sin formulario', async () => {
    const w = await mountEditor()
    const toggle = w.findAll('[data-testid=meal-plan-toggle]')[0]
    expect((toggle.element as HTMLInputElement).checked).toBe(true)
    await toggle.setValue(false)
    await flushPromises()
    expect(update).toHaveBeenCalledWith('mp1', { active: false })
    expect(w.find('[data-testid=meal-plan-form]').exists()).toBe(false)
    expect(w.findAll('[data-testid=meal-plan-row]')[0].text()).toContain('Inactivo')
  })

  it('encender uno inactivo llama update(id, {active:true})', async () => {
    const w = await mountEditor()
    await w.findAll('[data-testid=meal-plan-toggle]')[2].setValue(true)
    await flushPromises()
    expect(update).toHaveBeenCalledWith('mp3', { active: true })
    expect(w.findAll('[data-testid=meal-plan-row]')[2].text()).toContain('Activo')
  })

  it('si el update falla, vuelve al estado anterior y avisa por toast', async () => {
    update.mockRejectedValueOnce(new Error('sin permiso'))
    const w = await mountEditor()
    await w.findAll('[data-testid=meal-plan-toggle]')[0].setValue(false)
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('sin permiso')
    expect((w.findAll('[data-testid=meal-plan-toggle]')[0].element as HTMLInputElement).checked).toBe(true)
  })
})
