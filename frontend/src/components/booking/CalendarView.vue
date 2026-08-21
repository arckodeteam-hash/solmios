<template>
  <!--
    CalendarView.vue — Calendario del widget embebible (`/book/:slug`, SearchStep).

    PRECIOS POR DÍA (2026-08-04): antes solo mostraba el número del día. El huésped todavía está
    decidiendo CUÁNDO viene, así que cada celda tiene que decirle cuánto sale esa noche y si hay
    lugar — igual que el calendario de la landing (`components/landing/RateCalendar.vue`).

    NO se importa RateCalendar.vue: ese vive dentro de un panel `Teleport` anclado al buscador de
    la landing, tiene textos en español hardcodeados y no conoce el switcher de moneda. Acá el
    calendario es inline dentro del step, los textos salen de `useBookingI18n` (es/en/pt) y los
    precios se piden EN LA MONEDA ELEGIDA (`store.currencyPreference`), refrescándose cuando el
    huésped la cambia. Lo que sí se comparte es toda la lógica pura: `utils/rate-calendar.ts`
    (grilla del mes, reglas de selección, rango a pedir, formato) y el service `getCalendar`.

    FIX 2026-07-31 (bug off-by-one) — Click 2 = FECHA DE CHECKOUT directa, no "última noche + 1".
    Las noches pagadas son [checkIn, checkOut-1]: un click en el 6 con inicio el 5 = 1 noche.
    Click en celda anterior o igual al inicio → reinicia el rango.

    Anti-bug (mem `planning-calc-inclusive-selection-static-refs`): las noches se calculan con un
    `computed` sobre store.checkIn/checkOut, NUNCA con un `ref` fijo que se actualiza a mano.

    Escribir directo al store (`store.checkIn`/`store.checkOut`) hace que TODO el widget reaccione:
    el botón "Ver disponibilidad" se habilita, el PayStep muestra el total, la urgencia D11 recalcula.

    FIX 2026-08-02 (feedback #629, widget embebido `?embed=1`): SIEMPRE 1 mes visible con nav ‹ ›
    (antes 2 meses lado a lado desde `sm`, que en un iframe ocupa todo el ancho del host) y la
    celda de HOY resaltada en grande. Ambas cosas se mantienen con los precios: la celda creció en
    alto (para el precio) pero el ancho lo sigue repartiendo `grid-cols-7`, así que entra igual en
    un iframe angosto.

    DEGRADACIÓN: si el endpoint falla o el hotel no tiene tarifas cargadas, el calendario SIGUE
    sirviendo para elegir fechas — sin precios y sin bloquear días. Nunca queda en blanco ni
    impide reservar.
  -->
  <div class="space-y-3">
    <!-- Header: navegación entre meses. -->
    <div class="flex items-center justify-between">
      <button
        type="button"
        class="rounded-lg p-2 text-navy hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!canGoPrev"
        :aria-label="i18n.t('calendar.prevMonth')"
        @click="goPrev"
      >
        <span aria-hidden="true">‹</span>
      </button>
      <div class="text-center text-sm font-black text-navy" aria-live="polite">
        {{ i18n.t(monthKey(viewMonth)) }} {{ viewYear }}
      </div>
      <button
        type="button"
        class="rounded-lg p-2 text-navy hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!canGoNext"
        :aria-label="i18n.t('calendar.nextMonth')"
        @click="goNext"
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>

    <!-- Grid de 1 solo mes — compacto, mobile-first (#629). -->
    <div>
      <!-- Encabezado de weekdays (Lunes-Domingo, Monday-based). -->
      <div class="grid grid-cols-7 mb-1 text-center text-[10px] font-bold uppercase tracking-wide text-text-muted">
        <div v-for="w in weekdayShortKeys" :key="w">{{ i18n.t(weekdayKey(w)) }}</div>
      </div>
      <!-- Celdas del mes. Blank cells al inicio para alinear el día 1 con su weekday. -->
      <div class="relative grid grid-cols-7 gap-0.5">
        <template v-for="(cell, i) in cells" :key="cell.iso || `blank-${i}`">
          <span v-if="!cell.inMonth" class="h-12" />
          <button
            v-else
            type="button"
            :disabled="!cell.selectable"
            :aria-label="cellAriaLabel(cell)"
            :aria-pressed="cell.iso === store.checkIn || cell.iso === store.checkOut"
            :class="cellClass(cell)"
            @click="onCellClick(cell)"
            @mouseenter="onCellEnter(cell)"
            @focus="onCellEnter(cell)"
            @touchstart.passive="onCellEnter(cell)"
          >
            <span
              class="leading-none"
              :class="[
                isBareToday(cell) ? 'text-base font-black' : 'text-sm font-semibold',
                cell.soldOut ? 'line-through decoration-2' : '',
              ]"
            >{{ cell.day }}</span>
            <!-- Sin precio por día: distintos tipos de habitación cotizan distinto, y un "desde"
                 agregado bajo el día se leía como EL precio de la habitación que el huésped
                 termina eligiendo. El precio real por tipo se muestra recién en RoomsStep,
                 donde cada tarjeta cotiza su propio tipo. -->
            <span v-if="cell.soldOut" class="mt-0.5 text-[8px] font-bold uppercase leading-none">
              {{ i18n.t('calendar.soldOut') }}
            </span>
          </button>
        </template>

        <span
          v-if="loading"
          class="absolute inset-0 grid place-items-center rounded-xl bg-white/70 text-[11px] font-bold text-text-muted"
        >{{ i18n.t('calendar.loadingRates') }}</span>
      </div>
    </div>

    <!-- Leyenda: un día sin lugar tiene que leerse como "no hay lugar", no como "se rompió". -->
    <div v-if="hasAvailabilityData" class="flex items-center gap-3 text-[10px] text-text-muted">
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-3 rounded-sm bg-slate-200" aria-hidden="true" />
        {{ i18n.t('calendar.legendSoldOut') }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-3 rounded-sm bg-cyan" aria-hidden="true" />
        {{ i18n.t('calendar.legendStay') }}
      </span>
    </div>

    <!-- Sin precios: se avisa, pero NO se bloquea la elección de fechas. -->
    <p
      v-if="pricesUnavailable"
      class="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-semibold text-text-muted"
    >
      {{ i18n.t('calendar.pricesUnavailable') }}
    </p>

    <p
      v-if="blockedMessage"
      class="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600"
      role="alert"
    >{{ blockedMessage }}</p>

    <!-- Summary con la selección confirmada + clear. -->
    <div
      v-if="hasValidSelection"
      class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"
    >
      <div class="min-w-0 flex-1 text-text-muted">
        <span class="font-bold text-navy">{{ i18n.t('calendar.checkIn') }}:</span>
        <span class="ml-1 text-navy">{{ store.checkIn }}</span>
        <span class="mx-1 text-text-muted">→</span>
        <span class="font-bold text-navy">{{ i18n.t('calendar.checkOut') }}:</span>
        <span class="ml-1 text-navy">{{ store.checkOut }}</span>
        <span class="ml-2 text-text-muted">·</span>
        <span class="ml-2 font-bold text-cyan">{{ i18n.t('calendar.nightsCount', { count: computedNights }) }}</span>
        <span v-if="stayTotal !== null" class="ml-2 tabular-nums text-text-muted">
          {{ i18n.t('calendar.stayFrom', { amount: money(stayTotal) }) }}
        </span>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-text-muted hover:text-navy"
        @click="clearSelection"
      >
        {{ i18n.t('calendar.clear') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore, type BookingMessageKey } from '@/composables/useBookingI18n'
import { BookingService } from '@/services/Booking.service'
import {
  addDays,
  buildMonthCells,
  firstBlockedNight,
  formatMoney,
  formatShortDate,
  monthBounds,
  nightsBetween,
  parseIso,
  sumStayPrice,
  todayIso,
  type RateCell,
} from '@/utils/rate-calendar'
import type { CalendarDay } from '@/types/booking'

const store = useBookingStore()
const i18n = useBookingI18nStore()

/** Lunes-based: 0=Lunes, 6=Domingo (más natural para LATAM que Dom=0 de Date.getDay). */
const weekdayShortKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

// Fecha de HOY en horario LOCAL. `todayIso()` no pasa por `toISOString()` a propósito: en
// timezones negativos (Santo Domingo UTC-4) la fecha UTC ya es mañana durante la noche local, y
// "hoy" quedaba deshabilitado para cualquier huésped reservando de noche (bug real, ya arreglado
// dos veces en el repo — ver el encabezado de utils/rate-calendar.ts).
const today = todayIso()

// ─── Datos del endpoint ───────────────────────────────────────────────────────
/** iso → día. Acumula todos los meses ya cargados (una request por mes, no 90 días de una). */
const days = ref(new Map<string, CalendarDay>())
/** Meses ya resueltos con éxito ('2026-7'). Un mes que falló NO entra: se reintenta al volver. */
const loadedMonths = ref(new Set<string>())
const inFlight = new Set<string>()
const loading = ref(false)
/** Meses SIN precios utilizables (falló la request, o el hotel no cargó tarifas ahí). Es por mes
 *  y no un flag global: si agosto tiene precios y septiembre no, volver a agosto saca el aviso. */
const monthsWithoutPrices = ref(new Set<string>())
/** Moneda en la que respondió el backend (puede diferir de la pedida si no tiene rate cargada). */
const responseCurrency = ref('')

/** Mes inicial: el del checkIn ya elegido (deep-link desde la landing), si no el actual. */
const startMonth = parseIso(store.checkIn) ?? parseIso(today)!
const viewYear = ref(startMonth.y)
const viewMonth = ref(startMonth.m)

function monthCacheKey(y: number, m: number): string {
  return `${y}-${m}`
}

/** Moneda a pedirle al backend: la que el huésped eligió en el switcher del widget.
 *  `''` (auto) → no se manda y el backend responde en la del hotel. */
const currencyQuery = computed(() => store.currencyPreference || undefined)

async function loadMonth(y: number, m: number): Promise<void> {
  const key = monthCacheKey(y, m)
  if (loadedMonths.value.has(key) || inFlight.has(key)) return
  const bounds = monthBounds(y, m, today)
  // Mes íntegramente pasado: no hay nada que pedir.
  if (!bounds) {
    loadedMonths.value = new Set(loadedMonths.value).add(key)
    return
  }
  inFlight.add(key)
  loading.value = true
  try {
    const res = await BookingService.getCalendar(store.slug, {
      from: bounds.from,
      to: bounds.to,
      // Ocupación FÍSICA (adultos + niños): el backend filtra por `rooms.capacity >= guests` y
      // elige la fila de tarifa por `occupancy`. Un niño ocupa una plaza igual que un adulto.
      guests: store.physicalGuests,
      currency: currencyQuery.value,
    })
    const next = new Map(days.value)
    for (const day of res.days) next.set(day.date, day)
    days.value = next
    responseCurrency.value = res.currency || responseCurrency.value
    loadedMonths.value = new Set(loadedMonths.value).add(key)
    // Hotel sin tarifas cargadas: el endpoint responde 200 con todo en 0 → se avisa igual, pero
    // las fechas se siguen pudiendo elegir (`isDaySelectable` degrada con `closed:false`).
    if (res.days.length > 0 && res.days.every((d) => d.fromPrice <= 0)) {
      monthsWithoutPrices.value = new Set(monthsWithoutPrices.value).add(key)
    }
  } catch {
    // Endpoint caído / 400 / red: el calendario sigue funcionando sin precios.
    monthsWithoutPrices.value = new Set(monthsWithoutPrices.value).add(key)
  } finally {
    inFlight.delete(key)
    loading.value = false
  }
}

/** Tira todo lo cacheado y vuelve a pedir el mes visible. Lo dispara cualquier cambio que
 *  invalide los precios: ocupación (otra capacidad/tarifa) o moneda (otra conversión). */
function invalidateAndReload(): void {
  days.value = new Map()
  loadedMonths.value = new Set()
  monthsWithoutPrices.value = new Set()
  void loadMonth(viewYear.value, viewMonth.value)
}

onMounted(() => {
  if (store.slug) void loadMonth(viewYear.value, viewMonth.value)
})
watch([viewYear, viewMonth], ([y, m]) => void loadMonth(y, m))
// El slug puede llegar después del montaje (el wrapper lo resuelve de la ruta).
watch(() => store.slug, (s) => { if (s) invalidateAndReload() })
// Deep-link: el wrapper llama a `store.init(...)` en SU onMounted, que corre DESPUÉS del de este
// hijo — cuando se calculó `startMonth`, el checkIn de la URL todavía no estaba en el store y el
// calendario abría en el mes actual aunque el huésped viniera con fechas de octubre. Al llegar
// una llegada fuera del mes visible, saltamos a su mes. Clickear una celda no dispara nada: esa
// fecha ya pertenece al mes que se está viendo.
watch(() => store.checkIn, (iso) => {
  const p = parseIso(iso)
  if (!p) return
  if (p.y !== viewYear.value || p.m !== viewMonth.value) {
    viewYear.value = p.y
    viewMonth.value = p.m
  }
})
// El precio depende de la ocupación física y de la moneda display → cambiar cualquiera invalida
// TODO lo cacheado. El switcher de moneda del widget pasa por acá (la landing no lo tiene).
watch(() => store.physicalGuests, () => invalidateAndReload())
watch(currencyQuery, () => invalidateAndReload())

// ─── Grilla ───────────────────────────────────────────────────────────────────

/** pendingStart = primera celda clickeada (esperando el segundo click).
 *  hovered = celda bajo el cursor/foco, para el preview del rango mientras se elige. */
const pendingStart = ref<string | null>(null)
const hovered = ref<string | null>(null)
const blockedMessage = ref('')

const cells = computed(() => buildMonthCells(viewYear.value, viewMonth.value, { today, days: days.value }))

const hasAvailabilityData = computed(() => days.value.size > 0)

/** ¿El mes que se está viendo quedó sin precios? (por fallo o porque el hotel no cargó tarifas). */
const pricesUnavailable = computed(() =>
  monthsWithoutPrices.value.has(monthCacheKey(viewYear.value, viewMonth.value)),
)

/**
 * Rango a pintar: noches [start, end] + la celda de salida marcada aparte (no es una noche
 * pagada). Sale del hover mientras se elige, o de la selección confirmada en el store.
 */
const range = computed<{ start: string; end: string; checkout: string } | null>(() => {
  if (pendingStart.value) {
    if (hovered.value && hovered.value > pendingStart.value) {
      return { start: pendingStart.value, end: addDays(hovered.value, -1), checkout: hovered.value }
    }
    return { start: pendingStart.value, end: pendingStart.value, checkout: '' }
  }
  if (store.checkIn && store.checkOut && store.checkOut > store.checkIn) {
    return { start: store.checkIn, end: addDays(store.checkOut, -1), checkout: store.checkOut }
  }
  if (store.checkIn) return { start: store.checkIn, end: store.checkIn, checkout: '' }
  return null
})

/** Tag de locale para `Intl` según el idioma activo del widget (mismo mapeo que formatPrice). */
const localeTag = computed(() =>
  i18n.locale === 'en' ? 'en-US' : i18n.locale === 'pt' ? 'pt-BR' : 'es',
)

/** Moneda de display: la que devolvió el backend; si todavía no respondió, la del switcher. */
const shownCurrency = computed(() => responseCurrency.value || store.displayCurrency || 'USD')

function money(value: number): string {
  return formatMoney(value, shownCurrency.value, localeTag.value)
}

function shortDate(iso: string): string {
  return formatShortDate(iso, localeTag.value)
}

/** ¿Es una de las noches PAGADAS del rango? (el día de salida no lo es). */
function isNight(cell: RateCell): boolean {
  const r = range.value
  return !!(r && cell.iso >= r.start && cell.iso <= r.end)
}

/** HOY sin marcar por la selección (#629: "que se vea la fecha de hoy en grande"). */
function isBareToday(cell: RateCell): boolean {
  const r = range.value
  if (!cell.today) return false
  const marked = !!(r && cell.iso >= r.start && (cell.iso <= r.end || cell.iso === r.checkout))
  return !marked
}

function cellAriaLabel(cell: RateCell): string {
  const date = shortDate(cell.iso)
  if (cell.past) return i18n.t('calendar.ariaPast', { date })
  if (cell.soldOut) return i18n.t('calendar.ariaSoldOut', { date })
  if (cell.price !== null) return i18n.t('calendar.ariaFrom', { date, amount: money(cell.price) })
  return date
}

function cellClass(cell: RateCell): string {
  const r = range.value
  const night = isNight(cell)
  const isStart = !!(r && cell.iso === r.start)
  const isCheckout = !!(r && r.checkout && cell.iso === r.checkout)

  const base = 'relative flex h-12 w-full flex-col items-center justify-center rounded-xl transition select-none'
  if (cell.past) return `${base} cursor-not-allowed text-text-muted/40`
  // Sold-out: fondo sólido + número tachado. Un gris tenue solo se lee como "deshabilitado por
  // error"; esto se lee como "acá no hay lugar".
  if (cell.soldOut) return `${base} cursor-not-allowed bg-slate-200 text-text-muted`

  const parts = [base, 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/40']
  if (isStart) parts.push('bg-cyan font-black text-white')
  else if (night) parts.push('bg-cyan/20 text-navy')
  else if (isCheckout) parts.push('ring-2 ring-cyan text-navy')
  else parts.push('text-navy hover:bg-cyan/10')
  if (isBareToday(cell)) parts.push('ring-2 ring-cyan text-cyan')
  return parts.join(' ')
}

// ─── Selección inclusiva (anti-bug: nada de ref fijo para noches) ──────────────

function onCellClick(cell: RateCell): void {
  if (!cell.selectable) return
  blockedMessage.value = ''

  // Sin inicio pendiente, o click igual/anterior al inicio → esa celda pasa a ser la llegada.
  if (!pendingStart.value || cell.iso <= pendingStart.value) {
    pendingStart.value = cell.iso
    hovered.value = cell.iso
    store.checkIn = cell.iso
    store.checkOut = ''
    return
  }

  // Click posterior = SALIDA tal cual (no "última noche + 1"). Antes de confirmar, ninguna de las
  // noches [checkIn, checkOut-1] puede estar cerrada: armar el rango "por arriba" de una noche
  // llena falla recién al final del wizard, cuando ya cargó todos sus datos.
  const blocked = firstBlockedNight(pendingStart.value, cell.iso, days.value, today)
  if (blocked) {
    blockedMessage.value = i18n.t('calendar.blockedNight', { date: shortDate(blocked) })
    return
  }

  store.checkIn = pendingStart.value
  store.checkOut = cell.iso
  pendingStart.value = null
  hovered.value = null
}

function onCellEnter(cell: RateCell): void {
  if (!pendingStart.value || !cell.selectable) return
  hovered.value = cell.iso
}

function clearSelection(): void {
  pendingStart.value = null
  hovered.value = null
  blockedMessage.value = ''
  store.checkIn = ''
  store.checkOut = ''
}

// ─── Navegación entre meses (1 solo mes visible, #629) ─────────────────────────

const canGoPrev = computed(() => {
  const now = parseIso(today)!
  return viewYear.value > now.y || (viewYear.value === now.y && viewMonth.value > now.m)
})

/** Tope de 11 meses hacia adelante: más allá no hay tarifas cargadas en ningún hotel real y cada
 *  mes visitado es una request. */
const canGoNext = computed(() => {
  const now = parseIso(today)!
  return (viewYear.value - now.y) * 12 + (viewMonth.value - now.m) < 11
})

function goPrev(): void {
  if (!canGoPrev.value) return
  if (viewMonth.value === 0) { viewYear.value -= 1; viewMonth.value = 11 }
  else viewMonth.value -= 1
}

function goNext(): void {
  if (!canGoNext.value) return
  if (viewMonth.value === 11) { viewYear.value += 1; viewMonth.value = 0 }
  else viewMonth.value += 1
}

// ─── Derivados ────────────────────────────────────────────────────────────────

const hasValidSelection = computed(() =>
  !!store.checkIn && !!store.checkOut && store.checkOut > store.checkIn,
)

/** Noches COMPUTED (no ref fijo). Bug histórico (mem `planning-calc-inclusive-selection-static-refs`):
 *  un `ref` que se actualiza a mano se desincroniza al cambiar la selección por teclado. */
const computedNights = computed(() => nightsBetween(store.checkIn, store.checkOut))

/** Total "desde" de la estadía. `null` si falta el precio de al menos una noche: un total parcial
 *  se lee como el precio final y después no cuadra. */
const stayTotal = computed(() => sumStayPrice(store.checkIn, store.checkOut, days.value))

// ─── Lookups i18n (type-safe, sin template strings que TS no puede verificar) ──

const MONTH_KEYS = [
  'calendar.months.jan', 'calendar.months.feb', 'calendar.months.mar', 'calendar.months.apr',
  'calendar.months.may', 'calendar.months.jun', 'calendar.months.jul', 'calendar.months.aug',
  'calendar.months.sep', 'calendar.months.oct', 'calendar.months.nov', 'calendar.months.dec',
] as const satisfies readonly BookingMessageKey[]

function monthKey(m: number): BookingMessageKey {
  return MONTH_KEYS[m]
}

const WEEKDAY_KEYS: Record<typeof weekdayShortKeys[number], BookingMessageKey> = {
  mon: 'calendar.weekdaysShort.mon',
  tue: 'calendar.weekdaysShort.tue',
  wed: 'calendar.weekdaysShort.wed',
  thu: 'calendar.weekdaysShort.thu',
  fri: 'calendar.weekdaysShort.fri',
  sat: 'calendar.weekdaysShort.sat',
  sun: 'calendar.weekdaysShort.sun',
}

function weekdayKey(w: typeof weekdayShortKeys[number]): BookingMessageKey {
  return WEEKDAY_KEYS[w]
}
</script>

<style scoped>
/* Sin CSS propio: `grid-cols-7` de Tailwind reparte el ancho disponible, así que el calendario
   entra igual en un iframe angosto (`?embed=1`) que en la ruta suelta. Las celdas son de alto
   fijo (h-12) para que el precio no descuadre la grilla cuando un día no tiene tarifa. */
</style>
