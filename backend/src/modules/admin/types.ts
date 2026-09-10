export interface PlanDTO { id: string; name: string; slug: string; price: number; currency: string; description: string; features: any[]; modules: string[]; limits: any; isActive: number; sortOrder: number; trialEligible?: number; }
export interface AmenityCatalogDTO { id: string; key: string; label: string; category: string; icon: string; isActive: number; sortOrder: number; }

// Override por hotel de un módulo/submódulo (3ra capa de entitlement).
// Los campos DEBEN coincidir con el orm.define('HotelModuleOverrides') en shared/models.ts
// (anti-patrón descarte silencioso mem 1805: campo no declarado → se pierde al persistir).
export interface ModuleOverrideDTO {
  id: string
  hotelId: string
  moduleKey: string
  status: 'enabled' | 'disabled'
  reason: string
  grantedByUserId?: string
  startsAt?: string
  endsAt?: string
  createdAt?: string
  updatedAt?: string
}

/**
 * DTOs locales de "Condiciones especiales" (PLAN-SUSCRIPCIONES.md). Redeclarados a propósito:
 * `admin/service.ts` NO puede importar de `subscriptions/` (regla del analyzer
 * SERVICE_IMPORTS_OTHER_MODULE) — el acceso a esas tablas es por nombre de string vía `orm`
 * crudo (ver admin/usecases/special-conditions.ts), la tabla real la posee `subscriptions`.
 */
export type SpecialCategoryKey = 'founder_one' | 'founder_two' | 'pioneer'

export interface SpecialCategoryConfigDTO {
  id: string; key: SpecialCategoryKey; totalSlots: number; occupiedCount: number
  discountPct: number; minPlanSortOrder: number | null
  sequenceGroup: string | null; opensAfter: string | null
  status: 'closed' | 'open' | 'full'
}

export interface SubscriptionDiscountDTO {
  id: string; hotelId: string; subscriptionId: string
  type: 'percentage' | 'free_month' | 'category_bonus'
  discountPct: number; startAt: string | null; endsAt: string | null
  appliedByUserId: string | null; reason: string | null
  status: 'active' | 'expired' | 'revoked'
}

export interface SubscriptionSearchResultDTO {
  hotelId: string; hotelName: string
  planId: string | null; planSortOrder: number | null
  status: string; specialCategory: SpecialCategoryKey | null
}

export interface HotelBreakdownDTO {
  id: string; name: string; plan: string; status: string; mrr: number;
  rooms: number; reservations: number; occupancy: number; adr: number; revenue: number;
}
export interface AdminAnalyticsDTO {
  mrr: number; totalHoteles: number; totalUsuarios: number; totalReservas: number;
  activeHotels: number; byPlan: Record<string, number>; byPlanRevenue: Record<string, number>;
  avgOccupancy: number; avgADR: number;
  hotelsBreakdown: HotelBreakdownDTO[]; topByRevenue: HotelBreakdownDTO[]; topByOccupancy: HotelBreakdownDTO[];
  npsScore: number; ticketPromedio: number;
  monthlyRevenue: { label: string; value: number }[];
  trends: { hoteles: number; usuarios: number; reservas: number; mrr: number };
}
export interface MonitoringDTO {
  hoteles: number; usuarios: number; reservas: number;
  ticketsAbiertos: number; ticketsEnProgreso: number; ticketsUrgentes: number;
  ticketsResueltos: number; uptime: number; memoria: number;
}
