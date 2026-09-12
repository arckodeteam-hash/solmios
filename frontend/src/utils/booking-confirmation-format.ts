// booking-confirmation-format.ts — Helpers puros de la página pública de confirmación de reserva
// (#241). Viven fuera del .vue para testearlos sin montar la vista y para que ConfirmStep.vue (el
// mismo resumen dentro del widget) pueda reusarlos sin copiar.
//
// Tres reglas que están acá y no en el template:
//   - Las fechas se muestran con `Intl.DateTimeFormat` en el idioma del motor ("19 de octubre de
//     2026"), NUNCA el `YYYY-MM-DD` crudo que guarda la reserva.
//   - El nombre del huésped se normaliza SOLO para mostrar: "LUIS BERNIEL Ortiz mOYA" →
//     "Luis Berniel Ortiz Moya". El dato guardado no se toca (lo que el huésped tipeó es lo que
//     va a la factura y a Meta).
//   - La dirección pública se arma con los campos que el hotel cargó, sin inventar separadores
//     para los que faltan.

import type { BookingLocale } from '@/composables/useBookingI18n'

/** Etiqueta BCP 47 para `Intl` según el idioma del motor. Misma tabla que `formatPrice`. */
export function bookingLocaleTag(locale: BookingLocale): string {
  return locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es'
}

/**
 * Parsea `YYYY-MM-DD` como fecha LOCAL (año, mes, día). `new Date('2026-10-19')` la interpreta en
 * UTC y en cualquier huso al oeste de Greenwich retrocede un día al formatear — el check-in del
 * 19 se leería "18 de octubre".
 */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * "Domingo, 19 de octubre de 2026" (es) · "Sunday, October 19, 2026" (en) ·
 * "Domingo, 19 de outubro de 2026" (pt). Si la fecha no se puede leer devuelve el texto crudo:
 * mejor un `2026-10-19` que un guion.
 */
export function formatStayDate(iso: string | null | undefined, locale: BookingLocale): string {
  const d = parseIsoDate(iso)
  if (!d) return String(iso ?? '')
  try {
    const text = new Intl.DateTimeFormat(bookingLocaleTag(locale), {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(d)
    // es/pt devuelven el día en minúscula ("domingo, 19 de…"); como etiqueta suelta arranca en mayúscula.
    return text.charAt(0).toLocaleUpperCase(bookingLocaleTag(locale)) + text.slice(1)
  } catch {
    return String(iso)
  }
}

/** Noches entre dos `YYYY-MM-DD`. 0 si alguna no se puede leer o el orden está invertido. */
export function nightsBetween(checkIn: string | null | undefined, checkOut: string | null | undefined): number {
  const a = parseIsoDate(checkIn)
  const b = parseIsoDate(checkOut)
  if (!a || !b) return 0
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  return diff > 0 ? diff : 0
}

/**
 * Partículas que en un nombre hispano/lusófono van en minúscula salvo al principio:
 * "María de los Ángeles", "João da Silva", "Juan Carlos del Valle".
 */
const LOWERCASE_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'van', 'von', 'der'])

/**
 * Capitalización de título para MOSTRAR un nombre propio. No altera el dato: es una función de
 * presentación. Respeta guiones y apóstrofes ("Ana-María", "O'Brien") y mantiene las partículas
 * en minúscula cuando no abren el nombre.
 */
export function displayName(raw: string | null | undefined): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return ''
  const words = name.toLocaleLowerCase().split(' ')
  return words
    .map((word, i) => {
      if (i > 0 && LOWERCASE_PARTICLES.has(word)) return word
      return word.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase())
    })
    .join(' ')
}

/** Dirección pública en una línea: solo los campos cargados, en orden de más a menos específico. */
export function publicAddressLine(hotel: {
  address?: string | null
  locality?: string | null
  municipality?: string | null
  province?: string | null
} | null | undefined): string {
  if (!hotel) return ''
  const seen = new Set<string>()
  const parts: string[] = []
  for (const raw of [hotel.address, hotel.locality, hotel.municipality, hotel.province]) {
    const v = String(raw ?? '').trim()
    // Municipio y localidad suelen repetirse ("Santo Domingo de Guzmán, Santo Domingo de Guzmán").
    const key = v.toLocaleLowerCase()
    if (!v || seen.has(key)) continue
    seen.add(key)
    parts.push(v)
  }
  return parts.join(', ')
}

/** Identificador corto que el huésped guarda y el hotel busca: los 8 primeros del UUID, como en
 *  ConfirmStep.vue y en el correo. Vacío si no hay reserva todavía. */
export function shortBookingCode(id: string | null | undefined): string {
  return String(id ?? '').trim().slice(0, 8)
}

/** `HH:MM` del hotel tal como lo guardó; vacío si no tiene la pinta esperada (no se inventa). */
export function hotelTimeOrEmpty(v: unknown): string {
  const s = String(v ?? '').trim()
  return /^\d{1,2}:\d{2}$/.test(s) ? s : ''
}

/** URL pública del recibo de pago en PDF (#270): mismo id+token HMAC que el polling de la
 *  confirmación; el backend responde 404 si el token no valida. '' si falta id o token. */
export function receiptPdfUrl(id: string | null | undefined, token: string | null | undefined): string {
  if (!id || !token) return ''
  const query = new URLSearchParams({ token }).toString()
  return `/api/public/reservations/${encodeURIComponent(id)}/receipt.pdf?${query}`
}
