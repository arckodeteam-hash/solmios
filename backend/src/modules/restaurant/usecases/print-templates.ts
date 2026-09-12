// restaurant/usecases/print-templates.ts — Los tres papeles del POS en 80 mm (#216, epic #202):
// precuenta (se lleva a la mesa), ticket (comprobante de pago) y comanda de cocina (papel para una
// cocina sin pantalla). Funciones PURAS: reciben los datos ya resueltos (`print.ts` los junta) y
// devuelven HTML autocontenido — mismo enfoque que facturas/usecases/invoice-template.ts (A4) y
// payroll/usecases/payslip-template.ts, sin dependencias nuevas: el navegador imprime
// (`window.print()`) y la impresora térmica se elige en el SO de la tablet.
//
// Lo que NO va acá: nada hardcodeado del hotel (nombre, dirección, RNC, moneda e impuestos llegan en
// `PrintOrderData`), ni precios en la comanda de cocina, ni líneas anuladas (ya vienen filtradas).
//
// Descuentos (#215): cada línea imprime su bruto y, debajo, "Descuento/Cortesía (motivo) −X"; el de la
// comanda va como fila antes del Subtotal. Σ(bruto − desc. línea) − desc. comanda = Subtotal (el
// persistido), y el impuesto se prorratea sobre ese NETO con la misma fórmula que order-totals.ts.
// Pagos (#214): el ticket lista TODAS las partes cobradas (método, monto, propina, referencia, cambio).
import { getCurrencyMeta } from '../../../shared/currency'
import { round2 } from '../../../shared/utils/money'
import type { OrderType, DiscountType } from '../types'

export type PrintDoc = 'precuenta' | 'ticket' | 'kitchen'
export const PRINT_DOCS: readonly PrintDoc[] = ['precuenta', 'ticket', 'kitchen'] as const

export interface PrintHotel {
  name: string
  address?: string
  phone?: string
  /** RNC / identificación fiscal del hotel (`hotels.ownerTaxId`). */
  taxId?: string
  currency: string
  timezone: string
}

export interface PrintTax { name: string; rate: number }

export interface PrintLine {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
  taxRate: number
  notes?: string
  modifiers: { name: string; priceDelta: number }[]
  // KDS — lo que cocina quitó/agregó de la receta ("SIN cebolla · CON extra queso"); solo lo imprime la comanda de cocina.
  ingredientChanges?: { removed: string[]; added: string[] } | null
  kind: 'item' | 'combo_header' | 'combo_component'
  stationId?: string
  stationName?: string
  sentAt?: string
  /** #215 — descuento de la línea ya aplicado (`lineTotal` sigue bruto). */
  discountType?: DiscountType | null
  discountValue?: number | null
  discountAmount?: number
  discountReason?: string | null
}

export interface PrintPayment {
  /** 'cash' | 'card' | 'transfer' | 'link' | 'other' | 'folio' (cargo a la habitación). */
  method: string
  /** Lo cobrado por esta parte SIN propina (como `restaurant_order_payments.amount`). */
  amount: number
  /** Propina de esta parte (#214: cada parte lleva la suya). */
  tip?: number
  reference?: string
  at?: string
  /** Solo si el cobro registró lo entregado en efectivo (`payments.metadata.tendered`): imprime Recibido/Cambio. */
  tendered?: number
}

export interface PrintOrderData {
  hotel: PrintHotel
  order: {
    number?: string
    type: OrderType
    status: string
    openedAt?: string
    closedAt?: string | null
    covers?: number
    subtotal: number
    tax: number
    tip: number
    total: number
    /** #215 — descuento de la comanda (sobre Σ líneas netas) y su motivo; `discountTotal` = líneas + comanda. */
    discountType?: DiscountType | null
    discountValue?: number | null
    discountAmount?: number
    discountReason?: string | null
    discountTotal?: number
  }
  /** "Terraza · Mesa 3" / "Hab. 204 · Pérez" / "Para llevar". */
  place: string
  waiter?: string
  /** Líneas VIVAS (sin anuladas ni canceladas). `print.ts` ya filtró. */
  lines: PrintLine[]
  /** Impuestos configurados del hotel (`configuration('taxes')`), para desglosar por nombre. */
  taxes: PrintTax[]
  /** Porcentajes de propina sugerida (los mismos botones de Cobrar). */
  tipSuggestions: number[]
  /** Ticket: las partes cobradas, en orden (#214). Una sola para el cobro entero; vacío = sin detalle. */
  payments: PrintPayment[]
  /** Estación elegida para la comanda de cocina; sin ella se agrupa por estación. */
  station?: { id: string; name: string }
  printedAt: string
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', link: 'Link de pago', other: 'Otro', folio: 'Cargo a la habitación', room: 'Cargo a la habitación',
}

