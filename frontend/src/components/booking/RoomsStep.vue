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
    Cada ocupación es un carrito (Tarea 10, solmi-direct-booking-qa-fixes): "+"/"-" agregan/quitan
    unidades de esa (tipo, ocupación) vía store.addToCart/removeCartLine/setCartLineQuantity, sin
    avanzar de step. Permite combinar tipos distintos y/o varias unidades del mismo tipo en una
    sola reserva. El resumen al pie del step (carrito) tiene el botón "Continuar" (store.next()).

    ─── Matriz de ocupaciones (una fila por "para N") ────────────────────────────────────────
    Cada tipo despliega UNA FILA POR OCUPACIÓN ("para 1", "para 2", "para 4"…) con su precio
    total y por noche, igual que el motor de la competencia. `roomType.occupancies` lo calcula
    el backend (`bookingengine/usecases/occupancy-matrix.ts`).

    REGLA DEL DUEÑO: la ocupación que el hotel NO puede vender **aparece igual, deshabilitada y
    con el motivo**. No se oculta. Esconderla es indistinguible de "este hotel no ofrece
    habitaciones para 4"; mostrarla en gris dice "la opción existe, hoy no se puede".

    DEGRADACIÓN: si `occupancies` no viene (backend viejo, respuesta cacheada en CDN, widget
    embebido contra otra versión), se cae a la tarjeta única con `fromPrice` — exactamente el
    comportamiento anterior. El campo es opcional en el tipo a propósito.

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
            ⚠️ RÉGIMEN — PLACEHOLDER, NO IMPLEMENTADO.
            El modelo NO tiene el concepto de pensión/board: no existe `mealPlan` ni `board` en
            `room_rates` ni en `Reservations`, y `/rates` no devuelve nada parecido. Lo único
            vendible hoy es el alojamiento, así que "Sólo alojamiento" es la única opción activa
            y las otras tres se muestran deshabilitadas para que se vea que el eje existe.
            Cuando el backend modele el régimen, esto pasa a ser una selección real que viaja en
            el payload de la reserva. Hasta entonces NO cambia el precio ni se manda a ningún
            lado — no confundir con una feature implementada.
          -->
          <div class="mt-3">
            <p class="text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ t('rooms.board.label') }}</p>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <span class="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-[11px] font-bold text-white">
                <span aria-hidden="true">●</span>{{ t('rooms.board.roomOnly') }}
              </span>
              <span
                v-for="plan in DISABLED_BOARD_PLANS"
                :key="plan"
                class="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-400"
                :title="t('rooms.board.unavailable')"
                aria-disabled="true"
              >
                <span aria-hidden="true">○</span>{{ t(plan) }}
              </span>
            </div>
          </div>

          <!--
            Una fila por ocupación — SALVO corridas de igual precio, que se agrupan para
            mostrar el número una sola vez (ver utils/occupancy-groups.ts: "para 1/2/3 $130"
            repetido lee como bug; el precio distinto sí va fila por fila). Las no vendibles
            NO se filtran: van deshabilitadas con el motivo traducido (regla del dueño).
          -->
          <ul v-if="occupancyRows(rt).length > 0" class="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            <li v-for="entry in groupedOccupancyRows(rt)" :key="entry.kind === 'group' ? `g-${entry.rows[0]!.occupancy}` : entry.row.occupancy" class="py-3">
              <!-- Grupo de ocupaciones al mismo precio: el precio se pinta UNA vez, cada
                   ocupación es su propia fila con stepper propio (líneas de carrito distintas). -->
              <div v-if="entry.kind === 'group'">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-[11px] text-text-muted">{{ t('rooms.occupancyPrice', { count: store.nights || 1 }) }}</span>
                  <span class="text-right">
                    <span class="block text-sm font-black tabular-nums text-navy">{{ formatPrice(entry.rows[0]!.price, store.displayCurrency) }}</span>
                    <span class="block text-[11px] tabular-nums text-text-muted">{{ formatPrice(entry.rows[0]!.pricePerNight, store.displayCurrency) }}/{{ t('rooms.perNight') }}</span>
                  </span>
                </div>
                <div class="mt-2 space-y-2">
                  <div v-for="row in entry.rows" :key="row.occupancy" :data-occupancy="row.occupancy" class="flex items-center gap-3">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-50 text-navy/50">
                      <Icon :name="row.occupancy > 1 ? 'users' : 'user'" :size="16" />
                    </span>
                    <span class="flex-1 text-sm font-bold text-navy">{{ t('rooms.occupancyFor', { count: row.occupancy }) }}</span>
                    <Stepper
                      :model-value="cartQuantity(rt, row.occupancy)"
                      :min="0"
                      :max="rt.availableCount"
                      :label="`${prettify(rt.name)} · ${t('rooms.occupancyFor', { count: row.occupancy })}`"
                      @update:model-value="onQtyChange(rt, row, $event)"
                    />
                  </div>
                </div>
              </div>
              <!-- Fila individual: stepper de cantidad (soporta combinar varias ocupaciones/tipos en la misma reserva) -->
              <div v-else :data-occupancy="entry.row.occupancy" class="flex w-full items-center gap-3" :class="!entry.row.available && 'opacity-60'">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-50 text-navy/50">
                  <Icon :name="entry.row.occupancy > 1 ? 'users' : 'user'" :size="16" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-bold text-navy">{{ t('rooms.occupancyFor', { count: entry.row.occupancy }) }}</span>
                  <template v-if="entry.row.available">
                    <span class="block text-[11px] tabular-nums text-text-muted">{{ formatPrice(entry.row.price, store.displayCurrency) }} · {{ formatPrice(entry.row.pricePerNight, store.displayCurrency) }}/{{ t('rooms.perNight') }}</span>
                  </template>
                  <span v-else class="block text-[11px] font-bold text-slate-500">{{ unavailableLabel(entry.row.unavailableReason) }}</span>
                </span>
                <Stepper
                  v-if="entry.row.available"
                  :model-value="cartQuantity(rt, entry.row.occupancy)"
                  :min="0"
                  :max="rt.availableCount"
                  :label="`${prettify(rt.name)} · ${t('rooms.occupancyFor', { count: entry.row.occupancy })}`"
                  @update:model-value="onQtyChange(rt, entry.row, $event)"
                />
              </div>
            </li>
          </ul>

          <!-- Fallback sin matriz: stepper de cantidad con el precio único de siempre. -->
          <div v-else class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <span class="text-xs font-bold text-text-muted">{{ t('rooms.quantity') }}</span>
            <Stepper
              :model-value="cartQuantity(rt, 1)"
              :min="0"
              :max="rt.availableCount"
              :label="prettify(rt.name)"
              @update:model-value="onFallbackQtyChange(rt, $event)"
            />
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
            <p class="truncate font-bold text-navy">{{ prettify(line.roomName) }} · {{ t('rooms.occupancyFor', { count: line.occupancy }) }}</p>
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
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { BookingMessageKey } from '@/composables/useBookingI18n'
import type { OccupancyUnavailableReason, RoomOccupancyRate, RoomTypeRate } from '@/types/booking'
import { groupOccupancyRows, type OccupancyEntry } from '@/utils/occupancy-groups'
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

