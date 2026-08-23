// CashRegisterView.test.ts — Regresiones de la auditoría docs/qa-ui/caja-2026-08-22 (H1/H2/H3/M6).
//
// Lo que se protege acá (números del flujo real de la auditoría):
//   1. H2: el conteo del arqueo NO viene prellenado con el esperado — los campos arrancan vacíos.
//   2. La diferencia se calcula EN VIVO por método y total (fondo 500 + 1000 − 200 = 1300 esperado).
//   3. M6: diferencia fuera del centavo ⇒ motivo OBLIGATORIO (botón deshabilitado sin motivo).
//   4. Las denominaciones SUMAN al contado de efectivo (1290 = 1000 + 200 + 50 + 4×10).
//   5. Cierre cuadrado cierra SIN motivo.
//   6. H1: el histórico de turnos muestra la diferencia persistida y resuelve nombres por
//      /api/usuarios (TeamService), nunca IDs crudos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Singleton: el componente y el test tienen que ver LOS MISMOS vi.fn() para poder asertar.
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})
// Regla del repo: nombres de personal por /api/usuarios (TeamService), NUNCA employee-profiles.
vi.mock('@/services/Team.service', () => ({
  TeamService: {
    list: vi.fn(async () => ({
      data: [
        { id: 'u1', name: 'Ana Pérez' },
        { id: 'u2', name: 'Luis Gómez' },
      ], total: 2,
    })),
  },
}))
vi.mock('@/services/Hotel.service', () => ({
  HotelService: {
    settings: vi.fn(async () => ({ hotel: { currency: 'DOP' }, baseRates: [] })),
  },
}))

import CashRegisterView from './CashRegisterView.vue'
import { useToast } from '@/composables/useToast'
import { TeamService } from '@/services/Team.service'

const toast = useToast()

// Turno abierto fondo $500, con ingreso efectivo $1000, egreso efectivo $200 e ingreso tarjeta
// $300 → esperado en cajón $1300; tarjeta $300 aparte (no se cuenta en el cajón).
const RECONCILE = {
  shift: {}, opening: 500, income: 1300, expense: 200,
  expected: 1300, counted: 0, difference: -1300,
  byMethod: { cash: 1200, card: 300 }, byMethodNet: { cash: 800, card: 300 },
}

function makeService(over: Record<string, unknown> = {}) {
  return {
    stats: vi.fn(async () => ({ today: 0, week: 0, month: 0, count: 0, byMethod: {} })),
    currentShift: vi.fn(async () => ({ id: 's1', status: 'open', openingAmount: 500, openedAt: '2026-08-22T08:00:00' })),
    movements: vi.fn(async () => ({ data: [], pages: 1 })),
    createMovement: vi.fn(),
    removeMovement: vi.fn(),
    openShift: vi.fn(),
    closeShift: vi.fn(async (id: string) => ({ id, status: 'closed' })),
    reconcile: vi.fn(async () => ({ ...RECONCILE })),
    shifts: vi.fn(async () => ({
      data: [{
        id: 's0', status: 'closed', openingAmount: 580, countedAmount: 600, expectedAmount: 670,
        difference: -70, openedAt: '2026-08-20T10:00:00', closedAt: '2026-08-20T18:00:00',
        openedBy: 'u1', closedBy: 'u2', notes: 'Faltante de cambio', byMethodNet: { cash: 90 },
      }],
      total: 1, page: 1, limit: 20, pages: 1, hasNext: false, hasPrev: false,
    })),
    ...over,
  }
}

// Los modales van por <Teleport to="body">: sin cleanup, el body acumula los de tests
// anteriores y los querySelector pescan inputs viejos.
let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

async function render(service = makeService()) {
  wrapper = mount(CashRegisterView, { props: { service: service as any } })
  await flushPromises()
  await flushPromises()
  return { w: wrapper, service }
}

