<template>
  <div>
    <!-- El título lo pone el layout (pageTitle); acá solo el "para qué" de la pantalla. -->
    <p class="mb-6 text-sm text-text-secondary">
      A quién llamar hoy: hoteles registrados y en prueba, con lo que ya hicieron en el producto, más las
      consultas del formulario de la landing.
    </p>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div class="h-24 animate-pulse rounded-2xl border border-border bg-surface"></div>
      <div class="rounded-2xl border border-border bg-white p-4"><SkeletonLoader variant="table" :rows="5" /></div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="rounded-2xl border border-border bg-white p-8 text-center card-shadow" data-testid="pipeline-error">
      <p class="mb-2 font-bold text-danger">No se pudo cargar el pipeline</p>
      <p class="mb-4 text-sm text-text-secondary">{{ error }}</p>
      <button type="button" class="cursor-pointer text-sm font-bold text-cyan hover:underline" @click="load">Reintentar</button>
    </div>

    <template v-else>
      <!-- ─── Vencen hoy ──────────────────────────────────────────────────── -->
      <section
        v-if="dueToday.length"
        class="mb-6 rounded-2xl border-2 border-danger/40 bg-danger/5 p-4 sm:p-5"
        data-testid="due-today"
        aria-label="Próximos pasos vencidos o para hoy"
      >
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="grid h-8 w-8 place-items-center rounded-lg bg-danger/15 text-danger"><Icon name="alert" :size="16" /></span>
            <div>
              <h2 class="text-base font-black text-danger">Vencen hoy</h2>
              <p class="text-[11px] text-text-secondary">{{ dueToday.length }} {{ dueToday.length === 1 ? 'próximo paso vencido o para hoy' : 'próximos pasos vencidos o para hoy' }}</p>
            </div>
          </div>
        </div>
        <ul class="space-y-2">
          <li v-for="row in dueToday" :key="`due-${row.key}`" class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-danger/20 bg-white p-3">
            <div class="min-w-0">
              <div class="text-sm font-bold text-navy">{{ titleOf(row) }}</div>
              <div v-if="row.ownerName && row.hotelName" class="text-[11px] text-text-muted">{{ row.ownerName }}</div>
              <div class="mt-1 text-xs text-text-secondary">
                <span class="font-bold text-danger">{{ dueLabel(row) }}</span>
                <span v-if="row.nextStepNote"> · {{ row.nextStepNote }}</span>
                <span v-if="row.assignedTo" class="text-text-muted"> · {{ assigneeName(row.assignedTo) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              <ContactButtons :row="row" scope="due-" />
              <button type="button" class="h-8 cursor-pointer rounded-lg bg-navy px-3 text-xs font-bold text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
                :disabled="isBusy(row)" :data-testid="`due-contacted-${row.key}`" @click="markContacted(row)">Contactado</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ─── Etapas: analítica y filtro a la vez ─────────────────────────── -->
      <div class="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filtrar por etapa">
        <button type="button" class="rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors"
          :class="stageFilter === '' ? 'border-navy bg-navy text-white' : 'border-border bg-white text-text-secondary hover:border-navy'"
          @click="stageFilter = ''">Todas ({{ rows.length }})</button>
        <button v-for="s in PIPELINE_STAGES" :key="s" type="button"
          class="flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors"
          :class="stageFilter === s ? 'border-navy bg-navy text-white' : 'border-border bg-white text-text-secondary hover:border-navy'"
          @click="stageFilter = stageFilter === s ? '' : s">
          <span class="h-2 w-2 rounded-full" :class="STAGE_DOT[s]"></span>
          {{ PIPELINE_STAGE_LABELS[s] }} ({{ countByStage[s] }})
        </button>
      </div>

      <!-- ─── Listado ────────────────────────────────────────────────────── -->
      <SectionCard title="Prospectos" :subtitle="`${filtered.length} de ${rows.length}`" body-class="p-0">
        <template #actions>
          <div class="flex flex-wrap items-center gap-2">
            <div class="relative">
              <input v-model="search" type="text" placeholder="Hotel, dueño o email…" aria-label="Buscar por hotel, dueño o email"
                class="h-9 w-56 rounded-lg border border-white/15 bg-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/45 focus:border-cyan focus:outline-none">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-white/60"><Icon name="search" :size="15" /></span>
            </div>
            <select v-model="heatFilter" aria-label="Filtrar por calor"
              class="h-9 cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white focus:border-cyan focus:outline-none">
              <option value="" class="text-navy">Todo el calor</option>
              <option v-for="h in PIPELINE_HEATS" :key="h" :value="h" class="text-navy">{{ PIPELINE_HEAT_LABELS[h] }}</option>
            </select>
          </div>
        </template>

        <EmptyState
          v-if="!filtered.length"
          :title="rows.length ? 'Sin resultados' : 'Todavía no hay prospectos'"
          :message="rows.length ? 'Ningún prospecto coincide con los filtros aplicados.' : 'Cuando un hotel se registre o alguien escriba desde la landing, va a aparecer acá.'"
        >
          <template v-if="rows.length" #action>
            <button type="button" class="cursor-pointer rounded-full border border-border bg-surface px-4 py-2 text-xs font-bold text-navy transition-colors hover:bg-surface-dark" @click="clearFilters">
              Limpiar filtros
            </button>
          </template>
        </EmptyState>

        <div v-else class="overflow-x-auto">
          <table class="tbl-head w-full min-w-[1080px]">
            <thead>
              <tr class="border-b border-border">
                <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Hotel</th>
                <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Etapa</th>
                <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Señales</th>
                <th class="p-4 text-left text-[10px] font-bold uppercase text-text-muted">Próximo paso</th>
                <th class="p-4 text-right text-[10px] font-bold uppercase text-text-muted">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in filtered" :key="row.key" class="border-b border-border align-top transition-colors last:border-0 hover:bg-surface/50"
                :data-testid="`row-${row.key}`" :class="{ 'opacity-60': row.stage === 'lost' }">
                <!-- Hotel + dueño + contacto -->
                <td class="p-4">
                  <div class="text-sm font-bold text-navy">{{ titleOf(row) }}</div>
                  <div v-if="row.ownerName && row.hotelName" class="text-[11px] text-text-secondary">{{ row.ownerName }}</div>
                  <div v-if="row.email" class="truncate text-[11px] text-text-muted">{{ row.email }}</div>
                  <div v-if="row.phone" class="text-[11px] text-text-muted">{{ row.phone }}</div>
                  <div class="mt-2 flex items-center gap-1.5">
                    <ContactButtons :row="row" />
                  </div>
                  <div v-if="row.registeredAt" class="mt-1.5 text-[10px] text-text-muted">{{ row.stage === 'contact' ? 'Escribió' : 'Alta' }} {{ agoLabel(row.registeredAt) }}</div>
                </td>

                <!-- Etapa + calor + trial -->
                <td class="p-4">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="STAGE_CLASS[row.stage]">{{ PIPELINE_STAGE_LABELS[row.stage] }}</span>
                    <span class="rounded-full px-2 py-0.5 text-xs font-bold" :class="HEAT_CLASS[row.heat]" :title="`Puntaje ${row.heatScore}`" :data-testid="`heat-${row.key}`">{{ HEAT_ICON[row.heat] }} {{ PIPELINE_HEAT_LABELS[row.heat] }}</span>
                  </div>
                  <div v-if="row.daysLeft !== null" class="mt-1.5 text-xs" :class="row.stage === 'expired' ? 'font-bold text-danger' : 'text-text-secondary'" :data-testid="`trial-${row.key}`">
                    {{ trialLabel(row) }}
                  </div>
                  <div v-if="row.planId" class="text-[10px] text-text-muted">{{ planLabel(row.planId) }}</div>
                  <div v-if="row.contactedAt" class="mt-1 text-[10px] text-teal">Contactado {{ agoLabel(row.contactedAt) }}</div>
                  <div v-if="row.stage === 'lost' && row.lostReason" class="mt-1 text-[10px] text-text-muted">{{ SALES_LOST_REASON_LABELS[row.lostReason] }}</div>
                </td>

                <!-- Señales o mensaje del formulario + notas de ventas -->
                <td class="p-4">
                  <div v-if="row.signals" class="flex flex-wrap gap-1" :data-testid="`signals-${row.key}`">
                    <span v-for="chip in signalChips(row.signals)" :key="chip.label" class="rounded-md px-2 py-0.5 text-[10px] font-bold"
                      :class="chip.on ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">{{ chip.label }}</span>
                  </div>
                  <p v-else-if="row.message" class="max-w-xs whitespace-pre-wrap text-xs text-navy">{{ row.message }}</p>
                  <p v-else class="text-xs text-text-muted">Sin datos de uso</p>
                  <p v-if="row.notes" class="mt-2 max-w-xs whitespace-pre-wrap border-l-2 border-gold/60 pl-2 text-[11px] text-text-secondary" :title="row.notes" :data-testid="`notes-text-${row.key}`">{{ row.notes }}</p>
                </td>

                <!-- Próximo paso (inline) -->
                <td class="p-4">
                  <div class="flex w-56 flex-col gap-1.5">
                    <input v-model="draftOf(row).nextStepAt" type="date" :aria-label="`Fecha del próximo paso de ${titleOf(row)}`"
                      class="h-8 rounded-lg border border-border bg-surface px-2 text-[11px] text-navy focus:border-cyan focus:outline-none">
                    <input v-model="draftOf(row).nextStepNote" type="text" maxlength="500" placeholder="Qué hay que hacer" :aria-label="`Nota del próximo paso de ${titleOf(row)}`"
                      class="h-8 rounded-lg border border-border bg-surface px-2 text-[11px] text-navy placeholder:text-text-muted focus:border-cyan focus:outline-none">
                    <div class="flex items-center gap-1.5">
                      <select v-model="draftOf(row).assignedTo" :aria-label="`Responsable del próximo paso de ${titleOf(row)}`" :data-testid="`assignee-${row.key}`"
                        class="h-8 min-w-0 flex-1 cursor-pointer rounded-lg border border-border bg-surface px-2 text-[11px] text-navy focus:border-cyan focus:outline-none">
                        <option value="">Sin responsable</option>
                        <option v-for="u in assigneeOptions(row)" :key="u.id" :value="u.id">{{ u.name }}</option>
                      </select>
                      <button v-if="isDirty(row)" type="button" :disabled="isBusy(row)" :data-testid="`save-step-${row.key}`"
                        class="h-8 shrink-0 cursor-pointer rounded-lg bg-cyan px-3 text-[11px] font-extrabold text-navy transition-all hover:shadow disabled:opacity-50"
                        @click="saveStep(row)">Guardar</button>
                    </div>
                    <p v-if="rowErrors[row.key]" class="text-[11px] font-bold text-danger" :data-testid="`error-${row.key}`">{{ rowErrors[row.key] }}</p>
                  </div>
                </td>

                <!-- Acciones -->
                <td class="p-4 text-right">
                  <div class="flex flex-col items-end gap-1.5">
                    <div v-if="canExtend(row)" class="flex items-center gap-1">
                      <span class="text-[10px] font-bold uppercase text-text-muted">Extender</span>
                      <button v-for="d in EXTEND_OPTIONS" :key="d" type="button" :disabled="isBusy(row)" :data-testid="`extend-${d}-${row.key}`"
                        class="h-7 cursor-pointer rounded-lg border border-border px-2 text-[11px] font-bold text-navy transition-colors hover:bg-surface disabled:opacity-50"
                        :title="`Extender la prueba ${d} días`" @click="extend(row, d)">+{{ d }}</button>
                    </div>
                    <div class="flex items-center gap-1">
                      <button v-if="row.stage !== 'lost'" type="button" :disabled="isBusy(row)" :data-testid="`contacted-${row.key}`"
                        class="h-7 cursor-pointer rounded-lg bg-navy px-2.5 text-[11px] font-bold text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
                        @click="markContacted(row)">Contactado</button>
                      <button v-if="row.stage !== 'lost'" type="button" :disabled="isBusy(row)" :data-testid="`lost-${row.key}`"
                        class="h-7 cursor-pointer rounded-lg bg-coral/10 px-2.5 text-[11px] font-bold text-coral transition-colors hover:bg-coral/20 disabled:opacity-50"
                        @click="openLost(row)">Perdido</button>
                      <button v-else type="button" :disabled="isBusy(row)" :data-testid="`recover-${row.key}`"
                        class="h-7 cursor-pointer rounded-lg border border-border px-2.5 text-[11px] font-bold text-navy transition-colors hover:bg-surface disabled:opacity-50"
                        @click="recover(row)">Recuperar</button>
                    </div>
                    <div class="flex items-center gap-1">
                      <button type="button" :disabled="isBusy(row)" :data-testid="`notes-${row.key}`"
                        class="h-7 cursor-pointer rounded-lg border border-border px-2.5 text-[11px] font-bold text-navy transition-colors hover:bg-surface disabled:opacity-50"
                        @click="openNotes(row)">{{ row.notes ? 'Editar notas' : 'Notas' }}</button>
                      <button v-if="row.leadId" type="button" :disabled="isBusy(row)" :data-testid="`delete-${row.key}`"
                        :title="`Borrar la consulta de ${titleOf(row)}`"
                        class="h-7 cursor-pointer rounded-lg px-2.5 text-[11px] font-bold text-text-secondary transition-colors hover:bg-coral/10 hover:text-coral disabled:opacity-50"
                        @click="askDelete(row)">Borrar</button>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>

    <!-- ─── Perdido: motivo obligatorio ───────────────────────────────────── -->
    <AppModal v-if="lostTarget" size="sm" title="Marcar como perdido" :subtitle="titleOf(lostTarget)" @close="closeLost">
      <form id="lost-form" class="space-y-3" @submit.prevent="confirmLost">
        <div>
          <label class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted" for="lost-reason">Motivo</label>
          <select id="lost-reason" v-model="lostReason" data-testid="lost-reason"
            class="h-10 w-full cursor-pointer rounded-lg border bg-surface px-3 text-sm text-navy focus:border-cyan focus:outline-none"
            :class="lostError ? 'border-danger' : 'border-border'">
            <option value="">Elegir un motivo…</option>
            <option v-for="r in SALES_LOST_REASONS" :key="r" :value="r">{{ SALES_LOST_REASON_LABELS[r] }}</option>
          </select>
          <p v-if="lostError" class="mt-1 text-xs font-bold text-danger" data-testid="lost-error">{{ lostError }}</p>
        </div>
        <div>
          <label class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted" for="lost-notes">Nota (opcional)</label>
          <textarea id="lost-notes" v-model="lostNote" rows="3" maxlength="5000" placeholder="Qué dijo, qué le faltó…"
            class="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-navy placeholder:text-text-muted focus:border-cyan focus:outline-none"></textarea>
        </div>
      </form>
      <template #footer>
        <button type="button" class="cursor-pointer px-4 py-2 text-sm font-bold text-text-secondary hover:text-navy" @click="closeLost">Cancelar</button>
        <button type="submit" form="lost-form" data-testid="lost-confirm" :disabled="savingLost"
          class="cursor-pointer rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg disabled:opacity-50">
          {{ savingLost ? 'Guardando…' : 'Marcar perdido' }}
        </button>
      </template>
    </AppModal>

    <!-- ─── Notas de ventas ───────────────────────────────────────────────── -->
    <AppModal v-if="notesTarget" size="sm" title="Notas de ventas" :subtitle="titleOf(notesTarget)" @close="closeNotes">
      <form id="notes-form" class="space-y-3" @submit.prevent="saveNotes">
        <label class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted" for="notes-text">Lo que hay que saber de este prospecto</label>
        <textarea id="notes-text" v-model="notesDraft" rows="5" maxlength="5000" data-testid="notes-text" placeholder="Qué pidió, qué le preocupa, con quién hablar…"
          class="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-navy placeholder:text-text-muted focus:border-cyan focus:outline-none"></textarea>
        <p v-if="notesError" class="text-xs font-bold text-danger" data-testid="notes-error">{{ notesError }}</p>
      </form>
      <template #footer>
        <button type="button" class="cursor-pointer px-4 py-2 text-sm font-bold text-text-secondary hover:text-navy" @click="closeNotes">Cancelar</button>
        <button type="submit" form="notes-form" data-testid="notes-confirm" :disabled="savingNotes"
          class="cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg disabled:opacity-50">
          {{ savingNotes ? 'Guardando…' : 'Guardar notas' }}
        </button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref, type PropType } from 'vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { SalesPipelineService } from '@/services/SalesPipeline.service'
import { SalesLeadsService } from '@/services/SalesLeads.service'
import { ApiError } from '@/services/http'
import {
  PIPELINE_HEATS, PIPELINE_HEAT_LABELS, PIPELINE_STAGES, PIPELINE_STAGE_LABELS,
  SALES_LOST_REASONS, SALES_LOST_REASON_LABELS,
  type PipelineHeat, type PipelineSignals, type PipelineStage, type SalesAssignee, type SalesLostReason,
  type SalesPipelineRow, type SalesProspect, type UpdateSalesProspectInput,
} from '@/types/sales-pipeline'
import type { SalesLeadStatus } from '@/types/sales-leads'
import SectionCard from '@/components/ui/SectionCard.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import Icon from '@/components/ui/Icon.vue'

const MS_POR_DIA = 86_400_000
/** Días que se ofrecen para extender la prueba (el backend acepta 1..30). */
const EXTEND_OPTIONS = [7, 15] as const
/** Etapas donde extender la prueba tiene sentido: hay un trial que alargar. Un perdido, uno que ya
 *  paga o un lead sin hotel no tienen prueba (el backend lo rechazaría igual, pero no se ofrece). */
const EXTENDABLE_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>(['registered', 'activated', 'expired'])
/** Espejo de `EXTENDABLE_TRIAL_STATUSES` del backend (extend-trial.ts): un canceled/suspended cae en la
 *  etapa "vencido" pero no tiene prueba que alargar — el POST contestaría 409 (FE-13). */
const EXTENDABLE_STATUSES: ReadonlySet<string> = new Set(['trialing', 'expired'])
const NETWORK_ERROR = 'No se pudo conectar con el servidor'

const STAGE_CLASS: Record<PipelineStage, string> = {
  contact: 'bg-navy/10 text-navy',
  registered: 'bg-cyan/10 text-cyan',
  activated: 'bg-teal/10 text-teal',
  paying: 'bg-teal/15 text-teal',
  expired: 'bg-danger/10 text-danger',
  lost: 'bg-surface text-text-muted',
}
const STAGE_DOT: Record<PipelineStage, string> = {
  contact: 'bg-navy', registered: 'bg-cyan', activated: 'bg-teal', paying: 'bg-teal', expired: 'bg-danger', lost: 'bg-text-muted',
}
// Texto oscuro sobre fondo claro (WCAG AA >= 4.5:1, medido con la paleta de Tailwind 4):
// red-800/red-100 = 6.85:1 · amber-800/amber-100 = 6.36:1 · slate-700/slate-100 = 9.45:1.
// Los tokens `coral`/`gold` sobre `/10` daban 3.4:1 y 2.6:1: ilegibles a 12px.
const HEAT_CLASS: Record<PipelineHeat, string> = {
  hot: 'bg-red-100 text-red-800',
  warm: 'bg-amber-100 text-amber-800',
  cold: 'bg-slate-100 text-slate-700',
}
const HEAT_ICON: Record<PipelineHeat, string> = { hot: '🔥', warm: '☀️', cold: '❄️' }

// ─── Botones de contacto (WhatsApp / Email / Llamar) ────────────────────────────────
// Sin teléfono válido el botón queda DESHABILITADO con tooltip: un `href` vacío sería un enlace
// roto que abre una pestaña en blanco. Componente local: se pinta en la tabla y en "Vencen hoy";
// `scope` prefija los data-testid para que la misma fila no repita ids en los dos lugares.
const SVG_WA = '<svg viewBox="0 0 24 24" fill="currentColor" class="h-full w-full"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 00-8.6 15l-1.4 5 5.2-1.4A10 10 0 1012 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1112 20.2z"/></svg>'
const SVG_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>'
const SVG_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>'

const BTN = 'grid h-8 w-8 place-items-center rounded-lg transition-colors'
const BTN_ON = 'cursor-pointer text-navy hover:bg-navy/10'
const BTN_OFF = 'cursor-not-allowed text-text-muted/50'

const ContactButtons = defineComponent({
  name: 'ContactButtons',
  props: {
    row: { type: Object as PropType<SalesPipelineRow>, required: true },
    scope: { type: String, default: '' },
  },
  setup(props) {
    const link = (href: string | null, svg: string, label: string, offTitle: string, testId: string, external = false) => {
      const icon = h('span', { class: 'h-4 w-4', innerHTML: svg })
      if (href) {
        return h('a', {
          href, title: label, 'aria-label': label, 'data-testid': testId,
          class: `${BTN} ${BTN_ON}`,
          ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        }, [icon])
      }
      return h('button', {
        type: 'button', disabled: true, title: offTitle, 'aria-label': offTitle, 'aria-disabled': 'true', 'data-testid': testId,
        class: `${BTN} ${BTN_OFF}`,
      }, [icon])
    }
    return () => {
      const r = props.row
      const id = (action: string) => `${props.scope}${action}-${r.key}`
      const phoneHref = r.phone ? `tel:${r.phone.replace(/[^\d+]/g, '')}` : null
      return [
        link(r.whatsappUrl, SVG_WA, 'Escribir por WhatsApp', r.phone ? 'WhatsApp: el teléfono no sirve para WhatsApp' : 'WhatsApp: sin teléfono', id('wa'), true),
        link(r.email ? `mailto:${r.email}` : null, SVG_MAIL, 'Enviar email', 'Email: sin email', id('mail')),
        link(phoneHref, SVG_PHONE, 'Llamar', 'Llamar: sin teléfono', id('tel')),
      ]
    }
  },
})

// ─── Estado ─────────────────────────────────────────────────────────────────────────
const toast = useToast()
const rows = ref<SalesPipelineRow[]>([])
const assignees = ref<SalesAssignee[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const stageFilter = ref<PipelineStage | ''>('')
const heatFilter = ref<PipelineHeat | ''>('')
const busy = reactive<Record<string, boolean>>({})
const rowErrors = reactive<Record<string, string>>({})

interface StepDraft { nextStepAt: string; nextStepNote: string; assignedTo: string }
const drafts = reactive<Record<string, StepDraft>>({})

const lostTarget = ref<SalesPipelineRow | null>(null)
const lostReason = ref<SalesLostReason | ''>('')
const lostNote = ref('')
const lostError = ref('')
const savingLost = ref(false)

const notesTarget = ref<SalesPipelineRow | null>(null)
const notesDraft = ref('')
const notesError = ref('')
const savingNotes = ref(false)

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e) => toast.error('No se pudo borrar', errorMessage(e, 'No se pudo borrar')),
})

