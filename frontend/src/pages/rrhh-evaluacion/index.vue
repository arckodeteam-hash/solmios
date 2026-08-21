<template>
  <div>
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Evaluación de Desempeño</h2>
        <p class="text-sm text-text-muted mt-0.5">Motor automático: puntúa al personal con datos reales de limpieza y asistencia</p>
      </div>
      <button @click="runEvaluation" :disabled="running || !config"
        class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLAY"></span>
        {{ running ? 'Ejecutando…' : 'Ejecutar evaluación del período' }}
      </button>
    </div>

    <!-- Skeletons -->
    <div v-if="loading" class="space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="h-28 animate-pulse rounded-[16px] bg-surface"></div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="h-96 animate-pulse rounded-2xl bg-surface"></div>
        <div class="h-96 animate-pulse rounded-2xl bg-surface lg:col-span-2"></div>
      </div>
    </div>

    <template v-else>
      <!-- KPIs -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <KpiHeroCard label="Evaluaciones" :value="results.length" icon="users" accent="blue"
          unit="Historial acumulado del hotel" />
        <KpiHeroCard v-if="summary" label="Evaluados" :value="summary.evaluated" icon="checkin" accent="teal"
          :unit="`Última ejecución · ${summary.period}`" />
        <KpiHeroCard v-if="summary" label="Sin datos" :value="summary.skipped" icon="checkout" accent="amber"
          :unit="summary.periodType === 'monthly' ? 'Período mensual' : 'Período trimestral'" />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- Config -->
      <SectionCard class="lg:col-span-1" title="Configuración" subtitle="Motor de puntuación automática">
        <template #actions>
          <button @click="saveConfig" :disabled="saving || weightsSum !== 100"
            class="rounded-full bg-cyan px-5 py-2 text-sm font-extrabold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {{ saving ? 'Guardando…' : 'Guardar' }}
          </button>
        </template>

        <div class="space-y-4">
        <div>
          <label for="rrhh-evaluacion-periodo" class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Período</label>
          <select id="rrhh-evaluacion-periodo" name="period" v-model="form.period" class="input mt-1">
            <option value="monthly">Mensual</option>
            <option value="quarterly">Trimestral</option>
          </select>
        </div>

        <div>
          <div class="flex items-center justify-between">
            <label class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Pesos (deben sumar 100)</label>
            <span class="text-[11px] font-black" :class="weightsSum === 100 ? 'text-teal' : 'text-coral'">{{ weightsSum }}/100</span>
          </div>
          <div class="grid grid-cols-2 gap-2 mt-1">
            <div v-for="w in WEIGHT_KEYS" :key="w.key">
              <span class="text-[10px] text-text-muted">{{ w.label }}</span>
              <input :id="`peso-${w.key}`" :aria-label="`Peso: ${w.label}`" type="number" min="0" max="100" v-model.number="form.weights[w.key]" class="input" />
            </div>
          </div>
        </div>

        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Umbrales de banda (descendentes)</label>
          <div class="grid grid-cols-3 gap-2 mt-1">
            <div v-for="t in THRESHOLD_KEYS" :key="t.key">
              <span class="text-[10px] text-text-muted">{{ t.label }}</span>
              <input :id="`umbral-${t.key}`" :aria-label="`Umbral: ${t.label}`" type="number" min="0" max="100" v-model.number="form.thresholds[t.key]" class="input" />
            </div>
          </div>
        </div>

        <div>
          <label for="rrhh-evaluacion-minutos-estandar-por-tarea" class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Minutos estándar por tarea</label>
          <input id="rrhh-evaluacion-minutos-estandar-por-tarea" name="standardTaskMinutes" type="number" min="1" v-model.number="form.standardTaskMinutes" class="input mt-1" />
        </div>

        <label class="flex items-center gap-2 cursor-pointer text-sm font-bold text-text-secondary select-none rounded-xl bg-surface px-3 py-2.5">
          <input id="rrhh-evaluacion-motor-habilitado" name="enabled" type="checkbox" v-model="form.enabled" class="accent-cyan cursor-pointer" />
          Motor habilitado
        </label>

        <p v-if="weightsSum !== 100" class="rounded-xl bg-coral/10 px-3 py-2 text-[11px] font-bold text-coral text-center">
          Los pesos deben sumar exactamente 100.
        </p>
        </div>
      </SectionCard>

      <!-- Resultados -->
      <SectionCard class="lg:col-span-2" title="Resultados"
        :subtitle="`${results.length} evaluación(es) registradas`" body-class="p-0">
        <EmptyState
          v-if="!results.length"
          :icon="ICON_CHART_EMPTY"
          title="Todavía no hay evaluaciones"
          message="Ejecutá el motor para puntuar al personal con los datos de limpieza y asistencia del período."
        >
          <template #action>
            <button @click="runEvaluation" :disabled="running || !config"
              class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {{ running ? 'Ejecutando…' : 'Ejecutar evaluación' }}
            </button>
          </template>
        </EmptyState>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[720px] tbl-head text-sm">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Empleado</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Período</th>
                <th class="text-left px-4 py-3 text-[10px]">Banda</th>
                <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Prod / Cal / Punt / Asis</th>
                <th class="text-right px-4 py-3 text-[10px]">Puntaje</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in results" :key="r.id" class="border-b border-border/60 last:border-0 hover:bg-surface/50 transition-colors">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3">
                    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/5 text-[11px] font-black text-navy">
                      {{ initials(employeeName(r.employeeId)) }}
                    </span>
                    <div class="min-w-0">
                      <div class="font-bold text-navy truncate">{{ employeeName(r.employeeId) }}</div>
                      <div v-if="r.period" class="text-[11px] text-text-muted lg:hidden">{{ r.period }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-text-secondary hidden lg:table-cell">
                  <span v-if="r.period">{{ r.period }}</span>
                  <span v-else class="text-text-muted text-[11px]">Sin período</span>
                </td>
                <td class="px-4 py-3">
                  <span v-if="bandOf(r)" class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="bandBg(bandOf(r))">
                    {{ bandLabel(bandOf(r)) }}
                  </span>
                  <span v-else class="text-[11px] text-text-muted">Sin banda</span>
                </td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <span v-if="hasBreakdown(r)" class="text-[11px] font-bold tabular-nums text-text-secondary">{{ breakdownText(r) }}</span>
                  <span v-else class="text-[11px] text-text-muted">Sin desglose</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <span v-if="r.score != null" class="text-base font-black tabular-nums" :class="scoreClass(r.score)">{{ r.score }}</span>
                  <span v-else class="text-[11px] text-text-muted">Sin puntaje</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  EmpleadosService, type EmployeeProfile, type PerformanceReview,
  type EvalPeriodType, type EvalBand, type EvalBreakdown, type EvalWeights, type EvalThresholds, type AutoEvalSummary,
} from '@/services/Empleados.service'
import { useToast } from '@/composables/useToast'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const ICON_PLAY = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z"/></svg>'
const ICON_CHART_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg>'