/** Abre el modal de cierre desde el botón del turno actual (el botón vive en el árbol del
 *  componente; el MODAL sí se teleporta a body). */
async function openCloseModal(w: ReturnType<typeof mount>) {
  const btn = w.findAll('button').find(b => b.text().includes('Cerrar turno (arqueo)'))
  expect(btn).toBeTruthy()
  await btn!.trigger('click')
  await flushPromises()
  await flushPromises()
}

const bodyText = () => document.body.textContent || ''
const bodyInput = (id: string) => document.getElementById(id) as HTMLInputElement
const confirmBtn = () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Confirmar cierre')) as HTMLButtonElement

function setInput(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

describe('arqueo — el conteo NO viene prellenado (H2)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('los campos de conteo arrancan VACÍOS, no con el esperado', async () => {
    const { w } = await render()
    await openCloseModal(w)

    const cash = bodyInput('close-count-cash')
    expect(cash).toBeTruthy()
    expect(cash.value).toBe('') // ANTES: venía prellenado con 1300 (el esperado)
    const card = bodyInput('close-count-card')
    expect(card.value).toBe('')
    // La diferencia total todavía no existe: falta contar
    expect(bodyText()).toContain('Contá todos los métodos')
    expect((confirmBtn() as HTMLButtonElement).disabled).toBe(true)
  })

  it('muestra el desglose por método: esperado de efectivo 1300 y tarjeta 300 aparte (H3)', async () => {
    const { w } = await render()
    await openCloseModal(w)

    expect(bodyText()).toContain('Efectivo (cajón)')
    expect(bodyText()).toContain('Tarjeta')
    expect(bodyText()).toContain('$1,300') // esperado efectivo (fondo 500 + neto 800)
    expect(bodyText()).toContain('$300')   // tarjeta, fuera del cajón
    expect(bodyText()).toContain('no suman al esperado') // explica la matemática que antes no cerraba
  })
})

describe('arqueo — diferencia en vivo y motivo obligatorio (M6)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('contar 1290 contra 1300 esperado muestra FALTANTE -$10 en vivo', async () => {
    const { w } = await render()
    await openCloseModal(w)

    setInput(bodyInput('close-count-cash'), '1290')
    setInput(bodyInput('close-count-card'), '300')
    await flushPromises()

    expect(bodyText()).toContain('-$10')
  })

  it('con diferencia, el motivo es OBLIGATORIO: sin él el cierre queda deshabilitado', async () => {
    const { w, service } = await render()
    await openCloseModal(w)

    setInput(bodyInput('close-count-cash'), '1290')
    setInput(bodyInput('close-count-card'), '300')
    await flushPromises()

    expect(bodyText()).toContain('Motivo de la diferencia (obligatorio)')
    expect(confirmBtn().disabled).toBe(true)

    setInput(bodyInput('close-reason'), 'Faltante de cambio avisado')
    await flushPromises()
    expect(confirmBtn().disabled).toBe(false)

    confirmBtn().click()
    await flushPromises()
    expect(service.closeShift).toHaveBeenCalledWith('s1', 1290, 'Faltante de cambio avisado', undefined)
    expect(toast.success).toHaveBeenCalledWith('Turno cerrado')
  })

  it('cierre cuadrado: habilita el cierre SIN motivo y manda notes undefined', async () => {
    const { w, service } = await render()
    await openCloseModal(w)

    setInput(bodyInput('close-count-cash'), '1300')
    setInput(bodyInput('close-count-card'), '300')
    await flushPromises()

    expect(bodyText()).toContain('El arqueo cuadra — no hace falta motivo')
    expect(confirmBtn().disabled).toBe(false)

    confirmBtn().click()
    await flushPromises()
    expect(service.closeShift).toHaveBeenCalledWith('s1', 1300, undefined, undefined)
  })

  it('un método sin contar bloquea el cierre aunque el otro cuadre', async () => {
    const { w, service } = await render()
    await openCloseModal(w)

    setInput(bodyInput('close-count-cash'), '1300')
    await flushPromises()

    expect(confirmBtn().disabled).toBe(true)
    expect(service.closeShift).not.toHaveBeenCalled()
  })
})

