<script setup lang="ts">
// pages/compras/requisiciones.vue — Requisiciones de compra (COM-1). Pedido interno de insumos:
// líneas con descripción/cantidad, ciclo draft→submitted→approved|rejected. Una requisición aprobada
// alimenta una orden de compra. Todo vía ComprasService + InventarioService (para elegir insumo).
import { ref, computed, onMounted } from 'vue'
import {
  ComprasService,
  type Requisition, type RequisitionWithItems, type RequisitionLinePayload, type RequisitionStatus,
  REQ_STATUS_LABELS, REQ_STATUS_STYLE,
} from '@/services/Compras.service'
import { InventarioService, type InventoryItem } from '@/services/Inventario.service'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePermissions } from '@/composables/usePermissions'

const toast = useToast()
const { can } = usePermissions()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => { toast.success('Listo'); reload() },
  onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudo'),
})

const createPerm = computed(() => can('purchasing', 'create'))
const editPerm = computed(() => can('purchasing', 'edit'))
const deletePerm = computed(() => can('purchasing', 'delete'))

const loading = ref(true)
const requisitions = ref<Requisition[]>([])
const inventory = ref<InventoryItem[]>([])
const statusFilter = ref<string>('all')

const STATUS_TABS = [{ value: 'all', label: 'Todas' }, ...Object.entries(REQ_STATUS_LABELS).map(([value, label]) => ({ value, label }))]
const filtered = computed(() => statusFilter.value === 'all' ? requisitions.value : requisitions.value.filter((r) => r.status === statusFilter.value))

// KPIs
const pendingApproval = computed(() => requisitions.value.filter((r) => r.status === 'submitted').length)
const approvedCount = computed(() => requisitions.value.filter((r) => r.status === 'approved').length)
const draftCount = computed(() => requisitions.value.filter((r) => r.status === 'draft').length)
const fmtDate = (s?: string): string => s ? new Date(s).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const itemName = (id?: string): string => id ? (inventory.value.find((i) => i.id === id)?.name || 'Insumo') : ''
// Solo insumos activos son seleccionables en líneas nuevas (uno inactivo no se repone).
const activeInventory = computed(() => inventory.value.filter((i) => i.active !== 0))

async function load() {
  loading.value = true
  try {
    const [reqs, inv] = await Promise.all([
      ComprasService.listRequisitions(),
      InventarioService.listItems().catch(() => [] as InventoryItem[]),
    ])
    requisitions.value = reqs
    inventory.value = inv
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las requisiciones')
  } finally {
    loading.value = false
  }
}
async function reload() { requisitions.value = await ComprasService.listRequisitions() }
onMounted(load)

// ─── Crear requisición (multi-línea) ───
interface DraftLine { inventoryItemId: string; description: string; quantity: number | string; unit: string }
const createOpen = ref(false)
const saving = ref(false)
const form = ref<{ notes: string; lines: DraftLine[] }>({ notes: '', lines: [] })

function openCreate() {
  form.value = { notes: '', lines: [{ inventoryItemId: '', description: '', quantity: 1, unit: 'unidad' }] }
  createOpen.value = true
}
function addLine() { form.value.lines.push({ inventoryItemId: '', description: '', quantity: 1, unit: 'unidad' }) }
function removeLine(idx: number) { form.value.lines.splice(idx, 1) }
// Al elegir un insumo del catálogo, prellena descripción y unidad.
function onPickItem(line: DraftLine) {
  const inv = inventory.value.find((i) => i.id === line.inventoryItemId)
  if (inv) { line.description = inv.name; line.unit = inv.unit }
}

async function submitCreate() {
  const lines = form.value.lines
    .filter((l) => l.description.trim() && Number(l.quantity) > 0)
    .map<RequisitionLinePayload>((l) => ({
      inventoryItemId: l.inventoryItemId || undefined, description: l.description.trim(),
      quantity: Number(l.quantity), unit: l.unit.trim() || 'unidad',
    }))
  if (!lines.length) { toast.warning('Agregá al menos una línea válida'); return }
  saving.value = true
  try {
    await ComprasService.createRequisition({ notes: form.value.notes.trim() || undefined, items: lines })
    toast.success('Requisición creada')
    createOpen.value = false
    await reload()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo crear')
  } finally {
    saving.value = false
  }
}

// ─── Detalle ───
const detail = ref<RequisitionWithItems | null>(null)
const loadingDetail = ref(false)
async function openDetail(r: Requisition) {
  loadingDetail.value = true
  detail.value = null
  try { detail.value = await ComprasService.getRequisition(r.id) }
  catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo abrir') }
  finally { loadingDetail.value = false }
}

