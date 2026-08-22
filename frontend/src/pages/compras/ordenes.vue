<script setup lang="ts">
// pages/compras/ordenes.vue — Órdenes de compra (COM-2/3/4). Crear OC (proveedor + líneas con precio),
// enviar, recibir mercancía (suma stock, parcial o total) y facturar (genera gasto). Se puede partir de
// una requisición aprobada. Vía ComprasService + TreasuryService (proveedores) + InventarioService.
import { ref, computed, onMounted } from 'vue'
import {
  ComprasService,
  type PurchaseOrder, type PurchaseOrderWithItems, type OrderLinePayload, type PurchaseOrderStatus,
  type Requisition, type ReceiveLine,
  OC_STATUS_LABELS, OC_STATUS_STYLE,
} from '@/services/Compras.service'
import { TreasuryService, type Supplier } from '@/services/Treasury.service'
import { InventarioService, type InventoryItem } from '@/services/Inventario.service'
import { SettingsService } from '@/services/Settings.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
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

const loading = ref(true)
const orders = ref<PurchaseOrder[]>([])
const suppliers = ref<Supplier[]>([])
const inventory = ref<InventoryItem[]>([])
const approvedReqs = ref<Requisition[]>([])
const currency = ref<string>(CurrencyCode.USD)
const defaultTax = ref(0)
const statusFilter = ref<string>('all')

const STATUS_TABS = [{ value: 'all', label: 'Todas' }, ...Object.entries(OC_STATUS_LABELS).map(([value, label]) => ({ value, label }))]
const filtered = computed(() => statusFilter.value === 'all' ? orders.value : orders.value.filter((o) => o.status === statusFilter.value))

// KPIs — solo órdenes activas (una cancelada no compromete plata ni espera recepción).
const activeOrders = computed(() => orders.value.filter((o) => o.status !== 'cancelled'))
const totalCommitted = computed(() => activeOrders.value.reduce((s, o) => s + Number(o.total || 0), 0))
const pendingSend = computed(() => orders.value.filter((o) => o.status === 'draft').length)
const invoicedCount = computed(() => orders.value.filter((o) => o.expenseId).length)
const money = (n: number): string => `${currencySymbol(currency.value)}${Number(n || 0).toFixed(2)}`
const fmtDate = (s?: string): string => s ? new Date(s).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const supplierName = (id?: string): string => id ? (suppliers.value.find((s) => s.id === id)?.name || 'Proveedor') : 'Sin proveedor'
const itemName = (id?: string): string => id ? (inventory.value.find((i) => i.id === id)?.name || '') : ''
// Solo insumos activos son seleccionables en líneas nuevas (uno inactivo no se compra).
const activeInventory = computed(() => inventory.value.filter((i) => i.active !== 0))

async function load() {
  loading.value = true
  try {
    const [ord, sup, inv, reqs, settings] = await Promise.all([
      ComprasService.listOrders(),
      TreasuryService.listSuppliers().then((r) => r.data ?? []).catch(() => [] as Supplier[]),
      InventarioService.listItems().catch(() => [] as InventoryItem[]),
      ComprasService.listRequisitions('approved').catch(() => [] as Requisition[]),
      SettingsService.get().catch(() => null),
    ])
    orders.value = ord
    suppliers.value = sup
    inventory.value = inv
    approvedReqs.value = reqs
    currency.value = (settings as any)?.hotel?.currency || 'USD'
    defaultTax.value = Number((settings as any)?.hotel?.taxRate) || 0
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las órdenes')
  } finally {
    loading.value = false
  }
}
// Refresca órdenes Y requisiciones aprobadas juntas: crear una OC desde una requisición no la saca de
// 'approved' en el backend (no hay estado "usada"), así que sin este refetch + filtro quedaba
// seleccionable de nuevo en el dropdown y se podía duplicar la orden de compra (QA-ALTO).
async function reload() {
  const [ord, reqs] = await Promise.all([ComprasService.listOrders(), ComprasService.listRequisitions('approved')])
  orders.value = ord
  approvedReqs.value = reqs
}
onMounted(load)