const toast = useToast()

const WEIGHT_KEYS: { key: keyof EvalWeights; label: string }[] = [
  { key: 'productivity', label: 'Productividad' },
  { key: 'quality', label: 'Calidad' },
  { key: 'punctuality', label: 'Puntualidad' },
  { key: 'attendance', label: 'Asistencia' },
]
const THRESHOLD_KEYS: { key: keyof EvalThresholds; label: string }[] = [
  { key: 'excellent', label: 'Excelente' },
  { key: 'good', label: 'Bueno' },
  { key: 'fair', label: 'Regular' },
]

const loading = ref(true)
const saving = ref(false)
const running = ref(false)
const config = ref<Awaited<ReturnType<typeof EmpleadosService.getEvalConfig>> | null>(null)
const results = ref<PerformanceReview[]>([])
const summary = ref<AutoEvalSummary | null>(null)
const profilesById = ref<Map<string, string>>(new Map())

const form = reactive<{
  period: EvalPeriodType
  weights: EvalWeights
  thresholds: EvalThresholds
  standardTaskMinutes: number
  enabled: boolean
}>({
  period: 'monthly',
  weights: { productivity: 30, quality: 35, punctuality: 20, attendance: 15 },
  thresholds: { excellent: 90, good: 75, fair: 60 },
  standardTaskMinutes: 30,
  enabled: true,
})

const weightsSum = computed(() => WEIGHT_KEYS.reduce((s, w) => s + (Number(form.weights[w.key]) || 0), 0))

function employeeName(profileId: string): string {
  return profilesById.value.get(profileId) || profileId.slice(0, 8)
}