async function transition(r: Requisition | RequisitionWithItems, to: RequisitionStatus, label: string) {
  askConfirm({
    title: `${label} requisición`, message: `¿${label} la requisición ${r.number || ''}?`,
    confirmLabel: label, danger: to === 'rejected',
    run: async () => {
      await ComprasService.transitionRequisition(r.id, to)
      if (detail.value?.id === r.id) detail.value = await ComprasService.getRequisition(r.id)
    },
  })
}
// Enviar a aprobación: solo requiere purchasing:create (quien pide envía lo suyo). Ruta separada de
// aprobar/rechazar (purchasing:edit) — segregación de funciones.
function submitReq(r: Requisition | RequisitionWithItems) {
  askConfirm({
    title: 'Enviar a aprobación', message: `¿Enviar la requisición ${r.number || ''} a aprobación?`,
    confirmLabel: 'Enviar',
    run: async () => {
      await ComprasService.submitRequisition(r.id)
      if (detail.value?.id === r.id) detail.value = await ComprasService.getRequisition(r.id)
    },
  })
}
function delReq(r: Requisition) {
  askConfirm({
    title: 'Eliminar requisición', message: `¿Eliminar la requisición ${r.number || ''}? Solo se puede si está en borrador.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => { await ComprasService.deleteRequisition(r.id); if (detail.value?.id === r.id) detail.value = null },
  })
}

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-navy">Requisiciones</h1>
        <p class="text-sm text-text-muted mt-0.5">Pedidos internos de insumos. Una requisición aprobada se convierte en orden de compra.</p>
      </div>
      <button v-if="createPerm" @click="openCreate" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold hover:bg-navy/90">
        <span class="w-4 h-4" v-html="ICON_PLUS" /> Nueva requisición
      </button>
    </header>

    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>

    <template v-else>
      <div v-if="requisitions.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Requisiciones" :value="requisitions.length" icon="bookings" accent="blue" unit="Total registradas" />
        <KpiHeroCard label="Por aprobar" :value="pendingApproval" icon="checkout" :accent="pendingApproval ? 'rose' : 'teal'" unit="Esperando revisión" />
        <KpiHeroCard label="Aprobadas" :value="approvedCount" icon="checkin" accent="teal" unit="Listas para orden de compra" />
        <KpiHeroCard label="Borradores" :value="draftCount" icon="users" accent="purple" unit="Sin enviar todavía" />
      </div>

      <SectionCard title="Requisiciones">
      <div class="flex flex-wrap gap-1.5 mb-3">
        <button v-for="t in STATUS_TABS" :key="t.value" @click="statusFilter = t.value"
          :class="['px-2.5 py-1 rounded-full text-xs font-bold', statusFilter === t.value ? 'bg-navy text-white' : 'bg-surface text-text-muted']">{{ t.label }}</button>
      </div>

      <EmptyState v-if="!filtered.length" title="Sin requisiciones"
        :message="requisitions.length ? 'Ninguna requisición con ese estado.' : 'Creá el primer pedido interno de insumos.'">
        <template v-if="createPerm && !requisitions.length" #action>
          <button @click="openCreate" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Nueva requisición</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-[11px] font-bold text-text-muted uppercase border-b border-border">
              <th class="py-2 pr-3">Número</th>
              <th class="py-2 px-3">Fecha</th>
              <th class="py-2 px-3">Estado</th>
              <th class="py-2 px-3">Nota</th>
              <th class="py-2 pl-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="r in filtered" :key="r.id" class="hover:bg-surface/50">
              <td class="py-2.5 pr-3 font-bold text-navy">{{ r.number || '—' }}</td>
              <td class="py-2.5 px-3 text-text-secondary whitespace-nowrap">{{ fmtDate(r.createdAt) }}</td>
              <td class="py-2.5 px-3">
                <span :class="['text-[11px] px-2 py-0.5 rounded-full font-bold', REQ_STATUS_STYLE[r.status]]">{{ REQ_STATUS_LABELS[r.status] }}</span>
              </td>
              <td class="py-2.5 px-3 text-text-muted truncate max-w-[220px]">{{ r.notes || '—' }}</td>
              <td class="py-2.5 pl-3 text-right whitespace-nowrap">
                <button @click="openDetail(r)" class="text-xs font-bold text-navy hover:underline">Ver</button>
                <button v-if="createPerm && r.status === 'draft'" @click="submitReq(r)" class="ml-2 text-xs font-bold text-gold hover:underline">Enviar</button>
                <button v-if="editPerm && r.status === 'submitted'" @click="transition(r, 'approved', 'Aprobar')" class="ml-2 text-xs font-bold text-teal hover:underline">Aprobar</button>
                <button v-if="editPerm && r.status === 'submitted'" @click="transition(r, 'rejected', 'Rechazar')" class="ml-2 text-xs font-bold text-coral hover:underline">Rechazar</button>
                <button v-if="deletePerm && r.status === 'draft'" @click="delReq(r)" class="ml-2 text-xs font-bold text-coral hover:underline">Eliminar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      </SectionCard>
    </template>

    <!-- Crear requisición -->
    <AppModal v-if="createOpen" title="Nueva requisición" size="xl" @close="createOpen = false">
      <div class="space-y-4">
        <div>
          <label for="compras-requisiciones-nota-opcional" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nota (opcional)</label>
          <input id="compras-requisiciones-nota-opcional" name="notes" v-model="form.notes" maxlength="200" placeholder="Ej: reposición semanal de bar"
            class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-[10px] font-bold text-text-muted uppercase">Líneas</label>
            <button @click="addLine" class="text-xs font-bold text-navy hover:underline">+ Agregar línea</button>
          </div>
          <div class="space-y-2">
            <div v-for="(l, idx) in form.lines" :key="idx" class="flex items-start gap-2">
              <select :id="`requisicion-linea-${idx}-insumo`" :aria-label="`Insumo de la línea ${idx + 1}`" v-model="l.inventoryItemId" @change="onPickItem(l)" class="w-40 shrink-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
                <option value="">Libre / sin insumo</option>
                <option v-for="i in activeInventory" :key="i.id" :value="i.id">{{ i.name }}</option>
              </select>
              <input :id="`requisicion-linea-${idx}-descripcion`" :aria-label="`Descripción de la línea ${idx + 1}`" required aria-required="true" v-model="l.description" placeholder="Descripción" maxlength="120" class="flex-1 min-w-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
              <input :id="`requisicion-linea-${idx}-cantidad`" :aria-label="`Cantidad de la línea ${idx + 1}`" v-model.number="l.quantity" type="number" min="0" placeholder="Cant." class="w-20 shrink-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
              <input :id="`requisicion-linea-${idx}-unidad`" :aria-label="`Unidad de la línea ${idx + 1}`" v-model="l.unit" placeholder="Unidad" maxlength="20" class="w-24 shrink-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
              <button @click="removeLine(idx)" :disabled="form.lines.length === 1" class="shrink-0 w-9 h-9 grid place-items-center rounded-lg text-coral hover:bg-coral/10 disabled:opacity-30" aria-label="Quitar">✕</button>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="createOpen = false" class="px-4 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary">Cancelar</button>
        <button @click="submitCreate" :disabled="saving" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold disabled:opacity-50">{{ saving ? 'Creando…' : 'Crear requisición' }}</button>
      </template>
    </AppModal>

    <!-- Detalle -->
    <AppModal v-if="detail || loadingDetail" :title="detail ? `Requisición ${detail.number || ''}` : 'Requisición'" size="lg" @close="detail = null">
      <div v-if="loadingDetail" class="py-10 text-center text-text-muted">Cargando…</div>
      <div v-else-if="detail" class="space-y-4">
        <div class="flex items-center gap-3">
          <span :class="['text-[11px] px-2 py-0.5 rounded-full font-bold', REQ_STATUS_STYLE[detail.status]]">{{ REQ_STATUS_LABELS[detail.status] }}</span>
          <span class="text-xs text-text-muted">{{ fmtDate(detail.createdAt) }}</span>
        </div>
        <p v-if="detail.notes" class="text-sm text-text-secondary">{{ detail.notes }}</p>

        <EmptyState v-if="!detail.items.length" title="Sin líneas" message="Esta requisición no tiene ítems." />
        <div v-else class="overflow-x-auto rounded-xl border border-border">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-[11px] font-bold text-text-muted uppercase bg-surface">
                <th class="py-2 px-3">Descripción</th>
                <th class="py-2 px-3 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="l in detail.items" :key="l.id">
                <td class="py-2 px-3">
                  <span class="font-bold text-navy">{{ l.description }}</span>
                  <span v-if="l.inventoryItemId" class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-teal/10 text-teal font-bold">{{ itemName(l.inventoryItemId) }}</span>
                </td>
                <td class="py-2 px-3 text-right tabular-nums font-bold text-navy">{{ l.quantity }} {{ l.unit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <template v-if="detail" #footer>
        <button v-if="createPerm && detail.status === 'draft'" @click="submitReq(detail)" class="px-4 py-2 rounded-xl bg-gold text-white text-sm font-bold">Enviar a aprobación</button>
        <button v-if="editPerm && detail.status === 'submitted'" @click="transition(detail, 'rejected', 'Rechazar')" class="px-4 py-2 rounded-xl border border-coral text-coral text-sm font-bold">Rechazar</button>
        <button v-if="editPerm && detail.status === 'submitted'" @click="transition(detail, 'approved', 'Aprobar')" class="px-4 py-2 rounded-xl bg-teal text-white text-sm font-bold">Aprobar</button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" v-bind="confirmModal" :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>
