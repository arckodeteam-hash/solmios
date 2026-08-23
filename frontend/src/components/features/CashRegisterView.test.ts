// CashRegisterView.test.ts — Regresiones de la auditoría docs/qa-ui/caja-2026-08-22 (H1/H2/H3/M6)
// + 2ª pasada de claridad (la vista se explica sola).
//
// Lo que se protege acá (números del flujo real de la auditoría):
//   1. H2: el conteo del arqueo NO viene prellenado con el esperado — los campos arrancan vacíos.
//   2. La diferencia se calcula EN VIVO por método y total (fondo 500 + 1000 − 200 = 1300 esperado).
//   3. M6: diferencia fuera del centavo ⇒ motivo OBLIGATORIO (botón deshabilitado sin motivo).
//   4. Las denominaciones SUMAN al contado de efectivo (1290 = 1000 + 200 + 50 + 4×10).
//   5. Cierre cuadrado cierra SIN motivo.
//   6. H1: el histórico de turnos muestra la diferencia persistida y resuelve nombres por
//      /api/usuarios (TeamService), nunca IDs crudos.
//   7. Claridad: el protagonista muestra la CUENTA que lo arma; la tarjeta va aparte y aclarada.
//   8. Claridad: turno abierto >24h avisa en ámbar, >7 días en rojo (fecha inyectada, sin fake timers).
//   9. Claridad: sin turno, guía de 3 pasos con "Abrir turno" como único primario.
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
  shift: {}, opening: 500, income: 1300, expense: 200, cashIncome: 1000, cashExpense: 200,
  expected: 1300, counted: 0, difference: -1300,
  byMethod: { cash: 1200, card: 300 }, byMethodNet: { cash: 800, card: 300 },
}

// Reloj fijo por defecto: los fixtures abren el turno el 2026-08-22 08:00 — con el reloj real del
// runner la "edad del turno" cambiaría cada día que se corre la suite. Los tests de alerta
// inyectan el suyo.
const NOW = () => new Date('2026-08-22T12:00:00Z')

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

async function render(service = makeService(), nowFn: () => Date = NOW) {
  wrapper = mount(CashRegisterView, { props: { service: service as any, nowFn } })
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

// ─── Claridad: la vista se explica sola ───

const norm = (s: string) => s.replace(/\s+/g, ' ')

describe('claridad — el número protagonista muestra la cuenta que lo arma', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('escribió la conciliación completa: fondo + ingresos efectivo − egresos efectivo = esperado', async () => {
    const { w } = await render()
    expect(w.find('[data-testid="hero-expected"]').text()).toContain('$1,300')
    const math = norm(w.find('[data-testid="hero-math"]').text())
    // La cuenta QUE DA el número, no solo el número (el "no se entiende nada" del dueño).
    expect(math).toBe('$500 fondo + $1,000 ingresos en efectivo - $200 egresos en efectivo = $1,300')
  })

  it('la tarjeta del turno se muestra APARTE, con su aclaración de que no está en el cajón', async () => {
    const { w } = await render()
    const nonCash = norm(w.find('[data-testid="hero-noncash"]').text())
    expect(nonCash).toContain('Cobros con tarjeta del turno: $300')
    expect(nonCash).toContain('se cuentan aparte')
    expect(norm(w.find('[data-testid="hero-math"]').text())).not.toContain('$300') // la tarjeta JAMÁS entra a la cuenta del cajón
  })

  it('cada número del turno lleva SU micro-texto (qué significa, en la misma tarjeta)', async () => {
    const { w } = await render()
    const text = w.text()
    expect(text).toContain('lo que debería haber en el cajón, según los movimientos del turno')
    expect(text).toContain('efectivo con el que arrancó el turno')
    expect(text).toContain('cobros del turno que entraron al cajón')
    expect(text).toContain('pagos y gastos salidos del cajón')
    expect(text).toContain('cobros sin efectivo: se cuentan aparte, con cupones')
  })
})

