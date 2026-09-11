<script setup lang="ts">
// pages/restaurante/salon.vue — Mapa de mesas del salón (RES-7). Click en mesa libre abre una comanda
// dine_in y navega a la toma de comanda; click en mesa con comanda abierta navega a esa comanda.
// Incluye alta/edición/baja de mesas y comandas sin mesa (room service / para llevar).
// #210 — la mesa libre pregunta los comensales antes de abrir: un solo toque sobre el número (no un
// formulario), porque acá se está parado frente al cliente. Lo usa el ticket promedio por comensal.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  RestaurantService,
  type RestaurantTable, type Order,
  TABLE_STATUS_LABELS, ORDER_TYPE_LABELS,
} from '@/services/Restaurant.service'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePermissions } from '@/composables/usePermissions'

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

const createPerm = computed(() => can('restaurant', 'create'))
const editPerm = computed(() => can('restaurant', 'edit'))
const deletePerm = computed(() => can('restaurant', 'delete'))

// Estados "vivos" de una comanda (aún operable). El resto (paid/charged/cancelled) ya cerró.
// fix-refund-pos-card: 'processing_payment' también es viva — la mesa sigue tomada mientras la
// Checkout Session de Stripe está abierta (recién se libera al confirmar o al expirar).
const LIVE = ['open', 'sent', 'preparing', 'ready', 'served', 'billed', 'processing_payment']
const orderByTable = computed(() => {
  const map = new Map<string, Order>()
  for (const o of openOrders.value) if (o.tableId && LIVE.includes(o.status)) map.set(o.tableId, o)
  return map
})
const looseOrders = computed(() => openOrders.value.filter((o) => !o.tableId && LIVE.includes(o.status)))

const occupiedCount = computed(() => orderByTable.value.size)
const freeCount = computed(() => tables.value.length - occupiedCount.value)
const openOrdersCount = computed(() => openOrders.value.filter((o) => LIVE.includes(o.status)).length)

const zones = computed(() => {
  const map = new Map<string, RestaurantTable[]>()
  for (const t of tables.value) {
    const z = t.zone?.trim() || 'General'
    const arr = map.get(z) ?? []
    arr.push(t)
    map.set(z, arr)
  }
  return [...map.entries()].map(([zone, list]) => ({ zone, list }))
})

function tableClasses(t: RestaurantTable): string {
  const o = orderByTable.value.get(t.id)
  if (o) return 'bg-gold/10 border-gold text-navy'          // ocupada por comanda viva
  if (t.status === 'reserved') return 'bg-navy/5 border-navy/40 text-navy'
  return 'bg-teal/10 border-teal text-navy'                 // libre
}

async function load() {
  loading.value = true
  try {
    const [tb, ord] = await Promise.all([
      RestaurantService.listTables(),
      RestaurantService.listOrders(),
    ])
    tables.value = tb.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
    openOrders.value = ord
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar el salón')
  } finally {
    loading.value = false
  }
}
onMounted(load)

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
  askConfirm({
    title: 'Eliminar mesa', message: `¿Eliminar la mesa "${t.name}"? No se puede si tiene una comanda abierta.`, confirmLabel: 'Eliminar', danger: true,
    run: async () => { await RestaurantService.deleteTable(t.id); await load() },
  })
}
async function save(fn: () => Promise<unknown>) {
  saving.value = true
  try { await fn(); toast.success('Guardado'); modal.value = null; await load() }
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
        <button v-if="createPerm" @click="openLoose('room_service')" :disabled="opening" class="px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-50">Room service</button>
        <button v-if="createPerm" @click="openLoose('takeaway')" :disabled="opening" class="px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-50">Para llevar</button>
        <button v-if="createPerm" @click="newTable" class="px-3 py-1.5 rounded-lg border-2 border-navy/30 text-navy text-xs font-bold hover:bg-surface">+ Mesa</button>
      </div>
    </header>

    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>

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

      <!-- Comandas sin mesa (room service / para llevar) -->
      <SectionCard v-if="looseOrders.length" title="Comandas sin mesa">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          <button v-for="o in looseOrders" :key="o.id" @click="router.push(`/panel/restaurante/comanda/${o.id}`)"
            class="p-3 rounded-xl border-2 border-gold bg-gold/10 text-left hover:bg-gold/20">
            <div class="font-black text-navy text-sm">{{ o.number || 'Comanda' }}</div>
            <div class="text-[11px] text-text-muted">{{ ORDER_TYPE_LABELS[o.type] }}</div>
          </button>
        </div>
      </SectionCard>

      <!-- Mesas por zona -->
      <SectionCard v-for="z in zones" :key="z.zone" :title="z.zone">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          <div v-for="t in z.list" :key="t.id" class="relative group">
            <button @click="onTable(t)" :disabled="opening"
              :class="['w-full p-3 rounded-xl border-2 text-left transition-colors disabled:opacity-60', tableClasses(t)]">
              <div class="font-black text-sm">{{ t.name }}</div>
              <div class="text-[11px] opacity-70">
                <template v-if="orderByTable.get(t.id)">Ocupada · {{ orderByTable.get(t.id)?.number }}</template>
                <template v-else>{{ TABLE_STATUS_LABELS[t.status] }}<span v-if="t.capacity"> · {{ t.capacity }}p</span></template>
              </div>
            </button>
            <div class="absolute top-1 right-1 hidden group-hover:flex gap-1">
              <button v-if="editPerm" @click.stop="editTable(t)" title="Editar" class="w-6 h-6 rounded bg-white/80 text-navy text-xs font-bold shadow">✎</button>
              <button v-if="deletePerm" @click.stop="delTable(t)" title="Eliminar" class="w-6 h-6 rounded bg-white/80 text-coral text-xs font-bold shadow">✕</button>
            </div>
          </div>
        </div>
      </SectionCard>
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
