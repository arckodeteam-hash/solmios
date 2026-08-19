<template>
  <div class="rounded-[20px] border border-border bg-white p-5 shadow-(--shadow-card)">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xs font-black uppercase tracking-wider text-navy">Mapa de Habitaciones</h2>
      <div class="flex flex-wrap gap-3">
        <span v-for="l in LEGEND" :key="l.label" class="flex items-center gap-1.5 text-[10px] font-bold text-text-secondary">
          <span class="h-2.5 w-2.5 rounded-sm" :style="{ background: l.color }"></span>{{ l.label }}
        </span>
      </div>
    </div>

    <div class="mt-5 space-y-5">
      <div v-for="floor in floors" :key="floor.number">
        <div class="mb-2 flex items-center gap-2">
          <span class="text-[10px] font-extrabold uppercase tracking-[2px] text-text-muted">Piso {{ floor.number }}</span>
          <span class="h-px flex-1 bg-border"></span>
          <span class="text-[10px] font-bold tabular-nums text-text-muted">{{ floor.occupied }}/{{ floor.rooms.length }} ocupadas</span>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
          <button v-for="room in floor.rooms" :key="room.id" @click="$emit('select', room)"
            class="cc-cell group relative flex aspect-square flex-col items-center justify-center rounded-xl border transition-all duration-200 cursor-pointer"
            :style="cellStyle(room)"
            :title="`Hab. ${room.number} · ${roomStatusMeta(room.status).label}`">
            <span class="text-sm font-black tabular-nums text-navy">{{ room.number }}</span>
            <span class="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-navy/60">{{ roomStatusMeta(room.status).short }}</span>
            <!-- El punto vive del color del PROPIO estado: con un rojo fijo volvía a haber
                 dos significados para #EF4444 dentro del mismo mapa (ocupada vs F/S). -->
            <span v-if="room.status === 'occupied'" class="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full"
              :style="{ background: ROOM_STATUS_META.occupied.color }"></span>
          </button>
        </div>
      </div>
      <div v-if="!floors.length" class="py-6 text-center text-xs text-text-muted">Sin habitaciones registradas</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Room } from '@/types'
import { ROOM_STATUS_META, ROOM_STATUS_ORDER, roomStatusMeta } from '@/data/room-status'

const props = defineProps<{ rooms: Room[] }>()
defineEmits<{ select: [room: Room] }>()

// Colores y nombres salen de `data/room-status`. La copia local que estaba acá pintaba
// "ocupada" del mismo rojo #EF4444 que el donut de al lado usa para "fuera de servicio",
// y la leyenda solo listaba 5 de los 6 estados posibles (faltaba "Sucia").
const LEGEND = ROOM_STATUS_ORDER.map(status => ({
  label: ROOM_STATUS_META[status].short,
  color: ROOM_STATUS_META[status].color,
}))

const floors = computed(() => {
  const byFloor = new Map<number, Room[]>()
  for (const r of props.rooms) {
    const f = r.floor ?? 0
    if (!byFloor.has(f)) byFloor.set(f, [])
    byFloor.get(f)!.push(r)
  }
  return [...byFloor.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, rooms]) => ({
      number,
      rooms: rooms.sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })),
      occupied: rooms.filter(r => r.status === 'occupied').length,
    }))
})

function cellStyle(room: Room) {
  const c = roomStatusMeta(room.status).color
  return {
    background: `linear-gradient(160deg, ${c}4D 0%, ${c}1F 100%)`,
    borderColor: `${c}66`,
    boxShadow: `inset 0 0 12px ${c}22`,
  }
}
</script>

<style scoped>
.cc-cell:hover {
  transform: translateY(-2px) scale(1.04);
  filter: saturate(1.3);
}
</style>