// Requisiciones aprobadas que TODAVÍA no tienen una orden de compra activa (no cancelada) asociada.
const availableReqs = computed(() => {
  const used = new Set(orders.value.filter((o) => o.status !== 'cancelled' && o.requisitionId).map((o) => o.requisitionId))
  return approvedReqs.value.filter((r) => !used.has(r.id))
})

// ─── Crear OC ───
interface DraftLine { inventoryItemId: string; description: string; quantity: number | string; unit: string; unitPrice: number | string; taxRate: number | string }
const createOpen = ref(false)
const saving = ref(false)
const form = ref<{ supplierId: string; requisitionId: string; expectedDate: string; notes: string; lines: DraftLine[] }>({
  supplierId: '', requisitionId: '', expectedDate: '', notes: '', lines: [],
})
const blankLine = (): DraftLine => ({ inventoryItemId: '', description: '', quantity: 1, unit: 'unidad', unitPrice: 0, taxRate: defaultTax.value })

function openCreate() {
  form.value = { supplierId: '', requisitionId: '', expectedDate: '', notes: '', lines: [blankLine()] }
  createOpen.value = true
}
function addLine() { form.value.lines.push(blankLine()) }
function removeLine(idx: number) { form.value.lines.splice(idx, 1) }
function onPickItem(line: DraftLine) {
  const inv = inventory.value.find((i) => i.id === line.inventoryItemId)
  if (inv) { line.description = inv.name; line.unit = inv.unit; if (inv.avgCost) line.unitPrice = inv.avgCost }
}
// Al elegir una requisición aprobada, se cargan sus líneas (con precio a completar).
async function onPickRequisition() {
  if (!form.value.requisitionId) return
  try {
    const req = await ComprasService.getRequisition(form.value.requisitionId)
    form.value.lines = req.items.map<DraftLine>((l) => {
      const inv = inventory.value.find((i) => i.id === l.inventoryItemId)
      return { inventoryItemId: l.inventoryItemId || '', description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: inv?.avgCost || 0, taxRate: defaultTax.value }
    })
    if (!form.value.lines.length) form.value.lines = [blankLine()]
  } catch { /* silent */ }
}
// Tres estados vacíos distintos: filtro sin resultados · sin proveedores (bloquea el alta) ·
// módulo sin usar todavía.
const emptyTitle = computed(() => {
  if (orders.value.length) return 'Ninguna orden con ese estado'
  return suppliers.value.length ? 'Todavía no hay órdenes de compra' : 'Primero cargá tus proveedores'
})
const emptyMessage = computed(() => {
  if (orders.value.length) return 'Probá con otro estado para ver el resto de las órdenes.'
  if (!suppliers.value.length) return 'Una orden de compra se emite a nombre de un proveedor, y todavía no tenés ninguno registrado. Cargalos en Tesorería → Proveedores y volvé acá.'
  return 'Una orden de compra le pide mercadería a un proveedor: al recibirla suma stock al inventario y al facturarla genera el gasto. Creá la primera eligiendo proveedor y líneas, o partí de una requisición aprobada.'
})

const draftSubtotal = computed(() => form.value.lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0))

async function submitCreate() {
  if (!form.value.supplierId) { toast.warning('Elegí un proveedor'); return }
  const lines = form.value.lines
    .filter((l) => l.description.trim() && Number(l.quantity) > 0)
    .map<OrderLinePayload>((l) => ({
      inventoryItemId: l.inventoryItemId || undefined, description: l.description.trim(),
      quantity: Number(l.quantity), unit: l.unit.trim() || 'unidad',
      unitPrice: Number(l.unitPrice) || 0, taxRate: Number(l.taxRate) || 0,
    }))
  if (!lines.length) { toast.warning('Agregá al menos una línea válida'); return }
  saving.value = true
  try {
    await ComprasService.createOrder({
      supplierId: form.value.supplierId, requisitionId: form.value.requisitionId || undefined,
      expectedDate: form.value.expectedDate || undefined, notes: form.value.notes.trim() || undefined, items: lines,
    })
    toast.success('Orden de compra creada')
    createOpen.value = false
    await reload()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo crear')
  } finally {
    saving.value = false
  }
}