// ─── Derivados ──────────────────────────────────────────────────────────────────────
const countByStage = computed(() => {
  const out = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<PipelineStage, number>
  for (const r of rows.value) out[r.stage]++
  return out
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (stageFilter.value && r.stage !== stageFilter.value) return false
    if (heatFilter.value && r.heat !== heatFilter.value) return false
    if (!q) return true
    return [r.hotelName, r.ownerName, r.email].some((v) => (v ?? '').toLowerCase().includes(q))
  })
})

/** `nextStepAt` hasta el final del día de hoy (local). Un perdido ya no tiene próximo paso. */
function isDue(row: SalesPipelineRow): boolean {
  if (row.stage === 'lost' || !row.nextStepAt) return false
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const t = Date.parse(row.nextStepAt)
  return !Number.isNaN(t) && t <= end.getTime()
}

const dueToday = computed(() => rows.value.filter(isDue))

function clearFilters() {
  search.value = ''
  stageFilter.value = ''
  heatFilter.value = ''
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message
  // `fetch` caído (sin red, backend apagado) rechaza con un TypeError pelado, no con ApiError.
  if (e instanceof TypeError) return NETWORK_ERROR
  return fallback
}

// ─── Etiquetas ──────────────────────────────────────────────────────────────────────
function titleOf(row: SalesPipelineRow): string {
  return row.hotelName || row.ownerName || row.email || row.key
}

