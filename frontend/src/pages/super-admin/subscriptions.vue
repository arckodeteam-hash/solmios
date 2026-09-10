<template>
  <div>
    <!-- ─── Analítica: el estado del negocio de suscripciones ─────────────── -->
    <div v-if="loading" class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="i in 4" :key="i" class="h-[132px] animate-pulse rounded-[16px] border border-border bg-surface"></div>
    </div>
    <div v-else class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiHeroCard
        label="MRR cobrado" :value="ingresos.mrr" prefix="$" icon="money" accent="green"
        :unit="`ARR $${fmt(ingresos.arr)} · ARPU $${fmt(ingresos.arpu)}`"
        :sub-stats="[
          { label: 'Suscripciones activas', value: ingresos.clientesPagos },
          { label: 'Con cobro automático', value: ingresos.conPagoConfigurado, tone: ingresos.conPagoConfigurado < ingresos.clientesPagos ? 'text-gold' : 'text-teal' },
        ]"
      />
      <KpiHeroCard
        label="En prueba" :value="trials.activos" icon="users" accent="amber"
        :unit="`$${fmt(ingresos.mrrEnTrial)}/mes si convierten`"
        :sub-stats="[{ label: 'Vencen en 7 días', value: trials.porVencer, tone: trials.porVencer ? 'text-gold' : 'text-navy' }]"
      />
      <KpiHeroCard
        label="Sin convertir" :value="riesgo.total" icon="money" accent="rose"
        :unit="`$${fmt(ingresos.mrrEnRiesgo)}/mes sin cobrar`"
        :sub-stats="[
          { label: 'Prueba vencida', value: riesgo.vencidos, tone: riesgo.vencidos ? 'text-danger' : 'text-navy' },
          { label: 'Dadas de baja', value: riesgo.expirados + riesgo.cancelados, tone: 'text-text-secondary' },
        ]"
      />
      <KpiHeroCard
        label="Conversión" :value="clientes.conversion ?? 0" suffix="%" icon="bookings" accent="teal"
        :progress="clientes.conversion ?? 0"
        :unit="clientes.conversion === null ? 'Todavía sin pruebas terminadas' : 'De las pruebas que ya terminaron'"
      />
    </div>

    <!-- ─── Distribución por estado: analítica y filtro a la vez ──────────── -->
    <SectionCard v-if="!loading && statusOptions.length" class="mb-6" title="Cartera por estado" :subtitle="`${subscriptions.length} hoteles · $${fmt(ingresos.mrr)}/mes facturados`">
      <template #actions>
        <router-link to="/admin/subscriptions/founders-pioneers"
          class="rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold text-white hover:bg-white/20">
          Cupos Fundador/Pionero
        </router-link>
      </template>

      <!-- Barra apilada: de un vistazo se ve cuánto de la cartera está pagando y cuánto colgado. -->
      <div class="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-surface">
        <div
          v-for="opt in statusOptions" :key="`bar-${opt.value}`"
          class="h-full transition-[width] duration-500" :class="opt.barra"
          :style="{ width: `${(opt.count / subscriptions.length) * 100}%` }"
          :title="`${opt.label}: ${opt.count}`"
        ></div>
      </div>

      <!-- Los chips FILTRAN: la analítica y el control son la misma cosa. -->
      <div class="flex flex-wrap gap-2">
        <button
          type="button" @click="statusFilter = ''"
          class="rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors"
          :class="statusFilter === '' ? 'border-navy bg-navy text-white' : 'border-border bg-white text-text-secondary hover:border-navy'"
        >Todas ({{ subscriptions.length }})</button>
        <button
          v-for="opt in statusOptions" :key="opt.value" type="button"
          @click="statusFilter = statusFilter === opt.value ? '' : opt.value"
          class="flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors"
          :class="statusFilter === opt.value ? 'border-navy bg-navy text-white' : 'border-border bg-white text-text-secondary hover:border-navy'"
        >
          <span class="h-2 w-2 rounded-full" :class="opt.barra"></span>
          {{ opt.label }} ({{ opt.count }})
          <span v-if="opt.mrr" class="font-black" :class="statusFilter === opt.value ? 'text-cyan' : 'text-teal'">${{ fmt(opt.mrr) }}</span>
        </button>
      </div>
    </SectionCard>

    <!-- ─── Listado ────────────────────────────────────────────────────────── -->
    <SectionCard title="Suscripciones por hotel" :subtitle="listSubtitle" body-class="p-0">
      <template #actions>
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative">
            <input v-model="searchQuery" type="text" placeholder="Buscar hotel..."
              class="h-9 w-52 rounded-lg border border-white/15 bg-white/10 pl-9 pr-4 text-sm text-white placeholder:text-white/45 focus:border-cyan focus:outline-none">
            <svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <form class="flex items-center gap-2" @submit.prevent="searchByEmail">
            <input v-model="emailQuery" type="email" placeholder="Email de la cuenta..."
              class="h-9 w-52 rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white placeholder:text-white/45 focus:border-cyan focus:outline-none">
            <button type="submit" :disabled="searchingByEmail || !emailQuery"
              class="h-9 cursor-pointer rounded-lg bg-cyan px-4 text-xs font-extrabold text-navy transition-all hover:shadow-lg disabled:opacity-50">
              {{ searchingByEmail ? 'Buscando...' : 'Buscar cuenta' }}
            </button>
          </form>
        </div>
      </template>

      <SkeletonLoader v-if="loading" variant="table" :rows="6" class="p-4" />
      <EmptyState
        v-else-if="!filteredSubscriptions.length"
        title="Sin resultados"
        :message="hasFilters ? 'Ningún hotel coincide con los filtros aplicados.' : 'Todavía no hay hoteles con suscripción.'"
      >
        <template v-if="hasFilters" #action>
          <button type="button" class="cursor-pointer rounded-full border border-border bg-surface px-4 py-2 text-xs font-bold text-navy transition-colors hover:bg-surface-dark" @click="clearFilters">
            Limpiar filtros
          </button>
        </template>
      </EmptyState>
      <div v-else class="overflow-x-auto">
        <table class="tbl-head w-full min-w-[820px]">
          <thead>
            <tr class="border-b border-border">
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Hotel</th>
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Plan</th>
              <!-- La columna solo existe si algún hotel tiene categoría: 17 filas de "—" no
                   son información, son ruido. -->
              <th v-if="hayCategorias" class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Categoría</th>
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Estado</th>
              <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Vence / renueva</th>
              <th class="hidden p-4 text-left text-[10px] font-bold uppercase text-text-muted lg:table-cell">Cobro</th>
              <th class="p-4 text-right text-[10px] font-bold uppercase text-text-muted">$/mes</th>
              <th class="p-4 text-right text-[10px] font-bold uppercase text-text-muted">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pagina" :key="row.hotelId" class="border-b border-border transition-colors last:border-0 hover:bg-surface/50">
              <td class="p-4">
                <div class="text-sm font-bold text-navy">{{ row.hotelName }}</div>
                <div v-if="!row.hasStripeCustomer && row.status === 'active'" class="text-[10px] font-bold text-gold">Cobro manual</div>
              </td>
              <td class="p-4">
                <span v-if="row.planName" class="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-bold text-navy">{{ row.planName }}</span>
                <span v-else class="text-xs text-text-muted">Sin plan</span>
              </td>
              <td v-if="hayCategorias" class="p-4">
                <span v-if="row.specialCategory" class="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">{{ categoryLabel(row.specialCategory) }}</span>
              </td>
              <td class="p-4">
                <!-- El estado que se muestra es el EFECTIVO: un `trialing` con la fecha pasada
                     es una prueba vencida, no una prueba en curso. Antes salía en verde como
                     si estuviera corriendo, con la fecha de vencimiento al lado. -->
                <span class="rounded-full px-2 py-1 text-[10px] font-bold" :class="statusClass(estadoEfectivo(row))">
                  {{ statusLabel(estadoEfectivo(row)) }}
                </span>
              </td>
              <td class="p-4">
                <div class="text-sm" :class="diasDe(row) !== null && diasDe(row)! < 0 ? 'font-bold text-danger' : 'text-text-secondary'">
                  {{ periodLabel(row) }}
                </div>
                <div v-if="relativoDe(row)" class="text-[10px]" :class="diasDe(row)! < 0 ? 'text-danger' : 'text-text-muted'">{{ relativoDe(row) }}</div>
              </td>
              <td class="hidden p-4 text-sm lg:table-cell">
                <span v-if="row.hasStripeCustomer" class="font-bold text-teal">Stripe</span>
                <span v-else class="text-text-muted">Sin cobrar</span>
              </td>
              <td class="p-4 text-right">
                <div class="text-sm font-black tabular-nums" :class="row.mrr ? 'text-navy' : 'text-text-muted'">
                  {{ row.mrr ? `$${fmt(row.mrr)}` : (precioDe(row) ? `$${fmt(precioDe(row))}` : '—') }}
                </div>
                <div v-if="!row.mrr && precioDe(row)" class="text-[10px] text-text-muted">potencial</div>
              </td>
              <td class="p-4 text-right">
                <button type="button" :aria-label="`Condiciones especiales de ${row.hotelName}`"
                  class="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-text-muted transition-colors hover:bg-navy/10 hover:text-navy"
                  @click="openConditions(row.hotelId, row.hotelName)">
                  <Icon name="edit" :size="15" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!loading && filteredSubscriptions.length" class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <span class="text-xs text-text-muted">{{ rangoLabel }}</span>
        <div v-if="totalPaginas > 1" class="flex items-center gap-1.5">
          <button type="button" :disabled="paginaActual === 1" @click="paginaActual--"
            class="h-8 cursor-pointer rounded-lg border border-border px-3 text-xs font-bold text-navy transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-40">Anterior</button>
          <span class="px-2 text-xs font-bold tabular-nums text-text-secondary">{{ paginaActual }} / {{ totalPaginas }}</span>
          <button type="button" :disabled="paginaActual === totalPaginas" @click="paginaActual++"
            class="h-8 cursor-pointer rounded-lg border border-border px-3 text-xs font-bold text-navy transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-40">Siguiente</button>
        </div>
      </div>
    </SectionCard>

    <SpecialConditionsModal v-if="conditionsTarget" :hotel-id="conditionsTarget.hotelId" :hotel-name="conditionsTarget.hotelName"
      @close="conditionsTarget = null" @saved="onConditionsSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { PlatformService } from '@/services/Platform.service'
