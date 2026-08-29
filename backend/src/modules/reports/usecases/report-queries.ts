import { MS_PER_DAY } from '../helpers'
import type { ReportContext } from '../strategies/types'
import { reportStrategies } from '../strategies'
import {
  inDateRange, paymentDate, expenseDate, sumCharged, sumRefunded, chargeTotal, isConsumption,
} from './money'

export class ReportQueries {
  constructor(private readonly orm: any) {}

  /**
   * Expira los códigos TTLock de una reserva. Lo inyecta el módulo (connector-free: reports no
   * puede importar ttlock). Sin esto, marcar no-show a mano dejaba vivo el PIN de la puerta de
   * alguien que no se presentó, sobre una habitación que este mismo método libera para revender.
   */
  private expireLockCodes?: (reservationId: string) => Promise<void>

  setLockCodeExpirer(fn: (reservationId: string) => Promise<void>): void {
    this.expireLockCodes = fn
  }

  async resolveHotelId(req: any): Promise<string | undefined> {
    const q = req?.query || {}
    if (q.hotelId) {
      const userHotel = req?.user?.hotelId
      if (userHotel && userHotel !== 'platform') {
        if (q.hotelId !== userHotel) throw new Error('Access denied: can only view own hotel data')
      }
      return q.hotelId as string
    }
    const userHotel = req?.user?.hotelId
    if (userHotel && userHotel !== 'platform') return userHotel as string
    const uRows = await this.orm.findMany('Users', { id: req.user?.id })
    const u: any = (uRows as any[])?.[0]
    if (u?.hotelId) return u.hotelId
    const isAdmin = req?.user?.userType === 'admin' || req?.user?.role === 'super_admin'
    if (isAdmin) {
      const hotels = await this.orm.findMany('Hotels', {})
      return (hotels as any[])?.[0]?.id
    }
    throw new Error('No hotel assigned to user')
  }

  async getReports(hotelId: string): Promise<any> {
    const [res, rooms, guests] = await Promise.all([
      this.orm.findMany('Reservations', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Rooms', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Guests', { hotelId }) as Promise<any[]>,
    ])
    // Una reserva cancelada o no-show NUNCA fue plata: excluirla de todo agregado de dinero.
    // Contarla inflaba el revenue del dashboard (medido: +75%). Los CONTEOS (totalReservations,
    // canceledReservations) sí van sobre `res` completo. `byChannel` y `channelBookings` comparten
    // esta base para que el ADR (revenue/bookings) sea consistente.
    const revenueRes = res.filter((r: any) => r.status !== 'cancelled' && r.status !== 'no_show')
    const totalRevenue = revenueRes.reduce((s: number, r: any) => s + (r.totalAmount || 0), 0)
    const byChannel = revenueRes.reduce((a: any, r: any) => { const c = r.channel || 'direct'; a[c] = (a[c] || 0) + r.totalAmount; return a }, {})
    const channelBookings = revenueRes.reduce((a: any, r: any) => { const c = r.channel || 'direct'; a[c] = (a[c] || 0) + 1; return a }, {})
    const dailyRevenue = Object.entries(revenueRes.reduce((a: any, r: any) => { const d = String(r.checkIn).slice(0, 10); if (d) a[d] = (a[d] || 0) + r.totalAmount; return a }, {})).map(([date, value]) => ({ date, value }))
    const occupancyByType = (() => {
      const types: Record<string, { total: number; occupied: number }> = {}
      for (const r of rooms) { if (!types[r.type]) types[r.type] = { total: 0, occupied: 0 }; types[r.type].total++; if (r.status === 'occupied') types[r.type].occupied++ }
      return Object.entries(types).map(([type, d]) => ({ type, ...d, percentage: d.total ? Math.round((d.occupied / d.total) * 100) : 0 }))
    })()
    const channelADRs: Record<string, number> = {}
    for (const [ch, cnt] of Object.entries(channelBookings)) { const rev = (byChannel as any)[ch] || 0; channelADRs[ch] = (cnt as number) > 0 ? Math.round(rev / (cnt as number)) : 0 }
    const today = new Date().toISOString().slice(0, 10)
    const todayCheckins = res.filter((r: any) => r.checkIn && String(r.checkIn).slice(0, 10) === today && (r.status === 'confirmed' || r.status === 'checked_in')).length
    const todayCheckouts = res.filter((r: any) => r.checkOut && String(r.checkOut).slice(0, 10) === today && (r.status === 'checked_in' || r.status === 'checked_out')).length
    return {
      totalRevenue, byChannel, channelBookings, channelADRs,
      totalReservations: res.length, canceledReservations: res.filter((r: any) => r.status === 'cancelled').length,
      dailyRevenue, occupancyByType, todayCheckins, todayCheckouts,
      topGuests: [...guests].sort((a: any, b: any) => (b.totalSpent || 0) - (a.totalSpent || 0)).slice(0, 5).map((g: any) => ({ name: g.name, stays: g.totalStays, totalSpent: g.totalSpent })),
    }
  }