function planLabel(slug: string): string {
  const s = slug.replace(/^plan-/, '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Nombre del responsable a partir de `users.id`. Un valor que no matchea (texto libre de antes
 *  del select) se muestra tal cual para no perderlo. */
function assigneeName(id: string): string {
  return assignees.value.find((u) => u.id === id)?.name ?? id
}

/** Opciones del select: los admins, más el valor actual de la fila si no es uno de ellos (así el
 *  select no lo descarta en silencio y "Guardar" no aparece sucio sin que nadie haya tocado nada). */
function assigneeOptions(row: SalesPipelineRow): SalesAssignee[] {
  const cur = row.assignedTo
  if (cur && !assignees.value.some((u) => u.id === cur)) {
    return [...assignees.value, { id: cur, name: cur, email: '' }]
  }
  return assignees.value
}

function daysAgo(iso: string): number | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / MS_POR_DIA)
}

function agoLabel(iso: string): string {
  const d = daysAgo(iso)
  if (d === null) return ''
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  return `hace ${d} d`
}

function dueLabel(row: SalesPipelineRow): string {
  const d = row.nextStepAt ? daysAgo(row.nextStepAt) : null
  if (d === null || d <= 0) return 'Para hoy'
  return d === 1 ? 'Venció ayer' : `Venció hace ${d} d`
}

