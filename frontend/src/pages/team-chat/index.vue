<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between gap-3 mb-6 flex-wrap">
      <div class="flex items-center gap-2.5">
        <h2 class="text-xl font-black text-navy">Chats del equipo</h2>
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
          :class="live ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-surface text-text-muted border border-border'"
          :title="live ? 'Se actualiza solo cada 30 segundos mientras la pestaña esté visible' : 'Pausado: la pestaña no está visible'"
        >
          <span class="relative flex h-1.5 w-1.5">
            <span v-if="live" class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full" :class="live ? 'bg-[#22C55E]' : 'bg-text-muted'"></span>
          </span>
          {{ live ? 'En vivo' : 'Pausado' }}
        </span>
        <span v-if="lastSyncLabel" class="text-[11px] text-text-muted">Actualizado {{ lastSyncLabel }}</span>
      </div>
      <button
        @click="load"
        :disabled="loading"
        class="flex items-center gap-1.5 bg-white text-text-secondary border border-border font-bold text-sm px-4 py-2 rounded-full hover:border-navy/30 hover:text-navy transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span class="w-4 h-4 shrink-0" :class="loading ? 'animate-spin' : ''" v-html="ICON_REFRESH"></span>
        Refrescar
      </button>
    </div>

    <!-- Layout dos columnas -->
    <div class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      <!-- Lista de conversaciones -->
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) overflow-hidden flex flex-col max-h-[70vh] lg:max-h-[calc(100vh-220px)]">
        <div class="px-4 py-3 border-b border-border shrink-0">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-bold text-text-muted uppercase tracking-wide">Conversaciones</span>
            <span class="bg-surface px-2 py-0.5 rounded-full text-[10px] font-bold text-text-muted border border-border">{{ filteredConversations.length }}</span>
          </div>
          <div class="relative">
            <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/50" v-html="ICON_SEARCH"></span>
            <input
              v-model="search"
              type="text"
              placeholder="Buscar persona o último mensaje..."
              aria-label="Buscar conversación"
              class="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-navy placeholder:text-text-muted/60 focus:outline-none focus:border-navy"
            >
          </div>
        </div>

        <!-- Loading -->
        <div v-if="loading && conversations.length === 0" class="flex items-center justify-center py-12 text-text-muted text-sm gap-2">
          <span class="w-4 h-4 animate-spin" v-html="ICON_REFRESH"></span>
          Cargando...
        </div>

        <!-- Empty -->
        <div v-else-if="conversations.length === 0" class="flex flex-col items-center justify-center py-16 px-6 text-center">
          <span class="w-10 h-10 mb-3 text-text-muted opacity-40" v-html="ICON_CHAT"></span>
          <p class="text-sm font-bold text-navy">Todavía no hay conversaciones</p>
          <p class="text-xs text-text-muted mt-1">Cuando el equipo se escriba, vas a verlo acá.</p>
        </div>

        <!-- Filtro sin resultados -->
        <div v-else-if="filteredConversations.length === 0" class="flex flex-col items-center justify-center py-16 px-6 text-center">
          <span class="w-10 h-10 mb-3 text-text-muted opacity-40" v-html="ICON_SEARCH"></span>
          <p class="text-sm font-bold text-navy">Sin conversaciones con este filtro</p>
          <button @click="search = ''" class="mt-2 text-xs font-bold text-navy underline cursor-pointer">Ver todas</button>
        </div>

        <!-- Lista -->
        <div v-else class="overflow-y-auto flex-1">
          <button
            v-for="conv in filteredConversations"
            :key="conv.key"
            @click="selectConversation(conv.key)"
            class="w-full text-left px-4 py-3 border-b border-border last:border-0 flex items-start gap-3 transition-colors cursor-pointer"
            :class="selectedKey === conv.key ? 'bg-navy/5' : 'hover:bg-surface/60'"
          >
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
              :class="conv.isTeam ? 'bg-cyan' : avatarColor(conv.key)"
            >
              <span v-if="conv.isTeam" class="w-5 h-5" v-html="ICON_TEAM"></span>
              <span v-else>{{ conv.initials }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-bold text-navy truncate">{{ conv.title }}</span>
                <span class="text-[10px] text-text-muted shrink-0">{{ formatTime(conv.lastMessage.createdAt) }}</span>
              </div>
              <p class="text-xs text-text-secondary truncate mt-0.5">
                <span class="font-semibold text-text-muted">{{ senderName(conv.lastMessage.fromUserId) }}:</span>
                {{ preview(conv.lastMessage) }}
              </p>
            </div>
          </button>
          <!-- Sentinel: al entrar en viewport dispara la carga de la página anterior -->
          <div v-if="hasMore || loadingMore" ref="sentinel" class="py-3 flex items-center justify-center gap-2 text-[11px] text-text-muted">
            <span v-if="loadingMore" class="w-3 h-3 animate-spin" v-html="ICON_REFRESH"></span>
            {{ loadingMore ? 'Cargando más…' : 'Deslizá para ver mensajes anteriores' }}
          </div>
        </div>
      </div>

      <!-- Hilo -->
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) overflow-hidden flex flex-col max-h-[70vh] lg:max-h-[calc(100vh-220px)] min-h-[400px]">
        <!-- Sin selección -->
        <div v-if="!selectedConversation" class="flex flex-col items-center justify-center flex-1 px-6 text-center">
          <span class="w-12 h-12 mb-3 text-text-muted opacity-30" v-html="ICON_CHAT"></span>
          <p class="text-sm font-bold text-navy">Elegí una conversación</p>
          <p class="text-xs text-text-muted mt-1">Seleccioná un chat de la izquierda para ver los mensajes.</p>
        </div>

        <template v-else>
          <!-- Header del hilo -->
          <div class="px-5 py-3.5 border-b border-border shrink-0 flex items-center gap-3">
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-bold"
              :class="selectedConversation.isTeam ? 'bg-cyan' : avatarColor(selectedConversation.key)"
            >
              <span v-if="selectedConversation.isTeam" class="w-[18px] h-[18px]" v-html="ICON_TEAM"></span>
              <span v-else>{{ selectedConversation.initials }}</span>
            </div>
            <div class="min-w-0">
              <div class="text-sm font-black text-navy truncate">{{ selectedConversation.title }}</div>
              <div class="text-[11px] text-text-muted">
                {{ selectedConversation.messages.length }} mensaje{{ selectedConversation.messages.length === 1 ? '' : 's' }}{{ capped ? ' · historial recortado' : '' }}
              </div>
            </div>
          </div>

          <!-- Mensajes: el scroll arranca y se mantiene abajo (lo último es lo relevante en un monitor) -->
          <div ref="threadEl" class="overflow-y-auto flex-1 px-5 py-5 bg-surface/40 space-y-4">
            <template v-for="(msg, i) in selectedConversation.messages" :key="msg.id">
              <!-- Divisor de fecha entre mensajes de días distintos -->
              <div v-if="dayDivider(selectedConversation.messages[i - 1]?.createdAt, msg.createdAt)" class="flex items-center gap-3 pt-1">
                <span class="flex-1 h-px bg-border"></span>
                <span class="text-[10px] font-bold text-text-muted bg-white border border-border rounded-full px-2.5 py-0.5">{{ dayLabel(msg.createdAt) }}</span>
                <span class="flex-1 h-px bg-border"></span>
              </div>
              <div class="flex items-start gap-2.5">
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold mt-0.5"
                  :class="avatarColor(msg.fromUserId)"
                >
                  {{ initialsOf(senderName(msg.fromUserId)) }}
                </div>
                <div class="min-w-0 max-w-[80%]">
                  <div class="flex items-baseline gap-2 mb-1">
                    <span class="text-xs font-bold text-navy">{{ senderName(msg.fromUserId) }}</span>
                    <span class="text-[10px] text-text-muted">{{ formatTime(msg.createdAt) }}</span>
                  </div>
                  <div class="bg-white border border-border rounded-2xl rounded-tl-md px-3.5 py-2.5 shadow-(--shadow-card)">
                    <img
                      v-if="msg.photoUrl && !failedPhotos.has(msg.photoUrl)"
                      :src="msg.photoUrl"
                      :alt="`Foto enviada por ${senderName(msg.fromUserId)}`"
                      class="max-w-[220px] w-full rounded-xl border border-border mb-1.5 last:mb-0"
                      @error="failedPhotos.add(msg.photoUrl!)"
                    >
                    <p v-else-if="msg.photoUrl && failedPhotos.has(msg.photoUrl) && !msg.message" class="text-xs text-text-muted italic">📷 Foto no disponible</p>
                    <p v-if="msg.message" class="text-sm text-text-secondary whitespace-pre-wrap break-words">{{ msg.message }}</p>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { TeamChatService, type MessageDTO } from '@/services/TeamChat.service'
