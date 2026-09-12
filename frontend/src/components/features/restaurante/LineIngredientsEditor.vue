<script setup lang="ts">
// components/features/restaurante/LineIngredientsEditor.vue — Receta de un plato de la comanda, con
// quitar / doble / agregar ingredientes. Lo usan el tablero de cocina (cocina.vue, con la receta ya
// resuelta en la cola) y la comanda del mozo (comanda.vue, que la pide por ítem al desplegar).
// Cada ingrediente de la receta tiene tres estados: normal · SIN (quitado) · DOBLE (porción doble).
// Además se puede agregar un ingrediente que no está en la receta (CON), o anotar SIN/DOBLE de algo
// a mano si el plato no tiene receta cargada. Todo se guarda en la línea (`ingredientChanges`) con
// `PUT /restaurant/kds/lines/:id/ingredients` (estado final, no deltas); no cambia el precio.
import { ref, computed, watch } from 'vue'
import { RestaurantService, type OrderLine, type IngredientChanges, type RecipeIngredient } from '@/services/Restaurant.service'
import { useToast } from '@/composables/useToast'

const props = withDefaults(defineProps<{
  line: OrderLine
  /** Receta ya resuelta (KDS). Si no viene y la línea tiene `menuItemId`, se pide al desplegar. */
  ingredients?: RecipeIngredient[]
  /** false = solo lectura (sin permiso `restaurant:edit`, o comanda cerrada). */
  editable?: boolean
  /** Arranca desplegado (la comanda lo abre a pedido; el KDS también). */
  open?: boolean
  /** Tamaño de letra del plato en el KDS (kiosco). */
  size?: 'sm' | 'md'
}>(), { editable: false, open: false, size: 'sm' })

const emit = defineEmits<{ (e: 'updated', line: OrderLine): void }>()
const toast = useToast()

const expanded = ref(props.open)
const loaded = ref<RecipeIngredient[] | null>(null)
const loading = ref(false)
const saving = ref(false)
const draft = ref('')

const recipe = computed<RecipeIngredient[]>(() => props.ingredients ?? loaded.value ?? [])
const changes = computed<IngredientChanges>(() => ({
  removed: [...(props.line.ingredientChanges?.removed ?? [])],
  added: [...(props.line.ingredientChanges?.added ?? [])],
  doubled: [...(props.line.ingredientChanges?.doubled ?? [])],
}))
const hasChanges = computed(() => changes.value.removed.length + changes.value.added.length + changes.value.doubled.length > 0)

const same = (a: string, b: string) => a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es')
const inList = (list: string[], name: string) => list.some((n) => same(n, name))
const without = (list: string[], name: string) => list.filter((n) => !same(n, name))
const isRemoved = (name: string) => inList(changes.value.removed, name)
const isDoubled = (name: string) => inList(changes.value.doubled, name)

/** Cantidad de la receta multiplicada por las unidades del plato (y ×2 si va doble). */
function qty(ing: RecipeIngredient): string {
  const v = (Number(ing.quantity) || 0) * (Number(props.line.quantity) || 1) * (isDoubled(ing.name) ? 2 : 1)
  const num = Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 3 : 2).replace(/\.?0+$/, '')
  return `${num} ${ing.unit === 'unit' ? 'u' : ing.unit}`
}

async function toggle() {
  expanded.value = !expanded.value
  if (expanded.value && !props.ingredients && loaded.value === null && props.line.menuItemId) {
    loading.value = true
    try { loaded.value = await RestaurantService.menuItemIngredients(props.line.menuItemId) }
    catch { loaded.value = [] }
    finally { loading.value = false }
  }
}
// Si el padre cambia de línea (misma instancia reusada por :key), volver a pedir la receta.
watch(() => props.line.menuItemId, () => { loaded.value = null })

async function save(next: IngredientChanges) {
  if (!props.editable || saving.value) return
  saving.value = true
  try {
    const updated = await RestaurantService.setLineIngredients(props.line.id, next)
    emit('updated', updated)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo guardar el cambio de receta')
  } finally {
    saving.value = false
  }
}
/** SIN: tocar de nuevo lo restituye. Quitar saca el doble (no se puede "sin" y "doble" a la vez). */
function toggleRemoved(name: string) {
  const c = changes.value
  if (isRemoved(name)) c.removed = without(c.removed, name)
  else { c.removed = [...c.removed, name]; c.doubled = without(c.doubled, name) }
  void save(c)
}
/** DOBLE: tocar de nuevo vuelve a porción normal. Doblar saca el "sin". */
function toggleDoubled(name: string) {
  const c = changes.value
  if (isDoubled(name)) c.doubled = without(c.doubled, name)
  else { c.doubled = [...c.doubled, name]; c.removed = without(c.removed, name) }
  void save(c)
}
function dropAdded(name: string) {
  const c = changes.value
  c.added = without(c.added, name)
  void save(c)
}
/** Lo tipeado: CON (extra que no está en la receta), SIN o DOBLE de algo que no figura (plato sin receta). */
function submitDraft(as: 'added' | 'removed' | 'doubled') {
  const name = draft.value.trim()
  if (!name) return
  const c = changes.value
  if (!inList(c[as], name)) c[as] = [...c[as], name]
  if (as === 'removed') c.doubled = without(c.doubled, name)
  if (as === 'doubled') c.removed = without(c.removed, name)
  draft.value = ''
  void save(c)
}

const btn = 'min-h-9 px-2.5 rounded-lg text-xs font-bold disabled:opacity-50'
</script>

