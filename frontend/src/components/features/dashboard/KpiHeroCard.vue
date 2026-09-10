<template>
  <div class="cc-kpi group relative overflow-hidden rounded-[16px] px-4 py-3 shadow-(--shadow-card) transition-transform duration-300 hover:-translate-y-0.5"
    :style="{ background: theme.bg, border: `1.5px solid ${theme.borderColor}` }">
    <!-- glow decorativo suave -->
    <div class="pointer-events-none absolute -top-14 -right-14 h-24 w-24 rounded-full blur-3xl opacity-40 cc-breathe" :style="{ background: theme.glow }"></div>
    <div class="pointer-events-none absolute -bottom-16 -left-10 h-20 w-20 rounded-full blur-3xl opacity-20" :style="{ background: theme.glow }"></div>

    <div class="relative flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[10px] font-extrabold uppercase tracking-[2px]" :style="{ color: theme.labelColor }">{{ label }}</div>

        <!-- Número gigante -->
        <div class="mt-1 flex items-baseline gap-2">
          <span class="font-black tabular-nums leading-none tracking-tight text-navy text-[clamp(34px,2.7vw,50px)]">
            {{ prefix }}{{ formatted }}<span v-if="suffix" class="text-[0.6em] font-extrabold" :style="{ color: theme.labelColor }">{{ suffix }}</span>
          </span>
          <!-- Tendencia junto al número (como en la referencia) -->
          <span v-if="trend !== undefined && trend !== null"
            class="flex shrink-0 items-center gap-1 text-[10px] font-extrabold tabular-nums"
            :class="trend >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'">
            {{ trend >= 0 ? '▲' : '▼' }} {{ trend >= 0 ? '+' : '' }}{{ trend }}%
            <span class="font-semibold text-text-muted">{{ trendLabel }}</span>
          </span>
        </div>
        <div v-if="unit" class="mt-0.5 text-[11px] font-semibold text-text-secondary">{{ unit }}</div>
      </div>

      <!-- Anillo de progreso con ícono, o ícono suelto -->
      <div v-if="progress !== undefined && progress !== null" class="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 36 36" class="h-16 w-16 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#E2E8F0" stroke-width="3.4" />
          <circle cx="18" cy="18" r="15.5" fill="none" :stroke="theme.stroke" stroke-width="3.4" stroke-linecap="round"
            :stroke-dasharray="`${ringDash} 100`" class="transition-[stroke-dasharray] duration-700 ease-out" />
        </svg>
        <div class="cc-icon absolute inset-0 grid place-items-center" :style="{ color: theme.stroke }">
          <span class="block h-6 w-6" v-html="ICONS[icon]"></span>
        </div>
      </div>
      <div v-else class="cc-icon grid h-16 w-16 shrink-0 place-items-center rounded-full"
        :style="{ background: theme.glow, color: theme.stroke }">
        <span class="block h-7 w-7" v-html="ICONS[icon]"></span>
      </div>
    </div>

    <!-- Barra de progreso lineal -->
    <div v-if="progress !== undefined && progress !== null && showBar" class="relative mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div class="h-full rounded-full transition-[width] duration-700 ease-out"
        :style="{ width: `${clampedProgress}%`, background: theme.stroke }"></div>
    </div>

    <!-- Sparkline -->
    <svg v-if="spark && spark.length > 1" class="relative mt-1.5 h-8 w-full" viewBox="0 0 100 24" preserveAspectRatio="none">
      <polyline :points="sparkPoints" fill="none" :stroke="theme.stroke" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
      <polygon :points="`0,24 ${sparkPoints} 100,24`" :fill="theme.stroke" opacity="0.12" />
    </svg>

    <!-- Sub-stats -->
    <div v-if="subStats?.length" class="relative mt-2 flex flex-wrap gap-x-4 gap-y-1.5 sm:gap-x-5">
      <div v-for="s in subStats" :key="s.label">
        <div class="text-base font-black leading-none tabular-nums" :class="s.tone ?? 'text-navy'">{{ s.value }}</div>
        <div class="mt-0.5 text-[9px] font-semibold text-text-secondary">{{ s.label }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useCountUp } from '@/composables/useCountUp'

