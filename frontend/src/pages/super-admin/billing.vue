<template>
  <div>
    <!-- ─── Analítica del cobro (REQ-BIL-04) ──────────────────────────────── -->
    <div v-if="loadingStats" class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="i in 4" :key="i" class="h-[132px] animate-pulse rounded-[16px] border border-border bg-surface"></div>
    </div>
    <div v-else-if="stats" class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiHeroCard
        label="Cobrado" :value="stats.collected" prefix="$" icon="money" accent="green"
        :progress="stats.collectionRate" :unit="`${stats.collectionRate}% de lo facturado en el período`"
      />
      <KpiHeroCard
        label="Pendiente" :value="stats.open" prefix="$" icon="bookings" accent="amber"
        :unit="stats.overdue ? `$${fmt(stats.overdue)} ya vencido` : 'Nada vencido todavía'"
      />
      <KpiHeroCard
        label="Cobros fallidos" :value="stats.failed" prefix="$" icon="money" accent="rose"
        unit="Tarjetas rechazadas por Stripe"
      />
      <KpiHeroCard
        label="MRR" :value="stats.mrr" prefix="$" icon="building" accent="blue"
        unit="Suscripciones activas, igual que en Suscripciones"
      />
    </div>

    <!-- ─── Listado ────────────────────────────────────────────────────────── -->
    <SectionCard title="Facturación de la plataforma" :subtitle="listSubtitle" body-class="p-0">
      <template #actions>
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative">
            <input
              v-model="filters.q" type="search" placeholder="Número, hotel o referencia..."
              class="h-9 w-56 rounded-lg border border-white/15 bg-white/10 pl-9 pr-4 text-sm text-white placeholder:text-white/45 focus:border-cyan focus:outline-none"
            >
            <svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <select v-model="filters.status" class="h-9 cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white focus:border-cyan focus:outline-none">
            <option value="" class="text-navy">Todos los estados</option>
            <option v-for="s in STATUS_OPTIONS" :key="s" :value="s" class="text-navy">{{ statusLabel(s) }}</option>
          </select>
          <!-- Los planes salen del catálogo real (`/admin/plans`), no de una lista escrita a mano
               que se desactualiza cada vez que se crea un plan. -->
          <select v-model="filters.planId" class="h-9 cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white focus:border-cyan focus:outline-none">
            <option value="" class="text-navy">Todos los planes</option>
            <option v-for="p in plans" :key="p.id" :value="p.id" class="text-navy">{{ p.name }}</option>
          </select>
          <label class="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
            Desde
            <input v-model="filters.from" type="date" class="h-9 cursor-pointer rounded-lg border border-white/15 bg-white/10 px-2 text-xs text-white focus:border-cyan focus:outline-none">
          </label>
          <label class="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
            Hasta
            <input v-model="filters.to" type="date" class="h-9 cursor-pointer rounded-lg border border-white/15 bg-white/10 px-2 text-xs text-white focus:border-cyan focus:outline-none">
          </label>
          <button
            type="button" :disabled="exporting || !total" @click="exportCsv"
            class="h-9 cursor-pointer rounded-lg bg-cyan px-4 text-xs font-extrabold text-navy transition-all hover:shadow-lg disabled:cursor-default disabled:opacity-50"
          >{{ exporting ? 'Exportando...' : 'Exportar CSV' }}</button>
        </div>
      </template>

      <div v-if="error" class="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <div class="text-sm font-bold text-danger">{{ error }}</div>
        <button type="button" class="cursor-pointer rounded-full border border-border bg-surface px-4 py-2 text-xs font-bold text-navy hover:bg-surface-dark" @click="load()">Reintentar</button>
      </div>
      <SkeletonLoader v-else-if="loading" variant="table" :rows="6" class="p-4" />
      <EmptyState
        v-else-if="!invoices.length"
        :title="hasFilters ? 'Sin resultados' : 'Todavía no hay cobros'"
        :message="hasFilters
          ? 'Ninguna factura coincide con los filtros aplicados.'
          : 'Cuando Stripe cobre la primera suscripción, la factura aparece acá. Si ya cobraste antes de conectar esta pantalla, corré el backfill.'"
      >
        <template v-if="hasFilters" #action>
          <button type="button" class="cursor-pointer rounded-full border border-border bg-surface px-4 py-2 text-xs font-bold text-navy transition-colors hover:bg-surface-dark" @click="clearFilters">
            Limpiar filtros
          </button>
        </template>
      </EmptyState>
      <div v-else class="overflow-x-auto">
        <table class="tbl-head w-full min-w-[940px]">
          <thead>
            <tr class="border-b border-border">
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Factura</th>
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Hotel</th>
              <th class="hidden p-4 text-left text-[10px] font-bold uppercase text-text-muted lg:table-cell">Plan</th>
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Estado</th>
              <th class="hidden p-4 text-left text-[10px] font-bold uppercase text-text-muted lg:table-cell">Método</th>
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Emisión</th>
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Vencimiento</th>
              <th class="p-4 text-right text-[10px] font-bold uppercase text-text-muted">Monto</th>
              <th class="p-4 text-right text-[10px] font-bold uppercase text-text-muted">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in invoices" :key="row.id" class="border-b border-border transition-colors last:border-0 hover:bg-surface/50">
              <td class="p-4">
                <button type="button" class="cursor-pointer text-sm font-bold text-navy hover:text-cyan" @click="openDetail(row)">{{ invoiceLabel(row) }}</button>
                <div v-if="row.periodStart || row.periodEnd" class="text-[10px] text-text-muted">{{ periodLabel(row) }}</div>
              </td>
              <td class="p-4">
                <div class="text-sm font-bold text-navy">{{ row.hotelName }}</div>
                <div class="text-[10px] text-text-muted lg:hidden">{{ row.planName }}</div>
              </td>
              <td class="hidden p-4 lg:table-cell">
                <span v-if="row.planName" class="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-bold text-navy">{{ row.planName }}</span>
              </td>
              <td class="p-4">
                <span class="rounded-full px-2 py-1 text-[10px] font-bold" :class="statusBadge(row.status)">{{ statusLabel(row.status) }}</span>
                <div v-if="row.overdue" class="mt-0.5 text-[10px] font-bold text-danger">Vencida</div>
              </td>
              <td class="hidden p-4 text-sm text-text-secondary lg:table-cell">{{ methodLabel(row.method) }}</td>
              <td class="p-4 text-sm text-text-secondary">{{ shortDate(row.issuedAt) }}</td>
              <td class="p-4 text-sm" :class="row.overdue ? 'font-bold text-danger' : 'text-text-secondary'">{{ shortDate(row.dueAt) }}</td>
              <td class="p-4 text-right">
                <div class="text-sm font-black tabular-nums text-navy">{{ money(row.amountDue, row.currency) }}</div>
                <div v-if="row.status === 'paid' && row.amountPaid !== row.amountDue" class="text-[10px] tabular-nums text-text-muted">Pagado {{ money(row.amountPaid, row.currency) }}</div>
              </td>
              <td class="p-4">
                <div class="flex justify-end gap-1">
                  <button
                    type="button" :aria-label="`Ver la factura ${invoiceLabel(row)}`"
                    class="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-text-muted transition-colors hover:bg-navy/10 hover:text-navy"
                    @click="openDetail(row)"
                  ><Icon name="document" :size="15" /></button>
                  <button
                    v-if="isClaimable(row)" type="button" :aria-label="`Recordar el cobro a ${row.hotelName}`"
                    class="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-text-muted transition-colors hover:bg-navy/10 hover:text-navy"
                    @click="openRemind(row)"
                  ><Icon name="mail" :size="15" /></button>
                  <button
                    v-if="isClaimable(row)" type="button" :aria-label="`Registrar un pago manual de ${row.hotelName}`"
                    class="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-text-muted transition-colors hover:bg-teal/10 hover:text-teal"
                    @click="openManualPayment(row)"
                  ><Icon name="money" :size="15" /></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!loading && !error && invoices.length" class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <span class="text-xs text-text-muted">{{ rangeLabel }}</span>
        <div v-if="totalPages > 1" class="flex items-center gap-1.5">
          <button type="button" :disabled="page === 1" class="h-8 cursor-pointer rounded-lg border border-border px-3 text-xs font-bold text-navy transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-40" @click="page--">Anterior</button>
          <span class="px-2 text-xs font-bold tabular-nums text-text-secondary">{{ page }} / {{ totalPages }}</span>
          <button type="button" :disabled="page === totalPages" class="h-8 cursor-pointer rounded-lg border border-border px-3 text-xs font-bold text-navy transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-40" @click="page++">Siguiente</button>
        </div>
      </div>
    </SectionCard>

    <!-- ─── Detalle (REQ-BIL-08) ───────────────────────────────────────────── -->
    <AppModal v-if="detailOpen" size="lg" :title="detail ? invoiceLabel(detail) : 'Factura'" :subtitle="detail?.hotelName" @close="detailOpen = false">
      <div v-if="detailLoading" class="space-y-3">
        <div v-for="i in 4" :key="i" class="h-14 animate-pulse rounded-xl bg-surface"></div>
      </div>
      <div v-else-if="detail" class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="rounded-full px-3 py-1 text-[11px] font-bold" :class="statusBadge(detail.status)">{{ statusLabel(detail.status) }}</span>
          <span class="text-2xl font-black tabular-nums text-navy">{{ money(detail.amountDue, detail.currency) }}</span>
          <router-link :to="`/admin/subscriptions?hotel=${detail.hotelId}`" class="ml-auto text-xs font-bold text-cyan hover:underline">
            Ver la suscripción de {{ detail.hotelName }} →
          </router-link>
        </div>

        <!-- Los campos sin dato NO se pintan: una ficha llena de "—" no es información. -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div v-for="field in detailFields" :key="field.label" class="rounded-xl bg-surface p-4">
            <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ field.label }}</div>
            <div class="mt-0.5 text-sm font-bold text-navy">{{ field.value }}</div>
          </div>
        </div>

        <div v-if="detail.notes" class="rounded-xl bg-surface p-4">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Notas</div>
          <div class="mt-0.5 text-sm text-text-secondary">{{ detail.notes }}</div>
        </div>

        <div v-if="detail.lastReminderAt" class="text-[11px] text-text-muted">
          Último recordatorio: {{ shortDate(detail.lastReminderAt) }} {{ timeOf(detail.lastReminderAt) }}
        </div>
      </div>

      <template #footer>
        <button type="button" class="cursor-pointer px-4 py-2.5 text-sm font-bold text-text-secondary" @click="detailOpen = false">Cerrar</button>
        <!-- Los links de Stripe solo existen si la factura vino de Stripe: una manual no tiene PDF. -->
        <a v-if="detail?.hostedInvoiceUrl" :href="detail.hostedInvoiceUrl" target="_blank" rel="noopener"
          class="rounded-full border border-border px-4 py-2.5 text-sm font-bold text-navy transition-colors hover:bg-surface">Ver en Stripe</a>
        <a v-if="detail?.invoicePdfUrl" :href="detail.invoicePdfUrl" target="_blank" rel="noopener"
          class="rounded-full border border-border px-4 py-2.5 text-sm font-bold text-navy transition-colors hover:bg-surface">PDF</a>
        <button v-if="detail && isClaimable(detail)" type="button"
          class="cursor-pointer rounded-full bg-navy/10 px-4 py-2.5 text-sm font-bold text-navy transition-colors hover:bg-navy/20"
          @click="openRemind(detail)">Recordar</button>
        <button v-if="detail && isClaimable(detail)" type="button"
          class="cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg"
          @click="openManualPayment(detail)">Registrar pago</button>
      </template>
    </AppModal>

    <!-- ─── Recordar (REQ-BIL-05) ──────────────────────────────────────────── -->
    <AppModal v-if="remindTarget" size="md" title="Enviar recordatorio" :subtitle="remindTarget.hotelName" @close="remindTarget = null">
      <div class="space-y-3">
        <div class="rounded-xl bg-surface p-4">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Se va a enviar</div>
          <div class="mt-0.5 text-sm font-bold text-navy">{{ templateLabel(expectedTemplate(remindTarget)) }}</div>
          <p class="mt-1 text-[11px] text-text-muted">
            La plantilla la elige el estado de la factura y si el hotel tiene cobro automático. Se
            edita en Plantillas de correo; desde acá no se escribe el texto.
          </p>
        </div>
        <div class="rounded-xl bg-surface p-4">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Destinatario</div>
          <div class="mt-0.5 text-sm font-bold text-navy">{{ remindTarget.hotelEmail || 'El hotel no tiene correo cargado' }}</div>
        </div>
        <p class="text-[11px] text-text-muted">No se puede enviar más de un recordatorio cada 24 horas.</p>
      </div>
      <template #footer>
        <button type="button" class="cursor-pointer px-4 py-2.5 text-sm font-bold text-text-secondary" @click="remindTarget = null">Cancelar</button>
        <button type="button" :disabled="remindSending || !remindTarget.hotelEmail"
          class="cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg disabled:cursor-default disabled:opacity-50"
          @click="confirmRemind">{{ remindSending ? 'Enviando...' : 'Enviar' }}</button>
      </template>
    </AppModal>

    <!-- ─── Registrar pago manual (REQ-BIL-06) ─────────────────────────────── -->
    <AppModal v-if="payTarget" size="md" title="Registrar pago manual" :subtitle="payTarget.hotelName" @close="payTarget = null">
      <form class="space-y-3" @submit.prevent="confirmManualPayment">
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Monto</span>
            <input v-model.number="payForm.amount" type="number" step="0.01" min="0.01" required
              class="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm tabular-nums focus:border-navy focus:outline-none">
          </label>
          <label class="block">
            <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Moneda</span>
            <input v-model="payForm.currency" type="text" maxlength="3" required
              class="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm uppercase focus:border-navy focus:outline-none">
          </label>
        </div>
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Fecha del pago</span>
          <input v-model="payForm.paidAt" type="date" required :max="today"
            class="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm focus:border-navy focus:outline-none">
        </label>
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Referencia</span>
          <input v-model="payForm.reference" type="text" required placeholder="N° de transferencia, recibo..."
            class="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm focus:border-navy focus:outline-none">
        </label>
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Servicio pagado hasta</span>
          <input v-model="payForm.periodEnd" type="date" required
            class="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm focus:border-navy focus:outline-none">
          <span class="mt-1 block text-[11px] text-text-muted">La suscripción queda activa hasta esta fecha.</span>
        </label>
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Notas</span>
          <textarea v-model="payForm.notes" rows="2" class="mt-1 w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-navy focus:outline-none"></textarea>
        </label>
        <p class="rounded-xl bg-gold/10 px-3 py-2 text-[11px] font-bold text-gold">
          Esto marca la factura como pagada y reactiva el servicio del hotel. No se puede deshacer desde acá.
        </p>
      </form>
      <template #footer>
        <button type="button" class="cursor-pointer px-4 py-2.5 text-sm font-bold text-text-secondary" @click="payTarget = null">Cancelar</button>
        <button type="button" :disabled="paySaving || !payFormValid"
          class="cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg disabled:cursor-default disabled:opacity-50"
          @click="confirmManualPayment">{{ paySaving ? 'Registrando...' : 'Registrar pago' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
// /admin/billing — lo que los hoteles le pagan a la plataforma.
//
// La versión anterior no leía facturas: las FABRICABA desde `PlatformService.subscriptions()`
// (una fila por hotel), con el precio del plan como monto, `hotels.createdAt` como fecha de
// emisión —que ese endpoint no devuelve, por eso la columna salía vacía— y "Pagado" para todos.
// "Ver" reventaba en `selectedInvoice.hotel[0]` y los botones no llamaban a ningún endpoint.
//
// Ahora todo sale de `platform_invoices` a través de `PlatformBilling.service.ts`, los filtros y
// la paginación los resuelve el servidor, y las dos acciones (recordar, registrar pago) son
// llamadas reales que además dejan audit log.
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useToast } from '@/composables/useToast'
import { ApiError } from '@/services/http'
import {
  PlatformBillingService,
  type PlatformInvoice, type PlatformInvoiceDetail, type PlatformBillingStats,
} from '@/services/PlatformBilling.service'
import { PlansService, type Plan } from '@/services/Plans.service'
import {
  statusLabel, statusBadge, methodLabel, templateLabel, expectedTemplate,
  subscriptionStatusLabel, invoiceLabel, shortDate, money, isoFromDayInput,
} from '@/utils/platform-billing-labels'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import Icon from '@/components/ui/Icon.vue'

const toast = useToast()

const STATUS_OPTIONS = ['open', 'paid', 'failed', 'void', 'uncollectible'] as const
const PAGE_SIZE = 20
/** Días de servicio que se asumen al registrar un pago suelto (sin período en la factura). */
const DEFAULT_PERIOD_DAYS = 30
const MS_PER_DAY = 86_400_000

const loading = ref(true)
const loadingStats = ref(true)
const error = ref('')
const exporting = ref(false)

const invoices = ref<PlatformInvoice[]>([])
const total = ref(0)
const page = ref(1)
const stats = ref<PlatformBillingStats | null>(null)
const plans = ref<Plan[]>([])

const filters = reactive({ q: '', status: '', planId: '', from: '', to: '' })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const rangeLabel = computed(() => {
  const desde = (page.value - 1) * PAGE_SIZE + 1
  return `${desde}–${Math.min(desde + PAGE_SIZE - 1, total.value)} de ${total.value}`
})
const hasFilters = computed(() => Boolean(filters.q.trim() || filters.status || filters.planId || filters.from || filters.to))
const listSubtitle = computed(() => (loading.value ? 'Cargando...' : `${total.value} factura${total.value === 1 ? '' : 's'}${hasFilters.value ? ' (filtradas)' : ''}`))

const fmt = (n: number): string => Number(n ?? 0).toLocaleString('es-DO', { maximumFractionDigits: 0 })
const isClaimable = (i: { status: string }): boolean => i.status === 'open' || i.status === 'failed'
const timeOf = (iso: string): string => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}
const periodLabel = (i: PlatformInvoice): string => {
  const desde = shortDate(i.periodStart)
  const hasta = shortDate(i.periodEnd)
  if (desde && hasta) return `${desde} → ${hasta}`
  return desde || hasta
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await PlatformBillingService.list({ ...activeFilters(), page: page.value, limit: PAGE_SIZE })
    invoices.value = res.data
    total.value = res.total
  } catch (e) {
    // El error se muestra EN la tarjeta, no solo como un toast que se va a los 3 segundos: si la
    // lista está vacía por un fallo, el admin tiene que poder distinguirlo de "no hay facturas".
    error.value = e instanceof ApiError ? e.message : 'No se pudo cargar la facturación'
    invoices.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadStats(): Promise<void> {
  loadingStats.value = true
  try {
    stats.value = await PlatformBillingService.stats({ from: filters.from, to: filters.to })
  } catch {
    stats.value = null // sin números inventados: si no se pudieron traer, no se muestran
  } finally {
    loadingStats.value = false
  }
}

function activeFilters() {
  return { q: filters.q.trim(), status: filters.status, planId: filters.planId, from: filters.from, to: filters.to }
}

function clearFilters(): void {
  filters.q = ''
  filters.status = ''
  filters.planId = ''
  filters.from = ''
  filters.to = ''
}

// El texto se debouncea (cada tecla sería un request); los selects y las fechas van directo.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value === 1 ? load() : (page.value = 1) }, 350)
})
watch([() => filters.status, () => filters.planId], () => { page.value === 1 ? load() : (page.value = 1) })
// El rango de fechas también mueve las stats: los totales son del período que se está mirando.
watch([() => filters.from, () => filters.to], () => {
  loadStats()
  page.value === 1 ? load() : (page.value = 1)
})
watch(page, load)

