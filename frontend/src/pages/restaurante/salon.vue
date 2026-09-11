<script setup lang="ts">
// pages/restaurante/salon.vue — Mapa de mesas del salón (RES-7). Click en mesa libre abre una comanda
// dine_in y navega a la toma de comanda; click en mesa con comanda abierta navega a esa comanda.
// Incluye alta/edición/baja de mesas y comandas sin mesa (room service / para llevar).
// #210 — la mesa libre pregunta los comensales antes de abrir: un solo toque sobre el número (no un
// formulario), porque acá se está parado frente al cliente. Lo usa el ticket promedio por comensal.
// #211 — el salón escucha el canal en vivo (useRestaurantEvents): cuando cocina marca un plato "Lista"
// la mesa muestra un punto verde en ≤2 s, y las mesas se ocupan/liberan solas al abrir o cerrar una
// comanda desde otra tablet. Sin stream, polling cada 15 s.
// #204 — zonas en pestañas (PillTabs, `?tab=`), el refresco (evento o polling) nunca vacía la lista y
// se pausa con un modal abierto, cada mesa ocupada muestra hora / tiempo / total / mozo, acciones de
// mesa en un menú "⋯" siempre visible (tablet táctil: no hay hover) y `occupied` sin comanda en ámbar.
// La lógica pura vive en salon-helpers.ts.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  RestaurantService,
  type RestaurantTable, type Order, type KdsTicket,
  TABLE_STATUS_LABELS, ORDER_TYPE_LABELS,
} from '@/services/Restaurant.service'
import { TeamService } from '@/services/Team.service'
import { SettingsService } from '@/services/Settings.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import { useRestaurantEvents } from '@/composables/useRestaurantEvents'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PillTabs from '@/components/ui/PillTabs.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePermissions } from '@/composables/usePermissions'
import { openModalCount } from '@/composables/useModalStack'
import {
  ALL_TAB, LOOSE_TAB, isLiveOrder, groupByZone, zoneTabs, tableState, TABLE_STATE_CLASSES, TABLE_STATE_LABELS,
  hhmm, elapsedLabel, updatedAgoLabel, resolveWaiter,
} from './salon-helpers'

const router = useRouter()
const toast = useToast()
const { can } = usePermissions()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Mesa eliminada'),
  onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudo eliminar'),
})

const loading = ref(true)
const saving = ref(false)
const opening = ref(false)
const tables = ref<RestaurantTable[]>([])
const openOrders = ref<Order[]>([])
// #211 — cola de cocina: de acá sale "hay algo listo para llevar" por mesa (línea en `ready`).
const kitchen = ref<KdsTicket[]>([])
const REFRESH_MS = 15000
// #204 — mozo por `users.id` (TeamService.list → /usuarios) y moneda del hotel para el total de la mesa.
const usersById = ref<Map<string, string>>(new Map())
const currency = ref<string>(CurrencyCode.USD)
const money = (n: number): string => `${currencySymbol(currency.value)}${Number(n || 0).toFixed(2)}`

const createPerm = computed(() => can('restaurant', 'create'))
const editPerm = computed(() => can('restaurant', 'edit'))
const deletePerm = computed(() => can('restaurant', 'delete'))

// Estados "vivos" de una comanda: salon-helpers.isLiveOrder (processing_payment incluido).
const orderByTable = computed(() => {
  const map = new Map<string, Order>()
  for (const o of openOrders.value) if (o.tableId && isLiveOrder(o)) map.set(o.tableId, o)
  return map
})
const looseOrders = computed(() => openOrders.value.filter((o) => !o.tableId && isLiveOrder(o)))

/** Mesas con al menos un plato listo en cocina y todavía no servido → punto verde. */
const readyTables = computed(() => {
  const set = new Set<string>()
  for (const t of kitchen.value) if (t.order.tableId && t.lines.some((l) => l.status === 'ready')) set.add(t.order.tableId)
  return set
})
const readyLooseOrders = computed(() => {
  const set = new Set<string>()
  for (const t of kitchen.value) if (!t.order.tableId && t.lines.some((l) => l.status === 'ready')) set.add(t.order.id)
  return set
})

