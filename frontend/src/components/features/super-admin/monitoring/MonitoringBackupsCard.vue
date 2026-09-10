<template>
  <SectionCard title="Backups" subtitle="Volcados completos de la base de datos" body-class="p-0">
    <template #actions>
      <button type="button"
        :disabled="creating || loading || !!error"
        class="px-3 py-1.5 bg-white text-navy text-xs font-bold rounded-lg hover:bg-white/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        @click="emit('create')">
        {{ creating ? 'Creando backup…' : 'Crear backup' }}
      </button>
    </template>

    <div v-if="creating" class="px-4 py-3 border-b border-border bg-cyan/10 flex items-center gap-2 text-xs font-bold text-navy" role="status" aria-busy="true">
      <span class="w-2 h-2 rounded-full bg-cyan animate-pulse"></span>
      Generando el volcado… puede tardar según el tamaño de la base.
    </div>

    <div v-if="loading && items.length === 0" class="p-4 sm:p-5">
      <SkeletonLoader variant="list" :rows="3" />
    </div>

    <div v-else-if="error" class="m-4 sm:m-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
      No se pudo listar los backups: {{ error }}
    </div>

    <EmptyState v-else-if="items.length === 0"
      title="Todavía no hay backups"
      message="Creá uno con el botón de arriba. Los archivos quedan en el servidor y se pueden bajar desde acá." />

    <ul v-else class="divide-y divide-border">
      <li v-for="b in items" :key="b.id" class="p-4 flex items-center justify-between gap-3 hover:bg-surface/50 transition-colors">
        <div class="min-w-0">
          <div class="text-xs font-bold text-navy font-mono break-all">{{ b.id }}</div>
          <div class="text-[10px] text-text-muted mt-0.5">{{ fecha(b.creadoEn) }} · {{ fmtBytes(b.bytes) }}</div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button"
            :disabled="downloadingId === b.id || deletingId === b.id"
            class="px-2 py-1 bg-navy/10 text-navy rounded-lg text-[10px] font-bold hover:bg-navy/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            @click="emit('download', b)">{{ downloadingId === b.id ? 'Bajando…' : 'Descargar' }}</button>
          <button type="button"
            :disabled="downloadingId === b.id || deletingId === b.id"
            class="px-2 py-1 bg-danger/10 text-danger rounded-lg text-[10px] font-bold hover:bg-danger/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            @click="emit('remove', b)">{{ deletingId === b.id ? 'Borrando…' : 'Borrar' }}</button>
        </div>
      </li>
    </ul>
  </SectionCard>
</template>

<script setup lang="ts">
// MonitoringBackupsCard.vue — Lista de backups (GET /api/admin/backups) con crear/descargar/borrar.
// Las acciones se emiten: la confirmación, la descarga y el refresco de la lista los hace la página.
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { BackupFile } from '@/types/monitoring'

const KB = 1024

defineProps<{
  items: BackupFile[]
  loading: boolean
  error: string
  creating: boolean
  downloadingId: string | null
  deletingId: string | null
}>()

const emit = defineEmits<{ create: []; download: [file: BackupFile]; remove: [file: BackupFile] }>()

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= KB && i < unidades.length - 1) { v /= KB; i++ }
  return `${i === 0 ? v : v.toFixed(1)} ${unidades[i]}`
}

function fecha(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-AR')
}
</script>