/** "Cortesía" (100 %), "Descuento 10 %" o "Descuento" (monto fijo), con el motivo entre paréntesis. Mismo criterio que Cobrar (isCourtesy). */
export function discountLabel(d: { discountType?: DiscountType | null; discountValue?: number | null; discountReason?: string | null }): string {
  const courtesy = d.discountType === 'percent' && Number(d.discountValue) === 100
  const base = courtesy ? 'Cortesía' : d.discountType === 'percent' ? `Descuento ${fmtRate(Number(d.discountValue || 0))}` : 'Descuento'
  const reason = String(d.discountReason ?? '').trim()
  return reason ? `${base} (${reason})` : base
}

/** Neto de una línea tras su propio descuento (#215): lo que suma al Subtotal antes del descuento de comanda. */
export const lineNet = (l: Pick<PrintLine, 'lineTotal' | 'discountAmount'>): number => round2(Number(l.lineTotal || 0) - Number(l.discountAmount || 0))
const TYPE_LABELS: Record<OrderType, string> = { dine_in: 'Salón', room_service: 'Room service', takeaway: 'Para llevar' }

export function moneyOf(currency: string) {
  const meta = getCurrencyMeta(currency)
  return (n: number): string => `${meta.symbol}${(Number(n) || 0).toFixed(meta.decimals)}`
}

function when(iso: string | null | undefined, timeZone: string, withDate = true): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString('es-DO', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      ...(withDate ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}),
    })
  } catch { return d.toISOString() }
}

/**
 * Desglose del impuesto por tasa. Las líneas congelan su `taxRate` (%); si la suma de los impuestos
 * configurados coincide con esa tasa, se muestra cada uno por su nombre (ITBIS 18 % + local 10 %);
 * si no, una sola fila "Impuesto N %". La base es el NETO con descuento (#215): línea menos su
 * descuento, prorrateando el descuento de comanda por línea — la misma fórmula que
 * order-totals.computeOrderTotals, así el desglose cuadra con `order.tax`. Se redondea por fila.
 */
export function taxBreakdown(lines: PrintLine[], taxes: PrintTax[], orderDiscount = 0): { label: string; amount: number }[] {
  const base = round2(lines.reduce((s, l) => s + lineNet(l), 0))
  const factor = base > 0 ? (base - Number(orderDiscount || 0)) / base : 1
  const byRate = new Map<number, number>()
  for (const l of lines) {
    const rate = Number(l.taxRate || 0)
    if (rate <= 0) continue
    byRate.set(rate, (byRate.get(rate) ?? 0) + lineNet(l) * factor)
  }
  const configured = taxes.filter((t) => Number(t.rate) > 0)
  const configuredSum = round2(configured.reduce((s, t) => s + Number(t.rate), 0))
  const rows: { label: string; amount: number }[] = []
  for (const [rate, net] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    if (configured.length && Math.abs(configuredSum - rate) < 0.001) {
      for (const t of configured) rows.push({ label: `${t.name} ${fmtRate(t.rate)}`, amount: round2((net * Number(t.rate)) / 100) })
    } else {
      const named = configured.find((t) => Math.abs(Number(t.rate) - rate) < 0.001)
      rows.push({ label: `${named?.name ?? 'Impuesto'} ${fmtRate(rate)}`, amount: round2((net * rate) / 100) })
    }
  }
  return rows
}

const fmtRate = (r: number): string => `${Number.isInteger(r) ? r : r.toFixed(2).replace(/\.?0+$/, '')}%`