import { SubscriptionsAdminService, type SpecialCategoryKey } from '@/services/SubscriptionsAdmin.service'
import { SuperAdminService, type PlatformMetrics } from '@/services/SuperAdmin.service'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SpecialConditionsModal from '@/components/features/SpecialConditionsModal.vue'

const MS_POR_DIA = 86_400_000

/** Fila real de GET /api/admin/subscriptions (dashboard-queries.ts:listSubscriptions —
 * cruce de Hotels + Subscriptions + Plans, no el `hotels.plan` de texto libre). */
interface SubscriptionRow {
  hotelId: string
  hotelName: string
  status: string
  planId: string
  planName: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  canceledAt: string | null
  hasStripeCustomer: boolean
  mrr: number
  specialCategory?: SpecialCategoryKey | null
}

const toast = useToast()
const searchQuery = ref('')
// BIL-4: /admin/billing enlaza a `?hotel=<id>` desde el detalle de una factura. Sin esto el link
// aterrizaba en la lista completa y había que buscar el hotel a mano.
const route = useRoute()
const hotelIdFilter = ref(String(route.query.hotel ?? ''))
const statusFilter = ref('')
const emailQuery = ref('')
const searchingByEmail = ref(false)
const loading = ref(true)
const subscriptions = ref<SubscriptionRow[]>([])
const metrics = ref<PlatformMetrics | null>(null)
const conditionsTarget = ref<{ hotelId: string; hotelName: string } | null>(null)

