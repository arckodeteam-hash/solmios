// save-handler.test.ts — Regresión del bug qa-ui 2026-08-22: "Guardar" del modal de
// envíos automáticos no hacía NADA (cero POST, modal abierto, sin error de consola).
//
// Causa raíz: save() validaba el título con un early return que sólo tiraba un toast
// efímero arriba a la derecha — sin feedback en el campo, con el modal abierto, se lee
// como "el botón no hace nada". Además el catch cerraba el modal aunque el POST fallara
// (se perdía lo escrito) y mostraba un 'Error' genérico.
//
// Cubre el handler completo: (1) título vacío → sin POST + error visible en el campo,
// (2) válido → POST con payload correcto (SIN hotelId, isActive numérico) + modal
// cerrado, (3) fallo del API → toast con el mensaje real y modal abierto.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/services/AutoMessages.service', () => ({
  AutoMessagesService: {
    list: (...a: unknown[]) => listMock(...a),
    create: (...a: unknown[]) => createMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
    remove: (...a: unknown[]) => removeMock(...a),
  },
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn(), toasts: ref([]), dismiss: vi.fn() }),
}))
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirmModal: ref(null), confirmBusy: ref(false), askConfirm: vi.fn(), runConfirm: vi.fn() }),
}))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', id: 'u1' }, userRole: 'hotel_admin' }) }))

import AutoMessages from '@/pages/auto-messages/index.vue'

const MOUNT_OPTS = {
  global: {
    stubs: {
      SectionCard: { template: '<section><slot name="actions" /><slot /></section>' },
      KpiHeroCard: true,
      EmptyState: { template: '<div><slot name="action" /></div>' },
      ConfirmModal: true,
      // El modal real con slots renderizados: hace existir el form y el botón Guardar.
      AppModal: { props: ['title', 'subtitle', 'size'], template: '<div data-testid="modal-stub"><slot /><slot name="footer" /></div>' },
    },
  },
}

/** Monta la página, abre el modal "Nuevo Mensaje" y devuelve el wrapper. */
async function openModal() {
  const w = mount(AutoMessages as never, MOUNT_OPTS)
  await flushPromises()
  const nuevo = w.findAll('button').find(b => b.text().trim() === 'Nuevo Mensaje')
  if (!nuevo) throw new Error('botón Nuevo Mensaje no encontrado')
  await nuevo.trigger('click')
  await flushPromises()
  return w
}

/** Botón Guardar del footer del modal (el único con texto exacto 'Guardar'). */
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

describe('auto-messages — handler de Guardar (regresión qa-ui 2026-08-22)', () => {
  it('con el título vacío no dispara POST y muestra el error EN el campo, con el modal abierto', async () => {
    const w = await openModal()
    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    const fieldError = w.find('[data-testid="auto-message-title-error"]')
    expect(fieldError.exists()).toBe(true)
    expect(fieldError.text()).toMatch(/título/i)
    expect(toastError).toHaveBeenCalled()
    // El modal NO se cierra: el usuario ve qué campo falta.
    expect(w.find('[data-testid="auto-message-title"]').exists()).toBe(true)
  })

  it('guardar válido postea SIN hotelId y con isActive numérico, cierra el modal y recarga', async () => {
    createMock.mockResolvedValue({ id: 'am1' })
    const w = await openModal()
    await w.find<HTMLInputElement>('[data-testid="auto-message-title"]').setValue('QA test — reminder EN')
    // Canal Ambos + plantilla Recordatorio + idioma English + trigger check-in: el repro exacto.
    // Selects del MODAL (el primero del árbol es el filtro de estado del listado).
    const selects = w.find('[data-testid="modal-stub"]').findAll('select')
    await selects[0].setValue('both')   // canal
    await selects[1].setValue('reminder') // plantilla (evento)
    await selects[2].setValue('en')     // idioma
    await selects[3].setValue('checkin_day') // disparador
    await w.findAll('textarea')[0].setValue('QA subject')

    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>
    // hotelId lo inyecta el controller desde el token (commit b6dc424): el frontend NO lo manda.
    expect('hotelId' in payload).toBe(false)
    expect(payload.title).toBe('QA test — reminder EN')
    expect(payload.channel).toBe('both')
    expect(payload.event).toBe('reminder')
    expect(payload.language).toBe('en')
    expect(payload.triggerEvent).toBe('checkin_day')
    // El schema del backend declara isActive `number`: boolean revienta el PUT con 400.
    expect(payload.isActive).toBe(1)
    expect(toastSuccess).toHaveBeenCalled()
    expect(listMock).toHaveBeenCalledTimes(2) // carga inicial + recarga post-guardado
    // Modal cerrado.
    expect(w.find('[data-testid="auto-message-title"]').exists()).toBe(false)
  })

  it('si el API falla, muestra el mensaje real y el modal queda abierto (no se pierde lo escrito)', async () => {
    createMock.mockRejectedValue(new Error('isActive must be a number'))
    const w = await openModal()
    await w.find<HTMLInputElement>('[data-testid="auto-message-title"]').setValue('QA test')
    await guardarBtn(w).trigger('click')
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('isActive must be a number'))
    // El modal sigue abierto con el valor escrito.
    const input = w.find<HTMLInputElement>('[data-testid="auto-message-title"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('QA test')
  })
})