const CSS = `
@page { size: 80mm auto; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; background: #fff }
body { width: 80mm; padding: 4mm 4mm 10mm; color: #000; font: 12px/1.35 "DejaVu Sans Mono", "Courier New", monospace; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.c { text-align: center } .b { font-weight: 700 } .small { font-size: 10px } .big { font-size: 15px } .xl { font-size: 18px }
.hr { border-top: 1px dashed #000; margin: 6px 0 }
.row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px }
.row .n { flex: 1; min-width: 0; overflow-wrap: anywhere }
.row .a { white-space: nowrap; font-variant-numeric: tabular-nums }
.mods, .note, .comp { padding-left: 14px; font-size: 11px }
.disc { padding-left: 14px; font-size: 11px; font-style: italic }
.note { font-style: italic } .note::before { content: "\\2691 " }
.kitchen .line { font-size: 16px; font-weight: 700; margin: 5px 0 1px }
.kitchen .mods, .kitchen .note, .kitchen .comp { font-size: 13px }
.station { margin-top: 8px; padding: 2px 0; border-top: 2px solid #000; border-bottom: 1px solid #000; font-weight: 700; text-transform: uppercase }
.legal { margin-top: 8px; font-size: 10px; text-align: center; text-transform: uppercase; letter-spacing: .04em }
.no-print { position: fixed; bottom: 12px; right: 12px; font: 13px/1 sans-serif; padding: 10px 16px; border: 1px solid #333; border-radius: 999px; background: #fff; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.15) }
@media screen { body { margin: 16px auto; box-shadow: 0 0 0 1px #ddd; min-height: 40mm } }
@media print { .no-print { display: none } }
`

function shell(title: string, bodyClass: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body class="${bodyClass}">
<button class="no-print" type="button" onclick="window.print()">Imprimir</button>
${body.replace(/\n{2,}/g, '\n')}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 150) })</script>
</body>
</html>`
}

function header(d: PrintOrderData, kicker: string): string {
  const h = d.hotel
  return `<div class="c b big">${esc(h.name)}</div>
${h.address ? `<div class="c small">${esc(h.address)}</div>` : ''}
${h.phone ? `<div class="c small">Tel. ${esc(h.phone)}</div>` : ''}
${h.taxId ? `<div class="c small">RNC ${esc(h.taxId)}</div>` : ''}
<div class="hr"></div>
<div class="c b xl">${esc(kicker)}</div>
<div class="c">${esc(d.order.number ?? '')}</div>
<div class="hr"></div>`
}

function meta(d: PrintOrderData): string {
  const tz = d.hotel.timezone
  const type = TYPE_LABELS[d.order.type] ?? d.order.type
  const rows: [string, string][] = [
    // "Para llevar" no lleva lugar: una sola celda en vez de repetir el tipo a los dos lados.
    d.place === type ? [type, ''] : [type, d.place],
    ...(d.order.covers ? [['Comensales', String(d.order.covers)] as [string, string]] : []),
    ...(d.waiter ? [['Atendió', d.waiter] as [string, string]] : []),
    ...(d.order.openedAt ? [['Apertura', when(d.order.openedAt, tz)] as [string, string]] : []),
    ['Impreso', when(d.printedAt, tz)],
  ]
  return rows.map(([k, v]) => `<div class="row"><span class="n">${esc(k)}</span><span class="a">${esc(v)}</span></div>`).join('\n')
}

/** Líneas de primer nivel (ítems + cabeceras de combo) con sus componentes anidados y sin precios de componente. */
function priced(d: PrintOrderData): string {
  const money = moneyOf(d.hotel.currency)
  const top = d.lines.filter((l) => l.kind !== 'combo_component')
  const comps = d.lines.filter((l) => l.kind === 'combo_component')
  return top.map((l) => {
    const mods = l.modifiers.filter((m) => m.name)
    const disc = Number(l.discountAmount || 0)
    return `<div class="row"><span class="n">${l.quantity}× ${esc(l.name)}</span><span class="a">${money(l.lineTotal)}</span></div>
${l.quantity > 1 ? `<div class="mods small">${money(l.unitPrice)} c/u</div>` : ''}
${mods.length ? `<div class="mods">${mods.map((m) => esc(m.name) + (m.priceDelta ? ` (${m.priceDelta > 0 ? '+' : ''}${money(m.priceDelta)})` : '')).join(', ')}</div>` : ''}
${l.kind === 'combo_header' ? comps.map((c) => `<div class="comp">· ${c.quantity}× ${esc(c.name)}</div>`).join('\n') : ''}
${disc > 0 ? `<div class="row disc"><span class="n">${esc(discountLabel(l))}</span><span class="a">−${money(disc)}</span></div>` : ''}
${l.notes ? `<div class="note">${esc(l.notes)}</div>` : ''}`
  }).join('\n')
}

/**
 * Subtotal → impuesto (desglosado si hay más de una tasa) → [propina] → TOTAL. La precuenta NO incluye la
 * propina (la sugiere aparte, "no incluida"), así que su total es subtotal + impuesto aunque la comanda ya
 * tenga una propina fijada; el ticket muestra la propina cobrada y el total persistido.
 */
function totals(d: PrintOrderData, opts: { tip: boolean }): string {
  const money = moneyOf(d.hotel.currency)
  const orderDisc = Number(d.order.discountAmount || 0)
  const taxRows = taxBreakdown(d.lines, d.taxes, orderDisc)
  const total = opts.tip ? d.order.total : round2(Number(d.order.subtotal || 0) + Number(d.order.tax || 0))
  const discTotal = Number(d.order.discountTotal || 0)
  return `<div class="hr"></div>
