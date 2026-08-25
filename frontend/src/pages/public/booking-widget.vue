<template>
  <!--
    booking-widget.vue — Wrapper SPA del motor de reserva (F2 2.10 + 2.14-2.17, solmi-direct-booking).

    Orquesta los 6 steps (SearchStep → RoomsStep → UpsellsStep → GuestCheckoutStep → PayStep →
    ConfirmStep) usando el Pinia store `useBookingStore` (state machine). Layout mobile-first,
    embebible en iframe o como ruta `/book/:slug` (la Pieza 3 registra la ruta — este componente
    se crea sin tocar el router).

    Performance (D9): los steps se cargan lazy (defineAsyncComponent) salvo SearchStep, que es
    el único en el bundle inicial. Cada step se trae su chunk solo al mostrarse → sub-2s mobile
    4G (acceptance 2.10). CalendarView va dentro del bundle de SearchStep (solo se usa ahí).

    Header con nombre del hotel (resuelto por slug al montar) + stepper indicator (1-6 puntos)
    + switchers de idioma (task 2.14) y moneda (task 2.15). CTA del primer step es
    "Ver disponibilidad" (NO "Reservar") — reduce fricción (spec).

    MULTI-MONEDA (D10, task 2.15): al montar, intenta detectar geo-IP via Cloudflare Trace
    (`/cdn-cgi/trace`, endpoint público de CF en prod). Si encuentra el país → mapea a moneda
    y la setea como `currencyPreference`. Si no (dev local, sin CF) → fallback a la moneda del
    hotel (`chargeCurrency`), y el usuario puede cambiar manualmente en el switcher. El backend
    sigue siendo source of truth de la conversión (`/rates?currency=X` convierte server-side).

    Rutas hacia acá (NO registradas en esta pieza):
      - `/book/:slug` (Pieza 3 reemplaza el widget viejo por este)
      - `/h/:slug?booking=:id&token=:token` (post-redirect Stripe, F3 3.17 confirma)
  -->
  <div class="min-h-screen bg-surface" :style="accentCssVars">
    <!-- Header mobile-first: nombre del hotel + stepper + switchers.
         F2 2.13: cuando ?embed=1 (iframe en sitio externo), no se renderiza. El sitio host
         ya aporta branding propio; mostrar el header acá sería redundante y robaría espacio
         vertical dentro del iframe. El stepper pasa al main para no perder el contexto. -->
    <header v-if="!embed" class="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div class="max-w-md mx-auto px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1 flex items-center gap-2.5">
            <img
              v-if="hotelLogo"
              :src="hotelLogo"
              :alt="hotelName"
              class="h-8 w-8 rounded-lg object-cover shrink-0 border border-slate-200"
            />
            <div class="min-w-0">
              <p v-if="hotelLoading" class="text-sm text-text-muted">{{ t('wrapper.loading') }}</p>
              <h1 v-else-if="hotelName" class="font-black text-navy truncate">{{ hotelName }}</h1>
              <h1 v-else class="font-black text-navy">{{ t('wrapper.titleFallback') }}</h1>
            </div>
          </div>

          <!-- Switchers de idioma + moneda (tasks 2.14 + 2.15). Compactos para mobile.
               Idioma: dropdown de 3 opciones. Moneda: dropdown de las monedas comunes + la
               base del hotel. El selected se lee del estado reactivo del store. -->
          <div class="flex items-center gap-2 shrink-0">
            <label class="relative">
              <span class="sr-only">{{ t('wrapper.language') }}</span>
              <select
                v-model="localeValue"
                class="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-7 text-xs font-bold text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
                :aria-label="t('wrapper.language')"
              >
                <option v-for="opt in locales" :key="opt.code" :value="opt.code">
                  {{ opt.flag }} {{ opt.code.toUpperCase() }}
                </option>
              </select>
              <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted text-[10px]">▾</span>
            </label>

            <label class="relative">
              <span class="sr-only">{{ t('wrapper.currency') }}</span>
              <select
                :value="currencySelected"
                class="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-7 text-xs font-bold text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
                :aria-label="t('wrapper.currency')"
                @change="onCurrencyChange(($event.target as HTMLSelectElement).value)"
              >
                <option value="">
                  {{ hotelBaseCurrencyLabel }}
                </option>
                <option v-for="c in currencyOptionsForSelect" :key="c" :value="c">{{ c }}</option>
              </select>
              <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted text-[10px]">▾</span>
            </label>
          </div>
        </div>

        <!-- Stepper indicator: 6 puntos, el actual resaltado. Solo se muestra tras el step 0. -->
        <div v-if="store.currentStep > 0 || store.status === 'searching'" class="flex items-center gap-1.5 mt-3">
          <button
            v-for="(label, idx) in stepLabels"
            :key="label"
            type="button"
            class="flex items-center gap-1.5"
            :disabled="idx > store.currentStep"
            @click="store.goToStep(idx)"
          >
            <span
              :class="[
                'h-2 rounded-full transition-all',
                idx === store.currentStep ? 'w-6 bg-cyan'
                : idx < store.currentStep ? 'w-2 bg-cyan'
                : 'w-2 bg-slate-300',
              ]"
            />
          </button>
          <span class="ml-auto text-[11px] font-bold text-text-muted uppercase tracking-wide">
            {{ t('wrapper.step', { current: store.currentStep + 1, total: 6 }) }}
          </span>
        </div>
      </div>
    </header>

    <!-- Cuerpo: el step actual.
         F2 2.13: en embed mode el main ocupa todo el iframe (sin max-w-md centrado) y monta
         el stepper compacto arriba — el sitio host aporta branding, pero el usuario del widget
         embebido sigue necesitando saber en qué paso está. -->
    <main :class="embed ? 'max-w-full px-3 py-4' : 'max-w-md mx-auto px-4 py-6'">
      <!-- En embed mode, igual mostramos switchers arriba (sin branding del hotel). -->
      <div v-if="embed" class="flex items-center justify-end gap-2 mb-3">
        <label class="relative">
          <span class="sr-only">{{ t('wrapper.language') }}</span>
          <select
            v-model="localeValue"
            class="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-7 text-xs font-bold text-navy"
            :aria-label="t('wrapper.language')"
          >
            <option v-for="opt in locales" :key="opt.code" :value="opt.code">
              {{ opt.flag }} {{ opt.code.toUpperCase() }}
            </option>
          </select>
          <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted text-[10px]">▾</span>
        </label>
        <label class="relative">
          <span class="sr-only">{{ t('wrapper.currency') }}</span>
          <select
            :value="currencySelected"
            class="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-7 text-xs font-bold text-navy"
            :aria-label="t('wrapper.currency')"
            @change="onCurrencyChange(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ hotelBaseCurrencyLabel }}</option>
            <option v-for="c in currencyOptionsForSelect" :key="c" :value="c">{{ c }}</option>
          </select>
          <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted text-[10px]">▾</span>
        </label>
      </div>

      <div
        v-if="embed && (store.currentStep > 0 || store.status === 'searching')"
        class="flex items-center gap-1.5 mb-3"
      >
        <button
          v-for="(label, idx) in stepLabels"
          :key="label"
          type="button"
          class="flex items-center gap-1.5"
          :disabled="idx > store.currentStep"
          @click="store.goToStep(idx)"
        >
          <span
            :class="[
              'h-2 rounded-full transition-all',
              idx === store.currentStep ? 'w-6 bg-cyan'
              : idx < store.currentStep ? 'w-2 bg-cyan'
              : 'w-2 bg-slate-300',
            ]"
          />
        </button>
        <span class="ml-auto text-[11px] font-bold text-text-muted uppercase tracking-wide">
          {{ t('wrapper.step', { current: store.currentStep + 1, total: 6 }) }}
        </span>
      </div>

      <component :is="currentComponent" />

      <!-- Nav back (común a todos los steps salvo Search y Confirm). -->
      <div v-if="showBack" class="mt-6">
        <button
          type="button"
          class="text-sm font-bold text-text-muted hover:text-navy inline-flex items-center gap-1"
          :disabled="store.isSubmitting"
          @click="store.back()"
        >
          {{ t('wrapper.back') }}
        </button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore, hasStoredLocaleChoice, type BookingLocale } from '@/composables/useBookingI18n'
