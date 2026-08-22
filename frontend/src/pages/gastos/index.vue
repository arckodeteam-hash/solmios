<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { GastosService, type Gasto, type ExpensePaymentMethod } from '@/services/Gastos.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const ICON_RECEIPT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_ALERT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"/></svg>'
const ICON_EDIT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16.86 4.49a2.1 2.1 0 1 1 2.97 2.97L8.4 18.9l-3.9.98.98-3.9L16.86 4.5Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>'

const CATEGORY_LABEL: Record<string, string> = {
  general: 'General',
  supplies: 'Suministros',
  maintenance: 'Mantenimiento',
  cleaning: 'Limpieza',
  staff: 'Personal',
  marketing: 'Marketing',
  utilities: 'Servicios',
}

// Color por categoría: badge `bg-color/10 text-color`, mismo criterio que el resto del panel.
const CATEGORY_CLASS: Record<string, string> = {
  general: 'bg-navy/10 text-navy',
  supplies: 'bg-cyan/10 text-cyan',
  maintenance: 'bg-gold/10 text-gold',
  cleaning: 'bg-teal/10 text-teal',
  staff: 'bg-purple/10 text-purple',
  marketing: 'bg-coral/10 text-coral',
  utilities: 'bg-navy/10 text-navy',
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  other: 'Otro',
}

const auth = useAuthStore()
const toast = useToast()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const gastos = ref<Gasto[]>([])
const loading = ref(false)
const showDialog = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const page = ref(1)
const pages = ref(1)
const totalCount = ref(0)
const LIMIT = 20
const confirmTarget = ref<Gasto | null>(null)
const deleting = ref(false)
// #651 — bloquear sin feedback visible: antes solo un toast (transitorio, sin `role=alert` ni
// asociación con el campo). `saveAttempted` recién activa los mensajes inline tras el primer
// intento de guardar (no antes, para no ensuciar el form recién abierto).
const saveAttempted = ref(false)

const emptyForm = () => ({
  concept: '',
  amount: 0,
  category: 'general',
  provider: '',
  date: new Date().toISOString().split('T')[0],
  notes: '',
  paid: 0,
  paymentMethod: 'cash' as ExpensePaymentMethod,
})
const form = ref(emptyForm())

// Un gasto pagado en efectivo sale del cajón y aparece en el arqueo del turno.
const movesCash = computed(() => form.value.paid === 1 && form.value.paymentMethod === 'cash')
const conceptError = computed(() => saveAttempted.value && !form.value.concept?.trim() ? 'El concepto es obligatorio' : '')
const amountError = computed(() => saveAttempted.value && !(form.value.amount > 0) ? 'El importe debe ser mayor a 0' : '')

onMounted(() => loadData())

async function loadData(p = page.value) {
  loading.value = true
  try {
    const r = await GastosService.list(hotelId.value, p, LIMIT)
    gastos.value = r.data || []
    totalCount.value = r.total ?? 0
    pages.value = r.pages ?? 1
    page.value = p
  } catch (e: unknown) {
    toast.error('No se pudieron cargar los gastos', e instanceof Error ? e.message : undefined)
  } finally {
    loading.value = false
  }
}

// Suma de importes de la página visible (el total global es un count, no una suma de montos).
const pageTotal = computed(() => gastos.value.reduce((s, g) => s + (g.amount || 0), 0))

// Rango visible de la paginación: "1–20 de 47".
const rangeLabel = computed(() => {
  if (!totalCount.value) return '0 gastos'
  const from = (page.value - 1) * LIMIT + 1
  const to = Math.min(page.value * LIMIT, totalCount.value)
  return `${from}–${to} de ${totalCount.value}`
})

function openCreate() {
  form.value = emptyForm()
  editingId.value = null
  saveAttempted.value = false
  showDialog.value = true
}

function openEdit(g: Gasto) {
  form.value = {
    concept: g.concept || '',
    amount: g.amount || 0,
    category: g.category || 'general',
    provider: g.provider || '',
    date: (g.date || '').slice(0, 10) || new Date().toISOString().split('T')[0],
    notes: g.notes || '',
    paid: Number(g.paid) === 1 ? 1 : 0,
    paymentMethod: g.paymentMethod || 'cash',
  }
  editingId.value = g.id ?? null
  saveAttempted.value = false
  showDialog.value = true
}

async function saveGasto() {
  saveAttempted.value = true
  if (!form.value.concept?.trim() || !(form.value.amount > 0)) {
    toast.error('Completa concepto e importe')
    return
  }
  submitting.value = true
  try {
    if (editingId.value) {
      await GastosService.update(editingId.value, { ...form.value })
      toast.success('Gasto actualizado')
    } else {
      await GastosService.create({ ...form.value, hotelId: hotelId.value } as Omit<Gasto, 'id'>)
      toast.success('Gasto creado')
    }
    showDialog.value = false
    await loadData(editingId.value ? page.value : 1)
  } catch (e: unknown) {
    toast.error('No se pudo guardar el gasto', e instanceof Error ? e.message : undefined)
  } finally {
    submitting.value = false
  }
}

