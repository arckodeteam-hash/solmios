// crm/model.ts — Loyalty points + coupons + segments
import type { ModelDefinition, ORM } from 'arckode-framework'

const LoyaltyTransactionModel: ModelDefinition = {
  table: 'loyalty_transactions',
  fields: {
    guestId: { type: 'string', required: true, indexed: true },
    hotelId: { type: 'string', required: true, indexed: true },
    reservationId: { type: 'string' },
    type: { type: 'string', required: true },
    points: { type: 'number', required: true },
    description: { type: 'string' },
    expiresAt: { type: 'string' },
    redeemed: { type: 'boolean', default: 0 },
  },
  timestamps: true,
}

const CouponModel: ModelDefinition = {
  table: 'coupons',
  fields: {
    hotelId: { type: 'string', required: true, indexed: true },
    code: { type: 'string', required: true },
    type: { type: 'string', required: true },
    value: { type: 'number', required: true },
    minPurchase: { type: 'number', default: 0 },
    maxUses: { type: 'number' },
    useCount: { type: 'number', default: 0 },
    startsAt: { type: 'string' },
    expiresAt: { type: 'string' },
    segmentId: { type: 'string' },
    pointsCost: { type: 'number', default: 0 },
    active: { type: 'boolean', default: 1 },
  },
  timestamps: true,
}

const SegmentModel: ModelDefinition = {
  table: 'guest_segments',
  fields: {
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    rules: { type: 'string' },
    count: { type: 'number', default: 0 },
    active: { type: 'boolean', default: 1 },
  },
  timestamps: true,
}

/**
 * Campaña de email a un segmento (spec crm-campaigns). El envío encola filas en
 * `email_queue` (worker existente) y deja log en `campaign_sends`.
 */
const CampaignModel: ModelDefinition = {
  table: 'campaigns',
  fields: {
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    segmentId: { type: 'string', required: true },
    subject: { type: 'string', required: true },
    body: { type: 'text' },
    status: { type: 'string', default: 'draft' }, // draft | sent
    sentCount: { type: 'number', default: 0 },
    sentAt: { type: 'string' },
  },
  timestamps: true,
}

/** Log por destinatario — anti-reenvío: un huésped, una fila por campaña. */
const CampaignSendModel: ModelDefinition = {
  table: 'campaign_sends',
  fields: {
    hotelId: { type: 'string', required: true, indexed: true },
    campaignId: { type: 'string', required: true, indexed: true },
    guestId: { type: 'string', required: true, indexed: true },
    email: { type: 'string', required: true },
    sentAt: { type: 'string' },
  },
  timestamps: true,
}

export function registerCrmModels(orm: ORM): void {
  orm.define('LoyaltyTransaction', LoyaltyTransactionModel)
  orm.define('Coupon', CouponModel)
  orm.define('GuestSegment', SegmentModel)
  orm.define('Campaign', CampaignModel)
  orm.define('CampaignSend', CampaignSendModel)
}