// El envelope del framework (buildEnvelope en kernel/http/server.ts) solo deja pasar
// `data`+`meta.pagination` cuando el body trae un array `data` con `total` — cualquier otra
// clave del body (acá, `mrrTotal`) se descarta antes de llegar al fetch. Se recalcula del
// lado del cliente sumando `mrr` de cada fila, que sí viaja dentro de `data`.
const mrrTotal = computed(() => subscriptions.value.reduce((s, r) => s + Number(r.mrr || 0), 0))

// Las métricas salen del MISMO endpoint que el dashboard: si acá se recalcularan las reglas
// (qué cuenta como MRR, qué es un trial vencido) las dos pantallas terminarían discrepando.
const VACIO = {
  ingresos: { mrr: 0, arr: 0, arpu: 0, clientesPagos: 0, mrrEnTrial: 0, mrrEnRiesgo: 0, conPagoConfigurado: 0 },
  clientes: { conversion: null as number | null },
  trials: { activos: 0, vencidos: 0, porVencer: 0 },
  riesgo: { total: 0, vencidos: 0, expirados: 0, cancelados: 0 },
}
const ingresos = computed(() => metrics.value?.ingresos ?? VACIO.ingresos)
const clientes = computed(() => metrics.value?.clientes ?? VACIO.clientes)
const trials = computed(() => metrics.value?.trials ?? VACIO.trials)
const riesgo = computed(() => metrics.value?.riesgo ?? VACIO.riesgo)