  async getAdvancedReport(hotelId: string, reqQuery: any): Promise<any> {
    const q = reqQuery as any
    const type = String(q.type || 'facturacion')
    const to = String(q.to || new Date().toISOString().slice(0, 10))
    const from = String(q.from || new Date(Date.now() - 30 * MS_PER_DAY).toISOString().slice(0, 10))
    const [reservations, rooms, guests, expenses, payments, folioCharges, folios, blocks, hotel] = await Promise.all([
      this.orm.findMany('Reservations', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Rooms', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Guests', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Expenses', { hotelId }) as Promise<any[]>,
      // El modelo se registra en singular (`orm.define('Payment', ...)`), no 'Payments'.
      this.orm.findMany('Payment', { hotelId }) as Promise<any[]>,
      this.orm.findMany('FolioCharges', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Folios', { hotelId }) as Promise<any[]>,
      this.orm.findMany('RoomBlocks', { hotelId }) as Promise<any[]>,
      (await this.orm.findMany('Hotels', { id: hotelId }))[0] as any,
    ])
    const inRange = reservations.filter((r: any) => { const ci = String(r.checkIn || '').slice(0, 10); return ci >= from && ci <= to })
    const totalRooms = rooms.length
    const taxRate = Number(hotel?.taxRate || 0) / 100

    // Gastos y pagos se acotan al período: un reporte de un mes no puede sumar la tabla entera.
    const expensesInRange = inDateRange(expenses, from, to, expenseDate)
    const paymentsInRange = inDateRange(payments, from, to, paymentDate)

    const revenueReservations = inRange.filter((r: any) => r.status !== 'cancelled' && r.status !== 'no_show')
    // Un folio_charge NO tiene columna `reservationId` (la tabla física no la trae); el vínculo
    // cargo→reserva pasa por su folio. Este mapa lo resuelve una vez para las strategies.
    const folioToReservation = new Map<string, string>(
      folios.filter((f: any) => f.reservationId).map((f: any) => [f.id, f.reservationId]),
    )
    const ctx: ReportContext = {
      from, to, totalRooms, taxRate, reservations: inRange, revenueReservations, rooms, guests,
      expenses: expensesInRange, payments: paymentsInRange, folioCharges, folios, folioToReservation, blocks, hotel,
    }
    const strategy = reportStrategies.find(s => s.type === type)
    if (!strategy) throw new Error(`Tipo de reporte desconocido: ${type}`)
    return strategy.execute(ctx)
  }

  /**
   * Cierre del día. Los ingresos salen del libro auxiliar (`folio_charges`) y del asiento del dinero
   * (`payments`), NO de `Reservations`: antes se sumaba la tabla entera y se etiquetaba "del día",
   * así que ADR, RevPAR y "pagos recibidos" arrastraban toda la historia del hotel.
   *
   * Si el hotel todavía no opera con folios, los ingresos del día son 0. Es el número correcto:
   * no se posteó nada.
   */
  async getNightAudit(hotelId: string): Promise<any> {
    const [rooms, res, payments, folioCharges] = await Promise.all([
      this.orm.findMany('Rooms', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Reservations', { hotelId }) as Promise<any[]>,
      this.orm.findMany('Payment', { hotelId }) as Promise<any[]>,
      this.orm.findMany('FolioCharges', { hotelId }) as Promise<any[]>,
    ])
    const t = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - MS_PER_DAY).toISOString().split('T')[0]

    const chargeDay = (c: any) => String(c.postedAt || c.createdAt || '').slice(0, 10)
    const consumptionOn = (d: string) => folioCharges.filter((c: any) => chargeDay(c) === d && isConsumption(c))
    const roomChargesOn = (d: string) => consumptionOn(d).filter((c: any) => c.category === 'room')
    const roomRevenueOn = (d: string) => roomChargesOn(d).reduce((s: number, c: any) => s + chargeTotal(c), 0)

    const todayConsumption = consumptionOn(t)
    const ingresosHabitaciones = roomRevenueOn(t)
    const ingresosServicios = todayConsumption.filter((c: any) => c.category !== 'room').reduce((s: number, c: any) => s + chargeTotal(c), 0)
    const impuestos = todayConsumption.reduce((s: number, c: any) => s + Number(c.taxes || 0), 0)

    const paymentsToday = inDateRange(payments, t, t, paymentDate)
    const pagosRecibidos = sumCharged(paymentsToday)
    const reembolsos = sumRefunded(paymentsToday)

    const occupied = rooms.filter((r: any) => r.status === 'occupied').length
    const ocupacion = rooms.length ? Math.round((occupied / rooms.length) * 100) : 0

    // Una noche vendida = un cargo de habitación posteado ese día (uno por folio in-house).
    const nochesVendidas = roomChargesOn(t).length
    const nochesVendidasAyer = roomChargesOn(yesterday).length
    const adr = nochesVendidas > 0 ? Math.round(ingresosHabitaciones / nochesVendidas) : 0
    const adrAyer = nochesVendidasAyer > 0 ? Math.round(roomRevenueOn(yesterday) / nochesVendidasAyer) : 0
    const revpar = rooms.length > 0 ? Math.round(ingresosHabitaciones / rooms.length) : 0

    const dayOf = (v: any) => String(v || '').slice(0, 10)
    const checkins = res.filter((r: any) => dayOf(r.checkIn) === t && (r.status === 'confirmed' || r.status === 'checked_in')).length
    const checkouts = res.filter((r: any) => dayOf(r.checkOut) === t && (r.status === 'checked_in' || r.status === 'checked_out')).length
    const noShows = res.filter((r: any) => dayOf(r.checkIn) === t && r.status === 'pending').length
    const cancelaciones = res.filter((r: any) => r.status === 'cancelled' && dayOf(r.updatedAt) === t).length

    // Saldos, no movimientos del día: la deuda viva y las garantías retenidas.
    const activas = res.filter((r: any) => r.status !== 'cancelled')
    // BUG FIX: antes pagosPendientes solo restaba `deposit` e ignoraba los payments ya cobrados →
    // inflaba la "cuenta por cobrar" del cierre (reserva $100 con $80 cobrados reportaba $100). Ahora
    // resta deposit + payments completados. Mismo criterio que sumCharged (status 'completed' & type
    // 'charge'). Deposit y payments son independientes (mem: depósitos = ledger desconectado).
    const chargedByReservation = new Map<string, number>()
    for (const p of payments) {
      if (p.status !== 'completed' || p.type !== 'charge') continue
      const rid = p.reservationId
      if (!rid) continue
      chargedByReservation.set(rid, (chargedByReservation.get(rid) || 0) + Number(p.amount || 0))
    }
    const pagosPendientes = activas.reduce((s: number, r: any) => {
      const paid = (r.deposit || 0) + (chargedByReservation.get(r.id) || 0)
      return s + Math.max(0, (r.totalAmount || 0) - paid)
    }, 0)
    const depositos = res.filter((r: any) => r.status === 'pending').reduce((s: number, r: any) => s + (r.deposit || 0), 0)

    return {
      fecha: t, ocupacion, habitacionesOcupadas: occupied, habitacionesTotales: rooms.length,
      ingresosHabitaciones, ingresosServicios, impuestos,
      totalDia: ingresosHabitaciones + ingresosServicios,
      checkins, checkouts, noShows, cancelaciones, nochesVendidas,
      adr, revpar, adrAyer,
      pagosRecibidos, pagosPendientes, depositos, reembolsos,
    }
  }

  async markNoShows(hotelId?: string): Promise<number> {
    const todayStr = new Date().toISOString().split('T')[0]
    // Solo pending/confirmed pueden ser no-show. Filtrar por status en la query (2 findMany) en vez
    // de traer TODAS las reservas históricas y descartarlas en JS (#276): una reserva vieja no se
    // relee cada corrida. Los updates de cada no-show van en paralelo, no encadenados.
    const base = hotelId ? { hotelId } : {}
    const [pending, confirmed] = await Promise.all([
      this.orm.findMany('Reservations', { ...base, status: 'pending' }) as Promise<any[]>,
      this.orm.findMany('Reservations', { ...base, status: 'confirmed' }) as Promise<any[]>,
    ])
    const vencidas = [...pending, ...confirmed].filter((r) => {
      const ci = String(r.checkIn || '').slice(0, 10)
      return ci && ci < todayStr
    })
    await Promise.all(vencidas.map((r) => Promise.all([
      this.orm.update('Reservations', r.id, { status: 'no_show' }),
      // BUG FIX: liberar la habitación asociada — antes quedaba occupied/reserved y Channex la
      // seguía mostrando fuera de inventario → overbooking real.
      r.roomId ? this.orm.update('Rooms', r.roomId, { status: 'available' }) : Promise.resolve(),
      // Y sin acceso físico: la habitación se revende, el PIN del ausente no puede seguir vivo.
      // Best-effort — si TTLock está caído, el no-show igual se registra.
      this.expireLockCodes
        ? this.expireLockCodes(r.id).catch(() => {})
        : Promise.resolve(),
    ])))
    return vencidas.length
  }
}
