/**
 * reportes.test.ts — #213: cierre del día del restaurante.
 *
 * 1. CSV puro (reportes-csv.ts): las mismas cifras que el objeto del reporte, línea por línea.
 * 2. Página montada (@vue/test-utils + happy-dom) con el service mockeado: KPIs y tabla por método con el
 *    criterio de aceptación (450 / 20 / 100-200-0-150 / 3 / 150), anulaciones con motivo, descuentos y
 *    cortesías con motivo y usuario (#215), estado vacío
 *    (no ceros sueltos) con el botón de CSV deshabilitado, cambiar la fecha recalcula, y las tres pestañas
 *    salen de PillTabs.
 * 3. Registro de la ruta: `restaurante/reportes` con permiso `reports:view` en RESTAURANT_ROUTES.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { buildDailyReportCsv, dailyReportCsvFilename, csvCell } from './reportes-csv'
import { todayIn, shiftDays } from './reportes-date'
import { RESTAURANT_ROUTES } from '@/config/restaurant-routes'
import { permissionModuleForPath } from '@/config/module-map'
import type { RestaurantDailyReport } from '@/services/Restaurant.service'

const dailyReport = vi.fn<(params?: Record<string, string>) => Promise<RestaurantDailyReport>>()
const toastSuccess = vi.fn()

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))
vi.mock('@/services/Restaurant.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/Restaurant.service')>()
  return { ...mod, RestaurantService: { ...mod.RestaurantService, dailyReport: (p?: Record<string, string>) => dailyReport(p) } }
})

const TZ = 'America/Santo_Domingo'
/** Hoy en la zona del hotel: lo que el backend devuelve en `from` cuando se lo llama sin fecha. */
const HOTEL_TODAY = todayIn(TZ)

const zero = { amount: 0, orders: 0 }
function emptyReport(date = '2026-09-10'): RestaurantDailyReport {
  return {
    from: date, to: date, timezone: TZ, currency: 'DOP', empty: true,
    sales: { total: 0, subtotal: 0, tax: 0, tips: 0, collected: 0, orders: 0, averageTicket: 0, covers: 0, averagePerCover: 0 },
    byMethod: { cash: { ...zero }, card: { ...zero }, transfer: { ...zero }, folio: { ...zero }, other: { ...zero } },
    byType: { dine_in: { ...zero }, room_service: { ...zero }, takeaway: { ...zero } },
    voided: { orders: 0, lines: 0, amount: 0, rows: [] }, refunded: { orders: 0, amount: 0 },
    discounts: { orders: 0, count: 0, amount: 0, courtesies: { count: 0, amount: 0 }, rows: [] },
    topItemsByQuantity: [], topItemsByAmount: [], byStation: [], byHour: [],
    byDay: [{ date, orders: 0, amount: 0, tips: 0 }],
  }
}
/** Criterio de aceptación: efectivo 100, tarjeta 200 + propina 20, folio 150 + una comanda cancelada y una línea anulada. */
function acceptanceReport(): RestaurantDailyReport {
  return {
    ...emptyReport('2026-09-11'), empty: false,
    sales: { total: 450, subtotal: 450, tax: 0, tips: 20, collected: 470, orders: 3, averageTicket: 150, covers: 5, averagePerCover: 90 },
    byMethod: { cash: { amount: 100, orders: 1 }, card: { amount: 200, orders: 1 }, transfer: { ...zero }, folio: { amount: 150, orders: 1 }, other: { ...zero } },
    byType: { dine_in: { amount: 300, orders: 2 }, room_service: { amount: 150, orders: 1 }, takeaway: { ...zero } },
    voided: {
      orders: 1, lines: 1, amount: 77.2,
      rows: [
        { kind: 'order', orderId: 'o-cancel', orderNumber: 'CMD-7', name: '1× Hamburguesa', quantity: 1, amount: 47.2, reason: 'Cliente se fue', at: '2026-09-11T18:00:00.000Z', by: 'u1' },
        { kind: 'line', orderId: 'o-cash', orderNumber: 'CMD-1', name: 'Postre', quantity: 1, amount: 30, reason: 'Error de carga', at: '2026-09-11T16:10:00.000Z', by: 'u1' },
      ],
    },
    // #215: una cortesía de línea (Vino, 100 %) y un descuento de comanda (20 %), con motivo y usuario resuelto.
    discounts: {
      orders: 2, count: 2, amount: 70, courtesies: { count: 1, amount: 50 },
      rows: [
        { kind: 'line', orderId: 'o-card', orderNumber: 'CMD-2', name: 'Vino', quantity: 1, base: 50, amount: 50, percent: 100, courtesy: true, reason: 'Cortesía de la casa', at: '2026-09-11T17:05:00.000Z', by: 'u-owner', byName: 'Doña Marta' },
        { kind: 'order', orderId: 'o-cash', orderNumber: 'CMD-1', name: 'Comanda completa', quantity: 0, base: 100, amount: 20, percent: 20, courtesy: false, reason: 'Huésped del hotel', at: '2026-09-11T16:10:00.000Z', by: 'u-gone', byName: null },
      ],
    },
    topItemsByQuantity: [{ menuItemId: 'mi-pizza', name: 'Pizza', quantity: 5, amount: 250 }],
    topItemsByAmount: [{ menuItemId: 'mi-pizza', name: 'Pizza', quantity: 5, amount: 250 }],
    byStation: [{ stationId: 'st1', stationName: 'Cocina', quantity: 7, amount: 400 }],
    byHour: [{ hour: 12, orders: 1, amount: 100 }, { hour: 13, orders: 1, amount: 200 }, { hour: 21, orders: 1, amount: 150 }],
    byDay: [{ date: '2026-09-11', orders: 3, amount: 450, tips: 20 }],
  }
}