// ─── Detalle ───
const detail = ref<PurchaseOrderWithItems | null>(null)
const loadingDetail = ref(false)
async function openDetail(o: PurchaseOrder) {
  loadingDetail.value = true
  detail.value = null
  try { detail.value = await ComprasService.getOrder(o.id) }
  catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo abrir') }
  finally { loadingDetail.value = false }
}
async function refreshDetail() { if (detail.value) detail.value = await ComprasService.getOrder(detail.value.id) }
const pending = (l: PurchaseOrderWithItems['items'][number]): number => Math.max(Number(l.quantity) - Number(l.receivedQty || 0), 0)
const fullyReceived = (o: PurchaseOrderWithItems): boolean => o.items.every((l) => pending(l) <= 0)

function sendOrder(o: PurchaseOrderWithItems) {
  askConfirm({
    title: 'Enviar orden', message: `¿Enviar la OC ${o.number || ''} al proveedor? No se podrán editar sus líneas.`,
    confirmLabel: 'Enviar',
    run: async () => { await ComprasService.transitionOrder(o.id, 'sent'); await refreshDetail(); await reload() },
  })
}
function cancelOrder(o: PurchaseOrder | PurchaseOrderWithItems) {
  askConfirm({
    title: 'Cancelar orden', message: `¿Cancelar la OC ${o.number || ''}?`, confirmLabel: 'Cancelar orden', danger: true,
    run: async () => { await ComprasService.transitionOrder(o.id, 'cancelled'); if (detail.value?.id === o.id) await refreshDetail() },
  })
}

// ─── Recepción ───
const receiveOpen = ref(false)
const receiveLines = ref<{ orderItemId: string; description: string; pending: number; qty: number | string }[]>([])
const receiveNotes = ref('')
function openReceive() {
  if (!detail.value) return
  receiveNotes.value = ''
  receiveLines.value = detail.value.items
    .filter((l) => pending(l) > 0)
    .map((l) => ({ orderItemId: l.id, description: l.description, pending: pending(l), qty: pending(l) }))
  receiveOpen.value = true
}
async function submitReceive() {
  const lines = receiveLines.value
    .filter((l) => Number(l.qty) > 0)
    .map<ReceiveLine>((l) => ({ orderItemId: l.orderItemId, quantity: Number(l.qty) }))
  if (!lines.length) { toast.warning('Indicá cantidades a recibir'); return }
  const over = receiveLines.value.find((l) => Number(l.qty) > l.pending)
  if (over) { toast.error(`No podés recibir más de ${over.pending} de "${over.description}"`); return }
  saving.value = true
  try {
    await ComprasService.receive(detail.value!.id, { notes: receiveNotes.value.trim() || undefined, lines })
    toast.success('Mercancía recibida — stock actualizado')
    receiveOpen.value = false
    await refreshDetail()
    await reload()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo recibir')
  } finally {
    saving.value = false
  }
}