function askDelete(g: Gasto) {
  confirmTarget.value = g
}

async function confirmDelete() {
  if (!confirmTarget.value?.id) return
  deleting.value = true
  try {
    await GastosService.remove(confirmTarget.value.id, hotelId.value)
    toast.success('Gasto eliminado')
    confirmTarget.value = null
    // Si era el único de la página y no es la primera, retroceder una página.
    if (gastos.value.length === 1 && page.value > 1) await loadData(page.value - 1)
    else await loadData()
  } catch (e: unknown) {
    toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined)
  } finally {
    deleting.value = false
  }
}

function goPrev() { if (page.value > 1) loadData(page.value - 1) }
function goNext() { if (page.value < pages.value) loadData(page.value + 1) }
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">Gastos</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-xs text-text-muted mt-0.5">Egresos operativos del hotel — suministros, mantenimiento, personal y más</p>
      </div>
      <button @click="openCreate" class="flex items-center gap-1.5 bg-navy text-white text-sm font-extrabold px-5 py-2.5 rounded-full cursor-pointer hover:shadow-lg transition-all">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo gasto
      </button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <KpiHeroCard label="Gastos registrados" :value="totalCount" icon="bookings" accent="blue"
        unit="Egresos del hotel" />
      <KpiHeroCard label="Total de la página" :value="pageTotal" icon="money" accent="rose"
        prefix="$" :unit="`${gastos.length} gasto(s) visibles`" />
    </div>

    <SectionCard title="Listado de gastos" :subtitle="rangeLabel" body-class="p-0">
      <!-- Carga: esqueleto de filas, no un 'Cargando…' suelto -->
      <div v-if="loading" class="space-y-3 p-4">
        <div v-for="i in 5" :key="i" class="h-10 animate-pulse rounded bg-surface"></div>
      </div>

      <EmptyState v-else-if="!gastos.length"
        :icon="ICON_RECEIPT"
        title="Sin gastos registrados"
        message="Registrá un gasto para empezar a llevar el control de egresos.">
        <template #action>
          <button @click="openCreate" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Nuevo gasto</button>
        </template>
      </EmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] tbl-head">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Concepto</th>
                <th class="text-left px-4 py-3 text-[10px]">Categoría</th>
                <th class="text-left px-4 py-3 text-[10px]">Pago</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Fecha</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Proveedor</th>
                <th class="text-right px-4 py-3 text-[10px]">Importe</th>
                <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in gastos" :key="g.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3">
                  <div class="text-sm font-bold text-navy">{{ g.concept }}</div>
                  <!-- En <lg las columnas secundarias suben como línea de apoyo -->
                  <div class="mt-0.5 text-[11px] text-text-muted lg:hidden">
                    {{ (g.date || '').slice(0, 10) }}<template v-if="g.provider"> · {{ g.provider }}</template>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
                    :class="CATEGORY_CLASS[g.category || ''] || 'bg-navy/10 text-navy'">
                    {{ CATEGORY_LABEL[g.category || ''] || g.category || 'General' }}
                  </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span v-if="Number(g.paid) === 1" class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase bg-teal/10 text-teal">
                    {{ PAYMENT_METHOD_LABEL[g.paymentMethod || 'other'] }}
                  </span>
                  <span v-else class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase bg-coral/10 text-coral">Impago</span>
                </td>
                <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">{{ (g.date || '').slice(0, 10) }}</td>
                <td class="px-4 py-3 text-sm hidden lg:table-cell">
                  <!-- El proveedor es opcional: la celda lo dice en vez de quedar muda -->
                  <span class="block max-w-[200px] truncate" :class="g.provider ? 'text-text-secondary' : 'text-text-muted'">
                    {{ g.provider || 'Sin proveedor' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right text-sm font-extrabold text-coral tabular-nums">${{ (g.amount || 0).toLocaleString() }}</td>
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-1.5">
                    <button @click="openEdit(g)" title="Editar gasto"
                      class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                      <span class="h-4 w-4" v-html="ICON_EDIT"></span>
                    </button>
                    <button @click="askDelete(g)" title="Eliminar gasto"
                      class="grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
                      <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Paginación -->
        <div v-if="pages > 1" class="flex items-center justify-between border-t border-border px-4 py-3">
          <span class="text-[11px] font-bold text-text-muted">{{ rangeLabel }}</span>
          <div class="flex items-center gap-1">
            <button @click="goPrev" :disabled="page <= 1" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
            <span class="px-2 text-xs font-bold text-navy">{{ page }} / {{ pages }}</span>
            <button @click="goNext" :disabled="page >= pages" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
          </div>
        </div>
      </template>
    </SectionCard>

    <!-- Modal crear/editar gasto -->
    <AppModal v-if="showDialog" size="md" :title="editingId ? 'Editar gasto' : 'Nuevo gasto'"
      subtitle="Egreso operativo del hotel" @close="showDialog = false">
      <div class="space-y-4">
        <div>
          <label for="gasto-concept" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Concepto <span class="text-coral">*</span></label>
          <input id="gasto-concept" name="concept" aria-required="true" v-model="form.concept" required :aria-invalid="!!conceptError" placeholder="Ej: Compra de detergentes" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none" :class="conceptError ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:border-navy'" />
          <p v-if="conceptError" role="alert" class="mt-1 text-[11px] font-semibold text-coral">{{ conceptError }}</p>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label for="gasto-amount" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Importe <span class="text-coral">*</span></label>
            <input id="gasto-amount" name="amount" aria-required="true" v-model.number="form.amount" type="number" min="0.01" step="0.01" required :aria-invalid="!!amountError" placeholder="0.00" class="w-full rounded-xl border px-4 py-2.5 text-right text-sm font-bold text-navy tabular-nums focus:outline-none" :class="amountError ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:border-navy'" />
            <p v-if="amountError" role="alert" class="mt-1 text-[11px] font-semibold text-coral">{{ amountError }}</p>
          </div>
          <div class="col-span-2">
            <label for="gastos-categoria" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Categoría</label>
            <select id="gastos-categoria" name="category" v-model="form.category" class="w-full cursor-pointer rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
              <option value="general">General</option><option value="supplies">Suministros</option>
              <option value="maintenance">Mantenimiento</option><option value="cleaning">Limpieza</option>
              <option value="staff">Personal</option><option value="marketing">Marketing</option>
              <option value="utilities">Servicios</option>
            </select>
          </div>
        </div>
        <div>
          <label for="gastos-proveedor" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Proveedor</label>
          <input id="gastos-proveedor" name="provider" v-model="form.provider" placeholder="Opcional" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="gastos-fecha" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Fecha</label>
            <input id="gastos-fecha" name="date" v-model="form.date" type="date" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
          </div>
          <div>
            <label for="gastos-metodo-de-pago" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Método de pago</label>
            <select id="gastos-metodo-de-pago" name="paymentMethod" v-model="form.paymentMethod" class="w-full cursor-pointer rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
              <option value="cash">Efectivo</option><option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option><option value="other">Otro</option>
            </select>
          </div>
        </div>
        <div>
          <label class="flex items-center gap-2 cursor-pointer">
            <input id="gastos-ya-esta-pagado" name="paid" v-model.number="form.paid" type="checkbox" :true-value="1" :false-value="0" class="h-4 w-4 accent-navy cursor-pointer" />
            <span class="text-sm font-bold text-navy">Ya está pagado</span>
          </label>
          <p v-if="movesCash" class="mt-1.5 pl-6 text-[11px] text-text-muted">
            Sale del cajón: se registra como egreso en el arqueo del turno abierto.
          </p>
        </div>
        <div>
          <label for="gastos-notas" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Notas</label>
          <textarea id="gastos-notas" name="notes" v-model="form.notes" placeholder="Opcional" rows="2" class="w-full resize-none rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none"></textarea>
        </div>
      </div>

      <template #footer>
        <button @click="showDialog = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveGasto" :disabled="submitting"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ submitting ? 'Guardando…' : (editingId ? 'Actualizar' : 'Guardar') }}
        </button>
      </template>
    </AppModal>

    <!-- Modal confirmar eliminar -->
    <AppModal v-if="confirmTarget" size="sm" title="Eliminar gasto" @close="confirmTarget = null">
      <div class="text-center">
        <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-coral/10">
          <span class="h-6 w-6 text-coral" v-html="ICON_ALERT"></span>
        </div>
        <p class="text-sm text-text-secondary">
          ¿Seguro que querés eliminar <strong class="text-navy">{{ confirmTarget.concept }}</strong>
          (<span class="font-bold text-navy tabular-nums">${{ (confirmTarget.amount || 0).toLocaleString() }}</span>)?
        </p>
        <p class="mt-1 text-xs text-text-muted">Esta acción no se puede deshacer.</p>
      </div>
      <template #footer>
        <button @click="confirmTarget = null" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmDelete" :disabled="deleting"
          class="inline-flex items-center gap-2 rounded-full bg-coral px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50">
          <span class="h-4 w-4" v-html="ICON_TRASH"></span>
          {{ deleting ? 'Eliminando…' : 'Eliminar' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped></style>
