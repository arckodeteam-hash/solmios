// services/Crm.service.ts
import { http } from './http'

export interface LoyaltyTransaction {
  id: string; guestId: string; hotelId: string; type: string; points: number; description: string; createdAt: string
}
/** Canje con propósito (spec crm-loyalty): los puntos se convierten en un promo code real. */
export interface RedeemResult extends LoyaltyTransaction {
  promoCode?: string
  discountValue?: number
}
export interface Coupon {
  id: string; hotelId: string; code: string; type: string; value: number; minPurchase: number; maxUses: number | null
  useCount: number; startsAt: string | null; expiresAt: string | null; pointsCost: number; active: number
}
export interface GuestSegment {
  id: string; hotelId: string; name: string; description: string; rules: string | null; count: number
}
/** Campaña de email a un segmento (spec crm-campaigns). */
export interface Campaign {
  id?: string
  hotelId?: string
  name: string
  segmentId: string
  subject: string
  body: string
  status: 'draft' | 'sent'
  sentCount: number
  sentAt: string | null
}

/** Huésped que cae dentro de un segmento. Subconjunto de Guest: lo que la tabla del modal muestra. */
export interface SegmentGuest {
  id: string; name: string; email: string | null; tier: string
  totalStays: number; totalSpent: number; loyaltyPoints: number
}
export interface GuestLTV {
  guestId: string; name: string; totalStays: number; totalSpent: number; avgPerStay: number
  loyaltyPoints: number; tier: string; firstVisit: string; lastVisit: string; daysSinceLastVisit: number; ltvScore: number
}
export interface CrmDashboard {
  totalGuests: number; activeThisMonth: number; totalPointsIssued: number; totalPointsRedeemed: number
  topTierCounts: Record<string, number>; avgLTV: number
}

export const CrmService = {
  // Points
  awardPoints: (guestId: string, points: number, description: string) => http.post('/api/crm/points/award', { guestId, points, description }) as Promise<LoyaltyTransaction>,
  redeemPoints: (guestId: string, points: number, description: string) => http.post('/api/crm/points/redeem', { guestId, points, description }) as Promise<RedeemResult>,
  recomputeTiers: (): Promise<{ recomputed: number; upgraded: number }> => http.post('/api/crm/tiers/recompute', {}),
  getPointsHistory: (guestId: string): Promise<LoyaltyTransaction[]> => http.get(`/api/crm/points/history/${guestId}`),
  getPointsBalance: (guestId: string): Promise<{ balance: number }> => http.get(`/api/crm/points/balance/${guestId}`),

/** DEPRECADO (spec crm-coupons): los cupones del CRM son promo-codes — ver
 *  PromoCode.service.ts y /panel/config/promociones. Estos endpoints responden 410. */

  // Segments
  listSegments: (): Promise<GuestSegment[]> => http.get('/api/crm/segments'),
  createSegment: (data: Partial<GuestSegment>): Promise<GuestSegment> => http.post('/api/crm/segments', data),
  getGuestsInSegment: (id: string): Promise<SegmentGuest[]> => http.get(`/api/crm/segments/${id}/guests`),
  /** CSV del segmento (text/csv). El caller arma la descarga con el string. */
  exportSegment: (id: string): Promise<string> => http.get(`/api/crm/segments/${id}/export`),

  // Campañas (spec crm-campaigns)
  listCampaigns: (): Promise<Campaign[]> => http.get('/api/crm/campaigns').then((r: any) => r?.data ?? r),
  createCampaign: (data: Partial<Campaign>): Promise<Campaign> => http.post('/api/crm/campaigns', data),
  sendCampaign: (id: string): Promise<{ queued: number; skipped: number }> => http.post(`/api/crm/campaigns/${id}/send`, {}),

  // LTV + Dashboard
  getLTV: (): Promise<GuestLTV[]> => http.get('/api/crm/ltv'),
  getDashboard: (): Promise<CrmDashboard> => http.get('/api/crm/dashboard'),
}