/** Misma fórmula de key que `cartLineKey` en el store (no exportada) — mantenida en paralelo. */
function cartKey(rt: RoomTypeRate, occupancy: number): string {
  return `${rt.id}|${occupancy}`
}

/** Cantidad ya agregada al carrito para (tipo, ocupación). 0 si no está. */
function cartQuantity(rt: RoomTypeRate, occupancy: number): number {
  return store.cart.find((l) => l.key === cartKey(rt, occupancy))?.quantity ?? 0
}

/** El tipo tiene AL MENOS una línea en el carrito (cualquier ocupación) — resalta la tarjeta. */
function cartHasType(roomTypeId: string): boolean {
  return store.cart.some((l) => l.roomType === roomTypeId)
}

/** Stepper del fallback (sin matriz): cada tarjeta representa ocupación=1 fija. */
async function onFallbackQtyChange(rt: RoomTypeRate, qty: number): Promise<void> {
  const current = cartQuantity(rt, 1)
  if (qty > current) await store.addToCart(rt)
  else if (qty < current) store.setCartLineQuantity(cartKey(rt, 1), qty)
}

// ─── Matriz de ocupaciones ────────────────────────────────────────────────────
/**
 * Régimen NO disponible — placeholder visual (ver el comentario del template). No hay `mealPlan`
 * en el backend: estas tres opciones existen para que el huésped vea que el eje existe, y NO
 * son seleccionables ni afectan el precio.
 */
const DISABLED_BOARD_PLANS: BookingMessageKey[] = [
  'rooms.board.breakfast',
  'rooms.board.halfBoard',
  'rooms.board.fullBoard',
]

/** Motivo → key i18n. Mapa explícito (no template literal) para que agregar un motivo nuevo en
 *  el backend rompa el typecheck acá en vez de mostrar la key cruda al huésped. */
const UNAVAILABLE_KEY: Record<OccupancyUnavailableReason, BookingMessageKey> = {
  no_rate: 'rooms.unavailable.no_rate',
  no_availability: 'rooms.unavailable.no_availability',
  stop_sell: 'rooms.unavailable.stop_sell',
  over_capacity: 'rooms.unavailable.over_capacity',
}

/** Filas de ocupación del tipo, ordenadas ascendente. Vacío = backend sin matriz → fallback. */
function occupancyRows(rt: RoomTypeRate): RoomOccupancyRate[] {
  const rows = rt.occupancies
  if (!Array.isArray(rows) || rows.length === 0) return []
  return [...rows].sort((a, b) => a.occupancy - b.occupancy)
}

/** Filas (individual) o grupos (corrida de igual precio) para pintar sin repetir el número. */
function groupedOccupancyRows(rt: RoomTypeRate): OccupancyEntry[] {
  return groupOccupancyRows(occupancyRows(rt))
}

function unavailableLabel(reason: OccupancyUnavailableReason | null): string {
  // `available:false` sin motivo no debería pasar (el backend siempre lo manda), pero un
  // "No disponible" a secas es preferible a una fila muda que parece un bug de render.
  return t(reason ? UNAVAILABLE_KEY[reason] : 'rooms.unavailable.default')
}

/** Stepper de una fila de ocupación: sube con `addToCart` (crea la línea si no existía),
 *  baja con `setCartLineQuantity` (existe porque solo baja desde una cantidad > 0). */
async function onQtyChange(rt: RoomTypeRate, row: RoomOccupancyRate, qty: number): Promise<void> {
  if (!row.available) return
  const current = cartQuantity(rt, row.occupancy)
  if (qty > current) await store.addToCart(rt, row.occupancy)
  else if (qty < current) store.setCartLineQuantity(cartKey(rt, row.occupancy), qty)
}
</script>
