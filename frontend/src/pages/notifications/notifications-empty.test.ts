// notifications-empty.test.ts — El vacío de /panel/notifications (issue #19).
//
// La auditoría E2E vio la vista cargando 200 y mostrando "0 sin leer de 0 totales" y un bloque
// suelto que decía "Sin notificaciones" sin explicar qué es el módulo ni qué hacer.
// Además usaba un cuadro propio en vez del `EmptyState` compartido, y un único mensaje tanto
// para "no hay nada" como para "el filtro no matchea".
//
// Lo que se protege acá:
//   1. Bandeja vacía → EmptyState compartido que explica de dónde salen las notificaciones.
//   2. El texto NO afirma la causa del cero: el 0 puede venir de falta de actividad o de un canal
//      de avisos mal configurado. Un mensaje del tipo "todavía no hubo actividad" mentiría.
//   3. Filtro sin resultados = otro estado, con "Limpiar filtros" (no con el texto del módulo).
//   4. El CTA lleva a Configuración → Mensajería, que exige `settings:view`: sin ese permiso
//      no se ofrece el link (terminaría en 403 / ruta bloqueada por permissionModuleForPath).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import type { AppNotification } from '@/services/Notifications.service'

let notificationsData: AppNotification[] = []

vi.mock('@/services/Notifications.service', () => ({
  NotificationsService: {
    list: async () => ({ data: notificationsData }),
    markAsRead: async () => ({}),
    markAllRead: async () => 0,
    remove: async () => ({}),
  },
  notifMeta: () => ({ label: 'Reserva', color: '', icon: '' }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmModal: ref(null),
    confirmBusy: ref(false),
    askConfirm: vi.fn(),
    runConfirm: vi.fn(),
  }),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { hotelId: 'h1', id: 'u1' } }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

let granted: string[] = []
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({
    can: (m: string, a: string) => granted.includes(`${m}:${a}`),
    canRoute: () => true,
    permissions: { value: granted },
  }),
}))

import Notifications from './index.vue'

const MOUNT_OPTS = {
  global: {
    stubs: {
      ConfirmModal: true,
      RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    },
  },
}

function notification(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1', type: 'reservation', title: 'Reserva nueva', message: 'Habitación 101',
    read: false, createdAt: '2026-08-19T10:00:00.000Z',
    ...over,
  } as AppNotification
}

async function render() {
  const w = mount(Notifications, MOUNT_OPTS)
  await flushPromises()
  return w
}

describe('notifications — estado vacío', () => {
  beforeEach(() => {
    notificationsData = []
    granted = ['settings:view']
  })

  it('sin notificaciones usa el EmptyState compartido, no un cuadro propio', async () => {
    const w = await render()
    expect(w.findComponent({ name: 'EmptyState' }).exists()).toBe(true)
  })

  it('explica qué genera notificaciones en vez de mostrar sólo el cero', async () => {
    const w = await render()
    const txt = w.text()
    expect(txt).toContain('Bandeja de avisos vacía')
    // El módulo se explica: los avisos los genera la operación.
    expect(txt).toMatch(/reservas/i)
    expect(txt).toMatch(/pagos/i)
  })

  it('no afirma la causa del cero (podría ser un canal de avisos roto, no falta de actividad)', async () => {
    const w = await render()
    const txt = w.text()
    expect(txt).not.toMatch(/todav[íi]a no hubo actividad/i)
    expect(txt).not.toMatch(/no pas[óo] nada/i)
    expect(txt).not.toMatch(/apenas empiecen/i)
  })

  it('ofrece el primer paso: revisar la configuración de avisos, que es una ruta real', async () => {
    const w = await render()
    const link = w.find('a[href="/panel/config/mensajeria"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toMatch(/configuraci[óo]n de avisos/i)
  })

  it('sin `settings:view` el CTA no aparece (la ruta destino lo exige)', async () => {
    granted = []
    const w = await render()
    expect(w.find('a[href="/panel/config/mensajeria"]').exists()).toBe(false)
    // El estado vacío sigue explicando el módulo, sólo se cae la acción.
    expect(w.text()).toContain('Bandeja de avisos vacía')
  })

  it('filtro sin resultados es otro estado: limpiar filtros, no el texto del módulo', async () => {
    notificationsData = [notification({ read: true })]
    const w = await render()
    await w.find('#notifications-search').setValue('zzzz-no-matchea')
    await flushPromises()
    expect(w.text()).toContain('Ninguna notificación con esos filtros')
    expect(w.text()).not.toContain('Bandeja de avisos vacía')
  })

  it('«Limpiar filtros» devuelve la lista completa', async () => {
    notificationsData = [notification({ read: true })]
    const w = await render()
    await w.find('#notifications-search').setValue('zzzz-no-matchea')
    await flushPromises()
    const btn = w.findAll('button').find((b) => b.text() === 'Limpiar filtros')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(w.findComponent({ name: 'EmptyState' }).exists()).toBe(false)
    expect(w.text()).toContain('Reserva nueva')
  })
})