function fmt(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString('en-US')
}

/** Precio de lista del plan, para poder mostrar cuánto vale una cuenta que todavía no paga. */
const precioPorPlan = computed(() => new Map((metrics.value?.planMix ?? []).map((p) => [p.name, p.price])))
function precioDe(row: SubscriptionRow): number {
  return precioPorPlan.value.get(row.planName) ?? 0
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'En prueba', trial_expired: 'Prueba vencida', active: 'Activa', past_due: 'Pago pendiente',
  expired: 'Vencida', canceled: 'Cancelada', suspended: 'Suspendida', none: 'Sin suscripción',
}
const STATUS_ORDER = Object.keys(STATUS_LABELS)
const statusLabel = (s: string): string => STATUS_LABELS[s] ?? s
const statusClass = (s: string): string => ({
  active: 'bg-teal/10 text-teal',
  trialing: 'bg-cyan/10 text-cyan',
  past_due: 'bg-warning/10 text-warning',
  trial_expired: 'bg-danger/10 text-danger',
  none: 'bg-surface text-text-muted',
}[s] ?? 'bg-danger/10 text-danger') // expired / canceled / suspended

const STATUS_BARRA: Record<string, string> = {
  active: 'bg-teal', trialing: 'bg-cyan', trial_expired: 'bg-danger', past_due: 'bg-gold',
  expired: 'bg-danger/60', canceled: 'bg-text-muted', suspended: 'bg-danger/40', none: 'bg-border',
}

const CATEGORY_LABELS: Record<string, string> = { founder_one: 'Fundador Uno', founder_two: 'Fundador Dos', pioneer: 'Pionero' }
const categoryLabel = (key?: string | null): string => (key ? CATEGORY_LABELS[key] ?? key : '')

const hayCategorias = computed(() => subscriptions.value.some((r) => !!r.specialCategory))

/** Fecha que aplica según el estado: fin de prueba mientras está probando, fin de período si paga. */
function fechaDe(row: SubscriptionRow): string | null {
  return row.status === 'trialing' ? row.trialEndsAt : row.currentPeriodEnd
}
function diasDe(row: SubscriptionRow): number | null {
  const f = fechaDe(row)
  if (!f) return null
  const t = new Date(f).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / MS_POR_DIA)
}
function periodLabel(row: SubscriptionRow): string {
  const f = fechaDe(row)
  return f ? new Date(f).toLocaleDateString('es-DO') : '—'
}
function relativoDe(row: SubscriptionRow): string {
  const d = diasDe(row)
  if (d === null) return ''
  if (d < 0) return `hace ${Math.abs(d)} ${Math.abs(d) === 1 ? 'día' : 'días'}`
  if (d === 0) return 'hoy'
  return `en ${d} ${d === 1 ? 'día' : 'días'}`
}

/**
 * Estado que ve el admin. Un `trialing` cuya fecha ya pasó NO está en prueba: la prueba se
 * venció y nadie la cortó ni la convirtió. La base sigue diciendo `trialing` (no hay proceso
 * que la actualice), así que la corrección se hace acá para no mostrar un badge verde sobre
 * una cuenta que hace 44 días dejó de tener derecho a usar el sistema.
 */
function estadoEfectivo(row: SubscriptionRow): string {
  if (row.status !== 'trialing') return row.status || 'none'
  const d = diasDe(row)
  return d === null || d < 0 ? 'trial_expired' : 'trialing'
}