describe('una sola fuente — el hero ES el resultado de la cuenta visible', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // Caso prod-like: el payload del reconcile trae un `expected` que NO cierra contra SUS PROPIOS
  // movimientos (saldo legacy acumulado del turno de meses). La vista muestra la suma de
  // movimientos — la auditable — y el hero se DERIVA de los mismos términos que la cuenta imprime.
  const LEGACY = {
    ...RECONCILE,
    expected: 1122, counted: 1122, difference: 0, // el saldo almacenado miente
  }

  it('saldo almacenado ≠ suma de movimientos → el hero muestra la SUMA ($1,300), no el saldo ($1,122)', async () => {
    const { w } = await render(makeService({
      reconcile: vi.fn(async () => LEGACY),
      currentShift: vi.fn(async () => ({ id: 's1', status: 'open', openingAmount: 500, expectedAmount: 1122, openedAt: '2026-08-22T08:00:00' })),
    }))
    const hero = w.find('[data-testid="hero-expected"]').text()
    expect(hero).toContain('$1,300')       // 500 + 1000 − 200, la cuenta de movimientos
    expect(hero).not.toContain('1,122')    // el saldo almacenado JAMÁS llega al hero
  })

  it('el hero y la línea de cuenta dan EL MISMO número: el resultado de la ecuación es el protagonista', async () => {
    const { w } = await render(makeService({ reconcile: vi.fn(async () => LEGACY) }))
    const hero = w.find('[data-testid="hero-expected"]').text().trim()
    const math = norm(w.find('[data-testid="hero-math"]').text())
    expect(math).toBe('$500 fondo + $1,000 ingresos en efectivo - $200 egresos en efectivo = $1,300')
    expect(math.split('=')[1].trim()).toBe(hero) // hero === resultado de la cuenta, al centavo
  })

  it('la cuenta es del turno COMPLETO: usa el desglose del reconcile, no la lista paginada visible', async () => {
    // Movimientos cargados ANTES de esta sesión (la lista de abajo viene vacía/otra página): el
    // desglose del turno ya los incluye — si la cuenta leyera la lista, el hero mentiría.
    const { w } = await render(makeService({
      reconcile: vi.fn(async () => LEGACY),
      movements: vi.fn(async () => ({ data: [], pages: 1 })),
    }))
    const math = norm(w.find('[data-testid="hero-math"]').text())
    expect(math).toContain('+ $1,000 ingresos en efectivo')
    expect(math).toContain('- $200 egresos en efectivo')
  })
})

describe('claridad — alerta de turno abierto demasiado tiempo', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('abierto hace meses → banner ROJO con los días y el pedido de cierre', async () => {
    const { w } = await render(makeService({
      currentShift: vi.fn(async () => ({ id: 's1', status: 'open', openingAmount: 100, openedAt: '2026-04-01T08:00:00Z' })),
    }))
    const alert = w.find('[data-testid="shift-age-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('abierto hace 143 días')
    expect(alert.text()).toContain('cerralo con arqueo')
    expect(alert.attributes('class')).toContain('FEF2F2') // rojo, no ámbar
  })

  it('abierto hace >24h (pero <7 días) → banner ÁMBAR', async () => {
    const { w } = await render(makeService({
      currentShift: vi.fn(async () => ({ id: 's1', status: 'open', openingAmount: 100, openedAt: '2026-08-20T08:00:00Z' })),
    }))
    const alert = w.find('[data-testid="shift-age-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('abierto hace 2 días')
    expect(alert.attributes('class')).toContain('FFFBEB') // ámbar, no rojo
  })

  it('abierto hace horas → sin banner, la edad va discreta al lado del estado', async () => {
    const { w } = await render() // fixture: abierto 2026-08-22 08:00, reloj 12:00Z
    expect(w.find('[data-testid="shift-age-alert"]').exists()).toBe(false)
    expect(w.text()).toContain('hace')
  })
})

describe('claridad — sin turno abierto: guía de 3 pasos, un solo botón primario', () => {
  beforeEach(() => { vi.clearAllMocks() })

  function noShiftService() {
    return makeService({ currentShift: vi.fn(async () => null) })
  }

  it('muestra los 3 pasos numerados de cómo funciona la caja', async () => {
    const { w } = await render(noShiftService())
    const guide = w.find('[data-testid="shift-guide"]')
    expect(guide.exists()).toBe(true)
    const steps = guide.findAll('li')
    expect(steps).toHaveLength(3)
    expect(steps.map(s => s.text())).toEqual([
      expect.stringContaining('Abrí un turno'),
      expect.stringContaining('Registrá ingresos y egresos'),
      expect.stringContaining('Contá la caja y cerrá con arqueo'),
    ] as any[])
    expect(w.text()).toContain('La caja se maneja por turnos')
  })

  it('"Abrir turno" es el ÚNICO primario: sin botones de movimiento en el header ni CTA huérfano', async () => {
    const { w } = await render(noShiftService())
    const buttons = w.findAll('button').map(b => b.text().trim())
    expect(buttons).toContain('Abrir turno')
    expect(buttons).not.toContain('Ingreso')   // registrar sin turno = movimiento huérfano de arqueo
    expect(buttons).not.toContain('Egreso')
    expect(buttons).not.toContain('Registrar ingreso')
  })

  it('abrir turno desde la guía manda el fondo cargado', async () => {
    const { w, service } = await render(noShiftService())
    const input = w.find('#open-amount').element as HTMLInputElement
    input.value = '500'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    await w.findAll('button').find(b => b.text().includes('Abrir turno'))!.trigger('click')
    await flushPromises()
    expect(service.openShift).toHaveBeenCalledWith(500)
  })
})
