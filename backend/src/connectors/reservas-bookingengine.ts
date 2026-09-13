// connectors/reservas-bookingengine.ts — Conector entre booking-engine y reservas.
// Bug Playwright (auditoría E2E 2026-09-04): una reserva creada por el motor público escribe
// directo a `Reservations` (bookingengine/usecases/public-booking.ts), sin pasar por el CRUD de
// `reservas` — así que nunca bumpeaba la versión de su caché de listado. Administración podía
// tardar hasta CACHE_TTL (300s) en mostrar un alta pública recién hecha. Mismo patrón que
// reservas-canales.ts: SOLO delega, sin lógica propia. Cubre created / paid / cancelled.
//
// Auto-asignación de unidad al nacer (corrección 2026-09-13 a REQ-HAC-05 #260): la venta del widget
// es por TIPO y la fila se inserta con `roomId: null`, pero el hotel quiere ver la habitación asignada
// en el sistema desde que la reserva entra (recepción la cambia después si hace falta, #258). Acá se
// le pide a `reservas.autoAssignRoom` una unidad libre del tipo para CADA fila del alta (un grupo
// crea varias) vía `shared/usecases/auto-assign-on-create.ts` (compartido con canales-reservas.ts);
// la elección (capacidad, cuna, orden) vive en reservas/usecases/auto-assign-room.ts. Best-effort:
// sin unidad libre (o con error) la reserva queda en la banda "Sin asignar", que es exactamente el
// estado que HAC-05 ya contempla. El código TTLock lo genera reservas-ttlock al asignar SOLO si la
// reserva ya está confirmada/pagada; para una `pending` sale al pagar (bookingengine-ttlock), así
// que asignar antes del pago no abre ninguna puerta.

import type { ConnectorContext } from 'arckode-framework'
import { autoAssignOnCreate, reservationIdsOf, type AutoAssignPort } from '../shared/usecases/auto-assign-on-create'

type ReservasPort = AutoAssignPort & { invalidateListCache: (hotelId: string) => Promise<void> }

const warn = { warn: (message: string) => console.warn(message) }

export function reservasBookingengineConnector(ctx: ConnectorContext): void {
  const bookingEngine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')
  // reservas siempre está cableado (módulo núcleo); se resuelve por evento, no al registrar.
  const reservas = () => ctx.resolveModule<ReservasPort>('reservas')

  const invalidate = (hotelId: string): Promise<void> =>
    reservas().invalidateListCache(hotelId).catch((err: unknown) => {
      console.error(`[reservas-bookingengine] invalidateListCache falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err)
    })

  bookingEngine.setSockets({
    onBookingCreated: async (booking: any) => {
      await invalidate(booking.hotelId)
      await autoAssignOnCreate(reservas(), String(booking.hotelId ?? ''), reservationIdsOf(booking), warn, 'reservas-bookingengine')
    },
    // #272 — la cancelación pública (bookingengine/usecases/public-cancel.ts) también escribe
    // `Reservations` directo (status/cancelledAt/refundAmount de todo el grupo): mismo agujero,
    // el listado mostraba la reserva viva hasta CACHE_TTL.
    onBookingCancelled: async (event: any) => { await invalidate(event.hotelId) },
    // #309 — la confirmación por pago web (webhook Stripe / retorno Azul-CardNet,
    // bookingengine/service.ts) escribe status/paid en Reservations directo: el listado seguía
    // 'pendiente' hasta CACHE_TTL. El payload de onBookingPaid trae hotelId
    // (usecases/booking-paid-event.ts).
    onBookingPaid: async (booking: any) => { await invalidate(booking.hotelId) },
  })
}
