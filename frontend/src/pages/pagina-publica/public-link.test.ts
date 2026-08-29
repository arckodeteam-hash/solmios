// public-link.test.ts — "Ver en la web pública" tiene que estar en TODAS las tabs del grupo.
//
// Antes vivía duplicado dentro de `landing.vue` y `apariencia.vue`, así que desde Media, Motor de
// reservas, Códigos de descuento, Reputación o Tracking no había forma de abrir la página que se
// está editando. Ahora vive UNA vez en el contenedor de tabs, que es común a las 8.
//
// El test monta el contenedor y recorre las tabs de verdad (`PAGINA_PUBLICA_TABS`): si mañana se
// agrega una novena, se cubre sola. Las vistas hijas van stubbeadas — lo que se prueba es el
// contenedor, no su contenido.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { PAGINA_PUBLICA_TABS } from '@/config/pagina-publica-tabs'

let slugImpl: () => Promise<any>
vi.mock('@/services/Settings.service', () => ({
  SettingsService: { get: () => slugImpl() },
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ userRole: 'hotel_admin' }),
}))

let currentTab = 'general'
const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/panel/pagina-publica', query: { tab: currentTab } }),
  useRouter: () => ({ replace }),
}))

import Index from './index.vue'

const MOUNT_OPTS = {
  global: {
    stubs: { EmptyState: true },
    // Cada tab es un componente async propio; acá sólo interesa el contenedor.
    config: { warnHandler: () => {} },
  },
}

beforeEach(() => {
  slugImpl = async () => ({ hotel: { slug: 'hotel-boutique-palma' } })
})

describe('Página pública — link a la web pública', () => {
  it.each(PAGINA_PUBLICA_TABS.map(t => [t.value, t.label]))(
    'aparece en la tab "%s" (%s)',
    async (tab) => {
      currentTab = String(tab)
      const w = mount(Index, MOUNT_OPTS)
      await flushPromises()

      const link = w.find('a[target="_blank"]')
      expect(link.exists()).toBe(true)
      expect(link.text()).toContain('Ver en la web pública')
      expect(link.attributes('href')).toBe('/h/hotel-boutique-palma')
    },
  )

  it('escapa el slug en la URL', async () => {
    slugImpl = async () => ({ hotel: { slug: 'hotel con espacios' } })
    currentTab = 'general'
    const w = mount(Index, MOUNT_OPTS)
    await flushPromises()
    expect(w.find('a[target="_blank"]').attributes('href')).toBe('/h/hotel%20con%20espacios')
  })

  it('sin slug no se muestra el link: la landing no tiene dirección a la que ir', async () => {
    slugImpl = async () => ({ hotel: {} })
    currentTab = 'general'
    const w = mount(Index, MOUNT_OPTS)
    await flushPromises()
    expect(w.find('a[target="_blank"]').exists()).toBe(false)
  })

  it('si el fetch del slug falla, la pantalla igual se dibuja', async () => {
    slugImpl = async () => { throw new Error('sin permiso') }
    currentTab = 'general'
    const w = mount(Index, MOUNT_OPTS)
    await flushPromises()
    expect(w.find('a[target="_blank"]').exists()).toBe(false)
    expect(w.text()).toContain('Página pública')
  })
})
