// connectors/reservas-marketing.ts — DT-18. Dispara auto-messages en tiempo real para los
// eventos instantáneos (on_reservation, post_checkout) — antes NINGÚN código los invocaba: el
// enum `triggerEvent` del schema los ofrece (validators/schema.ts), pero solo `auto-messages-cron.ts`
// existía y cubría exclusivamente checkin_day/checkout_day. Un hotel podía configurar un
// auto-message "on_reservation" y jamás se enviaba, en silencio.
//
// `pre_checkin` (offset de días antes del check-in) NO es un evento instantáneo — vive en el
// cron (auto-messages-cron.ts), igual que checkin_day/checkout_day.
//
// Best-effort: marketing.triggerAutoMessages ya es idempotente por día (message_logs dedup) y
// no-op si no hay auto-messages activos para ese evento — un fallo acá NUNCA rompe el flujo de
// reservas/checkout.
import type { ConnectorContext } from 'arckode-framework'

interface MarketingModule {
  triggerAutoMessages(params: {
    hotelId: string; event: string; reservationId: string
    guestId?: string; roomId?: string; variables?: Record<string, string | number>
  }): Promise<void>
  /** STR-3: `message_logs` es del módulo marketing. El detalle de la reserva lo lee por acá. */
  listMessageLogs(hotelId: string, reservationId?: string): Promise<Record<string, any>[]>
}

export function reservasMarketingConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{
    setSockets: (s: any) => void
    setOrchestrationDeps: (d: Record<string, unknown>) => void
  }>('reservas')
  const marketing = () => ctx.resolveModule<MarketingModule>('marketing')

  // STR-3 — Historial de envíos del detalle de la reserva. Antes reservas hacía
  // `orm.findMany('MessageLogs', ...)` directo sobre el modelo de marketing, reimplementando
  // `MarketingService.listMessageLogs` y salteando este conector, que ya existía. NO es
  // best-effort: si esto falla, el historial tiene que romper, no mostrarse vacío.
  reservas.setOrchestrationDeps({
    listMessageLogs: (hotelId: string, reservationId: string) => marketing().listMessageLogs(hotelId, reservationId),
  })

  reservas.setSockets({
    onReservasCreated: async (r: any) => {
      // "on_reservation" es la confirmación de una reserva real, no un draft a medio hacer.
      if (r?.status !== 'confirmed') return
      try {
        await marketing().triggerAutoMessages({
          hotelId: r.hotelId, event: 'on_reservation', reservationId: r.id,
          guestId: r.guestId, roomId: r.roomId,
          variables: {
            checkin_date: r.checkIn || '', checkout_date: r.checkOut || '',
            locator: r.externalLocator || String(r.id || '').slice(-8),
          },
        })
      } catch { /* best-effort */ }
    },
    onReservationCheckedOut: async (data: { reservationId: string; hotelId: string; guestId?: string | null; roomId: string }) => {
      try {
        await marketing().triggerAutoMessages({
          hotelId: data.hotelId, event: 'post_checkout', reservationId: data.reservationId,
          guestId: data.guestId ?? undefined, roomId: data.roomId,
        })
      } catch { /* best-effort */ }
    },
  })
}
