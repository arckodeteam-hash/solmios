<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Soporte</h2>
        <p class="text-sm text-text-muted mt-0.5">Tickets de soporte de todos los hoteles de la plataforma</p>
      </div>
    </div>

    <!-- Estado de error: falló la carga inicial -->
    <div v-if="loadError && !loading" class="mb-6">
      <EmptyState :icon="ICON_ALERT" title="No se pudieron cargar los tickets" message="Revisá tu conexión e intentá de nuevo.">
        <template #action>
          <button type="button" @click="loadTickets" class="px-5 py-2.5 rounded-full bg-navy text-white text-sm font-bold hover:shadow-lg transition-all cursor-pointer">Reintentar</button>
        </template>
      </EmptyState>
    </div>

    <template v-else>
      <!-- KPIs -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiHeroCard label="Abiertos" :value="kpis.open" icon="bookings" accent="amber" unit="Esperando respuesta" />
        <KpiHeroCard label="En Progreso" :value="kpis.inProgress" icon="building" accent="blue" unit="Un agente está atendiendo" />
        <KpiHeroCard label="Resueltos" :value="kpis.resolved" icon="checkin" accent="teal" unit="Pendientes de cerrar" />
        <KpiHeroCard label="Urgentes" :value="kpis.urgent" icon="checkout" accent="rose" unit="Prioridad urgente" />
      </div>

      <!-- Tabla -->
      <SkeletonLoader v-if="loading" variant="table" :rows="6" />
      <SectionCard v-else title="Tickets de soporte" :subtitle="`${filteredTickets.length} de ${tickets.length} ticket(s)`" body-class="p-0">
        <template #actions>
          <div class="relative w-full sm:w-64">
            <input v-model="searchQuery" type="text" placeholder="Buscar por asunto, hotel, nombre o email..."
              class="w-full h-9 pl-9 pr-4 rounded-lg border border-white/15 bg-white/10 text-white placeholder:text-white/45 text-sm focus:outline-none focus:border-cyan">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/45" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <select v-model="statusFilter" class="h-9 px-3 rounded-lg border border-white/15 bg-white/10 text-white text-[11px] font-bold cursor-pointer focus:outline-none focus:border-cyan">
            <option value="all" class="text-navy">Todos los estados</option>
            <option v-for="s in STATUS_ORDER" :key="s" :value="s" class="text-navy">{{ STATUS_LABEL[s] }}</option>
          </select>
          <select v-model="hotelFilter" class="h-9 px-3 rounded-lg border border-white/15 bg-white/10 text-white text-[11px] font-bold cursor-pointer focus:outline-none focus:border-cyan">
            <option value="all" class="text-navy">Todos los hoteles</option>
            <option v-for="h in hotelOptions" :key="h.id" :value="h.id" class="text-navy">{{ h.name }}</option>
          </select>
        </template>

        <EmptyState v-if="!tickets.length" :icon="ICON_TICKET" title="Sin tickets de soporte" message="Todavía ningún hotel registró un ticket." />
        <EmptyState v-else-if="!filteredTickets.length" :icon="ICON_TICKET" title="Ningún ticket con esos filtros" message="Probá con otro estado, otro hotel o limpiá la búsqueda.">
          <template #action>
            <button type="button" @click="clearFilters" class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Limpiar filtros</button>
          </template>
        </EmptyState>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[960px] tbl-head">
            <thead>
              <tr class="border-b border-border">
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Hotel</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Solicitante</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Asunto</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Prioridad</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Atiende</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Fecha</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ticket in filteredTickets" :key="ticket.id" @click="openTicket(ticket)"
                class="border-b border-border last:border-0 hover:bg-surface/50 transition-colors cursor-pointer">
                <td class="p-4 text-sm font-bold text-navy">{{ ticket.hotel?.name || '—' }}</td>
                <td class="p-4">
                  <div class="text-sm font-bold text-navy">{{ ticket.requester?.name || '—' }}</div>
                  <div v-if="ticket.requester?.email" class="text-[11px] text-text-muted">{{ ticket.requester.email }}</div>
                  <div v-if="ticket.requester?.role" class="text-[10px] text-text-muted uppercase font-bold">{{ ticket.requester.role }}</div>
                </td>
                <td class="p-4 text-sm text-text-secondary max-w-[280px] truncate">{{ ticket.subject }}</td>
                <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="priorityClass(ticket.priority)">{{ priorityLabel(ticket.priority) }}</span></td>
                <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="statusClass(ticket.status)">{{ statusLabel(ticket.status) }}</span></td>
                <td class="p-4 text-xs text-text-muted">{{ ticket.assignee?.name || 'Sin asignar' }}</td>
                <td class="p-4 text-[11px] text-text-muted">{{ formatDate(ticket.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>

    <!-- Detalle: conversación + estado -->
    <AppModal v-if="selectedTicket" size="xl" body-class="p-0" @close="closeDetail">
      <template #header>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-mono text-white/60">#{{ selectedTicket.id.slice(0, 8) }}</span>
            <h3 class="text-base sm:text-lg font-black text-white truncate">{{ selectedTicket.subject }}</h3>
          </div>
          <p class="text-[11px] text-white/60 mt-0.5">{{ selectedTicket.hotel?.name || 'Hotel desconocido' }} · {{ selectedTicket.requester?.name || 'Solicitante desconocido' }}</p>
        </div>
        <!-- REQ-SOP-04: reproducir lo que ve el solicitante, desde el mismo ticket. -->
        <button v-if="selectedTicket.requester" type="button" @click="enterAsRequester"
          :disabled="!canImpersonateRequester || enteringTicket"
          :title="canImpersonateRequester ? undefined : impersonateDisabledReason"
          class="shrink-0 px-3 py-1.5 bg-blue text-white rounded-lg text-[11px] font-bold hover:bg-blue/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          {{ enteringTicket ? 'Entrando…' : `Entrar como ${selectedTicket.requester.name}` }}
        </button>
      </template>

      <div class="flex flex-col h-[70vh]">
        <!-- Ficha del solicitante -->
        <div class="shrink-0 border-b border-border px-5 py-3 bg-surface/40 flex flex-wrap items-center gap-x-6 gap-y-1">
          <div v-if="selectedTicket.requester?.email" class="text-xs text-text-secondary"><span class="font-bold text-navy">Email:</span> {{ selectedTicket.requester.email }}</div>
          <div v-if="selectedTicket.requester?.role" class="text-xs text-text-secondary"><span class="font-bold text-navy">Rol:</span> {{ selectedTicket.requester.role }}</div>
          <div class="text-xs text-text-secondary"><span class="font-bold text-navy">Categoría:</span> {{ selectedTicket.category || 'general' }}</div>
        </div>

        <!-- Conversación -->
        <div ref="chatContainer" class="flex-1 overflow-y-auto p-5 space-y-4 bg-surface/20">
          <!-- Solicitud original -->
          <div class="flex gap-3">
            <div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center text-[10px] font-bold text-cyan flex-shrink-0">{{ (selectedTicket.requester?.name || 'H')[0] }}</div>
            <div class="max-w-[70%]">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-[10px] font-bold text-navy">{{ selectedTicket.requester?.name || 'Hotel' }}</span>
                <span class="text-[9px] text-text-muted">{{ formatDate(selectedTicket.createdAt) }}</span>
              </div>
              <div class="p-4 rounded-2xl rounded-tl-sm bg-white border border-border shadow-sm text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{{ selectedTicket.description || selectedTicket.subject }}</div>
            </div>
          </div>

          <!-- Respuestas -->
          <div v-for="msg in selectedTicket.messages ?? []" :key="msg.id || msg.createdAt" class="flex gap-3" :class="msg.authorKind === 'support' ? 'flex-row-reverse' : ''">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" :class="msg.authorKind === 'support' ? 'bg-navy text-white' : 'bg-cyan/20 text-cyan'">
              {{ msg.authorKind === 'support' ? 'S' : (msg.authorName || 'H')[0] }}
            </div>
            <div class="max-w-[70%]">
              <div class="flex items-center gap-2 mb-1" :class="msg.authorKind === 'support' ? 'justify-end' : ''">
                <span class="text-[10px] font-bold text-navy">{{ msg.authorName || 'Hotel' }}</span>
                <span v-if="msg.authorKind === 'support'" class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-navy/10 text-navy">Soporte</span>
                <span class="text-[9px] text-text-muted">{{ formatDate(msg.createdAt) }}</span>
              </div>
              <div class="p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap" :class="msg.authorKind === 'support' ? 'bg-navy text-white rounded-tr-sm' : 'bg-white border border-border rounded-tl-sm'">{{ msg.message }}</div>
            </div>
          </div>
        </div>

        <!-- Input -->
        <div v-if="selectedTicket.status !== 'closed'" class="shrink-0 bg-white border-t border-border px-4 py-3">
          <div class="flex items-center gap-2">
            <input v-model="replyMessage" @keyup.enter="sendReply" type="text" placeholder="Escribir respuesta..." :disabled="sending"
              class="flex-1 h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy disabled:opacity-60">
            <button type="button" @click="sendReply" :disabled="!replyMessage.trim() || sending"
              class="px-5 h-10 bg-navy text-white rounded-xl text-sm font-bold hover:shadow-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {{ sending ? 'Enviando…' : 'Enviar' }}
            </button>
          </div>
        </div>
        <div v-else class="shrink-0 bg-white border-t border-border px-6 py-4 text-center">
          <span class="text-[10px] font-bold text-text-muted">Este ticket está cerrado — reabrilo para responder</span>
        </div>
      </div>

      <template #footer>
        <span class="text-[10px] font-bold text-text-muted uppercase mr-auto">Estado</span>
        <select :value="selectedTicket.status" @change="changeStatus(($event.target as HTMLSelectElement).value as TicketStatus)" :disabled="changingStatus"
          class="h-9 px-3 rounded-lg border border-border text-xs font-bold cursor-pointer focus:outline-none focus:border-navy disabled:opacity-60">
          <option v-for="s in STATUS_ORDER" :key="s" :value="s">{{ STATUS_LABEL[s] }}</option>
        </select>
        <button type="button" @click="closeDetail" class="px-5 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth.store'
import { OperationsService } from '@/services/Operations.service'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import type { SupportTicket, TicketStatus, TicketPriority } from '@/types'

const SVG_OPEN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
const ICON_TICKET = `${SVG_OPEN}<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>`
const ICON_ALERT = `${SVG_OPEN}<path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`

const toast = useToast()
const auth = useAuthStore()
const router = useRouter()

const loading = ref(true)
const loadError = ref(false)
const tickets = ref<SupportTicket[]>([])

// El super_admin ve TODOS los hoteles: se acumulan las páginas (como audit.vue) para que las
// KPIs y los filtros trabajen sobre el conjunto completo, no solo la primera página de 20/100.
const MAX_PAGES = 20
async function loadTickets(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const acc: SupportTicket[] = []
    let total = Infinity
    for (let page = 1; page <= MAX_PAGES && acc.length < total; page++) {
      const resp = await OperationsService.tickets.list(undefined, { page, limit: 100 })
      total = resp.total
      acc.push(...resp.data)
    }
    tickets.value = acc
  } catch {
    loadError.value = true
    toast.error('No se pudieron cargar los tickets')
  } finally {
    loading.value = false
  }
}
onMounted(loadTickets)

const STATUS_ORDER: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed']
const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Abierto', in_progress: 'En Progreso', resolved: 'Resuelto', closed: 'Cerrado' }
const STATUS_CLASS: Record<TicketStatus, string> = { open: 'bg-orange/10 text-orange', in_progress: 'bg-cyan/10 text-cyan', resolved: 'bg-teal/10 text-teal', closed: 'bg-surface text-text-muted' }
const PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' }
const PRIORITY_CLASS: Record<TicketPriority, string> = { low: 'bg-surface text-text-muted', medium: 'bg-blue/10 text-blue', high: 'bg-orange/10 text-orange', urgent: 'bg-red/10 text-red' }

const statusLabel = (s?: TicketStatus): string => (s ? (STATUS_LABEL[s] ?? s) : '—')
const statusClass = (s?: TicketStatus): string => (s ? (STATUS_CLASS[s] ?? '') : '')
const priorityLabel = (p?: TicketPriority): string => (p ? (PRIORITY_LABEL[p] ?? p) : '—')
const priorityClass = (p?: TicketPriority): string => (p ? (PRIORITY_CLASS[p] ?? '') : '')

function formatDate(iso?: string): string {
  if (!iso) return ''
  return String(iso).replace('T', ' ').slice(0, 16)
}

const searchQuery = ref('')
const statusFilter = ref<'all' | TicketStatus>('all')
const hotelFilter = ref<'all' | string>('all')

const hotelOptions = computed(() => {
  const map = new Map<string, string>()
  for (const t of tickets.value) if (t.hotel?.id) map.set(t.hotel.id, t.hotel.name || t.hotel.id)
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
})

function clearFilters(): void {
  statusFilter.value = 'all'
  hotelFilter.value = 'all'
  searchQuery.value = ''
}

const filteredTickets = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return tickets.value.filter((t) => {
    if (statusFilter.value !== 'all' && t.status !== statusFilter.value) return false
    if (hotelFilter.value !== 'all' && t.hotelId !== hotelFilter.value) return false
    if (q) {
      const haystack = [t.subject, t.hotel?.name, t.requester?.name, t.requester?.email]
        .map((v) => String(v ?? '').toLowerCase())
      if (!haystack.some((v) => v.includes(q))) return false
    }
    return true
  })
})

