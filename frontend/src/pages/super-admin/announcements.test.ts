// announcements.test.ts — Regresión ANN-4 (#108) del panel super-admin: la columna
// "Vistas / N leídos" mostraba `reads: 0` LITERAL (hardcodeado en el map del listado),
// así que no se sabía quién leyó nada. Ahora la página lista del módulo anuncios
// (AnnouncementsService.list → GET /anuncios), que para super_admin agrega a cada aviso
// su `reads` real (COUNT de announcement_reads), y el 0 sólo queda como default vacío.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const listMock = vi.fn()
vi.mock('@/services/Announcements.service', () => ({
  AnnouncementsService: {
    list: (...a: unknown[]) => listMock(...a),
    create: vi.fn(),
    remove: vi.fn(),
  },
}))
// Singleton: el componente y el test tienen que ver LOS MISMOS vi.fn() (patrón audit.test.ts).
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})

import Announcements from './announcements.vue'

let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function render() {
  wrapper = mount(Announcements)
  await flushPromises()
  await flushPromises()
  return wrapper
}

/** Un anuncio tal como lo devuelve GET /anuncios a un super_admin (AnunciosDTO + reads). */
function annuncio(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    title: 'Nueva función de pagos',
    message: 'Ya está disponible para todos los hoteles.',
    type: 'feature',
    priority: 'medium',
    active: 1,
    date: '2026-09-10T10:00:00.000Z',
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  }
}

describe('super-admin/announcements — lecturas reales en la columna (#108)', () => {
  beforeEach(() => {
    listMock.mockReset()
  })

  it('muestra "3 leídos" cuando el listado trae reads: 3 (COUNT real del backend)', async () => {
    listMock.mockResolvedValue({ data: [annuncio({ reads: 3 })], total: 1 })

    const w = await render()

    expect(listMock).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('Nueva función de pagos')
    expect(w.text()).toContain('3 leídos')
  })

  it('dos avisos con lecturas distintas muestran cada uno la suya, no un número repetido', async () => {
    listMock.mockResolvedValue({
      data: [annuncio({ id: 'a1', title: 'Uno', reads: 3 }), annuncio({ id: 'a2', title: 'Dos', reads: 7 })],
      total: 2,
    })

    const w = await render()

    expect(w.text()).toContain('3 leídos')
    expect(w.text()).toContain('7 leídos')
  })

  it('sin reads en la respuesta muestra 0 como default vacío, no como dato inventado', async () => {
    listMock.mockResolvedValue({ data: [annuncio()], total: 1 })

    const w = await render()

    expect(w.text()).toContain('0 leídos')
  })
})
