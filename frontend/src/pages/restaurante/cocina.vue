<script setup lang="ts">
// pages/restaurante/cocina.vue — Tablero de cocina (KDS, RES-7). TRES COLUMNAS tipo kanban —
// Pendiente (new) → Preparando (preparing) → Listo (ready) — y una TARJETA POR PLATO (línea), no por
// comanda: cocina arrastra la tarjeta a la columna siguiente o toca el botón (tablet). Una tarjeta
// lleva a dónde va ("Terraza · Mesa 3" / "Hab. 204"), la comanda, el cronómetro y la RECETA del
// plato (ingredientes de Carta → ítem → Receta, resueltos por el server en la cola): cocina puede
// QUITAR un ingrediente ("SIN"), pedirlo DOBLE o AGREGAR uno ("CON") — LineIngredientsEditor, el
// mismo editor que usa el mozo en la comanda. Se guarda en la línea (`ingredientChanges`) y sale en
// la comanda impresa. No toca el precio: un extra que se cobra es un modificador y lo carga el mozo.
// #211: se actualiza por el canal en vivo (SSE, useRestaurantEvents); si el stream cae, polling cada
// 15 s. Cronómetro desde el envío a cocina (`sentAt`, #210), ámbar a N min y rojo a 2N (N por estación).
// Suena al entrar un ticket de la estación que se mira (toggle en localStorage).
// #207: "Anular" abre un modal de motivo (VoidReasonModal); cerrar no cambia nada.
// Modo KIOSCO (`/panel/kds`, meta.kiosk): misma pantalla sin sidebar ni cabecera del panel, fondo oscuro y
// letra grande, para la pantalla/tablet que vive en la cocina.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  RestaurantService,
  type Station, type KdsTicket, type OrderLine, type LineStatus, type RestaurantEvent,
  ORDER_TYPE_LABELS, DEFAULT_ALERT_MINUTES,
} from '@/services/Restaurant.service'
import EmptyState from '@/components/ui/EmptyState.vue'
import VoidReasonModal from '@/components/features/restaurante/VoidReasonModal.vue'
import LineIngredientsEditor from '@/components/features/restaurante/LineIngredientsEditor.vue'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'
import { useNow } from '@/composables/useNow'
import { useRestaurantEvents } from '@/composables/useRestaurantEvents'
import { openPrintTab } from './imprimir'

const toast = useToast()
const route = useRoute()
const kiosk = computed(() => route.meta.kiosk === true)
const { can } = usePermissions()
const editPerm = computed(() => can('restaurant', 'edit'))
// Anular exige restaurant:delete (misma decisión que quitar un plato, con rastro). Sin el permiso el
// botón no se muestra: el backend devolvería 403 igual.
const deletePerm = computed(() => can('restaurant', 'delete'))

const REFRESH_MS = 15000
const loading = ref(true)
const refreshing = ref(false)
const busyLine = ref<string | null>(null)
const stations = ref<Station[]>([])
const tickets = ref<KdsTicket[]>([])
const station = ref<string>('')       // '' = todas · '__none__' = sin estación · id = estación puntual

// ─── Columnas del tablero ───
type BoardStatus = 'new' | 'preparing' | 'ready'
interface Column { status: BoardStatus; label: string; hint: string; accent: string }
const COLUMNS: Column[] = [
  { status: 'new', label: 'Pendiente', hint: 'Llegó de la comanda, nadie lo tomó', accent: 'border-navy/30' },
  { status: 'preparing', label: 'Preparando', hint: 'En el fuego', accent: 'border-navy' },
  { status: 'ready', label: 'Listo', hint: 'Para que lo retire el mozo', accent: 'border-gold' },
]
// Siguiente transición por estado (el KDS solo avanza; served/voided salen del tablero).
const NEXT: Record<BoardStatus, { to: LineStatus; label: string; cls: string }> = {
  new: { to: 'preparing', label: 'Preparar →', cls: 'bg-navy text-white' },
  preparing: { to: 'ready', label: 'Listo →', cls: 'bg-gold text-white' },
  ready: { to: 'served', label: 'Servido ✓', cls: 'bg-teal text-white' },
}
// Estados desde los que cocina puede anular (una vez listo, la decisión es del salón/comanda).
const VOIDABLE: LineStatus[] = ['new', 'preparing']