const kpis = computed(() => {
  const t = tickets.value
  const count = (s: TicketStatus) => t.filter((x) => x.status === s).length
  return {
    open: count('open'),
    inProgress: count('in_progress'),
    resolved: count('resolved'),
    urgent: t.filter((x) => x.priority === 'urgent').length,
  }
})

// ── Detalle ──
const selectedTicket = ref<SupportTicket | null>(null)
function openTicket(t: SupportTicket): void { selectedTicket.value = t }
function closeDetail(): void { selectedTicket.value = null }

function applyUpdated(updated: SupportTicket): void {
  selectedTicket.value = updated
  const idx = tickets.value.findIndex((t) => t.id === updated.id)
  if (idx !== -1) tickets.value[idx] = updated
}

const replyMessage = ref('')
const sending = ref(false)
async function sendReply(): Promise<void> {
  if (!selectedTicket.value || !replyMessage.value.trim() || sending.value) return
  sending.value = true
  try {
    // REQ-SOP-02: único camino para agregar un mensaje — el autor (nombre + "Soporte") lo
    // resuelve el server, nunca el body. Se refresca desde la respuesta, no de forma optimista.
    const updated = await OperationsService.tickets.addMessage(selectedTicket.value.id, replyMessage.value)
    applyUpdated(updated)
    replyMessage.value = ''
    toast.success('Respuesta enviada')
  } catch {
    toast.error('No se pudo enviar la respuesta')
  } finally {
    sending.value = false
  }
}

