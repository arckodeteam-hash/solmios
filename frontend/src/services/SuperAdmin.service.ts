import { http } from './http'
import type { HotelData } from './Hotel.service'

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  hotelId: string | null
  hotelName?: string
  activo?: number
  createdAt?: string
}

export interface HotelBreakdown {
  id: string; name: string; plan: string; status: string; mrr: number
  rooms: number; reservations: number; occupancy: number; adr: number; revenue: number
}
export interface AdminAnalytics {
  mrr: number
  totalHoteles: number
  totalUsuarios: number
  totalReservas: number
  activeHotels: number
  byPlan: Record<string, number>
  byPlanRevenue: Record<string, number>
  avgOccupancy: number
  avgADR: number
  hotelsBreakdown?: HotelBreakdown[]
  topByRevenue?: HotelBreakdown[]
  topByOccupancy?: HotelBreakdown[]
  npsScore: number
  ticketPromedio: number
  monthlyRevenue: Array<{ label: string; value: number }>
  trends: { hoteles: number; usuarios: number; reservas: number; mrr: number }
}

/** Métricas del negocio SaaS que alimentan el dashboard `/admin` (GET /api/admin/platform-metrics). */
export interface PipelineItem {
  hotelId: string
  hotelName: string
  planName: string
  planPrice: number
  status: string
  /** Días hasta el fin del trial. Negativo = vencido hace N días. Null = sin fecha. */
  diasRestantes: number | null
  motivo: 'vencido' | 'por_vencer' | 'cobro_fallido' | 'sin_plan'
  tieneStripe: boolean
}
export interface PlanMixItem { id: string; name: string; price: number; hoteles: number; pagos: number; trials: number; mrr: number }
export interface IdleHotelItem { id: string; name: string; planName: string; diasSinActividad: number | null }
export interface PlatformActivityItem { id: string; action: string; userName: string; entity: string; detail: string; createdAt: string }
export interface PlatformMetrics {
  ingresos: {
    mrr: number; arr: number; arpu: number; clientesPagos: number
    mrrEnTrial: number; mrrEnRiesgo: number; conPagoConfigurado: number; trendMrr: number | null
  }
  clientes: {
    total: number; activos: number; inactivos: number
    altasMes: number; altasMesAnterior: number; trendAltas: number; conversion: number | null
  }
  trials: { activos: number; vencidos: number; porVencer: number }
  riesgo: { total: number; vencidos: number; cobrosFallidos: number; expirados: number; cancelados: number }
  pipeline: PipelineItem[]
  planMix: PlanMixItem[]
  sinUso: IdleHotelItem[]
  serie: { label: string; altas: number; volumen: number }[]
  uso: { volumen30d: number; reservas30d: number; hotelesConActividad: number }
  soporte: { urgentes: number; abiertos: number; enProgreso: number; resueltos: number }
  actividad: PlatformActivityItem[]
}

export interface AdminHotel extends HotelData {
  roomCount: number
  /**
   * Usuario al que impersona el botón "Entrar" de la fila. La impersonación es contra un USUARIO,
   * no contra un hotel, así que el backend resuelve quién es (hotel_admin activo, o el que haya).
   * `null` = no hay a quién entrar y el botón queda deshabilitado.
   */
  ownerUserId: string | null
  ownerName: string
  ownerRole: string
}

export const SuperAdminService = {
  async hotels(): Promise<{ hotels: AdminHotel[]; total: number }> {
    const data = await http.get<{ data: any[]; total: number }>('/admin/hoteles')
    return {
      hotels: data.data.map((h: any) => ({
        ...h,
        name: h.name,
        location: h.address || h.location,
        roomCount: h.roomCount ?? 0,
        ownerUserId: h.ownerUserId ?? null,
        ownerName: h.ownerName ?? '',
        ownerRole: h.ownerRole ?? '',
      })),
      total: data.total,
    }
  },

  async users(): Promise<{ users: AdminUser[]; total: number }> {
    const data = await http.get<{ data: any[]; total: number }>('/admin/users')
    return {
      users: data.data.map((u: any) => ({ ...u, name: u.name, hotelName: u.hotelName })),
      total: data.total,
    }
  },

  async analytics(): Promise<AdminAnalytics> {
    return http.get<AdminAnalytics>('/admin/analytics')
  },

  /**
   * Métricas del NEGOCIO de la plataforma (MRR, trials, churn). Es un endpoint distinto de
   * `analytics()` a propósito: aquel responde cómo le va a los hoteles (ocupación, ADR, P&L),
   * este responde cómo le va a la plataforma.
   */
  async platformMetrics(): Promise<PlatformMetrics> {
    return http.get<PlatformMetrics>('/admin/platform-metrics')
  },
}