import { useTracking, initTracking } from '@/composables/useTracking'
import { PublicHotelService } from '@/services/PublicHotel.service'
import SearchStep from '@/components/booking/SearchStep.vue'
import { CurrencyCode } from '@/types/currency'

// Lazy-load de los steps > 0 para mantener el bundle inicial mínimo (D9 performance).
// Cada step se trae su chunk solo al llegar — SearchStep va en el bundle base.
const RoomsStep = defineAsyncComponent(() => import('@/components/booking/RoomsStep.vue'))
const UpsellsStep = defineAsyncComponent(() => import('@/components/booking/UpsellsStep.vue'))
const GuestCheckoutStep = defineAsyncComponent(() => import('@/components/booking/GuestCheckoutStep.vue'))
const PayStep = defineAsyncComponent(() => import('@/components/booking/PayStep.vue'))
const ConfirmStep = defineAsyncComponent(() => import('@/components/booking/ConfirmStep.vue'))

const route = useRoute()
const store = useBookingStore()
const i18n = useBookingI18nStore()
// `locale` es una ref reactiva: usamos storeToRefs para que no se unwrap-ee a valor plano
// (Pinia setup store auto-unwrapea refs al accederlas como `store.prop` en script, perdiendo
// la reactividad al leer `.value`). El `setLocale` sí lo sacamos directo (acción, no ref).
const { locale } = storeToRefs(i18n)
const { t, locales, setLocale } = i18n

