// AnnouncementBanner.test.ts — ANN-4 (#108, tareas 4.5 y 4.6): lecturas por usuario.
//
// El banner dejó de usar Configuration KV (la lista de descartes compartida por
// hotel): el ✕ de un recepcionista ya no le esconde el aviso a todo el staff. Ahora
// cada aviso mostrado se registra con POST /anuncios/:id/seen (una vez por aviso) y
// el ✕ hace POST /anuncios/:id/dismiss para el usuario del token, ocultándolo sólo
// localmente.
//
// Lo que se protege acá:
//   1. El aviso se muestra cuando list resuelve, y seen se llama una vez por aviso.
//   2. 4.6: seen devolviendo 500 NO rompe el banner — el aviso sigue mostrado y no
//      aparece ningún toast/error (registrar la lectura es telemetría, no gating).
//   3. El ✕ llama a dismiss y el aviso desaparece de la vista aunque dismiss falle.
//   4. El banner ya no toca ConfigService/configuration para nada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/services/Announcements.service', async (importOriginal) => ({
  // announcementMeta se deja real: así el test renderiza el banner de verdad.
  ...(await importOriginal<typeof import('@/services/Announcements.service')>()),
  AnnouncementsService: { list: vi.fn(), seen: vi.fn(), dismiss: vi.fn() },
}))
vi.mock('@/services/Platform.service', () => ({
  // El banner ya no debería importar nada de acá: los spies sirven de alarma.
  ConfigService: { get: vi.fn(), set: vi.fn() },
}))

import AnnouncementBanner from './AnnouncementBanner.vue'
import { AnnouncementsService } from '@/services/Announcements.service'
import { ConfigService } from '@/services/Platform.service'
import { ApiError } from '@/services/http'
import type { Announcement } from '@/services/Announcements.service'

const INFO: Announcement = {
  id: 'a-info', title: 'Check-out tardío', message: 'Hasta 14h con recargo',
  type: 'info', priority: 'medium', active: true,
}
const URGENT: Announcement = {
  id: 'a-urgent', title: 'Corte de agua programado', message: 'Mañana 9 a 12',
  type: 'urgent', priority: 'urgent', active: true,
}
const INACTIVE: Announcement = {
  id: 'a-off', title: 'Anuncio inactivo', type: 'info', priority: 'low', active: false,
}

function announcementsEl(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[aria-label="Cerrar anuncio"]')
}

describe('AnnouncementBanner — lecturas por usuario (ANN-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(AnnouncementsService.list).mockResolvedValue({ data: [INFO, URGENT, INACTIVE] } as any)
    vi.mocked(AnnouncementsService.seen).mockResolvedValue(undefined as any)
    vi.mocked(AnnouncementsService.dismiss).mockResolvedValue(undefined as any)
  })

  it('muestra los avisos activos y registra seen UNA vez por aviso mostrado', async () => {
    const w = mount(AnnouncementBanner)
    await flushPromises()

    // Los dos activos se muestran (el inactivo no), urgent primero por prioridad.
    const txt = w.text()
    expect(txt).toContain('Check-out tardío')
    expect(txt).toContain('Corte de agua programado')
    expect(txt).not.toContain('Anuncio inactivo')
    expect(txt.indexOf('Corte de agua programado')).toBeLessThan(txt.indexOf('Check-out tardío'))

    // seen: una llamada por aviso VISTO, nunca por el inactivo.
    const seenIds = vi.mocked(AnnouncementsService.seen).mock.calls.map((c) => c[0]).sort()
    expect(seenIds).toEqual(['a-info', 'a-urgent'])
    expect(AnnouncementsService.seen).toHaveBeenCalledTimes(2)
  })

  it('4.6: seen con 500 deja el aviso mostrado y sin ningún error visible', async () => {
    vi.mocked(AnnouncementsService.seen).mockRejectedValue(new ApiError(500, 'boom'))

    const w = mount(AnnouncementBanner)
    await flushPromises()

    expect(AnnouncementsService.seen).toHaveBeenCalledTimes(2)
    // El aviso SIGUE en pantalla: el registro de lectura no gatea el banner.
    expect(w.text()).toContain('Check-out tardío')
    expect(w.text()).toContain('Corte de agua programado')
    // Sin toast ni alerta: el banner no renderiza estado de error alguno.
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.text()).not.toMatch(/error|fall[óo]/i)
  })

  it('el ✕ llama a dismiss y el aviso desaparece de la vista aunque dismiss rechace', async () => {
    vi.mocked(AnnouncementsService.dismiss).mockRejectedValue(new ApiError(500, 'boom'))

    const w = mount(AnnouncementBanner)
    await flushPromises()

    // El ✕ del primer aviso (urgent, va primero por el orden de prioridad).
    await announcementsEl(w)[0].trigger('click')
    await flushPromises()

    expect(AnnouncementsService.dismiss).toHaveBeenCalledTimes(1)
    expect(AnnouncementsService.dismiss).toHaveBeenCalledWith('a-urgent')
    // Optimista: ocultó ESE aviso localmente, el otro sigue.
    expect(w.text()).not.toContain('Corte de agua programado')
    expect(w.text()).toContain('Check-out tardío')
    expect(announcementsEl(w)).toHaveLength(1)
    // Y no hay error visible por el dismiss fallido.
    expect(w.text()).not.toMatch(/error/i)

    // El aviso que quedó ya estaba registrado: seen no se repite por el reorden.
    expect(AnnouncementsService.seen).toHaveBeenCalledTimes(2)
  })

  it('no lee ni escribe ConfigService/configuration (el descarte es por usuario en el backend)', async () => {
    mount(AnnouncementBanner)
    await flushPromises()

    expect(ConfigService.get).not.toHaveBeenCalled()
    expect(ConfigService.set).not.toHaveBeenCalled()
  })
})
