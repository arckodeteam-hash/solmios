// router/restaurant-routes.test.ts — Permisos coherentes del POS (#205, epic #202).
//
// Antes router, sidebar y vistas no coincidían: el menú le escondía Salón/Caja a `kitchen` pero la
// URL directa lo dejaba entrar (solo Carta tenía `meta`), y `cobrar.vue` usaba `restaurant:edit`
// como permiso de cobro — el mismo que cocina tiene para el KDS. Ahora hay UNA tabla
// (config/restaurant-routes.ts) que alimenta `meta.permission` del router y las entradas del
// sidebar, y el guard global aplica ese permiso a todos los roles.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { RESTAURANT_ROUTES, restaurantRoutePath, posLandingFor } from '@/config/restaurant-routes'
import { hasPermission, orderActionColumns } from '@/config/permissions'
import { permissionModuleForPath } from '@/config/module-map'

const toastWarning = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: toastWarning }),
}))
// El guard de módulos pega a GET /api/modules: acá todo módulo está habilitado.
vi.mock('@/stores/modules.store', () => ({
  useModulesStore: () => ({ ensure: async () => {}, routeEnabled: () => true }),
}))
vi.mock('@/services/Auth.service', () => ({
  AuthService: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), impersonate: vi.fn() },
  clearHotelsCache: vi.fn(),
}))
vi.mock('@/services/Platform.service', () => ({ ModulesService: { enabled: vi.fn() } }))

import router from './index'
import { useAuthStore } from '@/stores/auth.store'
import type { User } from '@/types'

// Espejo de DEFAULT_ROLE_PERMISSIONS (backend/src/shared/permissions.ts) para los roles del POS.
// El test del backend (restaurant/tests/permissions-routes.test.ts) es el que valida el mapa real;
// acá solo importa la FORMA: cocina tiene view/edit, el mozo view/create/edit/pay.
const KITCHEN = ['restaurant:view', 'restaurant:edit', 'attendance:view', 'attendance:create']
const WAITER = ['restaurant:view', 'restaurant:create', 'restaurant:edit', 'restaurant:pay', 'attendance:view', 'attendance:create']

function login(role: string, permissions: string[]) {
  const auth = useAuthStore()
  auth.setTokens('tok', 'ref')
  auth.user = { id: 'u1', name: 'T', email: 't@h.com', role, hotelId: 'h1', hotelName: 'H', permissions } as unknown as User
}

const posRoutes = () => router.getRoutes().filter((r) => r.path.startsWith('/panel/restaurante'))

describe('router — cada ruta restaurante/* declara meta.permission', () => {
  it('todas las rutas del POS tienen meta.permission y salen de RESTAURANT_ROUTES', () => {
    const routes = posRoutes()
    expect(routes.length).toBe(RESTAURANT_ROUTES.length)
    for (const r of routes) {
      const src = RESTAURANT_ROUTES.find((s) => restaurantRoutePath(s) === r.path)
      expect(src, `ruta ${r.path} no está en config/restaurant-routes.ts`).toBeDefined()
      expect(r.meta.permission).toBe(src!.permission)
    }
  })

  it('Carta sigue exigiendo hotel_admin además del permiso', () => {
    const carta = posRoutes().find((r) => r.name === 'restaurant-menu')
    expect(carta?.meta.requiresHotelAdmin).toBe(true)
  })
})

describe('sidebar — no lista una ruta cuyo permiso el rol no tiene', () => {
  // Misma derivación que AdminLayout.vue: entradas con `menu`, visibles si `hasPermission`.
  const visibleMenu = (perms: string[]) =>
    RESTAURANT_ROUTES.filter((r) => r.menu).filter((r) => {
      const [m, a] = r.permission.split(':')
      return hasPermission(perms, m, a)
    })

  it('cocina solo ve el KDS; el mozo ve Salón, KDS y Caja, no Carta', () => {
    expect(visibleMenu(KITCHEN).map((r) => r.menu!.label)).toEqual(['Cocina y Bar (KDS)'])
    // El KDS es `restaurant:edit` y el mozo lo tiene (mismo permiso con el que el backend le deja
    // PUT /kds/lines/:id): verlo en el menú es coherente con la API, antes se le escondía por nombre.
    expect(visibleMenu(WAITER).map((r) => r.menu!.label)).toEqual(['Salón', 'Cocina y Bar (KDS)', 'Caja'])
  })

  it('toda entrada visible para un rol tiene una ruta cuyo meta.permission ese rol cumple', () => {
    for (const perms of [KITCHEN, WAITER]) {
      for (const entry of visibleMenu(perms)) {
        const route = posRoutes().find((r) => r.path === restaurantRoutePath(entry))
        const [m, a] = String(route!.meta.permission).split(':')
        expect(hasPermission(perms, m, a)).toBe(true)
      }
    }
  })
})