${orderDisc > 0 ? `<div class="row disc"><span class="n">${esc(discountLabel(d.order))}</span><span class="a">−${money(orderDisc)}</span></div>` : ''}
<div class="row"><span class="n">Subtotal</span><span class="a">${money(d.order.subtotal)}</span></div>
${discTotal > 0 ? `<div class="row small"><span class="n">Descuentos y cortesías aplicados</span><span class="a">−${money(discTotal)}</span></div>` : ''}
${taxRows.length > 1 ? taxRows.map((r) => `<div class="row small"><span class="n">${esc(r.label)}</span><span class="a">${money(r.amount)}</span></div>`).join('\n') : ''}
<div class="row"><span class="n">${esc(taxRows.length === 1 ? taxRows[0].label : 'Impuesto')}</span><span class="a">${money(d.order.tax)}</span></div>
${opts.tip && d.order.tip > 0 ? `<div class="row"><span class="n">Propina</span><span class="a">${money(d.order.tip)}</span></div>` : ''}
<div class="row b big"><span class="n">TOTAL</span><span class="a">${money(total)}</span></div>`
}

/** Precuenta: lo consumido hasta ahora, sin cobrar. Propina sugerida con los % de Cobrar. */
export function renderPrecuenta(d: PrintOrderData): string {
  const money = moneyOf(d.hotel.currency)
  const base = round2(Number(d.order.subtotal || 0) + Number(d.order.tax || 0))
  const tips = d.tipSuggestions.filter((p) => p > 0).map((p) => {
    const tip = round2((Number(d.order.subtotal || 0) * p) / 100)
    return `<div class="row small"><span class="n">${p}% → propina ${money(tip)}</span><span class="a">total ${money(round2(base + tip))}</span></div>`
  })
  const body = `${header(d, 'PRECUENTA')}
${meta(d)}
<div class="hr"></div>
${priced(d)}
${totals(d, { tip: false })}
${tips.length ? `<div class="hr"></div><div class="b small">Propina sugerida (no incluida)</div>\n${tips.join('\n')}` : ''}
<div class="legal">No es comprobante fiscal</div>
<div class="c small">¡Gracias por su visita!</div>`
  return shell(`Precuenta ${d.order.number ?? ''}`, 'precuenta', body)
}

/** Ticket: comprobante del cobro (o del cargo a la habitación). */
export function renderTicket(d: PrintOrderData): string {
  const money = moneyOf(d.hotel.currency)
  const parts = d.payments
  const many = parts.length > 1
  // Una parte: método + monto (con propina incluida en la cifra si la hubo, como la ve el cliente).
  // Varias (#214): "Pago 1/2 · Efectivo" con su monto, propina, referencia y cambio, y el total pagado.
  const partHtml = (p: PrintPayment, i: number) => {
    const tip = Number(p.tip || 0)
    const charged = round2(Number(p.amount) + tip)
    const change = p.tendered !== undefined ? round2(Number(p.tendered) - charged) : undefined
    const label = `${many ? `Pago ${i + 1}/${parts.length} · ` : ''}${METHOD_LABELS[p.method] ?? p.method}`
    return `<div class="row b"><span class="n">${esc(label)}</span><span class="a">${money(charged)}</span></div>
