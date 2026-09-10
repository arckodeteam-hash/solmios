<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between gap-3 flex-wrap mb-6">
      <div>
        <h1 class="text-xl font-black text-navy">Cola de Channex</h1>
        <p class="text-sm text-text-muted">{{ total }} ráfaga(s) de tarifas e inventario en la outbox</p>
      </div>
      <div class="flex items-center gap-2">
        <!-- La configuración vivía DEBAJO de la tabla, que pagina de a 50 filas: con la cola
             cargada quedaba a ~3.600px de scroll — justo cuando más se la necesita. Ahora se abre
             desde acá, a un clic, sin importar cuánto crezca el listado. -->
        <button type="button" :disabled="loadingConfig" @click="showConfig = true"
          class="bg-white text-text-secondary border border-border font-bold text-sm px-5 py-2.5 rounded-xl hover:border-navy/30 hover:text-navy transition-all cursor-pointer disabled:opacity-50">
          Configuración
        </button>
        <button @click="recargar" :disabled="loading"
          class="bg-white text-text-secondary border border-border font-bold text-sm px-5 py-2.5 rounded-xl hover:border-navy/30 hover:text-navy transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ loading ? 'Cargando…' : 'Refrescar' }}
        </button>
      </div>
    </div>

    <!-- Contadores por estado. `pending` y `retrying` son DISJUNTOS (ver AriOutboxStats): las
         cinco tarjetas suman el total, no hay que sumar dos veces las que esperan reintento. -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
      <div v-for="card in statCards" :key="card.label" class="bg-white rounded-xl p-4 border border-border text-center card-shadow">
        <div class="text-xl font-black" :class="card.color">{{ card.value }}</div>
        <div class="text-[10px] text-text-muted font-bold uppercase">{{ card.label }}</div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="bg-white rounded-2xl border border-border card-shadow p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold text-text-muted uppercase">Filtros</span>
          <span v-if="activeFiltersCount > 0" class="bg-cyan/20 text-cyan text-[10px] font-bold px-2 py-0.5 rounded-full">{{ activeFiltersCount }} activos</span>
        </div>
        <button v-if="activeFiltersCount > 0" @click="limpiarFiltros" class="text-[10px] font-bold text-danger hover:text-danger/80 transition-colors cursor-pointer">Limpiar filtros</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <select id="filtro-estado" name="estado" aria-label="Filtrar por estado" v-model="statusFilter"
          class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="processing">Procesando</option>
          <option value="sent">Enviadas</option>
          <option value="failed">Fallidas</option>
        </select>
        <select id="filtro-tipo" name="tipo" aria-label="Filtrar por tipo de push" v-model="kindFilter"
          class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Tarifas e inventario</option>
          <option value="rates">Tarifas</option>
          <option value="inventory">Inventario</option>
        </select>
        <select id="filtro-hotel" name="hotel" aria-label="Filtrar por hotel" v-model="hotelFilter"
          class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los hoteles</option>
          <option v-for="h in hoteles" :key="h.id" :value="h.id">{{ h.name }}</option>
        </select>
      </div>
    </div>

    <!-- Error de carga: la pantalla no se queda vacía sin explicación -->
    <div v-if="loadError" class="mb-6 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <span class="text-sm font-bold text-danger">{{ loadError }}</span>
      <button @click="recargar" class="px-4 py-2 rounded-xl border border-danger/40 text-xs font-bold text-danger hover:bg-danger/10 transition-colors cursor-pointer">Reintentar</button>
    </div>

    <!-- Cargando -->
    <SkeletonLoader v-if="loading && rows.length === 0" variant="table" :rows="6" />

    <!-- Listado -->
    <SectionCard v-else title="Cola de envíos a Channex" :subtitle="subtituloListado" body-class="p-0">
      <EmptyState
        v-if="rows.length === 0"
        title="No hay ráfagas en la cola"
        :message="activeFiltersCount > 0
          ? 'Ninguna ráfaga coincide con estos filtros. Probá con otros.'
          : 'Cuando un hotel cambie tarifas o disponibilidad, la ráfaga aparece acá hasta que se publique en Channex.'"
      >
        <template #action>
          <button v-if="activeFiltersCount > 0" @click="limpiarFiltros"
            class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Ver todas
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full tbl-head">
          <thead>
            <tr class="border-b border-border">
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Hotel</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Tipo</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Canales</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Intentos</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Programado</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Último error</th>
              <th class="text-right p-4 text-[10px] font-bold text-text-muted uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" class="border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors">
              <td class="p-4">
                <div class="text-sm font-bold text-navy">{{ hotelName(row.hotelId) }}</div>
                <div class="text-[10px] text-text-muted">{{ row.hotelId }}</div>
              </td>
              <td class="p-4 text-sm">{{ ariOutboxKindLabel(row.kind) }}</td>
              <td class="p-4 text-sm">
                <span v-if="row.channels && row.channels.length" class="text-text-secondary">{{ row.channels.join(', ') }}</span>
                <span v-else class="text-[10px] font-bold text-text-muted uppercase">Todos (global)</span>
              </td>
              <td class="p-4">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="ariOutboxStatusMeta(ariOutboxViewStatus(row)).class">
                  {{ ariOutboxStatusMeta(ariOutboxViewStatus(row)).label }}
                </span>
              </td>
              <td class="p-4 text-sm font-bold" :class="row.attempts >= row.maxAttempts ? 'text-danger' : 'text-navy'">
                {{ row.attempts }}<span class="text-[10px] text-text-muted font-bold"> / {{ row.maxAttempts }}</span>
              </td>
              <td class="p-4 text-xs text-text-muted whitespace-nowrap">{{ fecha(row.scheduledAt) }}</td>
              <td class="p-4">
                <!-- El error entero puede ser un cuerpo de respuesta de Channex: acá va cortado y
                     el detalle completo se abre en un modal (CA-2: visualizar los errores). -->
                <button v-if="row.lastError" @click="errorDetalle = row" :title="row.lastError"
                  class="max-w-[220px] truncate block text-left text-xs text-danger font-bold hover:underline cursor-pointer">
                  {{ row.lastError }}
                </button>
                <span v-else class="text-xs text-text-muted">Sin errores</span>
              </td>
              <td class="p-4 text-right">
                <button
                  @click="pedirReintento(row)"
                  :disabled="!sePuedeReintentar(row) || retryingId === row.id"
                  :title="tituloReintento(row)"
                  class="px-2 py-1 bg-navy/10 text-navy rounded-lg text-[10px] font-bold hover:bg-navy/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-navy/10"
                >{{ retryingId === row.id ? 'Reintentando…' : 'Reintentar' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Paginación (server-side: el backend devuelve total/page/limit) -->
      <div v-if="total > limit" class="flex items-center justify-between px-4 py-3 border-t border-border">
        <span class="text-[11px] text-text-muted font-bold">
          {{ (page - 1) * limit + 1 }}–{{ Math.min(page * limit, total) }} de {{ total }}
        </span>
        <div class="flex items-center gap-1">
          <button @click="irAPagina(1)" :disabled="page <= 1 || loading" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">«</button>
          <button @click="irAPagina(page - 1)" :disabled="page <= 1 || loading" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
          <span class="px-2 text-xs font-bold text-navy">{{ page }} / {{ totalPages }}</span>
          <button @click="irAPagina(page + 1)" :disabled="page >= totalPages || loading" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
          <button @click="irAPagina(totalPages)" :disabled="page >= totalPages || loading" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">»</button>
        </div>
      </div>
    </SectionCard>

    <!-- Configuración de la cola -->
    <AppModal v-if="showConfig" size="md" title="Configuración de la cola"
      subtitle="Aplica a todos los hoteles: reintentos automáticos y ritmo de publicación a Channex"
      @close="showConfig = false">
      <SkeletonLoader v-if="loadingConfig" variant="text" :rows="2" />
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="config-max-attempts" class="block text-[10px] font-bold text-text-muted uppercase mb-1">Reintentos automáticos</label>
          <input id="config-max-attempts" name="maxAttempts" aria-label="Máximo de reintentos automáticos"
            v-model.number="configForm.maxAttempts" type="number" :min="MIN_ATTEMPTS" :max="MAX_ATTEMPTS" step="1"
            class="w-full h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
          <p class="text-[10px] text-text-muted mt-1">Intentos por ráfaga antes de darla por fallida ({{ MIN_ATTEMPTS }} a {{ MAX_ATTEMPTS }}).</p>
        </div>
        <div>
          <label for="config-max-per-minute" class="block text-[10px] font-bold text-text-muted uppercase mb-1">Peticiones por minuto</label>
          <input id="config-max-per-minute" name="maxPerMinute" aria-label="Máximo de peticiones por minuto a Channex"
            v-model.number="configForm.maxPerMinute" type="number" :min="MIN_PER_MINUTE" :max="MAX_PER_MINUTE" step="1"
            class="w-full h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
          <p class="text-[10px] text-text-muted mt-1">Techo de llamadas a la API de Channex ({{ MIN_PER_MINUTE }} a {{ MAX_PER_MINUTE }}).</p>
        </div>
      </div>
      <template #footer>
        <span v-if="configError" class="mr-auto text-xs font-bold text-danger">{{ configError }}</span>
        <button type="button" class="px-4 py-2.5 rounded-xl bg-surface text-sm font-bold text-text-secondary" @click="showConfig = false">Cancelar</button>
        <button @click="guardarConfig" :disabled="savingConfig || loadingConfig || !configValida"
          class="bg-coral text-white font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ savingConfig ? 'Guardando…' : 'Guardar' }}
        </button>
      </template>
    </AppModal>

    <!-- Error completo de una fila -->
    <AppModal v-if="errorDetalle" size="lg" title="Último error de la ráfaga"
      :subtitle="`${hotelName(errorDetalle.hotelId)} · ${ariOutboxKindLabel(errorDetalle.kind)}`"
      @close="errorDetalle = null">
      <pre class="whitespace-pre-wrap break-words text-xs text-text-secondary">{{ errorDetalle.lastError }}</pre>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
// Monitor de la cola de Channex (super admin, issue #61).
// Lee la outbox de ARI: contadores por estado, filas con su último error, reintento manual y la
// config de reintentos/ritmo. La API es `/api/admin/ari-outbox` y ya está guardada por super_admin.
import { ref, computed, onMounted, watch } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import {
  AriOutboxService,
  ariOutboxKindLabel,
  ariOutboxStatusMeta,
  ariOutboxViewStatus,
  type AriOutboxKind,
  type AriOutboxRow,
  type AriOutboxStats,
  type AriOutboxStatus,
  type AriQueueConfig,
} from '@/services/AriOutbox.service'
import { SuperAdminService, type AdminHotel } from '@/services/SuperAdmin.service'

// Rangos que acepta el backend: fuera de ellos cae al default en silencio, así que se acota acá.
const MIN_ATTEMPTS = 1
const MAX_ATTEMPTS = 10
const MIN_PER_MINUTE = 1
const MAX_PER_MINUTE = 60

const toast = useToast()

const rows = ref<AriOutboxRow[]>([])
const total = ref(0)
const showConfig = ref(false)
const page = ref(1)
const limit = ref(50)
const loading = ref(false)
const loadError = ref('')
const retryingId = ref<string | null>(null)
const errorDetalle = ref<AriOutboxRow | null>(null)

const stats = ref<AriOutboxStats>({ pending: 0, processing: 0, sent: 0, failed: 0, retrying: 0, total: 0 })
const hoteles = ref<AdminHotel[]>([])

const statusFilter = ref<AriOutboxStatus | 'all'>('all')
const kindFilter = ref<AriOutboxKind | 'all'>('all')
const hotelFilter = ref<string>('all')

const statCards = computed(() => [
  { label: 'Pendientes', value: stats.value.pending, color: 'text-navy' },
  { label: 'En reintento', value: stats.value.retrying, color: 'text-orange' },
  { label: 'Procesándose', value: stats.value.processing, color: 'text-cyan' },
  { label: 'Enviadas', value: stats.value.sent, color: 'text-teal' },
  { label: 'Fallidas', value: stats.value.failed, color: 'text-danger' },
])

const activeFiltersCount = computed(() =>
  [statusFilter.value, kindFilter.value, hotelFilter.value].filter((v) => v !== 'all').length,
)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / Math.max(1, limit.value))))
const subtituloListado = computed(() => `${total.value} ráfaga(s) · página ${page.value} de ${totalPages.value}`)

