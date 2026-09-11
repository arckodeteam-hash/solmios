// restaurant/usecases/print.ts — `GET /orders/:id/print?doc=precuenta|ticket|kitchen[&station=]` (#216).
// Junta lo que el papel necesita y se lo da a print-templates.ts (render puro). Reglas:
//  - hotelId de la COMANDA, validado contra el usuario (findById + assertOwnership): una comanda ajena es 403.
//  - Nombre/dirección/RNC/moneda/zona del hotel salen de `hotels`; los impuestos de `configuration('taxes')`
//    (fallback `hotels.taxRate`/`taxName`, igual que order-lines.ts). Nada hardcodeado.
//  - Solo líneas VIVAS (isLineActive): una anulada no se imprime en ningún papel.
//  - Cocina: solo lo confirmado a cocina (`sentAt`, #210), opcionalmente de UNA estación (`station=<id>`
//    o `__none__`, mismo contrato que el KDS). Sin precios (los quita el template).
//  - Ticket: la plata sale de `payments` por puerto (`paymentById`, conector restaurante-reports-payments),
//    nunca de la comanda; un cargo a la habitación se imprime como tal.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser } from '../types'
import { isLineActive } from './order-totals'
import { hotelTimezone } from '../../../shared/utils/hotel-schedule'
import { hasPermission } from '../../../shared/permissions'
import type { ReportPorts } from './reports'
import { PRINT_DOCS, renderPrintDoc, type PrintDoc, type PrintLine, type PrintOrderData, type PrintTax } from './print-templates'

export interface PrintDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  tables: RepositoryAdapter<TableDTO>
  config: RepositoryAdapter<any>
  hotels: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  rooms?: RepositoryAdapter<any>
  guests?: RepositoryAdapter<any>
  ports: ReportPorts
}

export interface PrintQuery { doc?: unknown; station?: unknown }

/** Los mismos % que los botones de propina de Cobrar (cobrar.vue TIP_PRESETS). */
export const TIP_SUGGESTIONS = [10, 15, 20]

function parseDoc(raw: unknown): PrintDoc {
  const doc = String(raw ?? '').trim() as PrintDoc
  if (!PRINT_DOCS.includes(doc)) throw new ValidationError(`doc inválido: usar ${PRINT_DOCS.join('|')}`)
  return doc
}

/** Mismo criterio que kds.resolvePlace + order-labels: dónde va la comanda, legible en papel. */
async function placeOf(deps: PrintDeps, order: OrderDTO): Promise<string> {
  if (order.type === 'takeaway') return 'Para llevar'
  if (order.type === 'room_service') {
    const room = order.roomId && deps.rooms ? await deps.rooms.findOne({ id: order.roomId, hotelId: order.hotelId }) : null
    const guest = order.guestId && deps.guests ? await deps.guests.findOne({ id: order.guestId, hotelId: order.hotelId }) : null
    const parts = [room?.number ? `Hab. ${room.number}` : 'Room service', guest?.name ? String(guest.name) : '']
    return parts.filter(Boolean).join(' · ')
  }
  const table = order.tableId ? await deps.tables.findOne({ id: order.tableId, hotelId: order.hotelId }) : null
  if (!table?.name) return 'Mesa'
  const name = /^mesa\b/i.test(table.name) ? table.name : `Mesa ${table.name}`
  return table.zone ? `${table.zone} · ${name}` : name
}

/** Impuestos activos configurados; sin config, el campo simple del hotel (`taxName`/`taxRate`). */
async function taxesOf(deps: PrintDeps, hotelId: string, hotel: any): Promise<PrintTax[]> {
  let c = await deps.config.findOne({ hotelId, key: 'taxes' })
  if (!c) c = await deps.config.findOne({ hotelId, key: 'impuestos' })
  const arr: any[] = Array.isArray(c?.value) ? c.value : []
  const configured = arr
    .filter((t) => t && (t.activo ?? t.active))
    .map((t) => ({ name: String(t.nombre ?? t.name ?? 'Impuesto'), rate: Number(t.tasa ?? t.rate ?? 0) }))
    .filter((t) => t.rate > 0)
  if (configured.length) return configured
  const rate = Number(hotel?.taxRate) || 0
  return rate > 0 ? [{ name: String(hotel?.taxName || 'Impuesto'), rate }] : []
}