onMounted(async () => {
  await Promise.all([load(), loadStats()])
  try {
    plans.value = (await PlansService.list()).data ?? []
  } catch {
    plans.value = [] // el filtro de plan se queda en "Todos"; el listado funciona igual
  }
})

async function exportCsv(): Promise<void> {
  exporting.value = true
  try {
    await PlatformBillingService.exportCsv(activeFilters())
    toast.success('CSV descargado', 'Se exportó lo que está filtrado, no solo esta página')
  } catch (e) {
    toast.error('No se pudo exportar', e instanceof ApiError ? e.message : undefined)
  } finally {
    exporting.value = false
  }
}

// ─── Detalle ──────────────────────────────────────────────────────────────────
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<PlatformInvoiceDetail | null>(null)

async function openDetail(row: PlatformInvoice | PlatformInvoiceDetail): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await PlatformBillingService.detail(row.id)
  } catch (e) {
    detailOpen.value = false
    toast.error('No se pudo abrir la factura', e instanceof ApiError ? e.message : undefined)
  } finally {
    detailLoading.value = false
  }
}

/** La ficha se declara como DATOS y se filtran los vacíos: sin filas de "—". */
const detailFields = computed(() => {
  const d = detail.value
  if (!d) return []
  return [
    { label: 'Hotel', value: d.hotelName },
    { label: 'Correo', value: d.hotelEmail },
    { label: 'Plan', value: d.planName },
    { label: 'Período', value: periodLabel(d) },
    { label: 'Método', value: methodLabel(d.method) },
    { label: 'Referencia', value: d.reference },
    { label: 'Emisión', value: shortDate(d.issuedAt) },
    { label: 'Vencimiento', value: shortDate(d.dueAt) },
    { label: 'Fecha de pago', value: shortDate(d.paidAt) },
    { label: 'Pagado', value: d.amountPaid ? money(d.amountPaid, d.currency) : '' },
    { label: 'Suscripción', value: d.subscriptionStatus ? subscriptionStatusLabel(d.subscriptionStatus) : '' },
    { label: 'Cobro', value: d.subscriptionStatus ? (d.isRecurring ? 'Automático con tarjeta' : 'Manual') : '' },
  ].filter((f) => Boolean(f.value))
})