function hotelName(hotelId: string): string {
  return hoteles.value.find((h) => h.id === hotelId)?.name || hotelId
}

function fecha(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Una `sent` no se reintenta (republicaría un push ya hecho); una `pending` sin fallos ya tiene turno. */
function sePuedeReintentar(row: AriOutboxRow): boolean {
  if (row.status === 'sent') return false
  if (row.status === 'pending' && (row.attempts ?? 0) === 0) return false
  return true
}

function tituloReintento(row: AriOutboxRow): string {
  if (row.status === 'sent') return 'Ya se publicó en Channex'
  if (row.status === 'pending' && (row.attempts ?? 0) === 0) return 'Ya está en cola esperando su turno'
  return 'Devolver la ráfaga a la cola y publicarla de nuevo'
}

function filtros() {
  return {
    status: statusFilter.value === 'all' ? undefined : statusFilter.value,
    kind: kindFilter.value === 'all' ? undefined : kindFilter.value,
    hotelId: hotelFilter.value === 'all' ? undefined : hotelFilter.value,
  }
}

async function cargarLista() {
  loading.value = true
  loadError.value = ''
  const { status, kind, hotelId } = filtros()
  try {
    // Los contadores llevan los mismos filtros MENOS el estado, para que sigan mostrando el
    // panorama completo mientras se mira un estado puntual.
    const [pagina, contadores] = await Promise.all([
      AriOutboxService.list({ status, kind, hotelId, page: page.value, limit: limit.value }),
      AriOutboxService.stats({ kind, hotelId }),
    ])
    rows.value = pagina.items ?? []
    total.value = pagina.total ?? 0
    page.value = pagina.page ?? page.value
    limit.value = pagina.limit ?? limit.value
    stats.value = contadores
  } catch (e: unknown) {
    rows.value = []
    total.value = 0
    loadError.value = (e as Error)?.message || 'No se pudo cargar la cola de Channex.'
  } finally {
    loading.value = false
  }
}

function recargar() {
  cargarLista()
}

function irAPagina(n: number) {
  const destino = Math.min(Math.max(1, n), totalPages.value)
  if (destino === page.value) return
  page.value = destino
  cargarLista()
}

function limpiarFiltros() {
  statusFilter.value = 'all'
  kindFilter.value = 'all'
  hotelFilter.value = 'all'
}

// Al cambiar un filtro se vuelve a la página 1: quedarse en la 3 con un filtro que deja 4 filas
// muestra una tabla vacía sin explicación.
watch([statusFilter, kindFilter, hotelFilter], () => {
  page.value = 1
  cargarLista()
})

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e: unknown) => toast.error((e as Error)?.message || 'No se pudo reintentar la ráfaga'),
})

