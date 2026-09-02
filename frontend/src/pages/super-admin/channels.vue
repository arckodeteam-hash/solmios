<template>
  <div class="p-6 max-w-4xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-black text-navy">Canales (Channel Manager)</h1>
      <p class="text-sm text-text-muted mt-1">
        Cuenta Channex de la plataforma. Se configura una sola vez y la usan todos los hoteles para
        sincronizar disponibilidad, tarifas y reservas con las OTAs.
      </p>
    </div>

    <ChannexPlatformConfig />

    <!-- Bandeja de solicitudes: lo que los hoteles piden conectar. Antes el botón del panel del
         hotel abría el asistente de Channex y el pedido no llegaba a ningún lado. -->
    <SectionCard :title="`Solicitudes de conexión${pendientes ? ` · ${pendientes} sin atender` : ''}`"
      subtitle="Lo que los hoteles pidieron conectar" bodyClass="p-0">
      <p v-if="loadingReqs" class="p-6 text-sm text-text-muted text-center">Cargando…</p>
      <p v-else-if="!requests.length" class="p-6 text-sm text-text-muted text-center">
        Ningún hotel pidió conectar una OTA todavía.
      </p>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface text-[11px] uppercase text-text-muted">
            <tr>
              <th class="text-left font-bold px-4 py-3">Hotel</th>
              <th class="text-left font-bold px-4 py-3">Canal</th>
              <th class="text-left font-bold px-4 py-3">Pidió</th>
              <th class="text-left font-bold px-4 py-3">Fecha</th>
              <th class="text-left font-bold px-4 py-3">Estado</th>
              <th class="text-left font-bold px-4 py-3">Notas internas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in requests" :key="r.id" class="border-t border-border align-top">
              <td class="px-4 py-3 font-bold text-navy">{{ r.hotelName || r.hotelId }}</td>
              <td class="px-4 py-3">{{ r.channelName || r.channel }}</td>
              <td class="px-4 py-3 text-text-secondary">
                <div>{{ r.requestedByName || '—' }}</div>
                <div class="text-xs text-text-muted">{{ r.requestedByEmail }}</div>
              </td>
              <td class="px-4 py-3 text-text-muted whitespace-nowrap">{{ fecha(r.createdAt) }}</td>
              <td class="px-4 py-3">
                <select :value="r.status" @change="cambiarEstado(r, ($event.target as HTMLSelectElement).value)"
                  class="px-2 py-1.5 rounded-lg border border-border text-xs font-bold bg-white cursor-pointer">
                  <option v-for="(label, value) in ESTADOS" :key="value" :value="value">{{ label }}</option>
                </select>
              </td>
              <td class="px-4 py-3">
                <input :value="r.notes || ''" @change="guardarNota(r, ($event.target as HTMLInputElement).value)"
                  placeholder="Solo las vemos nosotros"
                  class="w-full px-2 py-1.5 rounded-lg border border-border text-xs" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <SectionCard title="Cómo conectar un hotel" bodyClass="p-4 sm:p-5 text-sm text-text-secondary space-y-2">
      <ol class="list-decimal list-inside space-y-1">
        <li>Cargá acá la <b>API key</b> de Channex y elegí el entorno (Staging para probar).</li>
        <li>Tocá <b>Probar conexión</b> — tiene que dar ✓.</li>
        <li>En el panel del hotel → <b>Canales</b> → <b>Sincronizar</b> (crea la <i>property</i> del hotel bajo esta cuenta).</li>
        <li>Al crear una reserva, la disponibilidad se empuja a Channex automáticamente.</li>
      </ol>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import ChannexPlatformConfig from '@/components/features/ChannexPlatformConfig.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { useToast } from '@/composables/useToast'
import { http } from '@/services/http'

interface ChannelRequestAdmin {
  id: string
  hotelId: string
  hotelName?: string | null
  channel: string
  channelName?: string | null
  requestedByName?: string | null
  requestedByEmail?: string | null
  status: string
  notes?: string | null
  createdAt?: string
}

const ESTADOS: Record<string, string> = {
  pending: 'Solicitada',
  in_progress: 'En gestión',
  connected: 'Conectada',
  rejected: 'Rechazada',
}

const toast = useToast()
const requests = ref<ChannelRequestAdmin[]>([])
const loadingReqs = ref(true)
const pendientes = computed(() => requests.value.filter((r) => r.status === 'pending').length)

const fecha = (iso?: string) => iso ? new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

async function cargar() {
  loadingReqs.value = true
  try {
    const res = await http.get<{ data: ChannelRequestAdmin[] }>('/admin/channel-requests')
    requests.value = (res as any)?.data ?? (res as any) ?? []
  } catch {
    toast.error('No se pudieron cargar las solicitudes')
  } finally {
    loadingReqs.value = false
  }
}

async function guardar(r: ChannelRequestAdmin, patch: Record<string, string>) {
  try {
    await http.put(`/admin/channel-requests/${r.id}`, patch)
    Object.assign(r, patch)
    toast.success('Solicitud actualizada')
  } catch {
    toast.error('No se pudo actualizar')
    await cargar()
  }
}

const cambiarEstado = (r: ChannelRequestAdmin, status: string) => guardar(r, { status })
const guardarNota = (r: ChannelRequestAdmin, notes: string) => guardar(r, { notes })

onMounted(cargar)
</script>
