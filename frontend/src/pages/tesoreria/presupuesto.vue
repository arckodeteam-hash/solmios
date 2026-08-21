<script setup lang="ts">
// Presupuesto vs real (TES-6) — control de gastos por categoría.
import { ref, onMounted } from 'vue'
import { TreasuryService, type BudgetVsActual } from '@/services/Treasury.service'
import { useToast } from '@/composables/useToast'
import { useCurrency } from '@/composables/useCurrency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const toast = useToast()
const { format } = useCurrency()
const period = ref(new Date().toISOString().slice(0, 7))
const data = ref<BudgetVsActual | null>(null)
const loading = ref(false)
const showModal = ref(false)
const saving = ref(false)
const form = ref<{ category: string; budgetedAmount: number | null }>({ category: '', budgetedAmount: null })

async function load() {
  loading.value = true
  try { data.value = await TreasuryService.budgetVsActual(period.value) }
  catch (e: any) { toast.error(e.message || 'Error al cargar el presupuesto') }
  finally { loading.value = false }
}

function openNew() { form.value = { category: '', budgetedAmount: null }; showModal.value = true }
async function save() {
  if (!form.value.category || !form.value.budgetedAmount) { toast.error('Categoría y monto son obligatorios'); return }
  saving.value = true
  try {
    await TreasuryService.createBudget({ period: period.value, category: form.value.category, budgetedAmount: Number(form.value.budgetedAmount) })
    toast.success('Presupuesto guardado'); showModal.value = false; await load()
  } catch (e: any) { toast.error(e.message || 'Error al guardar') }
  finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Presupuesto</h2>
        <p class="text-sm text-text-muted mt-0.5">Lo presupuestado por categoría contra el gasto real del mes.</p>
      </div>
      <div class="flex gap-2 items-center">
        <input id="tesoreria-presupuesto-periodo" name="period" required aria-required="true" aria-label="Período del presupuesto" v-model="period" type="month" @change="load" class="px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
        <button @click="openNew" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg cursor-pointer">Nuevo presupuesto</button>
      </div>
    </div>

    <div v-if="loading" class="p-8 text-center text-sm text-text-muted">Cargando…</div>
    <SectionCard v-else-if="data" title="Presupuesto vs Real"
      :subtitle="`Presupuestado ${format(data.totalBudgeted)} · Real ${format(data.totalActual)}`" body-class="p-0">
      <EmptyState v-if="!data.rows.length" title="Sin datos" message="No hay presupuestos ni gastos en este período. Cargá un presupuesto por categoría." />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[560px] tbl-head">
          <thead><tr>
            <th class="text-left px-4 py-3 text-[10px]">Categoría</th>
            <th class="text-right px-4 py-3 text-[10px]">Presupuestado</th>
            <th class="text-right px-4 py-3 text-[10px]">Real</th>
            <th class="text-right px-4 py-3 text-[10px]">Desvío</th>
            <th class="text-right px-4 py-3 text-[10px]">% Ejec.</th>
          </tr></thead>
          <tbody>
            <tr v-for="r in data.rows" :key="r.category" class="border-b border-border last:border-0 hover:bg-surface/60"
              :class="r.overBudget ? 'bg-danger/5' : ''">
              <td class="px-4 py-2.5 text-sm font-semibold text-navy">{{ r.category }}<span v-if="r.overBudget" class="ml-2 text-[9px] font-extrabold uppercase text-danger">Excedido</span></td>
              <td class="px-4 py-2.5 text-sm text-right tabular-nums">{{ format(r.budgeted) }}</td>
              <td class="px-4 py-2.5 text-sm text-right tabular-nums">{{ format(r.actual) }}</td>
              <td class="px-4 py-2.5 text-sm text-right tabular-nums" :class="r.variance > 0 ? 'text-danger font-bold' : 'text-teal'">{{ format(r.variance) }}</td>
              <td class="px-4 py-2.5 text-sm text-right tabular-nums">{{ r.pctExecuted !== null ? `${r.pctExecuted}%` : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <EmptyState v-else title="No se pudo cargar" message="Hubo un error consultando el presupuesto de este período. Probá de nuevo.">
      <template #action>
        <button @click="load" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Reintentar</button>
      </template>
    </EmptyState>

    <AppModal v-if="showModal" size="md" title="Nuevo presupuesto" :subtitle="`Período ${period}`" @close="showModal = false">
      <div class="space-y-4">
        <div>
          <label for="tesoreria-presupuesto-categoria" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Categoría</label>
          <input id="tesoreria-presupuesto-categoria" name="category" required aria-required="true" v-model="form.category" placeholder="Limpieza, Servicios…" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <div>
          <label for="tesoreria-presupuesto-monto-presupuestado" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Monto presupuestado</label>
          <input id="tesoreria-presupuesto-monto-presupuestado" name="budgetedAmount" v-model.number="form.budgetedAmount" type="number" min="0" placeholder="0" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm text-right focus:outline-none focus:border-navy" />
        </div>
      </div>
      <template #footer>
        <button @click="showModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando…' : 'Guardar' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped></style>
