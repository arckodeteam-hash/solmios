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
// #111: plantillas por endpoint dedicado. La página las pide en onMounted: sin estos dobles
// el mock del módulo no tendría los métodos y cargarPlantillas caería al catch en silencio.
const getTemplatesMock = vi.fn()
const setTemplatesMock = vi.fn()
vi.mock('@/services/Platform.service', () => ({
  PlatformService: {
    announcements: (...a: unknown[]) => listMock(...a),
    announcementsReach: async () => null,
    getAnnouncementTemplates: (...a: unknown[]) => getTemplatesMock(...a),
    setAnnouncementTemplates: (...a: unknown[]) => setTemplatesMock(...a),
  },
}))
// La lista de hoteles (selector de audiencia) no importa acá: sin el doble, jsdom intenta un
// fetch real a :3000 y llena la salida de ECONNREFUSED.
vi.mock('@/services/SuperAdmin.service', () => ({
  SuperAdminService: { hotels: async () => ({ hotels: [] }) },
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

// ---------------------------------------------------------------------------------------------
// #111 (ANN-7): las plantillas guardadas funcionan de verdad. Antes se guardaban por
// /configuracion con un botón en el header de la tarjeta que leía el draft (vacío después de
// publicar), y al editar el título se DUPLICABAN en vez de reemplazarse.
// ---------------------------------------------------------------------------------------------

function plantilla(overrides: Partial<{ name: string; icon: string; description: string; type: string; message: string }> = {}) {
  return { name: 'Mantenimiento nocturno', icon: '🔧', description: 'El sistema no estará…', type: 'maintenance', message: 'El sistema no estará disponible de 2 a 4.', ...overrides }
}

const DOS = [plantilla(), plantilla({ name: 'Promo verano', icon: '🌞', description: 'Descuento…', type: 'promo', message: '20% de descuento en el plan anual.' })]

// El modal va por <Teleport to="body">: sus controles se leen del document, no del wrapper.
const bodyText = () => document.body.textContent || ''
const bodyButton = (texto: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const modalTitulo = () => document.querySelector('input[type="text"][placeholder="Ej: ¡Nueva función disponible!"]') as HTMLInputElement | null
const modalTipo = () => document.querySelector('.app-modal-panel select') as HTMLSelectElement | null
const modalMensaje = () => document.querySelector('.app-modal-panel textarea') as HTMLTextAreaElement | null
/** La SectionCard "Plantillas Guardadas": el título es un h2 dentro del header de la tarjeta. */
const cardPlantillas = (w: ReturnType<typeof mount>) =>
  w.findAll('h2').find((h) => h.text() === 'Plantillas Guardadas')!.element.closest('.rounded-2xl')!

async function setInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

/** Abre la plantilla `i` desde la tarjeta (clic en el nombre → modal precargado). */
async function abrirPlantilla(w: ReturnType<typeof mount>, nombre: string) {
  const btn = w.findAll('button').find((b) => b.text().includes(nombre))
  expect(btn, `botón de la plantilla "${nombre}"`).toBeTruthy()
  await btn!.trigger('click')
  await flushPromises()
}

describe('super-admin/announcements — plantillas guardadas (#111)', () => {
  beforeEach(() => {
    listMock.mockReset()
    getTemplatesMock.mockReset()
    setTemplatesMock.mockReset()
    listMock.mockResolvedValue({ data: [], total: 0 })
    // El backend devuelve la lista normalizada: el doble devuelve lo que recibió.
    setTemplatesMock.mockImplementation(async (templates: unknown[]) => ({ templates }))
  })

  it('sin plantillas la tarjeta muestra el vacío y ya no hay botón "Guardar la última" en el header', async () => {
    getTemplatesMock.mockResolvedValue({ templates: [] })

    const w = await render()

    expect(getTemplatesMock).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('Sin plantillas')
    expect(w.text()).not.toContain('Guardar la última como plantilla')
  })

  it('lista las plantillas por nombre y el clic precarga título, tipo y mensaje en el modal, editables', async () => {
    getTemplatesMock.mockResolvedValue({ templates: DOS })

    const w = await render()

    const tarjeta = cardPlantillas(w).textContent || ''
    expect(tarjeta).toContain('Mantenimiento nocturno')
    expect(tarjeta).toContain('Promo verano')
    expect(w.text()).not.toContain('Sin plantillas')

    await abrirPlantilla(w, 'Mantenimiento nocturno')

    expect(bodyText()).toContain('Nuevo Anuncio')
    expect(modalTitulo()!.value).toBe('Mantenimiento nocturno')
    expect(modalTipo()!.value).toBe('maintenance')
    expect(modalMensaje()!.value).toBe('El sistema no estará disponible de 2 a 4.')

    await setInput(modalTitulo()!, 'Mantenimiento de madrugada')
    expect(modalTitulo()!.value).toBe('Mantenimiento de madrugada')
  })

  it('"Guardar como plantilla" con una plantilla abierta la REEMPLAZA (misma posición, título nuevo) sin cerrar el modal', async () => {
    getTemplatesMock.mockResolvedValue({ templates: DOS })

    const w = await render()
    await abrirPlantilla(w, 'Mantenimiento nocturno')
    await setInput(modalTitulo()!, 'Mantenimiento de madrugada')
    await setInput(modalMensaje()!, 'Cambia el horario: de 3 a 5.')

    const guardar = bodyButton('Guardar como plantilla')
    expect(guardar).toBeTruthy()
    guardar!.click()
    await flushPromises()

    expect(setTemplatesMock).toHaveBeenCalledTimes(1)
    const enviado = setTemplatesMock.mock.calls[0][0] as { name: string; type: string; message: string; icon: string; description: string }[]
    expect(enviado).toHaveLength(2)
    expect(enviado[0]).toEqual({
      name: 'Mantenimiento de madrugada',
      type: 'maintenance',
      message: 'Cambia el horario: de 3 a 5.',
      description: 'Cambia el horario: de 3 a 5.',
      icon: '📌',
    })
    expect(enviado[1]).toEqual(DOS[1])
    // No se creó una segunda "Mantenimiento…": se editó la abierta.
    expect(enviado.filter((t) => t.name.startsWith('Mantenimiento'))).toHaveLength(1)

    // Sigue abierto: guardar como plantilla no publica ni cierra.
    expect(bodyText()).toContain('Nuevo Anuncio')
    expect(modalTitulo()!.value).toBe('Mantenimiento de madrugada')
    const tarjeta = cardPlantillas(w).textContent || ''
    expect(tarjeta).toContain('Mantenimiento de madrugada')
    expect(tarjeta).not.toContain('Mantenimiento nocturno')
  })

  it('sin plantilla abierta (Nuevo Anuncio) guardar AGREGA al final de la lista previa', async () => {
    getTemplatesMock.mockResolvedValue({ templates: DOS })

    const w = await render()
    await w.findAll('button').find((b) => b.text().includes('Nuevo Anuncio'))!.trigger('click')
    await flushPromises()

    await setInput(modalTitulo()!, 'Mantenimiento')
    await setInput(modalMensaje()!, 'x')
    bodyButton('Guardar como plantilla')!.click()
    await flushPromises()

    expect(setTemplatesMock).toHaveBeenCalledTimes(1)
    const enviado = setTemplatesMock.mock.calls[0][0] as { name: string }[]
    expect(enviado).toHaveLength(3)
    expect(enviado[0]).toEqual(DOS[0])
    expect(enviado[1]).toEqual(DOS[1])
    expect(enviado[2]).toEqual({ name: 'Mantenimiento', type: 'feature', message: 'x', description: 'x', icon: '📌' })
  })

  it('"Quitar" en la segunda manda la lista con sólo la primera', async () => {
    getTemplatesMock.mockResolvedValue({ templates: DOS })

    const w = await render()
    const quitar = w.findAll('button').filter((b) => b.text().trim() === 'Quitar')
    expect(quitar).toHaveLength(2)
    await quitar[1].trigger('click')
    await flushPromises()

    expect(setTemplatesMock).toHaveBeenCalledTimes(1)
    expect(setTemplatesMock.mock.calls[0][0]).toEqual([DOS[0]])
    const tarjeta = cardPlantillas(w).textContent || ''
    expect(tarjeta).toContain('Mantenimiento nocturno')
    expect(tarjeta).not.toContain('Promo verano')
  })
})
