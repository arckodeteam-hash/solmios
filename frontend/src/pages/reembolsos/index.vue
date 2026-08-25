<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 gap-3 flex-wrap">
      <div>
        <h2 class="text-xl font-black text-navy">Reembolsos</h2>
        <p class="text-sm text-text-muted mt-0.5">Gastos del personal — enviar, aprobar y reintegrar</p>
      </div>
      <button v-if="canCreate" @click="openNew" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo reembolso
      </button>
    </div>

    <!-- KPIs — KpiHeroCard (mismo lenguaje visual que el resto del panel) -->
    <div v-if="totals" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Enviados" :value="totals.submitted.amount" icon="bookings" accent="amber"
        prefix="DOP " :unit="`${totals.submitted.count} solicitud(es) esperando aprobación`" />
      <KpiHeroCard label="Por pagar" :value="totals.approved.amount" icon="money" accent="blue"
        prefix="DOP " :unit="`${totals.approved.count} aprobado(s) pendiente(s) de reintegro`" />
      <KpiHeroCard label="Pagados" :value="totals.paid.amount" icon="checkout" accent="teal"
        prefix="DOP " :unit="`${totals.paid.count} reintegro(s) completado(s)`" />
    </div>

    <!-- Listado -->
    <SectionCard title="Solicitudes de reembolso" :subtitle="listSubtitle" body-class="p-0">
      <template #actions>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" v-html="ICON_SEARCH"></span>
          <input id="reembolsos-search-query" name="searchQuery" aria-label="Buscar empleado, descripción o categoría"
            v-model="searchQuery"
            type="text"
            placeholder="Buscar empleado, descripción o categoría..."
            class="w-full sm:w-72 pl-9 pr-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-cyan focus:bg-white/15 transition-colors"
          />
        </div>
        <select id="reembolsos-filter-status" name="filterStatus" aria-label="Filtrar reembolsos por estado" v-model="filterStatus" class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="all">Todos los estados</option>
          <option class="text-navy" value="draft">Borrador</option>
          <option class="text-navy" value="submitted">Enviado</option>
          <option class="text-navy" value="approved">Aprobado</option>
          <option class="text-navy" value="rejected">Rechazado</option>
          <option class="text-navy" value="paid">Pagado</option>
        </select>
      </template>

      <!-- Carga -->
      <div v-if="loading" class="divide-y divide-border">
        <div v-for="i in 6" :key="i" class="flex items-center gap-4 px-4 py-4">
          <div class="h-9 w-9 shrink-0 animate-pulse rounded-full bg-surface"></div>
          <div class="flex-1 space-y-2">
            <div class="h-3 w-40 animate-pulse rounded bg-surface"></div>
            <div class="h-2.5 w-64 animate-pulse rounded bg-surface"></div>
          </div>
          <div class="h-3 w-24 animate-pulse rounded bg-surface"></div>
          <div class="h-5 w-20 animate-pulse rounded-full bg-surface"></div>
        </div>
      </div>

      <EmptyState
        v-else-if="!filteredClaims.length"
        :icon="ICON_RECEIPT_EMPTY"
        :title="hasFilters ? 'Sin resultados' : 'Todavía no hay reembolsos'"
        :message="hasFilters
          ? 'Probá con otro término de búsqueda o quitá el filtro de estado.'
          : 'Registrá el primer gasto del personal para empezar a llevar el control de reintegros.'"
      >
        <template v-if="hasFilters || canCreate" #action>
          <button v-if="hasFilters" @click="clearFilters" class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Limpiar filtros
          </button>
          <button v-else @click="openNew" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo reembolso
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px] tbl-head text-sm">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Empleado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Descripción</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Fecha</th>
              <th class="text-right px-4 py-3 text-[10px]">Monto</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in filteredClaims" :key="c.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-[11px] font-black text-navy">
                    {{ initialsOf(c.employeeId) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-navy truncate">{{ nameOf(c.employeeId) }}</div>
                    <!-- En <lg la descripción y la fecha suben acá (sus columnas están ocultas). -->
                    <div class="text-[11px] text-text-muted truncate lg:hidden">{{ c.description }}</div>
                    <div class="text-[11px] text-text-muted xl:hidden">{{ c.date }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <div class="text-sm text-text-secondary truncate max-w-[280px]">{{ c.description }}</div>
                <div v-if="c.category" class="text-[11px] text-text-muted truncate">{{ c.category }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary whitespace-nowrap hidden xl:table-cell">{{ c.date }}</td>
              <td class="px-4 py-3 text-right text-sm font-extrabold text-navy tabular-nums whitespace-nowrap">{{ money(c.amount, c.currency) }}</td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide" :class="statusClass(c.status)">
                  {{ statusLabel(c.status) }}
                </span>
                <div v-if="c.status === 'rejected' && c.rejectReason" class="mt-1 max-w-[220px] truncate text-[11px] text-coral" :title="c.rejectReason">
                  {{ c.rejectReason }}
                </div>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button v-if="c.status === 'draft'" @click="submit(c)" title="Enviar a aprobación"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-gold/15 hover:text-gold transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_SEND"></span>
                  </button>
                  <button v-if="c.status === 'submitted'" @click="approve(c)" title="Aprobar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-teal/15 hover:text-teal transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CHECK"></span>
                  </button>
                  <button v-if="c.status === 'submitted'" @click="reject(c)" title="Rechazar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/15 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_X"></span>
                  </button>
                  <button v-if="c.status === 'approved'" @click="pay(c)" title="Registrar pago"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_WALLET"></span>
                  </button>
                  <span v-if="c.status === 'paid'" class="text-[11px] font-bold text-teal">Reintegrado</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <FormModal
      v-if="formModal"
      :title="formModal.title"
      :fields="formModal.fields"
      :submit-label="formModal.submitLabel"
      :loading="saving"
      @close="formModal = null"
      @submit="submitForm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ReembolsosService, type ExpenseClaim, type ClaimTotals } from '@/services/Reembolsos.service'
import { EmpleadosService, type EmployeeProfile } from '@/services/Empleados.service'
import { useToast } from '@/composables/useToast'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { CurrencyCode } from '@/types/currency'
import { usePermissions } from '@/composables/usePermissions'

type FormValues = Record<string, string | number>

const toast = useToast()
// /panel/rrhh/* → módulo de permiso `users` (config/module-map.ts). Sin `users:create` el alta
// termina en 403: el botón no se muestra.
const { can } = usePermissions()
const canCreate = computed(() => can('users', 'create'))
const loading = ref(true)
const saving = ref(false)
const claims = ref<ExpenseClaim[]>([])
const totals = ref<ClaimTotals | null>(null)
const profiles = ref<EmployeeProfile[]>([])
const formModal = ref<{ title: string; submitLabel: string; fields: FormField[]; onSubmit: (v: FormValues) => Promise<unknown> } | null>(null)

// Filtros de vista (solo cliente — no cambian la consulta al backend).
const searchQuery = ref('')
const filterStatus = ref('all')

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>'
const ICON_SEND = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.5 4.5a.5.5 0 0 1 .7-.6l16 7.6a.5.5 0 0 1 0 .9l-16 7.6a.5.5 0 0 1-.7-.6L6 12Zm0 0h7"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>'
const ICON_X = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 12h.01M3 10h18"/></svg>'
const ICON_RECEIPT_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 3.5v17l2-1.2 2 1.2 2-1.2 2 1.2 2-1.2 2 1.2v-17l-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2L6 3.5Zm3 5h6m-6 4h6"/></svg>'

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Borrador', cls: 'bg-surface text-text-muted' },
  submitted: { label: 'Enviado', cls: 'bg-gold/10 text-gold' },
  approved: { label: 'Aprobado', cls: 'bg-cyan/10 text-cyan' },
  rejected: { label: 'Rechazado', cls: 'bg-coral/10 text-coral' },
  paid: { label: 'Pagado', cls: 'bg-teal/10 text-teal' },
}
function statusLabel(s: string) { return STATUS[s]?.label ?? s }
function statusClass(s: string) { return STATUS[s]?.cls ?? '' }
function money(n: number, currency: string = CurrencyCode.DOP) { return `${currency} ${(Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}` }
function nameOf(employeeId: string) {
  const p = profiles.value.find((x) => x.id === employeeId)
  return p?.userName || p?.position || employeeId.slice(0, 8)
}
function initialsOf(employeeId: string) {
  return nameOf(employeeId).trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '·'
}

const hasFilters = computed(() => searchQuery.value.trim() !== '' || filterStatus.value !== 'all')

const filteredClaims = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return claims.value.filter((c) => {
    if (filterStatus.value !== 'all' && c.status !== filterStatus.value) return false
    if (!q) return true
    return `${nameOf(c.employeeId)} ${c.description} ${c.category}`.toLowerCase().includes(q)
  })
})

const listSubtitle = computed(() => `${filteredClaims.value.length} de ${claims.value.length} solicitud(es)`)

function clearFilters() {
  searchQuery.value = ''
  filterStatus.value = 'all'
}

async function load() {
  loading.value = true
  try {
    const [c, t, p] = await Promise.all([ReembolsosService.list(), ReembolsosService.totals(), EmpleadosService.listProfiles()])
    claims.value = c; totals.value = t; profiles.value = p.data ?? []
  } catch { toast.error('No se pudieron cargar los reembolsos') }
  finally { loading.value = false }
}
onMounted(load)

const employeeOptions = () => profiles.value.map((p) => ({ value: p.id, label: p.userName || p.position || p.id }))

function openNew() {
  formModal.value = {
    title: 'Nuevo reembolso', submitLabel: 'Crear',
    fields: [
      { key: 'employeeId', label: 'Empleado', type: 'select', required: true, options: employeeOptions() },
      { key: 'description', label: 'Descripción', required: true, maxLength: 300, placeholder: 'Taxi al aeropuerto' },
      { key: 'category', label: 'Categoría', placeholder: 'transporte, comida…', maxLength: 40 },
      { key: 'amount', label: 'Monto', type: 'number', required: true, min: 0, max: 99_999_999 },
      { key: 'date', label: 'Fecha del gasto', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
    ],
    onSubmit: (v) => ReembolsosService.create(v),
  }
}

async function submit(c: ExpenseClaim) {
  try { await ReembolsosService.submit(c.id); toast.success('Enviado a aprobación'); load() }
  catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
}
async function approve(c: ExpenseClaim) {
  try { await ReembolsosService.approve(c.id); toast.success('Aprobado'); load() }
  catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
}
function reject(c: ExpenseClaim) {
  formModal.value = {
    title: `Rechazar reembolso`, submitLabel: 'Rechazar',
    fields: [{ key: 'reason', label: 'Motivo del rechazo', type: 'textarea', required: true, maxLength: 500 }],
    onSubmit: (v) => ReembolsosService.reject(c.id, String(v.reason ?? '')),
  }
}
function pay(c: ExpenseClaim) {
  formModal.value = {
    title: `Pagar reembolso (${money(c.amount, c.currency)})`, submitLabel: 'Registrar pago',
    fields: [{ key: 'paymentMethod', label: 'Método de pago', type: 'select', required: true, default: 'cash', options: [
      { value: 'cash', label: 'Efectivo' }, { value: 'transfer', label: 'Transferencia' }, { value: 'payroll', label: 'Con la nómina' },
    ] }],
    onSubmit: (v) => ReembolsosService.pay(c.id, String(v.paymentMethod)),
  }
}

async function submitForm(values: FormValues) {
  if (!formModal.value) return
  saving.value = true
  try { await formModal.value.onSubmit(values); toast.success('Guardado'); formModal.value = null; load() }
  catch (e) { toast.error(e instanceof Error ? e.message : 'Error al guardar') }
  finally { saving.value = false }
}
</script>
