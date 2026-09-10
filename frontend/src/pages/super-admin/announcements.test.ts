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
// #107 (ANN-3): crear/eliminar van por el módulo anuncios; se mockea para afirmar el body exacto.
const createMock = vi.fn()
const removeMock = vi.fn()
vi.mock('@/services/Announcements.service', () => ({
  AnnouncementsService: {
    create: (...a: unknown[]) => createMock(...a),
    remove: (...a: unknown[]) => removeMock(...a),
  },
}))
// Singleton: el componente y el test tienen que ver LOS MISMOS vi.fn() (patrón audit.test.ts).
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})
// AppModal teleporta a <body>; para el test alcanza con que pinte sus slots en el lugar (patrón leads-ventas.test.ts).
vi.mock('@/components/ui/AppModal.vue', () => ({
  default: { name: 'AppModal', template: '<div data-testid="modal"><slot /><slot name="footer" /></div>' },
}))

import Announcements from './announcements.vue'
import { useToast } from '@/composables/useToast'

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

/** 'YYYY-MM-DDTHH:mm' en hora local, como lo entrega un <input type="datetime-local">. */
function datetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function enDias(dias: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  d.setSeconds(0, 0)
  return d
}

describe('super-admin/announcements — tarjeta Programación con startsAt futuro (#107)', () => {
  beforeEach(() => {
    listMock.mockReset()
  })

  it('muestra el programado (startsAt mañana) con su fecha, y NO el que no tiene fechas', async () => {
    const manana = enDias(1)
    listMock.mockResolvedValue({
      data: [
        annuncio({ id: 'a1', title: 'Anuncio ya publicado', startsAt: null, endsAt: null }),
        annuncio({ id: 'a2', title: 'Anuncio programado para mañana', startsAt: manana.toISOString(), endsAt: null }),
      ],
      total: 2,
    })

    const w = await render()

    const items = w.findAll('[data-testid="scheduled-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('Anuncio programado para mañana')
    expect(items[0].text()).toContain('Programado')
    const esperada = manana.toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    expect(items[0].text()).toContain(esperada)
    expect(items[0].text()).not.toContain('Anuncio ya publicado')
    expect(w.text()).not.toContain('No hay anuncios programados')
  })

  it('un startsAt en el pasado no es "programado": sigue "No hay anuncios programados"', async () => {
    listMock.mockResolvedValue({
      data: [annuncio({ id: 'a1', title: 'Viejo', startsAt: enDias(-1).toISOString() }), annuncio({ id: 'a2', title: 'Sin fechas' })],
      total: 2,
    })

    const w = await render()

    expect(w.findAll('[data-testid="scheduled-item"]')).toHaveLength(0)
    expect(w.text()).toContain('No hay anuncios programados')
  })
})

describe('super-admin/announcements — Publicar ahora / Programar (#107)', () => {
  beforeEach(() => {
    listMock.mockReset()
    listMock.mockResolvedValue({ data: [], total: 0 })
    createMock.mockReset()
    createMock.mockResolvedValue({ id: 'nuevo' })
    vi.mocked(useToast().error).mockClear()
  })

  async function abrirModal(w: ReturnType<typeof mount>) {
    const btn = w.findAll('button').find((b) => b.text().includes('Nuevo Anuncio'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="modal"]').exists()).toBe(true)
  }

  async function enviar(w: ReturnType<typeof mount>) {
    const btn = w.findAll('button').find((b) => b.text() === 'Enviar Ahora' || b.text() === 'Programar')
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    await flushPromises()
  }

  it('publicar sin tocar fechas manda EXACTAMENTE el body de siempre: sin claves startsAt/endsAt', async () => {
    const w = await render()
    await abrirModal(w)
    await w.find('input[type="text"]').setValue('Título nuevo')

    await enviar(w)

    expect(createMock).toHaveBeenCalledTimes(1)
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.title).toBe('Título nuevo')
    expect(body).not.toHaveProperty('startsAt')
    expect(body).not.toHaveProperty('endsAt')
    expect(Object.keys(body).sort()).toEqual(['active', 'date', 'message', 'priority', 'title', 'type'])
  })

  it('"Programar" con startsAt y endsAt manda ambos en ISO (UTC, terminan en Z)', async () => {
    const inicio = enDias(1)
    const fin = enDias(3)
    const w = await render()
    await abrirModal(w)
    await w.find('input[type="text"]').setValue('Programado')
    await w.find('#announcement-publish-scheduled').setValue()
    await w.find('#announcement-starts-at').setValue(datetimeLocal(inicio))
    await w.find('#announcement-ends-at').setValue(datetimeLocal(fin))

    await enviar(w)

    expect(createMock).toHaveBeenCalledTimes(1)
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.startsAt).toBe(inicio.toISOString())
    expect(body.endsAt).toBe(fin.toISOString())
    expect(String(body.startsAt)).toMatch(/Z$/)
    expect(String(body.endsAt)).toMatch(/Z$/)
  })

  it('"Programar" sin fecha de publicación no envía y avisa', async () => {
    const w = await render()
    await abrirModal(w)
    await w.find('input[type="text"]').setValue('Sin fecha')
    await w.find('#announcement-publish-scheduled').setValue()

    await enviar(w)

    expect(createMock).not.toHaveBeenCalled()
    expect(useToast().error).toHaveBeenCalledWith('Elegí la fecha de publicación')
  })

  it('endsAt anterior a startsAt no llama a create y muestra toast.error', async () => {
    const w = await render()
    await abrirModal(w)
    await w.find('input[type="text"]').setValue('Invertido')
    await w.find('#announcement-publish-scheduled').setValue()
    await w.find('#announcement-starts-at').setValue(datetimeLocal(enDias(3)))
    await w.find('#announcement-ends-at').setValue(datetimeLocal(enDias(1)))

    await enviar(w)

    expect(createMock).not.toHaveBeenCalled()
    expect(useToast().error).toHaveBeenCalledWith('La fecha de fin tiene que ser posterior al inicio')
  })

  it('"Publicar ahora" con sólo fecha de fin manda endsAt ISO y ningún startsAt', async () => {
    const fin = enDias(2)
    const w = await render()
    await abrirModal(w)
    await w.find('input[type="text"]').setValue('Vence')
    await w.find('#announcement-ends-at').setValue(datetimeLocal(fin))

    await enviar(w)

    expect(createMock).toHaveBeenCalledTimes(1)
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body).not.toHaveProperty('startsAt')
    expect(body.endsAt).toBe(fin.toISOString())
  })
})