function pedirReintento(row: AriOutboxRow) {
  if (!sePuedeReintentar(row) || retryingId.value) return
  askConfirm({
    title: 'Reintentar la ráfaga',
    message: `Se vuelve a encolar el push de ${ariOutboxKindLabel(row.kind)} de ${hotelName(row.hotelId)}: los intentos vuelven a 0 y se publica en el próximo ciclo.`,
    confirmLabel: 'Reintentar',
    run: async () => {
      retryingId.value = row.id
      try {
        await AriOutboxService.retry(row.id)
        toast.success('Ráfaga reencolada', 'Se va a publicar en el próximo ciclo de la cola.')
        await cargarLista()
      } finally {
        retryingId.value = null
      }
    },
  })
}

// ── Configuración de la cola ──────────────────────────────────────────────────────────────
const configForm = ref<AriQueueConfig>({ maxAttempts: MIN_ATTEMPTS, maxPerMinute: MIN_PER_MINUTE })
const loadingConfig = ref(false)
const savingConfig = ref(false)
const configError = ref('')

function enRango(valor: number, min: number, max: number): boolean {
  return Number.isInteger(valor) && valor >= min && valor <= max
}

const configValida = computed(() =>
  enRango(configForm.value.maxAttempts, MIN_ATTEMPTS, MAX_ATTEMPTS) &&
  enRango(configForm.value.maxPerMinute, MIN_PER_MINUTE, MAX_PER_MINUTE),
)

