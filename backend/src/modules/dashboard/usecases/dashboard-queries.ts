import { isCleaning, isUnderMaintenance } from '../../../shared/usecases/room-status'
import { dashboardPaymentStatus } from './payment-status-label'
// Ms por día. reports/helpers.ts expone la misma constante como MS_PER_DAY; se duplica acá
// para no importar cross-module (prohibido por convención: iría por connector).
const MS_PER_DAY = 86_400_000

export class DashboardQueries {
  constructor(private readonly orm: any) {}

  async getDashboard(hotelId: string): Promise<any> {
    const [rooms, res, guests, payments, folios, invoices] = await Promise.all([
      this.orm.findMany('Rooms', { hotelId }),
      this.orm.findMany('Reservations', { hotelId }),
      this.orm.findMany('Guests', { hotelId }),
      // Conexión dashboard→payments (antes ausente): el home no veía dinero, solo reservas.
      this.orm.findMany('Payment', { hotelId }),
      this.orm.findMany('Folios', { hotelId }),
      this.orm.findMany('Invoices', { hotelId }),
    ])
    const occupied = rooms.filter((r: any) => r.status === 'occupied').length
    // `dirty` y `out_of_service` NO existen en el enum de `rooms.status`
    // (available|occupied|maintenance|cleaning|out_of_order|reserved): los dos contadores daban
    // SIEMPRE 0 y el panel mostraba el hotel sin limpieza ni mantenimiento pendiente.
    const dirty = rooms.filter((r: any) => isCleaning(r.status)).length
    const maintenance = rooms.filter((r: any) => isUnderMaintenance(r.status)).length
    const t = new Date().toISOString().split('T')[0]
    // Una reserva cancelada o no-show nunca generó ingreso: excluirla de todo agregado de dinero,
    // igual que report-queries.ts (medido: incluirlas inflaba el revenue +75%). Los CONTEOS
    // (checkins/checkouts/reservas) siguen sobre `res` completo, solo el dinero pasa por `revenueRes`.
    const revenueRes = res.filter((r: any) => r.status !== 'cancelled' && r.status !== 'no_show')
    const revenueOn = (day: string) => revenueRes.filter((r: any) => String(r.checkIn || '').slice(0, 10) === day).reduce((s: number, r: any) => s + (r.totalAmount || 0), 0)
    const revenueToday = revenueOn(t)
    const checkins = res.filter((r: any) => r.checkIn && String(r.checkIn).slice(0, 10) === t && (r.status === 'confirmed' || r.status === 'checked_in')).length
    const checkouts = res.filter((r: any) => r.checkOut && String(r.checkOut).slice(0, 10) === t && (r.status === 'checked_in' || r.status === 'checked_out')).length
    const yesterday = new Date(Date.now() - MS_PER_DAY).toISOString().split('T')[0]
    const occYesterday = rooms.length ? Math.round((rooms.filter((r: any) => r.status === 'occupied').length / rooms.length) * 100) : 0
    const revYesterday = revenueOn(yesterday)
    const occToday = rooms.length ? Math.round((occupied / rooms.length) * 100) : 0
    return {
      ocupacion: occToday, revenue: revenueRes.reduce((s: number, r: any) => s + (r.totalAmount || 0), 0), revenueToday,
      totalRooms: rooms.length, occupied, checkins, checkouts,
      huespedes: guests.length, reservas: res.length, dirty, maintenance,
      roomsByType: rooms.reduce((a: any, r: any) => ((a[r.type] = (a[r.type] || 0) + 1), a), {}),
      roomsByStatus: rooms.reduce((a: any, r: any) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
      trends: {
        ocupacion: { value: occYesterday, direction: occToday > occYesterday ? 'up' : occToday < occYesterday ? 'down' : 'stable' },
        revenue: { value: revYesterday, direction: revenueToday > revYesterday ? 'up' : revenueToday < revYesterday ? 'down' : 'stable' },
      },
      // KPIs financieros REALES (conexión dashboard→payments antes faltante): dinero desde la
      // fuente de verdad (payments), no inferido de reservas.
      financial: this.computeFinancial(payments as any[], folios as any[], invoices as any[]),
    }
  }

  // KPIs financieros desde payments/folios/facturas. `payments` = fuente de verdad del dinero
  // (mem: payments-is-money-source-of-truth); `invoices` filtra type='invoice' porque la tabla
  // mezcla 3 tipos de documento (mem: invoices guarda 3 tipos — sin filtro cuenta doble).
  private computeFinancial(payments: any[], folios: any[], invoices: any[]) {
    const completed = payments.filter((p) => p.status === 'completed')
    const charges = completed.filter((p) => p.type === 'charge').reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const refunds = completed.filter((p) => p.type === 'refund').reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const t = new Date().toISOString().split('T')[0]
    const revenueToday = completed
      .filter((p) => p.type === 'charge' && String(p.processedAt || '').slice(0, 10) === t)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const byMethod = completed
      .filter((p) => p.type === 'charge')
      .reduce((a, p) => { const m = p.method || 'other'; a[m] = (a[m] || 0) + (Number(p.amount) || 0); return a }, {} as Record<string, number>)
    const foliosOpen = folios.filter((f) => f.status === 'open').length
    const outstandingInvoices = invoices
      .filter((i) => i.type === 'invoice' && i.status !== 'paid' && i.status !== 'void')
      .reduce((s, i) => s + (Number(i.amount) - Number(i.amountPaid || 0)), 0)
    return {
      revenue: charges - refunds,
      revenueToday,
      refunds,
      byMethod,
      foliosOpen,
      outstandingInvoices,
    }
  }

  async getPlanning(hotelId: string): Promise<any> {
    const [rooms, reservas, guests] = await Promise.all([
      this.orm.findMany('Rooms', { hotelId }),
      this.orm.findMany('Reservations', { hotelId }),
      this.orm.findMany('Guests', { hotelId }),
    ])
    const guestMap = new Map((guests as any[]).map((g: any) => [g.id, g]))
    const roomMap = new Map((rooms as any[]).map((r: any) => [r.id, r]))
    const enriched = (reservas as any[]).map((r: any) => {
      const guest = guestMap.get(r.guestId); const room = roomMap.get(r.roomId)
      const deposit = Number(r.deposit) || 0; const total = Number(r.totalAmount) || 0
      return { ...r, guestName: guest?.name || 'Guest', guestEmail: guest?.email || '', roomNumber: room?.number || '', paymentStatus: dashboardPaymentStatus(total, deposit) }
    })
    return { rooms, reservas: enriched }
  }

  async getCheckinList(hotelId: string): Promise<any> {
    const res = await this.orm.findMany('Reservations', { hotelId }) as any[]
    const guests = await this.orm.findMany('Guests', { hotelId })
    const rooms = await this.orm.findMany('Rooms', { hotelId })
    const guestMap = new Map(guests.map((g: any) => [g.id, g]))
    const roomMap = new Map(rooms.map((r: any) => [r.id, r]))
    const t = new Date().toISOString().split('T')[0]
    const checkins = res.filter((r: any) => r.checkIn && String(r.checkIn).slice(0, 10) === t && ['confirmed', 'pending'].includes(r.status))
    const checkouts = res.filter((r: any) => r.checkOut && String(r.checkOut).slice(0, 10) === t && (r.status === 'checked_in' || r.status === 'checked_out'))
    const enrich = (list: any[]) => list.map((r: any) => { const g: any = guestMap.get(r.guestId); const rm: any = roomMap.get(r.roomId); return { ...r, guestName: g?.name || 'Guest', guestEmail: g?.email || '', roomNumber: rm?.number || '' } })
    return { checkins: enrich(checkins), checkouts: enrich(checkouts), pendingCheckins: checkins.length, todayCheckouts: checkouts.length }
  }

  async resolveHotelId(req: any): Promise<string | undefined> {
    const q = req?.query || {}
    if (q.hotelId) return q.hotelId as string
    const userHotel = req?.user?.hotelId
    if (userHotel && userHotel !== 'platform') return userHotel as string
    if (req?.user?.id && req?.user?.role !== 'super_admin') {
      const uRows = await this.orm.findMany('Users', { id: req.user.id })
      const u: any = uRows?.[0]
      if (u?.hotelId) return u.hotelId
    }
    return ((await this.orm.findMany('Hotels', {}))[0] as any)?.id
  }
}