const occupiedCount = computed(() => orderByTable.value.size)
const freeCount = computed(() => tables.value.filter((t) => tableState(t, orderByTable.value.get(t.id)) === 'free').length)
const openOrdersCount = computed(() => openOrders.value.filter(isLiveOrder).length)

// #204 — zonas como pestañas. `all` agrupa por zona con subtítulo; una zona muestra solo sus mesas;
// `loose` las comandas sin mesa. La activa vive en `?tab=` (PillTabs query-param).
const zones = computed(() => groupByZone(tables.value))
const tab = ref<string>(ALL_TAB)
const tabs = computed(() => zoneTabs(tables.value, looseOrders.value.length))
const visibleZones = computed(() => (tab.value === ALL_TAB ? zones.value : zones.value.filter((z) => z.slug === tab.value)))
// Si la zona activa desaparece (se renombró/borró su última mesa), volver a "Todas" y no a una pantalla vacía.
watch(tabs, (list) => { if (!list.some((t) => t.value === tab.value)) tab.value = ALL_TAB })

const stateOf = (t: RestaurantTable) => tableState(t, orderByTable.value.get(t.id))
const tableClasses = (t: RestaurantTable): string => TABLE_STATE_CLASSES[stateOf(t)]
const waiterOf = (o: Order) => resolveWaiter(usersById.value, o.waiterId)

// #204 — `now` late cada segundo para "hace N min" / "actualizado hace N s".
const TICK_MS = 1_000
const now = ref(Date.now())
const lastUpdated = ref<number | null>(null)
const refreshing = ref(false)
const updatedAgo = computed(() => updatedAgoLabel(lastUpdated.value, now.value))
let tickTimer: ReturnType<typeof setInterval> | null = null

/**
 * Carga mesas + comandas + cola de cocina. Sin spinner (`showSpinner=false`, el refresco) NO toca
 * `loading` ni vacía las listas: las reemplaza recién cuando llegaron las tres respuestas, así la
 * grilla no parpadea ni se resetea el scroll. Un fallo en segundo plano no interrumpe al mozo.
 */
async function load(showSpinner = true) {
  if (showSpinner) loading.value = true
  else {
    if (refreshing.value) return
    refreshing.value = true
  }
  try {
    const [tb, ord, kds] = await Promise.all([
      RestaurantService.listTables(),
      RestaurantService.listOrders(),
      RestaurantService.kdsQueue(),
    ])
    tables.value = tb.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
    openOrders.value = ord
    kitchen.value = kds
    lastUpdated.value = Date.now()
    now.value = lastUpdated.value
  } catch (e: unknown) {
    if (showSpinner) toast.error(e instanceof Error ? e.message : 'No se pudo cargar el salón')
  } finally {
    if (showSpinner) loading.value = false
    else refreshing.value = false
  }
}

async function loadContext() {
  const [team, settings] = await Promise.all([
    TeamService.list().catch(() => null),
    SettingsService.get().catch(() => null),
  ])
  usersById.value = new Map((team?.data ?? []).map((u) => [u.id, u.name]))
  currency.value = (settings as any)?.hotel?.currency || CurrencyCode.USD
}

// #204 — con un modal abierto (comensales, mesa, confirmación) o el menú "⋯" desplegado no se refresca:
// la grilla no se mueve debajo de lo que el mozo está tocando. Con la pestaña del navegador oculta tampoco.
function refreshPaused(): boolean {
  if (openModalCount.value > 0 || menuFor.value) return true
  return typeof document !== 'undefined' && document.hidden
}
function backgroundRefresh() { if (!refreshPaused()) void load(false) }

