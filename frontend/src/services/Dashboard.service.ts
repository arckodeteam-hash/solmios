import { http } from './http'
import type { DashboardStats, CheckinListData } from '@/types'

interface RawDashboard {
  ocupacion: number
  revenue: number
  revenueToday: number
  totalRooms: number
  occupied: number
  checkins: number
  checkouts: number
  /** HAC-06 (#261): llegadas de hoy (pending|confirmed) sin habitación asignada. */
  arrivalsUnassigned?: number
  huespedes: number
  reservas: number
  dirty: number
  maintenance: number
  roomsByType: Record<string, number>
  roomsByStatus: Record<string, number>
  trends?: { ocupacion: { value: number; direction: string }; revenue: { value: number; direction: string } }
}

export function mapDashboard(d: RawDashboard): DashboardStats & { totalRooms: number; occupied: number; roomsByType: Record<string, number>; roomsByStatus: Record<string, number>; reservations: number; guests: number; pendingInvoices: number; dirty: number; maintenance: number; revenueToday: number; arrivalsUnassigned: number; trends: any } {
  return {
    occupancy: d.ocupacion ?? 0,
    arrivalsToday: d.checkins ?? 0,
    departuresToday: d.checkouts ?? 0,
    arrivalsUnassigned: d.arrivalsUnassigned ?? 0,
    pendingClean: d.dirty ?? 0,
    openIncidents: d.maintenance ?? 0,
    revenueToday: d.revenueToday ?? 0,
    revenueMTD: d.revenue ?? 0,
    avgRate: d.occupied > 0 ? Math.round((d.revenue ?? 0) / d.occupied) : 0,
    revpar: d.totalRooms > 0 ? Math.round((d.revenue ?? 0) / d.totalRooms) : 0,
    totalRooms: d.totalRooms,
    occupied: d.occupied,
    roomsByType: d.roomsByType ?? {},
    roomsByStatus: d.roomsByStatus ?? {},
    reservations: d.reservas,
    guests: d.huespedes,
    pendingInvoices: 0,
    dirty: d.dirty ?? 0,
    maintenance: d.maintenance ?? 0,
    trends: d.trends || { ocupacion: { value: 0, direction: 'stable' }, revenue: { value: 0, direction: 'stable' } },
  }
}

export const DashboardService = {
  async stats(hotelId?: string): Promise<ReturnType<typeof mapDashboard>> {
    const query = hotelId ? `?hotelId=${hotelId}` : ''
    const data = await http.get<RawDashboard>(`/dashboard${query}`)
    return mapDashboard(data)
  },

  /** Pendientes de hoy: check-ins y check-outs (GET /api/checkin, dashboard module). */
  async getCheckinList(hotelId?: string): Promise<CheckinListData> {
    const query = hotelId ? `?hotelId=${hotelId}` : ''
    return http.get<CheckinListData>(`/checkin${query}`)
  },
}