<template>
  <div class="space-y-1.5" data-testid="line-ingredients">
    <!-- Cambios ya hechos: siempre visibles, aunque la receta esté plegada. -->
    <div v-if="hasChanges" class="flex flex-wrap gap-1" data-testid="ingredient-changes">
      <span v-for="n in changes.removed" :key="'sin-' + n" class="px-2 py-0.5 rounded-md bg-danger/10 text-danger text-xs font-black">SIN {{ n }}</span>
      <span v-for="n in changes.doubled" :key="'dob-' + n" class="px-2 py-0.5 rounded-md bg-navy/10 text-navy text-xs font-black">DOBLE {{ n }}</span>
      <span v-for="n in changes.added" :key="'con-' + n" class="px-2 py-0.5 rounded-md bg-success/10 text-success text-xs font-black">CON {{ n }}</span>
    </div>

    <button type="button" @click="toggle" :aria-expanded="expanded" data-testid="ingredients-toggle"
      class="w-full min-h-10 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface text-xs font-bold text-navy hover:bg-navy/10">
      <span>🥣 Receta<template v-if="recipe.length"> · {{ recipe.length }} ingredientes</template><template v-else-if="loading"> · cargando…</template><template v-else-if="expanded || ingredients"> · sin cargar</template></span>
      <span aria-hidden="true">{{ expanded ? '▴' : '▾' }}</span>
    </button>

    <div v-if="expanded" class="rounded-xl border border-border p-2 space-y-2 bg-white" data-testid="ingredients-panel">
      <p v-if="loading" class="text-[11px] text-text-muted">Cargando receta…</p>
      <p v-else-if="!recipe.length" class="text-[11px] text-text-muted">
        Este plato no tiene receta cargada (Carta → ítem → Receta).<template v-if="editable"> Igual podés anotar qué va sin, doble o con.</template>
      </p>
      <ul v-else class="space-y-1">
        <li v-for="ing in recipe" :key="ing.name" class="flex items-center justify-between gap-2">
          <span :class="['leading-tight', size === 'md' ? 'text-base' : 'text-sm', isRemoved(ing.name) ? 'line-through text-danger/70' : isDoubled(ing.name) ? 'text-navy font-black' : 'text-navy']">
            {{ ing.name }}<span v-if="isDoubled(ing.name)"> ×2</span>
            <span class="text-[11px] text-text-muted font-normal"> · {{ qty(ing) }}</span>
          </span>
          <span v-if="editable" class="shrink-0 flex gap-1">
            <button type="button" @click="toggleDoubled(ing.name)" :disabled="saving" data-testid="ingredient-double"
              :class="[btn, isDoubled(ing.name) ? 'bg-navy text-white' : 'border-2 border-navy/30 text-navy']" :title="isDoubled(ing.name) ? 'Volver a porción normal' : 'Porción doble'">×2</button>
            <button type="button" @click="toggleRemoved(ing.name)" :disabled="saving" data-testid="ingredient-remove"
              :class="[btn, isRemoved(ing.name) ? 'bg-navy/10 text-navy' : 'border-2 border-danger/40 text-danger']">{{ isRemoved(ing.name) ? '↺ Poner' : '− Quitar' }}</button>
          </span>
        </li>
      </ul>
      <!-- Extras que no están en la receta (CON) + SIN/DOBLE anotados a mano. -->
      <ul v-if="changes.added.length || (!recipe.length && (changes.removed.length || changes.doubled.length))" class="space-y-1">
        <li v-for="n in changes.added" :key="'a-' + n" class="flex items-center justify-between gap-2">
          <span class="text-sm text-success font-bold">+ {{ n }}</span>
          <button v-if="editable" type="button" @click="dropAdded(n)" :disabled="saving" :class="[btn, 'bg-navy/10 text-navy']">Sacar</button>
        </li>
        <template v-if="!recipe.length">
          <li v-for="n in changes.removed" :key="'r-' + n" class="flex items-center justify-between gap-2">
            <span class="text-sm text-danger font-bold line-through">{{ n }}</span>
            <button v-if="editable" type="button" @click="toggleRemoved(n)" :disabled="saving" :class="[btn, 'bg-navy/10 text-navy']">↺ Poner</button>
          </li>
          <li v-for="n in changes.doubled" :key="'d-' + n" class="flex items-center justify-between gap-2">
            <span class="text-sm text-navy font-black">{{ n }} ×2</span>
            <button v-if="editable" type="button" @click="toggleDoubled(n)" :disabled="saving" :class="[btn, 'bg-navy/10 text-navy']">Normal</button>
          </li>
        </template>
      </ul>
      <form v-if="editable" class="flex flex-wrap gap-1.5" @submit.prevent="submitDraft('added')">
        <input v-model="draft" type="text" maxlength="60" placeholder="Ingrediente…" data-testid="ingredient-input"
          class="flex-1 min-w-[8rem] min-h-10 px-2.5 rounded-lg border-2 border-border text-sm text-navy focus:border-navy outline-none" @mousedown.stop @dragstart.stop />
        <button type="submit" :disabled="saving || !draft.trim()" data-testid="ingredient-add" class="min-h-10 px-3 rounded-lg bg-success text-white text-xs font-bold disabled:opacity-50">+ Agregar</button>
        <button type="button" @click="submitDraft('doubled')" :disabled="saving || !draft.trim()" data-testid="ingredient-add-double" class="min-h-10 px-3 rounded-lg border-2 border-navy/30 text-navy text-xs font-bold disabled:opacity-50">×2 Doble</button>
        <button type="button" @click="submitDraft('removed')" :disabled="saving || !draft.trim()" data-testid="ingredient-add-remove" class="min-h-10 px-3 rounded-lg border-2 border-danger/40 text-danger text-xs font-bold disabled:opacity-50">− Quitar</button>
      </form>
    </div>
  </div>
</template>

<style scoped></style>
