<template>
  <!--
    RateCalendar — campo "Fechas" del buscador de la landing pública (`/h/:slug`).

    NO reusa `components/booking/CalendarView.vue`: ese es del widget embebible, lee/escribe
    directo el store `useBooking` y no muestra precios ni disponibilidad. Acá el huésped todavía
    está decidiendo CUÁNDO viene, así que cada celda tiene que decirle cuánto sale esa noche y
    si hay lugar (vista de rango conectada, Baymard/NN-g).

    Semántica del rango (idéntica al widget, para que el traspaso por query string no se
    desfase una noche): click 1 = llegada, click 2 = SALIDA tal cual. Las noches pagadas son
    [checkIn, checkOut-1] → N celdas pintadas como noche = N noches, y el checkout es el día
    siguiente a la última noche. Las noches se calculan siempre con un `computed` sobre las
    fechas, nunca con un `ref` que se actualiza a mano (mem
    `planning-calc-inclusive-selection-static-refs`).

    Datos: se pide UN mes por vez (`monthBounds` recorta a hoy y al tope de 90 días del
    endpoint) y se cachea por mes; al navegar solo se pide lo que falta.

    DEGRADACIÓN: si el endpoint falla o el hotel no tiene tarifas cargadas, el calendario SIGUE
    sirviendo para elegir fechas — solo que sin precios y sin bloquear días. Nunca queda en
    blanco ni impide reservar (regla del proyecto: el estado vacío cubre lista vacía Y error).
  -->
  <button
    ref="anchor"
    type="button"
    :aria-expanded="open"
    aria-haspopup="dialog"
    class="group flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-left transition-colors flex-1 basis-[240px] min-w-[220px] hover:bg-surface cursor-pointer"
    :class="open ? 'bg-surface' : ''"
    @click="toggle"
  >
    <span class="h-5 w-5 shrink-0 text-navy/40 transition-colors group-hover:text-navy/70 [&_svg]:h-full [&_svg]:w-full" v-html="ICON_CALENDAR" />
    <span class="flex min-w-0 flex-1 items-center gap-2">
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Llegada</span>
        <span class="truncate text-sm font-extrabold" :class="checkIn ? 'text-navy' : 'text-text-muted'">
          {{ checkIn ? formatShortDate(checkIn) : 'Elegir' }}
        </span>
      </span>
      <span class="shrink-0 text-text-muted" aria-hidden="true">→</span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Salida</span>
        <span class="truncate text-sm font-extrabold" :class="checkOut ? 'text-navy' : 'text-text-muted'">
          {{ checkOut ? formatShortDate(checkOut) : 'Elegir' }}
        </span>
      </span>
    </span>
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="panel"
      role="dialog"
      aria-label="Elegir fechas de la estadía"
      :style="panelStyle"
      class="fixed z-[120] overflow-auto rounded-2xl border border-border bg-white p-4 shadow-2xl"
    >
      <!-- Navegación de mes -->
      <div class="mb-3 flex items-center justify-between">
        <button
          type="button"
          :disabled="!canGoPrev"
          aria-label="Mes anterior"
          class="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-navy transition-colors hover:bg-surface-dark disabled:cursor-not-allowed disabled:opacity-25"
          @click="goPrev"
        ><span aria-hidden="true">‹</span></button>
        <span class="text-sm font-black text-navy" aria-live="polite">
          {{ MONTH_LABELS[viewMonth] }} {{ viewYear }}
        </span>
        <button
          type="button"
          :disabled="!canGoNext"
          aria-label="Mes siguiente"
          class="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-navy transition-colors hover:bg-surface-dark disabled:cursor-not-allowed disabled:opacity-25"
          @click="goNext"
        ><span aria-hidden="true">›</span></button>
      </div>

      <div class="mb-1 grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wide text-text-muted">
        <span v-for="w in WEEKDAY_LABELS" :key="w">{{ w }}</span>
      </div>

      <div class="relative grid grid-cols-7 gap-0.5">
        <template v-for="(cell, i) in cells" :key="cell.iso || `blank-${i}`">
          <span v-if="!cell.inMonth" class="h-14" />
          <button
            v-else
            type="button"
            :disabled="!cell.selectable"
            :aria-label="cellAriaLabel(cell)"
            :aria-pressed="cell.iso === checkIn || cell.iso === checkOut"
            :class="cellClass(cell)"
            @click="onCellClick(cell)"
            @mouseenter="onCellHover(cell)"
            @focus="onCellHover(cell)"
          >
            <span class="text-sm font-black leading-none" :class="cell.soldOut ? 'line-through decoration-2' : ''">{{ cell.day }}</span>
            <!-- Sin precio por día: distintos tipos de habitación cotizan distinto, y un "desde"
                 agregado bajo el día se leía como EL precio de la habitación que el huésped
                 termina eligiendo. El precio real por tipo se muestra recién al elegir habitación. -->
            <span v-if="cell.soldOut" class="mt-1 text-[9px] font-bold uppercase leading-none">Lleno</span>
          </button>
        </template>

        <span
          v-if="loading"
          class="absolute inset-0 grid place-items-center rounded-xl bg-white/70 text-[11px] font-bold text-text-muted"
        >Cargando tarifas…</span>
      </div>

      <!-- Leyenda: un día sin lugar tiene que leerse como "no hay lugar", no como "se rompió". -->
      <div v-if="hasAvailabilityData" class="mt-3 flex items-center gap-3 text-[10px] text-text-muted">
        <span class="flex items-center gap-1.5">
          <span class="h-3 w-3 rounded-sm bg-slate-200" aria-hidden="true" />
          Sin disponibilidad
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-3 w-3 rounded-sm bg-cyan" aria-hidden="true" />
          Tu estadía
        </span>
      </div>

      <!-- Sin precios: se avisa, pero NO se bloquea la elección de fechas. -->
      <p
        v-if="pricesUnavailable"
        class="mt-3 rounded-xl bg-surface px-3 py-2 text-[11px] font-semibold text-text-secondary"
      >
        No pudimos cargar las tarifas de este mes. Podés elegir las fechas igual y ver el precio
        en el siguiente paso.
      </p>

      <!-- Estadía mínima del día de entrada: se avisa ANTES, no después de reservar. -->
      <p
        v-if="minStayMessage"
        class="mt-3 rounded-xl bg-gold/10 px-3 py-2 text-[11px] font-bold text-navy"
        role="alert"
      >{{ minStayMessage }}</p>

      <p
        v-else-if="blockedMessage"
        class="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[11px] font-bold text-danger"
        role="alert"
      >{{ blockedMessage }}</p>

      <!-- Resumen de la selección -->
      <div class="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span class="min-w-0 text-xs">
          <template v-if="nights > 0">
            <span class="font-black text-navy">{{ nights }} {{ nights === 1 ? 'noche' : 'noches' }}</span>
            <span v-if="stayTotal !== null" class="ml-2 tabular-nums text-text-secondary">
              desde {{ money(stayTotal) }}
            </span>
          </template>
          <span v-else class="text-text-muted">
            {{ checkIn ? 'Elegí la fecha de salida' : 'Elegí la fecha de llegada' }}
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-2">
          <button
            v-if="checkIn || checkOut"
            type="button"
            class="cursor-pointer rounded-lg px-2 py-1 text-xs font-bold text-text-muted transition-colors hover:text-navy"
            @click="clearSelection"
          >Limpiar</button>
          <button
            type="button"
            class="cursor-pointer rounded-full bg-navy px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-navy-light"
            @click="close"
          >Listo</button>
        </span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'
