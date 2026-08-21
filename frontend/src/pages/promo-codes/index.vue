<template>
  <div>
    <!-- Header -->
    <div class="flex items-center gap-2.5 mb-1.5">
      <h2 class="text-xl font-black text-navy">Códigos de descuento</h2>
    </div>

    <div class="flex items-start justify-between gap-3 mb-6 flex-wrap">
      <p class="text-sm text-text-secondary max-w-lg">
        Los huéspedes los aplican en el paso de pago del motor de reservas público.
      </p>
      <button @click="openNew" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer shrink-0">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo código
      </button>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Códigos" :value="codes.length" icon="bookings" accent="blue"
        unit="Creados en total" />
      <KpiHeroCard label="Activos" :value="activeCount" icon="checkin" accent="teal"
        :unit="inactiveCount ? `${inactiveCount} inactivo(s)` : 'Todos activos'" :progress="activeSharePct" />
      <KpiHeroCard label="Usos totales" :value="totalUses" icon="money" accent="amber"
        unit="Reservas que aplicaron algún código" />
    </div>

    <!-- Tabla -->
    <SectionCard title="Códigos" :subtitle="`${codes.length} código(s)`">
      <!-- Loading -->
      <div v-if="loading" class="space-y-2">
        <div v-for="i in 3" :key="i" class="h-14 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <!-- Error -->
      <EmptyState
        v-else-if="error"
        :icon="ICON_TAG"
        title="No se pudieron cargar los códigos"
        :message="error"
      >
        <template #action>
          <button @click="load" class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Reintentar</button>
        </template>
      </EmptyState>

      <!-- Sin datos -->
      <EmptyState
        v-else-if="codes.length === 0"
        :icon="ICON_TAG"
        title="Todavía no creaste ningún código de descuento"
        message="Un código como BIENVENIDA10 (10% off) o el que se te ocurra — se lo compartís a tus huéspedes o lo publicás en redes."
      >
        <template #action>
          <button @click="openNew" class="flex items-center gap-1.5 mx-auto bg-navy text-white font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
            <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
            Nuevo código
          </button>
        </template>
      </EmptyState>

      <!-- Tabla -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="tbl-head">
              <th class="text-left px-3 py-2 font-bold text-text-muted uppercase text-[10px]">Código</th>
              <th class="text-left px-3 py-2 font-bold text-text-muted uppercase text-[10px]">Descuento</th>
              <th class="text-left px-3 py-2 font-bold text-text-muted uppercase text-[10px]">Mínimo</th>
              <th class="text-left px-3 py-2 font-bold text-text-muted uppercase text-[10px]">Usos</th>
              <th class="text-left px-3 py-2 font-bold text-text-muted uppercase text-[10px]">Vigencia</th>
              <th class="text-left px-3 py-2 font-bold text-text-muted uppercase text-[10px]">Estado</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in codes" :key="c.id" class="border-b border-border last:border-0 hover:bg-surface/60">
              <td class="px-3 py-3 font-mono font-black text-navy">{{ c.code }}</td>
              <td class="px-3 py-3 font-bold text-navy">{{ discountLabel(c) }}</td>
              <td class="px-3 py-3 text-text-secondary">{{ c.minAmount ? formatMoney(c.minAmount) : '—' }}</td>
              <td class="px-3 py-3 text-text-secondary">{{ c.uses ?? 0 }}{{ c.maxUses ? ` / ${c.maxUses}` : '' }}</td>
              <td class="px-3 py-3 text-text-secondary">{{ validityLabel(c) }}</td>
              <td class="px-3 py-3">
                <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" :class="c.active === false ? 'bg-surface text-text-muted' : 'bg-teal/10 text-teal'">
                  {{ c.active === false ? 'Inactivo' : 'Activo' }}
                </span>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center justify-end gap-1">
                  <button @click="openEdit(c)" title="Editar" aria-label="Editar"
                    class="w-8 h-8 grid place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="w-4 h-4" v-html="ICON_EDIT"></span>
                  </button>
                  <button @click="askDelete(c)" title="Eliminar" aria-label="Eliminar"
                    class="w-8 h-8 grid place-items-center rounded-lg text-text-secondary hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer">
                    <span class="w-4 h-4" v-html="ICON_TRASH"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal: alta / edición -->
    <AppModal
      :open="showModal"
      size="lg"
      :title="editing ? 'Editar código' : 'Nuevo código de descuento'"
      subtitle="Se valida en el widget público al momento de pagar"
      @close="closeModal"
    >
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2">
          <label for="promo-codes-codigo" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Código *</label>
          <input id="promo-codes-codigo" name="code" required aria-required="true"
            v-model="form.code"
            maxlength="40"
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm font-mono uppercase focus:outline-none focus:border-navy"
            :class="codeError ? 'border-danger' : ''"
            placeholder="Ej: BIENVENIDA10"
            @input="form.code = form.code.toUpperCase()"
          >
          <p v-if="codeError" class="text-[10px] text-danger mt-1">{{ codeError }}</p>
          <p v-else class="text-[10px] text-text-muted mt-1">Se guarda en mayúsculas. El huésped lo escribe tal cual en el widget.</p>
        </div>

        <div>
          <label for="promo-codes-tipo-de-descuento" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Tipo de descuento</label>
          <select id="promo-codes-tipo-de-descuento" name="kind" required aria-required="true" v-model="form.kind" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
            <option value="percent">Porcentaje (%)</option>
            <option value="fixed">Monto fijo</option>
          </select>
        </div>
        <div>
          <label for="promo-codes-valor" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">
            Valor {{ form.kind === 'percent' ? '(0-100)' : '(en la moneda del hotel)' }} *
          </label>
          <input id="promo-codes-valor" name="value" required aria-required="true"
            v-model.number="form.value"
            type="number"
            min="0"
            :max="form.kind === 'percent' ? 100 : undefined"
            step="0.01"
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"
            :class="valueError ? 'border-danger' : ''"
            :placeholder="form.kind === 'percent' ? 'Ej: 10' : 'Ej: 500'"
          >
          <p v-if="valueError" class="text-[10px] text-danger mt-1">{{ valueError }}</p>
        </div>

        <div>
          <label for="promo-codes-subtotal-minimo" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Subtotal mínimo</label>
          <input id="promo-codes-subtotal-minimo" name="minAmount" v-model.number="form.minAmount" type="number" min="0" step="0.01"
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="Sin mínimo">
        </div>
        <div>
          <label for="promo-codes-maximo-de-usos" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Máximo de usos</label>
          <input id="promo-codes-maximo-de-usos" name="maxUses" v-model.number="form.maxUses" type="number" min="1" step="1"
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="Sin límite">
        </div>

        <div>
          <label for="promo-codes-valido-desde" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Válido desde</label>
          <input id="promo-codes-valido-desde" name="validFrom" v-model="form.validFrom" type="date" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
        </div>
        <div>
          <label for="promo-codes-valido-hasta" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Válido hasta</label>
          <input id="promo-codes-valido-hasta" name="validTo" v-model="form.validTo" type="date" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
        </div>

        <div class="col-span-2 flex items-center gap-2">
          <input id="promo-active" v-model="form.active" type="checkbox" class="w-4 h-4 accent-cyan cursor-pointer">
          <label for="promo-active" class="text-xs font-bold text-text-secondary cursor-pointer">Código activo</label>
        </div>
      </div>

      <template #footer>
        <button @click="closeModal" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <button @click="save" :disabled="saving" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-extrabold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando...' : (editing ? 'Guardar cambios' : 'Crear código') }}
        </button>
      </template>
    </AppModal>

    <!-- Modal: confirmar eliminación -->
    <ConfirmModal
      v-if="deleteTarget"
      title="Eliminar código"
      :message="`¿Seguro que querés eliminar el código ${deleteTarget.code}? Esta acción no se puede deshacer.`"
      confirm-label="Eliminar"
      danger
      :loading="deleting"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import {
  PromoCodeService,
  type PromoCode,
  type CreatePromoCodeInput,
} from '@/services/PromoCode.service'