${many && tip > 0 ? `<div class="row small"><span class="n">incl. propina</span><span class="a">${money(tip)}</span></div>` : ''}
${p.tendered !== undefined ? `<div class="row"><span class="n">Recibido</span><span class="a">${money(p.tendered)}</span></div>` : ''}
${change !== undefined && change > 0 ? `<div class="row"><span class="n">Cambio</span><span class="a">${money(change)}</span></div>` : ''}
${p.reference ? `<div class="row small"><span class="n">Ref.</span><span class="a">${esc(p.reference)}</span></div>` : ''}
${p.at ? `<div class="row small"><span class="n">Pagado</span><span class="a">${esc(when(p.at, d.hotel.timezone))}</span></div>` : ''}`
  }
  const paidSum = round2(parts.reduce((s, p) => s + Number(p.amount) + Number(p.tip || 0), 0))
  const paid = parts.length
    ? `<div class="hr"></div>
${parts.map(partHtml).join('\n')}
${many ? `<div class="row b"><span class="n">Total pagado</span><span class="a">${money(paidSum)}</span></div>` : ''}`
    : `<div class="hr"></div><div class="row b"><span class="n">Pagado</span><span class="a">${money(d.order.total)}</span></div>`
  const body = `${header(d, 'TICKET')}
${meta(d)}
<div class="hr"></div>
${priced(d)}
${totals(d, { tip: true })}
${paid}
<div class="legal">No es comprobante fiscal</div>
<div class="c small">¡Gracias por su visita!</div>`
  return shell(`Ticket ${d.order.number ?? ''}`, 'ticket', body)
}

/** Comanda de cocina: qué preparar, dónde va, sin precios. Una sección por estación si no se eligió una. */
export function renderKitchen(d: PrintOrderData): string {
  const tz = d.hotel.timezone
  const groups = new Map<string, { name: string; lines: PrintLine[] }>()
  for (const l of d.lines) {
    if (l.kind === 'combo_header') continue
    const key = l.stationId ?? ''
    const g = groups.get(key) ?? { name: l.stationName ?? (key ? key : 'Sin estación'), lines: [] }
    g.lines.push(l)
    groups.set(key, g)
  }
  const sentAt = d.lines.map((l) => l.sentAt).filter((s): s is string => !!s).sort()
  const lineHtml = (l: PrintLine) => {
    const mods = l.modifiers.filter((m) => m.name)
    const ing = [
      ...(l.ingredientChanges?.removed ?? []).map((n) => `SIN ${esc(n)}`),
      ...(l.ingredientChanges?.added ?? []).map((n) => `CON ${esc(n)}`),
    ]
    return `<div class="line">${l.quantity}× ${esc(l.name)}</div>
${mods.length ? `<div class="mods">${mods.map((m) => esc(m.name)).join(', ')}</div>` : ''}
${ing.length ? `<div class="note">${ing.join(' · ')}</div>` : ''}
${l.notes ? `<div class="note">${esc(l.notes)}</div>` : ''}`
  }
  const sections = d.station
    ? [...groups.values()].map((g) => g.lines.map(lineHtml).join('\n')).join('\n')
    : [...groups.values()].map((g) => `<div class="station">${esc(g.name)}</div>\n${g.lines.map(lineHtml).join('\n')}`).join('\n')
  const body = `<div class="c b xl">${esc(d.station?.name ?? 'COCINA')}</div>
<div class="c b big">${esc(d.place)}</div>
<div class="c">${esc(d.order.number ?? '')}${d.place !== (TYPE_LABELS[d.order.type] ?? d.order.type) ? ` · ${esc(TYPE_LABELS[d.order.type] ?? d.order.type)}` : ''}${d.order.covers ? ` · ${d.order.covers} cub.` : ''}</div>
<div class="hr"></div>
<div class="row"><span class="n">Enviado</span><span class="a">${esc(when(sentAt[sentAt.length - 1], tz, false) || '—')}</span></div>
${d.waiter ? `<div class="row"><span class="n">Mesero</span><span class="a">${esc(d.waiter)}</span></div>` : ''}
<div class="row"><span class="n">Impreso</span><span class="a">${esc(when(d.printedAt, tz))}</span></div>
<div class="hr"></div>
${sections}
<div class="hr"></div>
<div class="c small">${d.lines.filter((l) => l.kind !== 'combo_header').reduce((s, l) => s + l.quantity, 0)} plato(s)</div>`
  return shell(`Comanda ${d.order.number ?? ''} · cocina`, 'kitchen', body)
}

export function renderPrintDoc(doc: PrintDoc, d: PrintOrderData): string {
  if (doc === 'precuenta') return renderPrecuenta(d)
  if (doc === 'ticket') return renderTicket(d)
  return renderKitchen(d)
}