function toPrintLine(l: OrderItemDTO): PrintLine {
  return {
    name: l.name, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), lineTotal: Number(l.lineTotal || 0),
    taxRate: Number(l.taxRate || 0), notes: l.notes || undefined,
    modifiers: (l.modifiers ?? []).map((m) => ({ name: m.name, priceDelta: Number(m.priceDelta || 0) })),
    kind: l.kind ?? 'item', stationId: l.stationId || undefined, stationName: l.stationName || undefined, sentAt: l.sentAt || undefined,
  }
}

/** Permiso por documento (la ruta deja pasar view O pay; acá se exige el que corresponde). super_admin pasa siempre. */
function assertCanPrint(doc: PrintDoc, user: CurrentUser): void {
  if (user.role === 'super_admin') return
  const action = doc === 'ticket' ? 'pay' : 'view'
  if (!hasPermission(user.permissions ?? [], 'restaurant', action)) throw new ForbiddenError(`Sin permiso: restaurant:${action}`)
}

export async function printOrder(deps: PrintDeps, id: string, query: PrintQuery | undefined, user: CurrentUser): Promise<string> {
  const doc = parseDoc(query?.doc)
  assertCanPrint(doc, user)
  const order = await deps.orders.findById(id)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')

  if (order.status === 'cancelled') throw new ConflictError('La comanda está cancelada; no hay nada que imprimir')
  if (doc === 'ticket' && order.status !== 'paid' && order.status !== 'charged') {
    throw new ConflictError('El ticket se imprime después de cobrar (o cargar a la habitación) la comanda')
  }

  // findOne acotado al hotel YA validado arriba (no findById sobre un id del cliente).
  const hotel = await deps.hotels.findOne({ id: order.hotelId })
  const all = ((await deps.lines.findMany({ orderId: order.id })) as OrderItemDTO[]).filter(isLineActive)
  let lines = all
  let station: PrintOrderData['station']
  if (doc === 'kitchen') {
    lines = all.filter((l) => !!l.sentAt)
    const wanted = String(query?.station ?? '').trim()
    if (wanted === '__none__') { lines = lines.filter((l) => !l.stationId); station = { id: '', name: 'Sin estación' } }
    else if (wanted) {
      lines = lines.filter((l) => l.stationId === wanted)
      station = { id: wanted, name: lines.find((l) => l.stationName)?.stationName ?? 'Cocina' }
    }
    if (!lines.some((l) => l.kind !== 'combo_header')) throw new ConflictError('La comanda no tiene platos enviados a cocina para esa estación')
  } else if (!lines.length) {
    throw new ConflictError('La comanda no tiene consumos')
  }

  const waiter = order.waiterId ? await deps.userRepo.findOne({ id: order.waiterId, hotelId: order.hotelId }) : null
  let payment: PrintOrderData['payment']
  if (doc === 'ticket') {
    if (order.settlement === 'folio') {
      // Sin propina por regla (chargeToRoom la rechaza): lo que va al folio es subtotal + impuesto = total.
      payment = { method: 'folio', amount: Number(order.total || 0), at: order.closedAt ?? undefined }
    } else if (order.paymentId && deps.ports.paymentById) {
      const p = await deps.ports.paymentById(order.hotelId, order.paymentId)
      if (p) {
        const tendered = Number((p.metadata as any)?.tendered)
        payment = {
          method: p.method, amount: Number(p.amount || 0), reference: p.id.slice(0, 8).toUpperCase(),
          at: p.processedAt ?? p.createdAt ?? undefined, ...(Number.isFinite(tendered) && tendered > 0 ? { tendered } : {}),
        }
      }
    }
  }

  const data: PrintOrderData = {
    hotel: {
      name: String(hotel?.name || 'Hotel'), address: hotel?.address || undefined, phone: hotel?.phone || undefined,
      taxId: hotel?.ownerTaxId || undefined, currency: String(hotel?.currency || 'USD'), timezone: hotelTimezone(hotel),
    },
    order: {
      number: order.number, type: order.type, status: order.status, openedAt: order.openedAt, closedAt: order.closedAt,
      covers: order.covers, subtotal: Number(order.subtotal || 0), tax: Number(order.tax || 0), tip: Number(order.tip || 0), total: Number(order.total || 0),
    },
    place: await placeOf(deps, order),
    waiter: waiter?.name ? String(waiter.name) : undefined,
    lines: lines.map(toPrintLine),
    taxes: await taxesOf(deps, order.hotelId, hotel),
    tipSuggestions: TIP_SUGGESTIONS,
    payment,
    station,
    printedAt: new Date().toISOString(),
  }
  return renderPrintDoc(doc, data)
}
