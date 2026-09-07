// tarifas-season-apply.test.ts — Cambiar la temporada desde /panel/config/tarifas (issue #45).
//
// El pedido tiene dos mitades y las dos se protegen acá:
//   1. "que en vez de mandar al planning cambie la temporada": la acción principal de una tarjeta
//      que no rige hoy es un botón que abre un diálogo EN esta pantalla, no un link a otra vista.
//   2. "que el cambio sea real": aplicar escribe `season_assignments` (`assignSeason`), la tabla que
//      lee `buildSeasonByDate` y con la que cotizan el motor, los canales y los cargos. Nunca
//      `activateSeason`, que escribe `seasons.active`, un flag que ningún cálculo de precio lee.
// Y el cierre del circuito: después de aplicar se relee `seasonCalendar`, para que el badge
// "Rige hoy" salga de la misma fuente con la que se cobra y no de lo que acabamos de mandar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { proposedApplyRange } from '@/utils/season-apply'

// `vi.hoisted` porque la fábrica de `vi.mock` se evalúa antes que los `const` del módulo.
const svc = vi.hoisted(() => ({
  assignSeason: vi.fn(),
  activateSeason: vi.fn(),
  seasonCalendar: vi.fn(),
}))

let seasonsData: unknown[] = []

vi.mock('@/services/Hotel.service', () => ({
  HotelService: {
    seasons: async () => ({ data: seasonsData }),
    rates: async () => ({ data: [] }),
    saveSeasons: async () => ({}),
    saveRates: async () => ({}),
    activateSeason: svc.activateSeason,
    assignSeason: svc.assignSeason,
    seasonCalendar: svc.seasonCalendar,
    copyRatesNextYear: async () => ({ copied: 0 }),
    pricingMode: async () => ({ mode: 'per_room' as const }),
    setPricingMode: async () => ({ mode: 'per_room' as const }),
  },
}))

// Los mensajes de error se leen en un test: importa QUÉ dice, no sólo que se avisó.
let toastErrors: string[] = []
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: (m: string) => { toastErrors.push(m) },
    info: vi.fn(),
    warning: vi.fn(),
  }),
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

const TODAY = new Date().toISOString().slice(0, 10)
const NEXT_YEAR = String(Number(TODAY.slice(0, 4)) + 1)

// Dos temporadas fechadas: 'baja' rige hoy (así el badge tiene dónde estar antes de aplicar) y
// 'alta' es la futura que el hotel quiere aplicar.
const BAJA = { name: 'baja', label: 'Baja', startDate: `${NEXT_YEAR}-03-01`, endDate: `${NEXT_YEAR}-05-31`, color: '#3b82f6', sortOrder: 0, active: 1 }
const ALTA = { name: 'alta', label: 'Alta', startDate: `${NEXT_YEAR}-12-01`, endDate: `${NEXT_YEAR}-12-31`, color: '#ef4444', sortOrder: 1, active: 0 }

/** Respuesta de `GET /api/season-calendar` para hoy. */
function calendarDay(season: string, source: 'planning' | 'catalog' = 'catalog') {
  return { data: [{ date: TODAY, season, source }] }
}

/** Botones de las tarjetas de temporada (el de confirmar del diálogo tiene id propio). */
function applyButtons(w: ReturnType<typeof mount>) {
  return w.findAll('button').filter((b) => b.text() === 'Aplicar temporada' && b.attributes('id') !== 'aplicar-confirmar')
}

beforeEach(() => {
  toastErrors = []
  seasonsData = [BAJA, ALTA]
  granted = ['settings:edit', 'rooms:create']
  svc.assignSeason.mockReset().mockResolvedValue({ success: true, count: 31 })
  svc.activateSeason.mockReset().mockResolvedValue({ data: [] })
  svc.seasonCalendar.mockReset().mockResolvedValue(calendarDay('baja'))
})

