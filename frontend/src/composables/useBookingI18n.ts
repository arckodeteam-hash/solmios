// composables/useBookingI18n.ts — i18n del widget público de reserva (F2 2.14, solmi-direct-booking).
//
// Mensajes ES/EN/PT para TODOS los textos visibles del widget (steps, botones, validaciones,
// urgencia D11, errores de promo, switcher). Idioma default = `navigator.language` (parsea el
// prefijo antes del `-`, fallback ES si no es ninguno de los soportados). Traducción faltante →
// fallback ES (mismo patrón que `shared/i18n.ts:resolveForLang` del backend).
//
// Diseño:
//   - Pinia store setup-syntax (consistencia con `useBookingStore`).
//   - `t(key, params?)` interpola `{name}` → params.name (suficiente para el widget, sin lib).
//   - `locale` es ref reactivo: cambiarlo re-renderiza todos los textos que dependen de `t()`.
//   - Keys planas (`'search.title'`) para evitar arbolitos difíciles de grephear.
//
// Fallback en 2 niveles:
//   1. key falta en el locale activo → mira ES.
//   2. key falta en ES → devuelve la key literal (para que el desarrollador vea el hueco en QA).
//
// Scope: SOLO el widget público. El panel admin usa Vue I18n aparte (no mezclar).

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type BookingLocale = 'es' | 'en' | 'pt'

export interface BookingLangOption {
  code: BookingLocale
  name: string
  flag: string
}

/** Idiomas soportados por el widget. El orden es el del switcher en UI. */
export const BOOKING_LOCALES: BookingLangOption[] = [
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
]