// ─── Recordar ─────────────────────────────────────────────────────────────────
const remindTarget = ref<PlatformInvoiceDetail | null>(null)
const remindSending = ref(false)

async function openRemind(row: PlatformInvoice | PlatformInvoiceDetail): Promise<void> {
  // Hace falta el detalle: `isRecurring` y el correo del hotel no vienen en la fila del listado.
  const full = 'hotelEmail' in row ? row : await PlatformBillingService.detail(row.id).catch(() => null)
  if (!full) { toast.error('No se pudo abrir el recordatorio'); return }
  remindTarget.value = full
}

async function confirmRemind(): Promise<void> {
  const target = remindTarget.value
  if (!target) return
  remindSending.value = true
  try {
    const res = await PlatformBillingService.remind(target.id)
    toast.success('Recordatorio enviado', `${templateLabel(res.template)} → ${res.to}`)
    remindTarget.value = null
    if (detail.value?.id === target.id) detail.value = { ...detail.value, lastReminderAt: res.sentAt }
    await load()
  } catch (e) {
    // El 409 del backend trae el motivo REAL ("Ya se envió un recordatorio hoy a las 14:05"):
    // se muestra tal cual, no se reemplaza por un mensaje genérico.
    toast.error('No se envió', e instanceof ApiError ? e.message : 'Error inesperado')
  } finally {
    remindSending.value = false
  }
}

