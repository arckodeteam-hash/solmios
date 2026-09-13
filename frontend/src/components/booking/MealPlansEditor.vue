<template>
  <!-- #361 — Catálogo ABIERTO de regímenes (Configuración Base → Regímenes). Antes era un
       enum fijo de 3 códigos con "Guardar regímenes" dentro de Página pública → Motor de
       reservas; ahora el hotel da de alta/baja los que quiera y el motor sólo decide si los
       muestra (switch `showMealPlans`). Cada acción persiste sola (mismo patrón que los
       contactos de emergencia de Configuración): no hay un "Guardar" global de la sección. -->
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-4">
      <p class="text-[11px] text-text-muted leading-relaxed">
        El suplemento es por persona y por noche, en {{ currency }}. Con 0 el régimen queda
        incluido en la tarifa. Los inactivos no se ofrecen al huésped.
      </p>
      <button
        type="button"
        data-testid="meal-plan-add"
        :disabled="loading"
        class="shrink-0 px-4 py-2 bg-navy/10 text-navy rounded-full text-sm font-bold hover:bg-navy/20 transition-colors cursor-pointer disabled:opacity-50"
        @click="openCreate"
      >+ Agregar régimen</button>
    </div>

    <div v-if="loading" class="text-sm text-text-muted py-4">Cargando regímenes…</div>
    <div v-else-if="loadError" class="text-sm text-rose py-4">
      No pudimos cargar los regímenes. {{ loadError }}
      <button type="button" class="underline font-bold ml-1 cursor-pointer" @click="loadAll">Reintentar</button>
    </div>

    <div v-else-if="items.length === 0" class="p-6 bg-surface rounded-xl text-center" data-testid="meal-plan-empty">
      <p class="text-xs text-text-muted">Todavía no cargaste regímenes. Agregá el primero con “+ Agregar régimen”.</p>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="row in items"
        :key="row.id"
        data-testid="meal-plan-row"
        class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-3 bg-surface rounded-xl"
        :class="{ 'opacity-60': !row.active }"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-bold text-navy" data-testid="meal-plan-name">{{ row.name }}</span>
            <span class="text-[10px] font-mono text-text-muted">{{ row.code }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-bold"
              :class="row.active ? 'bg-teal/15 text-teal' : 'bg-navy/10 text-text-muted'"
              data-testid="meal-plan-status"
            >{{ row.active ? 'Activo' : 'Inactivo' }}</span>
          </div>
          <p v-if="row.description" class="text-[11px] text-text-muted mt-0.5">{{ row.description }}</p>
          <p class="text-[11px] font-bold text-navy mt-1" data-testid="meal-plan-price">{{ priceLabel(row) }}</p>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <label class="flex items-center gap-2 cursor-pointer mr-2" :title="row.active ? 'Desactivar' : 'Activar'">
            <span class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                class="sr-only peer"
                data-testid="meal-plan-toggle"
                :checked="row.active"
                :disabled="busyIds.has(row.id)"
                :aria-label="`${row.active ? 'Desactivar' : 'Activar'} ${row.name}`"
                @change="toggleActive(row, $event)"
              />
              <span class="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal"></span>
            </span>
          </label>
          <button
            type="button"
            data-testid="meal-plan-edit"
            class="px-3 py-2 rounded-xl bg-navy/10 text-navy text-xs font-bold hover:bg-navy/20 transition-colors cursor-pointer"
            @click="openEdit(row)"
          >Editar</button>
          <button
            type="button"
            data-testid="meal-plan-delete"
            class="px-3 py-2 rounded-xl bg-danger/10 text-danger text-xs font-bold hover:bg-danger/20 transition-colors cursor-pointer"
            @click="askRemove(row)"
          >Eliminar</button>
        </div>
      </div>
    </div>

    <!-- Alta / edición: mismo formulario, `draft.id` decide -->
    <AppModal v-if="draft" size="md" :title="draft.id ? 'Editar régimen' : 'Nuevo régimen'" :closable="!saving" @close="closeForm">
      <form class="space-y-4" data-testid="meal-plan-form" @submit.prevent="submitForm">
        <div>
          <label for="meal-plan-name" class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Nombre *</label>
          <input
            id="meal-plan-name"
            v-model="draft.name"
            name="name"
            type="text"
            :maxlength="NAME_MAX"
            placeholder="Ej.: Media pensión"
            class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none"
          />
        </div>
        <div>
          <label for="meal-plan-description" class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Descripción</label>
          <textarea
            id="meal-plan-description"
            v-model="draft.description"
            name="description"
            rows="2"
            :maxlength="DESCRIPTION_MAX"
            placeholder="Opcional. Ej.: Desayuno y cena en el restaurante del hotel"
            class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none resize-none"
          ></textarea>
        </div>
        <div>
          <label for="meal-plan-price" class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Suplemento por persona y noche ({{ currency }})</label>
          <input
            id="meal-plan-price"
            v-model="draft.price"
            name="price"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none"
          />
          <p class="mt-1 text-[10px] text-text-muted">0 = incluido en la tarifa.</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input id="meal-plan-active" v-model="draft.active" name="active" type="checkbox" class="w-4 h-4 rounded text-cyan" />
          <span class="text-sm font-bold text-navy">Activo</span>
          <span class="text-[10px] text-text-muted">— se ofrece en el motor de reservas</span>
        </label>
        <p v-if="formError" class="text-[11px] font-bold text-danger" data-testid="meal-plan-form-error">{{ formError }}</p>
      </form>
      <template #footer>
        <button type="button" :disabled="saving" class="px-4 py-2 rounded-xl text-sm font-bold text-text-secondary border border-border hover:bg-white cursor-pointer disabled:opacity-50" @click="closeForm">Cancelar</button>
        <button type="button" data-testid="meal-plan-save" :disabled="saving" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50" @click="submitForm">
          {{ saving ? 'Guardando…' : (draft.id ? 'Guardar cambios' : 'Crear régimen') }}
        </button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  MealPlansService,
  type MealPlan,
  type CreateMealPlanInput,
} from '@/services/MealPlans.service'
import { formatCurrency } from '@/composables/useCurrency'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'

