<!--
  EstimatedTotals.vue — Issue #220: el huésped elegía una habitación de 130 en "Tu selección" y
  recién en el paso de pago veía 153.40, sin saber de dónde salía la diferencia (el ITBIS). Este
  bloque muestra el desglose ESTIMADO (subtotal · extras · descuento · impuesto por impuesto ·
  total) en los pasos previos al pago. NO calcula nada: lee los computeds del store
  (`roomsSubtotal`, `upsellLines`, `promoDiscount`, `estimatedTaxBreakdown`, `estimatedTotal`),
  que ya coinciden centavo a centavo con el backend (`hotel-taxes.ts:taxLinesOn`, ver #88).

  Issue #343: las amenidades de habitación (`roomAmenityLines`, REQ-01 #290) y el régimen
  (`mealPlanLines`, MR-03 #268) SÍ entraban en `store.subtotal` (y por lo tanto en el ITBIS y en el
  total) pero no tenían fila: con una habitación de 390 + "Cama" 200 el huésped veía Subtotal 390 ·
  ITBIS 106.20 · Total 696.20 y los números no cerraban. Ahora cada una tiene su línea, espejo de
  `PayStep.vue` / `BookingModal.vue`, así alojamiento + extras + impuestos = total a la vista.
-->
<template>
  <div class="space-y-1.5 text-sm" data-testid="estimated-totals">
    <div class="flex justify-between">
      <span class="text-text-muted">{{ subtotalLabel }} <span class="text-[11px]">· {{ beforeTaxesLabel }}</span></span>
      <span class="font-bold tabular-nums text-navy" data-testid="cart-subtotal">{{ format(store.roomsSubtotal) }}</span>
    </div>
    <div v-for="line in store.upsellLines" :key="line.id" class="flex justify-between" data-testid="upsell-line">
      <span class="text-text-muted">{{ line.name }}<span v-if="line.quantity > 1"> × {{ line.quantity }}</span> <span class="text-[11px]">· {{ beforeTaxesLabel }}</span></span>
      <span class="font-bold tabular-nums text-navy">{{ format(line.total) }}</span>
    </div>
    <!-- #343 / REQ-01 (#290) — amenidades de la habitación (cuna #292 incluida), una fila por
         habitación × amenidad. -->
    <div v-for="line in store.roomAmenityLines" :key="`${line.lineKey}-${line.key}`" class="flex justify-between" data-testid="room-amenity-line">
      <span class="text-text-muted">{{ line.roomName }} · {{ line.name }}<span v-if="line.quantity > 1"> × {{ line.quantity }}</span> <span class="text-[11px]">· {{ beforeTaxesLabel }}</span></span>
      <span class="font-bold tabular-nums text-navy">{{ format(line.total) }}</span>
    </div>
    <!-- #343 / MR-03 (#268) — régimen, una fila por habitación con régimen ≠ solo alojamiento; los
         incluidos se listan sin importe para que el huésped vea que están en la tarifa. -->
    <div v-for="line in store.mealPlanLines" :key="`${line.lineKey}-mp`" class="flex justify-between" data-testid="meal-plan-line">
      <span class="text-text-muted">{{ mealPlanLabel }} · {{ line.roomName }} · {{ mealPlanName(line.code) }}<span v-if="line.quantity > 1"> × {{ line.quantity }}</span> <span v-if="line.priceMode !== 'included'" class="text-[11px]">· {{ beforeTaxesLabel }}</span></span>
      <span v-if="line.priceMode === 'included'" class="font-bold text-green-700">{{ mealPlanIncludedLabel }}</span>
      <span v-else class="font-bold tabular-nums text-navy">{{ format(line.total) }}</span>
    </div>
    <div v-if="store.promoDiscount > 0" class="flex justify-between text-green-700" data-testid="promo-discount-line">
      <span>{{ discountLabel }}</span>
      <span class="font-bold tabular-nums">−{{ format(store.promoDiscount) }}</span>
    </div>
    <div v-for="tax in store.estimatedTaxBreakdown" :key="tax.name" class="flex justify-between" data-testid="tax-line">
      <span class="text-text-muted">{{ tax.name }} ({{ tax.rate }}%)</span>
      <span class="font-bold tabular-nums text-navy">{{ format(tax.amount) }}</span>
    </div>
    <p v-if="store.estimatedTaxBreakdown.length === 0" class="text-[11px] text-text-muted" data-testid="no-taxes">{{ noTaxesLabel }}</p>
    <div class="border-t border-slate-200 pt-1.5 flex justify-between items-baseline">
      <span class="font-black text-navy">{{ totalLabel }}</span>
      <span class="font-black tabular-nums text-navy" data-testid="estimated-total">{{ format(store.estimatedTotal) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import { MEAL_PLAN_LABEL_KEY } from '@/utils/meal-plans'
import type { MealPlanCode } from '@/types/booking'

/** Strings que reemplazan a las de i18n. El BookingModal de la landing no usa el store i18n del
 *  widget y pasa español fijo; el widget embebible no las pasa y cae en `t(...)`. */
export interface EstimatedTotalsLabels {
  subtotal: string
  total: string
  beforeTaxes: string
  noTaxes: string
  discount: string
  /** #343 — prefijo de la fila de régimen ("Régimen") y texto del régimen incluido en tarifa. */
  mealPlan: string
  mealPlanIncluded: string
  /** #343 — nombre del régimen por código; lo que falte cae en el i18n del widget. */
  mealPlanNames: Partial<Record<MealPlanCode, string>>
}

const props = defineProps<{
  /** Formateador de moneda del contexto (widget: `formatPrice`; landing: `money`). */
  format: (amount: unknown) => string
  labels?: Partial<EstimatedTotalsLabels>
}>()

const store = useBookingStore()
const { t } = useBookingI18nStore()

const subtotalLabel = computed(() => props.labels?.subtotal ?? t('rooms.cartSubtotal'))
const totalLabel = computed(() => props.labels?.total ?? t('rooms.cartEstimatedTotal'))
const beforeTaxesLabel = computed(() => props.labels?.beforeTaxes ?? t('pay.beforeTaxes'))
const noTaxesLabel = computed(() => props.labels?.noTaxes ?? t('pay.noTaxes'))
const discountLabel = computed(() => props.labels?.discount ?? t('pay.discount'))
const mealPlanLabel = computed(() => props.labels?.mealPlan ?? t('pay.mealPlan'))
const mealPlanIncludedLabel = computed(() => props.labels?.mealPlanIncluded ?? t('pay.mealPlanIncluded'))
// MR-03 (#268) — etiqueta del régimen por código: `MEAL_PLAN_LABEL_KEY` (mapa único en utils/meal-plans.ts).
function mealPlanName(code: MealPlanCode): string {
  return props.labels?.mealPlanNames?.[code] ?? t(MEAL_PLAN_LABEL_KEY[code])
}
</script>