/**
 * `daysLeft` es `ceil((trialEndsAt - now) / día)` en el backend: `1` = termina hoy más tarde o
 * mañana; `0` = venció hace menos de un día; negativo = venció hace N días. La etapa (`expired`)
 * la decide el backend con la misma fecha; acá no se recalcula.
 */
function trialLabel(row: SalesPipelineRow): string {
  if (row.stage === 'paying' || row.subscriptionStatus === 'active') return 'Suscripción activa'
  const d = row.daysLeft ?? 0
  if (d > 0) return `${d} ${d === 1 ? 'día' : 'días'} de prueba`
  if (d === 0) return 'Prueba vencida hoy'
  return `Prueba vencida hace ${Math.abs(d)} d`
}

function signalChips(s: PipelineSignals): Array<{ label: string; on: boolean }> {
  const seen = s.lastActivityAt ? daysAgo(s.lastActivityAt) : null
  return [
    { label: `${s.rooms} hab`, on: s.rooms > 0 },
    { label: `${s.rates} ${s.rates === 1 ? 'tarifa' : 'tarifas'}`, on: s.rates > 0 },
    { label: `${s.channels} ${s.channels === 1 ? 'canal' : 'canales'}`, on: s.channels > 0 },
    { label: `${s.reservations} ${s.reservations === 1 ? 'reserva' : 'reservas'}`, on: s.reservations > 0 },
    { label: seen === null ? 'nunca entró' : `visto ${seen <= 0 ? 'hoy' : `hace ${seen} d`}`, on: seen !== null && seen <= 3 },
  ]
}