/** Tarjeta del tablero: el plato + su comanda (para el lugar, el número y el cronómetro). */
interface Card { line: OrderLine; ticket: KdsTicket }
const cards = computed<Card[]>(() => tickets.value.flatMap((t) => t.lines.map((line) => ({ line, ticket: t }))))
function cardsOf(status: BoardStatus): Card[] {
  // FIFO por comanda (la cola ya viene ordenada por apertura) y, dentro de la comanda, por orden de carga.
  return cards.value.filter((c) => c.line.status === status)
}

// ─── Arrastrar y soltar (kanban) ───
// HTML5 drag & drop: funciona con mouse y en la mayoría de las tablets modernas; el botón "→" sigue
// estando para el dedo. Solo se acepta soltar en la columna SIGUIENTE (misma regla que el backend:
// new→preparing→ready). Soltar en otra columna no hace nada y avisa.
const dragging = ref<string | null>(null)
const dragOver = ref<BoardStatus | null>(null)
function onDragStart(e: DragEvent, c: Card) {
  if (!editPerm.value) { e.preventDefault(); return }
  dragging.value = c.line.id
  e.dataTransfer?.setData('text/plain', c.line.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragEnd() { dragging.value = null; dragOver.value = null }
function onDragOver(e: DragEvent, status: BoardStatus) {
  if (!dragging.value) return
  e.preventDefault()
  dragOver.value = status
}
async function onDrop(e: DragEvent, status: BoardStatus) {
  e.preventDefault()
  const id = dragging.value || e.dataTransfer?.getData('text/plain')
  dragging.value = null
  dragOver.value = null
  const card = id ? cards.value.find((c) => c.line.id === id) : undefined
  if (!card) return
  const from = card.line.status as BoardStatus
  if (from === status) return
  if (NEXT[from]?.to !== status) {
    toast.warning('Un paso a la vez', `${LABEL_OF[from]} → ${LABEL_OF[status]} no se puede: mové la tarjeta a la columna siguiente.`)
    return
  }
  await advance(card.line, status)
}
const LABEL_OF: Record<string, string> = Object.fromEntries(COLUMNS.map((c) => [c.status, c.label]))

// ─── Receta (LineIngredientsEditor) ───
// La receta viene resuelta en la cola (`line.ingredients`); el editor guarda y devuelve la línea.
function onLineUpdated(c: Card, updated: OrderLine) {
  c.line.ingredientChanges = updated.ingredientChanges ?? null   // pintar sin esperar el refresco del canal en vivo
}

// #207: modal de motivo. `voidTarget` = línea + comanda a anular; null = cerrado.
const voidTarget = ref<{ line: OrderLine; orderId: string } | null>(null)
const voidBusy = ref(false)
const voidReasons = ref<string[]>([])

function openVoid(line: OrderLine, orderId: string) {
  if (!deletePerm.value || busyLine.value) return
  voidTarget.value = { line, orderId }
}
function closeVoid() {
  if (voidBusy.value) return
  voidTarget.value = null
}
async function confirmVoid(reason: string) {
  if (!voidTarget.value || voidBusy.value) return
  voidBusy.value = true
  try {
    await RestaurantService.voidLine(voidTarget.value.orderId, voidTarget.value.line.id, reason)
    voidTarget.value = null
    toast.success('Plato anulado')
    await refresh(false)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo anular')
  } finally {
    voidBusy.value = false
  }
}

// ─── Dónde va el ticket (#211) ───
function placeLabel(t: KdsTicket): string {
  const o = t.order
  if (o.type === 'dine_in') {
    const name = o.tableName || 'Mesa'
    return o.tableZone ? `${o.tableZone} · ${name}` : name
  }
  if (o.type === 'room_service') return o.roomNumber ? `Hab. ${o.roomNumber}` : ORDER_TYPE_LABELS[o.type]
  return ORDER_TYPE_LABELS[o.type] || 'Para llevar'
}

// ─── Cronómetro y alerta de demora (#211) ───
const { now } = useNow(1000)

/** Arranque del cronómetro: el envío más viejo entre las líneas del ticket (una línea re-enviada no lo reinicia); sin `sentAt`, la apertura. */
function ticketSentAt(t: KdsTicket): number {
  const stamps = t.lines.map((l) => (l.sentAt ? new Date(l.sentAt).getTime() : NaN)).filter((n) => Number.isFinite(n))
  if (stamps.length) return Math.min(...stamps)
  const opened = t.order.openedAt ? new Date(t.order.openedAt).getTime() : NaN
  return Number.isFinite(opened) ? opened : now.value
}
function elapsedMs(t: KdsTicket): number { return Math.max(0, now.value - ticketSentAt(t)) }
function elapsedLabel(t: KdsTicket): string {
  const s = Math.floor(elapsedMs(t) / 1000)
  const m = Math.floor(s / 60)
  if (m >= 600) return `${Math.floor(m / 60)} h`   // una comanda de prueba olvidada no necesita "982:28"
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
/** Umbral del ticket: el más exigente entre las estaciones de sus líneas (en "Todas" conviven varias). */
function alertMinutesFor(t: KdsTicket): number {
  const mins = t.lines.map((l) => stations.value.find((s) => s.id === l.stationId)?.alertMinutes ?? DEFAULT_ALERT_MINUTES)
  return mins.length ? Math.min(...mins) : DEFAULT_ALERT_MINUTES
}
type Delay = 'ok' | 'warn' | 'late'
function delayLevel(t: KdsTicket): Delay {
  const min = elapsedMs(t) / 60_000
  const n = alertMinutesFor(t)
  if (min >= 2 * n) return 'late'
  if (min >= n) return 'warn'
  return 'ok'
}
const DELAY_HEADER: Record<Delay, string> = {
  ok: 'bg-navy text-white',
  warn: 'bg-warning text-white',
  late: 'bg-danger text-white animate-pulse',
}
const DELAY_BORDER: Record<Delay, string> = {
  ok: 'border-border',
  warn: 'border-warning',
  late: 'border-danger',
}

// ─── Sonido al entrar un ticket (#211) ───
const SOUND_KEY = 'kds:sound'
const soundOn = ref(localStorage.getItem(SOUND_KEY) !== 'off')
let audioCtx: AudioContext | null = null
function toggleSound() {
  soundOn.value = !soundOn.value
  localStorage.setItem(SOUND_KEY, soundOn.value ? 'on' : 'off')
  // El toque del usuario habilita el audio (los navegadores bloquean AudioContext sin gesto previo).
  if (soundOn.value) { ensureAudio(); beep() }
}
function ensureAudio(): AudioContext | null {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
  } catch { return null }
}
/** Dos tonos cortos (≈0,3 s). Sin archivo de audio: nada que cachear ni que falle por 404. */
function beep() {
  if (!soundOn.value) return
  const ctx = ensureAudio()
  if (!ctx) return
  try {
    for (const [freq, at] of [[880, 0], [1175, 0.15]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      gain.gain.value = 0.12
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + 0.12)
    }
  } catch { /* sin audio no se rompe la cocina */ }
}
/** ¿El evento toca la pantalla que se está mirando? ('' = todas · '__none__' = líneas sin estación) */
function concernsThisStation(stationIds: string[] | undefined): boolean {
  if (station.value === '') return true
  if (!stationIds?.length) return true
  if (station.value === '__none__') return stationIds.includes('')
  return stationIds.includes(station.value)
}

// ─── Datos + canal en vivo (#211) ───
// Ids de comandas que ya estaban en la cola: un id nuevo en un refresco = ticket que acaba de entrar.
// Es lo que hace sonar el KDS cuando NO hay stream (polling de respaldo): el `order.sent` en vivo ya
// suena solo, y refresca la cola antes del siguiente polling, así que el mismo ticket no suena dos veces.
let knownOrderIds: Set<string> | null = null
async function refresh(showSpinner = false) {
  if (showSpinner) loading.value = true
  refreshing.value = true
  try {
    const next = await RestaurantService.kdsQueue(station.value || undefined)
    const ids = new Set(next.map((t) => t.order.id))
    // Primera carga o cambio de estación (spinner): la cola entera es "nueva" y no debe sonar.
    const arrived = knownOrderIds && !showSpinner ? next.some((t) => !knownOrderIds!.has(t.order.id)) : false
    knownOrderIds = ids
    tickets.value = next
    if (arrived && live.state.value !== 'live') beep()
  } catch (e: unknown) {
    if (showSpinner) toast.error(e instanceof Error ? e.message : 'No se pudo cargar la cocina')
  } finally {
    if (showSpinner) loading.value = false
    refreshing.value = false
  }
}

// Varios eventos seguidos (una comanda de 5 líneas que cocina marca una tras otra) → un solo refresco.
let refreshTimer: ReturnType<typeof setTimeout> | null = null
function refreshSoon() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(false) }, 150)
}
function onLiveEvent(e: RestaurantEvent) {
  if (e.type === 'order.sent' && concernsThisStation(e.stationIds)) beep()
  refreshSoon()
}
const live = useRestaurantEvents({ onEvent: onLiveEvent, onPoll: () => refresh(false), pollMs: REFRESH_MS })
const liveLabel = computed(() => ({ idle: 'Sin conexión', connecting: 'Conectando…', live: 'En vivo', reconnecting: 'Reconectando…' }[live.state.value]))
const liveDot = computed(() => ({ idle: 'bg-text-muted', connecting: 'bg-text-muted animate-pulse', live: 'bg-success', reconnecting: 'bg-warning animate-pulse' }[live.state.value]))