describe('reportes-csv — las mismas cifras que el reporte', () => {
  it('escapa comas, comillas y saltos; números con 2 decimales solo si no son enteros', () => {
    expect(csvCell('Pizza, grande')).toBe('"Pizza, grande"')
    expect(csvCell('Dijo "no"')).toBe('"Dijo ""no"""')
    expect(csvCell(47.2)).toBe('47.20')
    expect(csvCell(450)).toBe('450')
    expect(csvCell(null)).toBe('')
  })

  it('resumen, por método, anulaciones con motivo y nombre de archivo por fecha', () => {
    const csv = buildDailyReportCsv(acceptanceReport())
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Cierre del restaurante,2026-09-11,DOP')
    expect(lines).toContain('Ventas (sin propina),450')
    expect(lines).toContain('Propinas,20')
    expect(lines).toContain('Comandas,3')
    expect(lines).toContain('Ticket promedio,150')
    expect(lines).toContain('Efectivo,1,100')
    expect(lines).toContain('Tarjeta,1,200')
    expect(lines).toContain('Transferencia,0,0')
    expect(lines).toContain('Cargo a habitación,1,150')
    expect(lines).toContain('Anulado (comandas + líneas),77.20')
    expect(lines).toContain('Comanda cancelada,CMD-7,1× Hamburguesa,1,47.20,Cliente se fue,2026-09-11T18:00:00.000Z')
    expect(lines).toContain('Línea anulada,CMD-1,Postre,1,30,Error de carga,2026-09-11T16:10:00.000Z')
    // #215: descuentos y cortesías con motivo y usuario (nombre resuelto; si no, el id).
    expect(lines).toContain('Descontado (descuentos + cortesías),70')
    expect(lines).toContain('Cortesías,50')
    expect(lines).toContain('Cortesía,CMD-2,Vino,1,50,50,100,Cortesía de la casa,Doña Marta,2026-09-11T17:05:00.000Z')
    expect(lines).toContain('Descuento de comanda,CMD-1,Comanda completa,0,100,20,20,Huésped del hotel,u-gone,2026-09-11T16:10:00.000Z')
    expect(lines).toContain('Pizza,5,250')
    expect(lines).toContain('12:00,1,100')
    // Un solo día: no hay sección "Día" (solo aparece en rangos).
    expect(lines).not.toContain('Día,Comandas,Importe,Propinas')
    expect(dailyReportCsvFilename({ from: '2026-09-11', to: '2026-09-11' })).toBe('cierre-restaurante-2026-09-11.csv')
    expect(dailyReportCsvFilename({ from: '2026-09-01', to: '2026-09-11' })).toBe('cierre-restaurante-2026-09-01_2026-09-11.csv')
  })

  it('en rango agrega la serie diaria', () => {
    const r = acceptanceReport()
    r.from = '2026-09-10'
    r.byDay = [{ date: '2026-09-10', orders: 0, amount: 0, tips: 0 }, { date: '2026-09-11', orders: 3, amount: 450, tips: 20 }]
    const lines = buildDailyReportCsv(r).split('\r\n')
    expect(lines[0]).toBe('Cierre del restaurante,2026-09-10 a 2026-09-11,DOP')
    expect(lines).toContain('Día,Comandas,Importe,Propinas')
    expect(lines).toContain('2026-09-10,0,0,0')
    expect(lines).toContain('2026-09-11,3,450,20')
  })
})

