<template>
  <div class="space-y-4">
    <div v-if="loading" class="text-sm text-text-muted py-4">Cargando regímenes…</div>
    <div v-else-if="loadError" class="text-sm text-rose py-4">
      No pudimos cargar los regímenes. {{ loadError }}
      <button class="underline font-bold ml-1 cursor-pointer" @click="loadAll">Reintentar</button>
    </div>

    <template v-else>
      <!-- Cabecera -->
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] text-text-muted">
          {{ rows.length }} {{ rows.length === 1 ? 'régimen' : 'regímenes' }} · {{ activeCount }} activo{{ activeCount === 1 ? '' : 's' }}
        </p>
        <button
          type="button"
          data-testid="meal-plan-add"
          class="shrink-0 px-4 py-2 bg-navy/10 text-navy rounded-full text-xs font-bold hover:bg-navy/20 transition-colors cursor-pointer disabled:opacity-50"
          :disabled="formOpen"
          @click="openCreate"
        >+ Agregar régimen</button>
      </div>

      <!-- Formulario inline (alta o edición) -->
      <form
        v-if="formOpen"
        data-testid="meal-plan-form"
        class="rounded-xl border border-cyan/60 bg-surface p-4 space-y-3"
        @submit.prevent="save"
      >
        <p class="text-xs font-black text-navy">{{ editingId ? 'Editar régimen' : 'Nuevo régimen' }}</p>

        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Nombre *</label>
          <input
            v-model="draft.name"
            data-testid="meal-plan-name"
            type="text" maxlength="80" required
            placeholder="Ej: Desayuno incluido"
            class="w-full h-9 px-3 rounded-lg border border-border text-sm bg-white focus:outline-none focus:border-cyan"
          />
        </div>

        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Descripción (opcional)</label>
          <textarea
            v-model="draft.description"
            data-testid="meal-plan-description"
            maxlength="500" rows="2"
            placeholder="Qué incluye el régimen. El huésped lo ve en el motor de reservas."
            class="w-full px-3 py-2 rounded-lg border border-border text-sm bg-white focus:outline-none focus:border-cyan resize-y"
          ></textarea>
        </div>

        <div class="space-y-2">
          <span class="block text-[10px] font-bold text-text-muted uppercase tracking-wide">Precio</span>
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-1.5 text-[11px] font-bold text-navy cursor-pointer">
              <input v-model="draft.priceMode" data-testid="meal-plan-mode-included" type="radio" name="meal-plan-price-mode" value="included" class="text-cyan" />
              Incluido en la tarifa
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-bold text-navy cursor-pointer">
              <input v-model="draft.priceMode" data-testid="meal-plan-mode-supplement" type="radio" name="meal-plan-price-mode" value="per_person_per_night" class="text-cyan" />
              Con suplemento
            </label>
          </div>
          <div v-if="draft.priceMode === 'per_person_per_night'" class="flex items-center gap-2">
            <input
              v-model.number="draft.price"
              data-testid="meal-plan-price"
              type="number" min="0" step="0.01"
              class="w-28 h-8 px-2 rounded-lg border border-border text-xs bg-white focus:outline-none focus:border-cyan"
            />
            <span class="text-[10px] text-text-muted">por persona, por noche</span>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="draft.active" data-testid="meal-plan-form-active" type="checkbox" class="w-4 h-4 rounded text-cyan" />
          <span class="text-xs font-bold text-navy">Activo</span>
          <span class="text-[10px] text-text-muted">— se ofrece en el motor de reservas</span>
        </label>

        <p v-if="formError" class="text-[11px] font-bold text-rose">{{ formError }}</p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            class="px-4 py-2 text-xs font-bold text-text-secondary rounded-xl border border-border bg-white cursor-pointer hover:border-navy/30"
            :disabled="busy"
            @click="closeForm"
          >Cancelar</button>
          <button
            type="submit"
            data-testid="meal-plan-save"
            class="px-4 py-2 bg-navy text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50"
            :disabled="busy"
          >{{ busy ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </form>

      <!-- Estado vacío -->
      <div v-if="rows.length === 0 && !formOpen" class="p-6 bg-surface rounded-xl text-center space-y-3">
        <p class="text-xs text-text-muted">
          Todavía no hay regímenes. El motor de reservas funcionará sin ofrecer régimen.
        </p>
        <button
          type="button"
          data-testid="meal-plan-add"
          class="px-4 py-2 bg-navy/10 text-navy rounded-full text-xs font-bold hover:bg-navy/20 transition-colors cursor-pointer"
          @click="openCreate"
        >+ Agregar régimen</button>
      </div>

      <!-- Lista -->
      <div v-else-if="rows.length > 0" class="space-y-2">
        <div
          v-for="row in rows"
          :key="row.id"
          data-testid="meal-plan-row"
          class="flex items-start gap-3 rounded-xl border border-border p-3"
          :class="row.active ? 'bg-white' : 'bg-surface'"
        >
          <label class="flex items-center gap-2 cursor-pointer shrink-0 pt-0.5" :title="row.active ? 'Activo' : 'Inactivo'">
            <input
              data-testid="meal-plan-active"
              type="checkbox"
              class="w-4 h-4 rounded text-cyan"
              :checked="row.active"
              :disabled="busy"
              @change="toggleActive(row, ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-black" :class="row.active ? 'text-navy' : 'text-text-muted'">{{ row.name }}</span>
              <span class="text-[10px] font-bold text-text-muted">{{ priceLabel(row) }}</span>
              <span v-if="!row.active" class="rounded-full bg-border px-2 py-0.5 text-[10px] font-bold text-text-muted">Inactivo</span>
            </div>
            <p v-if="row.description" class="text-[11px] text-text-muted mt-0.5 leading-relaxed">{{ row.description }}</p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-testid="meal-plan-edit"
              class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-navy bg-navy/10 hover:bg-navy/20 transition-colors cursor-pointer disabled:opacity-50"
              :disabled="busy"
              @click="openEdit(row)"
            >Editar</button>
            <button
              type="button"
              data-testid="meal-plan-delete"
              class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-danger bg-danger/10 hover:bg-danger/20 transition-colors cursor-pointer disabled:opacity-50"
              :disabled="busy"
              @click="removeRow(row)"
            >Eliminar</button>
          </div>
        </div>
      </div>

      <p class="text-[10px] text-text-muted pt-3 border-t border-border">
        Si están activos y la opción "Mostrar regímenes en el motor de reservas" de Página pública →
        Motor de reservas está encendida, el huésped elige uno por habitación.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { MealPlansService, type MealPlan, type MealPlanPriceMode } from '@/services/MealPlans.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()

const loading = ref(true)
const loadError = ref('')
const busy = ref(false)

const rows = ref<MealPlan[]>([])
const activeCount = computed(() => rows.value.filter((r) => r.active).length)

// ─── Formulario inline (alta / edición) ─────────────────────────────────────
interface Draft {
  name: string
  description: string
  priceMode: MealPlanPriceMode
  price: number
  active: boolean
}
const EMPTY_DRAFT: Draft = { name: '', description: '', priceMode: 'included', price: 0, active: true }

const formOpen = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const draft = reactive<Draft>({ ...EMPTY_DRAFT })

function resetDraft(from?: MealPlan): void {
  draft.name = from?.name ?? EMPTY_DRAFT.name
  draft.description = from?.description ?? EMPTY_DRAFT.description
  draft.priceMode = from?.priceMode ?? EMPTY_DRAFT.priceMode
  draft.price = from?.price ?? EMPTY_DRAFT.price
  draft.active = from?.active ?? EMPTY_DRAFT.active
  formError.value = ''
}

function openCreate(): void {
  editingId.value = null
  resetDraft()
  formOpen.value = true
}

function openEdit(row: MealPlan): void {
  editingId.value = row.id
  resetDraft(row)
  formOpen.value = true
}

function closeForm(): void {
  formOpen.value = false
  editingId.value = null
  resetDraft()
}

/** Misma validación que el backend (name 1..80, description ≤ 500, price ≥ 0) para fallar
 *  antes del round-trip con un mensaje claro. */
function validateDraft(): string {
  const name = draft.name.trim()
  if (!name) return 'El nombre es obligatorio.'
  if (name.length > 80) return 'El nombre no puede superar los 80 caracteres.'
  if (draft.description.trim().length > 500) return 'La descripción no puede superar los 500 caracteres.'
  if (draft.priceMode === 'per_person_per_night' && (!Number.isFinite(draft.price) || draft.price < 0)) {
    return 'El precio tiene que ser un número mayor o igual a 0.'
  }
  return ''
}

async function save(): Promise<void> {
  formError.value = validateDraft()
  if (formError.value) return
  const payload = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    priceMode: draft.priceMode,
    price: draft.priceMode === 'per_person_per_night' ? draft.price : 0,
    active: draft.active,
  }
  busy.value = true
  try {
    if (editingId.value) {
      await MealPlansService.update(editingId.value, payload)
      toast.success('Régimen actualizado')
    } else {
      await MealPlansService.create(payload)
      toast.success('Régimen creado')
    }
    closeForm()
    await loadAll()
  } catch (e: any) {
    formError.value = e?.message || 'Error al guardar el régimen'
    toast.error(formError.value)
  } finally {
    busy.value = false
  }
}

// ─── Acciones por fila ──────────────────────────────────────────────────────
async function toggleActive(row: MealPlan, active: boolean): Promise<void> {
  const previous = row.active
  row.active = active
  busy.value = true
  try {
    await MealPlansService.update(row.id, { active })
    toast.success(active ? `"${row.name}" activado` : `"${row.name}" desactivado`)
  } catch (e: any) {
    row.active = previous
    toast.error(e?.message || 'Error al actualizar el régimen')
  } finally {
    busy.value = false
  }
}

async function removeRow(row: MealPlan): Promise<void> {
  if (!window.confirm(`¿Eliminar el régimen "${row.name}"? Las reservas ya hechas conservan su régimen.`)) return
  busy.value = true
  try {
    await MealPlansService.remove(row.id)
    toast.success('Régimen eliminado')
    if (editingId.value === row.id) closeForm()
    await loadAll()
  } catch (e: any) {
    toast.error(e?.message || 'Error al eliminar el régimen')
  } finally {
    busy.value = false
  }
}

function priceLabel(row: MealPlan): string {
  if (row.priceMode === 'per_person_per_night') {
    return `+ $${formatPrice(row.price)} por persona/noche`
  }
  return 'Incluido en la tarifa'
}

function formatPrice(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// ─── Carga ──────────────────────────────────────────────────────────────────
async function loadAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await MealPlansService.list()
  } catch (e: any) {
    loadError.value = e?.message || 'Error desconocido'
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
/* Sin estilos extra: todo viaja por clases utilitarias de Tailwind + design tokens. */
</style>
