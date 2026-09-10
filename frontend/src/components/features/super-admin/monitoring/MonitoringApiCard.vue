<template>
  <SectionCard title="API HTTP" :subtitle="subtitulo" body-class="p-0">
    <template #actions>
      <span v-if="data && !error" class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="totalesClase">
        {{ data.totales.erroresPct }}% con error 5xx
      </span>
    </template>

    <div v-if="loading && !data" class="p-4 sm:p-5">
      <SkeletonLoader variant="text" :rows="4" />
    </div>

    <div v-else-if="error" class="m-4 sm:m-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
      No se pudieron leer las métricas HTTP: {{ error }}
    </div>

    <EmptyState v-else-if="!data || data.totales.peticiones === 0"
      title="Sin peticiones registradas"
      message="Las métricas se acumulan en memoria desde el arranque del backend. Cuando entre tráfico, las rutas aparecen acá." />

    <div v-else>
      <div class="grid grid-cols-3 divide-x divide-border border-b border-border">
        <div class="p-4 text-center">
          <div class="text-xl font-black text-navy">{{ data.totales.peticiones.toLocaleString('es-AR') }}</div>
          <div class="text-[10px] text-text-muted font-bold uppercase">Peticiones</div>
        </div>
        <div class="p-4 text-center">
          <div class="text-xl font-black text-navy">{{ data.totales.avgMs }}<span class="text-xs text-text-muted"> ms</span></div>
          <div class="text-[10px] text-text-muted font-bold uppercase">Promedio</div>
        </div>
        <div class="p-4 text-center">
          <div class="text-xl font-black" :class="data.totales.erroresPct > 0 ? 'text-danger' : 'text-teal'">{{ data.totales.erroresPct }}<span class="text-xs text-text-muted"> %</span></div>
          <div class="text-[10px] text-text-muted font-bold uppercase">Errores 5xx</div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full tbl-head">
          <thead>
            <tr class="border-b border-border">
              <th class="text-left p-3 text-[10px] font-bold text-text-muted uppercase">Ruta</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">Peticiones</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">Prom.</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">p95</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">Máx.</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">Errores</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rutasVisibles" :key="`${r.metodo} ${r.ruta}`" class="border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors">
              <td class="p-3">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-navy/10 text-navy mr-2">{{ r.metodo }}</span>
                <span class="text-xs font-bold text-navy font-mono break-all">{{ r.ruta }}</span>
              </td>
              <td class="p-3 text-right text-xs font-bold text-navy">{{ r.count.toLocaleString('es-AR') }}</td>
              <td class="p-3 text-right text-xs text-text-secondary whitespace-nowrap">{{ r.avgMs }} ms</td>
              <td class="p-3 text-right text-xs font-bold whitespace-nowrap" :class="latenciaClase(r.p95Ms)">{{ r.p95Ms }} ms</td>
              <td class="p-3 text-right text-xs text-text-secondary whitespace-nowrap">{{ r.maxMs }} ms</td>
              <td class="p-3 text-right text-xs font-bold" :class="r.errors > 0 ? 'text-danger' : 'text-text-muted'">{{ r.errors }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data.rutas.length > rutasVisibles.length" class="px-4 py-2 border-t border-border text-[11px] text-text-muted font-bold">
        Mostrando las {{ rutasVisibles.length }} rutas más pedidas de {{ data.rutas.length }}.
      </div>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
// MonitoringApiCard.vue — Métricas HTTP en memoria (GET /api/admin/monitoring/api).
// Muestra lo que el backend midió y nada más: sin datos es "sin peticiones", no un número.
import { computed } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { HttpMetricsSnapshot } from '@/types/monitoring'

const MAX_RUTAS = 15
/** Umbrales de color del p95: por encima del segundo es lento, por encima del primero es a mirar. */
const P95_ATENCION_MS = 500
const P95_LENTO_MS = 2000

const props = defineProps<{
  data: HttpMetricsSnapshot | null
  loading: boolean
  error: string
}>()

const subtitulo = computed(() => {
  if (!props.data) return 'Latencia y errores por ruta'
  const d = new Date(props.data.ventanaDesde)
  return Number.isNaN(d.getTime()) ? 'Latencia y errores por ruta' : `Acumulado desde ${d.toLocaleString('es-AR')}`
})

const totalesClase = computed(() =>
  props.data && props.data.totales.erroresPct > 0 ? 'bg-danger/20 text-white' : 'bg-white/10 text-white',
)

const rutasVisibles = computed(() =>
  [...(props.data?.rutas ?? [])].sort((a, b) => b.count - a.count).slice(0, MAX_RUTAS),
)

function latenciaClase(p95: number): string {
  if (p95 >= P95_LENTO_MS) return 'text-danger'
  if (p95 >= P95_ATENCION_MS) return 'text-gold'
  return 'text-teal'
}
</script>