/** Solo los estados que existen en los datos, con su conteo y lo que factura cada grupo. */
const statusOptions = computed(() => {
  const acc = new Map<string, { count: number; mrr: number }>()
  for (const row of subscriptions.value) {
    const key = estadoEfectivo(row)
    const cur = acc.get(key) ?? { count: 0, mrr: 0 }
    cur.count += 1
    cur.mrr += Number(row.mrr || 0)
    acc.set(key, cur)
  }
  return [...acc.entries()]
    .sort((a, b) => {
      const ia = STATUS_ORDER.indexOf(a[0])
      const ib = STATUS_ORDER.indexOf(b[0])
      return (ia < 0 ? STATUS_ORDER.length : ia) - (ib < 0 ? STATUS_ORDER.length : ib)
    })
    .map(([value, v]) => ({ value, label: statusLabel(value), count: v.count, mrr: v.mrr, barra: STATUS_BARRA[value] ?? 'bg-border' }))
})

function openConditions(hotelId: string, hotelName: string): void {
  conditionsTarget.value = { hotelId, hotelName }
}
function onConditionsSaved(): void {
  cargar()
}
async function searchByEmail(): Promise<void> {
  if (!emailQuery.value) return
  searchingByEmail.value = true
  try {
    const result = await SubscriptionsAdminService.search(emailQuery.value)
    conditionsTarget.value = { hotelId: result.hotelId, hotelName: result.hotelName }
  } catch (e: any) {
    toast.error(e.message || 'No se encontró ninguna cuenta con ese email')
  } finally {
    searchingByEmail.value = false
  }
}

/** Urgencia comercial arriba: lo vencido primero, y de eso lo más viejo. */
const URGENCIA: Record<string, number> = {
  past_due: 0, trial_expired: 1, trialing: 2, none: 3, active: 4, expired: 5, suspended: 6, canceled: 7,
}
const filteredSubscriptions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return subscriptions.value
    .filter((s) => {
      if (hotelIdFilter.value && s.hotelId !== hotelIdFilter.value) return false
      if (statusFilter.value && estadoEfectivo(s) !== statusFilter.value) return false
      if (q && !s.hotelName?.toLowerCase().includes(q)) return false
      return true
    })
    .sort((a, b) => {
      const ua = URGENCIA[estadoEfectivo(a)] ?? 9
      const ub = URGENCIA[estadoEfectivo(b)] ?? 9
      if (ua !== ub) return ua - ub
      const da = diasDe(a)
      const db = diasDe(b)
      if (da !== null && db !== null && da !== db) return da - db
      return a.hotelName.localeCompare(b.hotelName)
    })
})

const POR_PAGINA = 20
const paginaActual = ref(1)
const totalPaginas = computed(() => Math.max(1, Math.ceil(filteredSubscriptions.value.length / POR_PAGINA)))
const pagina = computed(() => {
  const desde = (paginaActual.value - 1) * POR_PAGINA
  return filteredSubscriptions.value.slice(desde, desde + POR_PAGINA)
})
const rangoLabel = computed(() => {
  const total = filteredSubscriptions.value.length
  const desde = (paginaActual.value - 1) * POR_PAGINA + 1
  return `${desde}–${Math.min(desde + POR_PAGINA - 1, total)} de ${total}`
})
// Filtrar con la página 3 abierta dejaba la tabla vacía sin decir por qué.
watch([searchQuery, statusFilter, hotelIdFilter], () => { paginaActual.value = 1 })

const hasFilters = computed(() => Boolean(searchQuery.value.trim() || statusFilter.value || hotelIdFilter.value))

const listSubtitle = computed(() => {
  const total = subscriptions.value.length
  const shown = filteredSubscriptions.value.length
  const head = hasFilters.value ? `${shown} de ${total} hoteles` : `${total} hoteles`
  return `${head} · MRR total $${fmt(mrrTotal.value)}/mes`
})

function clearFilters(): void {
  searchQuery.value = ''
  statusFilter.value = ''
  hotelIdFilter.value = '' // incluye el que llegó por `?hotel=`: si no, no habría forma de sacarlo
}

async function cargar(): Promise<void> {
  loading.value = true
  try {
    const res = await PlatformService.subscriptions()
    subscriptions.value = res.data ?? []
  } catch {
    toast.error('No se pudieron cargar las suscripciones')
  } finally {
    loading.value = false
  }
  // Las tarjetas de arriba son un extra: si fallan, el listado igual se ve.
  try {
    metrics.value = await SuperAdminService.platformMetrics()
  } catch {
    metrics.value = null
  }
}

onMounted(cargar)
</script>

<style scoped></style>
