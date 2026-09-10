// announcements.test.ts — Regresión ANN-4 (#108) del panel super-admin: la columna de
// alcance mostraba `reads: 0` LITERAL (hardcodeado en el map del listado), así que no se
// sabía quién leyó nada. La página lista del endpoint de plataforma
// (PlatformService.announcements → GET /admin/announcements), que devuelve TODOS los
// anuncios sin paginar y con su alcance MEDIDO (`seenCount` / `recipients`), y el 0 sólo
// queda como default vacío. El mock devuelve lo que devuelve el endpoint: sin límites
// escondidos — si la página volviera a un source paginado, este doble no lo taparía.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const listMock = vi.fn()
vi.mock('@/services/Platform.service', () => ({
  PlatformService: {
    announcements: (...a: unknown[]) => listMock(...a),
    announcementsReach: async () => null,
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

/** Un anuncio tal como lo devuelve GET /admin/announcements (fila cruda + reads del backend). */
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

  it('muestra "3 / 10" cuando el listado trae seenCount: 3 sobre recipients: 10 (COUNT real del backend)', async () => {
    listMock.mockResolvedValue({ data: [annuncio({ seenCount: 3, recipients: 10 })], total: 1 })

    const w = await render()

    expect(listMock).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('Nueva función de pagos')
    expect(w.text()).toContain('3 / 10')
    expect(w.text()).toContain('30%')
  })

  it('dos avisos con lecturas distintas muestran cada uno la suya, no un número repetido', async () => {
    listMock.mockResolvedValue({
      data: [
        annuncio({ id: 'a1', title: 'Uno', seenCount: 3, recipients: 10 }),
        annuncio({ id: 'a2', title: 'Dos', seenCount: 7, recipients: 10 }),
      ],
      total: 2,
    })

    const w = await render()

    expect(w.text()).toContain('3 / 10')
    expect(w.text()).toContain('7 / 10')
  })

  it('sin lecturas en la respuesta muestra 0 / 0 y "sin datos", no un porcentaje inventado', async () => {
    listMock.mockResolvedValue({ data: [annuncio()], total: 1 })

    const w = await render()

    expect(w.text()).toContain('0 / 0')
    expect(w.text()).toContain('sin datos')
  })
})
