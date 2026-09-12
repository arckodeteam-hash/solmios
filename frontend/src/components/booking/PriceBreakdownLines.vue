<!--
  PriceBreakdownLines — Tarea 24 (#88): el mismo desglose que el huésped vio en el paso de pago,
  repetido en la confirmación (widget y página post-redirect) para que nada cambie de un paso al
  otro: alojamiento, extras, descuento, cada impuesto (nombre, %, importe) y el total.

  Recibe el `totalBreakdown` que persistió el backend con la reserva. Si es null (reserva
  anterior a esta feature o creada desde el panel), muestra solo el total: nunca inventa un
  desglose que no se le prometió al huésped.

  MR-03 (#268) — régimen: si el caller todavía tiene el carrito (`mealPlanLines`, una por
  habitación con régimen), se muestra el detalle "Desayuno · 2 pers × 3 noches" con su importe (o
  "incluido"); si solo hay el desglose persistido, la fila agregada `mealPlanTotal` (> 0).
-->
<template>
  <div class="space-y-1" data-testid="price-breakdown">
    <template v-if="breakdown">
      <div class="flex justify-between">
        <span class="text-text-muted">{{ t('confirm.lodging') }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
        <span class="font-bold text-navy tabular-nums">{{ format(lodging) }}</span>
      </div>
      <div v-if="breakdown.upsellsTotal > 0" class="flex justify-between" data-testid="upsell-line">
        <span class="text-text-muted">{{ t('pay.extras') }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
        <span class="font-bold text-navy tabular-nums">{{ format(breakdown.upsellsTotal) }}</span>
      </div>
      <div v-if="(breakdown.childAmenitiesTotal ?? 0) > 0" class="flex justify-between" data-testid="child-amenity-line">
        <span class="text-text-muted">{{ t('pay.childAmenities') }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
        <span class="font-bold text-navy tabular-nums">{{ format(breakdown.childAmenitiesTotal) }}</span>
      </div>
      <!-- REQ-01 (#290) — amenidades de la habitación (cuna, cama extra…); opcional como el anterior. -->
      <div v-if="(breakdown.roomAmenitiesTotal ?? 0) > 0" class="flex justify-between" data-testid="room-amenity-line">
        <span class="text-text-muted">{{ t('pay.roomAmenities') }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
        <span class="font-bold text-navy tabular-nums">{{ format(breakdown.roomAmenitiesTotal) }}</span>
      </div>
      <!-- MR-03 (#268) — régimen: detalle por habitación si el caller lo tiene; si no, la fila
           agregada del desglose persistido. `included` → etiqueta + "incluido", sin importe. -->
      <template v-if="mealPlanLines && mealPlanLines.length > 0">
        <div v-for="line in mealPlanLines" :key="`${line.lineKey}-mp`" class="flex justify-between" data-testid="meal-plan-line">
          <span class="text-text-muted">
            {{ t('pay.mealPlan') }}: {{ t('pay.mealPlanLine', { label: mealPlanLabel(line.code), persons: line.persons, nights: line.nights }) }}<span v-if="line.quantity > 1"> × {{ line.quantity }}</span>
            <span v-if="line.priceMode !== 'included'" class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span>
          </span>
          <span v-if="line.priceMode === 'included'" class="font-bold text-green-700">{{ t('pay.mealPlanIncluded') }}</span>
          <span v-else class="font-bold text-navy tabular-nums">{{ format(line.total) }}</span>
        </div>
      </template>
      <div v-else-if="(breakdown.mealPlanTotal ?? 0) > 0" class="flex justify-between" data-testid="meal-plan-line">
        <span class="text-text-muted">{{ t('pay.mealPlan') }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
        <span class="font-bold text-navy tabular-nums">{{ format(breakdown.mealPlanTotal) }}</span>
      </div>
      <div v-if="breakdown.promoDiscount > 0" class="flex justify-between text-green-700">
        <span>{{ t('pay.discount') }}</span>
        <span class="font-bold tabular-nums">−{{ format(breakdown.promoDiscount) }}</span>
      </div>
      <div v-for="tax in breakdown.taxBreakdown ?? []" :key="tax.name" class="flex justify-between" data-testid="tax-line">
        <span class="text-text-muted">{{ tax.name }} ({{ tax.rate }}%)</span>
        <span class="font-bold text-navy tabular-nums">{{ format(tax.amount) }}</span>
      </div>
    </template>
    <div class="flex justify-between border-t border-slate-200 pt-1 mt-1">
      <span class="text-text-muted">{{ t('confirm.total') }}</span>
      <span class="font-bold text-navy tabular-nums" data-testid="final-total">{{ format(total) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MealPlanCode, TotalBreakdown } from '@/types/booking'
import type { MealPlanLine } from '@/composables/useBooking'
import { useBookingI18nStore, type BookingMessageKey } from '@/composables/useBookingI18n'

const props = defineProps<{
  breakdown: TotalBreakdown | null | undefined
  /** Total de la reserva: es el mismo que `breakdown.total`, pero también existe sin desglose. */
  total: number | string | null | undefined
  format: (amount: unknown) => string
  /** MR-03 (#268) — detalle del régimen por habitación (`store.mealPlanLines`), cuando el caller
   *  todavía tiene el carrito. Opcional: post-redirect solo existe `breakdown.mealPlanTotal`. */
  mealPlanLines?: MealPlanLine[]
}>()

const { t } = useBookingI18nStore()

/** Código → key i18n (mismo mapa que RoomsStep.vue). */
const MEAL_PLAN_LABEL_KEY: Record<MealPlanCode, BookingMessageKey> = {
  breakfast: 'rooms.board.breakfast',
  half_board: 'rooms.board.halfBoard',
  all_inclusive: 'rooms.board.allInclusive',
}

function mealPlanLabel(code: MealPlanCode): string {
  return t(MEAL_PLAN_LABEL_KEY[code])
}

/** Alojamiento = subtotal sin extras, amenidades infantiles, amenidades de la habitación ni
 *  régimen (el backend guarda `subtotal` con los cuatro adentro; `childAmenitiesTotal`,
 *  `roomAmenitiesTotal` y `mealPlanTotal` son opcionales — reservas previas a REQ-01 #233 / #290 /
 *  MR-03 #268 no los traen). */
const lodging = computed(() => Math.round((
  (props.breakdown?.subtotal ?? 0) - (props.breakdown?.upsellsTotal ?? 0) - (props.breakdown?.childAmenitiesTotal ?? 0)
  - (props.breakdown?.roomAmenitiesTotal ?? 0) - (props.breakdown?.mealPlanTotal ?? 0)
) * 100) / 100)
</script>
