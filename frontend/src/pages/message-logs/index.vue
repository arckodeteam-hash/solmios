<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Historial de Envíos</h2>
        <p class="text-sm text-text-muted mt-0.5">Trazabilidad de emails, WhatsApp y SMS enviados a huéspedes</p>
      </div>
      <div class="flex gap-2">
        <button @click="load" :disabled="loading"
          class="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer disabled:opacity-50">
          <span class="w-4 h-4 shrink-0" v-html="ICON_REFRESH"></span>
          {{ loading ? 'Cargando...' : 'Refrescar' }}
        </button>
        <button @click="exportCsv" :disabled="logs.length === 0"
          class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
          <span class="w-4 h-4 shrink-0" v-html="ICON_DOWNLOAD"></span>
          Exportar CSV
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Total Envíos" :value="stats.total" icon="bookings" accent="blue"
        unit="Mensajes registrados" />
      <KpiHeroCard label="Enviados" :value="stats.sent" icon="checkin" accent="teal"
        :unit="`${deliveryRate}% de entrega`" :progress="deliveryRate" />
      <KpiHeroCard label="Pendientes" :value="stats.pending" icon="checkout" accent="amber"
        unit="En cola o por despachar" />
      <KpiHeroCard label="Fallidos" :value="stats.failed" icon="checkout" accent="rose"
        unit="Requieren reintento" />
    </div>

    <!-- Listado -->
    <SectionCard title="Envíos" :subtitle="`${filtered.length} de ${logs.length} registro(s)`" body-class="p-0">
      <template #actions>
        <input id="message-logs-search" name="search" aria-label="Buscar destinatario" v-model="search" type="text" placeholder="Buscar destinatario..."
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 w-48 focus:outline-none focus:border-cyan" />
        <select id="message-logs-filter-type" name="filterType" aria-label="Filtrar por canal del mensaje" v-model="filterType"
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="">Todos los canales</option>
          <option class="text-navy" value="email">Email</option>
          <option class="text-navy" value="whatsapp">WhatsApp</option>
          <option class="text-navy" value="sms">SMS</option>
        </select>
        <select id="message-logs-filter-status" name="filterStatus" aria-label="Filtrar por estado de envío" v-model="filterStatus"
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="">Todos los estados</option>
          <option class="text-navy" value="sent">Enviados</option>
          <option class="text-navy" value="pending">Pendientes</option>
          <option class="text-navy" value="failed">Fallidos</option>
          <option class="text-navy" value="queued">En cola</option>
        </select>
      </template>

      <!-- Skeletons -->
      <div v-if="loading && logs.length === 0" class="space-y-3 p-4">
        <div v-for="i in 6" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
      </div>

      <!-- Vacíos: sin datos vs filtro sin resultados -->
      <EmptyState v-else-if="filtered.length === 0"
        :icon="ICON_INBOX"
        :title="hasFilters ? 'Sin envíos con estos filtros' : 'Sin envíos registrados'"
        :message="hasFilters
          ? 'Probá con otro canal, otro estado o limpiá la búsqueda.'
          : 'Cuando se disparen auto-messages o envíos manuales, aparecerán aquí.'">
        <template #action>
          <button v-if="hasFilters" @click="clearFilters"
            class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Limpiar filtros</button>
          <button v-else @click="load"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Refrescar</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[880px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Fecha</th>
              <th class="text-left px-4 py-3 text-[10px]">Canal</th>
              <th class="text-left px-4 py-3 text-[10px]">Destinatario</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Reserva</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Respuesta</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in filtered" :key="log.id"
              @click="showDetail(log)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer">
              <td class="px-4 py-3">
                <div class="text-sm font-bold text-navy tabular-nums">{{ formatDate(log.sentAt || log.createdAt) }}</div>
                <div v-if="formatTime(log.sentAt || log.createdAt)" class="text-[11px] text-text-muted tabular-nums">
                  {{ formatTime(log.sentAt || log.createdAt) }}
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1.5 rounded-full bg-navy/5 px-2.5 py-1 text-[10px] font-extrabold uppercase text-navy">
                  <span class="h-3.5 w-3.5 shrink-0" v-html="msgTypeMeta(log.messageType).icon"></span>
                  {{ msgTypeMeta(log.messageType).label }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="max-w-[200px] truncate text-sm font-bold" :class="log.guestName ? 'text-navy' : 'text-text-muted'">
                  {{ log.guestName || 'Sin destinatario' }}
                </div>
                <div v-if="log.recipient" class="max-w-[200px] truncate text-[11px] text-text-muted">{{ log.recipient }}</div>
                <div v-if="log.reservationId" class="text-[11px] font-mono text-text-muted lg:hidden">
                  {{ log.reservationId.slice(0, 8) }}
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <span v-if="log.reservationId" class="text-[11px] font-mono text-text-muted tabular-nums">{{ log.reservationId.slice(0, 8) }}</span>
                <span v-else class="text-[11px] text-text-muted">Sin reserva</span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
                  :class="msgStatusMeta(log.status).class">
                  <span class="h-3 w-3 shrink-0" v-html="msgStatusMeta(log.status).icon"></span>
                  {{ msgStatusMeta(log.status).label }}
                </span>
              </td>
              <td class="px-4 py-3 hidden xl:table-cell">
                <div v-if="log.response" class="max-w-[220px] truncate text-[11px] text-text-muted">{{ log.response }}</div>
                <span v-else class="text-[11px] text-text-muted">Sin respuesta</span>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end">
                  <button @click.stop="showDetail(log)" title="Ver detalle" aria-label="Ver detalle"
                    class="h-8 w-8 grid place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EYE"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal detalle -->
    <AppModal v-if="detailModal.show && detailModal.log" size="lg" title="Detalle de envío"
      :subtitle="`${msgTypeMeta(detailModal.log.messageType).label} · ${msgStatusMeta(detailModal.log.status).label}`"
      @close="detailModal.show = false">
      <div class="space-y-4 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-navy/5 px-2.5 py-1 text-[10px] font-extrabold uppercase text-navy">
            <span class="h-3.5 w-3.5 shrink-0" v-html="msgTypeMeta(detailModal.log.messageType).icon"></span>
            {{ msgTypeMeta(detailModal.log.messageType).label }}
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
            :class="msgStatusMeta(detailModal.log.status).class">
            <span class="h-3 w-3 shrink-0" v-html="msgStatusMeta(detailModal.log.status).icon"></span>
            {{ msgStatusMeta(detailModal.log.status).label }}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-surface/40 p-4">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Destinatario</div>
            <div class="font-bold" :class="detailModal.log.guestName ? 'text-navy' : 'text-text-muted'">
              {{ detailModal.log.guestName || 'Sin destinatario' }}
            </div>
            <div v-if="detailModal.log.recipient" class="break-all text-text-muted">{{ detailModal.log.recipient }}</div>
          </div>
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Fecha</div>
            <div class="font-bold text-navy tabular-nums">{{ formatDate(detailModal.log.sentAt || detailModal.log.createdAt) }}</div>
            <div v-if="formatTime(detailModal.log.sentAt || detailModal.log.createdAt)" class="text-text-muted tabular-nums">
              {{ formatTime(detailModal.log.sentAt || detailModal.log.createdAt) }}
            </div>
          </div>
          <div v-if="detailModal.log.reservationId">
            <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Reserva</div>
            <div class="font-mono text-navy tabular-nums">{{ detailModal.log.reservationId.slice(0, 12) }}</div>
          </div>
          <div v-if="detailModal.log.messageId">
            <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">ID interno</div>
            <div class="break-all font-mono text-[10px] text-navy">{{ detailModal.log.messageId }}</div>
          </div>
        </div>

        <div v-if="detailModal.log.subject">
          <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">Asunto</div>
          <div class="rounded-xl bg-surface p-3 text-navy">{{ detailModal.log.subject }}</div>
        </div>
        <div v-if="detailModal.log.body">
          <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">Cuerpo</div>
          <pre class="whitespace-pre-wrap rounded-xl bg-surface p-3 font-sans text-[11px] text-navy">{{ detailModal.log.body }}</pre>
        </div>
        <div v-if="detailModal.log.response">
          <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">Respuesta del proveedor</div>
          <pre class="whitespace-pre-wrap rounded-xl bg-coral/5 p-3 font-mono text-[10px] text-coral">{{ detailModal.log.response }}</pre>
        </div>
      </div>

      <template #footer>
        <button @click="detailModal.show = false"
          class="rounded-full px-5 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { MessageLogsService, msgStatusMeta, msgTypeMeta, ICON_INBOX } from '@/services/MessageLogs.service'
import type { MessageLog } from '@/services/MessageLogs.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const SVG_OPEN = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
const ICON_EYE = `${SVG_OPEN}<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
const ICON_REFRESH = `${SVG_OPEN}<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`
const ICON_DOWNLOAD = `${SVG_OPEN}<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>`

const auth = useAuthStore()
const toast = useToast()

const logs = ref<MessageLog[]>([])
const loading = ref(false)
const search = ref('')
const filterType = ref('')
const filterStatus = ref('')

const detailModal = ref<{ show: boolean; log: MessageLog | null }>({ show: false, log: null })

const stats = computed(() => ({
  total: logs.value.length,
  sent: logs.value.filter(l => l.status === 'sent').length,
  pending: logs.value.filter(l => l.status === 'pending' || l.status === 'queued').length,
  failed: logs.value.filter(l => l.status === 'failed').length,
}))

const deliveryRate = computed(() => stats.value.total === 0 ? 0 : Math.round((stats.value.sent / stats.value.total) * 100))

const hasFilters = computed(() => !!(search.value || filterType.value || filterStatus.value))

function clearFilters() {
  search.value = ''
  filterType.value = ''
  filterStatus.value = ''
}

const filtered = computed(() => {
  let list = [...logs.value]
  if (filterType.value) list = list.filter(l => l.messageType === filterType.value)
  if (filterStatus.value) list = list.filter(l => l.status === filterStatus.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(l =>
      (l.recipient || '').toLowerCase().includes(q) ||
      (l.guestName || '').toLowerCase().includes(q) ||
      (l.reservationId || '').toLowerCase().includes(q)
    )
  }
  return list.sort((a, b) => (b.sentAt || b.createdAt || '').localeCompare(a.sentAt || a.createdAt || ''))
})

async function load() {
  loading.value = true
  try {
    const r = await MessageLogsService.list()
    logs.value = r.data || []
  } catch (e: any) {
    toast.error(e.message || 'Error al cargar historial')
    logs.value = []
  } finally {
    loading.value = false
  }
}

function showDetail(log: MessageLog) {
  detailModal.value = { show: true, log }
}

function exportCsv() {
  const headers = ['Fecha', 'Tipo', 'Estado', 'Destinatario', 'Guest', 'Reserva', 'Respuesta']
  const rows = filtered.value.map(l => [
    l.sentAt || l.createdAt || '',
    l.messageType,
    l.status,
    l.recipient || '',
    l.guestName || '',
    l.reservationId || '',
    (l.response || '').replace(/[\n\r,]/g, ' '),
  ])
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `message-logs-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`${rows.length} registros exportados`)
}

function formatDate(d?: string): string {
  if (!d) return 'Sin fecha'
  return new Date(d.includes('T') ? d : d + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
function formatTime(d?: string): string {
  if (!d) return ''
  return new Date(d.includes('T') ? d : d + 'T12:00:00').toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

onMounted(load)
</script>

<style scoped></style>
