<script setup lang="ts">
// components/features/dashboard/RestaurantTodayCard.vue — "Restaurante hoy" en el dashboard del hotel (#213).
// Lee el cierre del día de hoy (GET /restaurant/reports/daily) y lo resume en un KpiHeroCard: ventas,
// comandas, propinas y por método. Solo se monta si el módulo restaurant está activo y el usuario tiene
// `reports:view` (lo decide el padre). Enlaza al cierre completo.
import { ref, computed, onMounted } from 'vue'
import { RestaurantService, SALES_METHOD_LABELS, type RestaurantDailyReport, type SalesMethod } from '@/services/Restaurant.service'
import { currencySymbol } from '@/composables/useCurrency'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'

const report = ref<RestaurantDailyReport | null>(null)
const loading = ref(true)
const failed = ref(false)

onMounted(async () => {
  try {
    report.value = await RestaurantService.dailyReport()
  } catch {
    failed.value = true   // el dashboard nunca se rompe por el restaurante: la tarjeta muestra el aviso
  } finally {
    loading.value = false
  }
})

const symbol = computed(() => currencySymbol(report.value?.currency || 'USD'))
const money = (n: number): string => `${symbol.value}${Number(n || 0).toFixed(2)}`
const unit = computed(() => {
  const r = report.value
  if (!r || r.empty) return 'Todavía no hay ventas hoy'
  const parts = [`${r.sales.orders} comanda(s)`]
  if (r.sales.tips) parts.push(`propinas ${money(r.sales.tips)}`)
  if (r.voided.amount) parts.push(`anulado ${money(r.voided.amount)}`)
  return parts.join(' · ')
})
/** Por método, solo los que vendieron algo (los vacíos no se pintan). */
const subStats = computed(() => {
  const r = report.value
  if (!r || r.empty) return []
  return (Object.keys(r.byMethod) as SalesMethod[])
    .filter((m) => r.byMethod[m].orders > 0)
    .map((m) => ({ label: SALES_METHOD_LABELS[m], value: money(r.byMethod[m].amount) }))
})
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="restaurant-today-card">
    <div v-if="loading" class="h-28 animate-pulse rounded-2xl bg-surface"></div>
    <div v-else-if="failed" class="rounded-2xl border border-border bg-white px-4 py-3 text-xs text-text-muted">
      No se pudo cargar el resumen del restaurante.
    </div>
    <template v-else-if="report">
      <KpiHeroCard label="Restaurante hoy" accent="rose" icon="money" :prefix="symbol" :value="report.sales.total" :unit="unit" :sub-stats="subStats" />
      <router-link to="/panel/restaurante/reportes?tab=dia"
        class="self-end rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-navy hover:bg-navy/10">
        Cierre del día →
      </router-link>
    </template>
  </div>
</template>

<style scoped>
</style>