const hotelName = ref('')
const hotelLogo = ref<string | null>(null)
const hotelLoading = ref(true)

// ─── Tema del Widget (Tarea 3.4, corrección 2026-08-25) ────────────────────────────────────
// Alcance decidido con el usuario: 3+ presets de solo ACENTO (el color de los botones/CTA),
// no un reskin de fondo claro/oscuro. Motivo: el widget mezcla los tokens propios del
// proyecto (navy/cyan, sí themeables vía CSS var) con paleta cruda de Tailwind
// (border-slate-200, bg-slate-50, rojos/verdes de error-éxito) que NO son tokens y no
// responden a ningún override — un "Oscuro" de fondo real dejaría cards/inputs en blanco
// sobre fondo oscuro, un reskin roto. Los colores semánticos (error/éxito) y estructurales
// (fondos, bordes) quedan IGUALES en todos los presets a propósito: lo único que cambia es
// la marca del hotel en su CTA principal — mismo criterio de diseño real, no una limitación
// disimulada.
//
// Mecanismo: mismo patrón que `hotel-landing.vue:themeCssVars` — CSS custom properties sobre
// los tokens de `main.css` @theme, que las utilities `bg-cyan`/`text-cyan`/`border-cyan` de
// Tailwind v4 heredan automáticamente. Solo se pisan `--color-cyan`/`--color-cyan-light`
// (los tokens que efectivamente pintan botones/links/foco en el widget) — `--color-navy`
// (headers/texto) queda fijo en todos los presets, por legibilidad y consistencia.
const ACCENT_PRESETS: Record<string, { cyan: string; cyanLight: string }> = {
  // 'navy' pisa el accent cyan por el navy de marca — es el default de `booking_config.theme`
  // (schema), así que un hotel que nunca tocó el selector pasa a verse así apenas se guarda
  // la fila (antes esto no tenía ningún efecto).
  navy: { cyan: '#0D2B4E', cyanLight: '#1A3A5C' },
  // 'cyan' = los colores de siempre del widget (sin cambios) — queda declarado para que
  // elegirlo en el panel tenga un resultado visible y predecible, no un no-op silencioso.
  cyan: { cyan: '#00B4D8', cyanLight: '#48CAE4' },
  teal: { cyan: '#117A65', cyanLight: '#1ABC9C' },
  // 'gold'/'coral' (antes 'white'/'dark' — renombrados en el panel el 2026-08-25: prometían
  // fondo claro/oscuro, lo que este alcance no hace). Una fila vieja con 'white'/'dark' cae al
  // default de abajo (sin override) — no rompe, simplemente no matchea ningún preset conocido.
  gold: { cyan: '#B7950B', cyanLight: '#D4AC0D' },
  coral: { cyan: '#E74C3C', cyanLight: '#EC7063' },
}

