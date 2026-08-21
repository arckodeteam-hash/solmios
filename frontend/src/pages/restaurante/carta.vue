<script setup lang="ts">
// pages/restaurante/carta.vue — Administración de la carta del POS: estaciones (pantallas KDS),
// categorías (ruteadas a una estación) e ítems. RES-7. CRUD vía RestaurantService (sin fetch directo).
import { ref, computed, onMounted } from 'vue'
import {
  RestaurantService,
  type Station, type MenuCategory, type MenuItem, type ModifierGroup, type Combo, type ComboPayload,
  type FoodCostReportRow, type ItemTranslation, type AllergenTag,
  ALLERGEN_OPTIONS, ALLERGEN_LABELS,
} from '@/services/Restaurant.service'
import { SettingsService } from '@/services/Settings.service'
import { InventarioService, type InventoryItem, type MenuItemRecipe } from '@/services/Inventario.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import { supportedLangs } from '@/composables/useSupportedLangs'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePermissions } from '@/composables/usePermissions'

const toast = useToast()
const { can } = usePermissions()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Eliminado'),
  onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudo eliminar'),
})

const loading = ref(true)
const saving = ref(false)
const stations = ref<Station[]>([])
const categories = ref<MenuCategory[]>([])
const items = ref<MenuItem[]>([])
const combos = ref<Combo[]>([])
const inventory = ref<InventoryItem[]>([])
// F3: reporte de food cost del hotel (costo receta + margen por ítem/combo). Solo se pide si editPerm
// (mismo gate que el backend: 'restaurant-catalog:view', ningún rol operativo lo tiene).
const foodCostRows = ref<FoodCostReportRow[]>([])
const foodCostSearch = ref('')
const foodCostCategoryFilter = ref<string>('all')
const currency = ref<string>(CurrencyCode.USD)
const activeCategoryId = ref<string>('all')
const defaultTaxName = ref('')
const defaultTaxRate = ref(0)

// La carta (estaciones/categorías/ítems/recetas) es config, no operación del POS — gateada por
// 'restaurant-catalog' (QA-ALTO: separado de 'restaurant' para que mesero/cocina no la editen).
const editPerm = computed(() => can('restaurant-catalog', 'edit'))
const createPerm = computed(() => can('restaurant-catalog', 'create'))
const deletePerm = computed(() => can('restaurant-catalog', 'delete'))

const stationName = (id?: string): string => stations.value.find((s) => s.id === id)?.name || 'Sin estación'
const categoryName = (id: string): string => categories.value.find((c) => c.id === id)?.name || '—'
const money = (n: number): string => `${currencySymbol(currency.value)}${Number(n || 0).toFixed(2)}`

// F5 — el checkbox-group de FormModal viaja como string[] pese a que el tipo declarado del payload es
// Record<string, string|number> (ver comentario en FormModal.vue:emit). Se normaliza acá, en el único
// lugar donde se lee ese campo.
function allergensFromForm(raw: unknown): AllergenTag[] {
  return Array.isArray(raw) ? (raw as AllergenTag[]) : []
}
const allergenLabel = (tag: string): string => ALLERGEN_LABELS[tag as AllergenTag] ?? tag

const filteredItems = computed(() =>
  activeCategoryId.value === 'all' ? items.value : items.value.filter((i) => i.categoryId === activeCategoryId.value),
)

// F3 — food cost: lookup por id (item o combo comparten el mismo espacio de ids en el reporte, pero
// nunca colisionan porque cada uno tiene su propia tabla). `hasRecipe`/`marginPercent` null → sin badge.
const foodCostById = computed(() => {
  const m = new Map<string, FoodCostReportRow>()
  for (const r of foodCostRows.value) m.set(r.id, r)
  return m
})
function foodCostFor(id: string): FoodCostReportRow | undefined { return foodCostById.value.get(id) }
/** verde >50%, ámbar 20-50%, rojo <20% o negativo (specs/menu-food-cost/spec.md, sección UI). */
function marginClass(pct: number): string {
  if (pct < 20) return 'bg-danger/10 text-danger'
  if (pct < 50) return 'bg-warning/10 text-warning'
  return 'bg-success/10 text-success'
}
const filteredFoodCostRows = computed(() => {
  const term = foodCostSearch.value.trim().toLowerCase()
  return foodCostRows.value.filter((r) => {
    if (term && !r.name.toLowerCase().includes(term)) return false
    if (foodCostCategoryFilter.value !== 'all') {
      if (r.kind !== 'item') return false
      const catId = items.value.find((i) => i.id === r.id)?.categoryId
      if (catId !== foodCostCategoryFilter.value) return false
    }
    return true
  })
})