// ── Página montada ──────────────────────────────────────────────────────────
let wrapper: VueWrapper | null = null
async function mountPage() {
  const { default: Reportes } = await import('./reportes.vue')
  wrapper = mount(Reportes, { attachTo: document.body, global: { stubs: { RouterLink: true } } })
  await flushPromises()
  return wrapper
}
const text = () => document.body.textContent ?? ''

beforeEach(() => { dailyReport.mockReset(); toastSuccess.mockReset() })
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = '' })

describe('reportes-date — "hoy" es el del hotel, no el del navegador', () => {
  it('todayIn: 02:00Z del 12 es el 11 en Santo Domingo y el 12 en Madrid; zona inválida cae al navegador sin romper', () => {
    const at = new Date('2026-09-12T02:00:00.000Z')
    expect(todayIn('America/Santo_Domingo', at)).toBe('2026-09-11')
    expect(todayIn('Europe/Madrid', at)).toBe('2026-09-12')
    expect(todayIn('No/Existe', at)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('shiftDays: aritmética de calendario sobre la fecha del hotel; fecha vacía se devuelve tal cual', () => {
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDays('', -1)).toBe('')
  })
})

describe('reportes.vue — criterio de aceptación', () => {
  it('al montar pide el cierre SIN fecha (el backend resuelve hoy en la zona del hotel) y pinta ventas, propinas, por método, comandas y ticket promedio', async () => {
    dailyReport.mockResolvedValue({ ...acceptanceReport(), from: HOTEL_TODAY, to: HOTEL_TODAY })
    const w = await mountPage()
    expect(dailyReport).toHaveBeenCalledTimes(1)
    expect(dailyReport.mock.calls[0][0]).toEqual({})
    // El selector de fecha queda en el "hoy" que devolvió el backend (zona del hotel), no en el del navegador.
    expect((w.find('#report-date').element as HTMLInputElement).value).toBe(HOTEL_TODAY)
    // Tres pestañas de PillTabs.
    expect(w.findAll('[role="tab"]').map((t) => t.text().replace(/\s*\(\d+\)$/, ''))).toEqual(['Día', 'Rango', 'Ítems'])
    // Por método: 100 / 200 / (transferencia sin ventas no se pinta) / 150, con moneda del hotel.
    const rows = w.findAll('tr[data-method]')
    expect(rows.map((r) => r.attributes('data-method'))).toEqual(['cash', 'card', 'folio'])
    expect(rows[0].text()).toContain('RD$100.00')
    expect(rows[1].text()).toContain('RD$200.00')
    expect(rows[2].text()).toContain('RD$150.00')
    // KPIs: comandas y propinas (el value animado se resuelve por el unit/sub-stats, que son texto plano).
    expect(text()).toContain('3 comanda(s)')
    expect(text()).toContain('Cobrado con propinas: RD$470.00')
    expect(text()).toContain('RD$90.00 por comensal')
    expect(text()).toContain('RD$20.00')
  })

  it('anuladas: comanda cancelada y línea anulada con monto y motivo', async () => {
    dailyReport.mockResolvedValue(acceptanceReport())
    const w = await mountPage()
    const rows = w.findAll('tr[data-void-row]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Comanda cancelada')
    expect(rows[0].text()).toContain('Cliente se fue')
    expect(rows[0].text()).toContain('RD$47.20')
    expect(rows[1].text()).toContain('Línea anulada')
    expect(rows[1].text()).toContain('Postre')
    expect(rows[1].text()).toContain('Error de carga')
    expect(rows[1].text()).toContain('RD$30.00')
  })

  it('descuentos y cortesías: cada uno con motivo, usuario resuelto (o el id si ya no existe) y comanda; la cortesía va marcada', async () => {
    dailyReport.mockResolvedValue(acceptanceReport())
    const w = await mountPage()
    expect(w.text()).toContain('2 descuento(s) en 2 comanda(s) · 1 cortesía(s) por RD$50.00')
    expect(w.text()).toContain('Descontado RD$70.00')
    const rows = w.findAll('tr[data-discount-row]')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes('data-courtesy')).toBe('1')
    expect(rows[0].text()).toContain('Cortesía')
    expect(rows[0].text()).toContain('CMD-2')
    expect(rows[0].text()).toContain('Vino')
    expect(rows[0].text()).toContain('Cortesía de la casa')
    expect(rows[0].text()).toContain('Doña Marta')
    expect(rows[0].text()).toContain('−RD$50.00')
    expect(rows[1].attributes('data-courtesy')).toBe('0')
    expect(rows[1].text()).toContain('Comanda −20%')
    expect(rows[1].text()).toContain('Comanda completa')
    expect(rows[1].text()).toContain('Huésped del hotel')
    expect(rows[1].text()).toContain('u-gone')
    expect(rows[1].text()).toContain('−RD$20.00')
  })

  it('día sin ventas → estado vacío (sin tablas de ceros) y CSV deshabilitado', async () => {
    dailyReport.mockResolvedValue(emptyReport(HOTEL_TODAY))
    const w = await mountPage()
    expect(w.findAll('tr[data-method]')).toHaveLength(0)
    expect(text()).toContain('Todavía no hay ventas hoy')   // "hoy" = el día que devolvió el backend en la zona del hotel
    expect(text()).not.toContain('Ventas por método')
    expect((w.find('[data-testid="export-csv"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('cambiar la fecha recalcula con la nueva fecha', async () => {
    dailyReport.mockResolvedValue({ ...acceptanceReport(), from: HOTEL_TODAY, to: HOTEL_TODAY })
    const w = await mountPage()
    dailyReport.mockResolvedValue(emptyReport('2026-09-10'))
    const input = w.find('#report-date')
    await input.setValue('2026-09-10')
    await input.trigger('change')
    await flushPromises()
    expect(dailyReport).toHaveBeenLastCalledWith({ date: '2026-09-10' })
    expect(text()).toContain('Sin ventas ese día')
  })

  it('exportar CSV descarga un archivo con el nombre del día y avisa', async () => {
    dailyReport.mockResolvedValue(acceptanceReport())
    const w = await mountPage()
    const clicks: string[] = []
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:x'
    URL.revokeObjectURL = () => {}
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download) }
    try {
      await w.find('[data-testid="export-csv"]').trigger('click')
      expect(clicks).toEqual(['cierre-restaurante-2026-09-11.csv'])
      expect(toastSuccess).toHaveBeenCalled()
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
      HTMLAnchorElement.prototype.click = origClick
    }
  })
})

describe('ruta y permiso', () => {
  it('restaurante/reportes está en RESTAURANT_ROUTES con reports:view y entrada de menú', () => {
    const r = RESTAURANT_ROUTES.find((x) => x.name === 'restaurant-reports')
    expect(r).toMatchObject({ path: 'restaurante/reportes', permission: 'reports:view', menu: { label: 'Reportes' } })
    expect(permissionModuleForPath('/panel/restaurante/reportes')).toBe('reports')
  })
})
