<template>
  <div>
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Notificaciones</h2>
        <p class="text-xs text-text-muted mt-0.5">
          {{ stats.unread }} sin leer de {{ stats.total }} totales
        </p>
      </div>
      <div class="flex gap-2">
        <button v-if="stats.unread > 0" @click="markAllRead" :disabled="markingAll"
          class="flex items-center gap-1.5 px-4 py-2 bg-navy/5 hover:bg-navy/10 text-navy rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          {{ markingAll ? 'Marcando...' : 'Marcar todas leídas' }}
        </button>
      </div>
    </div>

    <!-- Filtros -->
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      <input id="notifications-search" name="search" aria-label="Buscar" v-model="search" type="text" placeholder="Buscar..." class="px-4 py-2 rounded-xl border border-border text-sm w-56 focus:outline-none focus:border-navy" />
      <select id="notifications-filter-type" name="filterType" aria-label="Filtrar notificaciones por tipo" v-model="filterType" class="px-3 py-2 rounded-xl border border-border text-xs font-bold cursor-pointer">
        <option value="">Todos los tipos</option>
        <option v-for="t in availableTypes" :key="t" :value="t">{{ notifMeta(t).label }}</option>
      </select>
      <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-xs font-bold cursor-pointer">
        <input id="notifications-solo-no-leidas" name="unreadOnly" v-model="unreadOnly" type="checkbox" class="w-4 h-4 rounded text-cyan" />
        Solo no leídas
      </label>
      <span class="text-xs text-text-muted ml-auto">{{ filtered.length }} resultados</span>
    </div>

    <!-- Lista -->
    <div v-if="loading" class="card p-12 text-center text-sm text-text-muted">Cargando...</div>
    <div v-else-if="filtered.length === 0" class="card p-12 text-center">
      <div class="w-12 h-12 mx-auto mb-3 text-text-muted/60">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 8.25v8.25a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 16.5V8.25z"/><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 7.5l7.28 5.098a1.5 1.5 0 001.94 0L20.25 7.5"/></svg>
      </div>
      <h3 class="font-bold text-navy mb-1">Sin notificaciones</h3>
      <p class="text-xs text-text-muted">Cuando ocurran eventos (reservas, pagos, etc.) aparecerán aquí.</p>
    </div>
    <div v-else class="bg-white rounded-2xl border border-border overflow-hidden">
      <button v-for="n in filtered" :key="n.id" @click="handleRow(n)"
        class="w-full text-left flex items-start gap-4 px-5 py-4 border-b border-border/50 last:border-0 hover:bg-surface/50 cursor-pointer transition-colors"
        :class="!n.read ? 'bg-cyan/[0.03]' : ''">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center p-2.5 shrink-0" :class="notifMeta(n.type).color" v-html="notifMeta(n.type).icon"></div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-bold text-navy">{{ n.title }}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="notifMeta(n.type).color">{{ notifMeta(n.type).label }}</span>
                <span v-if="!n.read" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan/10 text-cyan">NUEVA</span>
              </div>
              <p v-if="n.message" class="text-xs text-text-secondary mt-1 line-clamp-2">{{ n.message }}</p>
              <div class="text-[10px] text-text-muted mt-1">{{ formatRelative(n.createdAt || n.date) }}</div>
            </div>
            <button v-if="!n.read" @click.stop="markAsRead(n)" class="text-[10px] font-bold text-teal hover:underline cursor-pointer shrink-0">Marcar leída</button>
            <button @click.stop="remove(n)" class="w-4 h-4 text-coral hover:opacity-70 cursor-pointer shrink-0" aria-label="Eliminar notificación">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
            </button>
          </div>
        </div>
      </button>
    </div>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NotificationsService, notifMeta } from '@/services/Notifications.service'
import type { AppNotification } from '@/services/Notifications.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Eliminada'),
  onError: () => toast.error('Error'),
})

const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))
const userId = computed(() => auth.user?.id)

const allNotifications = ref<AppNotification[]>([])
const loading = ref(true)
const markingAll = ref(false)
const search = ref('')
const filterType = ref('')
const unreadOnly = ref(false)

const stats = computed(() => ({
  total: allNotifications.value.length,
  unread: allNotifications.value.filter(n => !n.read).length,
}))

const availableTypes = computed(() => {
  const s = new Set<string>()
  for (const n of allNotifications.value) s.add(n.type)
  return [...s]
})

const filtered = computed(() => {
  let list = [...allNotifications.value]
  if (unreadOnly.value) list = list.filter(n => !n.read)
  if (filterType.value) list = list.filter(n => n.type === filterType.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.message || '').toLowerCase().includes(q)
    )
  }
  return list.sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''))
})

async function load() {
  loading.value = true
  try {
    const r = await NotificationsService.list({ hotelId: hotelId.value, userId: userId.value })
    allNotifications.value = r.data || []
  } catch {
    allNotifications.value = []
    toast.error('No se pudieron cargar las notificaciones')
  } finally {
    loading.value = false
  }
}

async function markAsRead(n: AppNotification) {
  try {
    await NotificationsService.markAsRead(n.id)
    n.read = true
  } catch { toast.error('Error') }
}

async function markAllRead() {
  if (markingAll.value) return
  markingAll.value = true
  try {
    const count = await NotificationsService.markAllRead({ hotelId: hotelId.value, userId: userId.value })
    allNotifications.value = allNotifications.value.map(n => ({ ...n, read: true }))
    toast.success(`${count} marcadas como leídas`)
  } catch {
    toast.error('Error')
  } finally {
    markingAll.value = false
  }
}

// Borrar es destructivo e irreversible: se pide confirmación (#259). Antes el 🗑️ borraba al click.
function remove(n: AppNotification) {
  askConfirm({
    title: 'Eliminar notificación',
    message: '¿Seguro que querés eliminar esta notificación? No se puede deshacer.',
    confirmLabel: 'Eliminar',
    danger: true,
    run: async () => {
      await NotificationsService.remove(n.id)
      allNotifications.value = allNotifications.value.filter(x => x.id !== n.id)
    },
  })
}

function handleRow(n: AppNotification) {
  if (!n.read) markAsRead(n)
  const meta = (n.metadata || {}) as any
  if (meta.reservationId) router.push('/panel/reservas')
  else if (n.type === 'payment') router.push('/panel/finanzas/facturacion')
  else if (n.type === 'housekeeping') router.push('/panel/operaciones/limpieza')
  else if (n.type === 'maintenance') router.push('/panel/operaciones/mantenimiento')
  else if (n.type === 'review') router.push('/panel/resenas')
}

function formatRelative(date?: string): string {
  if (!date) return ''
  const d = new Date(date.includes('T') ? date : date + 'T12:00:00')
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'ahora'
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`
  if (diff < 7 * 86_400_000) return `hace ${Math.floor(diff / 86_400_000)} d`
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

onMounted(load)
</script>