export type KpiIcon = 'bed' | 'checkin' | 'checkout' | 'money' | 'building' | 'users' | 'bookings'

const props = withDefaults(defineProps<{
  label: string
  value: number
  icon: KpiIcon
  accent: 'blue' | 'green' | 'purple' | 'amber' | 'teal' | 'rose'
  prefix?: string
  suffix?: string
  unit?: string
  /** % para el anillo/barra (0-100) */
  progress?: number | null
  /** Muestra la barra lineal debajo del anillo (default true) */
  showBar?: boolean
  /** serie para sparkline */
  spark?: number[] | null
  /** variación en % respecto del período de comparación */
  trend?: number | null
  /** Qué período compara el `trend`. Explícito porque no toda métrica se compara contra ayer:
   *  el dashboard de plataforma compara meses, y rotular eso "vs ayer" es dar un dato falso. */
  trendLabel?: string
  subStats?: { label: string; value: string | number; tone?: string }[]
}>(), {
  showBar: true,
  trendLabel: 'vs ayer',
})

const ICONS: Record<KpiIcon, string> = {
  bed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M6 9V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/></svg>',
  checkin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  checkout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v18M3 22h18M10 22v-4h4v4M9 7h.01M13 7h.01M9 11h.01M13 11h.01"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  bookings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>',
}

const THEMES = {
  blue: {
    borderColor: 'rgba(59,130,246,0.35)',
    bg: 'linear-gradient(155deg, rgba(37,99,235,0.1) 0%, rgba(255,255,255,1) 55%)',
    glow: 'rgba(37,99,235,0.35)', stroke: '#3B82F6', labelColor: '#2563EB',
  },
  green: {
    borderColor: 'rgba(34,197,94,0.35)',
    bg: 'linear-gradient(155deg, rgba(34,197,94,0.1) 0%, rgba(255,255,255,1) 55%)',
    glow: 'rgba(34,197,94,0.32)', stroke: '#22C55E', labelColor: '#16A34A',
  },
  purple: {
    borderColor: 'rgba(139,92,246,0.35)',
    bg: 'linear-gradient(155deg, rgba(139,92,246,0.1) 0%, rgba(255,255,255,1) 55%)',
    glow: 'rgba(139,92,246,0.35)', stroke: '#8B5CF6', labelColor: '#7C3AED',
  },
  amber: {
    borderColor: 'rgba(245,158,11,0.35)',
    bg: 'linear-gradient(155deg, rgba(245,158,11,0.1) 0%, rgba(255,255,255,1) 55%)',
    glow: 'rgba(245,158,11,0.3)', stroke: '#F59E0B', labelColor: '#D97706',
  },
  teal: {
    borderColor: 'rgba(20,184,166,0.35)',
    bg: 'linear-gradient(155deg, rgba(20,184,166,0.1) 0%, rgba(255,255,255,1) 55%)',
    glow: 'rgba(20,184,166,0.32)', stroke: '#14B8A6', labelColor: '#0D9488',
  },
  rose: {
    borderColor: 'rgba(244,63,94,0.35)',
    bg: 'linear-gradient(155deg, rgba(244,63,94,0.1) 0%, rgba(255,255,255,1) 55%)',
    glow: 'rgba(244,63,94,0.3)', stroke: '#F43F5E', labelColor: '#E11D48',
  },
} as const

const theme = computed(() => THEMES[props.accent])

const animated = useCountUp(toRef(props, 'value'))
const formatted = computed(() => Math.round(animated.value).toLocaleString('en-US'))

const clampedProgress = computed(() => Math.min(100, Math.max(0, props.progress ?? 0)))
// circunferencia normalizada del anillo (r=15.5 sobre viewBox 36 → ~97.4 unidades por 100%)
const ringDash = computed(() => clampedProgress.value * 0.974)

const sparkPoints = computed(() => {
  const data = props.spark ?? []
  if (data.length < 2) return ''
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  return data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${22 - ((v - min) / range) * 20}`)
    .join(' ')
})
</script>

<style scoped>
.cc-breathe {
  animation: cc-breathe 4s ease-in-out infinite;
}
@keyframes cc-breathe {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}
/* el SVG inyectado por v-html hereda el tamaño del span contenedor */
.cc-icon :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
