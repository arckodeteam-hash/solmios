// connectors/crm-promocodes.ts — El canje de puntos genera un promo code REAL.
//
// `crm` declara el puerto (`LoyaltyPromoPort`); este connector inyecta la implementación
// delegando en `promo-codes.createForLoyalty` (los módulos nunca se importan entre sí).
// Toda la lógica de vigencia/single-use vive en el módulo dueño: acá solo se wirea.
import type { ConnectorContext } from 'arckode-framework'

interface PromoCodesModule {
  createForLoyalty?: (hotelId: string, code: string, value: number, validDays: number) => Promise<{ id: string; code: string }>
}

export function crmPromocodesConnector(ctx: ConnectorContext): void {
  const crm = ctx.resolveModule<{ setPromoPort: (p: unknown) => void }>('crm')
  const promos = ctx.resolveModule<PromoCodesModule>('promo-codes')
  if (!promos?.createForLoyalty) return

  crm.setPromoPort(promos)
}
