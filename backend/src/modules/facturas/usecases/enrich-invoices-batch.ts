// facturas/usecases/enrich-invoices-batch.ts — Enriquecido en LOTE del listado de facturas.
//
// N+1 ELIMINADO (auditoría #274 / optimización #276):
//   ANTES: listInvoices hacía `Promise.all(rows.map(r => attachItems(await enrichInvoice(r))))`.
//     Cada fila disparaba la carga individual de guest, reservation y room (por id, vía enrichInvoice)
//     + item.findMany({invoiceId}) (attachItems) => hasta 4 queries POR FILA (4N para N facturas;
//     con `?search` se enriquece TODA la tabla del hotel, no solo la página => peor aún).
//   AHORA: se bulk-cargan guests + reservations + rooms + items UNA sola vez por hotel y se
//     resuelve cada factura contra Maps en memoria => O(k) queries (k = hoteles distintos,
//     típicamente 1). El RepositoryAdapter NO soporta WHERE IN (buildWhere solo hace `campo = ?`),
//     por eso el bulk filtra por hotelId — lo que además respeta multi-tenancy.
//   Shape idéntico a enrichInvoice + attachItems: mismos campos derivados (subtotal/taxRate/
//   balance/guest/room) y `items` solo se adjunta si la factura tiene líneas persistidas.

import type { RepositoryAdapter } from 'arckode-framework'
import { round2 } from '../../../shared/utils/money'
import type { FacturasDTO } from '../types'
import type { EnrichDeps } from './billing'

export async function enrichInvoicesBatch(
  rows: FacturasDTO[],
  deps: EnrichDeps,
  itemRepo: RepositoryAdapter<any>,
): Promise<FacturasDTO[]> {
  if (!rows.length) return []
  const hotelIds = [...new Set(rows.map((r) => r.hotelId).filter(Boolean))] as string[]

  const guestName = new Map<string, string>()
  const resRoomId = new Map<string, string | null>() // reservationId -> roomId
  const roomNumber = new Map<string, string>()
  const itemsByInvoice = new Map<string, any[]>()

  await Promise.all(
    hotelIds.map(async (hid) => {
      const [guests, reservations, rooms, items] = await Promise.all([
        deps.guest.findMany({ hotelId: hid }).catch(() => [] as any[]),
        deps.reservation.findMany({ hotelId: hid }).catch(() => [] as any[]),
        deps.room.findMany({ hotelId: hid }).catch(() => [] as any[]),
        itemRepo.findMany({ hotelId: hid }).catch(() => [] as any[]),
      ])
      for (const g of guests as any[]) if (g?.id) guestName.set(g.id, g.name ?? '')
      for (const r of reservations as any[]) if (r?.id) resRoomId.set(r.id, r.roomId ?? null)
      for (const rm of rooms as any[]) if (rm?.id) roomNumber.set(rm.id, rm.number ?? '')
      for (const it of items as any[]) {
        if (!it?.invoiceId) continue
        const arr = itemsByInvoice.get(it.invoiceId)
        if (arr) arr.push(it)
        else itemsByInvoice.set(it.invoiceId, [it])
      }
    }),
  )

  return rows.map((r) => {
    const guest = r.guestId ? guestName.get(r.guestId) ?? '' : ''
    let room = ''
    if (r.reservationId) {
      const roomId = resRoomId.get(r.reservationId)
      if (roomId) room = roomNumber.get(roomId) ?? ''
    }
    const taxes = Number(r.taxes) || 0
    const amount = Number(r.amount) || 0
    const amountPaid = Number((r as any).amountPaid) || 0
    const subtotal = round2(amount - taxes)
    const taxRate = subtotal > 0 ? round2((taxes / subtotal) * 100) : 0
    const balance = round2(amount - amountPaid)
    const enriched: any = {
      ...r,
      taxes,
      amount,
      amountPaid,
      subtotal,
      taxRate,
      balance,
      guest: guest || (r as any).guest || '',
      room: room || (r as any).room || '',
    }
    const rowsForInvoice = itemsByInvoice.get(r.id)
    if (rowsForInvoice && rowsForInvoice.length) {
      enriched.items = rowsForInvoice.map((it) => ({
        description: String(it.description ?? ''),
        amount: Number(it.amount) || 0,
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
      }))
    }
    return enriched as FacturasDTO
  })
}