const changingStatus = ref(false)
async function changeStatus(status: TicketStatus): Promise<void> {
  if (!selectedTicket.value || selectedTicket.value.status === status || changingStatus.value) return
  changingStatus.value = true
  try {
    const updated = await OperationsService.tickets.update(selectedTicket.value.id, { status })
    applyUpdated(updated)
    toast.success('Estado actualizado')
  } catch {
    toast.error('No se pudo cambiar el estado')
  } finally {
    changingStatus.value = false
  }
}

// REQ-SOP-04: "Entrar como {solicitante}" — reproducir el panel tal como lo ve quien reportó el
// ticket. No se puede impersonar a un usuario inactivo ni a otro super admin (el token de
// impersonación nunca lleva ese rol, ver usuarios/usecases/impersonate.ts).
const canImpersonateRequester = computed(() => {
  const r = selectedTicket.value?.requester
  return !!r && r.active !== false && r.role !== 'super_admin'
})
const impersonateDisabledReason = computed(() => {
  const r = selectedTicket.value?.requester
  if (!r) return ''
  if (r.active === false) return 'Usuario inactivo'
  if (r.role === 'super_admin') return 'No se puede impersonar a otro super admin'
  return ''
})

const enteringTicket = ref(false)
async function enterAsRequester(): Promise<void> {
  const ticket = selectedTicket.value
  if (!ticket?.requester || !canImpersonateRequester.value || enteringTicket.value) return
  enteringTicket.value = true
  try {
    // ticketId viaja al servidor para la auditoría (auth.impersonate) — deja rastro de POR QUÉ
    // soporte entró a esta cuenta. Solo se navega si el store DE VERDAD impersonó: un `false`
    // (impersonación ya en curso) dejaría al admin creyendo que entró sin haberlo hecho.
    const entro = await auth.loginAs(ticket.requester.id, { ticketId: ticket.id })
    if (entro) {
      router.push(`/panel/support?ticket=${ticket.id}`)
    } else {
      toast.info('Ya se está entrando a otra cuenta')
    }
  } catch (e: any) {
    // El request rechazado (403/404) deja al admin en /admin/support — no se navega ni se cierra el modal.
    toast.error(e?.message || 'No se pudo entrar a la cuenta de este solicitante')
  } finally {
    enteringTicket.value = false
  }
}
</script>