function canExtend(row: SalesPipelineRow): boolean {
  return !!row.hotelId && EXTENDABLE_STAGES.has(row.stage) && EXTENDABLE_STATUSES.has(row.subscriptionStatus ?? '')
}

// ─── Próximo paso inline ────────────────────────────────────────────────────────────
/** ISO → `yyyy-mm-dd` en hora local (lo que entiende `<input type="date">`). */
function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** `yyyy-mm-dd` → ISO al mediodía local: el día no se corre al cruzar husos horarios. */
function fromDateInput(value: string): string | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString()
}

function draftOf(row: SalesPipelineRow): StepDraft {
  if (!drafts[row.key]) {
    drafts[row.key] = {
      nextStepAt: toDateInput(row.nextStepAt),
      nextStepNote: row.nextStepNote ?? '',
      assignedTo: row.assignedTo ?? '',
    }
  }
  return drafts[row.key]!
}

function isDirty(row: SalesPipelineRow): boolean {
  const d = draftOf(row)
  return d.nextStepAt !== toDateInput(row.nextStepAt)
    || d.nextStepNote !== (row.nextStepNote ?? '')
    || d.assignedTo !== (row.assignedTo ?? '')
}

function isBusy(row: SalesPipelineRow): boolean {
  return !!busy[row.key]
}