const BAND_LABELS: Record<EvalBand, string> = { excellent: 'Excelente', good: 'Bueno', fair: 'Regular', poor: 'Bajo' }
function bandLabel(band: EvalBand | null) { return band ? BAND_LABELS[band] : '—' }
function bandBg(band: EvalBand | null) {
  return ({
    excellent: 'bg-teal/10 text-teal', good: 'bg-cyan/10 text-cyan',
    fair: 'bg-gold/10 text-gold', poor: 'bg-coral/10 text-coral',
  } as Record<string, string>)[band ?? ''] ?? 'bg-navy/5 text-navy'
}
function scoreClass(score: number | null) {
  if (score == null) return 'text-text-muted'
  if (score >= 80) return 'text-teal'
  if (score >= 60) return 'text-gold'
  return 'text-coral'
}

/** El motor guarda { band, breakdown } serializado en `answers`. */
function parseAnswers(r: PerformanceReview): { band?: EvalBand; breakdown?: EvalBreakdown } {
  try { return JSON.parse(r.answers || '{}') } catch { return {} }
}
function bandOf(r: PerformanceReview): EvalBand | null { return parseAnswers(r).band ?? null }
function hasBreakdown(r: PerformanceReview): boolean { return !!parseAnswers(r).breakdown }
/** Iniciales para el avatar de la tabla (solo presentación). */
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}
function breakdownText(r: PerformanceReview): string {
  const b = parseAnswers(r).breakdown
  if (!b) return '—'
  const cell = (c: EvalBreakdown[keyof EvalBreakdown]) => (c.hasData ? String(c.score) : '·')
  return `${cell(b.productivity)} / ${cell(b.quality)} / ${cell(b.punctuality)} / ${cell(b.attendance)}`
}

async function loadResults() {
  try { results.value = await EmpleadosService.listEvalResults() } catch { /* opcional */ }
}

async function loadProfiles() {
  try {
    const res = await EmpleadosService.listProfiles({ includeInactive: 'true' })
    for (const p of res.data ?? []) profilesById.value.set(p.id, p.userName || p.position || p.userId.slice(0, 8))
  } catch { /* opcional: cae al id */ }
}

function applyConfig(cfg: NonNullable<typeof config.value>) {
  config.value = cfg
  form.period = cfg.period
  form.weights = { ...cfg.weights }
  form.thresholds = { ...cfg.thresholds }
  form.standardTaskMinutes = cfg.standardTaskMinutes
  // El backend persiste 1/0 pero el modelo ORM declara el campo `boolean`, así que la API
  // devuelve `true`/`false`. Comparar contra `=== 1` daba SIEMPRE false: el checkbox se veía
  // desmarcado con el motor activo y, al guardar cualquier otro cambio, lo apagaba sin avisar.
  form.enabled = isEnabled(cfg.enabled)
}

/** Acepta las dos formas en que puede viajar el flag (boolean del ORM o 1/0 legacy). */
function isEnabled(v: unknown): boolean {
  return v === true || v === 1 || v === '1'
}

async function saveConfig() {
  if (weightsSum.value !== 100) { toast.error('Los pesos deben sumar 100'); return }
  saving.value = true
  try {
    const updated = await EmpleadosService.updateEvalConfig({
      period: form.period,
      weights: { ...form.weights },
      thresholds: { ...form.thresholds },
      standardTaskMinutes: form.standardTaskMinutes,
      enabled: form.enabled,
    })
    applyConfig(updated)
    toast.success('Configuración guardada')
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al guardar')
  } finally {
    saving.value = false
  }
}

async function runEvaluation() {
  running.value = true
  try {
    summary.value = await EmpleadosService.runEvaluation(form.period)
    toast.success(`Evaluación completada: ${summary.value.evaluated} evaluados, ${summary.value.skipped} sin datos`)
    await loadResults()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al ejecutar la evaluación')
  } finally {
    running.value = false
  }
}

onMounted(async () => {
  try {
    const cfg = await EmpleadosService.getEvalConfig()
    applyConfig(cfg)
  } catch {
    toast.error('No se pudo cargar la configuración')
  } finally {
    loading.value = false
  }
  await Promise.all([loadProfiles(), loadResults()])
})
</script>

<style scoped>
.input {
  width: 100%;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.75rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  background: #fff;
  color: var(--color-navy, #0f172a);
}
.input:focus { outline: none; border-color: var(--color-cyan, #06b6d4); }
</style>
