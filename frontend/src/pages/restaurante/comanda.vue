<script setup lang="ts">
// pages/restaurante/comanda.vue — Toma de comanda (RES-7). Carta a la izquierda (tocar ítem = agregar
// línea), ticket a la derecha con líneas + totales en vivo (recalculados por el backend). Enviar a cocina
// (sendOrder), cobrar (→ cobrar/:id) o cancelar. Las líneas solo se editan si la comanda no cerró.
// #210 — después de "Enviar a cocina" el mozo ya no queda a ciegas: badge de estado POR LÍNEA con el
// color del KDS, refresco cada 15 s mientras la comanda está en cocina, nota por línea ("sin cebolla")
// y re-envío de las líneas agregadas después. El bloqueo al agregar es por ítem, no de toda la carta.
// #207: quitar (✕) borra SOLO mientras la línea no llegó a cocina (comanda `open`, o agregada después
// y sin confirmar); una vez enviada abre el modal de motivo y ANULA (queda tachada con el motivo, sale
// del total). Cancelar la comanda también pide motivo. Cerrar el modal no cambia nada.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  RestaurantService, isLineActive, roomServiceLabel,
  type OrderWithLines, type MenuCategory, type MenuItem, type OrderLine, type ModifierGroup, type Combo,
  type AllergenTag, type LineStatus,
  ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, LINE_STATUS_LABELS, LINE_STATUS_BADGE, ALLERGEN_LABELS,
} from '@/services/Restaurant.service'
import { SettingsService } from '@/services/Settings.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import VoidReasonModal from '@/components/features/restaurante/VoidReasonModal.vue'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { can } = usePermissions()
const orderId = computed(() => String(route.params.id))

const loading = ref(true)
// #210 — el `busy` global desapareció: bloqueaba TODA la carta mientras se agregaba un ítem (en una
// tablet lenta se sentía trabada) y, peor, descartaba el toque siguiente. Ahora hay tres candados
// acotados: `cooling` (ese ítem, 300 ms, anti doble-toque), `busyLine` (esa línea) y `sending` (las
// acciones de la comanda entera: enviar/cobrar/cancelar).
const busyLine = ref<string | null>(null)
const sending = ref(false)
const order = ref<OrderWithLines | null>(null)
const categories = ref<MenuCategory[]>([])
const items = ref<MenuItem[]>([])
const combos = ref<Combo[]>([])
const currency = ref<string>(CurrencyCode.USD)
const activeCategoryId = ref<string>('all')

const editPerm = computed(() => can('restaurant', 'edit'))
const createPerm = computed(() => can('restaurant', 'create'))
const deletePerm = computed(() => can('restaurant', 'delete'))
// #205: quitar una línea ANTES de enviar a cocina es parte de tomar el pedido: el mismo permiso que
// agregarla (`create`, el mozo lo tiene; cocina no). Después de enviada, quitar = anular (`delete`,
// hotel_admin) además del `create` de la ruta — hasta que exista la anulación con motivo (#207).
// Espeja la regla del backend (ruta `restaurant:create` + `order-lines.removeLine`).
const canRemoveLine = computed(() => (order.value?.status === 'open' ? createPerm.value : createPerm.value && deletePerm.value))
// Cobrar es `restaurant:pay` (#205): el botón lleva a /cobrar/:id, que el router gatea con ese permiso.
const payPerm = computed(() => can('restaurant', 'pay'))

// La comanda es editable solo antes de facturar/cobrar/cancelar. fix-refund-pos-card:
// 'processing_payment' también bloquea (Cobrar/Cancelar) — el cobro con tarjeta ya abrió una Checkout
// Session; el cajero espera la confirmación en cobrar.vue, no vuelve a tocar la comanda desde acá.
const LOCKED = ['billed', 'charged', 'paid', 'cancelled', 'processing_payment']
const editable = computed(() => !!order.value && !LOCKED.includes(order.value.status))
// Líneas que cuentan (no anuladas): son las que habilitan Enviar/Cobrar.
const activeLines = computed<OrderLine[]>(() => (order.value?.lines ?? []).filter(isLineActive))

