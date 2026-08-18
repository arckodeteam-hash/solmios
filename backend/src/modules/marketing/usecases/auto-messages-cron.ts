import { checkinHashFromId } from '../../../shared/utils/checkin-hash'
import { isBirthdayToday, isInactiveSince, lastVisitVar } from './guest-triggers'

const DAY_MS = 86_400_000

/** Mismo link que el panel muestra en el modal de la reserva (`/checkin/:hash`). */
function preCheckinUrl(reservationId: string): string {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  return `${base}/checkin/${checkinHashFromId(reservationId)}`
}

/**
 * DT-18: `pre_checkin` es el único trigger de fecha con OFFSET variable por auto-message (los
 * demás triggers de fecha, checkin_day/checkout_day, siempre son offset=0 → "hoy"). Por eso no
 * se puede resolver con una sola query: hay que agrupar los auto-messages activos de
 * `pre_checkin` por su `triggerOffset` y, para cada offset distinto, buscar las reservas cuyo
 * checkIn caiga exactamente ese día. Antes de este fix, `pre_checkin` estaba en el enum del
 * schema (validators/schema.ts) pero NINGÚN código lo disparaba — un hotel podía configurarlo
 * y nunca se enviaba nada.
 *
 * `pre_checkin_url` en `variables`: sin esto el hotel podía activar el trigger pero el mail
 * salía sin el link real (plantilla con el placeholder vacío). Reservas con `preCheckinStatus`
 * ya `completed` se saltan — no tiene sentido recordarle a alguien un formulario que ya llenó.
 */
async function firePreCheckin(orm: any, hotelId: string, today: Date, marketingModule: { triggerAutoMessages: (params: any) => Promise<void> }): Promise<void> {
  const msgs = await orm.findMany('AutoMessages', { hotelId, triggerEvent: 'pre_checkin', isActive: 1 }) as any[]
  if (msgs.length === 0) return
  const offsets = [...new Set(msgs.map((m) => Number(m.triggerOffset || 0)))]
  for (const offset of offsets) {
    const target = new Date(today.getTime() + offset * DAY_MS)
    const targetStr = target.toISOString().split('T')[0]
    const reservations = await orm.findMany('Reservations', { hotelId, checkIn: targetStr, status: 'confirmed' }) as any[]
    for (const r of reservations) {
      if (r.preCheckinStatus === 'completed') continue
      await marketingModule.triggerAutoMessages({
        hotelId, event: 'pre_checkin', reservationId: r.id, guestId: r.guestId, roomId: r.roomId,
        variables: {
          checkin_date: r.checkIn, checkout_date: r.checkOut, locator: r.externalLocator || r.id.slice(-8),
          pre_checkin_url: preCheckinUrl(r.id),
        },
      }).catch(() => {})
    }
  }
}

/**
 * Triggers de HUÉSPED (spec guest-triggers): birthday (birthDate mes/día == hoy) e
 * inactive_guests (win-back: última estadía hace exactamente triggerOffset días, sin
 * reserva futura). Solo actúan si el hotel creó auto-messages con esos triggers —
 * inactivos por defecto. El dedupe mismo-día lo resuelve triggerAutoMessages (guestId).
 */
async function fireGuestTriggers(orm: any, hotelId: string, today: Date, marketingModule: { triggerAutoMessages: (params: any) => Promise<void> }): Promise<void> {
  const birthdayMsgs = await orm.findMany('AutoMessages', { hotelId, triggerEvent: 'birthday', isActive: 1 }) as any[]
  const inactiveMsgs = await orm.findMany('AutoMessages', { hotelId, triggerEvent: 'inactive_guests', isActive: 1 }) as any[]
  if (birthdayMsgs.length === 0 && inactiveMsgs.length === 0) return

  const guests = await orm.findMany('Guests', { hotelId, active: 1 }) as any[]
  const allReservations = await orm.findMany('Reservations', { hotelId }) as any[]

  if (birthdayMsgs.length > 0) {
    for (const g of guests) {
      if (!isBirthdayToday(g.birthDate, today)) continue
      await marketingModule.triggerAutoMessages({
        hotelId, event: 'birthday', guestId: g.id,
        variables: { guest_name: g.name || 'Huésped' },
      }).catch(() => {})
    }
  }

  if (inactiveMsgs.length > 0) {
    const offsets = [...new Set(inactiveMsgs.map((m) => Number(m.triggerOffset || 180)))]
    for (const offset of offsets) {
      for (const g of guests) {
        if (!isInactiveSince(allReservations, g.id, offset, today)) continue
        await marketingModule.triggerAutoMessages({
          hotelId, event: 'inactive_guests', guestId: g.id,
          variables: { last_visit: lastVisitVar(allReservations, g.id) },
        }).catch(() => {})
      }
    }
  }
}

export function createAutoMessagesCron(orm: any, marketingModule: { triggerAutoMessages: (params: any) => Promise<void> }): () => Promise<void> {
  return async () => {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const hotels = await orm.findMany('Hotels', {}) as any[]

    for (const hotel of hotels) {
      const checkinToday = await orm.findMany('Reservations', { hotelId: hotel.id, checkIn: todayStr, status: 'confirmed' }) as any[]
      for (const r of checkinToday) {
        await marketingModule.triggerAutoMessages({
          hotelId: hotel.id, event: 'checkin_day', reservationId: r.id, guestId: r.guestId, roomId: r.roomId,
          variables: { checkin_date: r.checkIn, checkout_date: r.checkOut, locator: r.externalLocator || r.id.slice(-8) },
        }).catch(() => {})
      }

      const checkoutToday = await orm.findMany('Reservations', { hotelId: hotel.id, checkOut: todayStr, status: 'checked_in' }) as any[]
      for (const r of checkoutToday) {
        await marketingModule.triggerAutoMessages({
          hotelId: hotel.id, event: 'checkout_day', reservationId: r.id, guestId: r.guestId, roomId: r.roomId,
          variables: { checkin_date: r.checkIn, checkout_date: r.checkOut, locator: r.externalLocator || r.id.slice(-8) },
        }).catch(() => {})
      }

      await firePreCheckin(orm, hotel.id, today, marketingModule).catch(() => {})
      await fireGuestTriggers(orm, hotel.id, today, marketingModule).catch(() => {})
    }
  }
}
