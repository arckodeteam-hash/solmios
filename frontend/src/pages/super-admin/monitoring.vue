<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-black text-navy">Monitoreo del Sistema</h2>
        <p class="text-sm text-text-muted mt-0.5">Servidores · API · Base de datos · Errores</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs font-bold px-3 py-1 rounded-full bg-teal/10 text-teal inline-flex items-center gap-1.5">
          <span class="w-2 h-2 bg-teal rounded-full animate-pulse"></span>
          Todos los sistemas operativos
        </span>
        <button type="button" :disabled="cargando" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50" @click="cargar">{{ cargando ? 'Actualizando…' : 'Refrescar' }}</button>
      </div>
    </div>

    <!-- System Status Cards -->
    <div class="grid md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-2xl border border-border p-5">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-bold text-text-muted uppercase">API Gateway</span>
          <span class="w-2.5 h-2.5 rounded-full bg-teal animate-pulse"></span>
        </div>
        <div class="text-3xl font-black text-navy">99.99<span class="text-sm text-text-muted">%</span></div>
        <div class="text-[10px] text-teal font-bold mt-1">Uptime 30 días</div>
        <div class="mt-3 pt-3 border-t border-border">
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Peticiones/min</span>
            <span class="font-bold text-navy">247</span>
          </div>
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Latencia</span>
            <span class="font-bold text-teal">45ms</span>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-2xl border border-border p-5">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-bold text-text-muted uppercase">Base de Datos</span>
          <span class="w-2.5 h-2.5 rounded-full bg-teal animate-pulse"></span>
        </div>
        <div class="text-3xl font-black text-navy">8.2<span class="text-sm text-text-muted">GB</span></div>
        <div class="text-[10px] text-teal font-bold mt-1">PostgreSQL 16</div>
        <div class="mt-3 pt-3 border-t border-border">
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Conexiones</span>
            <span class="font-bold text-navy">34/100</span>
          </div>
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Consultas/s</span>
            <span class="font-bold text-cyan">1,240</span>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-2xl border border-border p-5">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-bold text-text-muted uppercase">CDN / Storage</span>
          <span class="w-2.5 h-2.5 rounded-full bg-teal animate-pulse"></span>
        </div>
        <div class="text-3xl font-black text-navy">24.5<span class="text-sm text-text-muted">GB</span></div>
        <div class="text-[10px] text-teal font-bold mt-1">AWS S3 · CloudFront</div>
        <div class="mt-3 pt-3 border-t border-border">
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Archivos</span>
            <span class="font-bold text-navy">8,342</span>
          </div>
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Cache Hit</span>
            <span class="font-bold text-teal">94.2%</span>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-2xl border border-border p-5">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-bold text-text-muted uppercase">Email / Job Queue</span>
          <span class="w-2.5 h-2.5 rounded-full bg-teal animate-pulse"></span>
        </div>
        <div class="text-3xl font-black text-navy">1,892<span class="text-sm text-text-muted"> enviados</span></div>
        <div class="text-[10px] text-teal font-bold mt-1">SendGrid · última hora</div>
        <div class="mt-3 pt-3 border-t border-border">
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Queue pendiente</span>
            <span class="font-bold text-navy">0</span>
          </div>
          <div class="flex justify-between text-[10px]">
            <span class="text-text-muted">Tasa apertura</span>
            <span class="font-bold text-cyan">68.9%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- API Metrics + Errors -->
    <div class="grid lg:grid-cols-2 gap-6 mb-6">
      <!-- API Response Times -->
      <SectionCard title="Tiempos de Respuesta API">
        <div class="space-y-4">
          <div v-for="endpoint in apiEndpoints" :key="endpoint.name" class="space-y-1">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" :class="endpoint.methodClass">{{ endpoint.method }}</span>
                <span class="text-xs font-bold text-navy">{{ endpoint.name }}</span>
              </div>
              <span class="text-xs font-bold" :class="endpoint.time > 200 ? 'text-coral' : endpoint.time > 100 ? 'text-gold' : 'text-teal'">{{ endpoint.time }}ms</span>
            </div>
            <div class="h-1.5 bg-surface rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="endpoint.time > 200 ? 'bg-coral' : endpoint.time > 100 ? 'bg-gold' : 'bg-teal'" :style="{ width: (endpoint.time / 300 * 100) + '%' }"></div>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Recent Errors -->
      <SectionCard title="Errores Recientes">
        <template #actions>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-coral/10 text-coral">3 activos</span>
        </template>
        <div class="space-y-3">
          <div v-for="err in recentErrors" :key="err.id" class="bg-surface rounded-xl p-4 border-l-4" :class="err.severity === 'critical' ? 'border-l-coral' : 'border-l-gold'">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="err.severity === 'critical' ? 'bg-coral/10 text-coral' : 'bg-gold/10 text-gold'">{{ err.severity === 'critical' ? 'Crítico' : 'Warning' }}</span>
                <span class="text-xs font-bold text-navy">{{ err.type }}</span>
              </div>
              <span class="text-[10px] text-text-muted">{{ err.time }}</span>
            </div>
            <p class="text-[10px] text-text-muted mb-2">{{ err.message }}</p>
            <div class="flex items-center justify-between">
              <span class="text-[9px] text-text-muted font-mono">{{ err.location }}</span>
              <span class="text-[9px] font-bold text-text-muted">{{ err.count }} ocurrencias</span>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>

    <!-- Resource Usage + Backups -->
    <div class="grid lg:grid-cols-3 gap-6">
      <!-- CPU/Memory -->
      <SectionCard title="Servidor Principal">
        <div class="space-y-4">
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-text-muted">CPU</span>
              <span class="font-bold text-navy">34%</span>
            </div>
            <div class="h-2 bg-surface rounded-full overflow-hidden">
              <div class="h-full bg-cyan rounded-full" style="width: 34%"></div>
            </div>
          </div>
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-text-muted">Memoria</span>
              <span class="font-bold text-navy">62%</span>
            </div>
            <div class="h-2 bg-surface rounded-full overflow-hidden">
              <div class="h-full bg-gold rounded-full" style="width: 62%"></div>
            </div>
          </div>
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-text-muted">Disco</span>
              <span class="font-bold text-navy">45%</span>
            </div>
            <div class="h-2 bg-surface rounded-full overflow-hidden">
              <div class="h-full bg-teal rounded-full" style="width: 45%"></div>
            </div>
          </div>
          <div class="pt-3 border-t border-border">
            <div class="flex justify-between text-[10px]">
              <span class="text-text-muted">Uptime</span>
              <span class="font-bold text-teal">42 días</span>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Backups -->
      <SectionCard title="Backups Automáticos">
        <div class="space-y-3">
          <div v-for="backup in backups" :key="backup.id" class="bg-surface rounded-xl p-3">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-navy">{{ backup.name }}</span>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="backup.status === 'Completado' ? 'bg-teal/10 text-teal' : 'bg-cyan/10 text-cyan'">{{ backup.status }}</span>
            </div>
            <div class="flex justify-between text-[10px]">
              <span class="text-text-muted">{{ backup.date }}</span>
              <span class="text-text-muted">{{ backup.size }}</span>
            </div>
          </div>
        </div>
        <!-- Todavía no hay endpoint de backup (REQ-MON-05 del change `monitoreo-plataforma-real`).
             Queda deshabilitado y dicho: un botón habilitado que no hace nada es peor que uno que
             explica por qué no puede. -->
        <button type="button" disabled
          title="Pendiente: el endpoint de backup todavía no existe"
          class="mt-4 w-full cursor-not-allowed rounded-xl bg-surface py-2 text-xs font-bold text-text-muted">
          Backup manual — no disponible todavía
        </button>
      </SectionCard>

      <!-- Connected Hotels -->
      <SectionCard title="Hoteles Online">
        <div class="space-y-3">
          <div class="flex items-center gap-3 p-3 bg-surface rounded-xl" v-for="hotel in onlineHotels" :key="hotel.name">
            <div class="flex-1">
              <div class="text-xs font-bold text-navy">{{ hotel.name }}</div>
              <div class="text-[9px] text-text-muted">{{ hotel.rooms }} hab · {{ hotel.users }} usuarios</div>
            </div>
            <span class="text-[10px] font-bold px-2 py-1 rounded-full bg-teal/10 text-teal">Online</span>
          </div>
        </div>
      </SectionCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from '@/composables/useToast'