// #207: modal de motivo, compartido por "anular línea" y "cancelar comanda".
const voidReasons = ref<string[]>([])
const voidBusy = ref(false)
const voidTarget = ref<{ kind: 'line'; line: OrderLine } | { kind: 'order' } | null>(null)
const voidTitle = computed(() => voidTarget.value?.kind === 'order' ? 'Cancelar comanda' : 'Anular plato')
const voidSubtitle = computed(() => {
  if (!voidTarget.value) return undefined
  if (voidTarget.value.kind === 'order') return 'Se libera la mesa. Lo ya enviado a cocina queda anulado con este motivo.'
  return `${voidTarget.value.line.quantity}× ${voidTarget.value.line.name}`
})
function closeVoid() { if (!voidBusy.value) voidTarget.value = null }
async function confirmVoid(reason: string) {
  if (!voidTarget.value || voidBusy.value) return
  voidBusy.value = true
  try {
    if (voidTarget.value.kind === 'order') {
      await RestaurantService.cancelOrder(orderId.value, reason)
      voidTarget.value = null
      router.push('/panel/restaurante/salon')
      return
    }
    await RestaurantService.voidLine(orderId.value, voidTarget.value.line.id, reason)
    voidTarget.value = null
    toast.success('Plato anulado')
    await reloadOrder()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo anular') }
  finally { voidBusy.value = false }
}
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
    const [cat, it, combosRes, settings, reasons] = await Promise.all([
      RestaurantService.listCategories(),
      RestaurantService.listItems(),
      RestaurantService.listCombos(),
      SettingsService.get().catch(() => null),
      RestaurantService.voidReasons().catch(() => null),   // sin lista, el modal ofrece solo "Otro"
    ])
    voidReasons.value = reasons?.reasons ?? []
    categories.value = cat.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    items.value = it.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    combos.value = combosRes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    // `SettingsService.get()` ya devuelve `{ hotel: HotelFull }` tipado; el `.catch(() => null)` de
    // arriba es lo único que hace falta cubrir (antes esto era un `(settings as any)`).
    currency.value = settings?.hotel?.currency || CurrencyCode.USD
    await reloadOrder()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar la comanda')
  } finally {
    loading.value = false
  }
}

// ─── #210: refresco mientras la comanda está en cocina ────────────────────────────────────────────
// La cocina marca "Lista" desde el KDS y la comanda del mozo tiene que enterarse sin recargar. Polling
// (el endpoint es un GET puro, mismo criterio que cocina.vue) y SOLO en fase de cocina: con la comanda
// `open` no hay nada que cambie del lado del server, y cerrada tampoco.
const REFRESH_MS = 15000
const KITCHEN_STATES = ['sent', 'preparing', 'ready', 'served']
const inKitchen = computed(() => !!order.value && KITCHEN_STATES.includes(order.value.status))
let timer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (timer) { clearInterval(timer); timer = null }
}
function startPolling() {
  if (timer) return
  timer = setInterval(async () => {
    // No pisar el ticket a mitad de una ráfaga de altas ni de una edición de línea: el server todavía
    // no vio ese cambio y el refresco lo haría "desaparecer" por un instante.
    if (pendingAdds.value > 0 || busyLine.value || sending.value) return
    try { await reloadOrder() } catch { /* un tick perdido no molesta al mozo: se reintenta en 15 s */ }
  }, REFRESH_MS)
}
watch(inKitchen, (on) => (on ? startPolling() : stopPolling()))

onMounted(load)
onUnmounted(stopPolling)

// ─── Selector de modificadores (F1) — se abre ANTES de agregar la línea si el ítem tiene grupos ───
const modifierPickItem = ref<MenuItem | null>(null)
const modifierPickGroups = ref<ModifierGroup[]>([])
// #210 — id del ítem cuyos grupos se están cargando (antes era un booleano global que apagaba la carta).
const modifierPickLoading = ref<string | null>(null)
// groupId → modifierId(s) elegidos (single: máximo 1; multiple: N)
const modifierSelection = ref<Record<string, string[]>>({})

