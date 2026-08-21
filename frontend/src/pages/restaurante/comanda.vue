<script setup lang="ts">
// pages/restaurante/comanda.vue — Toma de comanda (RES-7). Carta a la izquierda (tocar ítem = agregar
// línea), ticket a la derecha con líneas + totales en vivo (recalculados por el backend). Enviar a cocina
// (sendOrder), cobrar (→ cobrar/:id) o cancelar. Las líneas solo se editan si la comanda no cerró.
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  RestaurantService,
  type OrderWithLines, type MenuCategory, type MenuItem, type OrderLine, type ModifierGroup, type Combo,
  type AllergenTag,
  ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, LINE_STATUS_LABELS, ALLERGEN_LABELS,
} from '@/services/Restaurant.service'
import { SettingsService } from '@/services/Settings.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePermissions } from '@/composables/usePermissions'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { can } = usePermissions()
const orderId = computed(() => String(route.params.id))

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudo'),
})

const loading = ref(true)
const busy = ref(false)
const order = ref<OrderWithLines | null>(null)
const categories = ref<MenuCategory[]>([])
const items = ref<MenuItem[]>([])
const combos = ref<Combo[]>([])
const currency = ref<string>(CurrencyCode.USD)
const activeCategoryId = ref<string>('all')

const editPerm = computed(() => can('restaurant', 'edit'))
const createPerm = computed(() => can('restaurant', 'create'))
const deletePerm = computed(() => can('restaurant', 'delete'))

// La comanda es editable solo antes de facturar/cobrar/cancelar. fix-refund-pos-card:
// 'processing_payment' también bloquea (Cobrar/Cancelar) — el cobro con tarjeta ya abrió una Checkout
// Session; el cajero espera la confirmación en cobrar.vue, no vuelve a tocar la comanda desde acá.
const LOCKED = ['billed', 'charged', 'paid', 'cancelled', 'processing_payment']
const editable = computed(() => !!order.value && !LOCKED.includes(order.value.status))
const money = (n: number): string => `${currencySymbol(currency.value)}${Number(n || 0).toFixed(2)}`
// F5 — tags de alérgenos/info dietética: SOLO informativos, nunca bloquean addItem/addCombo.
const allergenLabel = (tag: string): string => ALLERGEN_LABELS[tag as AllergenTag] ?? tag

// F6 — un ítem fuera de su franja horaria actual (availableNow:false, DERIVADO por el backend) no
// aparece en el selector: el mesero no necesita saber por qué, simplemente no está en la lista.
const availableItems = computed(() => {
  const list = items.value.filter((i) => i.available !== 0 && i.availableNow !== false)
  return activeCategoryId.value === 'all' ? list : list.filter((i) => i.categoryId === activeCategoryId.value)
})
// Los combos no tienen categoryId propio — aparecen siempre, sin importar el filtro de categoría activo.
// DT-10 — un combo con algún componente 86'd o fuera de franja horaria no se ofrece: el backend lo
// rechazaría igual al agregarlo (order-lines.ts), mostrarlo invita al click fallido.
const availableCombos = computed(() => {
  const itemsById = new Map(items.value.map((i) => [i.id, i]))
  return combos.value.filter((c) => {
    if (c.available === 0) return false
    return (c.items ?? []).every((ci) => {
      const it = itemsById.get(ci.menuItemId)
      return !!it && it.available !== 0 && it.availableNow !== false
    })
  })
})

async function reloadOrder() {
  order.value = await RestaurantService.getOrder(orderId.value)
}