async function cargarConfig() {
  loadingConfig.value = true
  try {
    configForm.value = { ...(await AriOutboxService.getConfig()) }
  } catch (e: unknown) {
    configError.value = (e as Error)?.message || 'No se pudo leer la configuración de la cola.'
  } finally {
    loadingConfig.value = false
  }
}

async function guardarConfig() {
  // Fuera de rango el backend cae al DEFAULT (no recorta), así que se corta acá antes de mandar.
  if (!configValida.value) {
    configError.value = `Revisá los valores: reintentos ${MIN_ATTEMPTS}-${MAX_ATTEMPTS}, peticiones ${MIN_PER_MINUTE}-${MAX_PER_MINUTE}.`
    return
  }
  savingConfig.value = true
  configError.value = ''
  try {
    configForm.value = { ...(await AriOutboxService.saveConfig({ ...configForm.value })) }
    showConfig.value = false
    toast.success('Configuración guardada', 'La cola ya usa los nuevos valores.')
  } catch (e: unknown) {
    toast.error((e as Error)?.message || 'No se pudo guardar la configuración')
  } finally {
    savingConfig.value = false
  }
}

/** Los nombres de hotel son cosmética del listado y del filtro: si fallan, la cola se ve igual. */
async function cargarHoteles() {
  try {
    hoteles.value = (await SuperAdminService.hotels()).hotels
  } catch {
    hoteles.value = []
  }
}

onMounted(() => {
  cargarLista()
  cargarConfig()
  cargarHoteles()
})
</script>