const modifierPickReady = computed(() => {
  for (const g of modifierPickGroups.value) {
    const chosen = modifierSelection.value[g.id] ?? []
    if (g.required && chosen.length < 1) return false
  }
  return true
})

// #210 — enfriamiento por ítem: 300 ms de bloqueo del botón que se acaba de tocar (anti doble-toque en
// tablet), el resto de la carta sigue viva.
const ADD_COOLDOWN_MS = 300
const cooling = ref<Set<string>>(new Set())
function cool(id: string) {
  cooling.value.add(id)
  setTimeout(() => cooling.value.delete(id), ADD_COOLDOWN_MS)
}

// #210 — las altas se SERIALIZAN en una cadena de promesas en vez de descartarse: tocar 5 ítems
// seguidos agrega los 5 (el `busy` global devolvía temprano y se perdían). El ticket se recarga una
// sola vez, al terminar la ráfaga.
let addChain: Promise<unknown> = Promise.resolve()
const pendingAdds = ref(0)
function enqueueAdd(run: () => Promise<void>, failMsg: string): Promise<unknown> {
  pendingAdds.value++
  addChain = addChain
    .then(run)
    .catch((e: unknown) => { toast.error(e instanceof Error ? e.message : failMsg) })
    .then(async () => {
      pendingAdds.value--
      if (pendingAdds.value === 0) {
        try { await reloadOrder() } catch { /* el error ya se avisó arriba */ }
      }
    })
  return addChain
}

async function addItem(i: MenuItem) {
  if (!editable.value || !createPerm.value || cooling.value.has(i.id)) return
  modifierPickLoading.value = i.id
  try {
    const groups = await RestaurantService.listModifierGroups(i.id)
    if (groups.length) {
      modifierPickItem.value = i
      modifierPickGroups.value = groups
      modifierSelection.value = Object.fromEntries(groups.map((g) => [g.id, []]))
      return
    }
  } catch { /* si falla la carga de grupos, se agrega sin selector (no bloquea el flujo del mesero) */ }
  finally { if (modifierPickLoading.value === i.id) modifierPickLoading.value = null }
  commitAddItem(i, [])
}

function pickSingle(groupId: string, modifierId: string) { modifierSelection.value[groupId] = [modifierId] }
function toggleMultiple(groupId: string, modifierId: string) {
  const cur = modifierSelection.value[groupId] ?? []
  modifierSelection.value[groupId] = cur.includes(modifierId) ? cur.filter((id) => id !== modifierId) : [...cur, modifierId]
}

function confirmModifierPick() {
  if (!modifierPickItem.value || !modifierPickReady.value) return
  const modifiers = Object.values(modifierSelection.value).flat().map((modifierId) => ({ modifierId }))
  const item = modifierPickItem.value
  modifierPickItem.value = null
  commitAddItem(item, modifiers)
}

function commitAddItem(i: MenuItem, modifiers: { modifierId: string }[]) {
  cool(i.id)
  void enqueueAdd(
    () => RestaurantService.addLine(orderId.value, { menuItemId: i.id, quantity: 1, modifiers: modifiers.length ? modifiers : undefined }).then(() => {}),
    'No se pudo agregar',
  )
}

/** Etiqueta entre paréntesis con los modificadores elegidos, ej. "(Grande, +tocino)". */
function modifiersLabel(l: OrderLine): string {
  const names = (l.modifiers ?? []).map((m) => m.name)
  return names.length ? `(${names.join(', ')})` : ''
}

// ─── Combos (F2) — se agregan como 1 sola línea (kind='combo_header'); el backend explota los
// componentes en filas 'combo_component' propias (parentLineId → header). Nunca aceptan modificadores. ───
function addCombo(c: Combo) {
  if (!editable.value || !createPerm.value || cooling.value.has(c.id)) return
  cool(c.id)
  void enqueueAdd(
    () => RestaurantService.addLine(orderId.value, { comboId: c.id, quantity: 1 }).then(() => {}),
    'No se pudo agregar el combo',
  )
}

