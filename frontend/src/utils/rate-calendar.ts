// utils/rate-calendar.ts — Lógica PURA del calendario de tarifas de la landing pública
// (`components/landing/RateCalendar.vue`) y del selector de ocupación
// (`components/landing/OccupancySelector.vue`).
//
// Vive fuera de los .vue a propósito: el cálculo de noches, el "este día no se puede elegir" y
// el armado de la grilla del mes son las tres cosas que históricamente se rompieron en este
// repo, y en un módulo plano se testean sin montar componentes.
//
// ─── Fechas: NUNCA toISOString() ───────────────────────────────────────────────────────────
// Bug real ya arreglado dos veces en el repo (CalendarView.vue:131-140, useBooking.ts:searchValid):
// `toISOString()` pasa el instante a UTC ANTES de cortar la fecha. En Santo Domingo (UTC-4), de
// noche la fecha UTC ya es mañana → "hoy" quedaba deshabilitado en el calendario para cualquier
// huésped reservando después de las 20:00. Acá todo se arma con componentes LOCALES
// (getFullYear/getMonth/getDate) y las comparaciones son lexicográficas sobre 'YYYY-MM-DD'.
//
// ─── Semántica del rango (idéntica al widget, CalendarView.vue) ────────────────────────────
// Click 1 = checkIn. Click 2 = checkOut TAL CUAL (no "última noche + 1"). Las noches pagadas
// son [checkIn, checkOut-1], así que N celdas resaltadas como noche = N noches y el checkout
// es el día siguiente a la última noche. Un rango 5→8 son 3 noches (5, 6 y 7), no 4.

import type { CalendarDay, Occupancy } from '@/types/booking'

/** Tope de días por request que impone el backend (`validators/schema.ts MAX_CALENDAR_DAYS`).
 *  Pedir más devuelve 400 — el service clampea `to` antes de salir a la red. */
export const MAX_CALENDAR_DAYS = 90

/** Lunes-based (0=Lunes ... 6=Domingo): más natural para LATAM que el Domingo=0 de `Date.getDay`. */
export const WEEKDAY_LABELS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'] as const

export const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

// ─── Primitivas de fecha ────────────────────────────────────────────────────────────────────

export function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** `month` es 0-based (igual que `Date.getMonth`). */
export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

export function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

