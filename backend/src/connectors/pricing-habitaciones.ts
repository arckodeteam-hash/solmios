// connectors/pricing-habitaciones.ts — El precio base se edita en la grilla de tarifas pero vive en
// la habitación. pricing pide, habitaciones escribe. (CLAUDE #3: el conector solo wirea.)

import type { ConnectorContext } from 'arckode-framework'

export function pricingHabitacionesConnector(ctx: ConnectorContext): void {
  const pricing = ctx.resolveModule<{ setBasePriceDeps: (p: any) => void }>('pricing')
  pricing.setBasePriceDeps({
    setTypeBasePrice: (hotelId: string, roomType: string, basePrice: unknown) =>
      ctx.resolveModule<{ setTypeBasePrice: (h: string, t: string, p: unknown) => Promise<number> }>('habitaciones')
        .setTypeBasePrice(hotelId, roomType, basePrice),
  })
}