const accentPreset = ref<string | null>(null)
const accentCssVars = computed<Record<string, string>>(() => {
  const preset = accentPreset.value ? ACCENT_PRESETS[accentPreset.value] : undefined
  const vars: Record<string, string> = {}
  if (preset) {
    vars['--color-cyan'] = preset.cyan
    vars['--color-cyan-light'] = preset.cyanLight
  }
  return vars
})
// F4 4.1 (D13) — hotelId (UUID) resuelto desde el slug al montar. Se pasa a track() para
// que el backend persista el evento del funnel en tracking_events con target='internal'.
// Vacío hasta que cargue el hotel (los track()早期的 devuelven sin persistir — acceptable,
// los step view早期 pueden perderse si el fetch del hotel es lento).
const hotelIdForTracking = ref('')

// F2 2.13 — `?embed=1` indica que el widget se renderiza dentro de un <iframe> embebido en
// un sitio externo (cargado por /widget/loader.js). En ese modo se oculta el header ( branding
// redundante con el host) y el main ocupa todo el iframe. El stepper se mantiene arriba del
// contenido para no perder el contexto del paso actual.
const embed = computed(() => route.query.embed === '1')

/** Labels de los steps (tooltip/aria). El texto visible en el header es solo "Paso N / 6". */
const stepLabels = computed(() => [
  t('step.dates'),
  t('step.room'),
  t('step.extras'),
  t('step.guest'),
  t('step.pay'),
  t('step.confirm'),
])

// Step component según status. El mapeo está en STEP_INDEX del store; acá elegimos la vista.
const currentComponent = computed(() => {
  switch (store.status) {
    case 'idle':
    case 'searching':
      return SearchStep
    case 'selecting':
      return RoomsStep
    case 'upselling':
      return UpsellsStep
    case 'checkingout':
      return GuestCheckoutStep
    case 'paying':
    case 'failed':
      // 'failed' se queda en PayStep mostrando el error (para que el usuario reintente desde
      // el mismo lugar, no pierde el contexto del pago).
      return PayStep
    case 'confirmed':
      return ConfirmStep
  }
})

// Botón "Volver" visible salvo en Search (no hay previo) y en Confirm/failed-post-create
// (no se puede "volver" de un pago ya enviado al gateway).
const showBack = computed(() => {
  if (store.isSubmitting) return false
  return store.status === 'selecting'
    || store.status === 'upselling'
    || store.status === 'checkingout'
    || store.status === 'paying'
})

// slug desde la ruta. La ruta `/book/:slug` (Pieza 3) o embed via query. Fallback a query.slug
// para poder usarse en una ruta temporal `/h/:slug` con query ?widget=1 sin registrar path nuevo.
const slug = computed(() => {
  const param = typeof route.params.slug === 'string' ? route.params.slug : ''
  if (param) return param
  const q = route.query.slug
  return typeof q === 'string' ? q : ''
})

/**
 * Contrato de URL del deep-link: `?checkIn&checkOut&guests&rooms&children`, el mismo que genera
 * el buscador de la landing (`components/landing/HeroSearchBar.vue`).
 *
 * `guests` son ADULTOS (el store lo mapea a `adults` al crear la reserva) y `children` viaja
 * APARTE. Antes acá no se leía `children`: el link de la landing sí lo mandaba, pero el widget lo
 * tiraba, así que el huésped que había declarado niños en la landing los perdía al llegar al
 * motor — y las tarifas se consultaban con una ocupación física menor a la real.
 */
function readInitParams() {
  return {
    checkIn: typeof route.query.checkIn === 'string' ? route.query.checkIn : undefined,
    checkOut: typeof route.query.checkOut === 'string' ? route.query.checkOut : undefined,
    guests: typeof route.query.guests === 'string' ? Number(route.query.guests) : undefined,
    children: typeof route.query.children === 'string' ? Number(route.query.children) : undefined,
    rooms: typeof route.query.rooms === 'string' ? Number(route.query.rooms) : undefined,
  }
}

// ─── Switcher idioma ──────────────────────────────────────────────────────────

/** v-model del <select> de idioma. Setter delega al store para persistir en sessionStorage. */
const localeValue = computed<BookingLocale>({
  get: () => locale.value,
  set: (v) => setLocale(v),
})

// ─── Switcher moneda (D10, task 2.15) ──────────────────────────────────────────

/** Opciones del dropdown de moneda. Siempre incluimos el "auto" (value='') primero; el resto
 *  son las monedas del store.availableCurrencies menos la base (que ya está en el "auto"). */
const currencyOptionsForSelect = computed(() => {
  const base = store.chargeCurrency
  return store.availableCurrencies.filter((c) => c !== base)
})

