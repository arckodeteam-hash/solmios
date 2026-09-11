<script setup lang="ts">
// pages/restaurante/cocina.vue — Pantalla de cocina (KDS, RES-7). Cola de líneas activas por estación,
// FIFO. Cada línea avanza new→preparing→ready→served. Pensada para tablet: botones grandes.
// #211: se actualiza por el canal en vivo (SSE, useRestaurantEvents) — una comanda enviada desde otra
// tablet aparece en ≤2 s; si el stream cae, el composable hace polling cada 15 s y avisa
// "Reconectando…". Cada ticket dice dónde va ("Terraza · Mesa 3" / "Hab. 204" / "Para llevar"), lleva
// cronómetro desde el envío a cocina (`sentAt`, #210) y se pinta ámbar a los N min y rojo a los 2N,
// con N configurable por estación (Carta → Estaciones, default 10). Suena al entrar un ticket de la
// estación que se está mirando (toggle recordado en localStorage).
// #207: "Cancelar" NO es una transición de un toque — abre un modal de motivo (VoidReasonModal) y
// recién al confirmar anula la línea (voidLine, con auditoría). Cerrar el modal no cambia nada.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  RestaurantService,
  type Station, type KdsTicket, type OrderLine, type LineStatus, type RestaurantEvent,
  ORDER_TYPE_LABELS, DEFAULT_ALERT_MINUTES,
} from '@/services/Restaurant.service'
import EmptyState from '@/components/ui/EmptyState.vue'
import VoidReasonModal from '@/components/features/restaurante/VoidReasonModal.vue'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'
import { useNow } from '@/composables/useNow'
import { useRestaurantEvents } from '@/composables/useRestaurantEvents'

const toast = useToast()
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

// Siguiente transición por estado de línea (KDS solo avanza; served/voided ya salen de la cola).
const NEXT: Partial<Record<LineStatus, { to: LineStatus; label: string; cls: string }[]>> = {
  new: [{ to: 'preparing', label: 'Preparar', cls: 'bg-navy text-white' }],
  preparing: [{ to: 'ready', label: 'Lista', cls: 'bg-gold text-white' }],
  ready: [{ to: 'served', label: 'Servida', cls: 'bg-teal text-white' }],
}
// Estados desde los que cocina puede anular (una vez lista, la decisión es del salón/comanda).
const VOIDABLE: LineStatus[] = ['new', 'preparing']

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

