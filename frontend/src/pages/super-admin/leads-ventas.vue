<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-black text-navy">Leads de Ventas</h1>
      <p class="text-sm text-text-secondary mt-1">
        Consultas enviadas desde los botones <code class="font-mono text-xs">Hablar con Ventas</code> /
        <code class="font-mono text-xs">Contactar ventas</code> de la landing pública.
      </p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 bg-white rounded-2xl border border-border card-shadow animate-pulse" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="bg-white rounded-2xl border border-border card-shadow p-8 text-center">
      <p class="text-danger font-bold mb-2">No se pudieron cargar los leads</p>
      <p class="text-sm text-text-secondary mb-4">{{ error }}</p>
      <button class="text-sm font-bold text-cyan cursor-pointer hover:underline" @click="load">Reintentar</button>
    </div>

    <!-- Vacío -->
    <div v-else-if="leads.length === 0" class="bg-white rounded-2xl border border-border card-shadow p-10 text-center">
      <div class="text-4xl mb-3">📭</div>
      <p class="font-bold text-navy mb-1">Sin leads todavía</p>
      <p class="text-sm text-text-secondary">
        Cuando alguien use "Hablar con Ventas" en la landing, va a aparecer acá.
      </p>
    </div>

    <!-- Tabla -->
    <div v-else class="bg-white rounded-2xl border border-border card-shadow overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface text-left text-[11px] font-black uppercase text-text-muted tracking-wide">
              <th class="px-4 py-3">Nombre</th>
              <th class="px-4 py-3">Contacto</th>
              <th class="px-4 py-3">Hotel</th>
              <th class="px-4 py-3">Plan</th>
              <th class="px-4 py-3">Estado</th>
              <th class="px-4 py-3">Recibido</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="l in leads" :key="l.id" class="hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3 font-bold text-navy">{{ l.fullName }}</td>
              <td class="px-4 py-3 text-text-secondary">
                <a :href="`mailto:${l.email}`" class="hover:underline">{{ l.email }}</a>
                <div v-if="l.phone" class="text-xs text-text-muted">{{ l.phone }}</div>
              </td>
              <td class="px-4 py-3 text-text-secondary">
                {{ l.hotelName || '—' }}
                <div v-if="l.roomsRange" class="text-xs text-text-muted">{{ l.roomsRange }} hab.</div>
              </td>
              <td class="px-4 py-3 text-text-secondary">{{ planLabel(l.planInterest) }}</td>
              <td class="px-4 py-3">
                <select
                  :value="l.status"
                  class="text-xs font-black uppercase px-2 py-1.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/30"
                  :class="statusClass(l.status)"
                  @change="changeStatus(l, ($event.target as HTMLSelectElement).value as SalesLeadStatus)"
                >
                  <option v-for="s in SALES_LEAD_STATUSES" :key="s" :value="s">{{ STATUS_LABELS[s] }}</option>
                </select>
              </td>
              <td class="px-4 py-3 text-text-muted text-xs">{{ formatDate(l.createdAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-2">
                  <button
                    class="text-xs font-bold px-3 py-1.5 rounded-lg bg-navy/5 text-navy hover:bg-navy/10 transition-colors cursor-pointer"
                    @click="openNotes(l)"
                  >
                    Notas{{ l.notes || l.message ? ' ●' : '' }}
                  </button>
                  <button
                    class="text-xs font-bold px-3 py-1.5 rounded-lg bg-coral/10 text-coral hover:bg-coral/20 transition-colors cursor-pointer"
                    title="Eliminar registro"
                    @click="removeLead(l)"
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

    <!-- Modal de detalle / notas -->
    <div
      v-if="notesTarget"
      class="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4"
      @click.self="notesTarget = null"
    >
      <div class="bg-white rounded-2xl w-full max-w-lg my-8 shadow-2xl">
        <div class="flex items-center justify-between px-6 py-4 bg-navy rounded-t-2xl">
          <h2 class="text-sm font-black text-white">{{ notesTarget.fullName }}</h2>
          <button class="text-white/70 hover:text-white text-xl leading-none cursor-pointer" @click="notesTarget = null">✕</button>
        </div>
        <div class="p-6 space-y-3">
          <div v-if="notesTarget.message" class="bg-surface rounded-lg p-3">
            <p class="text-[11px] font-black uppercase text-text-muted mb-1">Mensaje del lead</p>
            <p class="text-sm text-navy whitespace-pre-wrap">{{ notesTarget.message }}</p>
          </div>
          <p class="text-xs text-text-muted">
            Notas internas — nunca las ve el lead. Ej: qué se conversó, próximo paso.
          </p>
          <textarea
            v-model="notesDraft"
            rows="6"
            maxlength="2000"
            class="w-full px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan leading-relaxed"
            placeholder="Llamé el 26/08, interesado en el plan Professional…"
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
import { SalesLeadsService } from '@/services/SalesLeads.service'
import { ApiError } from '@/services/http'
import {
  SALES_LEAD_STATUSES,
  STATUS_LABELS,
  type SalesLead,
  type SalesLeadStatus,
} from '@/types/sales-leads'

const leads = ref<SalesLead[]>([])
const loading = ref(true)
const error = ref('')

const notesTarget = ref<SalesLead | null>(null)
const notesDraft = ref('')
const notesError = ref('')
const savingNotes = ref(false)

function statusClass(status: SalesLeadStatus): string {
  switch (status) {
    case 'new': return 'bg-amber/10 text-amber'
    case 'contacted': return 'bg-cyan/10 text-cyan'
    case 'won': return 'bg-teal/10 text-teal'
    case 'lost': return 'bg-coral/10 text-coral'
  }
}

/** Slug de plan ('ultra') → texto legible ('Ultra'). Sin plan de interés (CTA genérico) → '—'. */
function planLabel(slug: string | null): string {
  if (!slug) return '—'
  return slug.charAt(0).toUpperCase() + slug.slice(1)
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
    const res = await SalesLeadsService.list()
    leads.value = res.data
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Error desconocido'
  } finally {
    loading.value = false
  }
}

async function changeStatus(l: SalesLead, status: SalesLeadStatus) {
  const prev = l.status
  l.status = status // optimista
  try {
    await SalesLeadsService.update(l.id, { status })
  } catch (e) {
    l.status = prev
    error.value = e instanceof ApiError ? e.message : 'No se pudo cambiar el estado'
  }
}

function openNotes(l: SalesLead) {
  notesTarget.value = l
  notesDraft.value = l.notes ?? ''
  notesError.value = ''
}

async function saveNotes() {
  if (!notesTarget.value) return
  savingNotes.value = true
  notesError.value = ''
  try {
    const updated = await SalesLeadsService.update(notesTarget.value.id, { notes: notesDraft.value })
    const idx = leads.value.findIndex((x) => x.id === updated.id)
    if (idx !== -1) leads.value[idx] = updated
    notesTarget.value = null
  } catch (e) {
    notesError.value = e instanceof ApiError ? e.message : 'No se pudieron guardar las notas'
  } finally {
    savingNotes.value = false
  }
}

async function removeLead(l: SalesLead) {
  const ok = window.confirm(`¿Eliminar el lead de ${l.fullName} (${l.email})? Esta acción no se puede deshacer.`)
  if (!ok) return
  try {
    await SalesLeadsService.remove(l.id)
    leads.value = leads.value.filter((x) => x.id !== l.id)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'No se pudo eliminar'
  }
}

onMounted(load)
</script>
