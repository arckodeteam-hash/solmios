<script setup lang="ts">
// Reportes contables (CTB-7) — balance de comprobación, estado de resultados, balance general.
import { ref, onMounted } from 'vue'
import { AccountingService, type TrialBalance, type PnL, type BalanceSheet } from '@/services/Accounting.service'
import { useToast } from '@/composables/useToast'
import { useCurrency } from '@/composables/useCurrency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const toast = useToast()
const { format } = useCurrency()
const tab = ref<'trial' | 'pnl' | 'balance'>('trial')
const period = ref(new Date().toISOString().slice(0, 7))
const loading = ref(false)
const trial = ref<TrialBalance | null>(null)
const pnl = ref<PnL | null>(null)
const balance = ref<BalanceSheet | null>(null)

const TABS = [
  { key: 'trial', label: 'Balance de Comprobación' },
  { key: 'pnl', label: 'Estado de Resultados' },
  { key: 'balance', label: 'Balance General' },
] as const

async function load() {
  loading.value = true
  try {
    if (tab.value === 'trial') trial.value = await AccountingService.trialBalance(period.value)
    else if (tab.value === 'pnl') pnl.value = await AccountingService.pnl(`${period.value}-01`, `${period.value}-31`)
    else balance.value = await AccountingService.balanceSheet(period.value)
  } catch (e: any) { toast.error(e.message || 'Error al cargar el reporte') }
  finally { loading.value = false }
}
function switchTab(t: typeof tab.value) { tab.value = t; load() }

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Reportes Contables</h2>
        <p class="text-sm text-text-muted mt-0.5">Estados financieros del hotel. Solo cuentan los asientos posteados.</p>
      </div>
      <input id="contabilidad-reportes-periodo" name="period" aria-label="Período del reporte contable" v-model="period" type="month" @change="load" class="px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
    </div>

    <div class="flex gap-2 mb-4 flex-wrap">
      <button v-for="t in TABS" :key="t.key" @click="switchTab(t.key)"
        class="px-4 py-2 rounded-full text-sm font-bold cursor-pointer transition-colors"
        :class="tab === t.key ? 'bg-navy text-white' : 'bg-navy/5 text-navy hover:bg-navy/10'">{{ t.label }}</button>
    </div>

    <div v-if="loading" class="p-8 text-center text-sm text-text-muted">Cargando…</div>

    <!-- Balance de comprobación -->
    <SectionCard v-else-if="tab === 'trial' && trial" title="Balance de Comprobación"
      :subtitle="trial.balanced ? '✓ cuadra' : '⚠ descuadrado'" body-class="p-0">
      <EmptyState v-if="!trial.rows.length" title="Sin movimientos" message="No hay asientos posteados en este período." />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[520px] tbl-head">
          <thead><tr><th class="text-left px-4 py-3 text-[10px]">Cuenta</th><th class="text-right px-4 py-3 text-[10px]">Debe</th><th class="text-right px-4 py-3 text-[10px]">Haber</th></tr></thead>
          <tbody>
            <tr v-for="r in trial.rows" :key="r.code" class="border-b border-border last:border-0">
              <td class="px-4 py-2 text-sm"><span class="font-mono text-navy">{{ r.code }}</span> {{ r.name }}</td>
              <td class="px-4 py-2 text-sm text-right tabular-nums">{{ r.debit ? format(r.debit) : '—' }}</td>
              <td class="px-4 py-2 text-sm text-right tabular-nums">{{ r.credit ? format(r.credit) : '—' }}</td>
            </tr>
          </tbody>
          <tfoot><tr class="bg-surface font-bold text-navy"><td class="px-4 py-2.5 text-sm">Totales</td><td class="px-4 py-2.5 text-sm text-right tabular-nums">{{ format(trial.totalDebit) }}</td><td class="px-4 py-2.5 text-sm text-right tabular-nums">{{ format(trial.totalCredit) }}</td></tr></tfoot>
        </table>
      </div>
    </SectionCard>

    <!-- Estado de resultados -->
    <SectionCard v-else-if="tab === 'pnl' && pnl" title="Estado de Resultados" :subtitle="`Resultado: ${format(pnl.result)}`" body-class="p-0">
      <EmptyState v-if="!pnl.rows.length" title="Sin movimientos" message="No hay ingresos ni gastos posteados en este período." />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[420px] tbl-head">
          <thead><tr><th class="text-left px-4 py-3 text-[10px]">Cuenta</th><th class="text-right px-4 py-3 text-[10px]">Monto</th></tr></thead>
          <tbody>
            <tr v-for="r in pnl.rows" :key="r.code" class="border-b border-border last:border-0">
              <td class="px-4 py-2 text-sm"><span class="font-mono text-navy">{{ r.code }}</span> {{ r.name }} <span class="text-[10px] text-text-muted">({{ r.type === 'income' ? 'ingreso' : 'gasto' }})</span></td>
              <td class="px-4 py-2 text-sm text-right tabular-nums">{{ format(r.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="grid grid-cols-3 divide-x divide-border border-t-2 border-navy">
        <div class="px-4 py-3 text-center"><div class="text-[10px] uppercase text-text-muted font-bold">Ingresos</div><div class="text-lg font-black text-teal">{{ format(pnl.revenue) }}</div></div>
        <div class="px-4 py-3 text-center"><div class="text-[10px] uppercase text-text-muted font-bold">Gastos</div><div class="text-lg font-black text-danger">{{ format(pnl.expense) }}</div></div>
        <div class="px-4 py-3 text-center"><div class="text-[10px] uppercase text-text-muted font-bold">Resultado</div><div class="text-lg font-black text-navy">{{ format(pnl.result) }}</div></div>
      </div>
    </SectionCard>

    <!-- Balance general -->
    <SectionCard v-else-if="tab === 'balance' && balance" title="Balance General" :subtitle="balance.balanced ? '✓ cuadra' : '⚠ descuadrado'" body-class="p-0">
      <div class="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
        <div class="px-5 py-6 text-center"><div class="text-[11px] uppercase text-text-muted font-bold">Activo</div><div class="text-2xl font-black text-navy mt-1">{{ format(balance.assets) }}</div></div>
        <div class="px-5 py-6 text-center"><div class="text-[11px] uppercase text-text-muted font-bold">Pasivo</div><div class="text-2xl font-black text-navy mt-1">{{ format(balance.liabilities) }}</div></div>
        <div class="px-5 py-6 text-center"><div class="text-[11px] uppercase text-text-muted font-bold">Patrimonio</div><div class="text-2xl font-black text-navy mt-1">{{ format(balance.equity) }}</div><div class="text-[11px] text-text-muted mt-1">incl. resultado {{ format(balance.netIncome) }}</div></div>
      </div>
      <div class="border-t border-border px-4 py-2.5 text-center text-sm font-bold" :class="balance.balanced ? 'text-teal' : 'text-danger'">
        Activo {{ format(balance.assets) }} = Pasivo + Patrimonio {{ format(balance.liabilities + balance.equity) }}
      </div>
    </SectionCard>

    <EmptyState v-else title="No se pudo cargar" message="Hubo un error consultando este reporte para el período elegido. Probá de nuevo.">
      <template #action>
        <button @click="load" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Reintentar</button>
      </template>
    </EmptyState>
  </div>
</template>

<style scoped></style>
