<template>
  <div>
    <!-- Métricas -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
      <div v-for="stat in stats" :key="stat.label" class="bg-white rounded-xl p-4 border border-border text-center card-shadow">
        <div class="text-xl font-black" :class="stat.color">{{ stat.value }}</div>
        <div class="text-[10px] text-text-muted font-bold uppercase">{{ stat.label }}</div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="bg-white rounded-2xl border border-border card-shadow p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold text-text-muted uppercase">Filtros</span>
          <span v-if="activeFiltersCount > 0" class="bg-cyan/20 text-cyan text-[10px] font-bold px-2 py-0.5 rounded-full">{{ activeFiltersCount }} activos</span>
        </div>
        <button v-if="activeFiltersCount > 0" @click="clearAllFilters" class="text-[10px] font-bold text-red hover:text-red/80 transition-colors cursor-pointer">Limpiar todo</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div class="relative">
          <input v-model="searchQuery" type="text" placeholder="Buscar factura, hotel..." class="w-full h-10 pl-9 pr-4 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
        <select v-model="statusFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los estados</option>
          <option value="Pagado">Pagado</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Vencido">Vencido</option>
        </select>
        <select v-model="planFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los planes</option>
          <option value="Enterprise">Enterprise</option>
          <option value="Professional">Professional</option>
          <option value="Starter">Starter</option>
        </select>
        <select v-model="dateFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todo el tiempo</option>
          <option value="today">Hoy</option>
          <option value="week">Esta semana</option>
          <option value="month">Este mes</option>
          <option value="quarter">Este trimestre</option>
        </select>
        <button @click="exportInvoices" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm font-bold text-text-secondary hover:bg-surface-dark transition-colors cursor-pointer flex items-center justify-center gap-2">📥 Exportar</button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-4 flex-wrap">
      <button v-for="tab in tabs" :key="tab.value" @click="activeTab = tab.value" class="px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer" :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
        {{ tab.label }}
        <span v-if="tab.count" class="ml-2 bg-white/20 text-[10px] px-1.5 py-0.5 rounded-full">{{ tab.count }}</span>
      </button>
    </div>

    <!-- Tabla -->
    <SkeletonLoader v-if="loading" variant="table" :rows="6" />
    <SectionCard v-else title="Facturación" :subtitle="`${filteredInvoices.length} facturas`" body-class="p-0">
      <div class="overflow-x-auto">
      <table class="w-full tbl-head">
        <thead>
          <tr class="border-b border-border">
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy" @click="toggleSort('id')">
              <div class="flex items-center gap-1">Factura <span v-if="sortBy.startsWith('id')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy" @click="toggleSort('hotel')">
              <div class="flex items-center gap-1">Hotel <span v-if="sortBy.startsWith('hotel')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Concepto</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy" @click="toggleSort('amount')">
              <div class="flex items-center gap-1">Monto <span v-if="sortBy.startsWith('amount')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Método</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy" @click="toggleSort('date')">
              <div class="flex items-center gap-1">Fecha <span v-if="sortBy.startsWith('date')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th class="text-right p-4 text-[10px] font-bold text-text-muted uppercase">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="invoice in filteredInvoices" :key="invoice.id" class="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
            <td class="p-4 text-sm font-mono text-text-muted cursor-pointer hover:text-cyan" @click="openInvoice(invoice)">#{{ invoice.id }}</td>
            <td class="p-4">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-navy to-cyan flex items-center justify-center text-white text-[10px] font-bold">{{ invoice.hotel?.[0] || '?' }}</div>
                <div>
                  <div class="text-sm font-bold text-navy">{{ invoice.hotel }}</div>
                  <div class="text-[10px] text-text-muted">{{ invoice.plan }}</div>
                </div>
              </div>
            </td>
            <td class="p-4 text-sm">{{ invoice.concept }}</td>
            <td class="p-4 text-sm font-black text-navy">${{ invoice.amount }}</td>
            <td class="p-4"><span class="text-[10px] font-bold">{{ invoice.method }}</span></td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="statusClass(invoice.status)">{{ invoice.status }}</span></td>
            <td class="p-4 text-sm text-text-muted">{{ invoice.date }}</td>
            <td class="p-4 text-right">
              <div class="flex gap-1 justify-end">
                <button @click="openInvoice(invoice)" class="px-2 py-1 bg-cyan/10 text-cyan rounded-lg text-[10px] font-bold hover:bg-cyan/20 transition-colors cursor-pointer">Ver</button>
                <button v-if="invoice.status === 'Pendiente' || invoice.status === 'Vencido'" @click="sendReminder(invoice)" class="px-2 py-1 bg-navy/10 text-navy rounded-lg text-[10px] font-bold hover:bg-navy/20 transition-colors cursor-pointer">Recordar</button>
                <button v-if="invoice.status !== 'Pagado'" @click="markAsPaid(invoice)" class="px-2 py-1 bg-teal/10 text-teal rounded-lg text-[10px] font-bold hover:bg-teal/20 transition-colors cursor-pointer">Pagado</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div v-if="filteredInvoices.length === 0" class="p-12 text-center">
        <div class="text-4xl mb-3">📄</div>
        <div class="text-sm font-bold text-text-muted">No se encontraron facturas</div>
      </div>
    </SectionCard>

    <!-- Modal: Detalle Factura -->
    <AppModal v-if="showDetailModal" size="lg" :title="`Factura #${selectedInvoice.id}`" body-class="p-6" @close="showDetailModal = false">
      <div class="flex items-center gap-4 mb-6">
        <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-navy to-cyan flex items-center justify-center text-white text-xl font-black">{{ selectedInvoice.hotel[0] }}</div>
        <div>
          <div class="text-lg font-bold text-navy">{{ selectedInvoice.hotel }}</div>
          <div class="text-sm text-text-muted">{{ selectedInvoice.plan }}</div>
        </div>
        <div class="ml-auto">
          <span class="text-[10px] font-bold px-3 py-1 rounded-full" :class="statusClass(selectedInvoice.status)">{{ selectedInvoice.status }}</span>
        </div>
      </div>
      <div class="bg-surface rounded-xl p-4 mb-4">
        <div class="text-[10px] font-bold text-text-muted uppercase mb-1">Concepto</div>
        <div class="text-sm font-bold">{{ selectedInvoice.concept }}</div>
      </div>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Monto</div><div class="text-2xl font-black text-navy">${{ selectedInvoice.amount }}</div></div>
        <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Método de Pago</div><div class="text-sm font-bold">{{ selectedInvoice.method }}</div></div>
      </div>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Fecha de Emisión</div><div class="text-sm">{{ selectedInvoice.date }}</div></div>
        <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Fecha de Vencimiento</div><div class="text-sm">{{ selectedInvoice.dueDate }}</div></div>
      </div>
      <div v-if="selectedInvoice.notes" class="bg-surface rounded-xl p-4 mb-4">
        <div class="text-[10px] font-bold text-text-muted uppercase mb-1">Notas</div>
        <div class="text-sm text-text-secondary">{{ selectedInvoice.notes }}</div>
      </div>
      <template #footer>
        <button @click="showDetailModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cerrar</button>
        <button v-if="selectedInvoice.status === 'Pendiente' || selectedInvoice.status === 'Vencido'" @click="sendReminder(selectedInvoice)" class="px-4 py-2.5 bg-navy/10 text-navy rounded-xl text-sm font-bold hover:bg-navy/20 transition-colors cursor-pointer">Enviar Recordatorio</button>
        <!-- "📄 Descargar PDF" vivía acá sin handler. No hay PDF que descargar: estas filas son
             SUSCRIPCIONES (`PlatformService.subscriptions()`), no facturas emitidas — la
             plataforma todavía no emite comprobantes propios. Se quita en vez de dejar un botón
             que no puede funcionar. -->
      </template>
    </AppModal>

    <!-- Modal: Recordatorio -->
    <AppModal v-if="showReminderModal" size="md" title="Enviar Recordatorio" body-class="p-6" @close="showReminderModal = false">
      <div class="bg-surface rounded-xl p-3 mb-4">
        <div class="text-sm font-bold text-navy">{{ reminderInvoice.hotel }}</div>
        <div class="text-[10px] text-text-muted">Factura #{{ reminderInvoice.id }} — ${{ reminderInvoice.amount }}</div>
      </div>
      <div class="mb-4"><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Tipo de Recordatorio</label>
        <select v-model="reminderType" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="gentle">Amable — Primer recordatorio</option>
          <option value="firm">Firme — Segundo recordatorio</option>
          <option value="urgent">Urgente — Último aviso antes de suspensión</option>
        </select>
      </div>
      <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Mensaje Personalizado</label><textarea v-model="reminderMessage" rows="4" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy resize-none" placeholder="Escriba un mensaje adicional..."></textarea></div>
      <template #footer>
        <button @click="showReminderModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmReminder" class="px-4 py-2.5 bg-navy text-white rounded-xl text-sm font-extrabold hover:shadow-lg transition-colors cursor-pointer">Enviar</button>
      </template>
    </AppModal>

    <!-- Modal: Confirmar Pago -->
    <AppModal v-if="showConfirmModal" size="md" title="Confirmar Pago" body-class="p-6 text-center" @close="showConfirmModal = false">
      <div class="w-16 h-16 bg-teal/10 rounded-full flex items-center justify-center mx-auto mb-4">
        <span class="text-3xl">✅</span>
      </div>
      <div class="text-sm font-bold text-navy mb-1">¿Marcar como pagado?</div>
      <div class="text-[10px] text-text-muted">Factura #{{ confirmInvoice.id }} — {{ confirmInvoice.hotel }} — ${{ confirmInvoice.amount }}</div>
      <template #footer>
        <button @click="showConfirmModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmMarkAsPaid" class="px-4 py-2.5 bg-teal text-white rounded-xl text-sm font-extrabold hover:shadow-lg transition-colors cursor-pointer">Confirmar Pago</button>
      </template>
    </AppModal>

    <!-- Toast -->
    <div v-if="showToast" class="fixed bottom-6 right-6 bg-navy text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50 animate-fade-in">
      <span class="text-lg">{{ toastIcon }}</span>
      <span class="text-sm font-bold">{{ toastMessage }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from '@/composables/useToast'
import { PlatformService } from '@/services/Platform.service'
import AppModal from '@/components/ui/AppModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'

const toast = useToast()
const loading = ref(true)
const searchQuery = ref('')
const statusFilter = ref('all')
const planFilter = ref('all')
const dateFilter = ref('all')
const sortBy = ref('date-desc')
const activeTab = ref('all')
const showDetailModal = ref(false)
const showReminderModal = ref(false)
const showConfirmModal = ref(false)
const selectedInvoice = ref<any>({})
const reminderInvoice = ref<any>({})
const confirmInvoice = ref<any>({})
const reminderType = ref('gentle')
const reminderMessage = ref('')
const showToast = ref(false)
const toastMessage = ref('')
const toastIcon = ref('')

const EST_EN: Record<string, string> = { paid: 'Pagado', pendiente: 'Pendiente', vencido: 'Vencido' }
const PLAN_PRICE: Record<string, number> = { enterprise: 199, professional: 99, starter: 49, essential: 49 }

const invoices = ref<any[]>([])

onMounted(async () => {
  loading.value = true
  try {
    const d = await PlatformService.subscriptions()
    invoices.value = (d.data ?? []).map((h: any, i: number) => {
      const plan = String(h.plan || 'starter').toLowerCase()
      const price = PLAN_PRICE[plan] ?? 49
      const estado = h.status === 'pendiente' ? 'Pendiente' : h.status === 'suspendido' ? 'Vencido' : 'Pagado'
      return {
        id: `INV-${String(i + 1).padStart(3, '0')}`,
        hotel: h.name,
        plan: plan.charAt(0).toUpperCase() + plan.slice(1),
        concept: `Plan ${plan} — Junio 2026`,
        amount: price, method: 'Tarjeta', status: estado,
        date: h.createdAt ? String(h.createdAt).slice(0, 10) : '',
        dueDate: '', notes: '',
      }
    })
  } catch { toast.error('No se pudo cargar la facturación') } finally { loading.value = false }
})

const tabs = computed(() => {
  const inv = invoices.value
  return [
    { label: 'Todas', value: 'all', count: inv.length },
    { label: 'Pagadas', value: 'Pagado', count: inv.filter(i => i.status === 'Pagado').length },
    { label: 'Pendientes', value: 'Pendiente', count: inv.filter(i => i.status === 'Pendiente').length },
    { label: 'Vencidas', value: 'Vencido', count: inv.filter(i => i.status === 'Vencido').length },
  ]
})

const stats = computed(() => {
  const inv = invoices.value
  const total = inv.reduce((s, i) => s + i.amount, 0)
  const pagado = inv.filter(i => i.status === 'Pagado').reduce((s, i) => s + i.amount, 0)
  const pend = inv.filter(i => i.status === 'Pendiente').reduce((s, i) => s + i.amount, 0)
  const venc = inv.filter(i => i.status === 'Vencido').reduce((s, i) => s + i.amount, 0)
  const tasa = total > 0 ? Math.round((pagado / total) * 1000) / 10 : 0
  return [
    { label: 'Ingresos Totales', value: `$${total.toLocaleString()}`, color: 'text-navy' },
    { label: 'Pagados', value: `$${pagado.toLocaleString()}`, color: 'text-teal' },
    { label: 'Pendientes', value: `$${pend.toLocaleString()}`, color: 'text-orange' },
    { label: 'Vencidos', value: `$${venc.toLocaleString()}`, color: 'text-red' },
    { label: 'Tasa de Cobro', value: `${tasa}%`, color: 'text-teal' },
  ]
})

const activeFiltersCount = computed(() => {
  let count = 0
  if (statusFilter.value !== 'all') count++
  if (planFilter.value !== 'all') count++
  if (dateFilter.value !== 'all') count++
  if (searchQuery.value) count++
  return count
})

const filteredInvoices = computed(() => {
  let result = [...invoices.value]

  if (activeTab.value !== 'all') result = result.filter(i => i.status === activeTab.value)
  if (statusFilter.value !== 'all') result = result.filter(i => i.status === statusFilter.value)
  if (planFilter.value !== 'all') result = result.filter(i => i.plan === planFilter.value)
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(i => i.id.toLowerCase().includes(q) || i.hotel.toLowerCase().includes(q) || i.concept.toLowerCase().includes(q))
  }

  const [field, dir] = sortBy.value.split('-')
  result.sort((a: any, b: any) => {
    const aVal = a[field]
    const bVal = b[field]
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal
    return dir === 'desc' ? -cmp : cmp
  })

  return result
})

