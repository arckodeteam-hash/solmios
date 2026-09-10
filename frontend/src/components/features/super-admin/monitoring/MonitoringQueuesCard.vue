<template>
  <SectionCard title="Colas" subtitle="Email · Channex (ARI outbox) · entregas de webhooks">
    <SkeletonLoader v-if="loading && !data" variant="text" :rows="6" />

    <div v-else-if="error" class="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
      No se pudo leer el estado de las colas: {{ error }}
    </div>

    <EmptyState v-else-if="!data" title="Sin datos de colas" message="El backend no devolvió el estado de las colas." />

    <div v-else class="space-y-5">
      <!-- Email -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-bold text-text-muted uppercase">Cola de email</span>
          <span class="text-[10px] text-text-muted">
            Último envío: {{ data.email.ultimoProcesadoEn ? fecha(data.email.ultimoProcesadoEn) : 'nunca' }}
          </span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div v-for="c in emailCards" :key="c.label" class="bg-surface rounded-xl p-3 text-center">
            <div class="text-lg font-black" :class="c.color">{{ c.value }}</div>
            <div class="text-[10px] text-text-muted font-bold uppercase">{{ c.label }}</div>
          </div>
        </div>
      </div>

      <!-- Channex -->
      <div>
        <div class="text-[10px] font-bold text-text-muted uppercase mb-2">Cola de Channex</div>
        <div v-if="!data.ariOutbox" class="text-xs text-text-muted bg-surface rounded-xl p-3">
          El conector de la outbox de Channex no está cableado en esta instalación: no hay contadores que mostrar.
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div v-for="c in ariCards" :key="c.label" class="bg-surface rounded-xl p-3 text-center">
            <div class="text-lg font-black" :class="c.color">{{ c.value }}</div>
            <div class="text-[10px] text-text-muted font-bold uppercase">{{ c.label }}</div>
          </div>
        </div>
      </div>

      <!-- Webhooks -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-bold text-text-muted uppercase">Entregas de webhooks recientes</span>
          <span v-if="webhooksFallidos > 0" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/10 text-danger">
            {{ webhooksFallidos }} fallida(s)
          </span>
        </div>
        <div v-if="data.webhooks.ultimasEntregas.length === 0" class="text-xs text-text-muted bg-surface rounded-xl p-3">
          Todavía no hubo entregas de webhooks.
        </div>
        <div v-else class="overflow-x-auto rounded-xl border border-border">
          <table class="w-full tbl-head">
            <thead>
              <tr class="border-b border-border">
                <th class="text-left p-2.5 text-[10px] font-bold text-text-muted uppercase">Evento</th>
                <th class="text-left p-2.5 text-[10px] font-bold text-text-muted uppercase">Webhook</th>
                <th class="text-left p-2.5 text-[10px] font-bold text-text-muted uppercase">Código</th>
                <th class="text-left p-2.5 text-[10px] font-bold text-text-muted uppercase">Resultado</th>
                <th class="text-left p-2.5 text-[10px] font-bold text-text-muted uppercase">Cuándo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in data.webhooks.ultimasEntregas" :key="w.id" class="border-b border-border/50 last:border-0">
                <td class="p-2.5 text-xs font-bold text-navy">{{ w.event }}</td>
                <td class="p-2.5 text-[10px] text-text-muted font-mono">{{ w.webhookId }}</td>
                <td class="p-2.5 text-xs font-bold" :class="w.success ? 'text-teal' : 'text-danger'">{{ w.statusCode ?? 'sin respuesta' }}</td>
                <td class="p-2.5">
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="w.success ? 'bg-teal/10 text-teal' : 'bg-danger/10 text-danger'">
                    {{ w.success ? 'Entregado' : 'Falló' }}
                  </span>
                </td>
                <td class="p-2.5 text-[10px] text-text-muted whitespace-nowrap">{{ fecha(w.attemptedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
// MonitoringQueuesCard.vue — Estado de las colas (GET /api/admin/monitoring/queues):
// email por status, contadores de la outbox de Channex y las últimas entregas de webhooks con
// su código HTTP. La cola de Channex puede venir null (conector no cableado) y se dice.
import { computed } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { QueuesSnapshot } from '@/types/monitoring'

const props = defineProps<{
  data: QueuesSnapshot | null
  loading: boolean
  error: string
}>()

const emailCards = computed(() => {
  const e = props.data?.email
  if (!e) return []
  return [
    { label: 'Pendientes', value: e.pending, color: 'text-navy' },
    { label: 'Procesando', value: e.processing, color: 'text-cyan' },
    { label: 'Enviados', value: e.sent, color: 'text-teal' },
    { label: 'Fallidos', value: e.failed, color: e.failed > 0 ? 'text-danger' : 'text-text-muted' },
  ]
})

const ariCards = computed(() => {
  const a = props.data?.ariOutbox
  if (!a) return []
  return [
    { label: 'Pendientes', value: a.pending, color: 'text-navy' },
    { label: 'En reintento', value: a.retrying, color: 'text-orange' },
    { label: 'Procesando', value: a.processing, color: 'text-cyan' },
    { label: 'Enviadas', value: a.sent, color: 'text-teal' },
    { label: 'Fallidas', value: a.failed, color: a.failed > 0 ? 'text-danger' : 'text-text-muted' },
  ]
})

const webhooksFallidos = computed(() =>
  (props.data?.webhooks.ultimasEntregas ?? []).filter((w) => !w.success).length,
)

function fecha(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-AR')
}
</script>