/** Valor actual del select de moneda: '' (auto) si no hay preference, sino la preference. */
const currencySelected = computed(() => store.currencyPreference || '')

/** Label de la opción "auto" (value=''). Si ya sabemos la moneda del hotel, la mostramos
 *  ("USD · auto"); si no, solo "Auto". Sirve para que el usuario sepa qué pasa si no elige. */
const hotelBaseCurrencyLabel = computed(() => {
  const base = store.chargeCurrency
  if (base) return `${base} · auto`
  return 'Auto'
})

function onCurrencyChange(code: string): void {
  void store.setCurrency(code)
}

// (Re)init cuando cambia el slug (deep-link nuevo). Limpia el estado previo.
watch(slug, (s) => {
  if (!s) return
  store.reset()
  store.init(s, readInitParams())
}, { immediate: false })

// ─── Tracking client-side (F3 3.18, spec server-tracking) ─────────────────────────
// Complemento client-side del server-tracking. Dispara los mismos eventos que el backend
// (event_id = reservationId para dedup Meta/GA4). Los IDs del hotel se obtienen vía env vars
// (VITE_META_PIXEL_ID / VITE_GA4_MEASUREMENT_ID). Cuando exista endpoint público, cargarlos
// acá. Sin IDs → no-op silencioso (no rompe el widget).
const tracking = useTracking()
let trackingInitDone = false
let trackedSearch = false
let trackedSelect = false

// Watchers defensivos: cualquier error del tracking se traga (NO debe romper la reserva).
watch(() => store.status, (next) => {
  if (!trackingInitDone) return
  try {
    if (next === 'searching' && !trackedSearch) {
      trackedSearch = true
      tracking.track('search', { hotelId: hotelIdForTracking.value })
    }
    if (next === 'upselling' && !trackedSelect) {
      // Pasar a 'upselling' significa que confirmó el carrito (store.next() avanza a ese step).
      // Carrito puede tener varias líneas (Tarea 10): reportamos la primera como roomId
      // representativo y el subtotal COMBINADO como value — es lo que el huésped realmente
      // va a pagar por alojamiento, no solo una línea.
      trackedSelect = true
      tracking.track('select', {
        hotelId: hotelIdForTracking.value,
        roomId: store.cart[0]?.roomType,
        value: store.roomsSubtotal,
        currency: store.displayCurrency || undefined,
      })
    }
    if (next === 'paying') {
      tracking.track('form', { hotelId: hotelIdForTracking.value })
    }
  } catch { /* tracking failure NUNCA rompe el flujo */ }
})

// 'pay' se dispara cuando el store.reservation pasa a no-null (createBooking exitoso, justo
// antes del redirect off-site a Stripe). Esto captura el funnel step "intentó pagar".
watch(() => store.reservation, (res) => {
  if (!trackingInitDone || !res) return
  try {
    tracking.track('pay', {
      hotelId: hotelIdForTracking.value,
      eventId: res.reservationId,
      reservationId: res.reservationId,
      value: res.totalBreakdown.total,
      currency: store.chargeCurrency || undefined,
      optIn: true,
    })
  } catch { /* noop */ }
})

