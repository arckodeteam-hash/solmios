<template>
  <div class="space-y-5">
    <div v-if="loading" class="text-sm text-text-muted py-4">Cargando amenidades…</div>
    <div v-else-if="loadError" class="text-sm text-rose py-4">
      No pudimos cargar las amenidades. {{ loadError }}
      <button type="button" class="underline font-bold ml-1 cursor-pointer" @click="loadAll">Reintentar</button>
    </div>

    <template v-else>
      <!-- REQ-01 (#233) — Catálogo ABIERTO por hotel: nombre libre + precio. La cuna NO vive acá,
           sigue siendo el toggle Sí/No de "Ofrece cuna para bebés" de arriba. -->
      <p class="text-[10px] text-text-muted">
        Se ofrecen en el motor de reservas para las habitaciones con niños o bebés, con su precio a la vista.
        La cuna se configura arriba y sigue siendo Sí/No.
      </p>

      <div v-if="rows.length === 0" class="rounded-xl border border-border bg-surface p-3 text-[11px] text-text-muted">
        Todavía no hay amenidades. Por ejemplo: Kit de bebé, Silla alta, Niñera por hora.
      </div>

      <div v-for="row in rows" :key="row.id" class="rounded-xl border border-border p-3 space-y-3" :data-amenity-id="row.id">
        <!-- Edición inline: nombre + precio, con Guardar/Cancelar -->
        <div v-if="editingId === row.id" class="flex flex-wrap items-end gap-2">
          <div class="flex-1 min-w-[160px]">
            <label :for="`child-amenity-edit-name-${row.id}`" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nombre</label>
            <input
              :id="`child-amenity-edit-name-${row.id}`"
              v-model="editDraft.name"
              type="text" maxlength="120"
              class="w-full h-8 px-2 rounded-lg border border-border text-xs focus:outline-none focus:border-cyan"
            />
          </div>
          <div>
            <label :for="`child-amenity-edit-price-${row.id}`" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Precio</label>
            <input
              :id="`child-amenity-edit-price-${row.id}`"
              v-model.number="editDraft.price"
              type="number" min="0" step="0.01"
              class="w-28 h-8 px-2 rounded-lg border border-border text-xs focus:outline-none focus:border-cyan"
            />
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-2 bg-navy text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50"
              :disabled="busy || !isValidDraft(editDraft)"
              @click="saveEdit(row)"
            >{{ busy ? 'Guardando…' : 'Guardar' }}</button>
            <button
              type="button"
              class="px-3 py-2 text-xs font-bold text-text-muted rounded-xl border border-border cursor-pointer disabled:opacity-50"
              :disabled="busy"
              @click="cancelEdit"
            >Cancelar</button>
          </div>
        </div>

        <!-- Vista de la fila -->
        <div v-else class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <label class="flex items-center gap-2 cursor-pointer" :title="row.active ? 'Desactivar' : 'Activar'">
              <input
                type="checkbox"
                class="w-4 h-4 rounded text-cyan"
                :checked="row.active"
                :disabled="busy"
                :aria-label="`${row.active ? 'Desactivar' : 'Activar'} ${row.name}`"
                @change="toggleActive(row)"
              />
              <span class="text-xs font-black text-navy truncate">{{ row.name }}</span>
            </label>
            <span class="text-xs text-text-muted shrink-0">{{ formatPrice(row.price) }}</span>
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0"
              :class="row.active ? 'bg-navy text-white' : 'bg-surface text-text-muted border border-border'"
            >{{ row.active ? 'Activa' : 'Inactiva' }}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              class="text-[11px] font-bold text-navy underline cursor-pointer disabled:opacity-50"
              :disabled="busy"
              @click="startEdit(row)"
            >Editar</button>
            <button
              type="button"
              class="text-[11px] font-bold text-rose underline cursor-pointer disabled:opacity-50"
              :disabled="busy"
              @click="removeRow(row)"
            >Eliminar</button>
          </div>
        </div>
      </div>

      <!-- Alta -->
      <div class="flex flex-wrap items-end gap-2 pt-4 border-t border-border">
        <div class="flex-1 min-w-[160px]">
          <label for="child-amenity-new-name" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nueva amenidad</label>
          <input
            id="child-amenity-new-name"
            v-model="newDraft.name"
            type="text" maxlength="120"
            placeholder="Nombre"
            class="w-full h-8 px-2 rounded-lg border border-border text-xs focus:outline-none focus:border-cyan"
            @keydown.enter.prevent="addRow"
          />
        </div>
        <div>
          <label for="child-amenity-new-price" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Precio</label>
          <input
            id="child-amenity-new-price"
            v-model.number="newDraft.price"
            type="number" min="0" step="0.01"
            class="w-28 h-8 px-2 rounded-lg border border-border text-xs focus:outline-none focus:border-cyan"
            @keydown.enter.prevent="addRow"
          />
        </div>
        <button
          type="button"
          class="px-4 py-2 bg-navy text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
          :disabled="busy || !isValidDraft(newDraft)"
          @click="addRow"
        >{{ busy ? 'Guardando…' : 'Agregar' }}</button>
      </div>
      <p class="text-[10px] text-text-muted">Precio 0 = gratuita. Se muestra al huésped con dos decimales, en la moneda del hotel.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ChildAmenitiesService, type ChildAmenity } from '@/services/ChildAmenities.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()

