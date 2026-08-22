<template>
  <div class="space-y-5">
    <div v-if="loading" class="text-sm text-text-muted py-4">Cargando regímenes…</div>
    <div v-else-if="loadError" class="text-sm text-rose py-4">
      No pudimos cargar los regímenes. {{ loadError }}
      <button class="underline font-bold ml-1 cursor-pointer" @click="loadAll">Reintentar</button>
    </div>

    <template v-else>
      <!-- "Solo alojamiento" es la base implícita — siempre disponible, sin costo, no se
           configura acá (no tiene fila en la DB, ver public-meal-plans.ts). Se muestra solo
           como referencia de qué compara el resto. -->
      <div class="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
        <span class="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-[11px] font-bold text-white">
          <span aria-hidden="true">●</span>Solo alojamiento
        </span>
        <span class="text-[11px] text-text-muted">Siempre disponible, sin costo — no requiere configuración.</span>
      </div>

      <div v-for="row in rows" :key="row.code" class="rounded-xl border border-border p-3 space-y-3">
        <div class="flex items-center justify-between">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="row.active" type="checkbox" class="w-4 h-4 rounded text-cyan" />
            <span class="text-xs font-black text-navy">{{ LABELS[row.code] }}</span>
          </label>
        </div>

        <div v-if="row.active" class="pl-6 space-y-2">
          <div class="flex items-center gap-4">
            <label class="flex items-center gap-1.5 text-[11px] font-bold text-navy cursor-pointer">
              <input v-model="row.priceMode" type="radio" :name="`priceMode-${row.code}`" value="included" class="text-cyan" />
              Incluido en la tarifa
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-bold text-navy cursor-pointer">
              <input v-model="row.priceMode" type="radio" :name="`priceMode-${row.code}`" value="per_person_per_night" class="text-cyan" />
              Con costo aparte
            </label>
          </div>
          <div v-if="row.priceMode === 'per_person_per_night'" class="flex items-center gap-2">
            <input
              v-model.number="row.price"
              type="number" min="0" step="0.01"
              class="w-28 h-8 px-2 rounded-lg border border-border text-xs focus:outline-none focus:border-cyan"
            />
            <span class="text-[10px] text-text-muted">por persona, por noche</span>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3 pt-4 border-t border-border">
        <p class="text-[10px] text-text-muted">
          El huésped elige un régimen en el paso de habitaciones. "Con costo aparte" se muestra
          con el precio pero por ahora es informativo — todavía no suma al cobro (próxima fase).
        </p>
        <button
          type="button"
          class="px-4 py-2 bg-navy text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
          :disabled="busy"
          @click="saveAll"
        >{{ busy ? 'Guardando…' : 'Guardar regímenes' }}</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { MealPlansService, type MealPlan, type MealPlanCode, type MealPlanPriceMode } from '@/services/MealPlans.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()

const loading = ref(true)
const loadError = ref('')
const busy = ref(false)

const LABELS: Record<MealPlanCode, string> = {
  breakfast: 'Desayuno incluido',
  half_board: 'Desayuno y cena',
  all_inclusive: 'Todo incluido',
}
/** Orden fijo — mismo criterio que el backend (public-meal-plans.ts CODE_ORDER). */
const CODES: MealPlanCode[] = ['breakfast', 'half_board', 'all_inclusive']

interface RowDraft {
  code: MealPlanCode
  active: boolean
  priceMode: MealPlanPriceMode
  price: number
}

const rows = reactive<RowDraft[]>(CODES.map((code) => ({ code, active: false, priceMode: 'included', price: 0 })))

function hydrate(data: MealPlan[]): void {
  const byCode = new Map(data.map((m) => [m.code, m]))
  for (const row of rows) {
    const found = byCode.get(row.code)
    if (!found) continue
    row.active = found.active
    row.priceMode = found.priceMode
    row.price = found.price
  }
}

async function loadAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    hydrate(await MealPlansService.list())
  } catch (e: any) {
    loadError.value = e?.message || 'Error desconocido'
  } finally {
    loading.value = false
  }
}

async function saveAll(): Promise<void> {
  busy.value = true
  try {
    for (const row of rows) {
      await MealPlansService.upsert(row.code, {
        active: row.active,
        priceMode: row.priceMode,
        price: row.priceMode === 'per_person_per_night' ? row.price : 0,
      })
    }
    toast.success('Regímenes de alimentación guardados')
    await loadAll()
  } catch (e: any) {
    toast.error(e?.message || 'Error al guardar los regímenes')
  } finally {
    busy.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
/* Sin estilos extra: todo viaja por clases utilitarias de Tailwind + design tokens. */
</style>