// ─── Facturación ───
const invoiceOpen = ref(false)
const invoiceNumber = ref('')
function openInvoice() { invoiceNumber.value = detail.value?.invoiceNumber || ''; invoiceOpen.value = true }
async function submitInvoice() {
  saving.value = true
  try {
    await ComprasService.markInvoiced(detail.value!.id, { invoiceNumber: invoiceNumber.value.trim() || undefined })
    toast.success('OC facturada — gasto generado')
    invoiceOpen.value = false
    await refreshDetail()
    await reload()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo facturar')
  } finally {
    saving.value = false
  }
}

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-navy">Órdenes de compra</h1>
        <p class="text-sm text-text-muted mt-0.5">Comprá a proveedores, recibí mercancía (suma stock) y facturá (genera gasto).</p>
      </div>
      <button v-if="createPerm" @click="openCreate" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold hover:bg-navy/90">
        <span class="w-4 h-4" v-html="ICON_PLUS" /> Nueva orden
      </button>
    </header>

    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>

    <template v-else>
      <div v-if="orders.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Órdenes de compra" :value="orders.length" icon="bookings" accent="blue" unit="Total registradas" />
        <KpiHeroCard label="Comprometido" :value="totalCommitted" icon="money" accent="amber"
          :prefix="currencySymbol(currency)" unit="Órdenes activas (sin canceladas)" />
        <KpiHeroCard label="Por enviar" :value="pendingSend" icon="checkout" :accent="pendingSend ? 'rose' : 'teal'" unit="En borrador" />
        <KpiHeroCard label="Facturadas" :value="invoicedCount" icon="checkin" accent="purple" unit="Generaron gasto" />
      </div>

      <SectionCard title="Órdenes de compra">
      <div class="flex flex-wrap gap-1.5 mb-3">
        <button v-for="t in STATUS_TABS" :key="t.value" @click="statusFilter = t.value"
          :class="['px-2.5 py-1 rounded-full text-xs font-bold', statusFilter === t.value ? 'bg-navy text-white' : 'bg-surface text-text-muted']">{{ t.label }}</button>
      </div>

      <EmptyState v-if="!filtered.length" :title="emptyTitle" :message="emptyMessage">
        <template v-if="createPerm && !orders.length" #action>
          <router-link v-if="!suppliers.length" to="/panel/tesoreria/proveedores"
            class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Cargar proveedores</router-link>
          <button v-else @click="openCreate" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Nueva orden</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-[11px] font-bold text-text-muted uppercase border-b border-border">
              <th class="py-2 pr-3">Número</th>
              <th class="py-2 px-3">Proveedor</th>
              <th class="py-2 px-3">Fecha</th>
              <th class="py-2 px-3">Estado</th>
              <th class="py-2 px-3 text-right">Total</th>
              <th class="py-2 pl-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="o in filtered" :key="o.id" class="hover:bg-surface/50">
              <td class="py-2.5 pr-3 font-bold text-navy">
                {{ o.number || '—' }}
                <span v-if="o.expenseId" class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-teal/10 text-teal font-bold">Facturada</span>
              </td>
              <td class="py-2.5 px-3 text-text-secondary">{{ supplierName(o.supplierId) }}</td>
              <td class="py-2.5 px-3 text-text-secondary whitespace-nowrap">{{ fmtDate(o.createdAt) }}</td>
              <td class="py-2.5 px-3"><span :class="['text-[11px] px-2 py-0.5 rounded-full font-bold', OC_STATUS_STYLE[o.status]]">{{ OC_STATUS_LABELS[o.status] }}</span></td>
              <td class="py-2.5 px-3 text-right tabular-nums font-bold text-navy">{{ money(o.total) }}</td>
              <td class="py-2.5 pl-3 text-right whitespace-nowrap">
                <button @click="openDetail(o)" class="text-xs font-bold text-navy hover:underline">Ver</button>
                <button v-if="editPerm && (o.status === 'draft' || o.status === 'sent')" @click="cancelOrder(o)" class="ml-2 text-xs font-bold text-coral hover:underline">Cancelar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      </SectionCard>
    </template>

    <!-- Crear OC -->
    <AppModal v-if="createOpen" title="Nueva orden de compra" size="xl" @close="createOpen = false">
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label for="compras-ordenes-proveedor" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Proveedor <span class="text-coral">*</span></label>
            <select id="compras-ordenes-proveedor" name="supplierId" v-model="form.supplierId" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
              <option value="">Seleccionar…</option>
              <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <p v-if="!suppliers.length" class="text-[10px] text-coral mt-1">No hay proveedores. Cargalos en Tesorería → Proveedores.</p>
          </div>
          <div>
            <label for="compras-ordenes-desde-requisicion-opcional" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Desde requisición (opcional)</label>
            <select id="compras-ordenes-desde-requisicion-opcional" name="requisitionId" v-model="form.requisitionId" @change="onPickRequisition" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
              <option value="">— Ninguna —</option>
              <option v-for="r in availableReqs" :key="r.id" :value="r.id">{{ r.number }}</option>
            </select>
          </div>
          <div>
            <label for="compras-ordenes-fecha-esperada" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Fecha esperada</label>
            <input id="compras-ordenes-fecha-esperada" name="expectedDate" v-model="form.expectedDate" type="date" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="compras-ordenes-nota" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nota</label>
            <input id="compras-ordenes-nota" name="notes" v-model="form.notes" maxlength="200" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-[10px] font-bold text-text-muted uppercase">Líneas</label>
            <button @click="addLine" class="text-xs font-bold text-navy hover:underline">+ Agregar línea</button>
          </div>
          <div class="space-y-2">
            <div v-for="(l, idx) in form.lines" :key="idx" class="flex items-start gap-2">
              <select :id="`orden-linea-${idx}-insumo`" :aria-label="`Insumo de la línea ${idx + 1}`" v-model="l.inventoryItemId" @change="onPickItem(l)" class="w-36 shrink-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
                <option value="">Libre</option>
                <option v-for="i in activeInventory" :key="i.id" :value="i.id">{{ i.name }}</option>
              </select>
              <input :id="`orden-linea-${idx}-descripcion`" :aria-label="`Descripción de la línea ${idx + 1}`" required aria-required="true" v-model="l.description" placeholder="Descripción" maxlength="120" class="flex-1 min-w-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
              <input :id="`orden-linea-${idx}-cantidad`" :aria-label="`Cantidad de la línea ${idx + 1}`" v-model.number="l.quantity" type="number" min="0" placeholder="Cant." class="w-16 shrink-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" title="Cantidad" />
              <input :id="`orden-linea-${idx}-precio`" :aria-label="`Precio unitario de la línea ${idx + 1}`" v-model.number="l.unitPrice" type="number" min="0" placeholder="Precio" class="w-20 shrink-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" title="Precio unitario" />
              <input :id="`orden-linea-${idx}-impuesto`" :aria-label="`Impuesto (%) de la línea ${idx + 1}`" v-model.number="l.taxRate" type="number" min="0" placeholder="Imp.%" class="w-16 shrink-0 px-2 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" title="Impuesto %" />
              <button @click="removeLine(idx)" :disabled="form.lines.length === 1" class="shrink-0 w-9 h-9 grid place-items-center rounded-lg text-coral hover:bg-coral/10 disabled:opacity-30" aria-label="Quitar">✕</button>
            </div>
          </div>
          <p class="text-right text-sm font-bold text-navy mt-2">Subtotal: {{ money(draftSubtotal) }} <span class="text-[11px] text-text-muted font-normal">(impuesto y total se calculan al crear)</span></p>
        </div>
      </div>
      <template #footer>
        <button @click="createOpen = false" class="px-4 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary">Cancelar</button>
        <button @click="submitCreate" :disabled="saving" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold disabled:opacity-50">{{ saving ? 'Creando…' : 'Crear orden' }}</button>
      </template>
    </AppModal>

    <!-- Detalle OC -->
    <AppModal v-if="detail || loadingDetail" :title="detail ? `OC ${detail.number || ''}` : 'Orden de compra'" size="xl" @close="detail = null">
      <div v-if="loadingDetail" class="py-10 text-center text-text-muted">Cargando…</div>
      <div v-else-if="detail" class="space-y-4">
        <div class="flex items-center gap-3 flex-wrap">
          <span :class="['text-[11px] px-2 py-0.5 rounded-full font-bold', OC_STATUS_STYLE[detail.status]]">{{ OC_STATUS_LABELS[detail.status] }}</span>
          <span class="text-sm font-bold text-navy">{{ supplierName(detail.supplierId) }}</span>
          <span class="text-xs text-text-muted">{{ fmtDate(detail.createdAt) }}</span>
          <span v-if="detail.invoiceNumber" class="text-xs text-teal font-bold">Factura {{ detail.invoiceNumber }}</span>
        </div>

        <div class="overflow-x-auto rounded-xl border border-border">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-[11px] font-bold text-text-muted uppercase bg-surface">
                <th class="py-2 px-3">Descripción</th>
                <th class="py-2 px-3 text-right">Cant.</th>
                <th class="py-2 px-3 text-right">Recibido</th>
                <th class="py-2 px-3 text-right">Precio</th>
                <th class="py-2 px-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="l in detail.items" :key="l.id">
                <td class="py-2 px-3">
                  <span class="font-bold text-navy">{{ l.description }}</span>
                  <span v-if="l.inventoryItemId && itemName(l.inventoryItemId)" class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-teal/10 text-teal font-bold">stock</span>
                </td>
                <td class="py-2 px-3 text-right tabular-nums">{{ l.quantity }} {{ l.unit }}</td>
                <td class="py-2 px-3 text-right tabular-nums" :class="Number(l.receivedQty) >= Number(l.quantity) ? 'text-teal font-bold' : 'text-gold font-bold'">{{ l.receivedQty || 0 }}</td>
                <td class="py-2 px-3 text-right tabular-nums text-text-secondary">{{ money(l.unitPrice) }}</td>
                <td class="py-2 px-3 text-right tabular-nums font-bold text-navy">{{ money(l.lineTotal) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t border-border text-sm">
                <td colspan="4" class="py-1.5 px-3 text-right text-text-muted">Subtotal</td>
                <td class="py-1.5 px-3 text-right tabular-nums">{{ money(detail.subtotal) }}</td>
              </tr>
              <tr class="text-sm">
                <td colspan="4" class="py-1.5 px-3 text-right text-text-muted">Impuesto</td>
                <td class="py-1.5 px-3 text-right tabular-nums">{{ money(detail.tax) }}</td>
              </tr>
              <tr class="text-base font-black text-navy">
                <td colspan="4" class="py-1.5 px-3 text-right">Total</td>
                <td class="py-1.5 px-3 text-right tabular-nums">{{ money(detail.total) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p v-if="detail.notes" class="text-sm text-text-secondary">{{ detail.notes }}</p>
      </div>

      <template v-if="detail && editPerm" #footer>
        <button v-if="detail.status === 'draft'" @click="sendOrder(detail)" class="px-4 py-2 rounded-xl bg-gold text-white text-sm font-bold">Enviar al proveedor</button>
        <button v-if="detail.status === 'sent' && !fullyReceived(detail)" @click="openReceive" class="px-4 py-2 rounded-xl bg-teal text-white text-sm font-bold">Recibir mercancía</button>
        <button v-if="(detail.status === 'sent' || detail.status === 'received') && !detail.expenseId" @click="openInvoice" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Facturar</button>
      </template>
    </AppModal>

    <!-- Recibir mercancía -->
    <AppModal v-if="receiveOpen" title="Recibir mercancía" size="lg" @close="receiveOpen = false">
      <div class="space-y-3">
        <p class="text-sm text-text-muted">Indicá cuánto recibís de cada línea (no más de lo pendiente). Suma el stock del inventario.</p>
        <div class="space-y-2">
          <div v-for="l in receiveLines" :key="l.orderItemId" class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="font-bold text-navy truncate">{{ l.description }}</div>
              <div class="text-[11px] text-text-muted">Pendiente: {{ l.pending }}</div>
            </div>
            <input :id="`orden-recepcion-${l.orderItemId}`" :aria-label="`Cantidad recibida de ${l.description}`" v-model.number="l.qty" type="number" min="0" :max="l.pending" class="w-24 px-2 py-2 rounded-lg border border-border text-sm text-right focus:outline-none focus:border-navy" />
          </div>
        </div>
        <div>
          <label for="compras-ordenes-nota-opcional" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nota (opcional)</label>
          <input id="compras-ordenes-nota-opcional" name="receiveNotes" v-model="receiveNotes" maxlength="200" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
      </div>
      <template #footer>
        <button @click="receiveOpen = false" class="px-4 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary">Cancelar</button>
        <button @click="submitReceive" :disabled="saving" class="px-4 py-2 rounded-xl bg-teal text-white text-sm font-bold disabled:opacity-50">{{ saving ? 'Recibiendo…' : 'Confirmar recepción' }}</button>
      </template>
    </AppModal>

    <!-- Facturar -->
    <AppModal v-if="invoiceOpen" title="Facturar orden de compra" size="sm" @close="invoiceOpen = false">
      <div class="space-y-3">
        <p class="text-sm text-text-muted">Registra la factura del proveedor y genera el gasto (pega en caja y contabilidad). No se duplica si ya está facturada.</p>
        <div>
          <label for="compras-ordenes-numero-de-factura-del" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Número de factura del proveedor</label>
          <input id="compras-ordenes-numero-de-factura-del" name="invoiceNumber" v-model="invoiceNumber" maxlength="60" placeholder="Ej: F-001234" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
      </div>
      <template #footer>
        <button @click="invoiceOpen = false" class="px-4 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary">Cancelar</button>
        <button @click="submitInvoice" :disabled="saving" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold disabled:opacity-50">{{ saving ? 'Facturando…' : 'Facturar y generar gasto' }}</button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" v-bind="confirmModal" :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>