import { TeamService } from '@/services/Team.service'
import { useToast } from '@/composables/useToast'

const ICON_REFRESH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'
const ICON_CHAT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.9 7.9 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>'
const ICON_TEAM = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4 0m8-4a3 3 0 11-2.5 1.34M7 8a3 3 0 10-2.5 1.34"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>'

const toast = useToast()

const PAGE_SIZE = 200
// #635: sin tope, `messages.value` crecía sin límite con scroll prolongado (y el `computed`
// de conversaciones reagrupa todo el array en cada cambio). Cap generoso — cubre semanas de
// actividad de un equipo real sin recortar la sesión de scroll típica.
const MAX_LOADED_MESSAGES = 1000
// El badge "En vivo" promete actualización automática: polling liviano que solo corre con
// la pestaña visible. No hay cliente WebSocket en el frontend (los "sockets" del módulo son
// hooks de conectores backend), así que sondear la primera página y deduplicar es lo
// consistente con la arquitectura — sin infra nueva para un monitor de solo lectura.
const POLL_MS = 30_000
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const loadedCount = ref(0)
const messages = ref<MessageDTO[]>([])
const userNames = ref<Map<string, string>>(new Map())
const selectedKey = ref<string | null>(null)
const search = ref('')
const lastSync = ref<Date | null>(null)
// Si el cap de memoria recortó historial, los contadores no pueden prometer el total real.
const capped = ref(false)
// URLs de foto que no cargaron (404 de uploads viejos): se degradan a placeholder, sin mutar el DTO.
const failedPhotos = ref<Set<string>>(new Set())
// Sentinel al fondo de la lista: cuando entra en viewport, se autocarga la
// siguiente página de mensajes más viejos (scroll infinito).
const sentinel = ref<HTMLElement | null>(null)
// Contenedor scrolleable del hilo abierto — para arrancar y quedarse abajo.
const threadEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