const props = withDefaults(defineProps<{
  /** Moneda del hotel para mostrar el suplemento (`hotels.currency`). */
  currency?: string
}>(), { currency: 'USD' })

/** Mismos topes que el backend (meal-plans-crud.ts MEAL_PLAN_NAME_MAX / DESCRIPTION_MAX). */
const NAME_MAX = 80
const DESCRIPTION_MAX = 300

const toast = useToast()

const loading = ref(true)
const loadError = ref('')
const items = ref<MealPlan[]>([])
/** Filas con un update/remove en vuelo (toggle) — evita doble click. */
const busyIds = ref(new Set<string>())

interface Draft {
  id: string | null
  name: string
  description: string
  price: number | string
  active: boolean
}
const draft = ref<Draft | null>(null)
const saving = ref(false)
const formError = ref('')

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e) => toast.error((e as Error)?.message || 'No pudimos eliminar el régimen'),
})

function priceLabel(row: MealPlan): string {
  if (row.priceMode !== 'per_person_per_night' || !(row.price > 0)) return 'Incluido en la tarifa'
  return `${formatCurrency(row.price, props.currency)} por persona y noche`
}

async function loadAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    items.value = await MealPlansService.list()
  } catch (e: any) {
    loadError.value = e?.message || 'Error desconocido'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  formError.value = ''
  draft.value = { id: null, name: '', description: '', price: 0, active: true }
}

function openEdit(row: MealPlan): void {
  formError.value = ''
  draft.value = {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    price: row.price,
    active: row.active,
  }
}

function closeForm(): void {
  if (saving.value) return
  draft.value = null
  formError.value = ''
}

/** Valida el borrador y lo traduce al body de la API. Devuelve null (y setea formError) si no pasa. */
function toInput(d: Draft): CreateMealPlanInput | null {
  const name = d.name.trim()
  if (!name) { formError.value = 'El nombre es obligatorio'; return null }
  if (name.length > NAME_MAX) { formError.value = `El nombre debe tener como máximo ${NAME_MAX} caracteres`; return null }
  const description = d.description.trim()
  if (description.length > DESCRIPTION_MAX) { formError.value = `La descripción debe tener como máximo ${DESCRIPTION_MAX} caracteres`; return null }
  const price = d.price === '' || d.price === null || d.price === undefined ? 0 : Number(d.price)
  if (!Number.isFinite(price) || price < 0) { formError.value = 'El suplemento debe ser un número mayor o igual a 0'; return null }
  // Descripción vacía → `''`, NUNCA `null`: el validador del backend descarta las claves `null`
  // no requeridas del PATCH, así que con `null` la descripción vieja quedaba sin limpiar. El
  // backend mapea `''` → null.
  return { name, description, price, active: d.active }
}

async function submitForm(): Promise<void> {
  if (!draft.value || saving.value) return
  formError.value = ''
  const input = toInput(draft.value)
  if (!input) return
  saving.value = true
  try {
    if (draft.value.id) {
      await MealPlansService.update(draft.value.id, input)
      toast.success('Régimen actualizado')
    } else {
      await MealPlansService.create(input)
      toast.success('Régimen creado')
    }
    draft.value = null
    await loadAll()
  } catch (e: any) {
    formError.value = e?.message || 'No pudimos guardar el régimen'
  } finally {
    saving.value = false
  }
}

async function toggleActive(row: MealPlan, ev: Event): Promise<void> {
  const active = (ev.target as HTMLInputElement).checked
  if (busyIds.value.has(row.id)) return
  busyIds.value.add(row.id)
  const previous = row.active
  row.active = active
  try {
    const updated = await MealPlansService.update(row.id, { active })
    Object.assign(row, updated)
  } catch (e: any) {
    row.active = previous
    toast.error(e?.message || 'No pudimos cambiar el estado del régimen')
  } finally {
    busyIds.value.delete(row.id)
  }
}

function askRemove(row: MealPlan): void {
  askConfirm({
    title: 'Eliminar régimen',
    message: `¿Eliminar “${row.name}”? Las reservas ya hechas conservan el régimen que eligieron; sólo deja de ofrecerse a partir de ahora.`,
    confirmLabel: 'Eliminar',
    danger: true,
    run: async () => {
      await MealPlansService.remove(row.id)
      items.value = items.value.filter((r) => r.id !== row.id)
      toast.success('Régimen eliminado')
    },
  })
}

onMounted(loadAll)
</script>

<style scoped>
/* Sin estilos extra: todo viaja por clases utilitarias de Tailwind + design tokens. */
</style>