async function load() {
  loading.value = true
  try {
    const [st, cat, it, combosRes, inv, settings, foodCostRes] = await Promise.all([
      RestaurantService.listStations(),
      RestaurantService.listCategories(),
      RestaurantService.listItems(),
      RestaurantService.listCombos(),
      InventarioService.listItems().catch(() => [] as InventoryItem[]),
      SettingsService.get().catch(() => null),
      // F3: solo si editPerm (mismo gate que el backend, 'restaurant-catalog:view') — evita un 403 inútil
      // para mesero/cocina, que ni siquiera ven el badge.
      editPerm.value ? RestaurantService.foodCostReport().catch(() => [] as FoodCostReportRow[]) : Promise.resolve([] as FoodCostReportRow[]),
    ])
    stations.value = st.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    categories.value = cat.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    items.value = it.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    combos.value = combosRes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    inventory.value = inv
    foodCostRows.value = foodCostRes
    currency.value = (settings as any)?.hotel?.currency || 'USD'
    defaultTaxName.value = (settings as any)?.hotel?.taxName || 'impuesto'
    defaultTaxRate.value = Number((settings as any)?.hotel?.taxRate) || 0
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar la carta')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ─── Modal genérico ───
const modal = ref<{ title: string; submitLabel: string; fields: FormField[]; onSubmit: (v: Record<string, string | number>) => Promise<void> } | null>(null)

function stationOptions(includeNone = true) {
  const opts = stations.value.map((s) => ({ value: s.id, label: s.name }))
  return includeNone ? [{ value: '', label: 'Sin estación' }, ...opts] : opts
}

// ─── Estaciones ───
// F8 — igual que categorías/ítems: el admin ya no escribe `sortOrder` a mano; se calcula al final
// de la lista y el reorder es exclusivamente por arrastre (sección "Drag-and-drop" más abajo).
function nextStationSortOrder(): number {
  return stations.value.length ? Math.max(...stations.value.map((s) => s.sortOrder ?? 0)) + 1 : 0
}
function newStation() {
  modal.value = {
    title: 'Nueva estación', submitLabel: 'Crear',
    fields: [
      { key: 'name', label: 'Nombre (ej: Cocina, Bar)', required: true, minLength: 2, maxLength: 60 },
      { key: 'active', label: 'Activa', type: 'select', default: '1', options: [{ value: '1', label: 'Sí' }, { value: '0', label: 'No' }] },
    ],
    onSubmit: async (v) => {
      await save(() => RestaurantService.createStation({ name: String(v.name).trim(), sortOrder: nextStationSortOrder(), active: Number(v.active) }))
    },
  }
}
function editStation(s: Station) {
  modal.value = {
    title: 'Editar estación', submitLabel: 'Guardar',
    fields: [
      { key: 'name', label: 'Nombre', required: true, minLength: 2, maxLength: 60, default: s.name },
      { key: 'active', label: 'Activa', type: 'select', default: String(s.active ?? 1), options: [{ value: '1', label: 'Sí' }, { value: '0', label: 'No' }] },
    ],
    onSubmit: async (v) => {
      // sortOrder NO viaja acá: el PUT de estaciones es un merge parcial (stations-crud.ts:50) y el
      // orden se gestiona solo por drag-and-drop — reenviarlo pisaría el resultado de un reorder previo.
      await save(() => RestaurantService.updateStation(s.id, { name: String(v.name).trim(), active: Number(v.active) }))
    },
  }
}
function delStation(s: Station) {
  askConfirm({
    title: 'Eliminar estación', message: `¿Eliminar "${s.name}"? Las categorías/ítems que la usan caen al ruteo por defecto.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => { await RestaurantService.deleteStation(s.id); await load() },
  })
}

// ─── Categorías ───
// F8 — el admin ya no escribe `sortOrder` a mano: se calcula al vuelo (al final de la lista) y el
// reorder pasa a ser exclusivamente por arrastre (ver sección "Drag-and-drop" más abajo).
function nextCategorySortOrder(): number {
  return categories.value.length ? Math.max(...categories.value.map((c) => c.sortOrder ?? 0)) + 1 : 0
}
function newCategory() {
  modal.value = {
    title: 'Nueva categoría', submitLabel: 'Crear',
    fields: [
      { key: 'name', label: 'Nombre (ej: Entradas, Bebidas)', required: true, minLength: 2, maxLength: 60 },
      { key: 'stationId', label: 'Estación (ruteo KDS)', type: 'select', options: stationOptions(), hint: 'A dónde van los platos de esta categoría' },
    ],
    onSubmit: async (v) => {
      await save(() => RestaurantService.createCategory({ name: String(v.name).trim(), stationId: v.stationId ? String(v.stationId) : undefined, sortOrder: nextCategorySortOrder() }))
    },
  }
}
function editCategory(c: MenuCategory) {
  modal.value = {
    title: 'Editar categoría', submitLabel: 'Guardar',
    fields: [
      { key: 'name', label: 'Nombre', required: true, minLength: 2, maxLength: 60, default: c.name },
      { key: 'stationId', label: 'Estación (ruteo KDS)', type: 'select', default: c.stationId ?? '', options: stationOptions() },
    ],
    onSubmit: async (v) => {
      // sortOrder NO viaja acá: el PUT es un merge parcial (categories-crud.ts:78) y el orden se
      // gestiona solo por drag-and-drop — reenviarlo pisaría el resultado de un reorder previo.
      await save(() => RestaurantService.updateCategory(c.id, { name: String(v.name).trim(), stationId: v.stationId ? String(v.stationId) : undefined }))
    },
  }
}
function delCategory(c: MenuCategory) {
  askConfirm({
    title: 'Eliminar categoría', message: `¿Eliminar "${c.name}"? Solo se puede si no tiene ítems.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => { await RestaurantService.deleteCategory(c.id); await load() },
  })
}

// ─── Ítems ───
// F8 — igual que categorías: `sortOrder` se calcula (al final de SU categoría) en vez de escribirse a
// mano; el reorder es exclusivamente drag-and-drop.
function nextItemSortOrder(categoryId: string): number {
  const existing = items.value.filter((i) => i.categoryId === categoryId)
  return existing.length ? Math.max(...existing.map((i) => i.sortOrder ?? 0)) + 1 : 0
}
function newItem() {
  if (!categories.value.length) { toast.warning('Creá una categoría primero'); return }
  modal.value = {
    title: 'Nuevo ítem', submitLabel: 'Crear',
    fields: [
      { key: 'name', label: 'Nombre del plato', required: true, minLength: 2, maxLength: 120 },
      { key: 'categoryId', label: 'Categoría', type: 'select', required: true, default: categories.value[0]?.id, options: categories.value.map((c) => ({ value: c.id, label: c.name })) },
      { key: 'price', label: 'Precio de venta', type: 'number', required: true, min: 0 },
      { key: 'taxRate', label: `Impuesto (%)`, type: 'number', min: 0,
        hint: `Vacío = usa el ${defaultTaxName.value} general del hotel (${defaultTaxRate.value}%)` },
      { key: 'description', label: 'Descripción', type: 'textarea', maxLength: 300 },
      { key: 'imageUrl', label: 'Foto del plato', type: 'file', accept: 'image/*', hint: 'Opcional' },
      { key: 'stationId', label: 'Estación (override)', type: 'select', options: stationOptions(), hint: 'Vacío = hereda de la categoría' },
      // F5 — multi-select de checkboxes con el catálogo fijo de alérgenos/info dietética.
      { key: 'allergens', label: 'Alérgenos / info dietética', type: 'checkbox-group', options: ALLERGEN_OPTIONS,
        hint: 'Informativo: nunca bloquea que el mesero agregue el plato a una comanda.' },
      // F6 — destacado ("plato del día") + franja horaria de disponibilidad.
      { key: 'featured', label: 'Destacado', type: 'select', default: '0', options: [{ value: '0', label: 'No' }, { value: '1', label: 'Sí' }],
        hint: 'Se resalta con ★ en Carta, Comanda y la carta pública. Sin efecto en disponibilidad.' },
      { key: 'availableFrom', label: 'Disponible desde', type: 'time',
        hint: 'Dejá ambos campos vacíos = sin restricción horaria (disponible todo el día).' },
      { key: 'availableTo', label: 'Disponible hasta', type: 'time',
        hint: 'Franja que cruza medianoche (ej. 22:00→02:00) es válida.' },
    ],
    onSubmit: async (v) => {
      const categoryId = String(v.categoryId)
      await save(() => RestaurantService.createItem({
        name: String(v.name).trim(), categoryId, price: Number(v.price) || 0,
        taxRate: v.taxRate !== undefined && v.taxRate !== '' ? Number(v.taxRate) : undefined,
        description: v.description ? String(v.description) : undefined,
        imageUrl: v.imageUrl ? String(v.imageUrl) : undefined,
        stationId: v.stationId ? String(v.stationId) : undefined, sortOrder: nextItemSortOrder(categoryId),
        allergens: allergensFromForm(v.allergens),
        featured: Number(v.featured) || 0,
        availableFrom: v.availableFrom ? String(v.availableFrom) : undefined,
        availableTo: v.availableTo ? String(v.availableTo) : undefined,
      }))
    },
  }
}
function editItem(i: MenuItem) {
  modal.value = {
    title: 'Editar ítem', submitLabel: 'Guardar',
    fields: [
      { key: 'name', label: 'Nombre del plato', required: true, minLength: 2, maxLength: 120, default: i.name },
      { key: 'categoryId', label: 'Categoría', type: 'select', required: true, default: i.categoryId, options: categories.value.map((c) => ({ value: c.id, label: c.name })) },
      { key: 'price', label: 'Precio de venta', type: 'number', required: true, min: 0, default: i.price },
      { key: 'taxRate', label: `Impuesto (%)`, type: 'number', min: 0, default: i.taxRate ?? '',
        hint: `Vacío = usa el ${defaultTaxName.value} general del hotel (${defaultTaxRate.value}%)` },
      { key: 'description', label: 'Descripción', type: 'textarea', maxLength: 300, default: i.description ?? '' },
      { key: 'imageUrl', label: 'Foto del plato', type: 'file', accept: 'image/*', default: i.imageUrl ?? '', hint: 'Opcional' },
      { key: 'stationId', label: 'Estación (override)', type: 'select', default: i.stationId ?? '', options: stationOptions() },
      // F5 — multi-select de checkboxes con el catálogo fijo de alérgenos/info dietética.
      { key: 'allergens', label: 'Alérgenos / info dietética', type: 'checkbox-group', options: ALLERGEN_OPTIONS,
        defaultArray: i.allergens ?? [],
        hint: 'Informativo: nunca bloquea que el mesero agregue el plato a una comanda.' },
      // F6 — destacado ("plato del día") + franja horaria de disponibilidad.
      { key: 'featured', label: 'Destacado', type: 'select', default: String(i.featured ?? 0), options: [{ value: '0', label: 'No' }, { value: '1', label: 'Sí' }],
        hint: 'Se resalta con ★ en Carta, Comanda y la carta pública. Sin efecto en disponibilidad.' },
      { key: 'availableFrom', label: 'Disponible desde', type: 'time', default: i.availableFrom ?? '',
        hint: 'Dejá ambos campos vacíos = sin restricción horaria (disponible todo el día).' },
      { key: 'availableTo', label: 'Disponible hasta', type: 'time', default: i.availableTo ?? '',
        hint: 'Franja que cruza medianoche (ej. 22:00→02:00) es válida.' },
    ],
    onSubmit: async (v) => {
      // sortOrder NO viaja acá (merge parcial, items-crud.ts:161): el orden lo gestiona solo el
      // drag-and-drop — reenviarlo pisaría el resultado de un reorder previo.
      await save(() => RestaurantService.updateItem(i.id, {
        name: String(v.name).trim(), categoryId: String(v.categoryId), price: Number(v.price) || 0,
        taxRate: v.taxRate !== undefined && v.taxRate !== '' ? Number(v.taxRate) : undefined,
        description: v.description ? String(v.description) : undefined,
        imageUrl: v.imageUrl ? String(v.imageUrl) : undefined,
        stationId: v.stationId ? String(v.stationId) : undefined,
        allergens: allergensFromForm(v.allergens),
        featured: Number(v.featured) || 0,
        // FormModal siempre manda el campo (vacío o con valor, nunca undefined): '' explícito limpia la
        // franja a "sin restricción" en el backend (assertTimeWindow trata '' como "sin valor").
        availableFrom: String(v.availableFrom ?? ''),
        availableTo: String(v.availableTo ?? ''),
      }))
    },
  }
}
async function toggleAvailability(i: MenuItem) {
  try {
    await RestaurantService.setItemAvailability(i.id, i.available ? 0 : 1)
    await load()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo cambiar') }
}
function delItem(i: MenuItem) {
  askConfirm({
    title: 'Eliminar ítem', message: `¿Eliminar "${i.name}"?`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => { await RestaurantService.deleteItem(i.id); await load() },
  })
}

// ─── Reordenar por drag-and-drop (F8) ───
// Mismo patrón HTML5 nativo YA usado en pages/maintenance/index.vue (draggable + @dragstart/
// @dragover.prevent/@drop.prevent, opacity-50 en la fila arrastrada) — sin vuedraggable/sortablejs
// (D14, specs/menu-ordering/spec.md). El handle "⋮⋮" es el ÚNICO elemento con draggable="true": la fila
// entera solo escucha dragover/drop/dragend, así un click en "Editar"/"Eliminar" nunca dispara un drag.
const draggedStation = ref<Station | null>(null)
const draggedCategory = ref<MenuCategory | null>(null)
const draggedItem = ref<MenuItem | null>(null)
let stationsSnapshot: Station[] = []
let categoriesSnapshot: MenuCategory[] = []
let itemsSnapshot: MenuItem[] = []

// Estaciones: F8 aplica el MISMO reorden por arrastre que categorías e ítems (la auditoría del
// módulo lo tenía como deuda: orden manual por número). Las estaciones no se anidan ni se
// agrupan: el drag mueve dentro de la lista plana, igual que categorías.
function onStationDragStart(e: DragEvent, s: Station) {
  stationsSnapshot = stations.value.map((x) => ({ ...x }))
  draggedStation.value = s
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', s.id)
}
function onStationDragOver(target: Station) {
  const dragged = draggedStation.value
  if (!dragged || dragged.id === target.id) return
  const list = stations.value
  const from = list.findIndex((s) => s.id === dragged.id)
  const to = list.findIndex((s) => s.id === target.id)
  if (from === -1 || to === -1 || from === to) return
  list.splice(to, 0, list.splice(from, 1)[0])
}
function onStationDragEnd() {
  if (draggedStation.value) {
    stations.value = stationsSnapshot
    draggedStation.value = null
  }
}
async function onStationDrop() {
  const dragged = draggedStation.value
  draggedStation.value = null
  if (!dragged) return
  const beforeIndex = new Map(stationsSnapshot.map((s, idx) => [s.id, idx]))
  const beforeSortOrder = new Map(stationsSnapshot.map((s) => [s.id, s.sortOrder ?? 0]))
  const changed = stations.value
    .map((s, idx) => ({ s, idx }))
    .filter(({ s, idx }) => beforeIndex.get(s.id) !== idx)
    .map(({ s, idx }) => ({ entity: s, newSortOrder: idx, oldSortOrder: beforeSortOrder.get(s.id) ?? idx }))
  if (!changed.length) return
  const ok = await persistOrder(changed, (id, sortOrder) => RestaurantService.updateStation(id, { sortOrder }))
  if (ok) {
    for (const s of changed) s.entity.sortOrder = s.newSortOrder
    toast.success('Orden actualizado')
  } else {
    stations.value = stationsSnapshot
    toast.error('No se pudo guardar el nuevo orden')
  }
}

/**
 * Manda PUT solo a las entidades cuyo sortOrder efectivamente cambió (8.4). Si CUALQUIERA de los PUT
 * falla, revierte server-side los que sí se aplicaron (PUT compensatorio a su sortOrder original) para
 * que el servidor nunca quede en un estado mixto — el caller además revierte el array local (8.5).
 */
async function persistOrder<T extends { id: string }>(
  changed: { entity: T; newSortOrder: number; oldSortOrder: number }[],
  putFn: (id: string, sortOrder: number) => Promise<unknown>,
): Promise<boolean> {
  if (!changed.length) return true
  const results = await Promise.allSettled(changed.map((c) => putFn(c.entity.id, c.newSortOrder)))
  const anyFailed = results.some((r) => r.status === 'rejected')
  if (!anyFailed) return true
  const succeeded = changed.filter((_, idx) => results[idx].status === 'fulfilled')
  if (succeeded.length) await Promise.allSettled(succeeded.map((c) => putFn(c.entity.id, c.oldSortOrder)))
  return false
}

function onCategoryDragStart(e: DragEvent, c: MenuCategory) {
  categoriesSnapshot = categories.value.map((x) => ({ ...x }))
  draggedCategory.value = c
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', c.id)
}
// Reordena en vivo mientras se arrastra (antes de soltar) — splice sobre el array reactivo.
function onCategoryDragOver(target: MenuCategory) {
  const dragged = draggedCategory.value
  if (!dragged || dragged.id === target.id) return
  const list = categories.value
  const from = list.findIndex((c) => c.id === dragged.id)
  const to = list.findIndex((c) => c.id === target.id)
  if (from === -1 || to === -1 || from === to) return
  list.splice(to, 0, list.splice(from, 1)[0])
}
function onCategoryDragEnd() {
  // Si sigue seteado acá, el drop no se procesó (soltado fuera de la lista) — deshace el reorder
  // visual en vivo del dragover sin llegar a tocar el servidor.
  if (draggedCategory.value) {
    categories.value = categoriesSnapshot
    draggedCategory.value = null
  }
}
async function onCategoryDrop() {
  const dragged = draggedCategory.value
  draggedCategory.value = null
  if (!dragged) return
  const beforeIndex = new Map(categoriesSnapshot.map((c, idx) => [c.id, idx]))
  const beforeSortOrder = new Map(categoriesSnapshot.map((c) => [c.id, c.sortOrder ?? 0]))
  const changed = categories.value
    .map((c, idx) => ({ c, idx }))
    .filter(({ c, idx }) => beforeIndex.get(c.id) !== idx)
    .map(({ c, idx }) => ({ entity: c, newSortOrder: idx, oldSortOrder: beforeSortOrder.get(c.id) ?? idx }))
  if (!changed.length) return
  const ok = await persistOrder(changed, (id, sortOrder) => RestaurantService.updateCategory(id, { sortOrder }))
  if (ok) {
    for (const c of changed) c.entity.sortOrder = c.newSortOrder
    toast.success('Orden actualizado')
  } else {
    categories.value = categoriesSnapshot
    toast.error('No se pudo guardar el nuevo orden')
  }
}

function onItemDragStart(e: DragEvent, i: MenuItem) {
  itemsSnapshot = items.value.map((x) => ({ ...x }))
  draggedItem.value = i
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', i.id)
}
function onItemDragOver(target: MenuItem) {
  const dragged = draggedItem.value
  // Reordenar ítems es SOLO dentro de la misma categoría — mover de categoría sigue siendo el campo
  // categoryId del formulario de edición (specs/menu-ordering/spec.md).
  if (!dragged || dragged.id === target.id || dragged.categoryId !== target.categoryId) return
  const list = items.value
  const from = list.findIndex((i2) => i2.id === dragged.id)
  const to = list.findIndex((i2) => i2.id === target.id)
  if (from === -1 || to === -1 || from === to) return
  list.splice(to, 0, list.splice(from, 1)[0])
}
function onItemDragEnd() {
  if (draggedItem.value) {
    items.value = itemsSnapshot
    draggedItem.value = null
  }
}
async function onItemDrop() {
  const dragged = draggedItem.value
  draggedItem.value = null
  if (!dragged) return
  const categoryId = dragged.categoryId
  const before = itemsSnapshot.filter((i) => i.categoryId === categoryId)
  const after = items.value.filter((i) => i.categoryId === categoryId)
  const beforeIndex = new Map(before.map((i, idx) => [i.id, idx]))
  const beforeSortOrder = new Map(before.map((i) => [i.id, i.sortOrder ?? 0]))
  const changed = after
    .map((i, idx) => ({ i, idx }))
    .filter(({ i, idx }) => beforeIndex.get(i.id) !== idx)
    .map(({ i, idx }) => ({ entity: i, newSortOrder: idx, oldSortOrder: beforeSortOrder.get(i.id) ?? idx }))
  if (!changed.length) return
  const ok = await persistOrder(changed, (id, sortOrder) => RestaurantService.updateItem(id, { sortOrder }))
  if (ok) {
    for (const c of changed) c.entity.sortOrder = c.newSortOrder
    toast.success('Orden actualizado')
  } else {
    items.value = itemsSnapshot
    toast.error('No se pudo guardar el nuevo orden')
  }
}

// ─── Combos/paquetes (F2) — modal custom (no FormModal: necesita selector multi-ítem + qty
// por componente, que el schema plano de FormModal no puede expresar) ───
interface ComboDraft {
  id?: string
  name: string
  description: string
  price: number | string
  taxRate: number | string
  imageUrl: string
  available: string
  sortOrder: number | string
  // menuItemId → cantidad. Solo los ítems marcados entran a `items` del payload.
  selected: Record<string, number>
}
const comboModal = ref<ComboDraft | null>(null)
const savingCombo = ref(false)

const itemName = (id: string): string => items.value.find((i) => i.id === id)?.name || '—'
const comboItemCount = (c: Combo): number => (c.items ?? []).length

function newCombo() {
  if (!items.value.length) { toast.warning('Cargá ítems a la carta primero'); return }
  comboModal.value = { name: '', description: '', price: '', taxRate: '', imageUrl: '', available: '1', sortOrder: '0', selected: {} }
}
function editCombo(c: Combo) {
  const selected: Record<string, number> = {}
  for (const it of c.items ?? []) selected[it.menuItemId] = it.quantity
  comboModal.value = {
    id: c.id, name: c.name, description: c.description ?? '', price: c.price, taxRate: c.taxRate ?? '',
    imageUrl: c.imageUrl ?? '', available: String(c.available ?? 1), sortOrder: c.sortOrder ?? 0, selected,
  }
}
function toggleComboItem(menuItemId: string) {
  if (!comboModal.value) return
  const sel = comboModal.value.selected
  if (sel[menuItemId] != null) delete sel[menuItemId]
  else sel[menuItemId] = 1
}
function setComboItemQty(menuItemId: string, qty: number) {
  if (!comboModal.value) return
  comboModal.value.selected[menuItemId] = Math.max(1, Math.floor(qty) || 1)
}
async function saveCombo() {
  const m = comboModal.value
  if (!m) return
  if (!m.name.trim()) { toast.warning('Ponele un nombre al combo'); return }
  const price = Number(m.price)
  if (!Number.isFinite(price) || price < 0) { toast.warning('Precio inválido'); return }
  const compEntries = Object.entries(m.selected)
  if (!compEntries.length) { toast.warning('Elegí al menos un componente'); return }
  const payload: ComboPayload = {
    name: m.name.trim(),
    description: m.description.trim() || undefined,
    price,
    taxRate: m.taxRate !== '' && m.taxRate !== undefined ? Number(m.taxRate) : undefined,
    imageUrl: m.imageUrl.trim() || undefined,
    available: Number(m.available),
    sortOrder: Number(m.sortOrder) || 0,
    items: compEntries.map(([menuItemId, quantity], idx) => ({ menuItemId, quantity, sortOrder: idx })),
  }
  savingCombo.value = true
  try {
    if (m.id) await RestaurantService.updateCombo(m.id, payload)
    else await RestaurantService.createCombo(payload)
    toast.success('Guardado')
    comboModal.value = null
    await load()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo guardar el combo')
  } finally {
    savingCombo.value = false
  }
}
function delCombo(c: Combo) {
  askConfirm({
    title: 'Eliminar combo', message: `¿Eliminar "${c.name}"?`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => { await RestaurantService.deleteCombo(c.id); await load() },
  })
}

async function save(fn: () => Promise<unknown>) {
  saving.value = true
  try {
    await fn()
    toast.success('Guardado')
    modal.value = null
    await load()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
  } finally {
    saving.value = false
  }
}

// ─── Recetas (BOM) — consumo de insumos por venta (INT-1) ───
// Solo se ofrece si hay inventario cargado. Cada línea = insumo + cantidad consumida por unidad vendida.
const recipeItem = ref<MenuItem | null>(null)
const recipeLines = ref<MenuItemRecipe[]>([])
const loadingRecipe = ref(false)
const newRecipe = ref<{ inventoryItemId: string; quantity: number | string }>({ inventoryItemId: '', quantity: 1 })
const invName = (id: string): string => inventory.value.find((i) => i.id === id)?.name || 'Insumo'
const invUnit = (id: string): string => inventory.value.find((i) => i.id === id)?.unit || ''

async function openRecipe(i: MenuItem) {
  recipeItem.value = i
  newRecipe.value = { inventoryItemId: '', quantity: 1 }
  loadingRecipe.value = true
  recipeLines.value = []
  try {
    recipeLines.value = await InventarioService.listRecipes(i.id)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar la receta')
  } finally {
    loadingRecipe.value = false
  }
}
async function addRecipeLine() {
  if (!recipeItem.value) return
  if (!newRecipe.value.inventoryItemId) { toast.warning('Elegí un insumo'); return }
  const qty = Number(newRecipe.value.quantity)
  if (!(qty > 0)) { toast.warning('Cantidad inválida'); return }
  try {
    await InventarioService.setRecipe({ menuItemId: recipeItem.value.id, inventoryItemId: newRecipe.value.inventoryItemId, quantity: qty })
    toast.success('Receta actualizada')
    newRecipe.value = { inventoryItemId: '', quantity: 1 }
    recipeLines.value = await InventarioService.listRecipes(recipeItem.value.id)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
  }
}
async function removeRecipeLine(r: MenuItemRecipe) {
  if (!recipeItem.value) return
  try {
    await InventarioService.setRecipe({ menuItemId: r.menuItemId, inventoryItemId: r.inventoryItemId, quantity: 0 })
    recipeLines.value = await InventarioService.listRecipes(recipeItem.value.id)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo quitar')
  }
}
// Insumos activos y aún no usados en esta receta (evita duplicar líneas y ofrecer insumos discontinuados).
const availableInventory = computed(() => {
  const used = new Set(recipeLines.value.map((r) => r.inventoryItemId))
  return inventory.value.filter((i) => i.active !== 0 && !used.has(i.id))
})

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'

// ─── Modificadores/variantes (F1) — grupos (Tamaño, Extras…) y sus opciones por ítem ───
const modifierItem = ref<MenuItem | null>(null)
const modifierGroups = ref<ModifierGroup[]>([])
const loadingModifiers = ref(false)
const newGroup = ref<{ name: string; selectionType: 'single' | 'multiple'; required: boolean }>({ name: '', selectionType: 'single', required: false })
const newModifierByGroup = ref<Record<string, { name: string; priceDelta: number | string; inventoryItemId: string }>>({})

function blankModifierDraft() { return { name: '', priceDelta: 0, inventoryItemId: '' } }

async function openModifiers(i: MenuItem) {
  modifierItem.value = i
  newGroup.value = { name: '', selectionType: 'single', required: false }
  newModifierByGroup.value = {}
  loadingModifiers.value = true
  modifierGroups.value = []
  try {
    modifierGroups.value = await RestaurantService.listModifierGroups(i.id)
    for (const g of modifierGroups.value) newModifierByGroup.value[g.id] = blankModifierDraft()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los modificadores')
  } finally {
    loadingModifiers.value = false
  }
}
async function reloadModifierGroups() {
  if (!modifierItem.value) return
  modifierGroups.value = await RestaurantService.listModifierGroups(modifierItem.value.id)
  for (const g of modifierGroups.value) if (!newModifierByGroup.value[g.id]) newModifierByGroup.value[g.id] = blankModifierDraft()
}
async function addGroup() {
  if (!modifierItem.value) return
  if (!newGroup.value.name.trim()) { toast.warning('Ponele un nombre al grupo'); return }
  try {
    await RestaurantService.createModifierGroup(modifierItem.value.id, {
      name: newGroup.value.name.trim(), selectionType: newGroup.value.selectionType, required: newGroup.value.required ? 1 : 0,
    })
    newGroup.value = { name: '', selectionType: 'single', required: false }
    await reloadModifierGroups()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo crear el grupo')
  }
}
async function removeGroup(g: ModifierGroup) {
  try {
    await RestaurantService.deleteModifierGroup(g.id)
    await reloadModifierGroups()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo eliminar el grupo')
  }
}
async function addModifier(g: ModifierGroup) {
  const draft = newModifierByGroup.value[g.id]
  if (!draft?.name?.trim()) { toast.warning('Ponele un nombre a la opción'); return }
  const priceDelta = Number(draft.priceDelta)
  if (!Number.isFinite(priceDelta)) { toast.warning('Ajuste de precio inválido'); return }
  try {
    await RestaurantService.createModifier(g.id, { name: draft.name.trim(), priceDelta, inventoryItemId: draft.inventoryItemId || undefined })
    newModifierByGroup.value[g.id] = blankModifierDraft()
    await reloadModifierGroups()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo agregar la opción')
  }
}
async function removeModifier(m: { id: string }) {
  try {
    await RestaurantService.deleteModifier(m.id)
    await reloadModifierGroups()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo quitar la opción')
  }
}

// ─── Traducciones (F4) — categorías (solo name), ítems y combos (name + description). El español
// (name/description base) se edita en los campos ya existentes del formulario; este modal solo cubre
// los idiomas adicionales, mismo patrón de pestañas que settings/index.vue (● verde + contador). ───
interface TranslationsDraft {
  kind: 'category' | 'item' | 'combo'
  id: string
  label: string
  hasDescription: boolean
  activeLang: string
  translations: Record<string, ItemTranslation>
}
const translationsModal = ref<TranslationsDraft | null>(null)
const savingTranslations = ref(false)
// El tab 'es' NO es editable acá (D7): el español vive en name/description del formulario.
const editableLangs = computed(() => supportedLangs.filter((l) => l.code !== 'es'))
const completedLangsCount = computed(() => {
  const m = translationsModal.value
  if (!m) return 0
  return Object.values(m.translations).filter((t) => (t?.name?.trim() || t?.description?.trim())).length
})

function setTranslationLang(code: string) {
  const m = translationsModal.value
  if (!m) return
  m.activeLang = code
  if (!m.translations[code]) m.translations[code] = {}
}

function openTranslations(kind: TranslationsDraft['kind'], entity: MenuCategory | MenuItem | Combo) {
  const raw = (entity.translations ?? {}) as Record<string, ItemTranslation>
  translationsModal.value = {
    kind, id: entity.id, label: entity.name, hasDescription: kind !== 'category',
    activeLang: editableLangs.value[0]?.code ?? 'en',
    translations: JSON.parse(JSON.stringify(raw)),
  }
  setTranslationLang(translationsModal.value.activeLang)
}

async function saveTranslations() {
  const m = translationsModal.value
  if (!m) return
  // Solo se guardan entradas con contenido real (evita persistir `{ en: {} }` — cuenta falsa de completados).
  const cleaned: Record<string, ItemTranslation> = {}
  for (const [code, t] of Object.entries(m.translations)) {
    const name = t?.name?.trim()
    const description = t?.description?.trim()
    if (name || description) cleaned[code] = { ...(name ? { name } : {}), ...(description ? { description } : {}) }
  }
  savingTranslations.value = true
  try {
    if (m.kind === 'category') await RestaurantService.updateCategory(m.id, { translations: cleaned })
    else if (m.kind === 'item') await RestaurantService.updateItem(m.id, { translations: cleaned })
    else await RestaurantService.updateCombo(m.id, { translations: cleaned })
    toast.success('Traducciones guardadas')
    translationsModal.value = null
    await load()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudieron guardar las traducciones')
  } finally {
    savingTranslations.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-navy">Carta del restaurante</h1>
        <p class="text-sm text-text-muted mt-0.5">Estaciones, categorías e ítems del POS.</p>
      </div>
    </header>

    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>

    <template v-else>
      <!-- Estaciones -->
      <SectionCard title="Estaciones (pantallas KDS)" subtitle="Cocina, Bar, etc. Cada categoría rutea a una estación.">
        <template #actions>
          <button v-if="createPerm" @click="newStation" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 text-white text-xs font-bold hover:bg-white/25">
            <span class="w-3.5 h-3.5" v-html="ICON_PLUS" /> Nueva
          </button>
        </template>
        <EmptyState v-if="!stations.length" title="Sin estaciones" message="Creá al menos una (ej: Cocina, Bar) para rutear la carta." />
        <div v-else class="divide-y divide-border">
          <!-- F8: reorden por arrastre — mismo patrón que categorías/ítems; el handle "⋮⋮" es el
               único elemento draggable de la fila, así "Editar"/"Eliminar" nunca disparan un drag. -->
          <div v-for="s in stations" :key="s.id"
            class="flex items-center justify-between py-2.5 gap-2 transition-opacity"
            :class="draggedStation?.id === s.id ? 'opacity-50' : ''"
            @dragover.prevent="onStationDragOver(s)"
            @drop.prevent="onStationDrop">
            <div class="flex items-center gap-2 min-w-0">
              <span v-if="editPerm" draggable="true" @dragstart="onStationDragStart($event, s)" @dragend="onStationDragEnd"
                class="shrink-0 cursor-grab active:cursor-grabbing text-text-muted select-none" title="Arrastrar para reordenar">⋮⋮</span>
              <span class="font-bold text-navy">{{ s.name }}</span>
              <span v-if="!s.active" class="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-muted font-bold">Inactiva</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button v-if="editPerm" @click="editStation(s)" class="text-xs font-bold text-navy hover:underline">Editar</button>
              <button v-if="deletePerm" @click="delStation(s)" class="text-xs font-bold text-coral hover:underline">Eliminar</button>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Categorías -->
      <SectionCard title="Categorías" subtitle="Agrupan ítems y definen a qué estación llegan.">
        <template #actions>
          <button v-if="createPerm" @click="newCategory" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 text-white text-xs font-bold hover:bg-white/25">
            <span class="w-3.5 h-3.5" v-html="ICON_PLUS" /> Nueva
          </button>
        </template>
        <EmptyState v-if="!categories.length" title="Sin categorías" message="Creá categorías como Entradas, Platos, Bebidas." />
        <div v-else class="divide-y divide-border">
          <!-- F8: reorden por arrastre — el handle "⋮⋮" es el único elemento draggable de la fila. -->
          <div v-for="c in categories" :key="c.id"
            class="flex items-center justify-between py-2.5 gap-2 transition-opacity"
            :class="draggedCategory?.id === c.id ? 'opacity-50' : ''"
            @dragover.prevent="onCategoryDragOver(c)"
            @drop.prevent="onCategoryDrop">
            <div class="flex items-center gap-2 min-w-0">
              <span v-if="editPerm" draggable="true" @dragstart="onCategoryDragStart($event, c)" @dragend="onCategoryDragEnd"
                class="shrink-0 cursor-grab active:cursor-grabbing text-text-muted select-none" title="Arrastrar para reordenar">⋮⋮</span>
              <div class="min-w-0">
                <span class="font-bold text-navy">{{ c.name }}</span>
                <span class="ml-2 text-xs text-text-muted">→ {{ stationName(c.stationId) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button v-if="editPerm" @click="openTranslations('category', c)" class="text-xs font-bold text-teal hover:underline">Traducciones</button>
              <button v-if="editPerm" @click="editCategory(c)" class="text-xs font-bold text-navy hover:underline">Editar</button>
              <button v-if="deletePerm" @click="delCategory(c)" class="text-xs font-bold text-coral hover:underline">Eliminar</button>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Ítems -->
      <SectionCard title="Ítems de la carta" subtitle="Platos y bebidas con precio.">
        <template #actions>
          <button v-if="createPerm" @click="newItem" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 text-white text-xs font-bold hover:bg-white/25">
            <span class="w-3.5 h-3.5" v-html="ICON_PLUS" /> Nuevo
          </button>
        </template>
        <div v-if="categories.length" class="flex flex-wrap gap-1.5 mb-3">
          <button @click="activeCategoryId = 'all'" :class="['px-2.5 py-1 rounded-full text-xs font-bold', activeCategoryId === 'all' ? 'bg-navy text-white' : 'bg-surface text-text-muted']">Todas</button>
          <button v-for="c in categories" :key="c.id" @click="activeCategoryId = c.id" :class="['px-2.5 py-1 rounded-full text-xs font-bold', activeCategoryId === c.id ? 'bg-navy text-white' : 'bg-surface text-text-muted']">{{ c.name }}</button>
        </div>
        <!-- F8: el reorden por arrastre solo tiene sentido DENTRO de una categoría (el sortOrder no se
             compara entre categorías distintas) — con "Todas" seleccionado no hay handle. -->
        <p v-if="editPerm && activeCategoryId === 'all' && categories.length > 1" class="text-[11px] text-text-muted mb-2">
          Elegí una categoría para reordenar sus ítems por arrastre.
        </p>
        <EmptyState v-if="!filteredItems.length" title="Sin ítems" message="Agregá platos a la carta." />
        <div v-else class="divide-y divide-border">
          <!-- F6: fuera de franja horaria (availableNow:false pero available=1) se atenúa (opacity), DISTINTO
               visualmente del badge rojo "Agotado" (dos causas de no-disponibilidad distintas). -->
          <div v-for="i in filteredItems" :key="i.id" class="flex items-center justify-between py-2.5 gap-3"
            :class="[i.available !== 0 && i.availableNow === false ? 'opacity-60' : '', draggedItem?.id === i.id ? 'opacity-50' : '']"
            @dragover.prevent="onItemDragOver(i)"
            @drop.prevent="onItemDrop">
            <div class="min-w-0 flex items-center gap-3">
              <span v-if="editPerm && activeCategoryId !== 'all'" draggable="true" @dragstart="onItemDragStart($event, i)" @dragend="onItemDragEnd"
                class="shrink-0 cursor-grab active:cursor-grabbing text-text-muted select-none" title="Arrastrar para reordenar">⋮⋮</span>
              <img v-if="i.imageUrl" :src="i.imageUrl" class="w-10 h-10 rounded-lg object-cover shrink-0 border border-border" />
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <!-- F6: destacado/plato del día — informativo, sin regla de negocio. -->
                  <span v-if="i.featured" class="text-gold shrink-0" title="Destacado">★</span>
                  <span class="font-bold text-navy truncate">{{ i.name }}</span>
                  <span v-if="!i.available" class="text-[10px] px-1.5 py-0.5 rounded bg-coral/10 text-coral font-bold">Agotado</span>
                  <span v-else-if="i.availableNow === false" class="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-muted font-bold whitespace-nowrap">
                    Fuera de horario ({{ i.availableFrom }}-{{ i.availableTo }})
                  </span>
                  <span v-if="i.hasRecipe === false" class="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold font-bold" title="No descuenta inventario al venderse — cargá su receta">Sin receta</span>
                </div>
                <div class="text-xs text-text-muted truncate">{{ categoryName(i.categoryId) }} · {{ stationName(i.stationId || categories.find(c => c.id === i.categoryId)?.stationId) }}</div>
                <!-- F5: tags de alérgenos/info dietética, informativos (nunca bloquean la venta). -->
                <div v-if="(i.allergens ?? []).length" class="flex flex-wrap gap-1 mt-1">
                  <span v-for="tag in i.allergens" :key="tag" class="text-[10px] px-1.5 py-0.5 rounded bg-navy/5 text-navy font-bold">{{ allergenLabel(tag) }}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span v-if="i.taxRate !== undefined" class="text-[10px] px-1.5 py-0.5 rounded bg-navy/5 text-navy font-bold" :title="`Impuesto propio: ${i.taxRate}%`">{{ i.taxRate }}%</span>
              <span class="font-black text-navy tabular-nums">{{ money(i.price) }}</span>
              <!-- F3: badge de margen — solo editPerm, y NO si hasRecipe===false (ya existe el badge "Sin receta"). -->
              <span v-if="editPerm && i.hasRecipe !== false && foodCostFor(i.id)?.marginPercent != null"
                class="text-[10px] px-1.5 py-0.5 rounded font-bold" :class="marginClass(foodCostFor(i.id)!.marginPercent!)">
                {{ foodCostFor(i.id)!.marginPercent }}% margen
              </span>
              <button v-if="editPerm && inventory.length" @click="openRecipe(i)" class="text-xs font-bold text-teal hover:underline">Receta</button>
              <button v-if="editPerm" @click="openModifiers(i)" class="text-xs font-bold text-teal hover:underline">Modificadores</button>
              <button v-if="editPerm" @click="openTranslations('item', i)" class="text-xs font-bold text-teal hover:underline">Traducciones</button>
              <button v-if="editPerm" @click="toggleAvailability(i)" class="text-xs font-bold text-gold hover:underline">{{ i.available ? 'Agotar' : 'Reactivar' }}</button>
              <button v-if="editPerm" @click="editItem(i)" class="text-xs font-bold text-navy hover:underline">Editar</button>
              <button v-if="deletePerm" @click="delItem(i)" class="text-xs font-bold text-coral hover:underline">Eliminar</button>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Combos/paquetes (F2) -->
      <SectionCard title="Combos" subtitle="Paquetes de ítems con precio propio (ej: Combo Familiar).">
        <template #actions>
          <button v-if="createPerm" @click="newCombo" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 text-white text-xs font-bold hover:bg-white/25">
            <span class="w-3.5 h-3.5" v-html="ICON_PLUS" /> Nuevo
          </button>
        </template>
        <EmptyState v-if="!combos.length" title="Sin combos" message="Armá un paquete con varios ítems de la carta a un precio propio." />
        <div v-else class="divide-y divide-border">
          <div v-for="c in combos" :key="c.id" class="flex items-center justify-between py-2.5 gap-3">
            <div class="min-w-0 flex items-center gap-3">
              <img v-if="c.imageUrl" :src="c.imageUrl" class="w-10 h-10 rounded-lg object-cover shrink-0 border border-border" />
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-navy truncate">{{ c.name }}</span>
                  <span v-if="!c.available" class="text-[10px] px-1.5 py-0.5 rounded bg-coral/10 text-coral font-bold">Agotado</span>
                </div>
                <div class="text-xs text-text-muted truncate">{{ comboItemCount(c) }} componente(s)</div>
                <!-- F5: alérgenos DERIVADOS de los componentes (nunca un campo propio del combo). -->
                <div v-if="(c.allergens ?? []).length" class="flex flex-wrap items-center gap-1 mt-1">
                  <span class="text-[10px] text-text-muted">Contiene (según sus componentes):</span>
                  <span v-for="tag in c.allergens" :key="tag" class="text-[10px] px-1.5 py-0.5 rounded bg-navy/5 text-navy font-bold">{{ allergenLabel(tag) }}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="font-black text-navy tabular-nums">{{ money(c.price) }}</span>
              <!-- F3: badge de margen del combo + advertencia si algún componente no tiene receta cargada. -->
              <span v-if="editPerm && foodCostFor(c.id)?.marginPercent != null"
                class="text-[10px] px-1.5 py-0.5 rounded font-bold" :class="marginClass(foodCostFor(c.id)!.marginPercent!)">
                {{ foodCostFor(c.id)!.marginPercent }}% margen
              </span>
              <span v-if="editPerm && foodCostFor(c.id)?.complete === false" class="text-warning text-sm" title="Costo incompleto: al menos un componente sin receta">⚠</span>
              <button v-if="editPerm" @click="openTranslations('combo', c)" class="text-xs font-bold text-teal hover:underline">Traducciones</button>
              <button v-if="editPerm" @click="editCombo(c)" class="text-xs font-bold text-navy hover:underline">Editar</button>
              <button v-if="deletePerm" @click="delCombo(c)" class="text-xs font-bold text-coral hover:underline">Eliminar</button>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Food cost (F3): margen real de la carta completa. Gate 'restaurant-catalog:view' — el mesero
           no llega ni a pedir el reporte (ver load()), esta condición es defensiva por si editPerm cambia. -->
      <SectionCard v-if="editPerm" title="Food cost" subtitle="Precio de venta menos costo de receta, ordenado de menor a mayor margen.">
        <div class="flex flex-wrap gap-2 mb-3">
          <input id="restaurante-carta-food-cost-search" name="foodCostSearch" aria-label="Buscar por nombre" v-model="foodCostSearch" type="text" placeholder="Buscar por nombre…"
            class="flex-1 min-w-[160px] px-3 py-1.5 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          <select id="restaurante-carta-food-cost-category" name="foodCostCategoryFilter" aria-label="Filtrar food cost por categoría" v-model="foodCostCategoryFilter" class="px-3 py-1.5 rounded-lg border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
            <option value="all">Todas las categorías</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <EmptyState v-if="!filteredFoodCostRows.length" title="Sin datos de food cost" message="Cargá recetas a los platos para ver su margen real." />
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm tbl-head">
            <thead>
              <tr>
                <th class="text-left px-3 py-2">Plato / Combo</th>
                <th class="text-right px-3 py-2">Precio</th>
                <th class="text-right px-3 py-2">Costo</th>
                <th class="text-right px-3 py-2">Margen</th>
                <th class="text-right px-3 py-2">%</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="r in filteredFoodCostRows" :key="`${r.kind}-${r.id}`">
                <td class="px-3 py-2">
                  <span class="font-bold text-navy">{{ r.name }}</span>
                  <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-navy/5 text-navy font-bold">{{ r.kind === 'combo' ? 'Combo' : 'Ítem' }}</span>
                  <span v-if="r.kind === 'combo' && !r.complete" class="ml-1 text-warning" title="Costo incompleto: al menos un componente sin receta">⚠</span>
                </td>
                <td class="text-right px-3 py-2 tabular-nums">{{ money(r.price) }}</td>
                <td class="text-right px-3 py-2 tabular-nums">{{ money(r.cost) }}</td>
                <td class="text-right px-3 py-2 tabular-nums font-bold" :class="r.margin < 0 ? 'text-danger' : 'text-navy'">{{ money(r.margin) }}</td>
                <td class="text-right px-3 py-2">
                  <span v-if="r.marginPercent != null" class="text-[11px] px-1.5 py-0.5 rounded font-bold" :class="marginClass(r.marginPercent)">{{ r.marginPercent }}%</span>
                  <span v-else class="text-text-muted text-xs">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>

    <!-- Receta (BOM): insumos que consume este plato por unidad vendida -->
    <AppModal v-if="recipeItem" :title="`Receta — ${recipeItem.name}`" subtitle="Insumos que descuenta del inventario al vender este ítem." size="lg" @close="recipeItem = null">
      <div v-if="loadingRecipe" class="py-10 text-center text-text-muted">Cargando…</div>
      <div v-else class="space-y-4">
        <EmptyState v-if="!recipeLines.length" title="Sin receta" message="Agregá insumos para que la venta descuente stock automáticamente." />
        <div v-else class="divide-y divide-border">
          <div v-for="r in recipeLines" :key="r.id" class="flex items-center justify-between py-2.5">
            <div>
              <span class="font-bold text-navy">{{ invName(r.inventoryItemId) }}</span>
              <span class="ml-2 text-xs text-text-muted">{{ r.quantity }} {{ invUnit(r.inventoryItemId) }} / unidad vendida</span>
            </div>
            <button v-if="editPerm" @click="removeRecipeLine(r)" class="text-xs font-bold text-coral hover:underline">Quitar</button>
          </div>
        </div>

        <div v-if="editPerm" class="flex items-end gap-2 border-t border-border pt-3">
          <div class="flex-1 min-w-0">
            <label for="restaurante-carta-insumo" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Insumo</label>
            <select id="restaurante-carta-insumo" name="inventoryItemId" v-model="newRecipe.inventoryItemId" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
              <option value="">Seleccionar…</option>
              <option v-for="i in availableInventory" :key="i.id" :value="i.id">{{ i.name }} ({{ i.unit }})</option>
            </select>
          </div>
          <div class="w-24 shrink-0">
            <label for="restaurante-carta-cantidad" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Cantidad</label>
            <!-- min 0.01, no 0: el negocio exige qty>0 por línea de receta (0 = "Quitar", que es otro
                 botón) y el handler la rechaza — el input no puede anunciar 0 como válido. -->
            <input id="restaurante-carta-cantidad" name="quantity" v-model.number="newRecipe.quantity" type="number" min="0.01" step="0.01" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <button @click="addRecipeLine" class="shrink-0 px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold">Agregar</button>
        </div>
      </div>
    </AppModal>

    <!-- Modificadores/variantes (F1): grupos de opciones (Tamaño, Extras…) por ítem -->
    <AppModal v-if="modifierItem" :title="`Modificadores — ${modifierItem.name}`" subtitle="Grupos de opciones (ej. Tamaño, Extras) que ajustan el precio de la línea." size="lg" @close="modifierItem = null">
      <div v-if="loadingModifiers" class="py-10 text-center text-text-muted">Cargando…</div>
      <div v-else class="space-y-4">
        <EmptyState v-if="!modifierGroups.length" title="Sin grupos de modificadores" message="Creá un grupo para ofrecer variantes (ej. Tamaño) o extras." />
        <div v-else class="space-y-4">
          <div v-for="g in modifierGroups" :key="g.id" class="rounded-xl border-2 border-border p-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <span class="font-bold text-navy">{{ g.name }}</span>
                <span class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-navy/5 text-navy font-bold">{{ g.selectionType === 'single' ? 'Única' : 'Múltiple' }}</span>
                <span v-if="g.required" class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold font-bold">Obligatorio</span>
              </div>
              <button @click="removeGroup(g)" class="text-xs font-bold text-coral hover:underline">Eliminar grupo</button>
            </div>

            <div class="mt-2 divide-y divide-border">
              <div v-for="m in g.modifiers ?? []" :key="m.id" class="flex items-center justify-between py-1.5">
                <span class="text-sm text-navy">{{ m.name }}</span>
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold tabular-nums" :class="m.priceDelta < 0 ? 'text-coral' : 'text-navy'">{{ m.priceDelta >= 0 ? '+' : '' }}{{ money(m.priceDelta) }}</span>
                  <button @click="removeModifier(m)" class="text-xs font-bold text-coral hover:underline">Quitar</button>
                </div>
              </div>
              <div v-if="!(g.modifiers ?? []).length" class="py-1.5 text-xs text-text-muted">Sin opciones todavía.</div>
            </div>

            <div v-if="newModifierByGroup[g.id]" class="flex items-end gap-2 border-t border-border pt-2.5 mt-2.5">
              <div class="flex-1 min-w-0">
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Opción</label>
                <input :id="`modificador-${g.id}-nombre`" :aria-label="`Nombre de la nueva opción de ${g.name}`" v-model="newModifierByGroup[g.id].name" type="text" placeholder="ej. Grande"
                  class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
              </div>
              <div class="w-24 shrink-0">
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Ajuste</label>
                <input :id="`modificador-${g.id}-precio`" :aria-label="`Diferencia de precio de la nueva opción de ${g.name}`" v-model.number="newModifierByGroup[g.id].priceDelta" type="number" step="0.01"
                  class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
              </div>
              <div class="w-36 shrink-0">
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Insumo (opcional)</label>
                <select :id="`modificador-${g.id}-insumo`" :aria-label="`Insumo de la nueva opción de ${g.name}`" v-model="newModifierByGroup[g.id].inventoryItemId" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
                  <option value="">Ninguno</option>
                  <option v-for="inv in inventory" :key="inv.id" :value="inv.id">{{ inv.name }}</option>
                </select>
              </div>
              <button @click="addModifier(g)" class="shrink-0 px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold">Agregar</button>
            </div>
          </div>
        </div>

        <div class="flex items-end gap-2 border-t-2 border-navy/10 pt-3">
          <div class="flex-1 min-w-0">
            <label for="restaurante-carta-nuevo-grupo" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nuevo grupo</label>
            <input id="restaurante-carta-nuevo-grupo" name="name" v-model="newGroup.name" type="text" placeholder="ej. Tamaño" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div class="w-32 shrink-0">
            <label for="restaurante-carta-seleccion" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Selección</label>
            <select id="restaurante-carta-seleccion" name="selectionType" v-model="newGroup.selectionType" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
              <option value="single">Única</option>
              <option value="multiple">Múltiple</option>
            </select>
          </div>
          <label class="shrink-0 flex items-center gap-1.5 text-xs font-bold text-navy pb-2">
            <input id="restaurante-carta-obligatorio" name="required" v-model="newGroup.required" type="checkbox" /> Obligatorio
          </label>
          <button @click="addGroup" class="shrink-0 px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold">Crear grupo</button>
        </div>
      </div>
    </AppModal>

    <!-- Combos/paquetes (F2): alta/edición con selector multi-ítem + cantidad por componente -->
    <AppModal v-if="comboModal" :title="comboModal.id ? 'Editar combo' : 'Nuevo combo'" subtitle="Elegí los ítems que lo componen y cuántas unidades de cada uno." size="lg" @close="comboModal = null">
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label for="restaurante-carta-nombre" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nombre<span class="text-coral"> *</span></label>
            <input id="restaurante-carta-nombre" name="name" v-model="comboModal.name" type="text" placeholder="ej. Combo Familiar" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="restaurante-carta-precio-del-combo" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Precio del combo<span class="text-coral"> *</span></label>
            <input id="restaurante-carta-precio-del-combo" name="price" v-model="comboModal.price" type="number" min="0" step="0.01" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="restaurante-carta-impuesto" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Impuesto (%)</label>
            <input id="restaurante-carta-impuesto" name="taxRate" v-model="comboModal.taxRate" type="number" min="0" step="0.01" :placeholder="`Vacío = ${defaultTaxRate}% del hotel`" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="restaurante-carta-disponible" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Disponible</label>
            <select id="restaurante-carta-disponible" name="available" v-model="comboModal.available" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
              <option value="1">Sí</option>
              <option value="0">No</option>
            </select>
          </div>
          <div class="sm:col-span-2">
            <label for="restaurante-carta-descripcion" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Descripción</label>
            <textarea id="restaurante-carta-descripcion" name="description" v-model="comboModal.description" rows="2" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy"></textarea>
          </div>
        </div>

        <div class="border-t border-border pt-3">
          <label class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Componentes<span class="text-coral"> *</span></label>
          <EmptyState v-if="!items.length" title="Sin ítems en la carta" message="Cargá ítems antes de armar un combo." />
          <div v-else class="max-h-64 overflow-y-auto divide-y divide-border border border-border rounded-xl">
            <div v-for="i in items" :key="i.id" class="flex items-center justify-between gap-3 px-3 py-2">
              <label class="flex items-center gap-2 min-w-0 cursor-pointer">
                <input :id="`combo-item-${i.id}`" :aria-label="`Incluir ${i.name} en el combo`" type="checkbox" :checked="comboModal.selected[i.id] != null" @change="toggleComboItem(i.id)" />
                <span class="text-sm text-navy truncate">{{ i.name }}</span>
                <span class="text-[11px] text-text-muted shrink-0">{{ money(i.price) }}</span>
              </label>
              <input :id="`combo-item-${i.id}-cantidad`" :aria-label="`Cantidad de ${i.name} en el combo`"
                v-if="comboModal.selected[i.id] != null"
                type="number" min="1" :value="comboModal.selected[i.id]"
                @input="setComboItemQty(i.id, Number(($event.target as HTMLInputElement).value))"
                class="w-16 shrink-0 px-2 py-1 rounded-lg border border-border text-sm text-center focus:outline-none focus:border-navy" />
            </div>
          </div>
          <p v-if="Object.keys(comboModal.selected).length" class="text-[11px] text-text-muted mt-1.5">
            {{ Object.entries(comboModal.selected).map(([id, qty]) => `${qty}× ${itemName(id)}`).join(' · ') }}
          </p>
        </div>
      </div>
      <template #footer>
        <button @click="comboModal = null" class="px-4 py-2 rounded-lg border-2 border-border text-navy font-bold text-sm">Cancelar</button>
        <button @click="saveCombo" :disabled="savingCombo" class="px-4 py-2 rounded-lg bg-navy text-white font-bold text-sm disabled:opacity-50">
          {{ savingCombo ? 'Guardando…' : (comboModal.id ? 'Guardar' : 'Crear') }}
        </button>
      </template>
    </AppModal>

    <!-- Traducciones (F4): selector de idioma, mismo patrón que settings/index.vue (pestañas + ●
         verde + contador). El tab 'es' no existe acá — el español se edita en el formulario. -->
    <AppModal v-if="translationsModal" :title="`Traducciones — ${translationsModal.label}`"
      subtitle="El español se edita en los campos del formulario. Acá solo los demás idiomas." size="md" @close="translationsModal = null">
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <button v-for="lang in editableLangs" :key="lang.code" @click="setTranslationLang(lang.code)"
            class="px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer"
            :class="translationsModal.activeLang === lang.code ? 'bg-navy text-white' : 'bg-surface text-text-secondary hover:bg-navy/5'">
            {{ lang.flag }} {{ lang.code.toUpperCase() }}
            <span v-if="translationsModal.translations[lang.code]?.name || translationsModal.translations[lang.code]?.description" class="ml-1 text-teal">●</span>
          </button>
        </div>

        <div v-if="translationsModal.translations[translationsModal.activeLang]">
          <div>
            <label for="restaurante-carta-nombre-2" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nombre ({{ translationsModal.activeLang.toUpperCase() }})</label>
            <input id="restaurante-carta-nombre-2" name="name" v-model="translationsModal.translations[translationsModal.activeLang].name" type="text"
              class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div v-if="translationsModal.hasDescription" class="mt-3">
            <label for="restaurante-carta-descripcion-2" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Descripción ({{ translationsModal.activeLang.toUpperCase() }})</label>
            <textarea id="restaurante-carta-descripcion-2" name="description" v-model="translationsModal.translations[translationsModal.activeLang].description" rows="3"
              class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy"></textarea>
          </div>
        </div>

        <p class="text-[10px] text-text-muted text-right">{{ completedLangsCount }} / {{ supportedLangs.length }} idiomas completados</p>
      </div>
      <template #footer>
        <button @click="translationsModal = null" class="px-4 py-2 rounded-lg border-2 border-border text-navy font-bold text-sm">Cancelar</button>
        <button @click="saveTranslations" :disabled="savingTranslations" class="px-4 py-2 rounded-lg bg-navy text-white font-bold text-sm disabled:opacity-50">
          {{ savingTranslations ? 'Guardando…' : 'Guardar' }}
        </button>
      </template>
    </AppModal>

    <FormModal v-if="modal" :title="modal.title" :fields="modal.fields" :submit-label="modal.submitLabel" :loading="saving"
      @close="modal = null" @submit="modal.onSubmit" />
    <ConfirmModal v-if="confirmModal" v-bind="confirmModal" :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>
