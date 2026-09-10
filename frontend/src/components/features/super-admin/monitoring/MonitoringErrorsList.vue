<template>
  <SectionCard title="Errores recientes" subtitle="Respuestas 5xx agrupadas por ruta y mensaje" body-class="p-0">
    <template #actions>
      <span v-if="!error && items.length" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/20 text-white">
        {{ items.length }} distinto(s) · {{ totalOcurrencias.toLocaleString('es-AR') }} ocurrencia(s)
      </span>
    </template>

    <div v-if="loading && items.length === 0" class="p-4 sm:p-5">
      <SkeletonLoader variant="list" :rows="3" />
    </div>

    <div v-else-if="error" class="m-4 sm:m-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
      No se pudo leer el registro de errores: {{ error }}
    </div>

    <EmptyState v-else-if="items.length === 0"
      title="Sin errores registrados"
      message="Cuando una petición termine en 5xx queda acá con su ruta, su mensaje y cuántas veces pasó." />

    <ul v-else class="divide-y divide-border">
      <li v-for="e in items" :key="e.id" class="p-4 flex items-start justify-between gap-3 hover:bg-surface/50 transition-colors">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/10 text-danger">{{ e.statusCode }}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-navy/10 text-navy">{{ e.method }}</span>
            <span class="text-xs font-bold text-navy font-mono break-all">{{ e.path }}</span>
          </div>
          <p class="text-xs text-text-secondary break-words">{{ e.message }}</p>
          <div class="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted flex-wrap">
            <span class="font-bold">{{ e.count }} vez/veces</span>
            <span>Última: {{ fecha(e.lastSeenAt) }}</span>
            <span v-if="e.firstSeenAt !== e.lastSeenAt">Primera: {{ fecha(e.firstSeenAt) }}</span>
            <span v-if="e.hotelId">Hotel: {{ e.hotelId }}</span>
          </div>
        </div>
        <button type="button"
          :disabled="removingId === e.id"
          :title="'Quitar del registro'"
          class="shrink-0 px-2 py-1 bg-navy/10 text-navy rounded-lg text-[10px] font-bold hover:bg-navy/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          @click="emit('remove', e)">{{ removingId === e.id ? 'Quitando…' : 'Quitar' }}</button>
      </li>
    </ul>
  </SectionCard>
</template>

<script setup lang="ts">
// MonitoringErrorsList.vue — Filas de `error_logs` (GET /api/admin/monitoring/errors).
// Quitar una fila es decisión de quien mira la pantalla: el componente sólo la pide.
import { computed } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { ErrorLogRow } from '@/types/monitoring'

const props = defineProps<{
  items: ErrorLogRow[]
  loading: boolean
  error: string
  removingId: string | null
}>()

const emit = defineEmits<{ remove: [row: ErrorLogRow] }>()

const totalOcurrencias = computed(() => props.items.reduce((acc, e) => acc + (e.count ?? 0), 0))

function fecha(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-AR')
}
</script>