async function selectStation(id: string) {
  station.value = id
  await refresh(true)
}

async function advance(line: OrderLine, to: LineStatus) {
  if (!editPerm.value || busyLine.value) return
  busyLine.value = line.id
  try {
    await RestaurantService.setLineStatus(line.id, to)
    await refresh(false)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo actualizar')
  } finally {
    busyLine.value = null
  }
}

// #216 — comanda de cocina en papel (80 mm) POR COMANDA, con la estación que se está mirando ('' = todas,
// agrupada por estación; '__none__' = sin estación). Es una REIMPRESIÓN: va con `batch: 'all'` (todo lo
// enviado); el papel por envío lo imprime Comanda al enviar (autoPrint). Pestaña nueva + window.print().
const printingOrder = ref<string | null>(null)
async function printTicket(t: KdsTicket) {
  if (printingOrder.value) return
  printingOrder.value = t.order.id
  try {
    const r = await openPrintTab(t.order.id, 'kitchen', { station: station.value || undefined, batch: 'all' })
    if (!r.ok) toast.error(r.error)
  } finally { printingOrder.value = null }
}

function hhmm(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

/** F1: modificadores elegidos junto al nombre del plato — la cocina necesita "Grande, sin cebolla". */
function modifiersLabel(l: OrderLine): string {
  const names = (l.modifiers ?? []).map((m) => m.name)
  return names.length ? `(${names.join(', ')})` : ''
}

const clock = computed(() => new Date(now.value).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }))

