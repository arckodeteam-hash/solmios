<template>
  <div ref="root" class="relative">
    <button @click="toggle" class="relative p-2 rounded-full hover:bg-surface transition-colors cursor-pointer" aria-label="Notificaciones">
      <svg class="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>
      <span v-if="unread > 0" class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 bg-coral text-white text-[9px] font-black rounded-full">
        {{ unread > 99 ? '99+' : unread }}
      </span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-40" @click="open = false"></div>
      <div v-if="open" class="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl z-50 overflow-hidden"
        :style="{ top: bellRect.bottom + 8 + 'px', left: bellRect.right - 384 + 'px' }">
        <!-- Header -->
        <div class="px-4 py-3 border-b border-border/60 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-black text-navy">Notificaciones</h3>
            <span v-if="unread > 0" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-coral/10 text-coral">{{ unread }} nuevas</span>
          </div>
          <div class="flex gap-1">
            <button v-if="unread > 0" @click="markAllRead" :disabled="markingAll"
              class="text-[10px] font-bold text-teal hover:underline cursor-pointer disabled:opacity-50">
              {{ markingAll ? '...' : 'Marcar leídas' }}
            </button>
          </div>
        </div>

        <!-- Lista -->
        <div class="max-h-96 overflow-y-auto">
          <div v-if="loading && recent.length === 0" class="py-8 text-center text-xs text-text-muted">Cargando...</div>
          <div v-else-if="recent.length === 0" class="py-12 text-center">
            <svg class="w-8 h-8 mx-auto mb-2 text-text-muted opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
            <p class="text-xs text-text-muted">Sin notificaciones</p>
          </div>
          <div v-else>
            <button v-for="n in recent" :key="n.id" @click="handleClick(n)"
              class="w-full text-left px-4 py-3 border-b border-border/40 last:border-0 hover:bg-surface cursor-pointer transition-colors flex items-start gap-3"
              :class="!n.read ? 'bg-cyan/[0.03]' : ''">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center p-2 shrink-0" :class="notifMeta(n.type).color" v-html="notifMeta(n.type).icon"></div>
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-2">
                  <div class="text-xs font-bold text-navy truncate">{{ n.title }}</div>
                  <span v-if="!n.read" class="w-2 h-2 rounded-full bg-cyan shrink-0 mt-1"></span>
                </div>
                <p v-if="n.message" class="text-[11px] text-text-secondary line-clamp-2 mt-0.5">{{ n.message }}</p>
                <div class="text-[10px] text-text-muted mt-1">{{ formatRelative(n.createdAt || n.date) }}</div>
              </div>
            </button>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-4 py-2.5 border-t border-border/60 text-center">
          <router-link to="/panel/notifications" @click="open = false" class="text-xs font-bold text-navy hover:underline cursor-pointer">
            Ver todas →
          </router-link>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { NotificationsService, notifMeta } from '@/services/Notifications.service'
import type { AppNotification } from '@/services/Notifications.service'
import { resolveNotificationRoute } from '@/utils/notification-route'
import { useAuthStore } from '@/stores/auth.store'

const router = useRouter()
const auth = useAuthStore()

const open = ref(false)
const loading = ref(true)
const markingAll = ref(false)
const allNotifications = ref<AppNotification[]>([])
const root = ref<HTMLElement | null>(null)
const bellRect = ref<DOMRect>({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect)

const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))
const userId = computed(() => auth.user?.id)

const recent = computed(() =>
  [...allNotifications.value]
    .sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''))
    .slice(0, 10)
)
const unread = computed(() => allNotifications.value.filter(n => !n.read).length)

async function load() {
  loading.value = true
  try {
    const r = await NotificationsService.list({ hotelId: hotelId.value, userId: userId.value })
    allNotifications.value = r.data || []
  } catch {
    allNotifications.value = []
  } finally {
    loading.value = false
  }
}

// #267: al abrir el desplegable se refresca la lista sin esperar al polling de 30 s
// (la reserva web nueva aparece al instante). No bloquea la apertura ni duplica el fetch en curso.
function toggle() {
  open.value = !open.value
  if (open.value && !loading.value) load()
}

async function markAllRead() {
  if (markingAll.value) return
  markingAll.value = true
  try {
    await NotificationsService.markAllRead({ hotelId: hotelId.value, userId: userId.value })
    allNotifications.value = allNotifications.value.map(n => ({ ...n, read: true }))
  } finally {
    markingAll.value = false
  }
}

async function handleClick(n: AppNotification) {
  if (!n.read) {
    try {
      await NotificationsService.markAsRead(n.id)
      n.read = true
    } catch { /* silent */ }
  }
  const to = resolveNotificationRoute(n)
  if (to) router.push(to)
  open.value = false
}

function formatRelative(date?: string): string {
  if (!date) return ''
  const d = new Date(date.includes('T') ? date : date + 'T12:00:00')
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'ahora'
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`
  if (diff < 7 * 86_400_000) return `hace ${Math.floor(diff / 86_400_000)} d`
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

async function positionDropdown() {
  await nextTick()
  if (root.value) {
    bellRect.value = root.value.getBoundingClientRect()
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await load()
  // Polling cada 30s — refresca badge silenciosamente
  pollTimer = setInterval(load, 30_000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

// Recalcular posición al abrir
import { watch } from 'vue'
watch(open, (val) => { if (val) positionDropdown() })
</script>

<style scoped></style>