// #211 — canal en vivo: cualquier evento del restaurante (comanda enviada/cerrada, plato listo, mesa
// tocada) refresca el mapa sin spinner. Varios eventos seguidos → un solo refresco.
let refreshTimer: ReturnType<typeof setTimeout> | null = null
function refreshSoon() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => { refreshTimer = null; backgroundRefresh() }, 150)
}
const live = useRestaurantEvents({ onEvent: refreshSoon, onPoll: backgroundRefresh, pollMs: REFRESH_MS })
const liveLabel = computed(() => ({ idle: 'Sin conexión', connecting: 'Conectando…', live: 'En vivo', reconnecting: 'Reconectando…' }[live.state.value]))
const liveDot = computed(() => ({ idle: 'bg-text-muted', connecting: 'bg-text-muted animate-pulse', live: 'bg-success', reconnecting: 'bg-warning animate-pulse' }[live.state.value]))

onMounted(async () => {
  await Promise.all([load(), loadContext()])
  live.start()
  tickTimer = setInterval(() => { now.value = Date.now() }, TICK_MS)
})
onUnmounted(() => {
  live.stop()
  if (refreshTimer) clearTimeout(refreshTimer)
  if (tickTimer) clearInterval(tickTimer)
})

// #204 — acciones de mesa sin hover: un "⋯" por mesa abre Editar / Eliminar / Marcar reservada|libre.
const menuFor = ref<string | null>(null)
function toggleMenu(t: RestaurantTable) { menuFor.value = menuFor.value === t.id ? null : t.id }
function closeMenu() { menuFor.value = null }
async function toggleReserved(t: RestaurantTable) {
  closeMenu()
  const status: RestaurantTable['status'] = t.status === 'reserved' ? 'free' : 'reserved'
  await save(() => RestaurantService.updateTable(t.id, { status }))
}

// #210 — comensales al abrir la comanda en salón. Atajos de un toque (el caso real: 2 o 4 personas)
// más un campo para el resto; el backend valida entero 1..200 y por defecto pone 1.
const COVERS_SHORTCUTS = [1, 2, 3, 4, 5, 6, 8, 10]
const COVERS_MAX = 200
const coversTable = ref<RestaurantTable | null>(null)
const coversOther = ref<number | null>(null)

function onTable(t: RestaurantTable) {
  const existing = orderByTable.value.get(t.id)
  if (existing) { router.push(`/panel/restaurante/comanda/${existing.id}`); return }
  if (!createPerm.value) { toast.warning('Sin permiso para abrir comandas'); return }
  // La capacidad configurada de la mesa es la sugerencia obvia para "otro número".
  coversOther.value = t.capacity && t.capacity > 0 ? t.capacity : null
  coversTable.value = t
}

async function openWithCovers(covers: number) {
  const t = coversTable.value
  if (!t || opening.value) return
  if (!Number.isInteger(covers) || covers < 1 || covers > COVERS_MAX) {
    toast.warning(`Los comensales deben ser un entero entre 1 y ${COVERS_MAX}`)
    return
  }
  opening.value = true
  try {
    const order = await RestaurantService.openOrder({ type: 'dine_in', tableId: t.id, covers })
    coversTable.value = null
    router.push(`/panel/restaurante/comanda/${order.id}`)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo abrir la comanda')
  } finally {
    opening.value = false
  }
}

async function openLoose(type: 'room_service' | 'takeaway') {
  if (!createPerm.value) { toast.warning('Sin permiso para abrir comandas'); return }
  opening.value = true
  try {
    const order = await RestaurantService.openOrder({ type })
    router.push(`/panel/restaurante/comanda/${order.id}`)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo abrir la comanda')
  } finally {
    opening.value = false
  }
}

// ─── CRUD de mesas ───
const modal = ref<{ title: string; submitLabel: string; fields: FormField[]; onSubmit: (v: Record<string, string | number>) => Promise<void> } | null>(null)
const STATUS_OPTS = Object.entries(TABLE_STATUS_LABELS).map(([value, label]) => ({ value, label }))