import { BookingService } from '@/services/Booking.service'
import {
  MONTH_LABELS,
  WEEKDAY_LABELS,
  addDays,
  buildMonthCells,
  firstBlockedNight,
  formatMoney,
  formatShortDate,
  minStayFor,
  monthBounds,
  nightsBetween,
  parseIso,
  sumStayPrice,
  todayIso,
  type RateCell,
} from '@/utils/rate-calendar'
import type { CalendarDay } from '@/types/booking'

// Raíz múltiple (trigger + Teleport) — ver OccupancySelector.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  hotelSlug: string
  checkIn: string
  checkOut: string
  /** Ocupación física por habitación (adultos + niños): filtra por capacidad y elige la fila de
   *  tarifa por `occupancy`. Cambiarla invalida los precios cacheados. */
  guests: number
  /** Moneda de display. Si se omite, el backend responde en la del hotel. */
  currency?: string
}>()

const emit = defineEmits<{
  'update:checkIn': [value: string]
  'update:checkOut': [value: string]
  /** El padre no tiene los datos del calendario, así que la validación de estadía mínima /
   *  noches bloqueadas viaja hacia arriba para poder frenar el submit del buscador. */
  validity: [payload: { ok: boolean; message: string }]
}>()

const { open, anchor, panel, panelStyle, toggle, close } = useAnchoredPanel(360)

const today = todayIso()