/** Fecha de hoy en horario LOCAL. `now` inyectable para tests deterministas. */
export function todayIso(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Suma (o resta, con `n` negativo) días calendario. Usa `new Date(y, m, d+n)`, que normaliza
 *  meses/años y NO se rompe con DST (no hay horas involucradas). */
export function addDays(iso: string, n: number): string {
  const p = parseIso(iso)
  if (!p) return iso
  const d = new Date(p.y, p.m, p.d + n)
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Noches entre dos fechas: `checkOut - checkIn` en días. 0 si falta alguna, si no parsean o si
 *  el rango es inverso. Siempre calcular con esto (o con un `computed` encima) — NUNCA guardar
 *  las noches en un `ref` que se actualiza a mano: se desincroniza al cambiar la selección
 *  (mem `planning-calc-inclusive-selection-static-refs`). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseIso(checkIn)
  const b = parseIso(checkOut)
  if (!a || !b) return 0
  const ms = new Date(b.y, b.m, b.d).getTime() - new Date(a.y, a.m, a.d).getTime()
  const nights = Math.round(ms / 86_400_000)
  return nights > 0 ? nights : 0
}

/** Días que ocupa una habitación en un rango [checkIn, checkOut): las noches pagadas.
 *  Vacío si el rango es inválido. */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const total = nightsBetween(checkIn, checkOut)
  const out: string[] = []
  for (let i = 0; i < total; i++) out.push(addDays(checkIn, i))
  return out
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** 0=Lunes ... 6=Domingo, para alinear el día 1 con su columna en la grilla. */
export function weekdayMondayBased(iso: string): number {
  const p = parseIso(iso)
  if (!p) return 0
  return (new Date(p.y, p.m, p.d).getDay() + 6) % 7
}

/**
 * Rango a pedirle al endpoint para un mes visible, recortado a lo útil:
 * - Nunca antes de `today` (los días pasados no se pueden reservar → no se piden).
 * - Nunca más de `MAX_CALENDAR_DAYS` (el backend responde 400).
 * `null` si el mes entero ya pasó (no hay nada que pedir).
 */
export function monthBounds(
  year: number,
  month: number,
  today: string,
): { from: string; to: string } | null {
  const first = isoOf(year, month, 1)
  const last = isoOf(year, month, daysInMonth(year, month))
  if (last < today) return null
  const from = first < today ? today : first
  return { from, to: clampSpan(from, last) }
}

/** Recorta `to` para que el rango [from, to] inclusivo no supere `max` días. */
export function clampSpan(from: string, to: string, max: number = MAX_CALENDAR_DAYS): string {
  if (!parseIso(from) || !parseIso(to)) return to
  if (to < from) return from
  const limit = addDays(from, max - 1)
  return to > limit ? limit : to
}

// ─── Reglas de selección ────────────────────────────────────────────────────────────────────

/**
 * ¿Se puede elegir este día?
 *
 * DEGRADACIÓN OBLIGATORIA: `day === undefined` (el hotel no tiene tarifas cargadas, o la llamada
 * al endpoint falló) devuelve `true`. El calendario tiene que seguir sirviendo para elegir fechas
 * aunque no haya precios — bloquear todo dejaría la reserva muerta por un problema de datos.
 */
export function isDaySelectable(iso: string, day: CalendarDay | undefined, today: string): boolean {
  if (!iso || iso < today) return false
  if (!day) return true
  if (day.closed) return false
  return day.available > 0
}

/**
 * Primera noche NO vendible dentro de [checkIn, checkOut). `null` si el rango entero es
 * reservable. Evita que el huésped arme un rango "por arriba" de una noche cerrada y recién se
 * entere al final del wizard.
 */
export function firstBlockedNight(
  checkIn: string,
  checkOut: string,
  days: ReadonlyMap<string, CalendarDay>,
  today: string,
): string | null {
  for (const iso of nightsOf(checkIn, checkOut)) {
    if (!isDaySelectable(iso, days.get(iso), today)) return iso
  }
  return null
}

/** Estadía mínima que impone el día de ENTRADA (0 si no aplica o no hay dato). */
export function minStayFor(iso: string, days: ReadonlyMap<string, CalendarDay>): number {
  const day = days.get(iso)
  const min = day?.minStay ?? 0
  return min > 1 ? min : 0
}

/**
 * Total "desde" de la estadía: suma el `fromPrice` de cada noche.
 * `null` si falta el precio de al menos una noche — un total parcial es peor que ninguno
 * (el huésped lo lee como el precio final y después no cuadra).
 */
export function sumStayPrice(
  checkIn: string,
  checkOut: string,
  days: ReadonlyMap<string, CalendarDay>,
): number | null {
  const list = nightsOf(checkIn, checkOut)
  if (list.length === 0) return null
  let total = 0
  for (const iso of list) {
    const price = days.get(iso)?.fromPrice ?? 0
    if (price <= 0) return null
    total += price
  }
  return Math.round((total + Number.EPSILON) * 100) / 100
}

// ─── Grilla del mes ─────────────────────────────────────────────────────────────────────────

export interface RateCell {
  /** 'YYYY-MM-DD'. Vacío en las celdas de relleno del inicio del mes. */
  iso: string
  day: number
  inMonth: boolean
  past: boolean
  today: boolean
  /** Precio de la noche, `null` si no hay dato o el backend devolvió 0. */
  price: number | null
  /** Unidades libres, `null` si todavía no llegó el dato de ese día. */
  available: number | null
  /** Sin nada vendible ese día (stop-sell o stock en 0). */
  soldOut: boolean
  minStay: number
  selectable: boolean
}

const BLANK: RateCell = {
  iso: '', day: 0, inMonth: false, past: true, today: false,
  price: null, available: null, soldOut: false, minStay: 0, selectable: false,
}

/**
 * Celdas de un mes, con relleno inicial para que el día 1 caiga en su columna.
 * `days` puede venir vacío: en ese caso las celdas futuras salen seleccionables y sin precio
 * (ver `isDaySelectable`).
 */
export function buildMonthCells(
  year: number,
  month: number,
  ctx: { today: string; days?: ReadonlyMap<string, CalendarDay> },
): RateCell[] {
  const days = ctx.days ?? new Map<string, CalendarDay>()
  const out: RateCell[] = []
  const leading = weekdayMondayBased(isoOf(year, month, 1))
  for (let i = 0; i < leading; i++) out.push({ ...BLANK })

  const total = daysInMonth(year, month)
  for (let d = 1; d <= total; d++) {
    const iso = isoOf(year, month, d)
    const data = days.get(iso)
    const past = iso < ctx.today
    const price = data && data.fromPrice > 0 ? data.fromPrice : null
    out.push({
      iso,
      day: d,
      inMonth: true,
      past,
      today: iso === ctx.today,
      price,
      available: data ? data.available : null,
      // "Agotado" solo se afirma con dato en mano: sin dato no se inventa un sold-out.
      soldOut: !past && !!data && (data.closed || data.available <= 0),
      minStay: minStayFor(iso, days),
      selectable: isDaySelectable(iso, data, ctx.today),
    })
  }
  return out
}

// ─── Formato ────────────────────────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Resumen explícito de la ocupación para el trigger del selector: "2 adultos, 1 niño".
 * Los niños se omiten en 0 (nadie escribe "0 niños") y las habitaciones solo aparecen si son
 * más de una — el caso normal es 1 y repetirlo es ruido.
 */
export function formatOccupancy(o: Occupancy): string {
  const parts = [plural(Math.max(1, o.adults), 'adulto', 'adultos')]
  if (o.children > 0) parts.push(plural(o.children, 'niño', 'niños'))
  if (o.rooms > 1) parts.push(plural(o.rooms, 'habitación', 'habitaciones'))
  return parts.join(', ')
}

/** Ocupación física total por habitación — lo que el endpoint entiende por `guests`
 *  (filtra `rooms.capacity >= guests`): un niño también ocupa una plaza. */
export function totalGuests(o: Occupancy): number {
  return Math.max(1, o.adults) + Math.max(0, o.children)
}

/**
 * `decimals=false` (default): sin decimales — pensado para las CELDAS del calendario (chicas,
 * los centavos no aportan ahí). `Intl` tira RangeError con un código de moneda inválido →
 * fallback a "COD 120". `locale` es opcional y default 'es' (la landing es solo en español); el
 * widget embebible es multi-idioma y le pasa el suyo (es/en/pt) para que el agrupado de miles no
 * quede en español dentro de una UI en inglés.
 *
 * `decimals=true`: monto con centavos EXACTOS — auditoría final (Requerimiento 15, 2026-09-04):
 * `BookingModal.vue` (la landing) reusaba este formateador SIN decimales para TODO el flujo de
 * reserva (precio por habitación, carrito, subtotal, impuestos, y el monto del botón "Reservar y
 * pagar"), no solo para celdas de calendario. Con una tarifa que no cierra en un entero (ej.
 * $99,50, o cualquier total con impuestos/descuento aplicados), la landing REDONDEABA el precio
 * mostrado mientras el widget (`RoomsStep.vue`, vía `useBookingI18n#formatPrice`) mostraba el
 * exacto — dos entradas públicas mostrando NÚMEROS DISTINTOS para la MISMA reserva (el defecto
 * que el Requerimiento 15 pide evitar explícitamente), y peor: el botón de pago podía anunciar un
 * monto que no es el que realmente se cobra. `BookingModal.vue#money()` pasa `true` acá; las
 * celdas de calendario (`CalendarView.vue`, `RateCalendar.vue`) siguen sin pasarlo — comportamiento
 * intacto para ellas.
 */
export function formatMoney(value: number, currency: string, locale: string = 'es', decimals = false): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    }).format(value)
  } catch {
    return decimals ? `${currency} ${value.toFixed(2)}` : `${currency} ${Math.round(value)}`
  }
}

/** "vie 8 ago" — etiqueta corta para el botón de fechas del buscador. `locale` opcional por el
 *  mismo motivo que `formatMoney` (el widget embebible es es/en/pt). */
export function formatShortDate(iso: string, locale: string = 'es'): string {
  const p = parseIso(iso)
  if (!p) return ''
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(p.y, p.m, p.d))
      .replace(/\./g, '')
  } catch {
    return iso
  }
}
