// crm/validators/schema.ts
import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'

export const AwardPointsSchema: Record<string, ValidationRule> = {
  guestId: { type: 'string' as const, required: true },
  points: { type: 'number' as const, required: true, min: 1 },
  description: { type: 'string' as const, required: true },
  reservationId: { type: 'string' as const },
}

export const RedeemPointsSchema: Record<string, ValidationRule> = {
  guestId: { type: 'string' as const, required: true },
  points: { type: 'number' as const, required: true, min: 1 },
  description: { type: 'string' as const, required: true },
}

export const CreateCouponSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  code: { type: 'string' as const, required: true },
  type: { type: 'string' as const, required: true, enum: ['percentage','fixed'] },
  value: { type: 'number' as const, required: true, min: 1 },
  minPurchase: { type: 'number' as const, min: 0 },
  maxUses: { type: 'number' as const, min: 1 },
  expiresAt: { type: 'string' as const },
}

export const ValidateCouponSchema: Record<string, ValidationRule> = {
  code: { type: 'string' as const, required: true },
  amount: { type: 'number' as const, required: true, min: 0 },
}

export const CreateSegmentSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  name: { type: 'string' as const, required: true, min: 2 },
  description: { type: 'string' as const },
  rules: { type: 'string' as const },
}

export const CreateCampaignSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true, min: 3, max: 120 },
  segmentId: { type: 'string' as const, required: true },
  subject: { type: 'string' as const, required: true, min: 3, max: 200 },
  body: { type: 'text' as const, max: 20000 },
}