import { PlatformService } from '@/services/Platform.service'
import SectionCard from '@/components/ui/SectionCard.vue'

const toast = useToast()
const monData = ref<Awaited<ReturnType<typeof PlatformService.monitoring>> | null>(null)

const apiEndpoints = computed(() => {
  const audit = (monData.value as any)?.peticionesAudit ?? []
  return audit.map((a: any) => ({
    name: a.d, method: 'AUDIT', methodClass: 'bg-teal/10 text-teal', time: a.c,
  }))
})

const recentErrors = ref<any[]>([])

const backups = ref<any[]>([])

const onlineHotels = computed(() => {
  const h = (monData.value as any)?.hoteles ?? 0
  return h > 0 ? [{ name: 'Hoteles activos', rooms: 0, users: (monData.value as any)?.usuarios ?? 0 }] : []
})

const stats = computed(() => ({
  hoteles: (monData.value as any)?.hoteles ?? 0,
  usuarios: (monData.value as any)?.usuarios ?? 0,
  reservas: (monData.value as any)?.reservas ?? 0,
  ticketsAbiertos: (monData.value as any)?.ticketsAbiertos ?? 0,
  uptime: (monData.value as any)?.uptime ?? 0,
  memoria: (monData.value as any)?.memoria ?? 0,
}))

const cargando = ref(false)
async function cargar(): Promise<void> {
  cargando.value = true
  try {
    monData.value = await PlatformService.monitoring()
  } catch {
    toast.error('No se pudo cargar el monitoreo del sistema')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)
</script>
