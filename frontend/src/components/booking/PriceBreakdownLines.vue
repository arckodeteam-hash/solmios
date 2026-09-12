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
      <!-- MR-10 (#275): con `upsells[]` (reservas nuevas) una fila por extra con su multiplicador
           ("Desayuno × 2 pers. × 3 noches"); sin él (reservas viejas) la fila agregada de siempre. -->
      <template v-if="breakdown.upsells?.length">
        <div v-for="line in breakdown.upsells" :key="line.id" class="flex justify-between" data-testid="upsell-line">
          <span class="text-text-muted">{{ upsellLineLabel(line) }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
          <span class="font-bold text-navy tabular-nums">{{ format(line.total) }}</span>
        </div>
      </template>
      <div v-else-if="breakdown.upsellsTotal > 0" class="flex justify-between" data-testid="upsell-line">
        <span class="text-text-muted">{{ t('pay.extras') }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
        <span class="font-bold text-navy tabular-nums">{{ format(breakdown.upsellsTotal) }}</span>
      </div>
      <!-- REQ-01 (#290) — amenidades de la habitación (cuna #292, cama extra…); opcional. -->
      <div v-if="(breakdown.roomAmenitiesTotal ?? 0) > 0" class="flex justify-between" data-testid="room-amenity-line">
        <span class="text-text-muted">{{ t('pay.roomAmenities') }} <span class="text-[11px]">· {{ t('pay.beforeTaxes') }}</span></span>
        <span class="font-bold text-navy tabular-nums">{{ format(breakdown.roomAmenitiesTotal) }}</span>
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
import type { TotalBreakdown, UpsellBreakdownLine } from '@/types/booking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

const props = defineProps<{
  breakdown: TotalBreakdown | null | undefined
  /** Total de la reserva: es el mismo que `breakdown.total`, pero también existe sin desglose. */
  total: number | string | null | undefined
  format: (amount: unknown) => string
}>()

const { t } = useBookingI18nStore()

/** Alojamiento = subtotal sin extras ni amenidades de la habitación (el backend guarda `subtotal`
 *  con ambos adentro; `roomAmenitiesTotal` es opcional — reservas previas a #290 no lo traen).
 *  `childAmenitiesTotal` es el snapshot histórico del catálogo global de amenidades infantiles
 *  (dado de baja en #292, siempre 0 en reservas nuevas): se resta para que el alojamiento de una
 *  reserva vieja siga siendo correcto, sin fila propia en el motor público. */
const lodging = computed(() => Math.round((
  (props.breakdown?.subtotal ?? 0) - (props.breakdown?.upsellsTotal ?? 0) - (props.breakdown?.childAmenitiesTotal ?? 0)
  - (props.breakdown?.roomAmenitiesTotal ?? 0)
) * 100) / 100)

/** "Desayuno × 2 pers. × 3 noches" (ppn) · "Parking × 3 noches" (per_night) · "Late checkout × 2"
 *  (per_room/per_person con cantidad > 1) · "Late checkout" (qty 1). Mismo criterio que el
 *  resumen de pago: el huésped ve por qué se multiplica, no sólo el total. */
function upsellLineLabel(line: UpsellBreakdownLine): string {
  const parts = [line.name]
  if (line.quantity > 1) parts.push(`× ${line.quantity}`)
  if (line.persons !== undefined) parts.push(`× ${line.persons} pers.`)
  if ((line.nights ?? 1) > 1) parts.push(`× ${t('confirm.nights', { count: line.nights })}`)
  return parts.join(' ')
}
</script>