// ─── Pago manual ──────────────────────────────────────────────────────────────
const payTarget = ref<PlatformInvoiceDetail | null>(null)
const paySaving = ref(false)
const today = new Date().toISOString().slice(0, 10)
const payForm = reactive({ amount: 0, currency: 'USD', paidAt: today, reference: '', periodEnd: '', notes: '' })

const payFormValid = computed(() =>
  payForm.amount > 0 && payForm.currency.trim().length === 3 && !!payForm.paidAt && !!payForm.reference.trim() && !!payForm.periodEnd)

async function openManualPayment(row: PlatformInvoice | PlatformInvoiceDetail): Promise<void> {
  const full = 'hotelEmail' in row ? row : await PlatformBillingService.detail(row.id).catch(() => null)
  if (!full) { toast.error('No se pudo abrir el registro de pago'); return }
  payTarget.value = full
  payForm.amount = full.amountDue
  payForm.currency = full.currency || 'USD'
  payForm.paidAt = today
  payForm.reference = ''
  payForm.notes = ''
  // El período que ya trae la factura manda; si no tiene, un mes desde hoy (el ciclo habitual).
  payForm.periodEnd = full.periodEnd
    ? full.periodEnd.slice(0, 10)
    : new Date(Date.now() + DEFAULT_PERIOD_DAYS * MS_PER_DAY).toISOString().slice(0, 10)
}