/** Mensajes por idioma. Cualquier key nueva DEBE existir en `es` (fallback). */
const messages = {
  es: {
    // wrapper / header
    'wrapper.titleFallback': 'Reservá tu estadía',
    'wrapper.loading': 'Cargando…',
    'wrapper.step': 'Paso {current} / {total}',
    'wrapper.back': '← Volver',
    'wrapper.language': 'Idioma',
    'wrapper.currency': 'Moneda',
    // step labels (stepper)
    'step.dates': 'Fechas',
    'step.room': 'Habitación',
    'step.extras': 'Extras',
    'step.guest': 'Datos',
    'step.pay': 'Pago',
    'step.confirm': 'Confirmación',

    // SearchStep
    'search.title': 'Elegí tus fechas',
    'search.subtitle': 'Encontrá las mejores tarifas directo del hotel.',
    'search.checkIn': 'Llegada',
    'search.checkOut': 'Salida',
    'search.dateError': 'La salida debe ser posterior a la llegada.',
    'search.cta': 'Ver disponibilidad',
    'search.searching': 'Buscando…',
    'search.nights': '{count} {count, plural, one {noche} other {noches}}',
    'search.oneNight': '1 noche',

    // CalendarView
    'calendar.months.jan': 'Enero',
    'calendar.months.feb': 'Febrero',
    'calendar.months.mar': 'Marzo',
    'calendar.months.apr': 'Abril',
    'calendar.months.may': 'Mayo',
    'calendar.months.jun': 'Junio',
    'calendar.months.jul': 'Julio',
    'calendar.months.aug': 'Agosto',
    'calendar.months.sep': 'Septiembre',
    'calendar.months.oct': 'Octubre',
    'calendar.months.nov': 'Noviembre',
    'calendar.months.dec': 'Diciembre',
    'calendar.weekdaysShort.mon': 'L',
    'calendar.weekdaysShort.tue': 'M',
    'calendar.weekdaysShort.wed': 'X',
    'calendar.weekdaysShort.thu': 'J',
    'calendar.weekdaysShort.fri': 'V',
    'calendar.weekdaysShort.sat': 'S',
    'calendar.weekdaysShort.sun': 'D',
    'calendar.prevMonth': 'Mes anterior',
    'calendar.nextMonth': 'Mes siguiente',
    'calendar.checkIn': 'Check-in',
    'calendar.checkOut': 'Check-out',
    'calendar.clear': 'Limpiar',
    'calendar.nightsCount': '{count} {count, plural, one {noche} other {noches}}',
    // Precios por día (paridad con el calendario de la landing, components/landing/RateCalendar.vue).
    'calendar.soldOut': 'Lleno',
    'calendar.loadingRates': 'Cargando tarifas…',
    'calendar.pricesUnavailable': 'No pudimos cargar las tarifas de este mes. Podés elegir las fechas igual y ver el precio en el siguiente paso.',
    'calendar.blockedNight': 'No hay disponibilidad la noche del {date}. Elegí otra salida.',
    'calendar.legendSoldOut': 'Sin disponibilidad',
    'calendar.legendStay': 'Tu estadía',
    'calendar.stayFrom': 'desde {amount}',
    'calendar.ariaPast': '{date}, fecha pasada',
    'calendar.ariaSoldOut': '{date}, sin disponibilidad',
    'calendar.ariaFrom': '{date}, desde {amount}',

    // RoomsStep
    'rooms.title': 'Habitaciones disponibles',
    'rooms.nightsSuffix': '{count} {count, plural, one {noche} other {noches}}',
    'rooms.pricesIn': 'Precios en {currency}',
    // El backend degrada a su moneda base cuando no tiene tasa para la elegida. Decirlo es mejor
    // que rotular con un símbolo que no corresponde al número que se está mostrando.
    'rooms.currencyUnavailable': 'No tenemos cambio a {wanted}: te mostramos los precios en {currency}.',
    'rooms.empty': 'Sin disponibilidad para esas fechas.',
    // El calendario valida noche por noche si ALGÚN tipo tiene lugar (día agregado), no si un
    // mismo tipo cubre TODO el rango seguido — por eso puede llegar acá vacío incluso con fechas
    // que el calendario permitió elegir. El hint tiene que explicar esa causa probable, no repetir
    // un "sin disponibilidad" genérico que ya dijo el título de arriba.
    'rooms.emptyHint': 'Es posible que ninguna habitación tenga lugar para TODAS esas noches seguidas. Probá un rango más corto, otras fechas o menos huéspedes.',
    'rooms.availableOne': '1 disponible',
    'rooms.availableMany': '{count} disponibles',
    'rooms.fromLabel': 'Desde',
    'rooms.totalSuffix': 'total',
    'rooms.perNight': 'noche',
    // `fromPrice` viene PRE-impuestos (public-rates.ts devuelve el `taxBreakdown` aparte). La key
    // vieja `rooms.includes` ("Incluye") anunciaba justo lo contrario de lo que pasa: el huésped
    // paga fromPrice + estos impuestos. Renombrada a propósito para que no quede un "includes"
    // que ya no significa "incluye" (mismo criterio que la landing, BookingModal.vue).
    'rooms.plusTaxes': '+ impuestos:',
    'rooms.urgency.last': 'Última disponible',
    'rooms.urgency.few': 'Pocas habitaciones a este precio',
    // Matriz de ocupaciones: una fila por cantidad de huéspedes. Las que el hotel no puede
    // vender se muestran EN GRIS con el motivo — nunca se ocultan (ver RoomsStep.vue).
    'rooms.occupancyFor': 'para {count}',
    'rooms.occupancyPrice': 'Precio {count} {count, plural, one {noche} other {noches}}',
    'rooms.occupancyChoose': 'Elegir',
    'rooms.occupancyChosen': 'Elegida',
    'rooms.unavailable.no_rate': 'Sin tarifa para esta ocupación',
    'rooms.unavailable.no_availability': 'Sin disponibilidad en estas fechas',
    'rooms.unavailable.stop_sell': 'Cerrada a la venta',
    'rooms.unavailable.over_capacity': 'Supera la capacidad de la habitación',
    'rooms.unavailable.default': 'No disponible',
    // Carrito — soporta combinar distintos tipos/ocupaciones en una misma reserva (Tarea 10).
    'rooms.add': 'Agregar',
    'rooms.quantity': 'Cantidad',
    'rooms.cartTitle': 'Tu selección',
    'rooms.cartRemove': 'Quitar',
    'rooms.cartSummary': '{rooms} {rooms, plural, one {habitación} other {habitaciones}} · {guests} {guests, plural, one {huésped} other {huéspedes}} · {nights} {nights, plural, one {noche} other {noches}}',
    'rooms.cartContinue': 'Continuar',
    // Régimen — catálogo configurable por hotel (tasks.md 2.2/2.4, ver RoomsStep.vue).
    'rooms.board.label': 'Régimen',
    'rooms.board.roomOnly': 'Sólo alojamiento',
    'rooms.board.breakfast': 'Desayuno incluido',
    'rooms.board.halfBoard': 'Desayuno y cena',
    'rooms.board.allInclusive': 'Todo incluido',
    'rooms.board.unavailable': 'Este hotel no ofrece este régimen',
    'rooms.board.comingSoon': 'Próximamente',
    'rooms.board.upcomingHint': 'Disponible como upgrade por {price} — todavía no se puede agregar al carrito',

    // UpsellsStep
    'upsells.title': 'Sumá extras a tu estadía',
    'upsells.subtitle': 'Opcional. Mejorá tu experiencia.',
    'upsells.loading': 'Cargando extras…',
    'upsells.empty': 'Sin extras disponibles',
    'upsells.emptyHint': 'Podés continuar directamente al pago.',
    'upsells.kindPerRoom': 'Por habitación',
    'upsells.kindPerPerson': 'Por persona',
    'upsells.kindPerStay': 'Por estadía',
    'upsells.quantity': 'Cantidad',
    'upsells.subtotal': 'Subtotal extras',
    'upsells.continue': 'Continuar',

    // GuestCheckoutStep
    'guest.title': 'Tus datos',
    'guest.subtitle': 'Sin crear cuenta. Solo necesitamos lo mínimo para tu reserva.',
    'guest.name': 'Nombre completo *',
    'guest.email': 'Email *',
    'guest.phone': 'Teléfono *',
    'guest.arrivalTime': 'Hora estimada de llegada (opcional)',
    'guest.arrivalTimePlaceholder': 'Ej: 15:00, o "después de las 8pm"',
    'guest.specialRequests': 'Pedidos especiales (opcional)',
    'guest.specialRequestsPlaceholder': 'Cuna, piso alto, alergias…',
    'guest.cta': 'Continuar al pago',
    'guest.nameError': 'Decinos tu nombre completo.',
    'guest.emailError': 'Revisá el email (ej. nombre@hotel.com).',
    'guest.phoneError': 'Revisá el teléfono.',

    // PayStep
    'pay.title': 'Revisá y reservá',
    'pay.subtitle': 'Último paso. Pagarás por Stripe (sitio seguro).',
    'pay.dates': 'Fechas',
    'pay.room': 'Habitación',
    'pay.extras': 'Extras',
    'pay.extrasCountOne': '1 extra',
    'pay.extrasCountMany': '{count} extras',
    'pay.guest': 'Huésped',
    'pay.guestsCount': 'Huéspedes',
    'pay.promoPrompt': '¿Tenés un código de descuento?',
    'pay.promoPlaceholder': 'Ej. WELCOME10',
    'pay.promoApply': 'Aplicar',
    'pay.promoApplied': '✓ Código aplicado: −{amount}',
    'pay.promoReasonNotFound': 'Código no válido.',
    'pay.promoReasonExpired': 'Código vencido.',
    'pay.promoReasonMaxUses': 'Código agotado.',
    'pay.promoReasonMinAmount': 'No alcanza el monto mínimo para este código.',
    'pay.promoReasonInactive': 'Código inactivo.',
    'pay.promoReasonDefault': 'No se pudo aplicar el código.',
    'pay.roomLine': 'Habitación ({count} {count, plural, one {noche} other {noches}})',
    'pay.taxes': 'Impuestos',
    'pay.discount': 'Descuento',
    'pay.total': 'Total',
    'pay.cancellationPolicy': 'Política de cancelación',
    'pay.cancelFreeUntil': 'Cancelá gratis hasta {deadline} antes del check-in',
    'pay.cancelFreeAnytime': 'Cancelación gratuita en cualquier momento',
    'pay.cancelHours': '{count} {count, plural, one {hora} other {horas}}',
    'pay.cancelDays': '{count} {count, plural, one {día} other {días}}',
    // Tono de riesgo (paridad con BookingModal.vue "Condiciones de la reserva" — mismo bug ya
    // cerrado una vez en la landing: nunca prometer un reembolso que la política real no da).
    'pay.cancelNoPolicyHeadline': 'Este hotel no publicó su política de cancelación.',
    'pay.cancelNoPolicyDetail': 'No podemos mostrarte qué pasa si cancelás esta reserva.',
    'pay.cancelNonRefundableHeadline': 'Tarifa NO reembolsable.',
    'pay.cancelStrictHeadline': 'Política estricta: cancelación sin cargo solo hasta {deadline} antes del check-in.',
    'pay.cancelStrictDetail': 'Pasado ese plazo la reserva no es reembolsable.',
    'pay.processing': 'Procesando…',
    'pay.cta': 'Reservar y pagar · {amount}',
    'pay.chargeNote': 'Te cobraremos en {charge}. Mostramos precios en {display}.',
    'pay.secureNote': 'Pago seguro procesado por Stripe.',
    'pay.acceptTerms': 'Acepto las condiciones de reserva y la política de cancelación',
    'pay.termsRequired': 'Aceptá las condiciones para poder pagar.',

    // ConfirmStep
    'confirm.loading': 'Confirmando tu reserva…',
    'confirm.doNotClose': 'No cierres esta ventana.',
    'confirm.success': '¡Reserva confirmada!',
    'confirm.successPendingApproval': '¡Reserva recibida!',
    'confirm.sentTo': 'Te enviamos los detalles a {email}.',
    'confirm.pendingApprovalNotice': 'Tu pago se procesó correctamente. El hotel todavía tiene que confirmar tu reserva — te avisamos por email en cuanto lo haga.',
    'confirm.checkIn': 'Check-in',
    'confirm.checkOut': 'Check-out',
    'confirm.guest': 'Huésped',
    'confirm.total': 'Total',
    'confirm.paid': 'Pagado',
    'confirm.pendingAmount': 'Pendiente de pago',
    'confirm.paidInFull': 'Pago recibido — no queda nada por pagar.',
    'confirm.partiallyPaid': 'Pago parcial recibido. El saldo se abona en el hotel.',
    'confirm.notPaid': 'Todavía no registramos tu pago.',
    'confirm.keepNumber': 'Guardá tu número de reserva:',
    'confirm.pending': 'Pago en proceso',
    'confirm.pendingBody': 'Tu pago está siendo confirmado. Te avisaremos por email en unos minutos.',
    'confirm.retry': 'Revisar de nuevo',
    'confirm.errorTitle': 'No pudimos confirmar',
    'confirm.errorDefault': 'No encontramos tu reserva o el pago fue cancelado.',
    'confirm.errorNotFound': 'No encontramos tu reserva. Revisá el link del email de confirmación.',
    'confirm.errorToken': 'El enlace no es válido o expiró.',
    'confirm.errorPayment': 'El pago fue rechazado o cancelado. Probá de nuevo.',
    'confirm.retryCta': 'Volver a intentar',
    // F3 3.17 — booking-confirmation standalone (página pública post-redirect Stripe).
    'confirm.accessCode': 'Código de acceso',
    'confirm.backHome': 'Volver al hotel',

    // Currency switcher
    'currency.detectLabel': 'Moneda del hotel',
  },
  en: {
    'wrapper.titleFallback': 'Book your stay',
    'wrapper.loading': 'Loading…',
    'wrapper.step': 'Step {current} / {total}',
    'wrapper.back': '← Back',
    'wrapper.language': 'Language',
    'wrapper.currency': 'Currency',
    'step.dates': 'Dates',
    'step.room': 'Room',
    'step.extras': 'Extras',
    'step.guest': 'Guest',
    'step.pay': 'Payment',
    'step.confirm': 'Confirmation',

    'search.title': 'Choose your dates',
    'search.subtitle': 'Find the best rates straight from the hotel.',
    'search.checkIn': 'Arrival',
    'search.checkOut': 'Departure',
    'search.dateError': 'Departure must be after arrival.',
    'search.cta': 'Check availability',
    'search.searching': 'Searching…',
    'search.nights': '{count} {count, plural, one {night} other {nights}}',
    'search.oneNight': '1 night',

    'calendar.months.jan': 'January',
    'calendar.months.feb': 'February',
    'calendar.months.mar': 'March',
    'calendar.months.apr': 'April',
    'calendar.months.may': 'May',
    'calendar.months.jun': 'June',
    'calendar.months.jul': 'July',
    'calendar.months.aug': 'August',
    'calendar.months.sep': 'September',
    'calendar.months.oct': 'October',
    'calendar.months.nov': 'November',
    'calendar.months.dec': 'December',
    'calendar.weekdaysShort.mon': 'M',
    'calendar.weekdaysShort.tue': 'T',
    'calendar.weekdaysShort.wed': 'W',
    'calendar.weekdaysShort.thu': 'T',
    'calendar.weekdaysShort.fri': 'F',
    'calendar.weekdaysShort.sat': 'S',
    'calendar.weekdaysShort.sun': 'S',
    'calendar.prevMonth': 'Previous month',
    'calendar.nextMonth': 'Next month',
    'calendar.checkIn': 'Check-in',
    'calendar.checkOut': 'Check-out',
    'calendar.clear': 'Clear',
    'calendar.nightsCount': '{count} {count, plural, one {night} other {nights}}',
    'calendar.soldOut': 'Sold out',
    'calendar.loadingRates': 'Loading rates…',
    'calendar.pricesUnavailable': 'We could not load this month’s rates. You can still pick your dates and see the price on the next step.',
    'calendar.blockedNight': 'No availability on the night of {date}. Please pick another departure.',
    'calendar.legendSoldOut': 'Sold out',
    'calendar.legendStay': 'Your stay',
    'calendar.stayFrom': 'from {amount}',
    'calendar.ariaPast': '{date}, past date',
    'calendar.ariaSoldOut': '{date}, sold out',
    'calendar.ariaFrom': '{date}, from {amount}',

    'rooms.title': 'Available rooms',
    'rooms.nightsSuffix': '{count} {count, plural, one {night} other {nights}}',
    'rooms.pricesIn': 'Prices in {currency}',
    'rooms.currencyUnavailable': "We don't have a rate for {wanted}: showing prices in {currency}.",
    'rooms.empty': 'No availability for these dates.',
    'rooms.emptyHint': 'It’s possible no room type has space for all of those nights in a row. Try a shorter range, different dates, or fewer guests.',
    'rooms.availableOne': '1 available',
    'rooms.availableMany': '{count} available',
    'rooms.fromLabel': 'From',
    'rooms.totalSuffix': 'total',
    'rooms.perNight': 'night',
    'rooms.plusTaxes': '+ taxes:',
    'rooms.urgency.last': 'Last one available',
    'rooms.urgency.few': 'Few rooms left at this price',
    'rooms.occupancyFor': 'for {count}',
    'rooms.occupancyPrice': 'Price {count} {count, plural, one {night} other {nights}}',
    'rooms.occupancyChoose': 'Choose',
    'rooms.occupancyChosen': 'Chosen',
    'rooms.unavailable.no_rate': 'No rate for this occupancy',
    'rooms.unavailable.no_availability': 'No availability for these dates',
    'rooms.unavailable.stop_sell': 'Closed for sale',
    'rooms.unavailable.over_capacity': 'Exceeds the room capacity',
    'rooms.unavailable.default': 'Not available',
    'rooms.add': 'Add',
    'rooms.quantity': 'Quantity',
    'rooms.cartTitle': 'Your selection',
    'rooms.cartRemove': 'Remove',
    'rooms.cartSummary': '{rooms} {rooms, plural, one {room} other {rooms}} · {guests} {guests, plural, one {guest} other {guests}} · {nights} {nights, plural, one {night} other {nights}}',
    'rooms.cartContinue': 'Continue',
    'rooms.board.label': 'Board',
    'rooms.board.roomOnly': 'Room only',
    'rooms.board.breakfast': 'Breakfast included',
    'rooms.board.halfBoard': 'Breakfast and dinner',
    'rooms.board.allInclusive': 'All inclusive',
    'rooms.board.unavailable': 'This hotel does not offer this board plan',
    'rooms.board.comingSoon': 'Coming soon',
    'rooms.board.upcomingHint': 'Available as an upgrade for {price} — cannot be added to the cart yet',

    'upsells.title': 'Add extras to your stay',
    'upsells.subtitle': 'Optional. Upgrade your experience.',
    'upsells.loading': 'Loading extras…',
    'upsells.empty': 'No extras available',
    'upsells.emptyHint': 'You can continue straight to payment.',
    'upsells.kindPerRoom': 'Per room',
    'upsells.kindPerPerson': 'Per person',
    'upsells.kindPerStay': 'Per stay',
    'upsells.quantity': 'Quantity',
    'upsells.subtotal': 'Extras subtotal',
    'upsells.continue': 'Continue',

    'guest.title': 'Your details',
    'guest.subtitle': 'No account needed. We just need the basics for your booking.',
    'guest.name': 'Full name *',
    'guest.email': 'Email *',
    'guest.phone': 'Phone *',
    'guest.arrivalTime': 'Estimated arrival time (optional)',
    'guest.arrivalTimePlaceholder': 'E.g: 3:00 PM, or "after 8pm"',
    'guest.specialRequests': 'Special requests (optional)',
    'guest.specialRequestsPlaceholder': 'Crib, high floor, allergies…',
    'guest.cta': 'Continue to payment',
    'guest.nameError': 'Please enter your full name.',
    'guest.emailError': 'Check the email (e.g. name@hotel.com).',
    'guest.phoneError': 'Check the phone number.',

    'pay.title': 'Review and book',
    'pay.subtitle': 'Last step. You will pay via Stripe (secure site).',
    'pay.dates': 'Dates',
    'pay.room': 'Room',
    'pay.extras': 'Extras',
    'pay.extrasCountOne': '1 extra',
    'pay.extrasCountMany': '{count} extras',
    'pay.guest': 'Guest',
    'pay.guestsCount': 'Guests',
    'pay.promoPrompt': 'Have a discount code?',
    'pay.promoPlaceholder': 'e.g. WELCOME10',
    'pay.promoApply': 'Apply',
    'pay.promoApplied': '✓ Code applied: −{amount}',
    'pay.promoReasonNotFound': 'Invalid code.',
    'pay.promoReasonExpired': 'Code expired.',
    'pay.promoReasonMaxUses': 'Code sold out.',
    'pay.promoReasonMinAmount': 'Minimum amount not reached for this code.',
    'pay.promoReasonInactive': 'Code inactive.',
    'pay.promoReasonDefault': 'Could not apply the code.',
    'pay.roomLine': 'Room ({count} {count, plural, one {night} other {nights}})',
    'pay.taxes': 'Taxes',
    'pay.discount': 'Discount',
    'pay.total': 'Total',
    'pay.cancellationPolicy': 'Cancellation policy',
    'pay.cancelFreeUntil': 'Free cancellation until {deadline} before check-in',
    'pay.cancelFreeAnytime': 'Free cancellation anytime',
    'pay.cancelHours': '{count} {count, plural, one {hour} other {hours}}',
    'pay.cancelDays': '{count} {count, plural, one {day} other {days}}',
    'pay.cancelNoPolicyHeadline': 'This hotel has not published its cancellation policy.',
    'pay.cancelNoPolicyDetail': "We can't show you what happens if you cancel this booking.",
    'pay.cancelNonRefundableHeadline': 'Non-refundable rate.',
    'pay.cancelStrictHeadline': 'Strict policy: free cancellation only until {deadline} before check-in.',
    'pay.cancelStrictDetail': 'After that deadline the booking is non-refundable.',
    'pay.processing': 'Processing…',
    'pay.cta': 'Book and pay · {amount}',
    'pay.chargeNote': 'You will be charged in {charge}. Prices shown in {display}.',
    'pay.secureNote': 'Secure payment processed by Stripe.',
    'pay.acceptTerms': 'I accept the booking terms and the cancellation policy',
    'pay.termsRequired': 'Accept the terms to continue with payment.',

    'confirm.loading': 'Confirming your booking…',
    'confirm.doNotClose': 'Do not close this window.',
    'confirm.success': 'Booking confirmed!',
    'confirm.successPendingApproval': 'Booking received!',
    'confirm.sentTo': 'We sent the details to {email}.',
    'confirm.pendingApprovalNotice': 'Your payment went through. The hotel still needs to confirm your booking — we’ll email you as soon as they do.',
    'confirm.checkIn': 'Check-in',
    'confirm.checkOut': 'Check-out',
    'confirm.guest': 'Guest',
    'confirm.total': 'Total',
    'confirm.paid': 'Paid',
    'confirm.pendingAmount': 'Balance due',
    'confirm.paidInFull': 'Payment received — nothing left to pay.',
    'confirm.partiallyPaid': 'Partial payment received. The balance is due at the hotel.',
    'confirm.notPaid': 'We have not registered your payment yet.',
    'confirm.keepNumber': 'Keep your booking number:',
    'confirm.pending': 'Payment in process',
    'confirm.pendingBody': 'Your payment is being confirmed. We will email you in a few minutes.',
    'confirm.retry': 'Check again',
    'confirm.errorTitle': 'We could not confirm',
    'confirm.errorDefault': 'We could not find your booking or the payment was cancelled.',
    'confirm.errorNotFound': 'We could not find your booking. Check the link in the confirmation email.',
    'confirm.errorToken': 'The link is invalid or expired.',
    'confirm.errorPayment': 'The payment was declined or cancelled. Please try again.',
    'confirm.retryCta': 'Try again',
    // F3 3.17 — booking-confirmation standalone (página pública post-redirect Stripe).
    'confirm.accessCode': 'Access code',
    'confirm.backHome': 'Back to hotel',

    'currency.detectLabel': 'Hotel currency',
  },
  pt: {
    'wrapper.titleFallback': 'Reserve sua estadia',
    'wrapper.loading': 'Carregando…',
    'wrapper.step': 'Passo {current} / {total}',
    'wrapper.back': '← Voltar',
    'wrapper.language': 'Idioma',
    'wrapper.currency': 'Moeda',
    'step.dates': 'Datas',
    'step.room': 'Quarto',
    'step.extras': 'Extras',
    'step.guest': 'Hóspede',
    'step.pay': 'Pagamento',
    'step.confirm': 'Confirmação',

    'search.title': 'Escolha suas datas',
    'search.subtitle': 'Encontre as melhores tarifas direto do hotel.',
    'search.checkIn': 'Chegada',
    'search.checkOut': 'Saída',
    'search.dateError': 'A saída deve ser posterior à chegada.',
    'search.cta': 'Ver disponibilidade',
    'search.searching': 'Buscando…',
    'search.nights': '{count} {count, plural, one {noite} other {noites}}',
    'search.oneNight': '1 noite',

    'calendar.months.jan': 'Janeiro',
    'calendar.months.feb': 'Fevereiro',
    'calendar.months.mar': 'Março',
    'calendar.months.apr': 'Abril',
    'calendar.months.may': 'Maio',
    'calendar.months.jun': 'Junho',
    'calendar.months.jul': 'Julho',
    'calendar.months.aug': 'Agosto',
    'calendar.months.sep': 'Setembro',
    'calendar.months.oct': 'Outubro',
    'calendar.months.nov': 'Novembro',
    'calendar.months.dec': 'Dezembro',
    'calendar.weekdaysShort.mon': 'S',
    'calendar.weekdaysShort.tue': 'T',
    'calendar.weekdaysShort.wed': 'Q',
    'calendar.weekdaysShort.thu': 'Q',
    'calendar.weekdaysShort.fri': 'S',
    'calendar.weekdaysShort.sat': 'S',
    'calendar.weekdaysShort.sun': 'D',
    'calendar.prevMonth': 'Mês anterior',
    'calendar.nextMonth': 'Próximo mês',
    'calendar.checkIn': 'Check-in',
    'calendar.checkOut': 'Check-out',
    'calendar.clear': 'Limpar',
    'calendar.nightsCount': '{count} {count, plural, one {noite} other {noites}}',
    'calendar.soldOut': 'Lotado',
    'calendar.loadingRates': 'Carregando tarifas…',
    'calendar.pricesUnavailable': 'Não conseguimos carregar as tarifas deste mês. Você pode escolher as datas mesmo assim e ver o preço no próximo passo.',
    'calendar.blockedNight': 'Sem disponibilidade na noite de {date}. Escolha outra saída.',
    'calendar.legendSoldOut': 'Sem disponibilidade',
    'calendar.legendStay': 'Sua estadia',
    'calendar.stayFrom': 'desde {amount}',
    'calendar.ariaPast': '{date}, data passada',
    'calendar.ariaSoldOut': '{date}, sem disponibilidade',
    'calendar.ariaFrom': '{date}, desde {amount}',

    'rooms.title': 'Quartos disponíveis',
    'rooms.nightsSuffix': '{count} {count, plural, one {noite} other {noites}}',
    'rooms.pricesIn': 'Preços em {currency}',
    'rooms.currencyUnavailable': 'Não temos câmbio para {wanted}: mostramos os preços em {currency}.',
    'rooms.empty': 'Sem disponibilidade para essas datas.',
    'rooms.emptyHint': 'É possível que nenhum tipo de quarto tenha vaga para todas essas noites seguidas. Tente um período mais curto, outras datas ou menos hóspedes.',
    'rooms.availableOne': '1 disponível',
    'rooms.availableMany': '{count} disponíveis',
    'rooms.fromLabel': 'Desde',
    'rooms.totalSuffix': 'total',
    'rooms.perNight': 'noite',
    'rooms.plusTaxes': '+ impostos:',
    'rooms.urgency.last': 'Última disponível',
    'rooms.urgency.few': 'Poucos quartos a este preço',
    'rooms.occupancyFor': 'para {count}',
    'rooms.occupancyPrice': 'Preço {count} {count, plural, one {noite} other {noites}}',
    'rooms.occupancyChoose': 'Escolher',
    'rooms.occupancyChosen': 'Escolhida',
    'rooms.unavailable.no_rate': 'Sem tarifa para esta ocupação',
    'rooms.unavailable.no_availability': 'Sem disponibilidade nestas datas',
    'rooms.unavailable.stop_sell': 'Fechada para venda',
    'rooms.unavailable.over_capacity': 'Excede a capacidade do quarto',
    'rooms.unavailable.default': 'Indisponível',
    'rooms.add': 'Adicionar',
    'rooms.quantity': 'Quantidade',
    'rooms.cartTitle': 'Sua seleção',
    'rooms.cartRemove': 'Remover',
    'rooms.cartSummary': '{rooms} {rooms, plural, one {quarto} other {quartos}} · {guests} {guests, plural, one {hóspede} other {hóspedes}} · {nights} {nights, plural, one {noite} other {noites}}',
    'rooms.cartContinue': 'Continuar',
    'rooms.board.label': 'Regime',
    'rooms.board.roomOnly': 'Só hospedagem',
    'rooms.board.breakfast': 'Café da manhã incluído',
    'rooms.board.halfBoard': 'Café da manhã e jantar',
    'rooms.board.allInclusive': 'Tudo incluído',
    'rooms.board.unavailable': 'Este hotel não oferece este regime',
    'rooms.board.comingSoon': 'Em breve',
    'rooms.board.upcomingHint': 'Disponível como upgrade por {price} — ainda não pode ser adicionado ao carrinho',

    'upsells.title': 'Adicione extras à sua estadia',
    'upsells.subtitle': 'Opcional. Melhore sua experiência.',
    'upsells.loading': 'Carregando extras…',
    'upsells.empty': 'Sem extras disponíveis',
    'upsells.emptyHint': 'Você pode continuar direto para o pagamento.',
    'upsells.kindPerRoom': 'Por quarto',
    'upsells.kindPerPerson': 'Por pessoa',
    'upsells.kindPerStay': 'Por estadia',
    'upsells.quantity': 'Quantidade',
    'upsells.subtotal': 'Subtotal extras',
    'upsells.continue': 'Continuar',

    'guest.title': 'Seus dados',
    'guest.subtitle': 'Sem criar conta. Só precisamos do mínimo para sua reserva.',
    'guest.name': 'Nome completo *',
    'guest.email': 'Email *',
    'guest.phone': 'Telefone *',
    'guest.arrivalTime': 'Horário estimado de chegada (opcional)',
    'guest.arrivalTimePlaceholder': 'Ex: 15:00, ou "depois das 20h"',
    'guest.specialRequests': 'Pedidos especiais (opcional)',
    'guest.specialRequestsPlaceholder': 'Berço, andar alto, alergias…',
    'guest.cta': 'Continuar para o pagamento',
    'guest.nameError': 'Diga-nos seu nome completo.',
    'guest.emailError': 'Confira o email (ex. nome@hotel.com).',
    'guest.phoneError': 'Confira o telefone.',

    'pay.title': 'Revise e reserve',
    'pay.subtitle': 'Último passo. Você pagará via Stripe (site seguro).',
    'pay.dates': 'Datas',
    'pay.room': 'Quarto',
    'pay.extras': 'Extras',
    'pay.extrasCountOne': '1 extra',
    'pay.extrasCountMany': '{count} extras',
    'pay.guest': 'Hóspede',
    'pay.guestsCount': 'Hóspedes',
    'pay.promoPrompt': 'Tem um código de desconto?',
    'pay.promoPlaceholder': 'Ex. WELCOME10',
    'pay.promoApply': 'Aplicar',
    'pay.promoApplied': '✓ Código aplicado: −{amount}',
    'pay.promoReasonNotFound': 'Código inválido.',
    'pay.promoReasonExpired': 'Código expirado.',
    'pay.promoReasonMaxUses': 'Código esgotado.',
    'pay.promoReasonMinAmount': 'Não atingiu o valor mínimo para este código.',
    'pay.promoReasonInactive': 'Código inativo.',
    'pay.promoReasonDefault': 'Não foi possível aplicar o código.',
    'pay.roomLine': 'Quarto ({count} {count, plural, one {noite} other {noites}})',
    'pay.taxes': 'Impostos',
    'pay.discount': 'Desconto',
    'pay.total': 'Total',
    'pay.cancellationPolicy': 'Política de cancelamento',
    'pay.cancelFreeUntil': 'Cancelamento gratuito até {deadline} antes do check-in',
    'pay.cancelFreeAnytime': 'Cancelamento gratuito a qualquer momento',
    'pay.cancelHours': '{count} {count, plural, one {hora} other {horas}}',
    'pay.cancelDays': '{count} {count, plural, one {dia} other {dias}}',
    'pay.cancelNoPolicyHeadline': 'Este hotel não publicou sua política de cancelamento.',
    'pay.cancelNoPolicyDetail': 'Não podemos mostrar o que acontece se você cancelar esta reserva.',
    'pay.cancelNonRefundableHeadline': 'Tarifa NÃO reembolsável.',
    'pay.cancelStrictHeadline': 'Política rígida: cancelamento gratuito só até {deadline} antes do check-in.',
    'pay.cancelStrictDetail': 'Depois desse prazo a reserva não é reembolsável.',
    'pay.processing': 'Processando…',
    'pay.cta': 'Reservar e pagar · {amount}',
    'pay.chargeNote': 'Cobraremos em {charge}. Mostramos preços em {display}.',
    'pay.secureNote': 'Pagamento seguro processado pela Stripe.',
    'pay.acceptTerms': 'Aceito as condições de reserva e a política de cancelamento',
    'pay.termsRequired': 'Aceite as condições para poder pagar.',

    'confirm.loading': 'Confirmando sua reserva…',
    'confirm.doNotClose': 'Não feche esta janela.',
    'confirm.success': 'Reserva confirmada!',
    'confirm.successPendingApproval': 'Reserva recebida!',
    'confirm.sentTo': 'Enviamos os detalhes para {email}.',
    'confirm.pendingApprovalNotice': 'Seu pagamento foi processado. O hotel ainda precisa confirmar sua reserva — avisaremos por email assim que isso acontecer.',
    'confirm.checkIn': 'Check-in',
    'confirm.checkOut': 'Check-out',
    'confirm.guest': 'Hóspede',
    'confirm.total': 'Total',
    'confirm.paid': 'Pago',
    'confirm.pendingAmount': 'Saldo a pagar',
    'confirm.paidInFull': 'Pagamento recebido — não resta nada a pagar.',
    'confirm.partiallyPaid': 'Pagamento parcial recebido. O saldo é pago no hotel.',
    'confirm.notPaid': 'Ainda não registramos o seu pagamento.',
    'confirm.keepNumber': 'Guarde seu número de reserva:',
    'confirm.pending': 'Pagamento em processamento',
    'confirm.pendingBody': 'Seu pagamento está sendo confirmado. Avisaremos por email em alguns minutos.',
    'confirm.retry': 'Verificar de novo',
    'confirm.errorTitle': 'Não pudemos confirmar',
    'confirm.errorDefault': 'Não encontramos sua reserva ou o pagamento foi cancelado.',
    'confirm.errorNotFound': 'Não encontramos sua reserva. Confira o link do email de confirmação.',
    'confirm.errorToken': 'O link é inválido ou expirou.',
    'confirm.errorPayment': 'O pagamento foi recusado ou cancelado. Tente novamente.',
    'confirm.retryCta': 'Tentar novamente',
    // F3 3.17 — booking-confirmation standalone (página pública post-redirect Stripe).
    'confirm.accessCode': 'Código de acesso',
    'confirm.backHome': 'Voltar ao hotel',

    'currency.detectLabel': 'Moeda do hotel',
  },
} as const

