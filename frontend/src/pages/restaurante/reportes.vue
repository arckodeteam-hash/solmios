<script setup lang="ts">
// pages/restaurante/reportes.vue — Cierre del día del restaurante (#213, epic #202).
//
// Hasta acá el único "reporte" del POS era el cierre de turno de caja, que solo ve efectivo. Esta
// vista consolida TODO lo vendido (efectivo, tarjeta, transferencia, cargo a habitación), propinas,
// anulaciones con motivo, top de ítems, estaciones y franjas horarias, sobre GET /restaurant/reports/daily.
// Tres pestañas del mismo nivel (PillTabs, regla de #203): Día (cierre de una fecha), Rango (varios días,
// con la serie diaria) e Ítems (top y estaciones). El CSV se arma con el mismo objeto que pinta la vista.
import { ref, computed, onMounted, watch } from 'vue'
import {
  RestaurantService, SALES_METHODS, SALES_METHOD_LABELS, ORDER_TYPE_LABELS,
  type RestaurantDailyReport, type SalesMethod, type VoidRow,
} from '@/services/Restaurant.service'
import { currencySymbol } from '@/composables/useCurrency'
import { useToast } from '@/composables/useToast'
import PillTabs, { type PillTab } from '@/components/ui/PillTabs.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { buildDailyReportCsv, dailyReportCsvFilename, downloadCsv } from './reportes-csv'

type Tab = 'dia' | 'rango' | 'items'
const toast = useToast()

const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const shiftDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

const tab = ref<Tab>('dia')
const date = ref(today())
const from = ref(shiftDays(today(), -6))
const to = ref(today())
const loading = ref(false)
const error = ref('')
const report = ref<RestaurantDailyReport | null>(null)

const tabs = computed<PillTab[]>(() => [
  { value: 'dia', label: 'Día' },
  { value: 'rango', label: 'Rango' },
  { value: 'items', label: 'Ítems', count: report.value?.topItemsByAmount.length || undefined },
])

/** Día usa una fecha; Rango e Ítems usan from/to. Cambiar de pestaña recarga con los parámetros que correspondan. */
const params = computed(() => (tab.value === 'dia' ? { date: date.value } : { from: from.value, to: to.value }))
const isRange = computed(() => tab.value !== 'dia')

const money = (n: number): string => `${currencySymbol(report.value?.currency || 'USD')}${Number(n || 0).toFixed(2)}`
const periodLabel = computed(() => {
  if (!report.value) return ''
  return report.value.from === report.value.to ? report.value.from : `${report.value.from} → ${report.value.to}`
})

async function load() {
  if (isRange.value && from.value > to.value) { error.value = 'La fecha "desde" no puede ser posterior a "hasta".'; return }
  loading.value = true
  error.value = ''
  try {
    report.value = await RestaurantService.dailyReport(params.value)
  } catch (e: unknown) {
    report.value = null
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el cierre'
  } finally {
    loading.value = false
  }
}

function exportCsv() {
  if (!report.value) return
  downloadCsv(dailyReportCsvFilename(report.value), buildDailyReportCsv(report.value))
  toast.success('CSV exportado')
}

function setPreset(days: number) {
  to.value = today()
  from.value = shiftDays(today(), -(days - 1))
  load()
}

watch(tab, () => load())
onMounted(load)

// ─── Derivados para pintar ───
const methodRows = computed(() => {
  if (!report.value) return []
  const total = report.value.sales.total || 0
  return SALES_METHODS
    .map((m: SalesMethod) => ({ key: m, label: SALES_METHOD_LABELS[m], ...report.value!.byMethod[m], pct: total ? Math.round((report.value!.byMethod[m].amount / total) * 100) : 0 }))
    .filter((r) => r.orders > 0)
})
const typeRows = computed(() => {
  if (!report.value) return []
  return Object.entries(report.value.byType)
    .map(([key, t]) => ({ key, label: ORDER_TYPE_LABELS[key] ?? key, ...t }))
    .filter((r) => r.orders > 0)
})
const hourMax = computed(() => Math.max(0, ...(report.value?.byHour.map((h) => h.amount) ?? [])))
const dayMax = computed(() => Math.max(0, ...(report.value?.byDay.map((d) => d.amount) ?? [])))
const stationMax = computed(() => Math.max(0, ...(report.value?.byStation.map((s) => s.amount) ?? [])))
const bar = (n: number, max: number): string => `${n > 0 && max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0}%`

