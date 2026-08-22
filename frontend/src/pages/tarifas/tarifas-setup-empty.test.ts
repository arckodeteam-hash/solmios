// tarifas-setup-empty.test.ts — El vacío de /panel/config/tarifas bloquea la operación (issue #19).
//
// El problema no era "faltan datos": cuando el backend no devuelve temporadas, la vista precarga 4
// plantillas (baja/media/alta/especial) SIN fechas. En pantalla parecen configuradas, pero sin
// rango de fechas el motor no sabe qué tarifa aplicarle a una reserva — el hotel entra creyendo
// que puede tarifar y no puede. Lo que se protege acá:
//   1. Sin ninguna temporada con inicio Y fin, la vista avisa que el motor no puede calcular.
//   2. Con una temporada fechada, el aviso desaparece (no molesta a un hotel ya configurado).
//   3. El primer paso solo se ofrece a quien puede ejecutarlo: guardar temporadas es
//      `settings:edit` (backend modules/pricing/index.ts:47-52) y crear habitaciones `rooms:create`.
//   4. La matriz sin tipos de habitación lleva a /panel/config/habitaciones, ruta que YA existe.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let seasonsData: unknown[] = []
let ratesData: unknown[] = []

vi.mock('@/services/Hotel.service', () => ({
  HotelService: {
    seasons: async () => ({ data: seasonsData }),
    rates: async () => ({ data: ratesData }),
    saveSeasons: async () => ({}),
    saveRates: async () => ({}),
    activateSeason: async () => ({ data: [] }),
    copyRatesNextYear: async () => ({ copied: 0 }),
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

let granted: string[] = []
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({
    can: (m: string, a: string) => granted.includes(`${m}:${a}`),
    canRoute: () => true,
    permissions: { value: granted },
  }),
}))

import Tarifas from './index.vue'

const MOUNT_OPTS = {
  global: {
    stubs: {
      SectionCard: { template: '<section><slot name="actions" /><slot /></section>' },
      RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    },
  },
}

const DATED_SEASON = {
  name: 'alta', label: 'Alta', startDate: '2026-12-01', endDate: '2027-01-15',
  color: '#ef4444', sortOrder: 0, active: 1,
}
const RATE_ROW = { roomType: 'standard', occupancy: 1, season: 'alta', basePrice: 100, percentage: 0, price: 100, closed: 0 }

beforeEach(() => {
  seasonsData = []
  ratesData = []
  granted = ['settings:edit', 'rooms:create']
})

describe('/panel/config/tarifas — configuración que bloquea el tarifado', () => {
  it('avisa que el motor no puede calcular cuando ninguna temporada tiene fechas', async () => {
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    const alert = w.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('El motor de tarifas todavía no puede calcular precios')
    // El primer paso es una acción de ESTA vista, no una promesa: el campo existe en el DOM.
    expect(alert.text()).toContain('Definir fechas de temporada')
    expect(w.find('#temporada-0-inicio').exists()).toBe(true)
  })

  it('no avisa nada cuando ya hay una temporada con inicio y fin', async () => {
    seasonsData = [DATED_SEASON]
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('sigue avisando pero sin botón a quien no tiene settings:edit', async () => {
    granted = ['settings:view']
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    const alert = w.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).not.toContain('Definir fechas de temporada')
    expect(alert.findAll('button')).toHaveLength(0)
  })

  it('la matriz sin tipos de habitación ofrece ir a crear habitaciones', async () => {
    seasonsData = [DATED_SEASON]
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    expect(w.text()).toContain('No hay tarifas configuradas')
    const link = w.findAll('a').find((a) => a.attributes('href') === '/panel/config/habitaciones')
    expect(link).toBeTruthy()
    expect(link!.text()).toContain('Crear habitaciones')
  })

  it('no ofrece crear habitaciones a quien no tiene rooms:create', async () => {
    seasonsData = [DATED_SEASON]
    granted = ['settings:edit']
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    expect(w.text()).toContain('No hay tarifas configuradas')
    expect(w.findAll('a').some((a) => a.attributes('href') === '/panel/config/habitaciones')).toBe(false)
  })

  it('con tarifas cargadas no muestra el estado vacío de la matriz', async () => {
    seasonsData = [DATED_SEASON]
    ratesData = [RATE_ROW]
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    expect(w.text()).not.toContain('No hay tarifas configuradas')
  })
})