function newTable() {
  modal.value = {
    title: 'Nueva mesa', submitLabel: 'Crear',
    fields: [
      { key: 'name', label: 'Nombre / número', required: true, minLength: 1, maxLength: 40 },
      { key: 'zone', label: 'Zona (ej: Terraza)', maxLength: 40 },
      { key: 'capacity', label: 'Capacidad', type: 'number', min: 0 },
    ],
    onSubmit: async (v) => save(() => RestaurantService.createTable({ name: String(v.name).trim(), zone: v.zone ? String(v.zone) : undefined, capacity: Number(v.capacity) || 0 })),
  }
}
function editTable(t: RestaurantTable) {
  closeMenu()
  modal.value = {
    title: 'Editar mesa', submitLabel: 'Guardar',
    fields: [
      { key: 'name', label: 'Nombre / número', required: true, minLength: 1, maxLength: 40, default: t.name },
      { key: 'zone', label: 'Zona', maxLength: 40, default: t.zone ?? '' },
      { key: 'capacity', label: 'Capacidad', type: 'number', min: 0, default: t.capacity ?? 0 },
      { key: 'status', label: 'Estado', type: 'select', default: t.status, options: STATUS_OPTS },
    ],
    onSubmit: async (v) => save(() => RestaurantService.updateTable(t.id, { name: String(v.name).trim(), zone: v.zone ? String(v.zone) : undefined, capacity: Number(v.capacity) || 0, status: String(v.status) as RestaurantTable['status'] })),
  }
}
function delTable(t: RestaurantTable) {
  closeMenu()
  askConfirm({
    title: 'Eliminar mesa', message: `¿Eliminar la mesa "${t.name}"?`, confirmLabel: 'Eliminar', danger: true,
    run: async () => { await RestaurantService.deleteTable(t.id); await load(false) },
  })
}
async function save(fn: () => Promise<unknown>) {
  saving.value = true
  try { await fn(); toast.success('Guardado'); modal.value = null; await load(false) }
  catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar') }
  finally { saving.value = false }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-navy">Salón</h1>
        <p class="text-sm text-text-muted mt-0.5">Tocá una mesa para abrir o retomar su comanda.</p>
      </div>
      <div class="flex items-center gap-2">
        <span data-testid="salon-live" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface text-[11px] font-bold text-navy" :title="live.state.value === 'live' ? 'Conectado al canal en vivo' : 'Sin canal en vivo: se actualiza cada 15 s'">
          <span :class="['w-2 h-2 rounded-full', liveDot]" />
          {{ liveLabel }}
        </span>
        <button v-if="createPerm" @click="openLoose('room_service')" :disabled="opening" class="px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-50">Room service</button>
        <button v-if="createPerm" @click="openLoose('takeaway')" :disabled="opening" class="px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-50">Para llevar</button>
        <button v-if="createPerm" @click="newTable" class="px-3 py-1.5 rounded-lg border-2 border-navy/30 text-navy text-xs font-bold hover:bg-surface">+ Mesa</button>
      </div>
    </header>

    <!-- Skeleton de carga (solo la primera vez; el refresco no lo muestra). -->
    <div v-if="loading" class="space-y-4" data-testid="salon-skeleton">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="h-24 animate-pulse rounded-2xl bg-surface"></div>
      </div>
      <div class="h-10 w-72 max-w-full animate-pulse rounded-full bg-surface"></div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
        <div v-for="i in 10" :key="i" class="h-20 animate-pulse rounded-xl bg-surface"></div>
      </div>
    </div>

    <template v-else>
      <EmptyState v-if="!tables.length" title="Sin mesas" message="Agregá mesas para armar el mapa del salón.">
        <template #action>
          <button v-if="createPerm" @click="newTable" class="px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold">Agregar mesa</button>
        </template>
      </EmptyState>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Mesas" :value="tables.length" icon="building" accent="blue" unit="Total en el salón" />
        <KpiHeroCard label="Ocupadas" :value="occupiedCount" icon="bookings" accent="amber"
          unit="Con comanda abierta" :progress="tables.length ? Math.round((occupiedCount / tables.length) * 100) : 0" />
        <KpiHeroCard label="Libres" :value="freeCount" icon="checkin" accent="teal" unit="Disponibles ahora" />
        <KpiHeroCard label="Comandas abiertas" :value="openOrdersCount" icon="users" accent="purple"
          :unit="`${looseOrders.length} sin mesa`" />
      </div>

      <!-- #204 — zonas en pestañas + indicador discreto del último refresco -->
      <div v-if="tables.length" class="flex flex-wrap items-center justify-between gap-2">
        <PillTabs v-model="tab" :tabs="tabs" query-param="tab" aria-label="Zonas del salón" />
        <span class="text-[11px] text-text-muted tabular-nums" aria-live="polite" data-testid="salon-updated">{{ refreshing ? 'actualizando…' : updatedAgo }}</span>
      </div>

      <!-- Comandas sin mesa (room service / para llevar): en "Todas" y en su propia pestaña -->
      <SectionCard v-if="tab === LOOSE_TAB || (tab === ALL_TAB && looseOrders.length)" title="Comandas sin mesa" :subtitle="`${looseOrders.length} abierta(s)`">
        <EmptyState v-if="!looseOrders.length" title="Sin comandas sin mesa" message="Room service y para llevar aparecen acá al abrirse." />
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          <button v-for="o in looseOrders" :key="o.id" @click="router.push(`/panel/restaurante/comanda/${o.id}`)"
            class="relative p-3 rounded-xl border-2 border-gold bg-gold/10 text-left hover:bg-gold/20">
            <span v-if="readyLooseOrders.has(o.id)" class="absolute top-2 right-2 w-3 h-3 rounded-full bg-success ring-2 ring-white" title="Hay platos listos en cocina" data-testid="ready-dot" />
            <div class="font-black text-navy text-sm">{{ o.number || 'Comanda' }}</div>
            <div class="text-[11px] text-text-muted">{{ ORDER_TYPE_LABELS[o.type] }} · {{ hhmm(o.openedAt) }}</div>
            <div class="text-[11px] text-navy font-bold tabular-nums mt-0.5">{{ money(o.total) }}<span v-if="waiterOf(o)" class="font-normal text-text-muted"> · {{ waiterOf(o)!.initials }}</span></div>
          </button>
        </div>
      </SectionCard>

      <!-- Mesas por zona (todas, o solo la de la pestaña activa) -->
      <SectionCard v-for="z in visibleZones" :key="z.zone" :title="z.zone" :subtitle="`${z.list.length} mesa(s)`">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          <div v-for="t in z.list" :key="t.id" class="relative">
            <button @click="onTable(t)" :disabled="opening" :data-table="t.name"
              :class="['relative w-full min-h-[76px] p-3 pr-9 rounded-xl border-2 text-left transition-colors disabled:opacity-60', tableClasses(t)]">
              <!-- #211: punto verde = cocina marcó "Lista" algún plato de esta mesa y todavía no se sirvió. -->
              <span v-if="readyTables.has(t.id)" class="absolute bottom-2 right-2 w-3 h-3 rounded-full bg-success ring-2 ring-white animate-pulse" title="Platos listos en cocina" data-testid="ready-dot" />
              <div class="font-black text-sm">{{ t.name }}</div>
              <template v-if="orderByTable.get(t.id)">
                <div class="text-[11px] opacity-70">Ocupada · {{ orderByTable.get(t.id)?.number }}</div>
                <!-- #204 — hora de apertura, tiempo transcurrido, total y mozo (iniciales; nombre en el title). -->
                <div class="text-[11px] tabular-nums mt-0.5 flex flex-wrap items-center gap-x-1.5">
                  <span>{{ hhmm(orderByTable.get(t.id)!.openedAt) }}</span>
                  <span class="opacity-70">· {{ elapsedLabel(orderByTable.get(t.id)!.openedAt, now) }}</span>
                  <span class="font-bold">· {{ money(orderByTable.get(t.id)!.total) }}</span>
                  <span v-if="waiterOf(orderByTable.get(t.id)!)" :title="waiterOf(orderByTable.get(t.id)!)!.name"
                    class="inline-flex items-center justify-center min-w-[22px] h-[18px] px-1 rounded-full bg-navy text-white text-[10px] font-black">
                    {{ waiterOf(orderByTable.get(t.id)!)!.initials }}
                  </span>
                </div>
              </template>
              <div v-else class="text-[11px] opacity-70">{{ TABLE_STATE_LABELS[stateOf(t)] }}<span v-if="t.capacity"> · {{ t.capacity }}p</span></div>
            </button>
            <!-- #204 — acciones sin hover: "⋯" siempre visible en la tablet. -->
            <template v-if="editPerm || deletePerm">
              <button @click.stop="toggleMenu(t)" :aria-label="`Opciones de ${t.name}`" :aria-expanded="menuFor === t.id" aria-haspopup="menu"
                class="absolute top-1.5 right-1.5 w-7 h-7 grid place-items-center rounded-lg bg-white/80 text-navy text-sm font-black shadow hover:bg-white">⋯</button>
              <div v-if="menuFor === t.id" role="menu" :aria-label="`Acciones de ${t.name}`"
                class="absolute top-9 right-1.5 z-20 min-w-[160px] rounded-xl border-2 border-navy bg-white shadow-xl py-1">
                <button v-if="editPerm" role="menuitem" @click.stop="editTable(t)" class="w-full text-left px-3 py-2 text-sm font-bold text-navy hover:bg-surface">Editar</button>
                <button v-if="editPerm && !orderByTable.get(t.id)" role="menuitem" @click.stop="toggleReserved(t)" class="w-full text-left px-3 py-2 text-sm font-bold text-navy hover:bg-surface">
                  {{ t.status === 'reserved' ? 'Marcar libre' : 'Marcar reservada' }}
                </button>
                <button v-if="deletePerm" role="menuitem" @click.stop="delTable(t)" class="w-full text-left px-3 py-2 text-sm font-bold text-coral hover:bg-coral/10">Eliminar mesa</button>
              </div>
            </template>
          </div>
        </div>
      </SectionCard>
      <!-- Cierra el menú "⋯" tocando fuera (capa transparente debajo del menú, encima del resto). -->
      <div v-if="menuFor" class="fixed inset-0 z-10" @click="closeMenu" aria-hidden="true"></div>
    </template>

    <!-- #210 — comensales: tocar el número abre la comanda directo, sin paso de confirmación. -->
    <AppModal v-if="coversTable" title="¿Cuántos comensales?" :subtitle="coversTable.name" @close="coversTable = null">
      <div class="grid grid-cols-4 gap-2">
        <button v-for="n in COVERS_SHORTCUTS" :key="n" @click="openWithCovers(n)" :disabled="opening"
          class="py-3 rounded-xl border-2 border-border font-black text-navy text-lg hover:border-navy hover:bg-surface disabled:opacity-50">{{ n }}</button>
      </div>
      <div class="flex items-end gap-2 mt-4">
        <div class="flex-1">
          <label for="mesa-comensales" class="block text-xs font-black text-navy uppercase mb-1.5">Otro número</label>
          <input id="mesa-comensales" v-model.number="coversOther" type="number" min="1" :max="COVERS_MAX" step="1"
            class="w-full px-3 py-2 rounded-lg border-2 border-border text-sm text-navy focus:border-navy outline-none"
            @keyup.enter="openWithCovers(Number(coversOther))" />
        </div>
        <button @click="openWithCovers(Number(coversOther))" :disabled="opening || !coversOther"
          class="px-4 py-2 rounded-lg bg-navy text-white font-bold text-sm disabled:opacity-50">Abrir comanda</button>
      </div>
    </AppModal>

    <FormModal v-if="modal" :title="modal.title" :fields="modal.fields" :submit-label="modal.submitLabel" :loading="saving"
      @close="modal = null" @submit="modal.onSubmit" />
    <ConfirmModal v-if="confirmModal" v-bind="confirmModal" :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>