async function confirmManualPayment(): Promise<void> {
  const target = payTarget.value
  if (!target || !payFormValid.value) return
  paySaving.value = true
  try {
    const res = await PlatformBillingService.manualPayment({
      hotelId: target.hotelId,
      invoiceId: target.id,
      amount: payForm.amount,
      currency: payForm.currency.trim().toUpperCase(),
      // Las fechas del formulario son `YYYY-MM-DD`; el backend espera ISO. Ver `isoFromDayInput`:
      // hoy viaja como el instante actual, o el backend lo lee como futuro y rechaza el pago.
      paidAt: isoFromDayInput(payForm.paidAt),
      periodEnd: isoFromDayInput(payForm.periodEnd),
      reference: payForm.reference.trim(),
      ...(payForm.notes.trim() ? { notes: payForm.notes.trim() } : {}),
    })
    if (res.warning) toast.warning('Pago registrado', res.warning)
    else toast.success('Pago registrado', `${target.hotelName} queda activo hasta ${shortDate(res.invoice.periodEnd || payForm.periodEnd)}`)
    payTarget.value = null
    // La fila se actualiza sin recargar la página: el estado sale del servidor, no de un parche local.
    if (detail.value?.id === res.invoice.id) detail.value = res.invoice
    await Promise.all([load(), loadStats()])
  } catch (e) {
    toast.error('No se pudo registrar el pago', e instanceof ApiError ? e.message : 'Error inesperado')
  } finally {
    paySaving.value = false
  }
}
</script>
