// empty-state-cta-permissions.test.ts — Los estados vacíos "legítimos" del panel (issue #19).
//
// La auditoría E2E encontró módulos que cargan 200 y muestran sólo un cero. Para los que están
// vacíos de verdad (no hay una integración caída atrás) alcanza con explicar qué es el módulo y
// cuál es el primer paso. Pero ese "primer paso" tiene dos condiciones que antes no se cumplían:
//
//   a) NO se le ofrece a quien no tiene el permiso para ejecutarlo. Todos estos CTA salían siempre,
//      así que un rol sin `create` apretaba el botón y comía un 403 del backend.
//   b) Tiene que ser una acción o ruta que YA existe. En Reseñas el CTA "Solicitar Reseñas" sólo
//      disparaba un toast (`requestReviews()` no llama a ningún servicio): prometía un envío que
//      nunca salía.
//
// Cubre: reservas/grupos · rrhh/reembolsos · rrhh/reclutamiento · rrhh/evaluacion · resenas ·
// compras/ordenes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

// ── Datos que cada test ajusta antes de montar ──────────────────────────────
let granted: string[] = []
let groupsData: Record<string, unknown>[] = []
let claimsData: unknown[] = []
let applicantsData: unknown[] = []
let evalResultsData: unknown[] = []
let reviewsData: unknown[] = []
let ordersData: unknown[] = []
let suppliersData: unknown[] = []
let requisitionsData: unknown[] = []
let fundsData: unknown[] = []

vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({
    can: (m: string, a: string) => granted.includes(`${m}:${a}`),
    canRoute: () => true,
    permissions: { value: granted },
  }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmModal: ref(null), confirmBusy: ref(false), askConfirm: vi.fn(), runConfirm: vi.fn(),
  }),
}))
vi.mock('@/composables/useApiError', () => ({ useApiError: () => ({ handle: vi.fn() }) }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', id: 'u1' } }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('@/services/Operations.service', () => ({
  OperationsService: { grupos: { list: async () => ({ data: groupsData }), create: async () => ({}) } },
}))
vi.mock('@/services/Reembolsos.service', () => ({
  ReembolsosService: {
    list: async () => claimsData,
    totals: async () => ({ submitted: { count: 0, amount: 0 }, approved: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 } }),
    create: async () => ({}), submit: async () => ({}), approve: async () => ({}),
    reject: async () => ({}), pay: async () => ({}), remove: async () => ({}),
  },
}))
vi.mock('@/services/Reclutamiento.service', () => ({
  ReclutamientoService: {
    list: async () => applicantsData,
    create: async () => ({}), moveStage: async () => ({}), hire: async () => ({}), reject: async () => ({}),
  },
}))
vi.mock('@/services/Empleados.service', () => ({
  EmpleadosService: {
    listProfiles: async () => ({ data: [] }),
    listEvalResults: async () => evalResultsData,
    getEvalConfig: async () => ({
      id: 'c1', hotelId: 'h1', period: 'monthly',
      weights: { productivity: 25, quality: 25, punctuality: 25, attendance: 25 },
      thresholds: { excellent: 90, good: 75, fair: 60 },
      standardTaskMinutes: 30, enabled: true,
    }),
    updateEvalConfig: async () => ({}),
    runEvaluation: async () => ({}),
  },
}))
vi.mock('@/services/Opiniones.service', () => ({
  OpinionesService: { list: async () => reviewsData, respond: async () => ({}) },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: async () => null, set: async () => ({}) },
}))
vi.mock('@/services/Compras.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ComprasService: {
    listOrders: async () => ordersData,
    listRequisitions: async () => requisitionsData,
    getOrder: async () => ({}), getRequisition: async () => ({ items: [] }),
    createOrder: async () => ({}), transitionOrder: async () => ({}),
    receive: async () => ({}), markInvoiced: async () => ({}),
  },
}))
vi.mock('@/services/Treasury.service', () => ({
  TreasuryService: { listSuppliers: async () => ({ data: suppliersData }) },
}))
vi.mock('@/services/Inventario.service', () => ({
  InventarioService: { listItems: async () => [] },
}))
vi.mock('@/services/CajaChica.service', () => ({
  CajaChicaService: {
    listFunds: async () => ({ data: fundsData }),
    listReplenishments: async () => ({ data: [] }),
    createFund: async () => ({}), updateFund: async () => ({}),
  },
}))
vi.mock('@/services/Team.service', () => ({
  TeamService: { list: async () => ({ data: [], total: 0 }) },
}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: { get: async () => ({ hotel: { id: 'h1', currency: 'USD', taxRate: 18 } }) },
}))

import Grupos from './groups/index.vue'
import Reembolsos from './reembolsos/index.vue'
import Reclutamiento from './reclutamiento/index.vue'
import Evaluacion from './rrhh-evaluacion/index.vue'
import Resenas from './opiniones/index.vue'
import Ordenes from './compras/ordenes.vue'
import Requisiciones from './compras/requisiciones.vue'
import CajaChica from './tesoreria/caja-chica.vue'