/** Vuelca lo anotado que devolvió el PUT sobre la fila en memoria. La etapa NO se recalcula acá:
 *  la trae `refresh()` del backend, que es quien la define. */
function applyProspect(row: SalesPipelineRow, p: SalesProspect) {
  row.nextStepAt = p.nextStepAt
  row.nextStepNote = p.nextStepNote
  row.assignedTo = p.assignedTo
  row.contactedAt = p.contactedAt
  row.lostAt = p.lostAt
  row.lostReason = p.lostReason
  row.notes = p.notes
  delete drafts[row.key]
}

/**
 * Un lead del formulario sigue siendo una fila de `sales_leads`: su `status` es lo que cuenta el
 * badge del menú ("Pipeline de ventas N" = leads en `new`). Contactarlo, perderlo o recuperarlo
 * tiene que moverlo, si no el badge no baja nunca. Un hotel no tiene fila ahí: no se toca.
 */
async function syncLeadStatus(row: SalesPipelineRow, status: SalesLeadStatus | undefined): Promise<void> {
  if (!row.leadId || !status) return
  await SalesLeadsService.update(row.leadId, { status })
}

/** Vuelve a pedir la lista sin pasar por el skeleton: etapa, calor y orden los decide el backend.
 *  Si falla, la fila conserva lo que ya se aplicó en memoria (el PUT sí se guardó). */
