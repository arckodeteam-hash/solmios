// crm/types.ts

export interface LoyaltyTransactionDTO {
  id: string; guestId: string; hotelId: string; reservationId: string | null
  type: string; points: number; description: string
  expiresAt: string | null; redeemed: number
  createdAt: string
}

export interface CouponDTO {
  id: string; hotelId: string; code: string; type: string; value: number
  minPurchase: number; maxUses: number | null; useCount: number
  startsAt: string | null; expiresAt: string | null; segmentId: string | null
  pointsCost: number; active: number
}

export interface CreateCouponDTO {
  hotelId: string; code: string; type: string; value: number
  minPurchase?: number; maxUses?: number; startsAt?: string; expiresAt?: string
  segmentId?: string; pointsCost?: number
}

/** Campaña de email a un segmento (spec crm-campaigns). */
export interface CampaignDTO {
  hotelId: string
  name: string
  segmentId: string
  subject: string
  body: string
  status: 'draft' | 'sent'
  sentCount: number
  sentAt: string | null
}

/** Log de envío por destinatario. */
export interface CampaignSendDTO {
  hotelId: string
  campaignId: string
  guestId: string
  email: string
  sentAt: string | null
}

export interface CreateCampaignDTO {
  hotelId?: string
  name: string
  segmentId: string
  subject: string
  body: string
}

export interface SendCampaignResult {
  queued: number
  skipped: number
}

export interface GuestSegmentDTO {
  id: string; hotelId: string; name: string; description: string
  rules: string | null; count: number; active: number
}

export interface CreateSegmentDTO {
  hotelId: string; name: string; description?: string; rules?: string
}

// LTV / Analytics
export interface GuestLTV {
  guestId: string; name: string
  totalStays: number; totalSpent: number; avgPerStay: number
  loyaltyPoints: number; tier: string
  firstVisit: string; lastVisit: string
  daysSinceLastVisit: number
  ltvScore: number
}

export interface CrmDashboard {
  totalGuests: number; activeThisMonth: number
  totalPointsIssued: number; totalPointsRedeemed: number
  topTierCounts: Record<string, number>
  avgLTV: number
}
