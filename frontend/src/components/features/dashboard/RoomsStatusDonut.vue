<template>
  <div class="rounded-[20px] border border-border bg-white p-5 shadow-(--shadow-card)">
    <h2 class="text-xs font-black uppercase tracking-wider text-navy">Habitaciones por Estado</h2>
    <div class="mt-4 flex flex-wrap items-center justify-center gap-4">
      <!-- Donut -->
      <div class="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 42 42" class="h-28 w-28 -rotate-90">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#E2E8F0" stroke-width="5" />
          <circle v-for="seg in segments" :key="seg.label" cx="21" cy="21" r="15.9" fill="none"
            :stroke="seg.color" stroke-width="5" stroke-linecap="butt"
            :stroke-dasharray="`${seg.pct} ${100 - seg.pct}`" :stroke-dashoffset="-seg.offset"
            class="transition-[stroke-dasharray,stroke-dashoffset] duration-700 ease-out" />
        </svg>
        <div class="absolute inset-0 grid place-items-center">
          <div class="text-center">
            <div class="text-2xl font-black tabular-nums text-navy leading-none">{{ total }}</div>
            <div class="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">Total</div>
          </div>
        </div>
      </div>

      <!-- Leyenda -->
      <div class="min-w-[130px] flex-1 space-y-1.5">
        <div v-for="seg in segments" :key="seg.label" class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary">
            <span class="h-2 w-2 shrink-0 rounded-sm" :style="{ background: seg.color }"></span>
            <span>{{ seg.label }}</span>
          </span>
          <span class="shrink-0 text-xs font-black tabular-nums text-navy">{{ seg.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ROOM_STATUS_META, ROOM_STATUS_ORDER } from '@/data/room-status'

const props = defineProps<{ byStatus: Record<string, number> }>()

// Mismo catálogo que el mapa de habitaciones y el modal (`data/room-status`): antes esta
// copia llamaba "Mantenimiento" a lo que el modal llamaba "Fuera de servicio" y pintaba de
// rojo un estado que el mapa de al lado pintaba de gris.
const META = ROOM_STATUS_ORDER.map(key => ({
  key,
  // `plural`: la leyenda acompaña un conteo ("12 Ocupadas"), no describe una habitación.
  label: ROOM_STATUS_META[key].plural,
  color: ROOM_STATUS_META[key].color,
}))

const total = computed(() => Object.values(props.byStatus).reduce((a, b) => a + (b || 0), 0))

const segments = computed(() => {
  if (!total.value) return []
  let offset = 0
  return META
    .map(m => ({ ...m, count: props.byStatus[m.key] ?? 0 }))
    .filter(m => m.count > 0)
    .map(m => {
      const pct = (m.count / total.value) * 100
      const seg = { label: m.label, color: m.color, count: m.count, pct, offset }
      offset += pct
      return seg
    })
})
</script>
