<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between gap-3 flex-wrap mb-6">
      <div>
        <h1 class="text-xl font-black text-navy">Monitoreo de la plataforma</h1>
        <p class="text-sm text-text-muted">API · sistema · errores · colas · backups</p>
      </div>
      <div class="flex items-center gap-3">
        <!-- El estado sale de las lecturas: sin lecturas no hay estado que declarar. -->
        <span class="text-xs font-bold px-3 py-1 rounded-full inline-flex items-center gap-1.5" :class="estadoGlobal.clase" data-testid="estado-global">
          <span class="w-2 h-2 rounded-full" :class="estadoGlobal.punto"></span>
          {{ estadoGlobal.label }}
        </span>
        <button type="button" :disabled="cargando" @click="cargarTodo"
          class="bg-white text-text-secondary border border-border font-bold text-sm px-5 py-2.5 rounded-xl hover:border-navy/30 hover:text-navy transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ cargando ? 'Actualizando…' : 'Refrescar' }}
        </button>
      </div>
    </div>

    <!-- Fallo de lectura: la pantalla no declara nada que no haya medido -->
    <div v-if="fallos.length" class="mb-6 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap" data-testid="fallo-global">
      <div class="min-w-0">
        <div class="text-sm font-bold text-danger">{{ fallos.length === FUENTES_CLAVE.length ? 'El backend no respondió a ninguna lectura.' : `${fallos.length} de ${FUENTES_CLAVE.length} lecturas fallaron.` }}</div>
        <ul class="text-xs text-danger/90 mt-1 space-y-0.5">
          <li v-for="f in fallos" :key="f.nombre"><span class="font-bold">{{ f.nombre }}:</span> {{ f.error }}</li>
        </ul>
      </div>
      <button type="button" @click="cargarTodo" :disabled="cargando"
        class="px-4 py-2 rounded-xl border border-danger/40 text-xs font-bold text-danger hover:bg-danger/10 transition-colors cursor-pointer disabled:opacity-50">Reintentar</button>
    </div>

    <div class="grid lg:grid-cols-2 gap-6 mb-6">
      <MonitoringApiCard :data="api.data" :loading="api.loading" :error="api.error" />
      <MonitoringSystemCard :data="system.data" :loading="system.loading" :error="system.error" />
    </div>

    <div class="grid lg:grid-cols-2 gap-6 mb-6">
      <MonitoringErrorsList :items="errores.data?.items ?? []" :loading="errores.loading" :error="errores.error"
        :removing-id="quitandoErrorId" @remove="quitarError" />
      <MonitoringQueuesCard :data="colas.data" :loading="colas.loading" :error="colas.error" />
    </div>

    <MonitoringBackupsCard :items="backups.data?.items ?? []" :loading="backups.loading" :error="backups.error"
      :creating="creandoBackup" :downloading-id="bajandoBackupId" :deleting-id="borrandoBackupId"
      @create="crearBackup" @download="descargarBackup" @remove="pedirBorrarBackup" />

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
// Monitoreo real de la plataforma (super admin, #96). Cinco lecturas independientes contra
// /api/admin/monitoring/* y /api/admin/backups: cada una carga, falla y se muestra por separado,
// y el estado global se DERIVA de ellas. Sin datos o con el backend caído no hay "operativo":
// se muestra el fallo con su motivo.
import { computed, onMounted, reactive, ref } from 'vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import MonitoringApiCard from '@/components/features/super-admin/monitoring/MonitoringApiCard.vue'
import MonitoringSystemCard from '@/components/features/super-admin/monitoring/MonitoringSystemCard.vue'
import MonitoringErrorsList from '@/components/features/super-admin/monitoring/MonitoringErrorsList.vue'
import MonitoringQueuesCard from '@/components/features/super-admin/monitoring/MonitoringQueuesCard.vue'
import MonitoringBackupsCard from '@/components/features/super-admin/monitoring/MonitoringBackupsCard.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { PlatformService } from '@/services/Platform.service'
import type {
  BackupFile, BackupsListResponse, ErrorLogRow, ErrorLogsResponse, HttpMetricsSnapshot, QueuesSnapshot, SystemSnapshot,
} from '@/types/monitoring'

const toast = useToast()

interface Lectura<T> { data: T | null; loading: boolean; error: string }
function lectura<T>(): Lectura<T> {
  return { data: null, loading: false, error: '' }
}

const api = reactive(lectura<HttpMetricsSnapshot>()) as Lectura<HttpMetricsSnapshot>
const system = reactive(lectura<SystemSnapshot>()) as Lectura<SystemSnapshot>
const errores = reactive(lectura<ErrorLogsResponse>()) as Lectura<ErrorLogsResponse>
const colas = reactive(lectura<QueuesSnapshot>()) as Lectura<QueuesSnapshot>
const backups = reactive(lectura<BackupsListResponse>()) as Lectura<BackupsListResponse>

/** Las que definen el estado global. Backups queda afuera: puede no estar configurado y eso no es una caída. */
const FUENTES_CLAVE: Array<{ nombre: string; lectura: Lectura<unknown> }> = [
  { nombre: 'API HTTP', lectura: api },
  { nombre: 'Sistema', lectura: system },
  { nombre: 'Errores', lectura: errores },
  { nombre: 'Colas', lectura: colas },
]

function mensajeError(e: unknown, fallback: string): string {
  return (e as Error)?.message || fallback
}

