<!--
  PriceBreakdownLines — Tarea 24 (#88): el mismo desglose que el huésped vio en el paso de pago,
  repetido en la confirmación (widget y página post-redirect) para que nada cambie de un paso al
  otro: alojamiento, extras, descuento, cada impuesto (nombre, %, importe) y el total.

  Recibe el `totalBreakdown` que persistió el backend con la reserva. Si es null (reserva
  anterior a esta feature o creada desde el panel), muestra solo el total: nunca inventa un
  desglose que no se le prometió al huésped.
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
import type { TotalBreakdown } from '@/types/booking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

const props = defineProps<{
  breakdown: TotalBreakdown | null | undefined
  /** Total de la reserva: es el mismo que `breakdown.total`, pero también existe sin desglose. */
  total: number | string | null | undefined
  format: (amount: unknown) => string
}>()

const { t } = useBookingI18nStore()

/** Alojamiento = subtotal sin extras (el backend guarda `subtotal` con los extras adentro). */
const lodging = computed(() => Math.round(((props.breakdown?.subtotal ?? 0) - (props.breakdown?.upsellsTotal ?? 0)) * 100) / 100)
</script>