export type BookingMessageKey = keyof typeof messages['es']

const SUPPORTED: BookingLocale[] = ['es', 'en', 'pt']

/** Detecta el idioma inicial del widget:
 *   1. `sessionStorage['booking-widget:locale']` (el usuario ya eligió en esta sesión).
 *   2. `navigator.language` parseado (prefijo antes de `-`), si está soportado.
 *   3. ES (fallback default).
 *
 *  El parseo maneja tanto `'en-US'` como `'en'` → `'en'`. Casos edge:
 *   - `'pt-BR'` → `'pt'` (único variante soportada por ahora).
 *   - `'fr-FR'` → no soportado → fallback ES.
 *   - navigator sin language (SSR / webview raro) → ES. */
export function detectBookingLocale(): BookingLocale {
  try {
    const stored = sessionStorage.getItem('booking-widget:locale')
    if (stored && (SUPPORTED as string[]).includes(stored)) {
      return stored as BookingLocale
    }
  } catch { /* sessionStorage bloqueado (modo privado) — silencioso */ }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const prefix = navigator.language.split('-')[0].toLowerCase()
    if ((SUPPORTED as string[]).includes(prefix)) return prefix as BookingLocale
  }
  return 'es'
}

/**
 * Tarea 3.4 (corrección 2026-08-25) — `true` si el huésped YA eligió idioma explícitamente en
 * esta sesión (tier 1 de `detectBookingLocale`). El default de `booking_config.language` del
 * hotel (aplicado por `booking-widget.vue` tras cargar el hotel, async — llega DESPUÉS de que
 * el store ya se creó con `detectBookingLocale()`) solo debe pisar el fallback de
 * `navigator.language`/ES, nunca una elección real del huésped.
 */