async function leer<T>(l: Lectura<T>, fn: () => Promise<T>, fallback: string): Promise<void> {
  l.loading = true
  l.error = ''
  try {
    l.data = await fn()
  } catch (e: unknown) {
    l.data = null
    l.error = mensajeError(e, fallback)
  } finally {
    l.loading = false
  }
}

const cargarApi = () => leer(api, () => PlatformService.monitoringApi(), 'No se pudieron leer las métricas HTTP.')
const cargarSistema = () => leer(system, () => PlatformService.monitoringSystem(), 'No se pudo leer el estado del sistema.')
const cargarErrores = () => leer(errores, () => PlatformService.monitoringErrors(), 'No se pudo leer el registro de errores.')
const cargarColas = () => leer(colas, () => PlatformService.monitoringQueues(), 'No se pudo leer el estado de las colas.')
const cargarBackups = () => leer(backups, () => PlatformService.backupsList(), 'No se pudieron listar los backups.')

const cargando = computed(() => [api, system, errores, colas, backups].some((l) => l.loading))
const nuncaCargado = ref(true)

async function cargarTodo(): Promise<void> {
  await Promise.all([cargarApi(), cargarSistema(), cargarErrores(), cargarColas(), cargarBackups()])
  nuncaCargado.value = false
}

const fallos = computed(() =>
  FUENTES_CLAVE.filter((f) => f.lectura.error).map((f) => ({ nombre: f.nombre, error: f.lectura.error })),
)

/** Algo que sí se midió y merece atención: 5xx acumulados, filas de error, colas con fallidos. */
const incidencias = computed(() => {
  const out: string[] = []
  if ((api.data?.totales.erroresPct ?? 0) > 0) out.push('errores 5xx')
  if ((errores.data?.items.length ?? 0) > 0) out.push('errores registrados')
  if ((colas.data?.email.failed ?? 0) > 0) out.push('emails fallidos')
  if ((colas.data?.ariOutbox?.failed ?? 0) > 0) out.push('ráfagas Channex fallidas')
  if (colas.data?.webhooks.ultimasEntregas.some((w) => !w.success)) out.push('webhooks fallidos')
  return out
})

const estadoGlobal = computed(() => {
  if (nuncaCargado.value) {
    return { label: 'Comprobando…', clase: 'bg-surface text-text-muted', punto: 'bg-text-muted animate-pulse' }
  }
  if (fallos.value.length === FUENTES_CLAVE.length) {
    return { label: 'Backend sin respuesta', clase: 'bg-danger/10 text-danger', punto: 'bg-danger' }
  }
  if (fallos.value.length > 0) {
    return { label: `${fallos.value.length} lectura(s) sin respuesta`, clase: 'bg-danger/10 text-danger', punto: 'bg-danger' }
  }
  if (incidencias.value.length > 0) {
    return { label: `Con incidencias: ${incidencias.value.join(', ')}`, clase: 'bg-gold/10 text-gold', punto: 'bg-gold' }
  }
  return { label: 'Todo operativo', clase: 'bg-teal/10 text-teal', punto: 'bg-teal animate-pulse' }
})

// ── Errores ──
const quitandoErrorId = ref<string | null>(null)

async function quitarError(row: ErrorLogRow): Promise<void> {
  if (quitandoErrorId.value) return
  quitandoErrorId.value = row.id
  try {
    await PlatformService.monitoringErrorRemove(row.id)
    await cargarErrores()
  } catch (e: unknown) {
    toast.error(mensajeError(e, 'No se pudo quitar el error'))
  } finally {
    quitandoErrorId.value = null
  }
}

// ── Backups ──
const creandoBackup = ref(false)
const bajandoBackupId = ref<string | null>(null)
const borrandoBackupId = ref<string | null>(null)

async function crearBackup(): Promise<void> {
  if (creandoBackup.value) return
  creandoBackup.value = true
  try {
    const creado = await PlatformService.backupCreate()
    const retencion = creado.eliminados.length ? ` Se eliminaron ${creado.eliminados.length} por retención.` : ''
    toast.success('Backup creado', `${creado.archivo.id}.${retencion}`)
    await cargarBackups()
  } catch (e: unknown) {
    toast.error('No se pudo crear el backup', mensajeError(e, 'El servidor no pudo generar el volcado.'))
  } finally {
    creandoBackup.value = false
  }
}

async function descargarBackup(file: BackupFile): Promise<void> {
  if (bajandoBackupId.value) return
  bajandoBackupId.value = file.id
  try {
    const blob = await PlatformService.backupDownload(file.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.id
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: unknown) {
    toast.error('No se pudo descargar el backup', mensajeError(e, ''))
  } finally {
    bajandoBackupId.value = null
  }
}

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e: unknown) => toast.error(mensajeError(e, 'No se pudo borrar el backup')),
})

function pedirBorrarBackup(file: BackupFile): void {
  if (borrandoBackupId.value) return
  askConfirm({
    title: 'Borrar backup',
    message: `Se elimina ${file.id} del servidor. No se puede recuperar.`,
    confirmLabel: 'Borrar',
    danger: true,
    run: async () => {
      borrandoBackupId.value = file.id
      try {
        await PlatformService.backupDelete(file.id)
        toast.success('Backup eliminado', file.id)
        await cargarBackups()
      } finally {
        borrandoBackupId.value = null
      }
    },
  })
}

onMounted(cargarTodo)
</script>