const toast = useToast()

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_TAG = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z"/></svg>'
const ICON_EDIT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.5v4.875A2.625 2.625 0 0 1 16.875 21H5.625A2.625 2.625 0 0 1 3 18.375V7.125A2.625 2.625 0 0 1 5.625 4.5H10.5"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>'

const codes = ref<PromoCode[]>([])
const loading = ref(false)
const error = ref('')

const showModal = ref(false)
const editing = ref<PromoCode | null>(null)
const saving = ref(false)
const codeError = ref('')
const valueError = ref('')

const deleteTarget = ref<PromoCode | null>(null)
const deleting = ref(false)

interface CodeForm {
  code: string
  kind: 'percent' | 'fixed'
  value: number | null
  minAmount: number | null
  maxUses: number | null
  validFrom: string
  validTo: string
  active: boolean
}

function emptyForm(): CodeForm {
  return { code: '', kind: 'percent', value: null, minAmount: null, maxUses: null, validFrom: '', validTo: '', active: true }
}
const form = ref<CodeForm>(emptyForm())

// ── KPIs ──────────────────────────────────────────────────────────────────
const activeCount = computed(() => codes.value.filter(c => c.active !== false).length)
const inactiveCount = computed(() => codes.value.length - activeCount.value)
const activeSharePct = computed(() => codes.value.length ? Math.round((activeCount.value / codes.value.length) * 100) : 0)
const totalUses = computed(() => codes.value.reduce((sum, c) => sum + (c.uses ?? 0), 0))

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    codes.value = await PromoCodeService.list()
  } catch {
    error.value = 'No se pudieron cargar los códigos de descuento.'
  } finally {
    loading.value = false
  }
}