// Líneas de "primer nivel" del ticket: ítems sueltos + headers de combo. Los componentes
// (kind='combo_component') NO aparecen acá — se muestran anidados bajo su header, solo informativos.
const topLines = computed<OrderLine[]>(() => (order.value?.lines ?? []).filter((l) => l.kind !== 'combo_component'))
function componentsOf(headerId: string): OrderLine[] {
  return (order.value?.lines ?? []).filter((l) => l.kind === 'combo_component' && l.parentLineId === headerId)
}
// Estado (servido/preparando/etc) derivado de sus componentes — el header nunca transiciona en el KDS.
// Devuelve la CLAVE de LineStatus (no un texto): el badge usa las mismas etiquetas y colores que el resto.
function comboAggregateStatus(headerId: string): LineStatus | '' {
  const comps = componentsOf(headerId)
  if (!comps.length) return ''
  if (comps.every((c) => !isLineActive(c))) return 'voided'
  if (comps.every((c) => c.status === 'served')) return 'served'
  if (comps.some((c) => c.status === 'ready')) return 'ready'
  if (comps.some((c) => c.status === 'preparing')) return 'preparing'
  return 'new'
}

// #210 — badge de estado de cocina por línea, con el color del KDS (LINE_STATUS_BADGE). Con la comanda
// `open` no se muestra: todavía no hay cocina y todas las líneas dirían "Nueva". "Sin enviar" es el
// estado propio del mozo: la línea se agregó después del envío y todavía no la confirmó (ver `sentAt`).
const lineBadges = computed(() => {
  const map = new Map<string, { label: string; cls: string }>()
  if (!order.value || order.value.status === 'open') return map
  for (const l of topLines.value) {
    if (l.status === 'new' && !l.sentAt) {
      map.set(l.id, { label: 'Sin enviar', cls: 'bg-gold/15 text-gold' })
      continue
    }
    const status = l.kind === 'combo_header' ? comboAggregateStatus(l.id) : l.status
    if (!status) continue
    map.set(l.id, { label: LINE_STATUS_LABELS[status] ?? status, cls: LINE_STATUS_BADGE[status] ?? 'bg-navy/10 text-navy' })
  }
  return map
})

const expandedCombos = ref<Set<string>>(new Set())
function toggleExpand(headerId: string) {
  if (expandedCombos.value.has(headerId)) expandedCombos.value.delete(headerId)
  else expandedCombos.value.add(headerId)
}