const loading = ref(true)
const loadError = ref('')
const busy = ref(false)

const rows = ref<ChildAmenity[]>([])

interface Draft {
  name: string
  price: number | null
}

const newDraft = reactive<Draft>({ name: '', price: 0 })
const editingId = ref<string | null>(null)
const editDraft = reactive<Draft>({ name: '', price: 0 })

/** Nombre no vacío y precio numérico >= 0 (0 permitido: amenidad gratuita). */
function isValidDraft(d: Draft): boolean {
  const price = typeof d.price === 'number' ? d.price : NaN
  return d.name.trim().length > 0 && Number.isFinite(price) && price >= 0
}

/** Mismo criterio que MealPlansEditor: sin símbolo de moneda, número con 2 decimales. */
function formatPrice(price: number): string {
  return (Number.isFinite(price) ? price : 0).toFixed(2)
}

async function loadAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await ChildAmenitiesService.list()
  } catch (e: any) {
    loadError.value = e?.message || 'Error desconocido'
  } finally {
    loading.value = false
  }
}

/** Recarga la lista tras cada operación: lo que se ve es lo que persistió. */
async function reloadAfter(op: () => Promise<unknown>, okMsg: string, errMsg: string): Promise<boolean> {
  busy.value = true
  try {
    await op()
    toast.success(okMsg)
    await loadAll()
    return true
  } catch (e: any) {
    toast.error(e?.message || errMsg)
    return false
  } finally {
    busy.value = false
  }
}

async function addRow(): Promise<void> {
  if (busy.value || !isValidDraft(newDraft)) return
  const ok = await reloadAfter(
    () => ChildAmenitiesService.create({ name: newDraft.name.trim(), price: newDraft.price as number, active: true }),
    'Amenidad agregada',
    'Error al agregar la amenidad',
  )
  if (ok) {
    newDraft.name = ''
    newDraft.price = 0
  }
}

function startEdit(row: ChildAmenity): void {
  editingId.value = row.id
  editDraft.name = row.name
  editDraft.price = row.price
}

function cancelEdit(): void {
  editingId.value = null
}

async function saveEdit(row: ChildAmenity): Promise<void> {
  if (busy.value || !isValidDraft(editDraft)) return
  const ok = await reloadAfter(
    () => ChildAmenitiesService.update(row.id, { name: editDraft.name.trim(), price: editDraft.price as number }),
    'Amenidad guardada',
    'Error al guardar la amenidad',
  )
  if (ok) editingId.value = null
}

async function toggleActive(row: ChildAmenity): Promise<void> {
  if (busy.value) return
  const next = !row.active
  await reloadAfter(
    () => ChildAmenitiesService.update(row.id, { active: next }),
    next ? 'Amenidad activada' : 'Amenidad desactivada',
    'Error al cambiar el estado de la amenidad',
  )
}

async function removeRow(row: ChildAmenity): Promise<void> {
  if (busy.value) return
  if (!confirm(`¿Eliminar "${row.name}"? Dejará de ofrecerse en el motor de reservas.`)) return
  await reloadAfter(
    () => ChildAmenitiesService.remove(row.id),
    'Amenidad eliminada',
    'Error al eliminar la amenidad',
  )
}

onMounted(loadAll)
</script>

<style scoped>
/* Sin estilos extra: todo viaja por clases utilitarias de Tailwind + design tokens. */
</style>
