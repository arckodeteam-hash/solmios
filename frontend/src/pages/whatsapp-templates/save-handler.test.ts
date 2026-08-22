// save-handler.test.ts — Plantillas WhatsApp comparte el handler del modal con
// auto-messages (bug qa-ui 2026-08-22): misma regresión cubierta acá.
//
// Particularidades de esta página:
// - Validaba nombre+cuerpo con toast efímero solamente → ahora hay error anclado al campo.
// - Mandaba `isActive` boolean al PUT: UpdateTemplateSchema del backend lo declara
//   `number` → 400 "isActive must be a number" en TODA edición (verificado por curl).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/services/Whatsapp.service', () => ({
  WhatsappService: {
    list: (...a: unknown[]) => listMock(...a),
    create: (...a: unknown[]) => createMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
    remove: (...a: unknown[]) => removeMock(...a),
    link: (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
  },
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn(), toasts: ref([]), dismiss: vi.fn() }),
}))
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirmModal: ref(null), confirmBusy: ref(false), askConfirm: vi.fn(), runConfirm: vi.fn() }),
}))

import WhatsappTemplates from '@/pages/whatsapp-templates/index.vue'

const MOUNT_OPTS = {
  global: {
    stubs: {
      SectionCard: { template: '<section><slot name="actions" /><slot /></section>' },
      KpiHeroCard: true,
      EmptyState: { template: '<div><slot name="action" /></div>' },
      ConfirmModal: true,
      AppModal: { props: ['title', 'subtitle', 'size'], template: '<div data-testid="modal-stub"><slot /><slot name="footer" /></div>' },
    },
  },
}

/** Monta la página y abre el modal de nueva plantilla. */
async function openModal() {
  const w = mount(WhatsappTemplates as never, MOUNT_OPTS)
  await flushPromises()
  const nuevo = w.findAll('button').find(b => /nueva plantilla/i.test(b.text().trim()))
  if (!nuevo) throw new Error('botón Nueva plantilla no encontrado')
  await nuevo.trigger('click')
  await flushPromises()
  return w
}

function guardarBtn(w: ReturnType<typeof mount>) {
  const btn = w.findAll('button').find(b => b.text().trim() === 'Guardar')
  if (!btn) throw new Error('botón Guardar no encontrado')
  return btn
}

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({ data: [] as unknown[] })
  createMock.mockReset(); updateMock.mockReset(); removeMock.mockReset()
  toastSuccess.mockClear(); toastError.mockClear()
})

describe('whatsapp-templates — handler de Guardar', () => {
  it('sin nombre ni cuerpo no dispara POST y marca el campo que falta', async () => {
    const w = await openModal()
    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(createMock).not.toHaveBeenCalled()
    expect(w.find('[data-testid="whatsapp-template-name-error"]').exists()).toBe(true)
    // El modal sigue abierto.
    expect(w.find('[data-testid="whatsapp-template-name"]').exists()).toBe(true)
  })

  it('guardar válido postea SIN hotelId y con isActive numérico, y cierra el modal', async () => {
    createMock.mockResolvedValue({ id: 't1' })
    const w = await openModal()
    await w.find<HTMLInputElement>('[data-testid="whatsapp-template-name"]').setValue('Bienvenida')
    await w.find('[data-testid="whatsapp-template-body"]').setValue('Hola {guest_name}!')
    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>
    expect('hotelId' in payload).toBe(false)
    expect(payload.name).toBe('Bienvenida')
    expect(payload.body).toBe('Hola {guest_name}!')
    // UpdateTemplateSchema declara isActive `number`: el boolean mandaba el PUT a 400.
    expect(payload.isActive).toBe(1)
    expect(toastSuccess).toHaveBeenCalled()
    expect(w.find('[data-testid="whatsapp-template-name"]').exists()).toBe(false)
  })

  it('crear con el toggle desactivado manda isActive: 0 (INT-1: crear pausado ya no se guarda activo)', async () => {
    createMock.mockResolvedValue({ id: 't2' })
    const w = await openModal()
    await w.find<HTMLInputElement>('[data-testid="whatsapp-template-name"]').setValue('Pausada al nacer')
    await w.find('[data-testid="whatsapp-template-body"]').setValue('Hola {guest_name}!')
    // El único checkbox de la página es el toggle de activación del modal.
    const toggle = w.find('[data-testid="modal-stub"] input[type="checkbox"]')
    expect(toggle.exists()).toBe(true)
    await toggle.setValue(false)

    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>
    // toBe estricto: el número 0 del schema — ni false (boolean, 400) ni 1 (el bug).
    expect(payload.isActive).toBe(0)
  })

  it('editar manda isActive numérico al PUT (el boolean reventaba con 400)', async () => {
    updateMock.mockResolvedValue({ id: 't1' })
    // COR-2: el listado real llega con isActive BOOLEAN (el ORM deserializa al leer) —
    // el fixture viejo con `1` fijaba el formato equivocado del wire.
    listMock.mockResolvedValue({ data: [{ id: 't1', name: 'Bienvenida', body: 'Hola', category: 'general', isActive: true }] })
    const w = mount(WhatsappTemplates as never, MOUNT_OPTS)
    await flushPromises()
    // Click en la fila de la plantilla abre el modal de edición.
    const row = w.findAll('tr').find(r => r.text().includes('Bienvenida'))
    if (!row) throw new Error('fila de la plantilla no encontrada')
    await row.trigger('click')
    await flushPromises()
    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(updateMock).toHaveBeenCalledTimes(1)
    const payload = updateMock.mock.calls[0][1] as Record<string, unknown>
    expect(payload.isActive).toBe(1)
    expect('hotelId' in payload).toBe(false)
  })

  it('editar una plantilla PAUSADA (isActive false del server) manda 0 y no la reactiva', async () => {
    updateMock.mockResolvedValue({ id: 't1' })
    listMock.mockResolvedValue({ data: [{ id: 't1', name: 'Pausada', body: 'Hola', category: 'general', isActive: false }] })
    const w = mount(WhatsappTemplates as never, MOUNT_OPTS)
    await flushPromises()
    const row = w.findAll('tr').find(r => r.text().includes('Pausada'))
    if (!row) throw new Error('fila de la plantilla no encontrada')
    await row.trigger('click')
    await flushPromises()
    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(updateMock).toHaveBeenCalledTimes(1)
    const payload = updateMock.mock.calls[0][1] as Record<string, unknown>
    expect(payload.isActive).toBe(0)
  })

  it('si el API falla, muestra el mensaje real y el modal queda abierto', async () => {
    createMock.mockRejectedValue(new Error('isActive must be a number'))
    const w = await openModal()
    await w.find<HTMLInputElement>('[data-testid="whatsapp-template-name"]').setValue('Bienvenida')
    await w.find('[data-testid="whatsapp-template-body"]').setValue('Hola')
    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('isActive must be a number'))
    expect(w.find('[data-testid="whatsapp-template-name"]').exists()).toBe(true)
  })
})