async function load() {
  loading.value = true
  try {
    const [cat, it, combosRes, settings] = await Promise.all([
      RestaurantService.listCategories(),
      RestaurantService.listItems(),
      RestaurantService.listCombos(),
      SettingsService.get().catch(() => null),
    ])
    categories.value = cat.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    items.value = it.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    combos.value = combosRes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    currency.value = (settings as any)?.hotel?.currency || 'USD'
    await reloadOrder()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar la comanda')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ─── Selector de modificadores (F1) — se abre ANTES de agregar la línea si el ítem tiene grupos ───
const modifierPickItem = ref<MenuItem | null>(null)
const modifierPickGroups = ref<ModifierGroup[]>([])
const modifierPickLoading = ref(false)
// groupId → modifierId(s) elegidos (single: máximo 1; multiple: N)
const modifierSelection = ref<Record<string, string[]>>({})

const modifierPickReady = computed(() => {
  for (const g of modifierPickGroups.value) {
    const chosen = modifierSelection.value[g.id] ?? []
    if (g.required && chosen.length < 1) return false
  }
  return true
})

async function addItem(i: MenuItem) {
  if (!editable.value || !createPerm.value || busy.value) return
  modifierPickLoading.value = true
  try {
    const groups = await RestaurantService.listModifierGroups(i.id)
    if (groups.length) {
      modifierPickItem.value = i
      modifierPickGroups.value = groups
      modifierSelection.value = Object.fromEntries(groups.map((g) => [g.id, []]))
      return
    }
  } catch { /* si falla la carga de grupos, se agrega sin selector (no bloquea el flujo del mesero) */ }
  finally { modifierPickLoading.value = false }
  await commitAddItem(i, [])
}

function pickSingle(groupId: string, modifierId: string) { modifierSelection.value[groupId] = [modifierId] }
function toggleMultiple(groupId: string, modifierId: string) {
  const cur = modifierSelection.value[groupId] ?? []
  modifierSelection.value[groupId] = cur.includes(modifierId) ? cur.filter((id) => id !== modifierId) : [...cur, modifierId]
}

async function confirmModifierPick() {
  if (!modifierPickItem.value || !modifierPickReady.value) return
  const modifiers = Object.values(modifierSelection.value).flat().map((modifierId) => ({ modifierId }))
  const item = modifierPickItem.value
  modifierPickItem.value = null
  await commitAddItem(item, modifiers)
}

async function commitAddItem(i: MenuItem, modifiers: { modifierId: string }[]) {
  if (busy.value) return
  busy.value = true
  try {
    await RestaurantService.addLine(orderId.value, { menuItemId: i.id, quantity: 1, modifiers: modifiers.length ? modifiers : undefined })
    await reloadOrder()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo agregar') }
  finally { busy.value = false }
}

/** Etiqueta entre paréntesis con los modificadores elegidos, ej. "(Grande, +tocino)". */
function modifiersLabel(l: OrderLine): string {
  const names = (l.modifiers ?? []).map((m) => m.name)
  return names.length ? `(${names.join(', ')})` : ''
}

// ─── Combos (F2) — se agregan como 1 sola línea (kind='combo_header'); el backend explota los
// componentes en filas 'combo_component' propias (parentLineId → header). Nunca aceptan modificadores. ───
async function addCombo(c: Combo) {
  if (!editable.value || !createPerm.value || busy.value) return
  busy.value = true
  try {
    await RestaurantService.addLine(orderId.value, { comboId: c.id, quantity: 1 })
    await reloadOrder()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo agregar el combo') }
  finally { busy.value = false }
}

// Líneas de "primer nivel" del ticket: ítems sueltos + headers de combo. Los componentes
// (kind='combo_component') NO aparecen acá — se muestran anidados bajo su header, solo informativos.
const topLines = computed<OrderLine[]>(() => (order.value?.lines ?? []).filter((l) => l.kind !== 'combo_component'))
function componentsOf(headerId: string): OrderLine[] {
  return (order.value?.lines ?? []).filter((l) => l.kind === 'combo_component' && l.parentLineId === headerId)
}
// Estado (servido/preparando/etc) derivado de sus componentes — el header nunca transiciona en el KDS.
function comboAggregateStatus(headerId: string): string {
  const comps = componentsOf(headerId)
  if (!comps.length) return ''
  if (comps.every((c) => c.status === 'served')) return 'Servido'
  if (comps.every((c) => c.status === 'cancelled')) return 'Cancelado'
  if (comps.some((c) => c.status === 'ready')) return 'Listo'
  if (comps.some((c) => c.status === 'preparing')) return 'Preparando'
  return 'Nuevo'
}
const expandedCombos = ref<Set<string>>(new Set())
function toggleExpand(headerId: string) {
  if (expandedCombos.value.has(headerId)) expandedCombos.value.delete(headerId)
  else expandedCombos.value.add(headerId)
}

async function setQty(line: OrderLine, qty: number) {
  if (!editable.value || !editPerm.value || busy.value) return
  if (qty < 1) { await remove(line); return }
  busy.value = true
  try {
    await RestaurantService.updateLine(orderId.value, line.id, { quantity: qty })
    await reloadOrder()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo actualizar') }
  finally { busy.value = false }
}

async function remove(line: OrderLine) {
  if (!editable.value || busy.value) return
  // Sin restaurant:delete (mesero/cocina), bajar a 0 quedaba en silencio — igual que 'cancel()'.
  if (!deletePerm.value) { toast.warning('Sin permiso para quitar ítems'); return }
  busy.value = true
  try {
    await RestaurantService.removeLine(orderId.value, line.id)
    await reloadOrder()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo quitar') }
  finally { busy.value = false }
}

async function send() {
  if (busy.value) return
  busy.value = true
  try {
    await RestaurantService.sendOrder(orderId.value)
    await reloadOrder()
    toast.success('Enviada a cocina')
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo enviar') }
  finally { busy.value = false }
}

function goPay() {
  if (!order.value?.lines.length) { toast.warning('La comanda no tiene ítems'); return }
  router.push(`/panel/restaurante/cobrar/${orderId.value}`)
}

function cancel() {
  if (!deletePerm.value) { toast.warning('Sin permiso para cancelar'); return }
  askConfirm({
    title: 'Cancelar comanda', message: '¿Cancelar esta comanda? No se podrá cobrar.', confirmLabel: 'Cancelar comanda', danger: true,
    run: async () => { await RestaurantService.cancelOrder(orderId.value); router.push('/panel/restaurante/salon') },
  })
}
</script>

<template>
  <div>
    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>

    <template v-else-if="order">
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <router-link to="/panel/restaurante/salon" class="text-xs font-bold text-navy hover:underline">← Salón</router-link>
          <h1 class="text-xl sm:text-2xl font-black text-navy mt-1">{{ order.number || 'Comanda' }}</h1>
          <p class="text-sm text-text-muted">
            {{ ORDER_TYPE_LABELS[order.type] }} ·
            <span class="font-bold">{{ ORDER_STATUS_LABELS[order.status] }}</span>
          </p>
        </div>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <!-- Carta -->
        <SectionCard title="Carta">
          <div v-if="!editable" class="text-sm text-text-muted py-6 text-center">La comanda está cerrada; no se pueden agregar ítems.</div>
          <template v-else>
            <div v-if="categories.length" class="flex flex-wrap gap-1.5 mb-3">
              <button @click="activeCategoryId = 'all'" :class="['px-2.5 py-1 rounded-full text-xs font-bold', activeCategoryId === 'all' ? 'bg-navy text-white' : 'bg-surface text-text-muted']">Todas</button>
              <button v-for="c in categories" :key="c.id" @click="activeCategoryId = c.id" :class="['px-2.5 py-1 rounded-full text-xs font-bold', activeCategoryId === c.id ? 'bg-navy text-white' : 'bg-surface text-text-muted']">{{ c.name }}</button>
            </div>
            <EmptyState v-if="!availableItems.length && !availableCombos.length" title="Sin ítems disponibles" message="Configurá la carta primero." />
            <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button v-for="c in availableCombos" :key="`combo-${c.id}`" @click="addCombo(c)" :disabled="busy"
                class="p-2.5 rounded-xl border-2 border-gold/50 bg-gold/5 text-left hover:border-gold hover:bg-gold/10 disabled:opacity-50">
                <span class="inline-block text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold font-bold uppercase mb-1">Combo</span>
                <div class="font-bold text-navy text-sm leading-tight">{{ c.name }}</div>
                <div class="text-xs text-text-muted tabular-nums mt-0.5">{{ money(c.price) }}</div>
                <!-- F5: alérgenos DERIVADOS de los componentes — informativo, no bloquea agregar. -->
                <div v-if="(c.allergens ?? []).length" class="flex flex-wrap gap-1 mt-1">
                  <span v-for="tag in c.allergens" :key="tag" class="text-[9px] px-1 py-0.5 rounded bg-navy/5 text-navy font-bold">{{ allergenLabel(tag) }}</span>
                </div>
              </button>
              <button v-for="i in availableItems" :key="i.id" @click="addItem(i)" :disabled="busy || modifierPickLoading"
                class="p-2.5 rounded-xl border-2 border-border text-left hover:border-navy hover:bg-surface disabled:opacity-50">
                <div class="font-bold text-navy text-sm leading-tight flex items-center gap-1">
                  <!-- F6: destacado/plato del día — puramente informativo, sin efecto en disponibilidad. -->
                  <span v-if="i.featured" class="text-gold shrink-0" title="Destacado">★</span>
                  {{ i.name }}
                </div>
                <div class="text-xs text-text-muted tabular-nums mt-0.5">{{ money(i.price) }}</div>
                <!-- F5: tags de alérgenos/info dietética — informativo, nunca bloquea agregar a la comanda. -->
                <div v-if="(i.allergens ?? []).length" class="flex flex-wrap gap-1 mt-1">
                  <span v-for="tag in i.allergens" :key="tag" class="text-[9px] px-1 py-0.5 rounded bg-navy/5 text-navy font-bold">{{ allergenLabel(tag) }}</span>
                </div>
              </button>
            </div>
          </template>
        </SectionCard>

        <!-- Ticket -->
        <SectionCard title="Comanda">
          <EmptyState v-if="!topLines.length" title="Comanda vacía" message="Tocá un ítem de la carta para agregarlo." />
          <div v-else class="divide-y divide-border">
            <div v-for="l in topLines" :key="l.id" class="py-2.5">
              <div class="flex items-center gap-3">
                <div class="min-w-0 flex-1">
                  <div class="font-bold text-navy text-sm truncate flex items-center gap-1.5">
                    <span v-if="l.kind === 'combo_header'" class="text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold font-bold uppercase shrink-0">Combo</span>
                    <span class="truncate">{{ l.name }} × {{ l.quantity }}</span>
                    <span v-if="modifiersLabel(l)" class="font-normal text-text-muted">{{ modifiersLabel(l) }}</span>
                  </div>
                  <div class="text-[11px] text-text-muted tabular-nums">
                    {{ money(l.unitPrice) }} c/u · {{ money(l.lineTotal) }}
                  </div>
                  <button v-if="l.kind === 'combo_header'" @click="toggleExpand(l.id)" class="text-[11px] font-bold text-teal hover:underline mt-0.5">
                    {{ expandedCombos.has(l.id) ? '▲ Ocultar componentes' : `▼ Ver ${componentsOf(l.id).length} componente(s)` }}
                    <span v-if="comboAggregateStatus(l.id)" class="text-text-muted font-normal">· {{ comboAggregateStatus(l.id) }}</span>
                  </button>
                </div>
                <div v-if="editable && (editPerm || deletePerm)" class="flex items-center gap-1.5 shrink-0">
                  <template v-if="editPerm">
                    <button @click="setQty(l, l.quantity - 1)" :disabled="busy" class="w-7 h-7 rounded-lg border-2 border-border font-black text-navy hover:bg-surface disabled:opacity-40">−</button>
                    <span class="w-6 text-center font-black text-navy tabular-nums">{{ l.quantity }}</span>
                    <button @click="setQty(l, l.quantity + 1)" :disabled="busy" class="w-7 h-7 rounded-lg border-2 border-border font-black text-navy hover:bg-surface disabled:opacity-40">+</button>
                  </template>
                  <span v-else class="font-black text-navy tabular-nums">×{{ l.quantity }}</span>
                  <button v-if="deletePerm" @click="remove(l)" :disabled="busy" class="ml-1 w-7 h-7 rounded-lg text-coral font-black hover:bg-coral/10 disabled:opacity-40">✕</button>
                </div>
                <div v-else class="font-black text-navy tabular-nums shrink-0">×{{ l.quantity }}</div>
              </div>

              <!-- Componentes del combo (F2): solo informativo, no editables por separado (se editan/quitan vía el header) -->
              <div v-if="l.kind === 'combo_header' && expandedCombos.has(l.id)" class="mt-2 ml-3 pl-3 border-l-2 border-gold/40 space-y-1">
                <div v-for="comp in componentsOf(l.id)" :key="comp.id" class="flex items-center justify-between gap-2 text-xs">
                  <span class="text-text-secondary">{{ comp.name }} <span class="text-text-muted">×{{ comp.quantity }}</span></span>
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-navy/5 text-navy">{{ LINE_STATUS_LABELS[comp.status] }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Totales -->
          <div class="mt-4 pt-3 border-t-2 border-navy/10 space-y-1.5 text-sm">
            <div class="flex justify-between text-text-muted"><span>Subtotal</span><span class="tabular-nums">{{ money(order.subtotal) }}</span></div>
            <div class="flex justify-between text-text-muted"><span>Impuesto</span><span class="tabular-nums">{{ money(order.tax) }}</span></div>
            <div v-if="order.tip" class="flex justify-between text-text-muted"><span>Propina</span><span class="tabular-nums">{{ money(order.tip) }}</span></div>
            <div class="flex justify-between text-navy font-black text-lg pt-1"><span>Total</span><span class="tabular-nums">{{ money(order.total) }}</span></div>
          </div>

          <!-- Acciones -->
          <div class="mt-4 flex flex-wrap gap-2">
            <button v-if="editable && editPerm && order.status === 'open'" @click="send" :disabled="busy || !order.lines.length"
              class="flex-1 min-w-[140px] py-2.5 rounded-xl bg-navy text-white font-bold hover:bg-navy-light disabled:opacity-50">Enviar a cocina</button>
            <button v-if="editable && editPerm" @click="goPay" :disabled="busy || !order.lines.length"
              class="flex-1 min-w-[140px] py-2.5 rounded-xl bg-teal text-white font-bold hover:bg-teal/80 disabled:opacity-50">Cobrar</button>
            <button v-if="editable && deletePerm" @click="cancel" :disabled="busy"
              class="px-4 py-2.5 rounded-xl border-2 border-coral/40 text-coral font-bold hover:bg-coral/10 disabled:opacity-50">Cancelar</button>
          </div>
        </SectionCard>
      </div>
    </template>

    <EmptyState v-else title="Comanda no encontrada" message="La comanda no existe o no tenés acceso." />

    <!-- Selector de modificadores (F1): se abre ANTES de agregar la línea -->
    <AppModal v-if="modifierPickItem" :title="modifierPickItem.name" subtitle="Elegí las opciones antes de agregar a la comanda." @close="modifierPickItem = null">
      <div class="space-y-4">
        <div v-for="g in modifierPickGroups" :key="g.id">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-xs font-black text-navy uppercase">{{ g.name }}</span>
            <span v-if="g.required" class="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold font-bold">Obligatorio</span>
          </div>
          <div class="space-y-1.5">
            <label v-for="m in g.modifiers ?? []" :key="m.id" class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border-2 border-border cursor-pointer hover:bg-surface">
              <span class="flex items-center gap-2 text-sm text-navy">
                <input v-if="g.selectionType === 'single'" type="radio" :name="`g-${g.id}`"
                  :checked="(modifierSelection[g.id] ?? []).includes(m.id)" @change="pickSingle(g.id, m.id)" />
                <input :id="`modificador-${g.id}-${m.id}`" :aria-label="m.name" v-else type="checkbox"
                  :checked="(modifierSelection[g.id] ?? []).includes(m.id)" @change="toggleMultiple(g.id, m.id)" />
                {{ m.name }}
              </span>
              <span v-if="m.priceDelta" class="text-xs font-bold tabular-nums" :class="m.priceDelta < 0 ? 'text-coral' : 'text-navy'">{{ m.priceDelta > 0 ? '+' : '' }}{{ money(m.priceDelta) }}</span>
            </label>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="modifierPickItem = null" class="px-4 py-2 rounded-lg border-2 border-border text-navy font-bold text-sm">Cancelar</button>
        <button @click="confirmModifierPick" :disabled="!modifierPickReady || busy" class="px-4 py-2 rounded-lg bg-navy text-white font-bold text-sm disabled:opacity-50">Agregar</button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" v-bind="confirmModal" :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>
