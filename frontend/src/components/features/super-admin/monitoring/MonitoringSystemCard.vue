<template>
  <SectionCard title="Sistema y base de datos" subtitle="Proceso · SO · disco · uploads · BD">
    <SkeletonLoader v-if="loading && !data" variant="text" :rows="6" />

    <div v-else-if="error" class="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
      No se pudo leer el estado del sistema: {{ error }}
    </div>

    <EmptyState v-else-if="!data || bloques.length === 0"
      title="Sin mediciones"
      message="El backend respondió pero no pudo medir ninguna fuente. Revisá el log del servidor." />

    <div v-else class="space-y-5">
      <div v-for="b in bloques" :key="b.titulo">
        <div class="text-[10px] font-bold text-text-muted uppercase mb-2">{{ b.titulo }}</div>
        <div v-if="b.barra" class="mb-2">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-text-muted">{{ b.barra.label }}</span>
            <span class="font-bold text-navy">{{ b.barra.pct }}%</span>
          </div>
          <div class="h-2 bg-surface rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="barraClase(b.barra.pct)" :style="{ width: `${Math.min(100, Math.max(0, b.barra.pct))}%` }"></div>
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
          <template v-for="f in b.filas" :key="f.label">
            <dt class="text-[11px] text-text-muted">{{ f.label }}</dt>
            <dd class="text-[11px] font-bold text-navy text-right">{{ f.value }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="faltantes.length" class="pt-3 border-t border-border text-[11px] text-text-muted">
        Sin datos de: <span class="font-bold">{{ faltantes.join(', ') }}</span>. La fuente no respondió y el bloque se omite en vez de mostrar un cero.
      </div>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
// MonitoringSystemCard.vue — Salud del proceso, SO, disco, uploads y BD
// (GET /api/admin/monitoring/system). Cada bloque viene o no viene: el que falta se dice.
import { computed } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { SystemSnapshot } from '@/types/monitoring'

const PCT_ATENCION = 75
const PCT_CRITICO = 90
const KB = 1024
const SEGUNDOS_HORA = 3600
const SEGUNDOS_DIA = 86400

interface Fila { label: string; value: string }
interface Bloque { titulo: string; filas: Fila[]; barra?: { label: string; pct: number } }

const props = defineProps<{
  data: SystemSnapshot | null
  loading: boolean
  error: string
}>()

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= KB && i < unidades.length - 1) { v /= KB; i++ }
  return `${i === 0 ? v : v.toFixed(1)} ${unidades[i]}`
}

function fmtDuracion(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  const dias = Math.floor(s / SEGUNDOS_DIA)
  const horas = Math.floor((s % SEGUNDOS_DIA) / SEGUNDOS_HORA)
  const minutos = Math.floor((s % SEGUNDOS_HORA) / 60)
  if (dias > 0) return `${dias} d ${horas} h`
  if (horas > 0) return `${horas} h ${minutos} min`
  return `${minutos} min`
}

function pct(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0
}

const NOMBRES: Record<keyof SystemSnapshot, string> = {
  proceso: 'proceso',
  so: 'SO',
  disco: 'disco',
  uploads: 'uploads',
  db: 'base de datos',
}

const bloques = computed<Bloque[]>(() => {
  const d = props.data
  if (!d) return []
  const out: Bloque[] = []
  if (d.proceso) {
    out.push({
      titulo: 'Proceso del backend',
      filas: [
        { label: 'Uptime', value: fmtDuracion(d.proceso.uptimeS) },
        { label: 'CPU (intervalo)', value: d.proceso.cpuPct === null ? 'Primera lectura' : `${d.proceso.cpuPct}%` },
        { label: 'Memoria RSS', value: `${d.proceso.memoriaRssMb} MB` },
        { label: 'Heap usado', value: `${d.proceso.memoriaHeapMb} MB` },
      ],
    })
  }
  if (d.so) {
    const usadaMb = d.so.memoriaTotalMb - d.so.memoriaLibreMb
    out.push({
      titulo: 'SO (host)',
      barra: { label: 'Memoria usada', pct: pct(usadaMb, d.so.memoriaTotalMb) },
      filas: [
        { label: 'Uptime', value: fmtDuracion(d.so.uptimeS) },
        { label: 'Carga (1/5/15 min)', value: d.so.cargas.length ? d.so.cargas.join(' / ') : '—' },
        { label: 'Memoria', value: `${usadaMb.toFixed(0)} de ${d.so.memoriaTotalMb.toFixed(0)} MB` },
      ],
    })
  }
  if (d.disco) {
    out.push({
      titulo: 'Disco',
      barra: { label: 'Usado', pct: d.disco.usadoPct },
      filas: [
        { label: 'Libre', value: fmtBytes(d.disco.libreBytes) },
        { label: 'Total', value: fmtBytes(d.disco.totalBytes) },
      ],
    })
  }
  if (d.uploads) {
    out.push({
      titulo: 'Uploads',
      filas: [
        { label: 'Tamaño', value: fmtBytes(d.uploads.bytes) },
        { label: 'Archivos', value: d.uploads.archivos.toLocaleString('es-AR') },
        { label: 'Calculado', value: new Date(d.uploads.calculadoEn).toLocaleString('es-AR') },
      ],
    })
  }
  if (d.db) {
    const filas: Fila[] = [{ label: 'Motor', value: d.db.motor }]
    if (d.db.tamanoBytes !== undefined) filas.push({ label: 'Tamaño', value: fmtBytes(d.db.tamanoBytes) })
    if (d.db.tablas !== undefined) filas.push({ label: 'Tablas', value: String(d.db.tablas) })
    if (d.db.conexiones !== undefined) filas.push({ label: 'Conexiones', value: String(d.db.conexiones) })
    out.push({ titulo: 'Base de datos', filas })
  }
  return out
})

const faltantes = computed(() => {
  const d = props.data
  if (!d) return []
  return (Object.keys(NOMBRES) as Array<keyof SystemSnapshot>).filter((k) => !d[k]).map((k) => NOMBRES[k])
})

function barraClase(p: number): string {
  if (p >= PCT_CRITICO) return 'bg-danger'
  if (p >= PCT_ATENCION) return 'bg-gold'
  return 'bg-teal'
}
</script>