/** "Anulado X · Reembolsado Y" solo con lo que sea distinto de cero (los vacíos no se pintan). */
const lossesLabel = computed(() => {
  const r = report.value
  if (!r) return undefined
  const parts: string[] = []
  if (r.voided.amount) parts.push(`Anulado ${money(r.voided.amount)}`)
  if (r.refunded.amount) parts.push(`Reembolsado ${money(r.refunded.amount)}`)
  return parts.length ? parts.join(' · ') : undefined
})

const VOID_KIND_LABELS: Record<VoidRow['kind'], { label: string; cls: string }> = {
  order: { label: 'Comanda cancelada', cls: 'bg-coral/10 text-coral' },
  line: { label: 'Línea anulada', cls: 'bg-gold/20 text-navy' },
  refund: { label: 'Reembolso', cls: 'bg-navy/10 text-navy' },
}
const fmtTime = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return isRange.value ? `${d.getDate()}/${d.getMonth() + 1} ${time}` : time
}
const weekday = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14"/></svg>'
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Reportes del restaurante</h2>
        <p class="mt-0.5 text-xs text-text-muted">Cierre del día: ventas por método, propinas, anulaciones y lo más vendido</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="tab === 'dia'">
          <button type="button" class="h-9 w-9 rounded-full border border-border text-navy hover:bg-navy/5 cursor-pointer" aria-label="Día anterior" @click="date = shiftDays(date, -1); load()">‹</button>
          <input id="report-date" name="date" v-model="date" type="date" :max="today()" aria-label="Fecha del cierre"
            class="rounded-xl border border-border px-3 py-2 text-xs focus:border-navy focus:outline-none" @change="load" />
          <button type="button" class="h-9 w-9 rounded-full border border-border text-navy hover:bg-navy/5 cursor-pointer disabled:opacity-40" aria-label="Día siguiente" :disabled="date >= today()" @click="date = shiftDays(date, 1); load()">›</button>
          <button v-if="date !== today()" type="button" class="rounded-full px-3 py-2 text-xs font-bold text-navy hover:bg-navy/5 cursor-pointer" @click="date = today(); load()">Hoy</button>
        </template>
        <template v-else>
          <div class="flex items-center gap-1 rounded-full bg-surface p-1">
            <button v-for="p in [7, 30, 90]" :key="p" type="button" class="rounded-full px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:text-navy cursor-pointer" @click="setPreset(p)">{{ p }} días</button>
          </div>
          <input id="report-from" name="from" v-model="from" type="date" :max="to" aria-label="Desde" class="rounded-xl border border-border px-3 py-2 text-xs focus:border-navy focus:outline-none" @change="load" />
          <span class="text-xs text-text-muted">→</span>
          <input id="report-to" name="to" v-model="to" type="date" :min="from" :max="today()" aria-label="Hasta" class="rounded-xl border border-border px-3 py-2 text-xs focus:border-navy focus:outline-none" @change="load" />
        </template>
        <button type="button" :disabled="!report || report.empty" data-testid="export-csv"
          class="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-bold text-text-secondary transition-colors hover:border-navy/30 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          @click="exportCsv">
          <span class="h-4 w-4" v-html="ICON_DOWNLOAD"></span>
          Exportar CSV
        </button>
      </div>
    </div>

    <PillTabs v-model="tab" :tabs="tabs" query-param="tab" aria-label="Secciones del reporte" />

    <!-- Carga -->
    <div v-if="loading" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="i in 4" :key="i" class="h-28 animate-pulse rounded-2xl bg-surface"></div>
    </div>

    <EmptyState v-else-if="error" icon="⚠️" title="No se pudo cargar el cierre" :message="error" />

    <!-- Día sin ventas: estado vacío, no ceros sueltos -->
    <EmptyState v-else-if="report && report.empty" icon="🧾"
      :title="isRange ? 'Sin ventas en ese rango' : (date === today() ? 'Todavía no hay ventas hoy' : 'Sin ventas ese día')"
      :message="isRange ? 'No se cerró ninguna comanda entre esas fechas. Probá con otro rango.' : 'No se cerró ninguna comanda en esa fecha. Cambiá el día o volvé más tarde.'" />

    <template v-else-if="report">
      <!-- KPIs -->
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiHeroCard label="Ventas" accent="amber" icon="money" :prefix="currencySymbol(report.currency)" :value="report.sales.total"
          :unit="`Cobrado con propinas: ${money(report.sales.collected)}`"
          :sub-stats="[{ label: 'Subtotal', value: money(report.sales.subtotal) }, { label: 'Impuestos', value: money(report.sales.tax) }]" />
        <KpiHeroCard label="Comandas" accent="blue" icon="bookings" :value="report.sales.orders"
          :unit="report.sales.covers ? `${report.sales.covers} comensales` : periodLabel"
          :sub-stats="typeRows.map((t) => ({ label: t.label, value: t.orders }))" />
        <KpiHeroCard label="Ticket promedio" accent="teal" icon="users" :prefix="currencySymbol(report.currency)" :value="report.sales.averageTicket"
          :unit="report.sales.covers ? `${money(report.sales.averagePerCover)} por comensal` : undefined" />
        <KpiHeroCard label="Propinas" accent="green" icon="money" :prefix="currencySymbol(report.currency)" :value="report.sales.tips"
          :unit="lossesLabel" />
      </div>

      <!-- ─── DÍA ─── -->
      <template v-if="tab === 'dia'">
        <div class="grid gap-5 lg:grid-cols-2">
          <SectionCard title="Ventas por método" :subtitle="`${report.sales.orders} comanda(s) · sin propinas`" body-class="p-0">
            <div class="overflow-x-auto">
              <table class="w-full tbl-head">
                <thead><tr>
                  <th class="px-4 py-3 text-left text-[10px]">Método</th>
                  <th class="px-4 py-3 text-right text-[10px]">Comandas</th>
                  <th class="px-4 py-3 text-right text-[10px]">Importe</th>
                  <th class="px-4 py-3 text-right text-[10px] hidden sm:table-cell">%</th>
                </tr></thead>
                <tbody>
                  <tr v-for="m in methodRows" :key="m.key" class="border-t border-border" :data-method="m.key">
                    <td class="px-4 py-3 text-sm font-bold text-navy">{{ m.label }}</td>
                    <td class="px-4 py-3 text-right text-sm tabular-nums text-text-secondary">{{ m.orders }}</td>
                    <td class="px-4 py-3 text-right text-sm font-black tabular-nums text-navy">{{ money(m.amount) }}</td>
                    <td class="px-4 py-3 text-right text-xs tabular-nums text-text-muted hidden sm:table-cell">{{ m.pct }}%</td>
                  </tr>
                  <tr v-if="report.sales.tips" class="border-t border-border bg-surface/60">
                    <td class="px-4 py-3 text-sm font-bold text-text-secondary">Propinas</td>
                    <td class="px-4 py-3"></td>
                    <td class="px-4 py-3 text-right text-sm font-black tabular-nums text-teal">{{ money(report.sales.tips) }}</td>
                    <td class="hidden sm:table-cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Ventas por franja horaria" subtitle="Hora de cierre de cada comanda, en la zona del hotel">
            <ul class="space-y-1.5">
              <li v-for="h in report.byHour" :key="h.hour" class="flex items-center gap-3">
                <span class="w-12 shrink-0 text-xs font-bold tabular-nums text-text-secondary">{{ String(h.hour).padStart(2, '0') }}:00</span>
                <div class="h-5 flex-1 overflow-hidden rounded-full bg-surface">
                  <div class="h-full rounded-full bg-navy transition-[width]" :style="{ width: bar(h.amount, hourMax) }"></div>
                </div>
                <span class="w-24 shrink-0 text-right text-xs font-black tabular-nums text-navy">{{ money(h.amount) }}</span>
                <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-text-muted">{{ h.orders }}</span>
              </li>
            </ul>
          </SectionCard>
        </div>

        <SectionCard title="Anulaciones y reembolsos" :subtitle="`${report.voided.orders} comanda(s) cancelada(s) · ${report.voided.lines} línea(s) anulada(s) · ${report.refunded.orders} reembolso(s)`" body-class="p-0">
          <EmptyState v-if="!report.voided.rows.length" icon="✅" title="Sin anulaciones" message="Ninguna comanda cancelada, línea anulada ni reembolso en el período." />
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[720px] tbl-head">
              <thead><tr>
                <th class="px-4 py-3 text-left text-[10px]">Tipo</th>
                <th class="px-4 py-3 text-left text-[10px]">Comanda</th>
                <th class="px-4 py-3 text-left text-[10px]">Detalle</th>
                <th class="px-4 py-3 text-left text-[10px]">Motivo</th>
                <th class="px-4 py-3 text-right text-[10px]">Importe</th>
                <th class="px-4 py-3 text-right text-[10px]">Hora</th>
              </tr></thead>
              <tbody>
                <tr v-for="v in report.voided.rows" :key="`${v.kind}-${v.orderId}-${v.name}-${v.at}`" class="border-t border-border" data-void-row>
                  <td class="px-4 py-3"><span class="rounded-full px-2 py-0.5 text-[10px] font-extrabold" :class="VOID_KIND_LABELS[v.kind].cls">{{ VOID_KIND_LABELS[v.kind].label }}</span></td>
                  <td class="px-4 py-3 text-xs font-bold text-navy">{{ v.orderNumber || v.orderId.slice(0, 8) }}</td>
                  <td class="max-w-[280px] truncate px-4 py-3 text-xs text-text-secondary" :title="v.name">{{ v.kind === 'line' && v.quantity ? `${v.quantity}× ` : '' }}{{ v.name }}</td>
                  <td class="px-4 py-3 text-xs" :class="v.reason ? 'text-text-secondary' : 'text-text-muted'">{{ v.reason || (v.kind === 'refund' ? 'Devolución del cobro' : 'Sin motivo registrado') }}</td>
                  <td class="px-4 py-3 text-right text-sm font-black tabular-nums text-coral">{{ money(v.amount) }}</td>
                  <td class="px-4 py-3 text-right text-xs tabular-nums text-text-muted">{{ fmtTime(v.at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>
      </template>

      <!-- ─── RANGO ─── -->
      <template v-else-if="tab === 'rango'">
        <SectionCard title="Ventas por día" :subtitle="`${report.byDay.length} día(s) · ${periodLabel}`" body-class="p-0">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[560px] tbl-head">
              <thead><tr>
                <th class="px-4 py-3 text-left text-[10px]">Día</th>
                <th class="px-4 py-3 text-left text-[10px]"></th>
                <th class="px-4 py-3 text-right text-[10px]">Comandas</th>
                <th class="px-4 py-3 text-right text-[10px]">Propinas</th>
                <th class="px-4 py-3 text-right text-[10px]">Ventas</th>
              </tr></thead>
              <tbody>
                <tr v-for="d in report.byDay" :key="d.date" class="border-t border-border" :class="d.orders ? '' : 'opacity-60'" data-day-row>
                  <td class="whitespace-nowrap px-4 py-2.5 text-xs font-bold capitalize text-navy">{{ weekday(d.date) }}</td>
                  <td class="w-[40%] px-4 py-2.5">
                    <div class="h-3 w-full overflow-hidden rounded-full bg-surface"><div class="h-full rounded-full bg-cyan" :style="{ width: bar(d.amount, dayMax) }"></div></div>
                  </td>
                  <td class="px-4 py-2.5 text-right text-xs tabular-nums text-text-secondary">{{ d.orders || '' }}</td>
                  <td class="px-4 py-2.5 text-right text-xs tabular-nums text-text-secondary">{{ d.tips ? money(d.tips) : '' }}</td>
                  <td class="px-4 py-2.5 text-right text-sm font-black tabular-nums text-navy">{{ d.orders ? money(d.amount) : '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div class="grid gap-5 lg:grid-cols-2">
          <SectionCard title="Ventas por método" subtitle="Acumulado del rango, sin propinas" body-class="p-0">
            <table class="w-full tbl-head">
              <thead><tr>
                <th class="px-4 py-3 text-left text-[10px]">Método</th>
                <th class="px-4 py-3 text-right text-[10px]">Comandas</th>
                <th class="px-4 py-3 text-right text-[10px]">Importe</th>
              </tr></thead>
              <tbody>
                <tr v-for="m in methodRows" :key="m.key" class="border-t border-border" :data-method="m.key">
                  <td class="px-4 py-3 text-sm font-bold text-navy">{{ m.label }}</td>
                  <td class="px-4 py-3 text-right text-sm tabular-nums text-text-secondary">{{ m.orders }}</td>
                  <td class="px-4 py-3 text-right text-sm font-black tabular-nums text-navy">{{ money(m.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </SectionCard>
          <SectionCard title="Anulaciones y reembolsos" subtitle="Acumulado del rango">
            <div class="grid grid-cols-3 gap-3">
              <div class="rounded-2xl bg-surface p-4">
                <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Comandas canceladas</div>
                <div class="mt-1 text-2xl font-black tabular-nums text-navy">{{ report.voided.orders }}</div>
              </div>
              <div class="rounded-2xl bg-surface p-4">
                <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Líneas anuladas</div>
                <div class="mt-1 text-2xl font-black tabular-nums text-navy">{{ report.voided.lines }}</div>
              </div>
              <div class="rounded-2xl bg-surface p-4">
                <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Anulado</div>
                <div class="mt-1 text-xl font-black tabular-nums text-coral">{{ money(report.voided.amount) }}</div>
              </div>
            </div>
            <p v-if="report.refunded.orders" class="mt-3 text-xs text-text-secondary">
              {{ report.refunded.orders }} reembolso(s) por <span class="font-bold tabular-nums">{{ money(report.refunded.amount) }}</span>.
            </p>
            <p class="mt-3 text-[11px] text-text-muted">El detalle con motivo de cada anulación está en la pestaña <button type="button" class="font-bold text-navy underline cursor-pointer" @click="tab = 'dia'">Día</button>.</p>
          </SectionCard>
        </div>
      </template>

      <!-- ─── ÍTEMS ─── -->
      <template v-else>
        <div class="grid gap-5 lg:grid-cols-2">
          <SectionCard title="Más vendidos por cantidad" :subtitle="`Top ${report.topItemsByQuantity.length} · ${periodLabel}`" body-class="p-0">
            <table class="w-full tbl-head">
              <thead><tr>
                <th class="px-4 py-3 text-left text-[10px]">#</th>
                <th class="px-4 py-3 text-left text-[10px]">Ítem</th>
                <th class="px-4 py-3 text-right text-[10px]">Cantidad</th>
                <th class="px-4 py-3 text-right text-[10px]">Importe</th>
              </tr></thead>
              <tbody>
                <tr v-for="(i, idx) in report.topItemsByQuantity" :key="i.menuItemId ?? i.name" class="border-t border-border">
                  <td class="px-4 py-2.5 text-xs font-black tabular-nums text-text-muted">{{ idx + 1 }}</td>
                  <td class="px-4 py-2.5 text-sm font-bold text-navy">{{ i.name }}</td>
                  <td class="px-4 py-2.5 text-right text-sm font-black tabular-nums text-navy">{{ i.quantity }}</td>
                  <td class="px-4 py-2.5 text-right text-xs tabular-nums text-text-secondary">{{ money(i.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </SectionCard>
          <SectionCard title="Más vendidos por importe" :subtitle="`Top ${report.topItemsByAmount.length} · con impuesto`" body-class="p-0">
            <table class="w-full tbl-head">
              <thead><tr>
                <th class="px-4 py-3 text-left text-[10px]">#</th>
                <th class="px-4 py-3 text-left text-[10px]">Ítem</th>
                <th class="px-4 py-3 text-right text-[10px]">Cantidad</th>
                <th class="px-4 py-3 text-right text-[10px]">Importe</th>
              </tr></thead>
              <tbody>
                <tr v-for="(i, idx) in report.topItemsByAmount" :key="i.menuItemId ?? i.name" class="border-t border-border">
                  <td class="px-4 py-2.5 text-xs font-black tabular-nums text-text-muted">{{ idx + 1 }}</td>
                  <td class="px-4 py-2.5 text-sm font-bold text-navy">{{ i.name }}</td>
                  <td class="px-4 py-2.5 text-right text-xs tabular-nums text-text-secondary">{{ i.quantity }}</td>
                  <td class="px-4 py-2.5 text-right text-sm font-black tabular-nums text-navy">{{ money(i.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </SectionCard>
        </div>

        <SectionCard title="Ventas por estación" subtitle="Cocina, bar y demás pantallas del KDS">
          <ul class="space-y-2">
            <li v-for="s in report.byStation" :key="s.stationId ?? 'none'" class="flex items-center gap-3">
              <span class="w-32 shrink-0 truncate text-sm font-bold text-navy">{{ s.stationName }}</span>
              <div class="h-5 flex-1 overflow-hidden rounded-full bg-surface">
                <div class="h-full rounded-full bg-teal transition-[width]" :style="{ width: bar(s.amount, stationMax) }"></div>
              </div>
              <span class="w-16 shrink-0 text-right text-[11px] tabular-nums text-text-muted">{{ s.quantity }} u.</span>
              <span class="w-24 shrink-0 text-right text-sm font-black tabular-nums text-navy">{{ money(s.amount) }}</span>
            </li>
          </ul>
        </SectionCard>
      </template>
    </template>
  </div>
</template>

<style scoped>
</style>