describe('guard — kitchen por URL directa rebota al KDS con aviso', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    toastWarning.mockClear()
  })

  it.each(['/panel/restaurante/salon', '/panel/restaurante/caja', '/panel/restaurante/cobrar/o1'])(
    'kitchen → %s → /panel/restaurante/cocina',
    async (path) => {
      login('kitchen', KITCHEN)
      await router.push(path)
      expect(router.currentRoute.value.path).toBe('/panel/restaurante/cocina')
      expect(toastWarning).toHaveBeenCalled()
    },
  )

  it('kitchen sí entra al KDS', async () => {
    login('kitchen', KITCHEN)
    await router.push('/panel/restaurante/cocina')
    expect(router.currentRoute.value.path).toBe('/panel/restaurante/cocina')
  })

  it('waiter entra a Salón, Caja, Cobrar y KDS; no a Carta', async () => {
    login('waiter', WAITER)
    for (const path of ['/panel/restaurante/salon', '/panel/restaurante/caja', '/panel/restaurante/cobrar/o1', '/panel/restaurante/cocina']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe(path)
    }
    await router.push('/panel/restaurante/carta')
    expect(router.currentRoute.value.path).not.toBe('/panel/restaurante/carta')
  })

  it('waiter con la fila de rol vieja (sin restaurant:pay) rebota de Cobrar al Salón — por eso el backfill en migrate-db', async () => {
    login('waiter', WAITER.filter((p) => p !== 'restaurant:pay'))
    await router.push('/panel/restaurante/cobrar/o1')
    expect(router.currentRoute.value.path).toBe('/panel/restaurante/salon')
  })
})

describe('/panel — aterrizaje del POS por PERMISO, no por nombre de rol (sin bucle)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    toastWarning.mockClear()
  })

  it('posLandingFor: mozo → Salón, cocina → KDS, sin permisos del POS → null', () => {
    expect(posLandingFor(WAITER, hasPermission)).toBe('/panel/restaurante/salon')
    expect(posLandingFor(KITCHEN, hasPermission)).toBe('/panel/restaurante/cocina')
    expect(posLandingFor(['restaurant:view'], hasPermission)).toBeNull()
    expect(posLandingFor([], hasPermission)).toBeNull()
  })

  it('waiter personalizado SIN restaurant:create: /panel no lo manda a Salón (que lo rebotaría a /panel otra vez)', async () => {
    // Fila de `roles` editable desde /panel/roles: le sacaron create pero conserva edit → su vista es el KDS.
    login('waiter', ['restaurant:view', 'restaurant:edit'])
    await router.push('/panel')
    expect(router.currentRoute.value.path).toBe('/panel/restaurante/cocina')
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('waiter personalizado sin NINGUNA vista del POS aterriza en el dashboard, no en un bucle', async () => {
    login('waiter', ['restaurant:view', 'attendance:view'])
    await router.push('/panel')
    expect(router.currentRoute.value.path).toBe('/panel/dashboard')
  })

  it('el rebote del guard tampoco entra en bucle: kitchen sin edit va a /panel → dashboard', async () => {
    login('kitchen', ['restaurant:view'])
    await router.push('/panel/restaurante/salon')
    expect(router.currentRoute.value.path).toBe('/panel/dashboard')
    expect(toastWarning).toHaveBeenCalledTimes(1)
  })
})

describe('sidebar — misma exigencia que el router también para el `view` del módulo', () => {
  it('un rol custom con restaurant-catalog:view pero sin restaurant:view no ve Carta (el router lo rebotaría)', () => {
    // Espejo de AdminLayout.allowed(): permiso de la vista Y view del módulo de la ruta.
    const visible = (perms: string[]) =>
      RESTAURANT_ROUTES.filter((r) => r.menu).filter((r) => {
        const [m, a] = r.permission.split(':')
        const mod = permissionModuleForPath(restaurantRoutePath(r))
        return hasPermission(perms, m, a) && (!mod || hasPermission(perms, mod, 'view'))
      })
    expect(visible(['restaurant:create']).map((r) => r.menu!.label)).toEqual([])
    expect(visible(['restaurant:view', 'restaurant:create']).map((r) => r.menu!.label)).toEqual(['Salón', 'Caja'])
    expect(visible(['restaurant-catalog:view']).map((r) => r.menu!.label)).toEqual(['Carta'])
  })
})

describe('matriz de roles — `pay` es una columna (EST-1)', () => {
  it('orderActionColumns dibuja pay después de checkout y no pierde acciones que no conoce', () => {
    expect(orderActionColumns(['edit', 'pay', 'view', 'delete', 'create'])).toEqual(['view', 'create', 'edit', 'delete', 'pay'])
    expect(orderActionColumns(['view', 'checkout', 'pay', 'checkin'])).toEqual(['view', 'checkin', 'checkout', 'pay'])
    // Una acción nueva del catálogo que el frontend todavía no lista igual aparece (al final).
    expect(orderActionColumns(['view', 'approve'])).toEqual(['view', 'approve'])
  })
})
