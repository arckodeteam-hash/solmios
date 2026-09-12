// NotificationBell.test.ts — #267: la campanita refresca al abrirse.
//
// Antes sólo cargaba en onMounted y cada 30 s de polling: una reserva web recién creada podía
// tardar medio minuto en aparecer. Ahora, al abrir el desplegable se vuelve a pedir la lista
// (sin bloquear la apertura ni duplicar un fetch en curso).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/services/Notifications.service', () => ({
  NotificationsService: { list: vi.fn(), markAllRead: vi.fn(), markAsRead: vi.fn() },
  notifMeta: () => ({ color: '', icon: '' }),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { id: 'u1', hotelId: 'h1' } }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import NotificationBell from './NotificationBell.vue'
import { NotificationsService } from '@/services/Notifications.service'

const NOTIF = {
  id: 'n1',
  type: 'reservation',
  title: 'Nueva reserva web — Ana',
  message: 'Doble · 2 noches',
  read: false,
  sent: true,
  createdAt: new Date().toISOString(),
}

function render() {
  return mount(NotificationBell, {
    global: { stubs: { RouterLink: true, Teleport: true } },
  })
}

describe('NotificationBell — refresco al abrir (#267)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carga una vez al montar y vuelve a pedir la lista al abrir el desplegable', async () => {
    vi.mocked(NotificationsService.list)
      .mockResolvedValueOnce({ data: [], total: 0 })
      .mockResolvedValueOnce({ data: [NOTIF], total: 1 })

    const w = render()
    await flushPromises()
    expect(NotificationsService.list).toHaveBeenCalledTimes(1)
    expect(w.text()).not.toContain('Nueva reserva web — Ana')

    await w.get('button[aria-label="Notificaciones"]').trigger('click')
    expect(NotificationsService.list).toHaveBeenCalledTimes(2)
    await flushPromises()

    expect(w.text()).toContain('Nueva reserva web — Ana')
  })

  it('al abrir muestra lo que ya había mientras llega la respuesta nueva', async () => {
    let resolveSecond!: (v: { data: typeof NOTIF[]; total: number }) => void
    vi.mocked(NotificationsService.list)
      .mockResolvedValueOnce({ data: [NOTIF], total: 1 })
      .mockImplementationOnce(() => new Promise(r => { resolveSecond = r }))

    const w = render()
    await flushPromises()

    await w.get('button[aria-label="Notificaciones"]').trigger('click')
    // Fetch en curso: el desplegable ya está abierto con la lista anterior, sin "Cargando..."
    expect(w.text()).toContain('Nueva reserva web — Ana')
    expect(w.text()).not.toContain('Cargando...')

    resolveSecond({ data: [{ ...NOTIF, id: 'n2', title: 'Nueva reserva web — Luis' }, NOTIF], total: 2 })
    await flushPromises()
    expect(w.text()).toContain('Nueva reserva web — Luis')
  })

  it('no duplica el fetch si ya hay una carga en curso al abrir', async () => {
    vi.mocked(NotificationsService.list).mockImplementation(() => new Promise(() => {}))

    const w = render()
    // La carga de onMounted sigue pendiente → abrir no dispara otra
    await w.get('button[aria-label="Notificaciones"]').trigger('click')
    expect(NotificationsService.list).toHaveBeenCalledTimes(1)
  })

  it('cerrar el desplegable no vuelve a pedir la lista', async () => {
    vi.mocked(NotificationsService.list).mockResolvedValue({ data: [], total: 0 })

    const w = render()
    await flushPromises()
    const bell = w.get('button[aria-label="Notificaciones"]')
    await bell.trigger('click') // abre → 2
    await flushPromises()
    await bell.trigger('click') // cierra → sigue en 2
    expect(NotificationsService.list).toHaveBeenCalledTimes(2)
  })
})
