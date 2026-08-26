<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-black text-navy">Eliminación de datos</h1>
      <p class="text-sm text-text-secondary mt-1">
        Solicitudes enviadas desde el formulario de <code class="font-mono text-xs">/p/eliminacion-datos</code>
        (Ley 172-13). Verificá la identidad del solicitante antes de pasar a "Completada".
      </p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 bg-white rounded-2xl border border-border card-shadow animate-pulse" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="bg-white rounded-2xl border border-border card-shadow p-8 text-center">
      <p class="text-danger font-bold mb-2">No se pudieron cargar las solicitudes</p>
      <p class="text-sm text-text-secondary mb-4">{{ error }}</p>
      <button class="text-sm font-bold text-cyan cursor-pointer hover:underline" @click="load">Reintentar</button>
    </div>

    <!-- Vacío -->
    <div v-else-if="requests.length === 0" class="bg-white rounded-2xl border border-border card-shadow p-10 text-center">
      <div class="text-4xl mb-3">🗂️</div>
      <p class="font-bold text-navy mb-1">Sin solicitudes todavía</p>
      <p class="text-sm text-text-secondary">
        Cuando alguien llene el formulario de /p/eliminacion-datos, va a aparecer acá.
      </p>
    </div>

    <!-- Tabla -->
    <div v-else class="bg-white rounded-2xl border border-border card-shadow overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface text-left text-[11px] font-black uppercase text-text-muted tracking-wide">
              <th class="px-4 py-3">Solicitud</th>
              <th class="px-4 py-3">Solicitante</th>
              <th class="px-4 py-3">Contacto</th>
              <th class="px-4 py-3">Hotel</th>
              <th class="px-4 py-3">Estado</th>
              <th class="px-4 py-3">Recibida</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="r in requests" :key="r.id" class="hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3 font-mono text-xs text-navy font-bold">{{ r.requestNumber }}</td>
              <td class="px-4 py-3 font-bold text-navy">{{ r.fullName }}</td>
              <td class="px-4 py-3 text-text-secondary">{{ r.contactHandle }}</td>
              <td class="px-4 py-3 text-text-secondary">{{ r.hotelName || '—' }}</td>
              <td class="px-4 py-3">
                <select
                  :value="r.status"
                  class="text-xs font-black uppercase px-2 py-1.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/30"
                  :class="statusClass(r.status)"
                  @change="changeStatus(r, ($event.target as HTMLSelectElement).value as DeletionRequestStatus)"
                >
                  <option v-for="s in DELETION_REQUEST_STATUSES" :key="s" :value="s">{{ STATUS_LABELS[s] }}</option>
                </select>
              </td>
              <td class="px-4 py-3 text-text-muted text-xs">{{ formatDate(r.createdAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-2">
                  <button
                    class="text-xs font-bold px-3 py-1.5 rounded-lg bg-navy/5 text-navy hover:bg-navy/10 transition-colors cursor-pointer"
                    @click="openNotes(r)"
                  >
                    Notas{{ r.notes ? ' ●' : '' }}
                  </button>
                  <button
                    class="text-xs font-bold px-3 py-1.5 rounded-lg bg-coral/10 text-coral hover:bg-coral/20 transition-colors cursor-pointer"
                    title="Eliminar registro"
                    @click="removeRequest(r)"
                  >
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal de notas -->
    <div
      v-if="notesTarget"
      class="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4"
      @click.self="notesTarget = null"
    >
      <div class="bg-white rounded-2xl w-full max-w-lg my-8 shadow-2xl">
        <div class="flex items-center justify-between px-6 py-4 bg-navy rounded-t-2xl">
          <h2 class="text-sm font-black text-white">Notas — {{ notesTarget.requestNumber }}</h2>
          <button class="text-white/70 hover:text-white text-xl leading-none cursor-pointer" @click="notesTarget = null">✕</button>
        </div>
        <div class="p-6 space-y-3">
          <p class="text-xs text-text-muted">
            Internas — nunca las ve el solicitante. Ej: cómo verificaste la identidad, motivo de rechazo.
          </p>
          <textarea
            v-model="notesDraft"
            rows="6"
            maxlength="2000"
            class="w-full px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan leading-relaxed"
            placeholder="Verificado por WhatsApp al mismo número el 26/08…"
          />
          <p v-if="notesError" class="text-sm text-danger font-bold">{{ notesError }}</p>
        </div>
        <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button class="text-sm font-bold text-text-secondary px-4 py-2 rounded-lg hover:bg-surface transition-colors cursor-pointer" @click="notesTarget = null">
            Cancelar
          </button>
          <button
            class="bg-cyan text-white font-bold text-sm px-5 py-2 rounded-lg hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
            :disabled="savingNotes"
            @click="saveNotes"
          >
            {{ savingNotes ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { DeletionRequestsService } from '@/services/DeletionRequests.service'
import { ApiError } from '@/services/http'
import {
  DELETION_REQUEST_STATUSES,
  STATUS_LABELS,
  type DeletionRequest,
  type DeletionRequestStatus,
} from '@/types/deletion-requests'

const requests = ref<DeletionRequest[]>([])
const loading = ref(true)
const error = ref('')

const notesTarget = ref<DeletionRequest | null>(null)
const notesDraft = ref('')
const notesError = ref('')
const savingNotes = ref(false)

function statusClass(status: DeletionRequestStatus): string {
  switch (status) {
    case 'received': return 'bg-amber/10 text-amber'
    case 'verifying': return 'bg-cyan/10 text-cyan'
    case 'completed': return 'bg-teal/10 text-teal'
    case 'rejected': return 'bg-coral/10 text-coral'
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await DeletionRequestsService.list()
    requests.value = res.data
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Error desconocido'
  } finally {
    loading.value = false
  }
}

async function changeStatus(r: DeletionRequest, status: DeletionRequestStatus) {
  const prev = r.status
  r.status = status // optimista
  try {
    await DeletionRequestsService.update(r.id, { status })
  } catch (e) {
    r.status = prev
    error.value = e instanceof ApiError ? e.message : 'No se pudo cambiar el estado'
  }
}

function openNotes(r: DeletionRequest) {
  notesTarget.value = r
  notesDraft.value = r.notes ?? ''
  notesError.value = ''
}

async function saveNotes() {
  if (!notesTarget.value) return
  savingNotes.value = true
  notesError.value = ''
  try {
    const updated = await DeletionRequestsService.update(notesTarget.value.id, { notes: notesDraft.value })
    const idx = requests.value.findIndex((x) => x.id === updated.id)
    if (idx !== -1) requests.value[idx] = updated
    notesTarget.value = null
  } catch (e) {
    notesError.value = e instanceof ApiError ? e.message : 'No se pudieron guardar las notas'
  } finally {
    savingNotes.value = false
  }
}

async function removeRequest(r: DeletionRequest) {
  const ok = window.confirm(`¿Eliminar el registro de la solicitud ${r.requestNumber} (${r.fullName})? Esta acción no se puede deshacer.`)
  if (!ok) return
  try {
    await DeletionRequestsService.remove(r.id)
    requests.value = requests.value.filter((x) => x.id !== r.id)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'No se pudo eliminar'
  }
}

onMounted(load)
</script>