const MOUNT_OPTS = {
  global: {
    stubs: {
      SectionCard: { template: '<section><slot name="actions" /><slot /></section>' },
      KpiHeroCard: true,
      AppModal: true,
      FormModal: true,
      ConfirmModal: true,
      SkeletonLoader: true,
      RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    },
  },
}

async function render(cmp: unknown) {
  const w = mount(cmp as never, MOUNT_OPTS)
  await flushPromises()
  return w
}

/** Texto de todos los botones/links visibles, para afirmar sobre la existencia de un CTA. */
function ctas(w: ReturnType<typeof mount>): string[] {
  return [...w.findAll('button'), ...w.findAll('a')].map((n) => n.text().trim()).filter(Boolean)
}

beforeEach(() => {
  granted = []
  groupsData = []; claimsData = []; applicantsData = []
  evalResultsData = []; reviewsData = []; ordersData = []; suppliersData = []
  requisitionsData = []; fundsData = []
})

describe('reservas/grupos — vacío', () => {
  it('explica qué es un grupo, no sólo "GRUPOS ACTIVOS 0"', async () => {
    granted = ['reservations:create']
    const txt = (await render(Grupos)).text()
    expect(txt).toContain('Todavía no hay grupos')
    expect(txt).toMatch(/habitaciones/i)
    expect(txt).toMatch(/mismo contacto/i)
  })

  it('con `reservations:create` ofrece crear el primer grupo', async () => {
    granted = ['reservations:create']
    expect(ctas(await render(Grupos)).some((t) => /nuevo grupo/i.test(t))).toBe(true)
  })

  it('sin `reservations:create` no ofrece el botón (el alta daría 403)', async () => {
    granted = ['reservations:view']
    const w = await render(Grupos)
    expect(ctas(w).some((t) => /nuevo grupo/i.test(t))).toBe(false)
    // El vacío sigue explicando el módulo: sólo se cae la acción.
    expect(w.text()).toContain('Todavía no hay grupos')
  })
})

describe('rrhh/reembolsos — vacío', () => {
  it('explica el circuito en vez de mostrar sólo "0 solicitud(es)"', async () => {
    granted = ['users:create']
    const txt = (await render(Reembolsos)).text()
    expect(txt).toContain('Todavía no hay reembolsos')
    expect(txt).toMatch(/aprob/i)
    expect(txt).toMatch(/reintegr/i)
  })

  it('sin `users:create` no ofrece "Nuevo reembolso"', async () => {
    granted = ['users:view']
    const w = await render(Reembolsos)
    expect(ctas(w).some((t) => /nuevo reembolso/i.test(t))).toBe(false)
    expect(w.text()).toContain('Todavía no hay reembolsos')
  })

  it('con `users:create` sí lo ofrece', async () => {
    granted = ['users:create']
    expect(ctas(await render(Reembolsos)).some((t) => /nuevo reembolso/i.test(t))).toBe(true)
  })
})

describe('rrhh/reclutamiento — vacío', () => {
  it('explica el pipeline una vez, no seis columnas con "Sin postulantes"', async () => {
    granted = ['users:create']
    const w = await render(Reclutamiento)
    expect(w.text()).toContain('Todavía no hay postulantes')
    expect(w.text()).toMatch(/entrevista/i)
    // Un solo estado vacío, no uno por etapa.
    expect(w.findAllComponents({ name: 'EmptyState' })).toHaveLength(1)
  })

  it('sin `users:create` no ofrece "Nuevo postulante"', async () => {
    granted = ['users:view']
    const w = await render(Reclutamiento)
    expect(ctas(w).some((t) => /nuevo postulante/i.test(t))).toBe(false)
    expect(w.text()).toContain('Todavía no hay postulantes')
  })

  it('con postulantes vuelve el tablero por etapas', async () => {
    granted = ['users:create']
    applicantsData = [{ id: 'a1', name: 'Ana Pérez', stage: 'new', email: 'ana@test.com' }]
    const w = await render(Reclutamiento)
    expect(w.text()).toContain('Ana Pérez')
    expect(w.text()).not.toContain('Todavía no hay postulantes')
  })
})

describe('rrhh/evaluacion — vacío', () => {
  it('explica de qué datos sale el puntaje', async () => {
    granted = ['users:edit']
    const txt = (await render(Evaluacion)).text()
    expect(txt).toContain('Todavía no hay evaluaciones')
    expect(txt).toMatch(/limpieza/i)
    expect(txt).toMatch(/asistencia/i)
  })

  it('sin `users:edit` no ofrece ejecutar el motor (escribe evaluaciones)', async () => {
    granted = ['users:view']
    const w = await render(Evaluacion)
    expect(ctas(w).some((t) => /ejecutar/i.test(t))).toBe(false)
    expect(w.text()).toContain('Todavía no hay evaluaciones')
  })

  it('con `users:edit` sí lo ofrece', async () => {
    granted = ['users:edit']
    expect(ctas(await render(Evaluacion)).some((t) => /ejecutar/i.test(t))).toBe(true)
  })
})

