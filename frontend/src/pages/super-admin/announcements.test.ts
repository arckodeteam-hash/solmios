// announcements.test.ts — Regresión ANN-4 (#108) del panel super-admin: la columna
// "Vistas / N leídos" mostraba `reads: 0` LITERAL (hardcodeado en el map del listado),
// así que no se sabía quién leyó nada. La página lista del endpoint de plataforma
// (PlatformService.announcements → GET /admin/announcements), que devuelve TODOS los
// anuncios sin paginar y con su `reads` real (COUNT de announcement_reads), y el 0 sólo
// queda como default vacío. El mock devuelve lo que devuelve el endpoint: sin límites
// escondidos — si la página volviera a un source paginado, este doble no lo taparía.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const listMock = vi.fn()
vi.mock('@/services/Platform.service', () => ({
  PlatformService: {
    announcements: (...a: unknown[]) => listMock(...a),
  },
}))
// #105 (ANN-1): catálogo de hoteles para resolver el nombre en la columna "Audiencia".
const hotelsMock = vi.fn()
vi.mock('@/services/SuperAdmin.service', () => ({
  SuperAdminService: {
    hotels: (...a: unknown[]) => hotelsMock(...a),
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
    hotelsMock.mockReset()
    hotelsMock.mockResolvedValue({ hotels: [{ id: 'h1', name: 'Hotel Sol' }], total: 1 })
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

describe('super-admin/announcements — columna Audiencia con nombre del hotel (#105)', () => {
  beforeEach(() => {
    listMock.mockReset()
    hotelsMock.mockReset()
    hotelsMock.mockResolvedValue({ hotels: [{ id: 'h1', name: 'Hotel Sol' }], total: 1 })
  })

  /** Celda "Audiencia" de cada fila de la tabla (cabecera: Título · Tipo · Audiencia · ...). */
  function audiencias(w: ReturnType<typeof mount>): string[] {
    const headers = w.findAll('thead th').map((th) => th.text().trim())
    const col = headers.indexOf('Audiencia')
    expect(col).toBeGreaterThanOrEqual(0)
    return w.findAll('tbody tr').map((tr) => tr.findAll('td')[col]!.text().trim())
  }

  it('la columna Audiencia muestra el nombre del hotel, no su id', async () => {
    listMock.mockResolvedValue({ data: [annuncio({ hotelId: 'h1' })], total: 1 })

    const w = await render()

    expect(hotelsMock).toHaveBeenCalledTimes(1)
    expect(audiencias(w)).toEqual(['Hotel Sol'])
    expect(w.text()).not.toContain('Hotel específico')
  })

  it('un anuncio sin hotel muestra Todos los hoteles', async () => {
    listMock.mockResolvedValue({ data: [annuncio({ hotelId: null })], total: 1 })

    const w = await render()

    expect(audiencias(w)).toEqual(['Todos los hoteles'])
  })

  it('si el catálogo de hoteles falla, el listado igual carga con el id', async () => {
    hotelsMock.mockRejectedValue(new Error('boom'))
    listMock.mockResolvedValue({ data: [annuncio({ hotelId: 'h2' })], total: 1 })

    const w = await render()

    expect(w.text()).toContain('Nueva función de pagos')
    expect(audiencias(w)).toEqual(['h2'])
  })
})
