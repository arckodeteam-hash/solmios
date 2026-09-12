// shared/usecases/confirmation-email-variables.ts — Base de variables de `reservation_confirmed`.
//
// #270: la plantilla de confirmación creció (desglose, huéspedes, enlaces, {platform_name}) y
// la disparan DOS flujos: el pago del motor público (booking-paid-email.ts, que llena todo) y
// la reserva creada desde el panel (reservas/usecases/reservation-email.ts, que no tiene
// desglose ni token público). El renderer deja literal cualquier `{var}` que falte, así que el
// flujo del panel necesita esta base para que ningún placeholder llegue crudo al huésped.
// Un flujo pisa lo que sí conoce; lo demás queda neutro ('' en los fragmentos HTML y en los
// enlaces, '—' en los textos). Si se agrega una variable a la plantilla, va acá también: el
// test de contrato de cada flujo lo exige.

import type { NotificationLanguage } from '../../services/notification-defaults'
import { DEFAULT_PLATFORM_IDENTITY } from '../utils/platform-identity'

export const CRIB_NO: Record<NotificationLanguage, string> = { es: 'No', en: 'No', pt: 'Não' }

/** La reserva no persiste régimen todavía: sin dato se informa "sólo alojamiento". */
export const ROOM_ONLY: Record<NotificationLanguage, string> = {
  es: 'Sólo alojamiento', en: 'Room only', pt: 'Somente hospedagem',
}

/** Todas las variables que usan las plantillas de `reservation_confirmed`, en valor neutro. */
export function confirmationVariableDefaults(
  language: NotificationLanguage,
  platformName: string = DEFAULT_PLATFORM_IDENTITY.platformName,
): Record<string, string | number> {
  return {
    guest_name: 'Huésped',
    hotel_name: 'Hotel',
    hotel_phone: '',
    hotel_email: '',
    hotel_address: '—',
    hotel_logo_url: '',
    logo_url: '',
    platform_name: platformName,
    checkin_date: '',
    checkout_date: '',
    checkin_time: '',
    checkout_time: '',
    adults: '',
    children: '',
    children_ages: '',
    crib: CRIB_NO[language] ?? CRIB_NO.es,
    meal_plan: ROOM_ONLY[language] ?? ROOM_ONLY.es,
    estimated_arrival: '—',
    special_requests: '—',
    rooms_lines: '',
    rooms_count: '1',
    extras_lines: '',
    child_amenities_lines: '',
    room_amenities_lines: '',
    promo_code: '',
    promo_discount: '—',
    tax_lines: '',
    subtotal: '—',
    total_amount: '—',
    deposit_amount: '—',
    pending_amount: '—',
    payment_method: '—',
    cancellation_policy: '',
    locator: '',
    manage_url: '',
    receipt_url: '',
    room_number: '',
    room_type: '',
    room_capacity: '',
    room_base_price: '',
    wifi_network: '',
    wifi_password: '',
    lock_code: '',
  }
}
