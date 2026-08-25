<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Soporte</h2>
        <p class="text-sm text-text-muted mt-0.5">Centro de ayuda y tickets de soporte</p>
      </div>
      <button @click="showNewTicketModal = true" class="flex items-center gap-2 px-5 py-2.5 bg-navy text-white rounded-full text-sm font-extrabold hover:shadow-lg transition-all cursor-pointer">
        + Nuevo Ticket
      </button>
    </div>

    <!-- Métricas -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      <div v-for="stat in metrics" :key="stat.label" class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-4 text-center transition-transform duration-300 hover:-translate-y-0.5">
        <div class="text-2xl font-black" :class="stat.color">{{ stat.value }}</div>
        <div class="text-[10px] text-text-muted font-bold uppercase">{{ stat.label }}</div>
      </div>
    </div>

    <!-- Quick Links -->
    <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6 mb-6">
      <div class="text-[10px] font-bold text-text-muted uppercase mb-4">Recursos Rápidos</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div v-for="link in quickLinks" :key="link.title" class="p-4 rounded-2xl hover:bg-cyan/10 hover:border-cyan/30 border border-border transition-all cursor-pointer">
          <span class="w-5 h-5 mb-2 block text-navy/50" v-html="link.icon"></span>
          <div class="text-sm font-bold text-navy">{{ link.title }}</div>
          <div class="text-[10px] text-text-muted mt-1">{{ link.desc }}</div>
        </div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div class="flex gap-2 flex-wrap">
        <button v-for="f in statusFilters" :key="f.value" @click="activeFilter = f.value" class="px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer" :class="activeFilter === f.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">{{ f.label }}</button>
      </div>
      <div class="relative w-full sm:w-64">
        <input id="support-search-query" name="searchQuery" aria-label="Buscar tickets" v-model="searchQuery" type="text" placeholder="Buscar tickets..." class="w-full h-9 pl-9 pr-4 rounded-full border border-border text-sm bg-white focus:outline-none focus:border-cyan">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      </div>
    </div>

    <!-- Mis Tickets -->
    <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) overflow-hidden">
      <div class="p-4 border-b border-border"><div class="text-sm font-extrabold text-navy">Mis Tickets ({{ filteredTickets.length }})</div></div>
      <!-- Filtro sin resultados: hay tickets, pero ninguno matchea. -->
      <EmptyState
        v-if="!filteredTickets.length && hasFilters"
        :icon="ICON_TICKET"
        title="Ningún ticket con esos filtros"
        message="Probá con otro estado o limpiá la búsqueda para ver el resto de tus tickets."
      >
        <template #action>
          <button @click="clearFilters" class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Limpiar filtros
          </button>
        </template>
      </EmptyState>

      <!-- Sin tickets propios. Soporte no es un módulo gateado por permisos (ver
           ROUTE_TO_PERMISSION en config/module-map.ts): cualquier sesión de hotel puede abrir uno,
           así que el CTA se ofrece siempre, igual que el botón del header. -->
      <EmptyState
        v-else-if="!filteredTickets.length"
        :icon="ICON_TICKET"
        title="Todavía no abriste ningún ticket"
        message="Desde acá le pedís ayuda al equipo de soporte y seguís la conversación: contá qué pasó, elegí la categoría y la prioridad, y te respondemos en el mismo hilo."
      >
        <template #action>
          <button @click="showNewTicketModal = true" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Abrir mi primer ticket
          </button>
        </template>
      </EmptyState>
      <div v-else class="divide-y divide-border">
        <div v-for="ticket in filteredTickets" :key="ticket.id" @click="openTicket(ticket)" class="p-4 hover:bg-surface/50 transition-colors cursor-pointer">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="text-[10px] font-mono text-text-muted">#{{ ticket.id }}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="priorityClass(ticket.priority)">{{ ticket.priority }}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="statusClass(ticket.status)">{{ ticket.status }}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="categoryClass(ticket.category)">{{ ticket.category }}</span>
              </div>
              <div class="text-sm font-bold text-navy mb-1">{{ ticket.subject }}</div>
              <div class="text-xs text-text-muted line-clamp-2">{{ ticket.description }}</div>
            </div>
            <div class="text-right ml-4 shrink-0">
              <div class="text-[10px] text-text-muted">{{ ticket.createdAt }}</div>
              <div class="text-[10px] text-text-muted mt-1">{{ ticket.replies.length }} respuesta{{ ticket.replies.length !== 1 ? 's' : '' }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Ver Ticket -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showViewModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-navy/40 backdrop-blur-sm"></div>
          <div class="modal-panel relative bg-white rounded-[20px] shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]">
            <div class="shrink-0 flex items-center justify-between p-6 border-b border-border">
              <div>
                <div class="flex items-center gap-3">
                  <h3 class="text-lg font-black text-navy">Ticket #{{ selectedTicket.id }}</h3>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="priorityClass(selectedTicket.priority)">{{ selectedTicket.priority }}</span>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="statusClass(selectedTicket.status)">{{ selectedTicket.status }}</span>
                </div>
                <div class="text-sm text-text-muted mt-1">{{ selectedTicket.createdAt }}</div>
              </div>
              <button @click="showViewModal = false" class="w-4 h-4 text-text-muted hover:text-navy transition-colors cursor-pointer" v-html="ICON_X"></button>
            </div>
            <div class="overflow-y-auto flex-1 p-6">
              <div class="py-4 border-b border-border">
                <div class="text-[10px] font-bold text-text-muted uppercase mb-2">Asunto</div>
                <div class="text-sm font-bold">{{ selectedTicket.subject }}</div>
              </div>
              <div class="py-4 border-b border-border">
                <div class="text-[10px] font-bold text-text-muted uppercase mb-2">Descripción</div>
                <div class="text-sm text-text-secondary whitespace-pre-wrap">{{ selectedTicket.description }}</div>
              </div>
              <div v-if="selectedTicket.assignedTo" class="py-4 border-b border-border">
                <div class="text-[10px] font-bold text-text-muted uppercase mb-2">Asignado a</div>
                <div class="text-sm font-bold">{{ selectedTicket.assignedTo }}</div>
              </div>
              <div v-if="selectedTicket.replies && selectedTicket.replies.length" class="pt-4">
                <div class="text-[10px] font-bold text-text-muted uppercase mb-3">Conversación ({{ selectedTicket.replies.length }})</div>
                <div class="space-y-3">
                  <div v-for="(reply, i) in selectedTicket.replies" :key="i" class="flex gap-3" :class="reply.author === 'Soporte Arckode' ? 'flex-row-reverse' : ''">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" :class="reply.author === 'Soporte Arckode' ? 'bg-red/20 text-red' : 'bg-cyan/20 text-cyan'">
                      {{ reply.author === 'Soporte Arckode' ? 'SA' : reply.author[0] }}
                    </div>
                    <div class="max-w-[70%]">
                      <div class="flex items-center gap-2 mb-1" :class="reply.author === 'Soporte Arckode' ? 'justify-end' : ''">
                        <span class="text-[10px] font-bold text-navy">{{ reply.author }}</span>
                        <span class="text-[9px] text-text-muted">{{ reply.date }}</span>
                      </div>
                      <div class="p-3 rounded-2xl text-sm" :class="reply.author === 'Soporte Arckode' ? 'bg-navy text-white' : 'bg-surface text-text-secondary'">{{ reply.message }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-4 p-6 border-t border-border">
              <button v-if="selectedTicket.status !== 'Cerrado'" @click="closeTicket" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cerrar Ticket</button>
              <div class="flex-1"></div>
              <button @click="showViewModal = false" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cerrar</button>
              <button v-if="selectedTicket.status !== 'Cerrado'" @click="showViewModal = false; openReplyTicket(selectedTicket)" class="px-4 py-2 bg-navy text-white rounded-full text-[11px] font-extrabold hover:shadow-lg transition-all cursor-pointer">Responder</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Modal: Responder -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showReplyModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-navy/40 backdrop-blur-sm"></div>
          <div class="modal-panel relative bg-white rounded-[20px] shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]">
            <div class="shrink-0 flex items-center justify-between p-6 border-b border-border">
              <h3 class="text-lg font-black text-navy">Responder Ticket #{{ selectedTicket.id }}</h3>
              <button @click="showReplyModal = false" class="w-4 h-4 text-text-muted hover:text-navy transition-colors cursor-pointer" v-html="ICON_X"></button>
            </div>
            <div class="overflow-y-auto flex-1 p-6">
              <div class="py-4 border-b border-border mb-4"><div class="text-sm font-bold text-navy">{{ selectedTicket.subject }}</div></div>
              <div><label for="support-tu-respuesta" class="block text-[10px] font-bold text-text-muted uppercase mb-2">Tu Respuesta *</label><textarea id="support-tu-respuesta" name="replyMessage" v-model="replyMessage" rows="4" class="w-full px-4 py-2.5 rounded-2xl border border-border text-sm focus:outline-none focus:border-navy resize-none" placeholder="Escriba su respuesta..."></textarea></div>
            </div>
            <div class="shrink-0 flex items-center gap-4 justify-end p-6 border-t border-border">
              <button @click="showReplyModal = false" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
              <button @click="sendReply" class="px-4 py-2 bg-navy text-white rounded-full text-[11px] font-extrabold hover:shadow-lg transition-all cursor-pointer">Enviar</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Modal: Nuevo Ticket -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showNewTicketModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-navy/40 backdrop-blur-sm"></div>
          <div class="modal-panel relative bg-white rounded-[20px] shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
            <div class="shrink-0 flex items-center justify-between p-6 border-b border-border">
              <h3 class="text-lg font-black text-navy">Nuevo Ticket de Soporte</h3>
              <button @click="showNewTicketModal = false" class="w-4 h-4 text-text-muted hover:text-navy transition-colors cursor-pointer" v-html="ICON_X"></button>
            </div>
            <div class="overflow-y-auto flex-1 p-6 space-y-4">
              <div><label for="support-categoria" class="block text-[10px] font-bold text-text-muted uppercase mb-2">Categoría *</label>
                <select id="support-categoria" name="category" v-model="newTicket.category" class="w-full px-4 py-2.5 rounded-full border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
                  <option value="">Seleccionar categoría</option>
                  <option value="Técnico">Técnico</option>
                  <option value="Integraciones">Integraciones (Canales, OTAs)</option>
                  <option value="Facturación">Facturación Electrónica</option>
                  <option value="Configuración">Configuración del Sistema</option>
                  <option value="Capacitación">Capacitación / Ayuda</option>
                  <option value="Sugerencia">Sugerencia de Mejora</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div><label for="support-prioridad" class="block text-[10px] font-bold text-text-muted uppercase mb-2">Prioridad *</label>
                <select id="support-prioridad" name="priority" v-model="newTicket.priority" class="w-full px-4 py-2.5 rounded-full border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
                  <option value="Baja">Baja — Sugerencia o mejora</option>
                  <option value="Normal">Normal — Duda o configuración</option>
                  <option value="Alta">Alta — Funcionalidad bloqueada</option>
                  <option value="Urgente">Urgente — Sistema caído o overbooking</option>
                </select>
              </div>
              <div><label for="support-asunto" class="block text-[10px] font-bold text-text-muted uppercase mb-2">Asunto *</label><input id="support-asunto" name="subject" required aria-required="true" v-model="newTicket.subject" type="text" class="w-full px-4 py-2.5 rounded-full border border-border text-sm focus:outline-none focus:border-navy" placeholder="Descripción corta del problema"></div>
              <div><label for="support-descripcion-detallada" class="block text-[10px] font-bold text-text-muted uppercase mb-2">Descripción Detallada *</label><textarea id="support-descripcion-detallada" name="description" v-model="newTicket.description" rows="5" class="w-full px-4 py-2.5 rounded-2xl border border-border text-sm focus:outline-none focus:border-navy resize-none" placeholder="Explique con detalle el problema o solicitud..."></textarea></div>
              <div class="py-4 border-t border-border">
                <div class="text-[10px] font-bold text-text-muted uppercase mb-2">Archivos Adjuntos (opcional)</div>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-1.5 px-4 py-2 border border-border rounded-full text-sm font-bold hover:border-navy/30 transition-colors cursor-pointer">
                    <span class="w-3.5 h-3.5" v-html="ICON_PAPERCLIP"></span>
                    Adjuntar archivo
                    <input id="support-adjuntar-archivo" type="file" class="hidden" @change="handleFileUpload" multiple>
                  </label>
                  <span class="text-[10px] text-text-muted">PNG, JPG, PDF, LOG (máx 5MB)</span>
                </div>
                <div v-if="newTicket.files.length" class="mt-2 flex flex-wrap gap-2">
                  <span v-for="(f, i) in newTicket.files" :key="i" class="flex items-center gap-1.5 bg-surface px-2.5 py-1 rounded-full text-[10px] font-bold">
                    {{ f }}
                    <button @click="removeFile(i)" class="w-2.5 h-2.5 text-coral hover:text-navy transition-colors cursor-pointer" v-html="ICON_X"></button>
                  </span>
                </div>
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-4 justify-end p-6 border-t border-border">
              <button @click="showNewTicketModal = false" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
              <button @click="createTicket" class="px-4 py-2 bg-navy text-white rounded-full text-[11px] font-extrabold hover:shadow-lg transition-all cursor-pointer">Crear Ticket</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { OperationsService } from '@/services/Operations.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import EmptyState from '@/components/ui/EmptyState.vue'

const SVG_OPEN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
const ICON_X = `${SVG_OPEN}<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
const ICON_TICKET = `${SVG_OPEN}<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>`
const ICON_PAPERCLIP = `${SVG_OPEN}<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`
const ICON_BOOK = `${SVG_OPEN}<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`
const ICON_VIDEO = `${SVG_OPEN}<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>`
const ICON_MESSAGE = `${SVG_OPEN}<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`
const ICON_MAIL = `${SVG_OPEN}<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`
const ICON_CLOCK_ALERT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"/></svg>'
const ICON_LOADER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>'
const ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="m9 12.75 2.25 2.25 4.5-4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'

const auth = useAuthStore()
const toast = useToast()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))
const loading = ref(false)

const activeFilter = ref('all')
const searchQuery = ref('')
const showViewModal = ref(false)
const showReplyModal = ref(false)
const showNewTicketModal = ref(false)
const selectedTicket = ref<any>({})
const replyMessage = ref('')

const newTicket = ref({
  category: '',
  priority: 'medium',
  subject: '',
  description: '',
  files: [] as string[]
})

const statusFilters = [
  { label: 'Todos', value: 'all' },
  { label: 'Abiertos', value: 'open' },
  { label: 'En Progreso', value: 'in_progress' },
  { label: 'Resueltos', value: 'resolved' },
  { label: 'Cerrados', value: 'closed' }
]

const metrics = computed(() => {
  const t = tickets.value
  const en = (s: string) => t.filter((x: any) => x.rawStatus === s).length
  return [
    { label: 'Abiertos', value: en('open'), color: 'text-orange', bg: 'bg-orange/10', icon: ICON_CLOCK_ALERT },
    { label: 'En Progreso', value: en('in_progress'), color: 'text-cyan', bg: 'bg-cyan/10', icon: ICON_LOADER },
    { label: 'Resueltos', value: en('resolved'), color: 'text-teal', bg: 'bg-teal/10', icon: ICON_CHECK_CIRCLE },
    { label: 'Total', value: t.length, color: 'text-navy', bg: 'bg-navy/10', icon: ICON_TICKET },
  ]
})

const quickLinks = [
  { icon: ICON_BOOK, title: 'Guía Rápida', desc: 'Aprende lo básico del sistema' },
  { icon: ICON_VIDEO, title: 'Video Tutoriales', desc: 'Paso a paso en video' },
  { icon: ICON_MESSAGE, title: 'Chat en Vivo', desc: 'Habla con soporte ahora' },
  { icon: ICON_MAIL, title: 'Email Directo', desc: 'soporte@arckode.com' }
]

const tickets = ref<any[]>([])

const PRI_EN: Record<string, string> = { low: 'Baja', medium: 'Normal', high: 'Alta', urgent: 'Urgente' }
const EST_EN: Record<string, string> = { open: 'Abierto', in_progress: 'En Progreso', resolved: 'Resuelto', closed: 'Cerrado' }

onMounted(loadData)

async function loadData() {
  loading.value = true
  try {
    const { data } = await OperationsService.tickets.list(hotelId.value)
    tickets.value = data.map((t: any) => {
      const raw = t.messages ?? t.mensajes
      const msgs = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw || '[]') } catch { return [] } })()
      return {
        id: t.id,
        subject: t.subject,
        description: t.description ?? '',
        priority: PRI_EN[t.priority] ?? 'Normal',
        status: EST_EN[t.status] ?? 'Abierto',
        rawStatus: t.status,
        category: t.category,
        createdAt: t.createdAt ? String(t.createdAt).replace('T', ' ').slice(0, 16) : '',
        assignedTo: t.assignedTo ?? '',
        replies: msgs,
      }
    })
  } catch { toast.error('Error al cargar tickets') }
  loading.value = false
}

// ¿Hay algún filtro activo? Separa "todavía no abriste tickets" de "el filtro no matchea":
// el primero necesita explicar el módulo, el segundo solo limpiar el filtro.
const hasFilters = computed(() => activeFilter.value !== 'all' || Boolean(searchQuery.value.trim()))

function clearFilters() {
  activeFilter.value = 'all'
  searchQuery.value = ''
}

const filteredTickets = computed(() => {
  let result = tickets.value
  if (activeFilter.value !== 'all') result = result.filter(t => t.rawStatus === activeFilter.value)
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(t => t.subject.toLowerCase().includes(q) || String(t.id).includes(q))
  }
  return result
})

const priorityClass = (p: string) => ({ 'Baja': 'bg-surface text-text-muted', 'Normal': 'bg-blue/10 text-blue', 'Alta': 'bg-orange/10 text-orange', 'Urgente': 'bg-red/10 text-red' }[p] || '')
const statusClass = (s: string) => ({ 'Abierto': 'bg-orange/10 text-orange', 'En Progreso': 'bg-cyan/10 text-cyan', 'Resuelto': 'bg-teal/10 text-teal', 'Cerrado': 'bg-surface text-text-muted' }[s] || '')
const categoryClass = (c: string) => ({ 'Técnico': 'bg-red/10 text-red', 'Integraciones': 'bg-cyan/10 text-cyan', 'Facturación': 'bg-navy/10 text-navy', 'Configuración': 'bg-purple/10 text-purple', 'Capacitación': 'bg-teal/10 text-teal', 'Sugerencia': 'bg-gold/10 text-gold' }[c] || '')

const openTicket = (ticket: any) => { selectedTicket.value = { ...ticket }; showViewModal.value = true }
const openReplyTicket = (ticket: any) => { selectedTicket.value = { ...ticket }; replyMessage.value = ''; showReplyModal.value = true }

const sendReply = async () => {
  if (!replyMessage.value.trim()) return
  const idx = tickets.value.findIndex(t => t.id === selectedTicket.value.id)
  if (idx !== -1) {
    const newReply = { author: 'Hotel Admin', date: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), message: replyMessage.value }
    const updatedReplies = [...tickets.value[idx].replies, newReply]
    try {
      await OperationsService.tickets.update(selectedTicket.value.id, { messages: updatedReplies })
      tickets.value[idx].replies = updatedReplies
      toast.success('Respuesta enviada')
    } catch { toast.error('Error al enviar respuesta') }
    replyMessage.value = ''
  }
  showReplyModal.value = false
}

const closeTicket = async () => {
  try {
    await OperationsService.tickets.update(selectedTicket.value.id, { status: 'closed' })
    showViewModal.value = false
    toast.success('Ticket cerrado')
    await loadData()
  } catch { toast.error('Error al cerrar ticket') }
}

const handleFileUpload = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (input.files) {
    for (const file of input.files) {
      newTicket.value.files.push(file.name)
    }
  }
}

const removeFile = (index: number) => {
  newTicket.value.files.splice(index, 1)
}

const createTicket = async () => {
  if (!newTicket.value.subject) return
  try {
    await OperationsService.tickets.create({
      subject: newTicket.value.subject,
      description: newTicket.value.description || '',
      category: newTicket.value.category || 'general',
      priority: newTicket.value.priority || 'medium',
      status: 'open',
      hotelId: hotelId.value,
      userId: auth.user?.id || 'guest',
    })
    newTicket.value = { category: '', priority: 'medium', subject: '', description: '', files: [] }
    showNewTicketModal.value = false
    toast.success('Ticket creado')
    await loadData()
  } catch { toast.error('Error al crear ticket') }
}
</script>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-active .modal-panel, .modal-fade-leave-active .modal-panel { transition: transform 0.2s ease, opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-from .modal-panel, .modal-fade-leave-to .modal-panel { opacity: 0; transform: translateY(8px) scale(0.98); }
</style>