async function refresh(): Promise<void> {
  try {
    const res = await SalesPipelineService.list()
    rows.value = res.data
  } catch {
    // La acción ya está persistida; un refresco caído no la deshace.
  }
}

async function putProspect(
  row: SalesPipelineRow,
  input: UpdateSalesProspectInput,
  okMessage: string,
  leadStatus?: SalesLeadStatus,
): Promise<boolean> {
  busy[row.key] = true
  rowErrors[row.key] = ''
  try {
    const saved = await SalesPipelineService.updateProspect(row.key, input)
    applyProspect(row, saved)
    await syncLeadStatus(row, leadStatus)
    toast.success(okMessage)
    await refresh()
    return true
  } catch (e) {
    const msg = errorMessage(e, 'No se pudo guardar')
    rowErrors[row.key] = msg
    toast.error('No se pudo guardar', msg)
    return false
  } finally {
    busy[row.key] = false
  }
}

async function saveStep(row: SalesPipelineRow) {
  const d = draftOf(row)
  await putProspect(row, {
    nextStepAt: fromDateInput(d.nextStepAt),
    nextStepNote: d.nextStepNote.trim() || null,
    assignedTo: d.assignedTo.trim() || null,
  }, 'Próximo paso guardado')
}

/** Contactar cierra el próximo paso que estaba vencido o para hoy; uno agendado a futuro se respeta. */
async function markContacted(row: SalesPipelineRow) {
  const input: UpdateSalesProspectInput = { contactedAt: new Date().toISOString() }
  if (isDue(row)) {
    input.nextStepAt = null
    input.nextStepNote = null
  }
  await putProspect(row, input, `${titleOf(row)}: contactado`, 'contacted')
}