// Sin prefijo de moneda: el store de auth no expone la currency del hotel (solo hotelName),
// y asumir USD sería incorrecto para hoteles que facturan en DOP u otra. El widget público SÍ
// conoce la currency real (hotels.currency) y la usa al cobrar.
function formatMoney(n: number): string {
  return n.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function discountLabel(c: PromoCode): string {
  return c.kind === 'percent' ? `${c.value}%` : formatMoney(c.value)
}

function validityLabel(c: PromoCode): string {
  if (!c.validFrom && !c.validTo) return 'Sin vencimiento'
  if (c.validFrom && c.validTo) return `${c.validFrom} → ${c.validTo}`
  if (c.validFrom) return `Desde ${c.validFrom}`
  return `Hasta ${c.validTo}`
}

function openNew() {
  editing.value = null
  codeError.value = ''
  valueError.value = ''
  form.value = emptyForm()
  showModal.value = true
}

function openEdit(c: PromoCode) {
  editing.value = c
  codeError.value = ''
  valueError.value = ''
  form.value = {
    code: c.code,
    kind: c.kind,
    value: c.value,
    minAmount: c.minAmount ?? null,
    maxUses: c.maxUses ?? null,
    validFrom: c.validFrom ?? '',
    validTo: c.validTo ?? '',
    active: c.active !== false,
  }
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

async function save() {
  codeError.value = ''
  valueError.value = ''
  const code = form.value.code.trim().toUpperCase()
  if (!code) {
    codeError.value = 'El código es obligatorio.'
    return
  }
  const value = form.value.value
  if (value === null || Number.isNaN(value) || value < 0) {
    valueError.value = 'Ingresá un valor válido.'
    return
  }
  if (form.value.kind === 'percent' && value > 100) {
    valueError.value = 'El porcentaje no puede superar 100.'
    return
  }
  saving.value = true
  const payload: CreatePromoCodeInput = {
    code,
    kind: form.value.kind,
    value,
    minAmount: form.value.minAmount ?? null,
    maxUses: form.value.maxUses ?? null,
    validFrom: form.value.validFrom || null,
    validTo: form.value.validTo || null,
    active: form.value.active,
  }
  try {
    if (editing.value) {
      await PromoCodeService.update(editing.value.id, payload)
      toast.success('Código actualizado')
    } else {
      await PromoCodeService.create(payload)
      toast.success('Código creado')
    }
    showModal.value = false
    editing.value = null
    await load()
  } catch (e) {
    // El backend rechaza duplicados / value inválido con 400 y mensaje claro — lo mostramos
    // tal cual en vez de un genérico, ayuda a corregir sin adivinar.
    const msg = (e as { message?: string })?.message
    toast.error(msg || (editing.value ? 'Error al actualizar el código' : 'Error al crear el código'))
  } finally {
    saving.value = false
  }
}

function askDelete(c: PromoCode) {
  deleteTarget.value = c
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await PromoCodeService.remove(deleteTarget.value.id)
    toast.success('Código eliminado')
    deleteTarget.value = null
    await load()
  } catch {
    toast.error('Error al eliminar el código')
  } finally {
    deleting.value = false
  }
}
</script>