const toggleSort = (field: string) => {
  if (sortBy.value.startsWith(field)) {
    sortBy.value = sortBy.value.endsWith('asc') ? `${field}-desc` : `${field}-asc`
  } else {
    sortBy.value = `${field}-desc`
  }
}

const clearAllFilters = () => {
  searchQuery.value = ''
  statusFilter.value = 'all'
  planFilter.value = 'all'
  dateFilter.value = 'all'
}

const statusClass = (s: string) => ({ 'Pagado': 'bg-teal/10 text-teal', 'Pendiente': 'bg-orange/10 text-orange', 'Vencido': 'bg-red/10 text-red' }[s] || '')

const openInvoice = (invoice: any) => { selectedInvoice.value = { ...invoice }; showDetailModal.value = true }

const sendReminder = (invoice: any) => { reminderInvoice.value = { ...invoice }; reminderType.value = 'gentle'; reminderMessage.value = ''; showReminderModal.value = true }

const confirmReminder = () => { showReminderModal.value = false; showToastMessage('📧', `Recordatorio enviado a ${reminderInvoice.value.hotel}`) }

const markAsPaid = (invoice: any) => { confirmInvoice.value = { ...invoice }; showConfirmModal.value = true }

const confirmMarkAsPaid = () => {
  const idx = invoices.value.findIndex(i => i.id === confirmInvoice.value.id)
  if (idx !== -1) { invoices.value[idx].status = 'Pagado'; invoices.value[idx].method = 'Manual' }
  showConfirmModal.value = false
  showToastMessage('✅', `Factura #${confirmInvoice.value.id} marcada como pagada`)
}

const exportInvoices = () => {
  const headers = ['Factura', 'Hotel', 'Plan', 'Concepto', 'Monto', 'Método', 'Estado', 'Fecha']
  const rows = filteredInvoices.value.map(i => [i.id, i.hotel, i.plan, i.concept, `$${i.amount}`, i.method, i.status, i.date])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `facturas-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  showToastMessage('📥', 'Facturas exportadas correctamente')
}

const showToastMessage = (icon: string, message: string) => {
  toastIcon.value = icon
  toastMessage.value = message
  showToast.value = true
  setTimeout(() => { showToast.value = false }, 3000)
}
</script>
