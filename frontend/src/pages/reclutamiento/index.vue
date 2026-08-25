<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 gap-3 flex-wrap">
      <div>
        <h2 class="text-xl font-black text-navy">Reclutamiento</h2>
        <p class="text-sm text-text-muted mt-0.5">Pipeline de selección — postulantes por etapa</p>
      </div>
      <button v-if="canCreate" @click="openNewApplicant"
        class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo postulante
      </button>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Postulantes" :value="totalApplicants" icon="users" accent="blue"
        unit="Total en el pipeline" />
      <KpiHeroCard label="En Proceso" :value="inProcessCount" icon="bookings" accent="purple"
        unit="Nuevos, preselección, entrevista y oferta" :progress="inProcessShare" />
      <KpiHeroCard label="Contratados" :value="hiredCount" icon="checkin" accent="teal"
        unit="Pasaron a expediente de empleado" :progress="hiredShare" />
      <KpiHeroCard label="Rechazados" :value="rejectedCount" icon="checkout" accent="rose"
        unit="Descartados del pipeline" />
    </div>

    <!-- Tablero por etapa -->
    <SectionCard title="Pipeline de selección" :subtitle="`${totalApplicants} postulante(s) en ${columns.length} etapas`">
      <!-- Skeleton -->
      <div v-if="loading" class="overflow-x-auto pb-1">
        <div class="flex gap-4 min-w-max">
          <div v-for="i in 6" :key="i" class="w-64 shrink-0 rounded-2xl border border-border bg-white p-3">
            <div class="h-4 w-24 animate-pulse rounded bg-surface"></div>
            <div class="mt-3 space-y-2">
              <div v-for="j in 3" :key="j" class="h-20 animate-pulse rounded-xl bg-surface"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pipeline vacío: explicar el módulo una vez, no seis columnas con "Sin postulantes". -->
      <EmptyState
        v-else-if="!applicants.length"
        :icon="ICON_USERS_EMPTY"
        title="Todavía no hay postulantes"
        message="Este tablero sigue a cada candidato por el proceso de selección: nuevo, preselección, entrevista, oferta y contratación. Cargá el primer postulante y movelo de etapa desde su tarjeta."
      >
        <template v-if="canCreate" #action>
          <button @click="openNewApplicant" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo postulante
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto pb-1">
        <div class="flex gap-4 min-w-max">
          <div v-for="col in columns" :key="col.stage"
            class="w-64 shrink-0 rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
            <!-- Header de columna -->
            <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <span class="text-[10px] font-bold uppercase tracking-wide" :class="col.text">{{ col.label }}</span>
              <span class="text-[10px] font-black tabular-nums px-2 py-0.5 rounded-full" :class="col.badge">
                {{ byStage(col.stage).length }}
              </span>
            </div>

            <!-- Tarjetas -->
            <div class="p-2 space-y-2">
              <div v-for="a in byStage(col.stage)" :key="a.id"
                class="rounded-xl border border-border bg-white p-3 transition-shadow hover:shadow-(--shadow-card)">
                <div class="font-bold text-navy text-sm truncate">{{ a.name }}</div>
                <div v-if="a.email || a.phone" class="text-[11px] text-text-muted truncate">{{ a.email || a.phone }}</div>
                <div v-if="a.source"
                  class="inline-block mt-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-navy/10 text-navy uppercase tracking-wide">
                  {{ a.source }}
                </div>
                <div v-if="a.stage === 'rejected' && a.rejectReason"
                  class="mt-1.5 rounded-lg bg-coral/10 px-2 py-1 text-[10px] text-coral line-clamp-2">
                  {{ a.rejectReason }}
                </div>

                <div v-if="a.stage !== 'hired' && a.stage !== 'rejected'"
                  class="mt-2.5 flex items-center gap-1 border-t border-border pt-2">
                  <button v-if="nextStage(a.stage)" @click="advance(a)"
                    :title="`Mover a ${stageLabel(nextStage(a.stage)!)}`"
                    class="h-8 w-8 grid place-items-center rounded-lg text-teal hover:bg-teal/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_ARROW_RIGHT"></span>
                  </button>
                  <button @click="hire(a)" title="Contratar"
                    class="h-8 w-8 grid place-items-center rounded-lg text-navy hover:bg-navy/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CHECK"></span>
                  </button>
                  <button @click="reject(a)" title="Rechazar"
                    class="h-8 w-8 grid place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_X"></span>
                  </button>
                </div>
              </div>

              <EmptyState v-if="byStage(col.stage).length === 0" title="Sin postulantes"
                :message="`Nadie en ${col.label.toLowerCase()} por ahora.`" />
            </div>
          </div>
        </div>
      </div>
    </SectionCard>

    <FormModal
      v-if="formModal"
      :title="formModal.title"
      :fields="formModal.fields"
      :submit-label="formModal.submitLabel"
      :loading="saving"
      @close="formModal = null"
      @submit="submitForm"
    />
    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ReclutamientoService, type Applicant } from '@/services/Reclutamiento.service'
import { useToast } from '@/composables/useToast'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useConfirm } from '@/composables/useConfirm'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePermissions } from '@/composables/usePermissions'

type FormValues = Record<string, string | number>