export function hasStoredLocaleChoice(): boolean {
  try {
    const stored = sessionStorage.getItem('booking-widget:locale')
    return !!stored && (SUPPORTED as string[]).includes(stored)
  } catch {
    return false
  }
}

/** Pluralization helper para `{count, plural, one {…} other {…}}` (formato ICU simplificado).
 *  Solo soporta `one`/`other` — suficiente para los textos del widget. */
function applyPlural(template: string, params: Record<string, unknown>): string {
  return template.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
    (_m, key: string, one: string, other: string) => {
      const v = Number(params[key])
      return v === 1 ? one : other
    },
  )
}

/** Interpola `{name}` → params.name. Cualquier ref faltante se deja como `{name}` (verbose en QA). */
function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = params[key]
    return v === undefined || v === null ? `{${key}}` : String(v)
  })
}

export const useBookingI18nStore = defineStore('booking-widget-i18n', () => {
  const locale = ref<BookingLocale>(detectBookingLocale())

  /** Traduce una key al locale activo con fallback ES. Si la key no existe en ningún lado,
   *  devuelve la key literal (visible en QA para que el hueco sea obvio). */
  function t(key: BookingMessageKey, params?: Record<string, unknown>): string {
    const dict = messages[locale.value] as Record<string, string> | undefined
    const fallback = messages.es as Record<string, string>
    const raw = dict?.[key] ?? fallback[key] ?? String(key)
    return interpolate(applyPlural(raw, params ?? {}), params)
  }

  /** Cambia el locale activo y lo persiste en sessionStorage para la próxima visita. */
  function setLocale(code: BookingLocale): void {
    if (!(SUPPORTED as string[]).includes(code)) return
    locale.value = code
    try {
      sessionStorage.setItem('booking-widget:locale', code)
    } catch { /* sessionStorage bloqueado — silencioso */ }
  }

  /** Formatea un monto con Intl.NumberFormat según el locale activo. Fallback manual si la
   *  moneda es inválida (caso raro: hotels.currency no ISO 4217 — ej. un código custom). */
  function formatPrice(amount: number, currency: string): string {
    if (!amount && amount !== 0) return ''
    const localeTag = locale.value === 'en' ? 'en-US' : locale.value === 'pt' ? 'pt-BR' : 'es'
    try {
      return new Intl.NumberFormat(localeTag, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    } catch {
      return `${currency} ${amount.toFixed(2)}`
    }
  }

  return {
    locale,
    locales: BOOKING_LOCALES,
    t,
    setLocale,
    formatPrice,
  }
})
