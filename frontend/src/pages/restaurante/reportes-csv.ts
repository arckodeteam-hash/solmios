// pages/restaurante/reportes-csv.ts — CSV del cierre del día (#213). Se arma en el navegador a partir del
// MISMO objeto que pinta la vista (no hay un segundo endpoint): así las cifras del archivo y las de la
// pantalla no pueden divergir. Puro y sin DOM para que el test lo compruebe línea por línea.
import {
  SALES_METHODS, SALES_METHOD_LABELS, ORDER_TYPE_LABELS,
  type RestaurantDailyReport, type VoidRow,
} from '@/services/Restaurant.service'

const VOID_KIND_LABELS: Record<VoidRow['kind'], string> = { order: 'Comanda cancelada', line: 'Línea anulada', refund: 'Reembolso' }

/** Escapa un valor para CSV (comillas si hace falta). Los números van con punto decimal y 2 decimales. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const row = (...cells: Array<string | number | null | undefined>): string => cells.map(csvCell).join(',')

export function buildDailyReportCsv(r: RestaurantDailyReport): string {
  const lines: string[] = []
  lines.push(row('Cierre del restaurante', r.from === r.to ? r.from : `${r.from} a ${r.to}`, r.currency))
  lines.push('')
  lines.push(row('Resumen', 'Valor'))
  lines.push(row('Ventas (sin propina)', r.sales.total))
  lines.push(row('Subtotal', r.sales.subtotal))
  lines.push(row('Impuestos', r.sales.tax))
  lines.push(row('Propinas', r.sales.tips))
  lines.push(row('Cobrado (ventas + propinas)', r.sales.collected))
  lines.push(row('Comandas', r.sales.orders))
  lines.push(row('Ticket promedio', r.sales.averageTicket))
  lines.push(row('Comensales', r.sales.covers))
  lines.push(row('Venta por comensal', r.sales.averagePerCover))
  lines.push(row('Anulado (comandas + líneas)', r.voided.amount))
  lines.push(row('Reembolsado', r.refunded.amount))
  lines.push(row('Descontado (descuentos + cortesías)', r.discounts.amount))
  lines.push(row('Cortesías', r.discounts.courtesies.amount))
  lines.push('')
  lines.push(row('Método', 'Comandas', 'Importe'))
  for (const m of SALES_METHODS) lines.push(row(SALES_METHOD_LABELS[m], r.byMethod[m].orders, r.byMethod[m].amount))
  lines.push('')
  lines.push(row('Tipo', 'Comandas', 'Importe'))
  for (const [type, t] of Object.entries(r.byType)) lines.push(row(ORDER_TYPE_LABELS[type] ?? type, t.orders, t.amount))
  if (r.byDay.length > 1) {
    lines.push('')
    lines.push(row('Día', 'Comandas', 'Importe', 'Propinas'))
    for (const d of r.byDay) lines.push(row(d.date, d.orders, d.amount, d.tips))
  }
  lines.push('')
  lines.push(row('Hora', 'Comandas', 'Importe'))
  for (const h of r.byHour) lines.push(row(`${String(h.hour).padStart(2, '0')}:00`, h.orders, h.amount))
  lines.push('')
  lines.push(row('Estación', 'Cantidad', 'Importe'))
  for (const s of r.byStation) lines.push(row(s.stationName, s.quantity, s.amount))
  lines.push('')
  lines.push(row('Top ítems por cantidad', 'Cantidad', 'Importe'))
  for (const i of r.topItemsByQuantity) lines.push(row(i.name, i.quantity, i.amount))
  lines.push('')
  lines.push(row('Top ítems por importe', 'Cantidad', 'Importe'))
  for (const i of r.topItemsByAmount) lines.push(row(i.name, i.quantity, i.amount))
  lines.push('')
  lines.push(row('Anulaciones y reembolsos', 'Comanda', 'Detalle', 'Cantidad', 'Importe', 'Motivo', 'Fecha'))
  for (const v of r.voided.rows) lines.push(row(VOID_KIND_LABELS[v.kind], v.orderNumber, v.name, v.quantity, v.amount, v.reason, v.at))
  lines.push('')
  lines.push(row('Descuentos y cortesías', 'Comanda', 'Detalle', 'Cantidad', 'Base', 'Descontado', '%', 'Motivo', 'Usuario', 'Fecha'))
  for (const d of r.discounts.rows) lines.push(row(d.courtesy ? 'Cortesía' : (d.kind === 'order' ? 'Descuento de comanda' : 'Descuento de línea'), d.orderNumber, d.name, d.quantity, d.base, d.amount, d.percent, d.reason, d.byName ?? d.by, d.at))
  return lines.join('\r\n') + '\r\n'
}

export function dailyReportCsvFilename(r: Pick<RestaurantDailyReport, 'from' | 'to'>): string {
  return r.from === r.to ? `cierre-restaurante-${r.from}.csv` : `cierre-restaurante-${r.from}_${r.to}.csv`
}

/** Dispara la descarga en el navegador. BOM UTF-8 para que Excel abra las tildes bien. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