const TEAM_KEY = 'team'

interface Conversation {
  key: string
  isTeam: boolean
  title: string
  initials: string
  messages: MessageDTO[]
  lastMessage: MessageDTO
}

function senderName(userId: string): string {
  return userNames.value.get(userId) || 'Usuario'
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase() || '?'
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const AVATAR_COLORS = ['bg-navy', 'bg-purple', 'bg-teal', 'bg-coral', 'bg-gold', 'bg-blue']
function avatarColor(seed: string): string {
  const idx = (seed || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

function preview(msg: MessageDTO): string {
  if (msg.message) return msg.message
  if (msg.photoUrl) return '📷 Foto'
  return ''
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hhmm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return hhmm
  const sameYear = d.getFullYear() === now.getFullYear()
  return `${d.getDate()}/${d.getMonth() + 1}${sameYear ? '' : `/${d.getFullYear()}`} ${hhmm}`
}

/** ¿Hay que pintar divisor antes de este mensaje? Solo si cambia el día respecto al anterior. */
function dayDivider(prevIso: string | undefined, iso: string): boolean {
  if (!prevIso) return true
  const prev = new Date(prevIso)
  const cur = new Date(iso)
  if (Number.isNaN(prev.getTime()) || Number.isNaN(cur.getTime())) return false
  return prev.toDateString() !== cur.toDateString()
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Hoy'
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear ? `${d.getDate()}/${d.getMonth() + 1}` : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

// `document.hidden` no es reactivo: sin este ref, el badge no cambiaría al ocultar la pestaña.
const visible = ref(typeof document === 'undefined' ? true : !document.hidden)
const live = computed(() => pollTimer !== null && visible.value)
const lastSyncLabel = computed(() => {
  if (!lastSync.value) return ''
  return `${String(lastSync.value.getHours()).padStart(2, '0')}:${String(lastSync.value.getMinutes()).padStart(2, '0')}:${String(lastSync.value.getSeconds()).padStart(2, '0')}`
})

const conversations = computed<Conversation[]>(() => {
  const groups = new Map<string, MessageDTO[]>()
  for (const msg of messages.value) {
    const key = (msg.toUserId || '').startsWith('team:')
      ? TEAM_KEY
      : [msg.fromUserId, msg.toUserId].sort().join('|')
    const list = groups.get(key)
    if (list) list.push(msg)
    else groups.set(key, [msg])
  }

  const result: Conversation[] = []
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const lastMessage = sorted[sorted.length - 1]
    const isTeam = key === TEAM_KEY
    let title: string
    let initials: string
    if (isTeam) {
      title = 'Equipo del hotel'
      initials = ''
    } else {
      const [a, b] = key.split('|')
      const nameA = senderName(a)
      const nameB = senderName(b)
      title = `${nameA} y ${nameB}`
      initials = initialsOf(nameA)
    }
    result.push({ key, isTeam, title, initials, messages: sorted, lastMessage })
  }

  result.sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime())
  return result
})

const filteredConversations = computed<Conversation[]>(() => {
  const q = norm(search.value.trim())
  if (!q) return conversations.value
  return conversations.value.filter(c =>
    norm(c.title).includes(q) || norm(preview(c.lastMessage)).includes(q),
  )
})

const selectedConversation = computed<Conversation | null>(() =>
  conversations.value.find(c => c.key === selectedKey.value) ?? null,
)

async function loadNames() {
  try {
    // Los que chatean son USUARIOS del hotel (tabla users), no perfiles de RRHH:
    // `/usuarios` devuelve id → name y esos ids son los que traen los mensajes.
    // (employee-profiles es otra cosa y sus ids no coinciden con los del chat.)
    const res = await TeamService.list()
    const list = Array.isArray(res) ? res : (res?.data ?? [])
    const map = new Map<string, string>()
    for (const u of list) {
      if (u.id && u.name) map.set(u.id, u.name)
    }
    userNames.value = map
  } catch {
    /* silent — sin nombres, se muestra "Usuario" */
  }
}

async function load() {
  loading.value = true
  try {
    const [page] = await Promise.all([TeamChatService.listAll(0, PAGE_SIZE), loadNames()])
    messages.value = page.data
    loadedCount.value = page.data.length
    hasMore.value = page.hasMore
    capped.value = false
    lastSync.value = new Date()
  } catch {
    toast.error('No se pudieron cargar los chats del equipo')
    messages.value = []
    hasMore.value = false
  } finally {
    loading.value = false
  }
}

/**
 * Sondeo del "En vivo": re-pide la primera página (la más reciente) y suma SOLO los
 * mensajes nuevos al principio, sin duplicar. Con offset-paging no hay forma de pedir
 * "desde createdAt > X", así que se re-transfiere la página y se deduplica por id —
 * en la práctica de un hotel nadie escribe 200 mensajes en 30 segundos; si un pico
 * real superara la página, el Refrescar manual lo cubre.
 */
async function pollNew() {
  if (loading.value || loadingMore.value || document.hidden) return
  try {
    const page = await TeamChatService.listAll(0, PAGE_SIZE)
    const seen = new Set(messages.value.map(m => m.id))
    const fresh = page.data.filter(m => !seen.has(m.id))
    if (fresh.length === 0) {
      lastSync.value = new Date()
      return
    }
    // El array es DESC (recientes primero): los nuevos van al principio. El cap recorta
    // del final (los más viejos), igual que en loadMore.
    const combined = [...fresh, ...messages.value]
    if (combined.length > MAX_LOADED_MESSAGES) {
      messages.value = combined.slice(0, MAX_LOADED_MESSAGES)
      capped.value = true
      hasMore.value = false
    } else {
      messages.value = combined
    }
    loadedCount.value += fresh.length
    lastSync.value = new Date()
  } catch {
    /* silencioso: el polling no spamea toasts; el próximo ciclo reintenta */
  }
}

/** Trae la siguiente página de mensajes más viejos y los suma sin duplicar. */
async function loadMore() {
  if (loadingMore.value || loading.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const page = await TeamChatService.listAll(loadedCount.value, PAGE_SIZE)
    const seen = new Set(messages.value.map((m) => m.id))
    const fresh = page.data.filter((m) => !seen.has(m.id))
    const combined = [...messages.value, ...fresh]
    // Tope de memoria (#635): recorta los más viejos (van al final del array) si se pasa del
    // límite. Deja de ofrecer "cargar más" una vez alcanzado — evitar crecer indefinidamente
    // en una sesión de scroll muy larga importa más que ver el historial completo de una.
    if (combined.length > MAX_LOADED_MESSAGES) {
      messages.value = combined.slice(0, MAX_LOADED_MESSAGES)
      capped.value = true
      hasMore.value = false
    } else {
      messages.value = combined
      hasMore.value = page.hasMore
    }
    loadedCount.value += page.data.length
  } catch {
    /* se reintenta al próximo scroll: hasMore queda como estaba */
  } finally {
    loadingMore.value = false
  }
}

// ── Scroll del hilo ────────────────────────────────────────────────────────
// Un monitor de chat se lee de abajo hacia arriba: al abrir un hilo se saltea al
// último mensaje, y si ya estás abajo, los mensajes nuevos del polling te siguen
// (stick-to-bottom). Si subiste a leer historial, el scroll NO se secuestra.
function isThreadAtBottom(): boolean {
  const el = threadEl.value
  if (!el) return true
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 40
}

function scrollThreadToBottom() {
  const el = threadEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function selectConversation(key: string) {
  selectedKey.value = key
  void nextTick(scrollThreadToBottom)
}

// Mensajes nuevos (polling) con el hilo abierto y pegado al fondo → seguir abajo.
watch(() => selectedConversation.value?.messages.length, (_n, _o) => {
  if (selectedKey.value && isThreadAtBottom()) void nextTick(scrollThreadToBottom)
})

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => { if (entries[0]?.isIntersecting) loadMore() },
    { rootMargin: '150px' },
  )
  pollTimer = setInterval(pollNew, POLL_MS)
  document.addEventListener('visibilitychange', onVisibilityChange)
  load()
})

// El sentinel aparece/desaparece con `hasMore`: re-observar cuando se monta.
watch(sentinel, (el) => {
  observer?.disconnect()
  if (el && observer) observer.observe(el)
})

// Al volver a la pestaña: refresco inmediato si el interval corrió oculto, y el
// badge re-enciende (document.hidden no es reactivo por sí solo).
function onVisibilityChange() {
  visible.value = !document.hidden
  if (visible.value && lastSync.value && Date.now() - lastSync.value.getTime() > POLL_MS) {
    pollNew()
  }
}

onUnmounted(() => {
  observer?.disconnect()
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>
