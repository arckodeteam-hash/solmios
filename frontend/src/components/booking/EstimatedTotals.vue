<!--
  EstimatedTotals.vue — Issue #220: el huésped elegía una habitación de 130 en "Tu selección" y
  recién en el paso de pago veía 153.40, sin saber de dónde salía la diferencia (el ITBIS). Este
  bloque muestra el desglose ESTIMADO (subtotal · extras · descuento · impuesto por impuesto ·
  total) en los pasos previos al pago. NO calcula nada: lee los computeds del store
  (`roomsSubtotal`, `upsellLines`, `promoDiscount`, `estimatedTaxBreakdown`, `estimatedTotal`),
  que ya coinciden centavo a centavo con el backend (`hotel-taxes.ts:taxLinesOn`, ver #88).
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

/** Strings que reemplazan a las de i18n. El BookingModal de la landing no usa el store i18n del
 *  widget y pasa español fijo; el widget embebible no las pasa y cae en `t(...)`. */
export interface EstimatedTotalsLabels {
  subtotal: string
  total: string
  beforeTaxes: string
  noTaxes: string
  discount: string
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
</script>