onMounted(async () => {
  try {
    stations.value = (await RestaurantService.listStations()).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  } catch { /* la cola funciona igual sin el catálogo de estaciones */ }
  try {
    voidReasons.value = (await RestaurantService.voidReasons()).reasons
  } catch { /* sin lista del hotel, el modal muestra solo "Otro" (texto libre) */ }
  await refresh(true)
  live.start()
})
onUnmounted(() => {
  live.stop()
  if (refreshTimer) clearTimeout(refreshTimer)
  void audioCtx?.close()
})
</script>

<template>
  <div :class="['space-y-4', kiosk ? 'kds-kiosk min-h-screen p-4 sm:p-6 bg-[#0b1220] text-white' : '']" data-testid="kds-board">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div>
          <h1 :class="['font-black', kiosk ? 'text-2xl sm:text-3xl text-white' : 'text-xl sm:text-2xl text-navy']">Cocina y Bar — KDS</h1>
          <p :class="['text-sm mt-0.5', kiosk ? 'text-white/60' : 'text-text-muted']">Arrastrá cada plato a la columna siguiente o tocá el botón. Se actualiza solo.</p>
        </div>
        <span v-if="kiosk" class="font-mono font-black text-3xl tabular-nums text-white/90 ml-2" aria-label="Hora">{{ clock }}</span>
      </div>
      <div class="flex items-center gap-2">
        <!-- #211: estado del canal en vivo. Reconectando = el KDS sigue con polling cada 15 s. -->
        <span data-testid="kds-live" :class="['inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold', kiosk ? 'bg-white/10 text-white' : 'bg-surface text-navy']" :title="live.state.value === 'live' ? 'Conectado al canal en vivo' : 'Sin canal en vivo: se actualiza cada 15 s'">
          <span :class="['w-2 h-2 rounded-full', liveDot]" />
          {{ liveLabel }}
        </span>
        <button @click="toggleSound" :aria-pressed="soundOn" :title="soundOn ? 'Silenciar el aviso de comanda nueva' : 'Activar el aviso de comanda nueva'"
          :class="['min-h-11 px-3 py-1.5 rounded-lg border-2 text-xs font-bold', kiosk ? 'border-white/30 text-white hover:bg-white/10' : soundOn ? 'border-navy/30 text-navy hover:bg-surface' : 'border-border text-text-muted hover:bg-surface']">
          {{ soundOn ? '🔔 Sonido' : '🔕 Silencio' }}
        </button>
        <button @click="refresh(true)" :disabled="refreshing" :class="['min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 text-xs font-bold disabled:opacity-60', kiosk ? 'border-white/30 text-white hover:bg-white/10' : 'border-navy/30 text-navy hover:bg-surface']">
          <span v-if="refreshing" class="w-3 h-3 rounded-full border-2 border-current/30 border-t-current animate-spin" aria-hidden="true" />
          {{ refreshing ? 'Actualizando…' : 'Actualizar' }}
        </button>
        <!-- Pantalla de la cocina: sin sidebar ni cabecera del panel. Desde el kiosco se vuelve al panel. -->
        <router-link v-if="!kiosk" to="/panel/kds" data-testid="kds-kiosk-link" class="min-h-11 inline-flex items-center px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:opacity-90" title="Abrir el tablero a pantalla completa, para la pantalla de la cocina">⛶ Pantalla de cocina</router-link>
        <router-link v-else to="/panel/restaurante/cocina" class="min-h-11 inline-flex items-center px-3 py-1.5 rounded-lg border-2 border-white/30 text-white text-xs font-bold hover:bg-white/10">← Volver al panel</router-link>
      </div>
    </header>

    <!-- Selector de estación -->
    <div class="flex flex-wrap gap-1.5">
      <button @click="selectStation('')" :class="['min-h-11 px-4 py-1.5 rounded-full text-sm font-bold', station === '' ? (kiosk ? 'bg-white text-[#0b1220]' : 'bg-navy text-white') : (kiosk ? 'bg-white/10 text-white/70' : 'bg-surface text-text-muted')]">Todas</button>
      <button v-for="s in stations" :key="s.id" @click="selectStation(s.id)" :class="['min-h-11 px-4 py-1.5 rounded-full text-sm font-bold', station === s.id ? (kiosk ? 'bg-white text-[#0b1220]' : 'bg-navy text-white') : (kiosk ? 'bg-white/10 text-white/70' : 'bg-surface text-text-muted')]">{{ s.name }}</button>
      <button @click="selectStation('__none__')" :class="['min-h-11 px-4 py-1.5 rounded-full text-sm font-bold', station === '__none__' ? (kiosk ? 'bg-white text-[#0b1220]' : 'bg-navy text-white') : (kiosk ? 'bg-white/10 text-white/70' : 'bg-surface text-text-muted')]">Sin estación</button>
    </div>
    <!-- Esta pantalla es genérica: cada estación (Cocina, Bar, etc.) es una pestaña de arriba. -->
    <p v-if="editPerm && !kiosk" class="text-xs text-text-muted -mt-2">
      ¿No ves la estación que buscás (ej. Bar)? Creála en <router-link :to="{ path: '/panel/restaurante/carta', query: { tab: 'stations' } }" class="font-bold text-navy hover:underline">Carta → Estaciones</router-link>.
      El umbral de demora (ámbar/rojo) también se configura ahí, por estación. La receta de cada plato se carga en Carta → ítem → Receta.
    </p>

    <div v-if="loading" :class="['py-20 text-center', kiosk ? 'text-white/60' : 'text-text-muted']">Cargando…</div>
    <EmptyState v-else-if="!cards.length" title="Nada en cola" message="Cuando entren comandas a esta estación, aparecen acá." />

    <!-- Tablero: 3 columnas, una tarjeta por plato. -->
    <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-3 items-start" data-testid="kds-columns">
      <section v-for="col in COLUMNS" :key="col.status"
        :class="['rounded-2xl border-2 p-2 min-h-[40vh] flex flex-col gap-2 transition-colors', kiosk ? 'bg-white/5 border-white/10' : 'bg-surface/60 ' + col.accent, dragOver === col.status ? (kiosk ? 'ring-2 ring-white/60' : 'ring-2 ring-gold') : '']"
        :data-column="col.status" :aria-label="col.label"
        @dragover="onDragOver($event, col.status)" @dragleave="dragOver === col.status && (dragOver = null)" @drop="onDrop($event, col.status)">
        <header class="flex items-center justify-between px-1.5 pt-1">
          <div>
            <h2 :class="['font-black text-sm uppercase tracking-wide', kiosk ? 'text-white' : 'text-navy']">{{ col.label }}</h2>
            <p :class="['text-[11px]', kiosk ? 'text-white/50' : 'text-text-muted']">{{ col.hint }}</p>
          </div>
          <span :class="['min-w-7 h-7 grid place-items-center rounded-full text-xs font-black px-2', kiosk ? 'bg-white/15 text-white' : 'bg-navy/10 text-navy']" data-testid="kds-column-count">{{ cardsOf(col.status).length }}</span>
        </header>

        <p v-if="!cardsOf(col.status).length" :class="['text-xs text-center py-6', kiosk ? 'text-white/40' : 'text-text-muted']">—</p>

        <article v-for="c in cardsOf(col.status)" :key="c.line.id"
          :draggable="editPerm" @dragstart="onDragStart($event, c)" @dragend="onDragEnd"
          :class="['rounded-2xl border-2 bg-white text-navy overflow-hidden flex flex-col select-none', DELAY_BORDER[delayLevel(c.ticket)], dragging === c.line.id ? 'opacity-50' : '', editPerm ? 'cursor-grab active:cursor-grabbing' : '']"
          :data-delay="delayLevel(c.ticket)" :data-line="c.line.id" data-testid="kds-card">
          <!-- Cabecera: dónde va, comanda, cronómetro, imprimir. -->
          <div :class="['px-3 py-2 flex items-center justify-between gap-2', DELAY_HEADER[delayLevel(c.ticket)]]">
            <div class="min-w-0">
              <div class="font-black text-sm truncate">{{ placeLabel(c.ticket) }}</div>
              <div class="text-[11px] opacity-80 truncate">{{ c.ticket.order.number || 'Comanda' }} · {{ ORDER_TYPE_LABELS[c.ticket.order.type] }} · {{ hhmm(c.ticket.order.openedAt) }}</div>
            </div>
            <div class="shrink-0 flex items-center gap-1.5">
              <!-- #211: cronómetro desde el envío a cocina; ámbar a N min, rojo a 2N (N por estación). -->
              <span class="font-mono font-black text-base tabular-nums" :title="`Umbral: ${alertMinutesFor(c.ticket)} min`">{{ elapsedLabel(c.ticket) }}</span>
              <!-- #216: comanda en papel para esta estación. -->
              <button type="button" @click="printTicket(c.ticket)" :disabled="printingOrder === c.ticket.order.id" data-testid="print-kitchen"
                :aria-label="`Imprimir comanda ${c.ticket.order.number || ''}`" title="Imprimir comanda de cocina"
                class="h-7 w-7 grid place-items-center rounded-lg bg-white/15 hover:bg-white/30 text-sm disabled:opacity-50">🖨</button>
            </div>
          </div>

          <div class="p-3 space-y-2 flex-1">
            <!-- El plato -->
            <div :class="['font-black leading-tight', kiosk ? 'text-xl' : 'text-lg']">
              {{ c.line.quantity }}× {{ c.line.name }}
              <span v-if="modifiersLabel(c.line)" class="font-semibold text-sm text-text-muted">{{ modifiersLabel(c.line) }}</span>
            </div>
            <div v-if="c.line.notes" class="text-xs text-gold font-bold">⚑ {{ c.line.notes }}</div>

            <!-- Receta del plato: quitar / doble / agregar. Los cambios se ven siempre; la lista se despliega. -->
            <LineIngredientsEditor :line="c.line" :ingredients="c.line.ingredients ?? []" :editable="editPerm" :size="kiosk ? 'md' : 'sm'" @updated="onLineUpdated(c, $event)" />

            <!-- #282 (M2): el KDS se usa con el dedo en una tablet — botones de ≥44 px de alto. -->
            <div v-if="editPerm || (deletePerm && VOIDABLE.includes(c.line.status))" class="flex flex-wrap gap-2 pt-1">
              <button v-if="editPerm" @click="advance(c.line, NEXT[col.status].to)" :disabled="busyLine === c.line.id" data-testid="kds-advance"
                :class="['flex-1 min-h-11 px-4 py-2 rounded-lg text-sm font-black disabled:opacity-50', NEXT[col.status].cls]">{{ NEXT[col.status].label }}</button>
              <!-- #207: abre el modal de motivo; no anula hasta confirmar. -->
              <button v-if="deletePerm && VOIDABLE.includes(c.line.status)" @click="openVoid(c.line, c.ticket.order.id)" :disabled="busyLine === c.line.id" data-testid="kds-void"
                class="min-h-11 px-4 py-2 rounded-lg text-sm font-bold border-2 border-coral/40 text-coral disabled:opacity-50">Anular</button>
            </div>
          </div>
        </article>
      </section>
    </div>

    <VoidReasonModal v-if="voidTarget" title="Cancelar plato"
      :subtitle="`${voidTarget.line.quantity}× ${voidTarget.line.name}`"
      :reasons="voidReasons.length ? voidReasons : ['Otro']" confirm-label="Anular plato" :loading="voidBusy"
      @confirm="confirmVoid" @close="closeVoid" />
  </div>
</template>

<style scoped>
/* En kiosco la página ocupa toda la ventana: el layout 'none' no pone fondo. */
.kds-kiosk { margin: 0; }
</style>
