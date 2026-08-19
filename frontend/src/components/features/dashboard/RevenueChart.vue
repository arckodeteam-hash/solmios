<template>
  <div class="flex flex-col rounded-[20px] border border-border bg-white p-5 shadow-(--shadow-card)">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-xs font-black uppercase tracking-wider text-navy">Ingresos</h2>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-4xl font-black tabular-nums tracking-tight text-navy">{{ prefix }}{{ animatedToday }}</span>
          <span class="text-xs font-bold text-text-secondary">Hoy</span>
        </div>
        <div v-if="trendPct !== null" class="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
          :class="trendPct >= 0 ? 'bg-[#22C55E]/10 text-[#16A34A]' : 'bg-[#EF4444]/10 text-[#DC2626]'">
          {{ trendPct >= 0 ? '▲' : '▼' }} {{ trendPct >= 0 ? '+' : '' }}{{ trendPct }}% <span class="font-semibold text-text-secondary">vs ayer</span>
        </div>
      </div>

      <div class="flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1">
        <button v-for="r in RANGES" :key="r.key" @click="range = r.key"
          class="rounded-lg px-3 py-1 text-[11px] font-extrabold transition-colors cursor-pointer"
          :class="range === r.key ? 'bg-[#2563EB] text-white' : 'text-text-secondary hover:text-navy'">
          {{ r.label }}
        </button>
      </div>
    </div>

    <!-- Chart -->
    <div class="relative mt-4 flex-1" style="min-height: 180px">
      <svg v-if="points.length > 1" class="h-full w-full" viewBox="0 0 400 160" preserveAspectRatio="none">
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2563EB" stop-opacity="0.28" />
            <stop offset="100%" stop-color="#2563EB" stop-opacity="0" />
          </linearGradient>
        </defs>
        <!-- grid -->
        <line v-for="i in 4" :key="i" x1="0" :y1="(160 / 4) * i" x2="400" :y2="(160 / 4) * i" stroke="#E2E8F0" stroke-width="1" />
        <polygon :points="`0,160 ${svgPoints} 400,160`" fill="url(#revGrad)" />
        <polyline :points="svgPoints" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <div v-else class="grid h-full place-items-center text-xs text-text-muted">
        {{ loading ? 'Cargando ingresos…' : 'Sin datos de facturación en el período' }}
      </div>

      <!-- Y max label -->
      <span v-if="maxValue > 0" class="absolute right-0 top-0 text-[9px] font-bold tabular-nums text-text-muted">{{ prefix }}{{ compact(maxValue) }}</span>
    </div>

    <!-- X labels -->
    <div v-if="points.length > 1" class="mt-2 flex justify-between text-[9px] font-bold text-text-muted">
      <span>{{ points[0]?.label }}</span>
      <span>{{ points[Math.floor(points.length / 2)]?.label }}</span>
      <span>{{ points[points.length - 1]?.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRef } from 'vue'
import { useCountUp } from '@/composables/useCountUp'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'

export interface DailyPoint { date: string; value: number }
type RangeKey = 'day' | 'week' | 'month' | 'year'

const props = defineProps<{
  /** serie diaria del último año (reports facturación) */
  daily: DailyPoint[]
  revenueToday: number
  /**
   * Moneda de facturación del hotel (`hotels.currency`). El componente escribía '$' fijo:
   * un hotel que factura en RD$ o € veía sus ingresos rotulados en dólares.
   */
  currency?: string
  /** % vs ayer (trends del dashboard); null = sin dato */
  trendPct: number | null
  loading?: boolean
}>()

const prefix = computed(() => currencySymbol(props.currency || CurrencyCode.USD))

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'year', label: 'Año' },
]
const range = ref<RangeKey>('day')

const animatedRaw = useCountUp(toRef(props, 'revenueToday'))
const animatedToday = computed(() => Math.round(animatedRaw.value).toLocaleString('en-US'))

function compact(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`
  return String(Math.round(v))
}

function bucketize(daily: DailyPoint[], keyFn: (d: string) => string, labelFn: (d: string) => string) {
  const map = new Map<string, { label: string; value: number }>()
  for (const p of daily) {
    const k = keyFn(p.date)
    const prev = map.get(k)
    if (prev) prev.value += p.value
    else map.set(k, { label: labelFn(p.date), value: p.value })
  }
  return [...map.values()]
}

const points = computed<{ label: string; value: number }[]>(() => {
  const daily = [...props.daily].sort((a, b) => a.date.localeCompare(b.date))
  if (!daily.length) return []
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  const fmtMonth = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })

  switch (range.value) {
    case 'day': // últimos 30 días, punto diario
      return daily.slice(-30).map(p => ({ label: fmtDay(p.date), value: p.value }))
    case 'week': { // últimas ~26 semanas, agregado semanal (clave = lunes ISO de la semana)
      const weekKey = (d: string) => {
        const dt = new Date(`${d}T00:00:00`)
        dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
        return dt.toISOString().slice(0, 10)
      }
      return bucketize(daily.slice(-182), weekKey, d => fmtDay(weekKey(d))).slice(-26)
    }
    case 'month': // 12 meses
      return bucketize(daily, d => d.slice(0, 7), fmtMonth).slice(-12)
    case 'year': { // trimestres del año cargado
      const qKey = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`
      return bucketize(daily, qKey, d => qKey(d))
    }
  }
})

const maxValue = computed(() => Math.max(...points.value.map(p => p.value), 0))

const svgPoints = computed(() => {
  const pts = points.value
  if (pts.length < 2) return ''
  const max = maxValue.value || 1
  return pts.map((p, i) => `${(i / (pts.length - 1)) * 400},${152 - (p.value / max) * 140}`).join(' ')
})
</script>