describe('arqueo — denominaciones que SUMAN al contado de efectivo', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('1290 = 1000×1 + 200×1 + 50×1 + 10×4: el desglose alimenta el contado de efectivo', async () => {
    const { w, service } = await render()
    await openCloseModal(w)

    bodyInput('close-use-denominations').click()
    await flushPromises()

    setInput(bodyInput('close-denom-1000'), '1')
    setInput(bodyInput('close-denom-200'), '1')
    setInput(bodyInput('close-denom-50'), '1')
    setInput(bodyInput('close-denom-10'), '4')
    await flushPromises()

    expect(document.querySelector('[data-testid="denominations-total"]')?.textContent).toContain('$1,290')
    // El efectivo de la tabla ya no es un input: es la suma del desglose
    expect(document.querySelector('[data-testid="counted-cash"]')?.textContent).toContain('$1,290')

    setInput(bodyInput('close-count-card'), '300')
    setInput(bodyInput('close-reason'), 'Faltante de cambio')
    await flushPromises()

    confirmBtn().click()
    await flushPromises()
    // denominations: JSON con el conteo por denominación (comparado como objeto: el orden de
    // claves numéricas en JSON es ascendente, no el de inserción).
    const call = (service.closeShift as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('s1')
    expect(call[1]).toBe(1290)
    expect(call[2]).toBe('Faltante de cambio')
    expect(JSON.parse(call[3])).toEqual({ 1000: 1, 200: 1, 50: 1, 10: 4 })
  })

  it('si la moneda del hotel NO tiene denominaciones, queda el campo libre de total contado', async () => {
    const { HotelService } = await import('@/services/Hotel.service')
    vi.mocked(HotelService.settings).mockResolvedValueOnce({ hotel: { currency: 'XYZ' }, baseRates: [] } as any)
    const { w } = await render()
    await openCloseModal(w)

    expect(bodyInput('close-use-denominations')).toBeFalsy() // sin toggle
    expect(bodyInput('close-count-cash')).toBeTruthy()       // campo libre
  })
})

describe('histórico de turnos (H1) — la diferencia deja de ser invisible', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('muestra fondo, arqueo, diferencia y estado, con nombres resueltos por /api/usuarios', async () => {
    const { w, service } = await render()
    // El tab y la tabla viven en el árbol del componente (solo los modales se teleportan).
    const tab = w.findAll('button').find(b => b.text().trim() === 'Turnos')
    await tab!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(service.shifts).toHaveBeenCalled()
    expect(TeamService.list).toHaveBeenCalled()
    const text = w.text()
    expect(text).toContain('Histórico de turnos')
    expect(text).toContain('Ana Pérez')  // abrió (u1)
    expect(text).toContain('Luis Gómez') // cerró (u2)
    expect(text).toContain('-$70')       // diferencia persistida, antes invisible en la app
    expect(text).toContain('Faltante de cambio') // el motivo del cierre queda a la vista
    expect(text).toContain('Cerrado')
    expect(text).not.toContain('u1')     // nunca IDs crudos
  })

  it('filtra por fecha desde/hasta y consulta el endpoint con from/to', async () => {
    const { w, service } = await render()
    const tab = w.findAll('button').find(b => b.text().trim() === 'Turnos')
    await tab!.trigger('click')
    await flushPromises()
    await flushPromises()

    const from = w.find('#shifts-from').element as HTMLInputElement
    from.value = '2026-08-01'
    from.dispatchEvent(new Event('input'))   // v-model actualiza histFrom…
    from.dispatchEvent(new Event('change'))  // …y el change dispara la búsqueda
    await flushPromises()
    await flushPromises()

    expect(service.shifts).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-08-01' }))
  })
})