async function recover(row: SalesPipelineRow) {
  await putProspect(row, { lostReason: null, lostAt: null }, `${titleOf(row)} vuelve al pipeline`, row.contactedAt ? 'contacted' : 'new')
}

// ─── Perdido ────────────────────────────────────────────────────────────────────────
function openLost(row: SalesPipelineRow) {
  lostTarget.value = row
  lostReason.value = ''
  lostNote.value = ''
  lostError.value = ''
}

function closeLost() {
  if (savingLost.value) return
  lostTarget.value = null
}

async function confirmLost() {
  const row = lostTarget.value
  if (!row) return
  // Sin motivo NO hay petición: un "perdido" sin porqué no sirve para aprender nada.
  if (!lostReason.value) {
    lostError.value = 'Elegí un motivo para marcarlo como perdido.'
    return
  }
  savingLost.value = true
  const input: UpdateSalesProspectInput = { lostReason: lostReason.value }
  if (lostNote.value.trim()) input.notes = lostNote.value.trim()
  const ok = await putProspect(row, input, `${titleOf(row)} marcado como perdido`, 'lost')
  savingLost.value = false
  if (ok) lostTarget.value = null
}

// ─── Notas ──────────────────────────────────────────────────────────────────────────
function openNotes(row: SalesPipelineRow) {
  notesTarget.value = row
  notesDraft.value = row.notes ?? ''
  notesError.value = ''
}

function closeNotes() {
  if (savingNotes.value) return
  notesTarget.value = null
}

async function saveNotes() {
  const row = notesTarget.value
  if (!row) return
  savingNotes.value = true
  notesError.value = ''
  const ok = await putProspect(row, { notes: notesDraft.value.trim() || null }, 'Notas guardadas')
  savingNotes.value = false
  if (ok) notesTarget.value = null
  else notesError.value = rowErrors[row.key] || 'No se pudieron guardar las notas'
}

// ─── Borrar lead ────────────────────────────────────────────────────────────────────
/** Solo las consultas del formulario se borran (un hotel registrado no se borra desde acá). */
function askDelete(row: SalesPipelineRow) {
  const leadId = row.leadId
  if (!leadId) return
  askConfirm({
    title: 'Borrar consulta',
    message: `¿Borrar la consulta de ${titleOf(row)}${row.email ? ` (${row.email})` : ''}? Esta acción no se puede deshacer.`,
    confirmLabel: 'Borrar',
    danger: true,
    run: async () => {
      await SalesLeadsService.remove(leadId)
      rows.value = rows.value.filter((r) => r.key !== row.key)
      delete drafts[row.key]
      toast.success('Consulta borrada')
    },
  })
}

// ─── Extender trial ─────────────────────────────────────────────────────────────────
async function extend(row: SalesPipelineRow, days: number) {
  if (!row.hotelId) return
  busy[row.key] = true
  rowErrors[row.key] = ''
  try {
    const res = await SalesPipelineService.extendTrial(row.hotelId, days)
    // Lo que devolvió el servidor va a la fila ya; la etapa nueva la trae el refresco.
    row.daysLeft = res.daysLeft
    row.subscriptionStatus = res.subscription.status
    row.trialEndsAt = res.subscription.trialEndsAt
    toast.success(`Prueba extendida ${days} días`, `${titleOf(row)}: le quedan ${res.daysLeft} días`)
    await refresh()
  } catch (e) {
    const msg = errorMessage(e, 'No se pudo extender la prueba')
    rowErrors[row.key] = msg
    toast.error('No se pudo extender la prueba', msg)
  } finally {
    busy[row.key] = false
  }
}

// ─── Carga ──────────────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  error.value = ''
  try {
    // Los responsables son un complemento: si ese endpoint falla, la pantalla carga igual y el
    // select ofrece solo "Sin responsable".
    const [res, users] = await Promise.all([
      SalesPipelineService.list(),
      SalesPipelineService.assignees().then((r) => r.data, () => [] as SalesAssignee[]),
    ])
    rows.value = res.data
    assignees.value = users
    for (const k of Object.keys(drafts)) delete drafts[k]
  } catch (e) {
    error.value = errorMessage(e, 'No se pudo cargar el pipeline')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped></style>