describe('/panel/config/tarifas — aplicar temporada sin salir de la pantalla', () => {
  it('la temporada que no rige hoy ofrece aplicarla acá, y el planning queda como enlace secundario', async () => {
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    // 'baja' rige hoy: no se ofrece aplicarla. 'alta' sí.
    expect(applyButtons(w)).toHaveLength(1)
    const planning = w.findAll('a').filter((a) => a.text().includes('planning'))
    expect(planning).toHaveLength(1)
    expect(planning[0].text()).toContain('Marcar días sueltos en el planning')
  })

  it('confirmar escribe season_assignments con el rango propuesto y nunca toca seasons.active', async () => {
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    await applyButtons(w)[0].trigger('click')
    const dlg = w.find('[role="dialog"]')
    expect(dlg.exists()).toBe(true)

    const proposed = proposedApplyRange(ALTA, TODAY)
    expect((w.find('#aplicar-desde').element as HTMLInputElement).value).toBe(proposed.from)
    expect((w.find('#aplicar-hasta').element as HTMLInputElement).value).toBe(proposed.to)

    await w.find('#aplicar-confirmar').trigger('click')
    await flushPromises()

    expect(svc.assignSeason).toHaveBeenCalledTimes(1)
    expect(svc.assignSeason).toHaveBeenCalledWith({ from: proposed.from, to: proposed.to, season: 'alta' })
    expect(svc.activateSeason).not.toHaveBeenCalled()
  })

  it('tras aplicar relee la temporada vigente y "Rige hoy" queda en la temporada aplicada', async () => {
    svc.seasonCalendar
      .mockResolvedValueOnce(calendarDay('baja'))
      .mockResolvedValueOnce(calendarDay('alta', 'planning'))

    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()
    expect(svc.seasonCalendar).toHaveBeenCalledTimes(1)

    await applyButtons(w)[0].trigger('click')
    await w.find('#aplicar-confirmar').trigger('click')
    await flushPromises()

    // El badge no sale de lo que mandamos: sale de volver a preguntar por la fuente que cobra.
    expect(svc.seasonCalendar).toHaveBeenCalledTimes(2)
    const cards = w.findAll('.bg-surface.rounded-xl')
    const conBadge = cards.filter((c) => c.text().includes('Rige hoy'))
    expect(conBadge).toHaveLength(1)
    expect(conBadge[0].text()).toContain('Alta')
    // Y el diálogo se cerró.
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('un rango invertido no llega al backend', async () => {
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    await applyButtons(w)[0].trigger('click')
    await w.find('#aplicar-hasta').setValue(`${NEXT_YEAR}-01-01`)
    await w.find('#aplicar-desde').setValue(`${NEXT_YEAR}-12-01`)
    await w.find('#aplicar-confirmar').trigger('click')
    await flushPromises()

    // Un rango invertido no falla en el backend: pinta cero días y devuelve OK.
    expect(svc.assignSeason).not.toHaveBeenCalled()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  // El `min` de los inputs es una ayuda del navegador: la fecha se tipea igual, y jsdom ni siquiera
  // la aplica. Aplicar el pasado repinta `season_assignments` de noches ya vendidas y facturadas.
  it('un rango en el pasado no llega al backend, aunque se escriba a mano', async () => {
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    await applyButtons(w)[0].trigger('click')
    // Los dos inputs anuncian hoy como mínimo, pero la validación no confía en eso.
    expect(w.find('#aplicar-desde').attributes('min')).toBe(TODAY)
    expect(w.find('#aplicar-hasta').attributes('min')).toBe(TODAY)

    await w.find('#aplicar-desde').setValue('2020-01-01')
    await w.find('#aplicar-hasta').setValue('2020-01-31')
    await w.find('#aplicar-confirmar').trigger('click')
    await flushPromises()

    expect(svc.assignSeason).not.toHaveBeenCalled()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  // Cancelar y reabrir con otra temporada mientras la primera llamada sigue en vuelo: al resolver,
  // esa llamada vieja no tiene que cerrar el diálogo nuevo ni borrar el rango que se está escribiendo.
  it('una llamada en vuelo no cierra el diálogo que se reabrió después', async () => {
    let resolvePrimera: (v: unknown) => void = () => {}
    svc.assignSeason.mockImplementationOnce(() => new Promise((res) => { resolvePrimera = res }))

    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    await applyButtons(w)[0].trigger('click')
    await w.find('#aplicar-confirmar').trigger('click')   // queda en vuelo
    await w.find('[role="dialog"] button').trigger('click') // Cancelar
    await applyButtons(w)[0].trigger('click')              // se reabre
    await w.find('#aplicar-hasta').setValue(`${NEXT_YEAR}-12-15`)

    resolvePrimera({ success: true, count: 31 })
    await flushPromises()

    // El diálogo reabierto sigue en pantalla, con lo que el hotel había escrito.
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect((w.find('#aplicar-hasta').element as HTMLInputElement).value).toBe(`${NEXT_YEAR}-12-15`)
  })

  // El diálogo reabierto tiene que poder confirmarse aunque la llamada anterior siga colgada: con un
  // flag global de "aplicando", el botón quedaba deshabilitado por una llamada que ya no es de este
  // diálogo, y el hotel no tenía forma de saber por qué.
  it('el diálogo reabierto se puede confirmar aunque la llamada anterior siga en vuelo', async () => {
    svc.assignSeason.mockImplementationOnce(() => new Promise(() => {}))   // nunca resuelve

    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    await applyButtons(w)[0].trigger('click')
    await w.find('#aplicar-confirmar').trigger('click')     // queda colgada
    await w.find('[role="dialog"] button').trigger('click') // Cancelar
    await applyButtons(w)[0].trigger('click')               // se reabre

    expect(w.find('#aplicar-confirmar').attributes('disabled')).toBeUndefined()

    await w.find('#aplicar-confirmar').trigger('click')
    await flushPromises()

    expect(svc.assignSeason).toHaveBeenCalledTimes(2)
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('el error nombra la temporada que falló, no la que está en pantalla', async () => {
    svc.assignSeason.mockRejectedValueOnce(new Error('403'))

    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    await applyButtons(w)[0].trigger('click')
    await w.find('#aplicar-confirmar').trigger('click')
    await flushPromises()

    expect(toastErrors.some((m) => m.includes('Alta'))).toBe(true)
  })

  it('sin settings:edit no se ofrece aplicar (el endpoint lo exige: sería un 403)', async () => {
    granted = ['settings:view']
    const w = mount(Tarifas, MOUNT_OPTS)
    await flushPromises()

    expect(applyButtons(w)).toHaveLength(0)
    // El enlace al planning sí sigue: mirar el calendario no cambia nada.
    expect(w.findAll('a').some((a) => a.text().includes('planning'))).toBe(true)
  })
})
