<template>
  <!--
    RoomsStep.vue — Step 1 del widget (F2 2.9 + D11 urgencia real, solmi-direct-booking).
    Renderiza los room types disponibles de `ratesResponse.roomTypes`. Cada tarjeta muestra:
      - nombre + "From $X total" (fromPrice = TOTAL de la estadía, no por noche)
      - desglose de noches + ITBIS
      - badge de urgencia REAL según availableCount (D11):
          ≤1 → "Última disponible" (rojo)
          ≤3 → "Pocas habitaciones a este precio" (ámbar)
          >3 → sin badge (NEVER falsificar urgencia — destruye confianza)

    ─── Requerimiento 9 (Cantidad de habitaciones, 2026-09-03) — huéspedes ≠ habitaciones ────
    El composer (adultos + niños + edades, ver `composables/useGuestComposer.ts`) es puro ESTADO
    LOCAL por tarjeta (`composerState`), completamente separado del carrito: subir/bajar el
    stepper de adultos o niños NUNCA toca `store.cart` — solo lo hace el click explícito en
    "Agregar esta habitación" (`addComposedRoom`). Cada click agrega UNA unidad real: mismo tipo +
    misma composición dos veces → SUMA cantidad a la MISMA línea (`cartLineKeyForComposition`
    identifica la línea por tipo+adultos+edades ordenadas); tipo/composición distinta → línea
    aparte. `store.removeCartLine(key)` quita SOLO esa línea, el resto del carrito no se toca.
    El resumen al pie del step usa `store.cartTotalRooms`/`cartTotalGuests` — SIEMPRE derivados
    del carrito real, nunca de un contador aparte que pudiera desincronizarse.

    ─── Matriz de ocupaciones (`roomType.occupancies`, precio por "para N") ──────────────────
    El composer traduce la composición elegida a un NÚMERO de ocupación (`chargeableOccupancy`,
    adultos + niños con plaza) y busca ESA fila en `roomType.occupancies` — la matriz sigue siendo
    "una fila por ocupación" puertas adentro (mismo backend, `occupancy-matrix.ts`), pero el
    huésped nunca la ve ni la usa como selector: no elige entre filas, arma su composición y el
    número sale solo. Las ocupaciones que el hotel NO puede vender siguen existiendo en la
    respuesta — REGLA DEL DUEÑO: si la composición actual resuelve a una de ellas, se muestra
    DESHABILITADA y con el motivo, nunca oculta.

    DEGRADACIÓN: si `occupancies` no viene (backend viejo, respuesta cacheada en CDN, widget
    embebido contra otra versión), el composer sigue funcionando con el precio único `fromPrice`
    del tipo. El campo es opcional a propósito.

    El desglose de impuestos viene pre-computado por el backend (roomType.taxBreakdown). Para
    promo, el recálculo lo hace el backend al crear la reserva — acá solo mostramos el base.
    Todos los textos via i18n (es/en/pt, task 2.14).
  -->
  <section class="space-y-4">
    <header class="space-y-1">
      <h2 class="text-xl font-black text-navy">{{ t('rooms.title') }}</h2>
      <p class="text-sm text-text-muted">
        {{ t('rooms.nightsSuffix', { count: store.nights }) }}
        <span v-if="store.displayCurrency"> · {{ t('rooms.pricesIn', { currency: store.displayCurrency }) }}</span>
      </p>
      <!--
        La moneda elegida no siempre se puede servir: si no hay tasa cargada, el backend devuelve
        los precios en su moneda base. Avisarlo evita que el huésped crea que vio un precio
        convertido (y que después Stripe le cobre en otra moneda).
      -->
      <p v-if="store.currencyUnavailable" class="text-xs font-bold text-warning">
        {{ t('rooms.currencyUnavailable', { wanted: store.currencyPreference, currency: store.displayCurrency }) }}
      </p>
      <!-- F3 3.16 — Aggregate score compacto del widget. Solo se muestra si el hotel tiene
           reviews publicadas y el bloque ReviewsBlock de la landing le pasó el aggregate.
           El widget recibe `reviews` por props desde el wrapper (booking-widget.vue pasa el
           fetch del ReviewsBlock de la landing al widget cuando ambos viven en /book/:slug).
           Si no hay reviews (count=0), AggregateScore se omite. -->
      <div v-if="showAggregateCompact" class="pt-1">
        <AggregateScore
          :aggregate="reviewsAggregate"
          variant="inline"
        />
        <MultiChannelBadges
          v-if="hasExternalSources"
          :aggregate="reviewsAggregate"
          variant="compact"
          class="mt-1.5"
        />
      </div>
    </header>

    <div v-if="availableRooms.length === 0" class="text-center py-10 px-4">
      <div class="mb-2 flex justify-center text-navy/30"><Icon name="calendar" :size="40" /></div>
      <p class="font-bold text-navy">{{ t('rooms.empty') }}</p>
      <p class="text-sm text-text-muted mt-1">{{ t('rooms.emptyHint') }}</p>
    </div>

    <ul v-else class="space-y-3">
      <li v-for="rt in availableRooms" :key="rt.id">
        <article
          :class="[
            'rounded-2xl border-2 bg-white p-4 shadow-card transition',
            cartHasType(rt.id) ? 'border-cyan ring-2 ring-cyan/20' : 'border-slate-200',
          ]"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="font-black text-navy capitalize">{{ prettify(rt.name) }}</h3>
              <p v-if="rt.availableCount > 0" class="text-xs text-text-muted mt-0.5">
                {{ availableLabel(rt.availableCount) }}
              </p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-xs text-text-muted">{{ t('rooms.fromLabel') }}</p>
              <p class="text-lg font-black text-navy tabular-nums">{{ formatPrice(rt.fromPrice, store.displayCurrency) }}</p>
              <p class="text-[11px] text-text-muted">{{ t('rooms.totalSuffix') }} · {{ perNight(rt) }}/{{ t('rooms.perNight') }}</p>
            </div>
          </div>

          <!--
            RÉGIMEN — catálogo real configurable por hotel (tasks.md 2.2/2.4, `meal_plans`).
            "Sólo alojamiento" es la base implícita (siempre disponible, sin costo, no tiene fila
            en la DB). Los otros 3 códigos fijos vienen de `store.mealPlans` (solo los `active`
            llegan del backend — el resto se pinta deshabilitado con el motivo, mismo criterio
            que la matriz de ocupación: nunca ocultar).
            `priceMode:'per_person_per_night'` se muestra informativo con su precio ("Próximamente")
            — todavía NO es seleccionable ni afecta el cobro (ver alcance documentado en el plan:
            integrarlo al carrito exige la misma revalidación server-side que 1.6).
          -->
          <div class="mt-3">
            <p class="text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ t('rooms.board.label') }}</p>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <span class="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-[11px] font-bold text-white">
                <span aria-hidden="true">●</span>{{ t('rooms.board.roomOnly') }}
              </span>
              <span
                v-for="plan in boardPlanRows"
                :key="plan.code"
                :class="[
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
                  plan.state === 'included'
                    ? 'bg-navy text-white'
                    : plan.state === 'upcoming'
                      ? 'border border-cyan/40 bg-cyan/10 text-navy'
                      : 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400',
                ]"
                :title="plan.title"
                :aria-disabled="plan.state === 'unavailable' ? 'true' : undefined"
              >
                <span aria-hidden="true">{{ plan.state === 'included' ? '●' : '○' }}</span>{{ plan.label }}
                <span v-if="plan.state === 'upcoming'" class="ml-0.5 text-[9px] font-black uppercase text-cyan">{{ t('rooms.board.comingSoon') }}</span>
              </span>
            </div>
          </div>

          <!--
            Feature adultos+niños+edades (2026-09-02) — reemplaza la matriz "Para 1/Para 2" por
            un composer: adultos + niños + edad de CADA niño. La ocupación a cotizar sale de
            `resolveChildComposition` (utils/child-composition.ts, espejo del backend) contra
            `store.childPolicy`. Cada click en "Agregar esta habitación" agrega UNA línea al
            carrito con ESA composición exacta — así una familia con 2 habitaciones puede darle
            a cada una sus propios niños (confirmado con el dueño del producto).

            REGLA DEL DUEÑO (se mantiene): la composición actual, si no se puede vender, se
            muestra iguial — deshabilitada y con el motivo — nunca oculta.
          -->
          <div class="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-bold text-navy">{{ t('rooms.guests.adults') }}</span>
              <Stepper
                :model-value="composer(rt).adults"
                :min="1"
                :max="rt.maxAdults ?? rt.capacity"
                :label="`${prettify(rt.name)} · ${t('rooms.guests.adults')}`"
                @update:model-value="setAdults(rt, $event)"
              />
            </div>
            <div v-if="store.childPolicy.acceptChildren" class="flex items-center justify-between gap-3">
              <span class="text-sm font-bold text-navy">{{ t('rooms.guests.children') }}</span>
              <Stepper
                :model-value="composer(rt).ages.length"
                :min="0"
                :max="rt.maxChildren ?? rt.capacity"
                :label="`${prettify(rt.name)} · ${t('rooms.guests.children')}`"
                @update:model-value="setChildrenCount(rt, $event)"
              />
            </div>
            <!-- Un desplegable de edad POR NIÑO — confirmado con el dueño: "si elegís 2 niños,
                 pregunta la edad del primero y del segundo aparte". -->
            <div v-if="composer(rt).ages.length > 0" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label v-for="(age, i) in composer(rt).ages" :key="i" class="block">
                <span class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  {{ t('rooms.guests.childAge', { n: i + 1 }) }}
                </span>
                <select
                  :value="age"
                  :aria-label="t('rooms.guests.childAge', { n: i + 1 })"
                  class="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                  @change="setChildAge(rt, i, +($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="a in maxChildAgeOptions" :key="a" :value="a - 1">{{ a - 1 }}</option>
                </select>
              </label>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <span :data-occupancy="composition(rt).chargeableOccupancy">
                <template v-if="capacityBlockReason(rt)">
                  <span class="block text-[11px] font-bold text-slate-500">{{ maxLabel(capacityBlockReason(rt)!) }}</span>
                </template>
                <template v-else-if="matchedRow(rt) === null || matchedRow(rt)!.available">
                  <span class="block text-sm font-black tabular-nums text-navy">{{ formatPrice(composedPrice(rt), store.displayCurrency) }}</span>
                  <span class="block text-[11px] tabular-nums text-text-muted">{{ t('rooms.totalSuffix') }} · {{ formatPrice(composedPricePerNight(rt), store.displayCurrency) }}/{{ t('rooms.perNight') }}</span>
                </template>
                <span v-else class="block text-[11px] font-bold text-slate-500">{{ unavailableLabel(matchedRow(rt)!.unavailableReason) }}</span>
              </span>
              <button
                type="button"
                :disabled="!canAddComposition(rt)"
                class="shrink-0 rounded-full bg-cyan px-4 py-2 text-xs font-black text-white transition hover:bg-cyan/90 disabled:cursor-not-allowed disabled:opacity-40"
                @click="addComposedRoom(rt)"
              >{{ t('rooms.guests.addRoom') }}</button>
            </div>
          </div>

          <!--
            `fromPrice` viene PRE-impuestos y el `taxBreakdown` llega aparte (public-rates.ts).
            Antes acá decía "Incluye": una leyenda falsa, porque el huésped paga fromPrice + esta
            lista. Mismo criterio que la landing (BookingModal.vue): el impuesto se anuncia como
            agregado, no como incluido.
          -->
          <div v-if="rt.taxBreakdown.length > 0" class="mt-2 text-[11px] text-text-muted">
            {{ t('rooms.plusTaxes') }}
            <span v-for="(tax, i) in rt.taxBreakdown" :key="tax.name">
              <span v-if="i > 0"> + </span>{{ tax.rate }}% {{ tax.name }}
            </span>
          </div>

          <div v-if="urgency(rt.availableCount)" class="mt-2">
            <span
              :class="[
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
                rt.availableCount <= 1
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700',
              ]"
            >
              <Icon name="bolt" :size="12" />
              {{ urgency(rt.availableCount) }}
            </span>
          </div>
        </article>
      </li>
    </ul>

    <!--
      Carrito — resumen visible de las líneas ya agregadas (Tarea 10: combinar distintos tipos/
      ocupaciones en una misma reserva). Muestra habitaciones totales, huéspedes totales y noches
      antes de avanzar, tal como se pidió: un paso con el detalle antes de pagar.
    -->
    <div v-if="store.cart.length > 0" class="rounded-2xl border-2 border-cyan/30 bg-cyan/5 p-4 space-y-3">
      <h3 class="text-sm font-black text-navy">{{ t('rooms.cartTitle') }}</h3>
      <ul class="space-y-2">
        <li v-for="line in store.cart" :key="line.key" class="flex items-center justify-between gap-2 text-sm">
          <div class="min-w-0">
            <p class="truncate font-bold text-navy">{{ prettify(line.roomName) }} · {{ cartLineGuestsLabel(line) }}</p>
            <p class="text-xs text-text-muted">{{ line.quantity }} × {{ formatPrice(line.unitPrice, store.displayCurrency) }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="font-black tabular-nums text-navy">{{ formatPrice(line.unitPrice * line.quantity, store.displayCurrency) }}</span>
            <button
              type="button"
              class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-red-50 hover:text-red-600"
              :aria-label="t('rooms.cartRemove')"
              @click="store.removeCartLine(line.key)"
            ><Icon name="x" :size="14" /></button>
          </div>
        </li>
      </ul>
      <div class="flex items-center justify-between border-t border-cyan/20 pt-2 text-xs font-bold text-text-muted">
        <span>{{ t('rooms.cartSummary', { rooms: store.cartTotalRooms, guests: store.cartTotalGuests, nights: store.nights || 1 }) }}</span>
        <span class="text-sm text-navy">{{ formatPrice(store.roomsSubtotal, store.displayCurrency) }}</span>
      </div>
      <button
        type="button"
        class="w-full cursor-pointer rounded-full bg-cyan px-4 py-2.5 text-sm font-black text-white transition hover:bg-cyan/90"
        @click="store.next()"
      >{{ t('rooms.cartContinue') }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBookingStore, type CartLine } from '@/composables/useBooking'
import { useGuestComposer } from '@/composables/useGuestComposer'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { BookingMessageKey } from '@/composables/useBookingI18n'
import type { MealPlanCode, OccupancyUnavailableReason, RoomTypeRate } from '@/types/booking'
import type { PublicReviewAggregate, PublicReviewsResponse } from '@/types'
import MultiChannelBadges from '@/components/reviews/MultiChannelBadges.vue'
import AggregateScore from '@/components/reviews/AggregateScore.vue'
import Icon from '@/components/ui/Icon.vue'
import Stepper from './Stepper.vue'

const store = useBookingStore()
const i18n = useBookingI18nStore()
const { t, formatPrice } = i18n

/**
 * F3 3.16 — El widget puede recibir `reviews` por props (desde el wrapper que comparte el
 * fetch con el bloque reviews de la landing). Es opcional: si el wrapper no pasa nada, no
 * se muestran badges (comportamiento pre-F3). En /book/:slug standalone, hoy el wrapper no
 * hace fetch de reviews → quedamos en estado pre-F3 sin romper.
 */
const props = withDefaults(defineProps<{
  reviews?: PublicReviewsResponse | null
}>(), {
  reviews: null,
})

const reviewsAggregate = computed<PublicReviewAggregate>(() =>
  props.reviews?.aggregate ?? { score: null, count: 0, perSource: {} },
)

const showAggregateCompact = computed(() => reviewsAggregate.value.count > 0)

const EXTERNAL_SOURCE_CHANNELS = new Set(['google', 'tripadvisor', 'booking', 'airbnb', 'expedia'])
const hasExternalSources = computed(() => {
  const per = reviewsAggregate.value.perSource
  if (!per) return false
  for (const ch of EXTERNAL_SOURCE_CHANNELS) {
    const stat = per[ch]
    if (stat && Number(stat.count) > 0) return true
  }
  return false
})

// Solo mostramos rooms efectivamente disponibles. El backend podría devolver
// availableCount=0 para un type sin stock; no los mostramos (mejor UX que una card tachada).
const availableRooms = computed(() =>
  (store.ratesResponse?.roomTypes ?? []).filter((rt) => rt.availableCount > 0),
)

/** Urgencia REAL con dato vivo del PMS (D11). Nunca falsificar — si count > 3, sin badge.
 *  Textos via i18n para es/en/pt. */
function urgency(count: number): string {
  if (count <= 0) return ''
  if (count <= 1) return t('rooms.urgency.last')
  if (count <= 3) return t('rooms.urgency.few')
  return '' // >3: sin badge (no falsificar urgencia — D11).
}

function availableLabel(count: number): string {
  if (count === 1) return t('rooms.availableOne')
  return t('rooms.availableMany', { count })
}

function perNight(rt: RoomTypeRate): string {
  const n = store.nights > 0 ? store.nights : 1
  return formatPrice(rt.fromPrice / n, store.displayCurrency)
}

// Prettify del roomType string: 'double' → 'Double', 'standard' → 'Standard'. El backend
// usa ambos id/name = room.type (string libre). El widget puede mostrar el valor crudo.
function prettify(name: string): string {
  if (!name) return 'Habitación'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** El tipo tiene AL MENOS una línea en el carrito — resalta la tarjeta. */
function cartHasType(roomTypeId: string): boolean {
  return store.cart.some((l) => l.roomType === roomTypeId)
}

// ─── Régimen de alimentación (tasks.md 2.2/2.4) ───────────────────────────────
type BoardPlanState = 'included' | 'upcoming' | 'unavailable'
interface BoardPlanRow { code: MealPlanCode; label: string; state: BoardPlanState; title: string }

/** Orden fijo — mismo criterio que el backend (`public-meal-plans.ts` CODE_ORDER). */
const BOARD_PLAN_ORDER: Array<{ code: MealPlanCode; labelKey: BookingMessageKey }> = [
  { code: 'breakfast', labelKey: 'rooms.board.breakfast' },
  { code: 'half_board', labelKey: 'rooms.board.halfBoard' },
  { code: 'all_inclusive', labelKey: 'rooms.board.allInclusive' },
]

/** Mapea el catálogo fijo contra `store.mealPlans` (solo trae los `active`): sin fila → el
 *  hotel no lo ofrece, se pinta deshabilitado con el motivo (nunca se oculta). */
const boardPlanRows = computed<BoardPlanRow[]>(() =>
  BOARD_PLAN_ORDER.map(({ code, labelKey }) => {
    const label = t(labelKey)
    const found = store.mealPlans.find((m) => m.code === code)
    if (!found) return { code, label, state: 'unavailable', title: t('rooms.board.unavailable') }
    if (found.priceMode === 'included') return { code, label, state: 'included', title: '' }
    // El precio del régimen, igual que el de upsells, NUNCA se convierte server-side — viaja
    // siempre en `hotels.currency` (chargeCurrency). Etiquetarlo con displayCurrency mostraría
    // "€25.00" cuando el cobro real es $25.00 (mismo bug de D10 ya resuelto en UpsellsStep.vue).
    return {
      code, label, state: 'upcoming',
      title: t('rooms.board.upcomingHint', { price: formatPrice(found.price, store.chargeCurrency) }),
    }
  }),
)

/** Motivo → key i18n. Mapa explícito (no template literal) para que agregar un motivo nuevo en
 *  el backend rompa el typecheck acá en vez de mostrar la key cruda al huésped. */
const UNAVAILABLE_KEY: Record<OccupancyUnavailableReason, BookingMessageKey> = {
  no_rate: 'rooms.unavailable.no_rate',
  no_availability: 'rooms.unavailable.no_availability',
  stop_sell: 'rooms.unavailable.stop_sell',
  over_capacity: 'rooms.unavailable.over_capacity',
}

function unavailableLabel(reason: OccupancyUnavailableReason | null): string {
  // `available:false` sin motivo no debería pasar (el backend siempre lo manda), pero un
  // "No disponible" a secas es preferible a una fila muda que parece un bug de render.
  return t(reason ? UNAVAILABLE_KEY[reason] : 'rooms.unavailable.default')
}

// ─── Composer: adultos + niños + edades por tarjeta (feature 2026-09-02) ───────────────────────
// Reemplaza la matriz "Para 1/Para 2": el huésped arma UNA composición por tarjeta y la agrega
// al carrito con "Agregar esta habitación" — cada click es una habitación distinta, cada una con
// sus propios niños (confirmado con el dueño del producto: "si elegís 2 niños, edad del primero
// y del segundo aparte"). Lógica compartida con BookingModal.vue (landing) — ver
// composables/useGuestComposer.ts.
const {
  composer, setAdults, setChildrenCount, setChildAge,
  composition, matchedRow, composedPrice, composedPricePerNight,
  canAddComposition, addComposedRoom, maxChildAgeOptions, capacityBlockReason,
} = useGuestComposer()

/** Requerimiento 6 (2026-09-03) — texto del motivo cuando `capacityBlockReason` bloquea por
 *  maxAdults/maxChildren del tipo (la matriz no lo sabe, ver useGuestComposer.ts). `'capacity'`
 *  reusa el mismo texto que `unavailableLabel('over_capacity')` — mismo concepto, un solo string. */
function maxLabel(reason: 'max_adults' | 'max_children' | 'capacity'): string {
  if (reason === 'max_adults') return t('rooms.guests.maxAdultsExceeded')
  if (reason === 'max_children') return t('rooms.guests.maxChildrenExceeded')
  return unavailableLabel('over_capacity')
}

/** Composición de una línea YA en el carrito, para el resumen al pie del step. Líneas legacy
 *  (sin `adults`/`childrenAges` — ej. BookingModal.vue de la landing) siguen mostrando "para N". */
function cartLineGuestsLabel(line: CartLine): string {
  if (line.adults === undefined || line.childrenAges === undefined) {
    return t('rooms.occupancyFor', { count: line.occupancy })
  }
  if (line.childrenAges.length === 0) return t('rooms.guests.adultsCount', { count: line.adults })
  return t('rooms.guests.summary', {
    adults: line.adults,
    children: line.childrenAges.length,
    ages: line.childrenAges.join(', '),
  })
}
</script>
