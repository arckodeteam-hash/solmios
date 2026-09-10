<template>
  <SectionCard
    class="flex flex-col"
    body-class="flex flex-1 flex-col p-4 sm:p-5"
    title="Embudo de ventas"
    :subtitle="subtitle"
    data-testid="sales-funnel-card"
  >
    <template #actions>
      <div class="flex items-center gap-2">
        <label class="sr-only" for="funnel-weeks">Semanas</label>
        <select
          id="funnel-weeks"
          v-model.number="weeks"
          class="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white focus:outline-none focus:ring-2 focus:ring-cyan"
          data-testid="funnel-weeks"
          @change="cargar"
        >
          <option v-for="w in WEEK_OPTIONS" :key="w" :value="w" class="text-navy">{{ w }} semanas</option>
        </select>
        <router-link to="/admin/leads-ventas" class="text-[11px] font-bold text-white/80 hover:text-white">Ver pipeline →</router-link>
      </div>
    </template>

    <SkeletonLoader v-if="loading" variant="text" :rows="4" />

    <div v-else-if="error" class="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert" data-testid="funnel-error">
      {{ error }}
      <button type="button" class="ml-2 font-bold underline" @click="cargar">Reintentar</button>
    </div>

    <EmptyState
      v-else-if="!funnel || !funnel.totals.registered"
      title="Sin altas en el período"
      :message="`Ningún hotel se registró en las últimas ${weeks} semanas.`"
    />

    <div v-else class="flex flex-1 flex-col" data-testid="funnel-body">
      <!-- Totales del período: los cuatro escalones + las dos tasas que importan. -->
      <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="k in KPIS" :key="k.key" class="rounded-xl border border-border bg-surface/60 p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{{ k.label }}</div>
          <div class="mt-1 flex items-baseline gap-2">
            <span class="text-2xl font-black tabular-nums text-navy" :data-testid="`funnel-total-${k.key}`">{{ funnel.totals[k.key] }}</span>
            <span v-if="k.rate" class="text-xs font-bold tabular-nums" :class="k.rateClass" :data-testid="`funnel-rate-${k.key}`">
              {{ funnel.totals[k.rate] }}%
            </span>
          </div>
        </div>
      </div>

      <!-- Barras por semana: registrados (fondo) con activados y pagando encima, misma escala. -->
      <div class="flex min-h-40 flex-1 items-stretch gap-1.5 sm:gap-2">
        <div
          v-for="w in funnel.weeks"
          :key="w.week"
          class="group flex h-full flex-1 flex-col justify-end"
          :title="`${w.week}: ${w.registered} registrados · ${w.activated} activados · ${w.paying} pagando · ${w.lostTotal} perdidos`"
        >
          <div class="mb-1 text-center text-[10px] font-black tabular-nums text-navy">{{ w.registered || '' }}</div>
          <div class="relative w-full" :style="{ height: `${altura(w.registered)}%` }">
            <div class="absolute inset-0 rounded-t-lg bg-navy/15"></div>
            <div class="absolute inset-x-0 bottom-0 rounded-t-lg bg-cyan/70" :style="{ height: `${pct(w.activated, w.registered)}%` }"></div>
            <div class="absolute inset-x-0 bottom-0 rounded-t-lg bg-navy" :style="{ height: `${pct(w.paying, w.registered)}%` }"></div>
          </div>
        </div>
      </div>
      <div class="mt-2 flex gap-1.5 sm:gap-2">
        <div v-for="w in funnel.weeks" :key="w.week" class="flex-1 truncate text-center text-[10px] font-semibold text-text-muted">{{ etiqueta(w) }}</div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        <span class="inline-flex items-center gap-1.5"><i class="inline-block h-2.5 w-2.5 rounded-sm bg-navy/15"></i>Registrados</span>
        <span class="inline-flex items-center gap-1.5"><i class="inline-block h-2.5 w-2.5 rounded-sm bg-cyan/70"></i>Activados (habitaciones en 7 d)</span>
        <span class="inline-flex items-center gap-1.5"><i class="inline-block h-2.5 w-2.5 rounded-sm bg-navy"></i>Pagando</span>
      </div>

      <!-- Por qué se pierden: solo los motivos con al menos un caso. -->
      <div v-if="funnel.totals.lostTotal" class="mt-4 border-t border-border pt-3 text-xs" data-testid="funnel-lost">
        <span class="font-semibold text-text-secondary">Perdidos ({{ funnel.totals.lostTotal }}):</span>
        <span v-for="m in motivosPerdida" :key="m.reason" class="ml-2 inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 font-bold text-danger">
          {{ m.label }} · {{ m.count }}
        </span>
      </div>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import { SalesPipelineService } from '@/services/SalesPipeline.service'
import type { SalesFunnelResult, SalesFunnelWeek, SalesLostReason } from '@/types/sales-pipeline'

const WEEK_OPTIONS = [4, 8, 12, 26] as const
const DEFAULT_WEEKS = 8

const LOST_LABELS: Record<SalesLostReason, string> = {
  no_response: 'Sin respuesta',
  price: 'Precio',
  missing_feature: 'Falta una función',
  chose_competitor: 'Eligió otro',
  not_a_fit: 'No encaja',
  other: 'Otro',
}

type TotalKey = 'registered' | 'activated' | 'paying' | 'lostTotal'
type RateKey = 'activationRate' | 'payingRate'
const KPIS: ReadonlyArray<{ key: TotalKey; label: string; rate?: RateKey; rateClass?: string }> = [
  { key: 'registered', label: 'Registrados' },
  { key: 'activated', label: 'Activados', rate: 'activationRate', rateClass: 'text-cyan-700' },
  { key: 'paying', label: 'Pagando', rate: 'payingRate', rateClass: 'text-success' },
  { key: 'lostTotal', label: 'Perdidos' },
]

const weeks = ref<number>(DEFAULT_WEEKS)
const funnel = ref<SalesFunnelResult | null>(null)
const loading = ref(true)
const error = ref('')

const subtitle = computed(() => {
  if (!funnel.value) return `Últimas ${weeks.value} semanas`
  const t = funnel.value.totals
  return `Últimas ${weeks.value} semanas · ${t.activationRate}% activan · ${t.payingRate}% pagan`
})

const maxRegistered = computed(() => Math.max(1, ...(funnel.value?.weeks.map((w) => w.registered) ?? [1])))
const altura = (n: number): number => (n > 0 ? Math.max(4, Math.round((n / maxRegistered.value) * 100)) : 0)
const pct = (part: number, total: number): number => (total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0)

const motivosPerdida = computed(() => {
  const lost = funnel.value?.totals.lost
  if (!lost) return []
  return (Object.keys(LOST_LABELS) as SalesLostReason[])
    .filter((r) => lost[r] > 0)
    .map((r) => ({ reason: r, label: LOST_LABELS[r], count: lost[r] }))
})

/** `2026-W37` → `S37` (y `7 sep` en el title de la barra). */
function etiqueta(w: SalesFunnelWeek): string {
  return w.week.replace(/^\d{4}-W/, 'S')
}

async function cargar(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    funnel.value = await SalesPipelineService.funnel(weeks.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el embudo'
    funnel.value = null
  } finally {
    loading.value = false
  }
}

onMounted(cargar)
</script>

<style scoped></style>