async function setQty(line: OrderLine, qty: number) {
  if (!editable.value || !editPerm.value || busyLine.value || !isLineActive(line)) return
  if (qty < 1) { await remove(line); return }
  busyLine.value = line.id
  try {
    await RestaurantService.updateLine(orderId.value, line.id, { quantity: qty })
    await reloadOrder()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo actualizar') }
  finally { busyLine.value = null }
}

async function remove(line: OrderLine) {
  if (!editable.value || busyLine.value || !isLineActive(line)) return
  // Sin permiso, bajar a 0 quedaba en silencio — igual que 'cancel()'. Con la comanda ya enviada
  // el mozo no puede anular: el aviso lo dice, no un 403 mudo.
  if (!canRemoveLine.value) {
    toast.warning(order.value?.status === 'open' ? 'Sin permiso para quitar ítems' : 'La comanda ya fue enviada a cocina: solo un administrador puede anular líneas')
    return
  }
  // #207: ya confirmada a cocina → no se borra, se anula con motivo (el backend devuelve 409 si se
  // intenta). Una línea agregada después del envío y sin confirmar (#210, `new` sin `sentAt`) sigue
  // siendo un error de toma: se quita.
  const unsent = line.status === 'new' && !line.sentAt
  if (order.value?.status !== 'open' && !unsent) { voidTarget.value = { kind: 'line', line }; return }
  busyLine.value = line.id
  try {
    await RestaurantService.removeLine(orderId.value, line.id)
    await reloadOrder()
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo quitar') }
  finally { busyLine.value = null }
}

// ─── #210: nota por línea ("sin cebolla") ─────────────────────────────────────────────────────────
// Viaja en el MISMO PUT que la cantidad (`updateLine`, permiso restaurant:edit) y el KDS ya la pinta
// debajo del plato (cocina.vue). Sin input, el campo existía en la API y no lo usaba nadie.
const NOTE_MAX = 140
const notesLine = ref<OrderLine | null>(null)
const notesDraft = ref('')
const notesSaving = ref(false)

function openNotes(l: OrderLine) {
  if (!editable.value || !editPerm.value || l.kind === 'combo_header') return
  notesLine.value = l
  notesDraft.value = l.notes ?? ''
}
async function saveNotes() {
  const line = notesLine.value
  if (!line || notesSaving.value) return
  notesSaving.value = true
  try {
    await RestaurantService.updateLine(orderId.value, line.id, { notes: notesDraft.value.trim() })
    notesLine.value = null
    await reloadOrder()
    toast.success('Nota guardada')
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar la nota') }
  finally { notesSaving.value = false }
}

// ─── Enviar a cocina ──────────────────────────────────────────────────────────────────────────────
// #210 — líneas cargadas y todavía no confirmadas a cocina. `status:'new'` no alcanza como criterio:
// una línea enviada sigue en 'new' hasta que cocina la toma; el discriminador es `sentAt` (backend).
const unsentCount = computed(() => topLines.value.filter((l) => l.status === 'new' && !l.sentAt).length)
const canResend = computed(() => !!order.value && editable.value && editPerm.value && inKitchen.value && unsentCount.value > 0)

async function send() {
  if (sending.value) return
  sending.value = true
  const resend = order.value?.status !== 'open'
  const n = unsentCount.value
  try {
    await RestaurantService.sendOrder(orderId.value)
    await reloadOrder()
    toast.success(resend ? `${n} línea(s) enviada(s) a cocina` : 'Enviada a cocina')
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo enviar') }
  finally { sending.value = false }
}

function goPay() {
  if (!activeLines.value.length) { toast.warning('La comanda no tiene ítems'); return }
  router.push(`/panel/restaurante/cobrar/${orderId.value}`)
}

// #207: cancelar pide motivo (obligatorio en el backend). El modal de motivo reemplaza al ConfirmModal.
function cancel() {
  if (!deletePerm.value) { toast.warning('Sin permiso para cancelar'); return }
  voidTarget.value = { kind: 'order' }
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
            <!-- #209 — room service: "Hab. 204 · Pérez" (el server lo resuelve desde la reserva de la comanda). -->
            <template v-if="roomServiceLabel(order)"><span class="font-bold text-navy" data-testid="room-label">{{ roomServiceLabel(order) }}</span> · </template>
            <span class="font-bold">{{ ORDER_STATUS_LABELS[order.status] }}</span>
            <!-- #210 — comensales: se elige al abrir la comanda en salón (salon.vue). -->
            <template v-if="order.covers"> · {{ order.covers }} comensal(es)</template>
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
              <!-- #210 — :disabled por ítem (enfriamiento de 300 ms), NO global: tocar cinco platos
                   seguidos los agrega los cinco y la carta nunca se apaga entera. -->
              <button v-for="c in availableCombos" :key="`combo-${c.id}`" @click="addCombo(c)" :disabled="cooling.has(c.id)"
                class="p-2.5 rounded-xl border-2 border-gold/50 bg-gold/5 text-left hover:border-gold hover:bg-gold/10 disabled:opacity-50">
                <span class="inline-block text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold font-bold uppercase mb-1">Combo</span>
                <div class="font-bold text-navy text-sm leading-tight">{{ c.name }}</div>
                <div class="text-xs text-text-muted tabular-nums mt-0.5">{{ money(c.price) }}</div>
                <!-- F5: alérgenos DERIVADOS de los componentes — informativo, no bloquea agregar. -->
                <div v-if="(c.allergens ?? []).length" class="flex flex-wrap gap-1 mt-1">
                  <span v-for="tag in c.allergens" :key="tag" class="text-[9px] px-1 py-0.5 rounded bg-navy/5 text-navy font-bold">{{ allergenLabel(tag) }}</span>
                </div>
              </button>
              <button v-for="i in availableItems" :key="i.id" @click="addItem(i)" :disabled="cooling.has(i.id) || modifierPickLoading === i.id"
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
            <div v-for="l in topLines" :key="l.id" :class="['py-2.5', !isLineActive(l) && 'opacity-70']">
              <div class="flex items-center gap-3">
                <div class="min-w-0 flex-1">
                  <div :class="['font-bold text-sm truncate flex items-center gap-1.5', isLineActive(l) ? 'text-navy' : 'text-text-muted line-through']">
                    <span v-if="l.kind === 'combo_header'" class="text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold font-bold uppercase shrink-0">Combo</span>
                    <span class="truncate">{{ l.name }} × {{ l.quantity }}</span>
                    <span v-if="modifiersLabel(l)" class="font-normal text-text-muted">{{ modifiersLabel(l) }}</span>
                  </div>
                  <!-- #207: una línea anulada se conserva tachada con su motivo; no suma al total. -->
                  <div v-if="!isLineActive(l)" class="text-[11px] text-coral font-bold">
                    Anulada<span v-if="l.voidReason"> · {{ l.voidReason }}</span>
                  </div>
                  <template v-else>
                    <!-- #210 — estado de cocina de ESTA línea, con el color del KDS. Lo que el mozo
                         necesita para saber qué plato ya puede llevar a la mesa. -->
                    <span v-if="lineBadges.get(l.id)" :class="['inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5', lineBadges.get(l.id)!.cls]">
                      {{ lineBadges.get(l.id)!.label }}
                    </span>
                    <div class="text-[11px] text-text-muted tabular-nums">
                      {{ money(l.unitPrice) }} c/u · {{ money(l.lineTotal) }}
                    </div>
                  </template>
                  <!-- #210 — nota de la línea ("sin cebolla"): viaja al KDS y se ve debajo del plato. -->
                  <div v-if="l.notes" class="text-[11px] text-gold font-bold">⚑ {{ l.notes }}</div>
                  <div class="flex flex-wrap items-center gap-3">
                    <!-- El header de un combo NO acepta nota: el KDS lo excluye de la cola (nunca es
                         un plato a preparar) y sus componentes los rechaza `updateLine` ("editá el
                         combo completo"). Mostrar el control ahí sería prometer una nota que la
                         cocina jamás ve. -->
                    <button v-if="editable && editPerm && l.kind !== 'combo_header' && isLineActive(l)" @click="openNotes(l)" class="text-[11px] font-bold text-navy hover:underline mt-0.5">
                      📝 {{ l.notes ? 'Editar nota' : 'Agregar nota' }}
                    </button>
                    <button v-if="l.kind === 'combo_header'" @click="toggleExpand(l.id)" class="text-[11px] font-bold text-teal hover:underline mt-0.5">
                      {{ expandedCombos.has(l.id) ? '▲ Ocultar componentes' : `▼ Ver ${componentsOf(l.id).length} componente(s)` }}
                    </button>
                  </div>
                </div>
                <div v-if="editable && isLineActive(l) && (editPerm || canRemoveLine)" class="flex items-center gap-1.5 shrink-0">
                  <template v-if="editPerm">
                    <button @click="setQty(l, l.quantity - 1)" :disabled="busyLine === l.id" class="w-7 h-7 rounded-lg border-2 border-border font-black text-navy hover:bg-surface disabled:opacity-40">−</button>
                    <span class="w-6 text-center font-black text-navy tabular-nums">{{ l.quantity }}</span>
                    <button @click="setQty(l, l.quantity + 1)" :disabled="busyLine === l.id" class="w-7 h-7 rounded-lg border-2 border-border font-black text-navy hover:bg-surface disabled:opacity-40">+</button>
                  </template>
                  <span v-else class="font-black text-navy tabular-nums">×{{ l.quantity }}</span>
                  <button v-if="canRemoveLine" @click="remove(l)" :disabled="busyLine === l.id" :title="order.status === 'open' || (l.status === 'new' && !l.sentAt) ? 'Quitar' : 'Anular con motivo'"
                    class="ml-1 w-7 h-7 rounded-lg text-coral font-black hover:bg-coral/10 disabled:opacity-40">✕</button>
                </div>
                <div v-else-if="isLineActive(l)" class="font-black text-navy tabular-nums shrink-0">×{{ l.quantity }}</div>
              </div>

              <!-- Componentes del combo (F2): solo informativo, no editables por separado (se editan/quitan vía el header) -->
              <div v-if="l.kind === 'combo_header' && expandedCombos.has(l.id)" class="mt-2 ml-3 pl-3 border-l-2 border-gold/40 space-y-1">
                <div v-for="comp in componentsOf(l.id)" :key="comp.id" class="flex items-center justify-between gap-2 text-xs">
                  <span class="text-text-secondary">{{ comp.name }} <span class="text-text-muted">×{{ comp.quantity }}</span></span>
                  <span :class="['text-[10px] font-bold px-1.5 py-0.5 rounded', LINE_STATUS_BADGE[comp.status] ?? 'bg-navy/5 text-navy']">{{ LINE_STATUS_LABELS[comp.status] }}</span>
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
            <button v-if="editable && editPerm && order.status === 'open'" @click="send" :disabled="sending || !activeLines.length"
              class="flex-1 min-w-[140px] py-2.5 rounded-xl bg-navy text-white font-bold hover:bg-navy-light disabled:opacity-50">Enviar a cocina</button>
            <!-- #210 — re-envío parcial: solo lo que se agregó DESPUÉS del primer envío. El backend
                 (`POST /orders/:id/send`) es idempotente: sin líneas sin confirmar no hace nada. -->
            <button v-if="canResend" @click="send" :disabled="sending"
              class="flex-1 min-w-[140px] py-2.5 rounded-xl bg-gold text-white font-bold hover:bg-gold/80 disabled:opacity-50">
              Enviar {{ unsentCount }} nueva(s) a cocina
            </button>
            <button v-if="editable && payPerm" @click="goPay" :disabled="sending || !activeLines.length"
              class="flex-1 min-w-[140px] py-2.5 rounded-xl bg-teal text-white font-bold hover:bg-teal/80 disabled:opacity-50">Cobrar</button>
            <button v-if="editable && deletePerm" @click="cancel" :disabled="sending"
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
                <!-- #210 — el radio tenía `name` pero ningún nombre accesible (el checkbox de al lado
                     sí): un lector de pantalla anunciaba "radio button" sin la opción. -->
                <input :id="`modificador-${g.id}-${m.id}`" :aria-label="m.name" v-if="g.selectionType === 'single'" type="radio" :name="`g-${g.id}`"
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
        <button @click="confirmModifierPick" :disabled="!modifierPickReady" class="px-4 py-2 rounded-lg bg-navy text-white font-bold text-sm disabled:opacity-50">Agregar</button>
      </template>
    </AppModal>

    <!-- #210 — nota de la línea. Va al KDS (cocina.vue la pinta debajo del plato). -->
    <AppModal v-if="notesLine" title="Nota para cocina" :subtitle="notesLine.name" @close="notesLine = null">
      <label for="linea-nota" class="block text-xs font-black text-navy uppercase mb-1.5">Indicación</label>
      <input id="linea-nota" v-model="notesDraft" type="text" :maxlength="NOTE_MAX" placeholder="Ej: sin cebolla"
        class="w-full px-3 py-2 rounded-lg border-2 border-border text-sm text-navy focus:border-navy outline-none"
        @keyup.enter="saveNotes" />
      <p class="text-[11px] text-text-muted mt-1.5">Se imprime en el ticket de cocina. Dejala vacía para quitarla.</p>
      <template #footer>
        <button @click="notesLine = null" class="px-4 py-2 rounded-lg border-2 border-border text-navy font-bold text-sm">Cancelar</button>
        <button @click="saveNotes" :disabled="notesSaving" class="px-4 py-2 rounded-lg bg-navy text-white font-bold text-sm disabled:opacity-50">Guardar</button>
      </template>
    </AppModal>

    <VoidReasonModal v-if="voidTarget" :title="voidTitle" :subtitle="voidSubtitle"
      :reasons="voidReasons.length ? voidReasons : ['Otro']"
      :confirm-label="voidTarget.kind === 'order' ? 'Cancelar comanda' : 'Anular plato'" :loading="voidBusy"
      @confirm="confirmVoid" @close="closeVoid" />
  </div>
</template>