describe('resenas — vacío', () => {
  it('no afirma la causa del cero: puede ser que el envío automático esté apagado', async () => {
    granted = ['settings:view']
    const txt = (await render(Resenas)).text()
    expect(txt).toContain('Sin opiniones aún')
    expect(txt).not.toMatch(/apenas empiecen a llegar/i)
    expect(txt).toMatch(/check-out/i)
  })

  it('el primer paso es una ruta real, no el botón que sólo tiraba un toast', async () => {
    granted = ['settings:view']
    const w = await render(Resenas)
    const link = w.find('a[href="/panel/config/mensajeria?tab=auto-messages"]')
    expect(link.exists()).toBe(true)
    // El CTA del vacío ya no dispara `requestReviews()` (que no llamaba a ningún servicio).
    const empty = w.findComponent({ name: 'EmptyState' })
    expect(empty.findAll('button')).toHaveLength(0)
  })

  it('sin `settings:view` no ofrece el link a Mensajería', async () => {
    granted = []
    const w = await render(Resenas)
    expect(w.find('a[href="/panel/config/mensajeria?tab=auto-messages"]').exists()).toBe(false)
    expect(w.text()).toContain('Sin opiniones aún')
  })
})

describe('compras/ordenes — vacío', () => {
  it('sin proveedores el primer paso es cargarlos, no "Nueva orden" (submitCreate exige supplierId)', async () => {
    granted = ['purchasing:create']
    suppliersData = []
    const w = await render(Ordenes)
    expect(w.text()).toContain('Primero cargá tus proveedores')
    const empty = w.findComponent({ name: 'EmptyState' })
    expect(empty.find('a[href="/panel/tesoreria/proveedores"]').exists()).toBe(true)
    // El vacío no manda a un alta que va a rebotar por falta de proveedor. (El botón del header
    // sigue existiendo: su modal ya avisa "No hay proveedores. Cargalos en Tesorería → Proveedores".)
    expect(empty.findAll('button')).toHaveLength(0)
  })

  it('con proveedores explica el circuito y ofrece crear la orden', async () => {
    granted = ['purchasing:create']
    suppliersData = [{ id: 's1', name: 'Distribuidora Test' }]
    const w = await render(Ordenes)
    expect(w.text()).toContain('Todavía no hay órdenes de compra')
    expect(w.text()).toMatch(/stock/i)
    expect(w.find('a[href="/panel/tesoreria/proveedores"]').exists()).toBe(false)
    expect(ctas(w).some((t) => /nueva orden/i.test(t))).toBe(true)
  })

  it('sin `purchasing:create` no ofrece ninguna acción del vacío', async () => {
    granted = ['purchasing:view']
    suppliersData = [{ id: 's1', name: 'Distribuidora Test' }]
    const w = await render(Ordenes)
    const empty = w.findComponent({ name: 'EmptyState' })
    expect(empty.findAll('button')).toHaveLength(0)
    expect(empty.findAll('a')).toHaveLength(0)
    expect(w.text()).toContain('Todavía no hay órdenes de compra')
  })
})

describe('compras/requisiciones — vacío', () => {
  it('explica qué es una requisición y a dónde va, no sólo "sin requisiciones"', async () => {
    granted = ['purchasing:create']
    const txt = (await render(Requisiciones)).text()
    expect(txt).toContain('Todavía no hay requisiciones')
    expect(txt).toMatch(/pedido interno/i)
    expect(txt).toMatch(/orden de compra/i)
  })

  it('sin `purchasing:create` no ofrece el alta', async () => {
    granted = ['purchasing:view']
    const w = await render(Requisiciones)
    const empty = w.findComponent({ name: 'EmptyState' })
    expect(empty.findAll('button')).toHaveLength(0)
    expect(w.text()).toContain('Todavía no hay requisiciones')
  })
})

describe('tesoreria/caja-chica — vacío', () => {
  it('explica el circuito del fondo, no sólo "FONDOS ACTIVOS 0"', async () => {
    granted = ['treasury:create']
    const txt = (await render(CajaChica)).text()
    expect(txt).toContain('Todavía no hay fondos de caja chica')
    expect(txt).toMatch(/custodio|responsable/i)
    expect(txt).toMatch(/repon/i)
  })

  it('sin `treasury:create` no ofrece "Nuevo fondo"', async () => {
    granted = ['treasury:view']
    const w = await render(CajaChica)
    const empty = w.findComponent({ name: 'EmptyState' })
    expect(empty.findAll('button')).toHaveLength(0)
    expect(w.text()).toContain('Todavía no hay fondos de caja chica')
  })
})