// ─── Datos del endpoint ───────────────────────────────────────────────────────
/** iso → día. Acumula todos los meses ya cargados (una request por mes, no 90 días de una). */
const days = ref(new Map<string, CalendarDay>())
/** Meses ya resueltos con éxito ('2026-7'). Un mes que falló NO entra: se reintenta al volver. */
const loadedMonths = ref(new Set<string>())
const inFlight = new Set<string>()
const loading = ref(false)
/** Meses SIN precios utilizables (la request falló, o el hotel no tiene tarifas cargadas ahí).
 *  Es por mes y no un flag global: si agosto tiene precios y septiembre no, volver a agosto tiene
 *  que dejar de mostrar el aviso. */
const monthsWithoutPrices = ref(new Set<string>())
const displayCurrency = ref(props.currency ?? 'USD')

const startMonth = parseIso(props.checkIn) ?? parseIso(today)!
const viewYear = ref(startMonth.y)
const viewMonth = ref(startMonth.m)

function monthKey(y: number, m: number): string {
  return `${y}-${m}`
}

async function loadMonth(y: number, m: number): Promise<void> {
  const key = monthKey(y, m)
  if (loadedMonths.value.has(key) || inFlight.has(key)) return
  const bounds = monthBounds(y, m, today)
  // Mes íntegramente pasado: no hay nada que pedir (y el backend no tiene por qué enterarse).
  if (!bounds) {
    loadedMonths.value.add(key)
    return
  }
  inFlight.add(key)
  loading.value = true
  try {
    const res = await BookingService.getCalendar(props.hotelSlug, {
      from: bounds.from,
      to: bounds.to,
      guests: props.guests,
      currency: props.currency,
    })
    const next = new Map(days.value)
    for (const day of res.days) next.set(day.date, day)
    days.value = next
    displayCurrency.value = res.currency || displayCurrency.value
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

onMounted(() => void loadMonth(viewYear.value, viewMonth.value))
watch([viewYear, viewMonth], ([y, m]) => void loadMonth(y, m))

// El precio y la disponibilidad dependen de la ocupación → cambiarla invalida TODO lo cacheado.
watch(() => props.guests, () => {
  days.value = new Map()
  loadedMonths.value = new Set()
  monthsWithoutPrices.value = new Set()
  void loadMonth(viewYear.value, viewMonth.value)
})

// Abrir el panel sobre el mes de la llegada ya elegida (no sobre el mes actual).
watch(open, (isOpen) => {
  if (!isOpen) return
  const p = parseIso(props.checkIn)
  if (p && (p.y !== viewYear.value || p.m !== viewMonth.value)) {
    viewYear.value = p.y
    viewMonth.value = p.m
  }
})

// ─── Grilla ───────────────────────────────────────────────────────────────────

/** Primer click a la espera del segundo (llegada tentativa) + celda hovereada para el preview. */
const pendingStart = ref<string | null>(null)
const hovered = ref<string | null>(null)
const blockedMessage = ref('')

const cells = computed(() => buildMonthCells(viewYear.value, viewMonth.value, { today, days: days.value }))

const hasAvailabilityData = computed(() => days.value.size > 0)

/** ¿El mes que se está viendo quedó sin precios? (por fallo o porque el hotel no cargó tarifas). */
const pricesUnavailable = computed(() =>
  monthsWithoutPrices.value.has(monthKey(viewYear.value, viewMonth.value)),
)

/** Rango a pintar: noches [start, end] + la celda de salida marcada aparte (no es una noche
 *  pagada). Sale del hover mientras se elige, o de la selección confirmada. */
const range = computed<{ start: string; end: string; checkout: string } | null>(() => {
  if (pendingStart.value) {
    if (hovered.value && hovered.value > pendingStart.value) {
      return { start: pendingStart.value, end: addDays(hovered.value, -1), checkout: hovered.value }
    }
    return { start: pendingStart.value, end: pendingStart.value, checkout: '' }
  }
  if (props.checkIn && props.checkOut && props.checkOut > props.checkIn) {
    return { start: props.checkIn, end: addDays(props.checkOut, -1), checkout: props.checkOut }
  }
  if (props.checkIn) return { start: props.checkIn, end: props.checkIn, checkout: '' }
  return null
})

function money(value: number): string {
  return formatMoney(value, displayCurrency.value)
}

function cellAriaLabel(cell: RateCell): string {
  const date = formatShortDate(cell.iso)
  if (cell.past) return `${date}, fecha pasada`
  if (cell.soldOut) return `${date}, sin disponibilidad`
  const price = cell.price !== null ? `, desde ${money(cell.price)}` : ''
  return `${date}${price}`
}

/** ¿Es una de las noches PAGADAS del rango? (el día de salida no lo es). */
function isNight(cell: RateCell): boolean {
  const r = range.value
  return !!(r && cell.iso >= r.start && cell.iso <= r.end)
}

function cellClass(cell: RateCell): string {
  const r = range.value
  const night = isNight(cell)
  const isStart = !!(r && cell.iso === r.start)
  const isCheckout = !!(r && r.checkout && cell.iso === r.checkout)

  const base = 'relative flex h-14 flex-col items-center justify-center rounded-xl transition select-none'
  if (cell.past) return `${base} cursor-not-allowed text-text-muted/40`
  // Sold-out: fondo sólido + número tachado. Un gris tenue solo se lee como "deshabilitado por
  // error"; esto se lee como "acá no hay lugar".
  if (cell.soldOut) return `${base} cursor-not-allowed bg-slate-200 text-text-muted`

  const parts = [base, 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/50']
  if (isStart) parts.push('bg-cyan font-black text-white')
  else if (night) parts.push('bg-cyan/20 text-navy')
  else if (isCheckout) parts.push('ring-2 ring-cyan text-navy')
  else parts.push('text-navy hover:bg-cyan/10')
  if (cell.today && !night && !isCheckout) parts.push('ring-1 ring-navy/30')
  return parts.join(' ')
}

// ─── Selección ────────────────────────────────────────────────────────────────

function onCellClick(cell: RateCell): void {
  if (!cell.selectable) return
  blockedMessage.value = ''

  // Sin inicio pendiente, o click igual/anterior al inicio → esa celda pasa a ser la llegada.
  if (!pendingStart.value || cell.iso <= pendingStart.value) {
    pendingStart.value = cell.iso
    hovered.value = cell.iso
    emit('update:checkIn', cell.iso)
    emit('update:checkOut', '')
    return
  }

  // Click posterior = SALIDA tal cual (no "última noche + 1"). Antes de confirmar, ninguna de
  // las noches [checkIn, checkOut-1] puede estar cerrada: armar el rango "por arriba" de una
  // noche llena falla recién al final del wizard.
  const blocked = firstBlockedNight(pendingStart.value, cell.iso, days.value, today)
  if (blocked) {
    blockedMessage.value = `No hay disponibilidad la noche del ${formatShortDate(blocked)}. Elegí otra salida.`
    return
  }

  emit('update:checkIn', pendingStart.value)
  emit('update:checkOut', cell.iso)
  pendingStart.value = null
  hovered.value = null
}

function onCellHover(cell: RateCell): void {
  if (!pendingStart.value || !cell.selectable) return
  hovered.value = cell.iso
}

function clearSelection(): void {
  pendingStart.value = null
  hovered.value = null
  blockedMessage.value = ''
  emit('update:checkIn', '')
  emit('update:checkOut', '')
}

// ─── Navegación ───────────────────────────────────────────────────────────────

const canGoPrev = computed(() => {
  const now = parseIso(today)!
  return viewYear.value > now.y || (viewYear.value === now.y && viewMonth.value > now.m)
})

/** Tope de 11 meses hacia adelante: más allá no hay tarifas cargadas en ningún hotel real y
 *  cada mes visitado es una request. */
const canGoNext = computed(() => {
  const now = parseIso(today)!
  const monthsAhead = (viewYear.value - now.y) * 12 + (viewMonth.value - now.m)
  return monthsAhead < 11
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

// ─── Derivados y validación ───────────────────────────────────────────────────

/** COMPUTED, nunca un ref actualizado a mano (mem `planning-calc-inclusive-selection-static-refs`). */
const nights = computed(() => nightsBetween(props.checkIn, props.checkOut))

const stayTotal = computed(() => sumStayPrice(props.checkIn, props.checkOut, days.value))

const requiredMinStay = computed(() => (props.checkIn ? minStayFor(props.checkIn, days.value) : 0))

const minStayMessage = computed(() => {
  const min = requiredMinStay.value
  if (min <= 0) return ''
  if (nights.value === 0) {
    return `El ${formatShortDate(props.checkIn)} exige una estadía mínima de ${min} noches.`
  }
  if (nights.value < min) {
    return `Estadía mínima de ${min} noches entrando el ${formatShortDate(props.checkIn)}. Elegiste ${nights.value}.`
  }
  return ''
})

watch(
  [nights, minStayMessage],
  ([n, msg]) => {
    if (n > 0 && msg) emit('validity', { ok: false, message: msg })
    else emit('validity', { ok: true, message: '' })
  },
  { immediate: true },
)

const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/></svg>'
</script>

<style scoped>
/* Sin CSS propio. La grilla es `grid-cols-7` de Tailwind y el panel se posiciona con estilos
   inline calculados por useAnchoredPanel (fixed: el hero es overflow-hidden). */
</style>
