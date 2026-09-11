// connectors/restaurante-folios.ts — POS → folios (RES-5). SOLO cablea: resuelve el folio abierto de
// la reserva (o lo abre) y postea el consumo del restaurante como cargo. El folio aplica su propio
// impuesto (el POS manda el NETO). Mismo patrón que settle-folio-at-checkout.
// M4 (QA): el folio recalcula el ITBIS con la tasa de `configuration('taxes')`, NO con la tasa
// snapshot por línea del POS. No hay doble impuesto (neto → folio aplica UNA vez); solo puede diferir
// del ticket si el hotel usa tasas distintas por ítem. Con una tasa uniforme (lo normal) coincide.
import type { ConnectorContext } from 'arckode-framework'
import type { ChargeToFolioInput } from '../modules/restaurant'

interface FoliosModule {
  list: (query: any, user: any) => Promise<{ data?: any[] }>
  open: (dto: any, user: any) => Promise<{ id: string }>
  postCharge: (folioId: string, dto: any, user: any) => Promise<unknown>
}

export function restauranteFoliosConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<{ setSettlementDeps: (p: any) => void }>('restaurant')
  const folios = () => ctx.resolveModule<FoliosModule>('folios')

  restaurant.setSettlementDeps({
    chargeToFolio: async (input: ChargeToFolioInput, user: any) => {
      const f = folios()
      const list = await f.list({ reservationId: input.reservationId, status: 'open' }, user)
      let folio = list?.data?.[0]
      if (!folio) {
        folio = await f.open({ hotelId: input.hotelId, reservationId: input.reservationId, guestId: input.guestId, roomId: input.roomId }, user)
      }
      await f.postCharge(folio.id, {
        description: input.description, amount: input.amount, quantity: input.quantity,
        category: 'restaurant', source: 'pos',
        // Idempotency key (idempotencia-settlement-pos): `folio-entries.postCharge` reclama esta
        // reference atómico contra un UNIQUE index parcial (hotelId,reference) WHERE source='pos'.
        // Un reintento con la MISMA orden pide el MISMO reference → devuelve el cargo ya creado en
        // vez de duplicarlo en el folio del huésped. #214: una PARTE trae la suya (`pos:<orderId>:<n>`).
        reference: input.reference ?? 'pos:' + input.orderId,
      }, user)
      return { folioId: folio.id }
    },
  })
}