const lineTint: Record<string, string> = {
  new: 'border-navy/30', preparing: 'border-navy', ready: 'border-gold',
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
async function refresh(showSpinner = false) {
  if (showSpinner) loading.value = true
  refreshing.value = true
  try {
    tickets.value = await RestaurantService.kdsQueue(station.value || undefined)
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
  <div class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-navy">Cocina y Bar — KDS</h1>
        <p class="text-sm text-text-muted mt-0.5">Comandas activas, orden de llegada. Se actualiza sola.</p>
      </div>
      <div class="flex items-center gap-2">
        <!-- #211: estado del canal en vivo. Reconectando = el KDS sigue con polling cada 15 s. -->
        <span data-testid="kds-live" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface text-[11px] font-bold text-navy" :title="live.state.value === 'live' ? 'Conectado al canal en vivo' : 'Sin canal en vivo: se actualiza cada 15 s'">
          <span :class="['w-2 h-2 rounded-full', liveDot]" />
          {{ liveLabel }}
        </span>
        <button @click="toggleSound" :aria-pressed="soundOn" :title="soundOn ? 'Silenciar el aviso de comanda nueva' : 'Activar el aviso de comanda nueva'"
          :class="['px-2.5 py-1.5 rounded-lg border-2 text-xs font-bold', soundOn ? 'border-navy/30 text-navy hover:bg-surface' : 'border-border text-text-muted hover:bg-surface']">
          {{ soundOn ? '🔔 Sonido' : '🔕 Silencio' }}
        </button>
        <button @click="refresh(true)" :disabled="refreshing" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-navy/30 text-navy text-xs font-bold hover:bg-surface disabled:opacity-60">
          <span v-if="refreshing" class="w-3 h-3 rounded-full border-2 border-navy/30 border-t-navy animate-spin" aria-hidden="true" />
          {{ refreshing ? 'Actualizando…' : 'Actualizar' }}
        </button>
      </div>
    </header>

    <!-- Selector de estación -->
    <div class="flex flex-wrap gap-1.5">
      <button @click="selectStation('')" :class="['px-3 py-1.5 rounded-full text-xs font-bold', station === '' ? 'bg-navy text-white' : 'bg-surface text-text-muted']">Todas</button>
      <button v-for="s in stations" :key="s.id" @click="selectStation(s.id)" :class="['px-3 py-1.5 rounded-full text-xs font-bold', station === s.id ? 'bg-navy text-white' : 'bg-surface text-text-muted']">{{ s.name }}</button>
      <button @click="selectStation('__none__')" :class="['px-3 py-1.5 rounded-full text-xs font-bold', station === '__none__' ? 'bg-navy text-white' : 'bg-surface text-text-muted']">Sin estación</button>
    </div>
    <!-- Esta pantalla es genérica: cada estación (Cocina, Bar, etc.) es una pestaña de arriba.
         Si falta "Bar" es porque nadie la creó todavía, no porque el sistema no la soporte. -->
    <p v-if="editPerm" class="text-xs text-text-muted -mt-2">
      ¿No ves la estación que buscás (ej. Bar)? Creála en <router-link to="/panel/restaurante/carta" class="font-bold text-navy hover:underline">Carta → Estaciones</router-link>.
      El umbral de demora (ámbar/rojo) también se configura ahí, por estación.
    </p>

    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>
    <EmptyState v-else-if="!tickets.length" title="Nada en cola" message="Cuando entren comandas a esta estación, aparecen acá." />

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      <div v-for="t in tickets" :key="t.order.id" :class="['rounded-2xl border-2 bg-white overflow-hidden flex flex-col', DELAY_BORDER[delayLevel(t)]]" :data-delay="delayLevel(t)">
        <div :class="['px-3 py-2 flex items-center justify-between gap-2', DELAY_HEADER[delayLevel(t)]]">
          <div class="min-w-0">
            <div class="font-black text-sm truncate">{{ placeLabel(t) }}</div>
            <div class="text-[11px] opacity-80 truncate">{{ t.order.number || 'Comanda' }} · {{ ORDER_TYPE_LABELS[t.order.type] }} · {{ hhmm(t.order.openedAt) }}</div>
          </div>
          <!-- #211: cronómetro desde el envío a cocina; ámbar a N min, rojo a 2N (N por estación). -->
          <span class="shrink-0 font-mono font-black text-base tabular-nums" :title="`Umbral: ${alertMinutesFor(t)} min`">{{ elapsedLabel(t) }}</span>
        </div>
        <div class="p-2.5 space-y-2 flex-1">
          <div v-for="l in t.lines" :key="l.id" :class="['rounded-xl border-2 p-2.5', lineTint[l.status] || 'border-border']">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-navy text-sm">{{ l.quantity }}× {{ l.name }} <span v-if="modifiersLabel(l)" class="font-normal text-text-muted">{{ modifiersLabel(l) }}</span></span>
            </div>
            <div v-if="l.notes" class="text-[11px] text-gold font-bold mt-0.5">⚑ {{ l.notes }}</div>
            <div v-if="(editPerm && NEXT[l.status]) || (deletePerm && VOIDABLE.includes(l.status))" class="flex flex-wrap gap-1.5 mt-2">
              <template v-if="editPerm">
                <button v-for="a in NEXT[l.status]" :key="a.to" @click="advance(l, a.to)" :disabled="busyLine === l.id"
                  :class="['px-2.5 py-1 rounded-lg text-xs font-bold disabled:opacity-50', a.cls]">{{ a.label }}</button>
              </template>
              <!-- #207: abre el modal de motivo; no anula hasta confirmar. -->
              <button v-if="deletePerm && VOIDABLE.includes(l.status)" @click="openVoid(l, t.order.id)" :disabled="busyLine === l.id"
                class="px-2.5 py-1 rounded-lg text-xs font-bold border-2 border-coral/40 text-coral disabled:opacity-50">Cancelar</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <VoidReasonModal v-if="voidTarget" title="Cancelar plato"
      :subtitle="`${voidTarget.line.quantity}× ${voidTarget.line.name}`"
      :reasons="voidReasons.length ? voidReasons : ['Otro']" confirm-label="Anular plato" :loading="voidBusy"
      @confirm="confirmVoid" @close="closeVoid" />
  </div>
</template>