const toast = useToast()
const router = useRouter()
// /panel/rrhh/* está mapeada al módulo de permiso `users` (config/module-map.ts).
// Sin `users:create` el backend rechaza el alta: no se ofrece el botón.
const { can } = usePermissions()
const canCreate = computed(() => can('users', 'create'))
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({ onDone: () => load(), onError: (e) => toast.error(e instanceof Error ? e.message : 'La acción falló') })
const loading = ref(true)
const applicants = ref<Applicant[]>([])
const saving = ref(false)
const formModal = ref<{ title: string; submitLabel: string; fields: FormField[]; onSubmit: (v: FormValues) => Promise<unknown> } | null>(null)

const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-full w-full"><path d="M12 5v14M5 12h14"/></svg>'
const ICON_ARROW_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M20 6L9 17l-5-5"/></svg>'
const ICON_USERS_EMPTY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-full w-full"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M18 6L6 18M6 6l12 12"/></svg>'

const STAGES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
const STAGE_LABELS: Record<string, string> = {
  new: 'Nuevos', screening: 'Preselección', interview: 'Entrevista', offer: 'Oferta', hired: 'Contratados', rejected: 'Rechazados',
}
const columns = [
  { stage: 'new', label: 'Nuevos', bg: 'bg-navy/5', text: 'text-navy', badge: 'bg-navy/10 text-navy' },
  { stage: 'screening', label: 'Preselección', bg: 'bg-gold/5', text: 'text-gold', badge: 'bg-gold/10 text-gold' },
  { stage: 'interview', label: 'Entrevista', bg: 'bg-cyan/5', text: 'text-cyan', badge: 'bg-cyan/10 text-cyan' },
  { stage: 'offer', label: 'Oferta', bg: 'bg-teal/5', text: 'text-teal', badge: 'bg-teal/10 text-teal' },
  { stage: 'hired', label: 'Contratados', bg: 'bg-teal/10', text: 'text-teal', badge: 'bg-teal/10 text-teal' },
  { stage: 'rejected', label: 'Rechazados', bg: 'bg-coral/5', text: 'text-coral', badge: 'bg-coral/10 text-coral' },
]

function stageLabel(s: string) { return STAGE_LABELS[s] ?? s }
function byStage(stage: string) { return applicants.value.filter((a) => a.stage === stage) }
function nextStage(stage: string): string | null {
  const flow = ['new', 'screening', 'interview', 'offer']
  const i = flow.indexOf(stage)
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null
}

// KPIs — los anima KpiHeroCard internamente (useCountUp propio).
const totalApplicants = computed(() => applicants.value.length)
const hiredCount = computed(() => applicants.value.filter((a) => a.stage === 'hired').length)
const rejectedCount = computed(() => applicants.value.filter((a) => a.stage === 'rejected').length)
const inProcessCount = computed(() => totalApplicants.value - hiredCount.value - rejectedCount.value)
const inProcessShare = computed(() => (totalApplicants.value ? Math.round((inProcessCount.value / totalApplicants.value) * 100) : 0))
const hiredShare = computed(() => (totalApplicants.value ? Math.round((hiredCount.value / totalApplicants.value) * 100) : 0))

async function load() {
  loading.value = true
  try { applicants.value = await ReclutamientoService.list() }
  catch { toast.error('No se pudo cargar el pipeline') }
  finally { loading.value = false }
}
onMounted(load)

function openNewApplicant() {
  formModal.value = {
    title: 'Nuevo postulante', submitLabel: 'Agregar',
    fields: [
      { key: 'name', label: 'Nombre', required: true, maxLength: 120 },
      { key: 'email', label: 'Email', type: 'email', maxLength: 120 },
      { key: 'phone', label: 'Teléfono', type: 'tel', maxLength: 30 },
      { key: 'source', label: 'Origen', placeholder: 'web, referido, agencia…', maxLength: 40 },
      { key: 'notes', label: 'Notas', type: 'textarea', maxLength: 1000 },
    ],
    onSubmit: (v) => ReclutamientoService.create(v),
  }
}

async function advance(a: Applicant) {
  const next = nextStage(a.stage)
  if (!next) return
  try { await ReclutamientoService.moveStage(a.id, next); toast.success(`Movido a ${stageLabel(next)}`); load() }
  catch { toast.error('No se pudo mover de etapa') }
}

function reject(a: Applicant) {
  formModal.value = {
    title: `Rechazar a ${a.name}`, submitLabel: 'Rechazar',
    fields: [{ key: 'reason', label: 'Motivo del rechazo', type: 'textarea', required: true, maxLength: 500 }],
    onSubmit: (v) => ReclutamientoService.reject(a.id, String(v.reason ?? '')),
  }
}

function hire(a: Applicant) {
  askConfirm({
    title: 'Contratar postulante',
    message: `${a.name} pasará a "Contratado" y te llevamos a crear su expediente de empleado con sus datos ya cargados.`,
    confirmLabel: 'Contratar',
    run: async () => {
      await ReclutamientoService.hire(a.id)
      toast.success('Postulante contratado')
      // Conexión candidato→empleado: handoff a Empleados con el nombre y email precargados.
      router.push({ path: '/panel/rrhh/empleados', query: { newName: a.name, newEmail: a.email || '' } })
    },
  })
}

async function submitForm(values: FormValues) {
  if (!formModal.value) return
  saving.value = true
  try { await formModal.value.onSubmit(values); toast.success('Guardado'); formModal.value = null; load() }
  catch (e) { toast.error(e instanceof Error ? e.message : 'Error al guardar') }
  finally { saving.value = false }
}
</script>