onMounted(async () => {
  const s = slug.value
  if (!s) {
    hotelLoading.value = false
    return
  }
  store.init(s, readInitParams())

  // Inicializar tracking al montar. IDs desde env vars globales (cuando exista endpoint público
  // /api/public/hotels/:slug/tracking-config, cargar acá y pasar a initTracking).
  initTracking({
    metaPixelId: import.meta.env.VITE_META_PIXEL_ID ?? null,
    ga4MeasurementId: import.meta.env.VITE_GA4_MEASUREMENT_ID ?? null,
  })
  trackingInitDone = true

  // Geo-IP best-effort: si detecta el país via Cloudflare Trace, setea moneda inicial.
  // No esperamos esto para no bloquear el render del widget — el probe corre en paralelo
  // con la carga del hotel y solo aplica si el usuario todavía no tocó el switcher.
  void probeGeoCurrency().then((cur) => {
    if (cur && !store.currencyPreference) void store.setCurrency(cur)
  })
  try {
    const hotel = await PublicHotelService.getBySlug(s)
    hotelName.value = hotel.name
    hotelLogo.value = hotel.logo
    hotelIdForTracking.value = hotel.id
    // F4 4.1 — Disparamos 'view' DESPUÉS de resolver el hotel para que el POST server-side
    // lleve el hotelId correcto (sin eso, el primer step del funnel no se persistiría).
    try {
      tracking.track('view', { hotelId: hotel.id })
    } catch { /* noop */ }

    // Tarea 3.4 (corrección 2026-08-25) — defaults de `booking_config` (Idioma/Moneda del
    // panel "Configuración del Widget"). Ambos SOLO pisan el fallback automático, nunca una
    // elección real del huésped — mismo criterio que ya usa `probeGeoCurrency` de abajo
    // (`!store.currencyPreference`) para no pisarse con lo que el huésped ya tocó.
    if (hotel.widgetDefaultLanguage && !hasStoredLocaleChoice()) {
      i18n.setLocale(hotel.widgetDefaultLanguage as BookingLocale)
    }
    if (hotel.widgetDefaultCurrency && !store.currencyPreference) {
      void store.setCurrency(hotel.widgetDefaultCurrency)
    }
    accentPreset.value = hotel.widgetAccentPreset ?? null

    // Tarea 3.4 (corrección 2026-08-25) — defaults de `booking_config` (Idioma/Moneda del
    // panel "Configuración del Widget"). Ambos SOLO pisan el fallback automático, nunca una
    // elección real del huésped — mismo criterio que ya usa `probeGeoCurrency` de abajo
    // (`!store.currencyPreference`) para no pisarse con lo que el huésped ya tocó.
  } catch {
    // Si el hotel no carga, no bloqueamos el widget — el usuario igual puede buscar. El
    // header queda con el fallback "Reservá tu estadía".
    hotelName.value = ''
  } finally {
    hotelLoading.value = false
  }
})

/**
 * Detecta la moneda preferida del usuario via geo-IP. Best-effort, no bloqueante:
 *   - Cloudflare expone `/cdn-cgi/trace` públicamente en sitios CF (devuelve texto con
 *     `loc=XX`). Mapeamos country → currency. Funciona en prod, NO en dev (sin CF).
 *   - Si no hay CF (dev local), o el endpoint responde algo raro, devuelve null → fallback
 *     a la moneda del hotel (chargeCurrency), y el usuario elige manual.
 *
 * Mapping: ISO 3166-1 alpha-2 → ISO 4217. Lista limitada a los países comunes en LATAM/caribe
 * (target de SOLMI OS); el resto → null (el caller cae a chargeCurrency). */
async function probeGeoCurrency(): Promise<string | null> {
  try {
    const res = await fetch('/cdn-cgi/trace', { cache: 'no-store' })
    if (!res.ok) return null
    const text = await res.text()
    const match = /\nloc=([A-Z]{2})\b/.exec('\n' + text)
    if (!match) return null
    return COUNTRY_TO_CURRENCY[match[1]] ?? null
  } catch {
    return null
  }
}

/** Mapping country code → currency. Para no importar una lib de 200 entradas, limitamos a
 *  los países con mayor probabilidad de turistas hacia hoteles LATAM/caribe. Cualquier otro
 *  país → null (fallback a la currency del hotel). */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: CurrencyCode.USD, DO: CurrencyCode.DOP,
  ES: CurrencyCode.EUR, DE: CurrencyCode.EUR, FR: CurrencyCode.EUR, IT: CurrencyCode.EUR, PT: CurrencyCode.EUR, NL: CurrencyCode.EUR, IE: CurrencyCode.EUR, AT: CurrencyCode.EUR, BE: CurrencyCode.EUR, FI: CurrencyCode.EUR, GR: CurrencyCode.EUR,
  GB: CurrencyCode.GBP, CH: CurrencyCode.CHF,
  BR: CurrencyCode.BRL,
  AR: CurrencyCode.ARS, CL: CurrencyCode.CLP, CO: CurrencyCode.COP, PE: CurrencyCode.PEN, UY: 'UYU', PY: 'PYG', BO: 'BOB', VE: 'VES', EC: CurrencyCode.USD, CR: 'CRC', PA: CurrencyCode.USD, GT: 'GTQ', HN: 'HNL', NI: 'NIO', SV: CurrencyCode.USD,
  CA: CurrencyCode.CAD,
  MX: CurrencyCode.MXN,
  JP: 'JPY', CN: 'CNY',
}
</script>
