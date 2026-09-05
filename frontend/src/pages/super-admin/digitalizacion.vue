<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-black text-navy">Digitalización</h1>
      <p class="text-sm text-text-secondary mt-1">
        Hoteles <strong>sin presencia digital</strong> y el acompañamiento por los cinco pasos:
        página web, configuración completa, Google Maps, Google Hotel y motor de reservas.
      </p>
    </div>

    <!-- ── Candidatos ───────────────────────────────────────────────── -->
    <section class="mb-8">
      <h2 class="text-sm font-black uppercase tracking-wide text-text-muted mb-3">
        Candidatos detectados
      </h2>

      <div v-if="loadingCandidates" class="space-y-3">
        <div v-for="i in 2" :key="i" class="h-16 bg-white rounded-2xl border border-border card-shadow animate-pulse" />
      </div>

      <div v-else-if="candidatesError" class="bg-white rounded-2xl border border-border card-shadow p-8 text-center">
        <p class="text-danger font-bold mb-2">No se pudieron cargar los candidatos</p>
        <p class="text-sm text-text-secondary mb-4">{{ candidatesError }}</p>
        <button class="text-sm font-bold text-cyan cursor-pointer hover:underline" @click="loadCandidates">Reintentar</button>
      </div>

      <div v-else-if="candidates.length === 0" class="bg-white rounded-2xl border border-border card-shadow p-8 text-center">
        <div class="text-3xl mb-2">🎉</div>
        <p class="font-bold text-navy mb-1">No hay hoteles sin página web</p>
        <p class="text-sm text-text-secondary">
          Todos los hoteles tienen web cargada o ya tienen un expediente abierto.
        </p>
      </div>

      <div v-else class="bg-white rounded-2xl border border-border card-shadow overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-surface text-left text-[11px] font-black uppercase text-text-muted tracking-wide">
                <th class="px-4 py-3">Hotel</th>
                <th class="px-4 py-3">Ciudad</th>
                <th class="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="c in candidates" :key="c.hotelId" class="hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3 font-bold text-navy">{{ c.name }}</td>
                <td class="px-4 py-3 text-text-secondary">{{ c.city || '—' }}</td>
                <td class="px-4 py-3 text-right">
                  <button
                    class="text-xs font-bold px-3 py-1.5 rounded-lg bg-cyan text-white hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
                    :disabled="startingId === c.hotelId"
                    @click="startCase(c)"
                  >
                    {{ startingId === c.hotelId ? 'Abriendo…' : 'Iniciar digitalización' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ── Expedientes ──────────────────────────────────────────────── -->
    <section>
      <h2 class="text-sm font-black uppercase tracking-wide text-text-muted mb-3">Expedientes</h2>

      <div v-if="loadingCases" class="space-y-3">
        <div v-for="i in 3" :key="i" class="h-20 bg-white rounded-2xl border border-border card-shadow animate-pulse" />
      </div>

      <div v-else-if="casesError" class="bg-white rounded-2xl border border-border card-shadow p-8 text-center">
        <p class="text-danger font-bold mb-2">No se pudieron cargar los expedientes</p>
        <p class="text-sm text-text-secondary mb-4">{{ casesError }}</p>
        <button class="text-sm font-bold text-cyan cursor-pointer hover:underline" @click="loadCases">Reintentar</button>
      </div>

      <div v-else-if="cases.length === 0" class="bg-white rounded-2xl border border-border card-shadow p-10 text-center">
        <div class="text-4xl mb-3">🗂️</div>
        <p class="font-bold text-navy mb-1">Sin expedientes todavía</p>
        <p class="text-sm text-text-secondary">
          Iniciá la digitalización de un candidato y su expediente aparece acá.
        </p>
      </div>

      <div v-else class="bg-white rounded-2xl border border-border card-shadow overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-surface text-left text-[11px] font-black uppercase text-text-muted tracking-wide">
                <th class="px-4 py-3">Hotel</th>
                <th class="px-4 py-3">Estado</th>
                <th class="px-4 py-3">Avance</th>
                <th class="px-4 py-3">Abierto</th>
                <th class="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr
                v-for="c in cases"
                :key="c.id"
                class="hover:bg-surface/60 transition-colors cursor-pointer"
                @click="openDetail(c)"
              >
                <td class="px-4 py-3 font-bold text-navy">{{ c.hotelName || c.hotelId }}</td>
                <td class="px-4 py-3">
                  <span class="text-[11px] font-black uppercase px-2 py-1 rounded-full" :class="caseStatusClass(c.status)">
                    {{ CASE_STATUS_LABELS[c.status] }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="s in DIGITALIZATION_STEPS"
                      :key="s"
                      class="text-[10px] font-black uppercase px-2 py-1 rounded-full"
                      :class="stepStatusClass(stepStatus(c, s))"
                      :title="`${STEP_LABELS[s]}: ${STEP_STATUS_LABELS[stepStatus(c, s)]}`"
                    >
                      {{ STEP_LABELS[s] }}
                    </span>
                  </div>
                </td>
                <td class="px-4 py-3 text-text-muted text-xs">{{ formatDate(c.createdAt) }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center justify-end gap-2">
                    <button
                      class="text-xs font-bold px-3 py-1.5 rounded-lg bg-navy/5 text-navy hover:bg-navy/10 transition-colors cursor-pointer"
                      @click.stop="openDetail(c)"
                    >
                      Ver
                    </button>
                    <button
                      class="text-xs font-bold px-3 py-1.5 rounded-lg bg-coral/10 text-coral hover:bg-coral/20 transition-colors cursor-pointer"
                      title="Eliminar expediente"
                      @click.stop="removeCase(c)"
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
    </section>

    <!-- Modal de detalle del expediente -->
    <div
      v-if="detail"
      class="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4"
      @click.self="closeDetail"
    >
      <div class="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-2xl">
        <div class="flex items-center justify-between px-6 py-4 bg-navy rounded-t-2xl">
          <h2 class="text-sm font-black text-white">{{ detail.hotelName || detail.hotelId }}</h2>
          <button class="text-white/70 hover:text-white text-xl leading-none cursor-pointer" @click="closeDetail">✕</button>
        </div>

        <div class="p-6 space-y-5">
          <p v-if="detailError" class="text-sm text-danger font-bold">{{ detailError }}</p>

          <!-- Paso 1 · Página web -->
          <div class="border border-border rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-black text-navy">1 · {{ STEP_LABELS.website }}</h3>
              <select
                :value="detail.websiteStatus"
                class="text-[11px] font-black uppercase px-2 py-1.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :class="stepStatusClass(detail.websiteStatus)"
                :disabled="saving"
                @change="advance('website', selectValue($event))"
              >
                <option v-for="s in STEP_STATUSES" :key="s" :value="s">{{ STEP_STATUS_LABELS[s] }}</option>
              </select>
            </div>
            <label class="block">
              <span class="text-[11px] font-black uppercase text-text-muted">Plantilla</span>
              <select v-model="draft.templateKey" class="w-full mt-1 px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan">
                <option value="">Sin elegir</option>
                <option v-for="t in templates" :key="t.key" :value="t.key">{{ t.name }} — {{ t.description }}</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] font-black uppercase text-text-muted">URL del sitio</span>
              <input
                v-model="draft.siteUrl"
                type="url"
                placeholder="https://hotel.solmios.com"
                class="w-full mt-1 px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan"
              >
            </label>
          </div>

          <!-- Paso 2 · Configuración completa -->
          <div class="border border-border rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-black text-navy">2 · {{ STEP_LABELS.config }}</h3>
              <select
                :value="detail.configStatus"
                class="text-[11px] font-black uppercase px-2 py-1.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :class="stepStatusClass(detail.configStatus)"
                :disabled="saving"
                @change="advance('config', selectValue($event))"
              >
                <option v-for="s in STEP_STATUSES" :key="s" :value="s">{{ STEP_STATUS_LABELS[s] }}</option>
              </select>
            </div>
            <label class="block">
              <span class="text-[11px] font-black uppercase text-text-muted">
                Importe de la configuración ({{ detail.configCurrency }})
              </span>
              <input
                v-model="draft.configFee"
                type="number"
                min="1"
                step="0.01"
                placeholder="Sin definir"
                class="w-full mt-1 px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan"
              >
            </label>
            <p class="text-xs text-text-muted">
              El precio de la configuración completa <strong>todavía no está definido</strong>: dejalo vacío
              hasta que se cotice. El paso igual no se cierra sin marcar el cobro.
            </p>
            <label class="flex items-center gap-2 text-sm text-navy">
              <input v-model="draft.configPaid" type="checkbox" class="cursor-pointer">
              Configuración cobrada
            </label>
          </div>

          <!-- Paso 3 · Google Maps -->
          <div class="border border-border rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-black text-navy">3 · {{ STEP_LABELS.googleMaps }}</h3>
              <select
                :value="detail.googleMapsStatus"
                class="text-[11px] font-black uppercase px-2 py-1.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :class="stepStatusClass(detail.googleMapsStatus)"
                :disabled="saving"
                @change="advance('googleMaps', selectValue($event))"
              >
                <option v-for="s in STEP_STATUSES" :key="s" :value="s">{{ STEP_STATUS_LABELS[s] }}</option>
              </select>
            </div>
            <label class="block">
              <span class="text-[11px] font-black uppercase text-text-muted">Google Place ID</span>
              <input
                v-model="draft.googlePlaceId"
                type="text"
                placeholder="ChIJ…"
                class="w-full mt-1 px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan"
              >
            </label>
            <label class="block">
              <span class="text-[11px] font-black uppercase text-text-muted">URL de la ficha</span>
              <input
                v-model="draft.googleMapsUrl"
                type="url"
                placeholder="https://maps.google.com/…"
                class="w-full mt-1 px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan"
              >
            </label>
          </div>

          <!-- Paso 4 · Google Hotel (depende de Google Maps) -->
          <div class="border border-border rounded-xl p-4 space-y-3" :class="{ 'opacity-60': !googleMapsReady }">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-black text-navy">4 · {{ STEP_LABELS.googleHotel }}</h3>
              <select
                :value="detail.googleHotelStatus"
                class="text-[11px] font-black uppercase px-2 py-1.5 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-cyan/30 disabled:cursor-not-allowed"
                :class="stepStatusClass(detail.googleHotelStatus)"
                :disabled="saving || !googleMapsReady"
                @change="advance('googleHotel', selectValue($event))"
              >
                <option v-for="s in STEP_STATUSES" :key="s" :value="s">{{ STEP_STATUS_LABELS[s] }}</option>
              </select>
            </div>
            <p v-if="!googleMapsReady" class="text-xs text-amber font-bold">
              Bloqueado: la presencia en Google Hotel se trabaja sobre la ficha de Google Maps.
              Dejá <strong>{{ STEP_LABELS.googleMaps }}</strong> en “{{ STEP_STATUS_LABELS.listo }}” para habilitar este paso.
            </p>
            <p v-else class="text-xs text-text-muted">
              {{ STEP_LABELS.googleMaps }} está listo: ya se puede publicar la ficha en Google Hotel.
            </p>
          </div>

          <!-- Paso 5 · Motor de reservas -->
          <div class="border border-border rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-black text-navy">5 · {{ STEP_LABELS.bookingEngine }}</h3>
              <select
                :value="detail.bookingEngineStatus"
                class="text-[11px] font-black uppercase px-2 py-1.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :class="stepStatusClass(detail.bookingEngineStatus)"
                :disabled="saving"
                @change="advance('bookingEngine', selectValue($event))"
              >
                <option v-for="s in STEP_STATUSES" :key="s" :value="s">{{ STEP_STATUS_LABELS[s] }}</option>
              </select>
            </div>
            <label class="block">
              <span class="text-[11px] font-black uppercase text-text-muted">URL del motor</span>
              <input
                v-model="draft.bookingEngineUrl"
                type="url"
                placeholder="https://reservas.solmios.com/hotel"
                class="w-full mt-1 px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan"
              >
            </label>
          </div>

          <!-- Notas internas -->
          <div class="border border-border rounded-xl p-4 space-y-3">
            <h3 class="text-sm font-black text-navy">Notas internas</h3>
            <p class="text-xs text-text-muted">Nunca las ve el hotel. Ej: qué se conversó, próximo paso.</p>
            <textarea
              v-model="draft.notes"
              rows="4"
              maxlength="2000"
              class="w-full px-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan leading-relaxed"
              placeholder="Plantilla elegida el 26/08, falta la foto de portada…"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button class="text-sm font-bold text-text-secondary px-4 py-2 rounded-lg hover:bg-surface transition-colors cursor-pointer" @click="closeDetail">
            Cerrar
          </button>
          <button
            class="bg-cyan text-white font-bold text-sm px-5 py-2 rounded-lg hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
            :disabled="saving"
            @click="saveDetail"
          >
            {{ saving ? 'Guardando…' : 'Guardar datos' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { DigitalizacionService } from '@/services/Digitalizacion.service'
import { ApiError } from '@/services/http'
import {
  CASE_STATUS_LABELS,
  DIGITALIZATION_STEPS,
  STEP_LABELS,
  STEP_STATUSES,
  STEP_STATUS_LABELS,
  type DigitalizationCandidate,
  type DigitalizationCase,
  type DigitalizationCaseStatus,
  type DigitalizationStep,
  type SiteTemplate,
  type StepStatus,
  type UpdateDigitalizationCaseInput,
} from '@/types/digitalizacion'

const candidates = ref<DigitalizationCandidate[]>([])
const loadingCandidates = ref(true)
const candidatesError = ref('')
const startingId = ref('')

const cases = ref<DigitalizationCase[]>([])
const loadingCases = ref(true)
const casesError = ref('')

const templates = ref<SiteTemplate[]>([])

const detail = ref<DigitalizationCase | null>(null)
const detailError = ref('')
const saving = ref(false)

/** Borrador del expediente abierto. `configFee` es string: vacío = todavía sin cotizar. */
const draft = reactive({
  templateKey: '',
  siteUrl: '',
  configFee: '',
  configPaid: false,
  googlePlaceId: '',
  googleMapsUrl: '',
  bookingEngineUrl: '',
  notes: '',
})

const googleMapsReady = computed(() => detail.value?.googleMapsStatus === 'listo')

/** Estado de un paso dentro de la fila del expediente (cada paso tiene su columna). */
function stepStatus(c: DigitalizationCase, step: DigitalizationStep): StepStatus {
  switch (step) {
    case 'website': return c.websiteStatus
    case 'config': return c.configStatus
    case 'googleMaps': return c.googleMapsStatus
    case 'googleHotel': return c.googleHotelStatus
    case 'bookingEngine': return c.bookingEngineStatus
  }
}

function stepStatusClass(status: StepStatus): string {
  switch (status) {
    case 'pendiente': return 'bg-navy/5 text-text-muted'
    case 'en_progreso': return 'bg-amber/10 text-amber'
    case 'listo': return 'bg-teal/10 text-teal'
  }
}

function caseStatusClass(status: DigitalizationCaseStatus): string {
  switch (status) {
    case 'abierto': return 'bg-cyan/10 text-cyan'
    case 'completado': return 'bg-teal/10 text-teal'
    case 'cancelado': return 'bg-coral/10 text-coral'
  }
}

/** El `<select>` del paso: su value siempre es uno de STEP_STATUSES. */
function selectValue(e: Event): StepStatus {
  return (e.target as HTMLSelectElement).value as StepStatus
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback
}

/** '' → undefined: un campo vacío no se manda, así no pisa lo guardado con un string vacío. */
function text(value: string): string | undefined {
  const v = value.trim()
  return v === '' ? undefined : v
}

/** El importe puede quedar vacío (todavía no cotizado) → undefined, nunca 0. */
function fee(): number | undefined {
  const v = draft.configFee.trim()
  if (v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

async function loadCandidates() {
  loadingCandidates.value = true
  candidatesError.value = ''
  try {
    const res = await DigitalizacionService.candidates()
    candidates.value = res.data
  } catch (e) {
    candidatesError.value = message(e, 'Error desconocido')
  } finally {
    loadingCandidates.value = false
  }
}

async function loadCases() {
  loadingCases.value = true
  casesError.value = ''
  try {
    const res = await DigitalizacionService.list()
    cases.value = res.data
  } catch (e) {
    casesError.value = message(e, 'Error desconocido')
  } finally {
    loadingCases.value = false
  }
}

async function loadTemplates() {
  try {
    const res = await DigitalizacionService.templates()
    templates.value = res.data
  } catch {
    templates.value = []
  }
}

async function startCase(c: DigitalizationCandidate) {
  startingId.value = c.hotelId
  candidatesError.value = ''
  try {
    await DigitalizacionService.create({ hotelId: c.hotelId })
    // El hotel deja de ser candidato al abrir el expediente: las dos listas cambian.
    await Promise.all([loadCandidates(), loadCases()])
  } catch (e) {
    candidatesError.value = message(e, 'No se pudo abrir el expediente')
  } finally {
    startingId.value = ''
  }
}

function openDetail(c: DigitalizationCase) {
  detail.value = c
  detailError.value = ''
  draft.templateKey = c.templateKey ?? ''
  draft.siteUrl = c.siteUrl ?? ''
  draft.configFee = c.configFee === null ? '' : String(c.configFee)
  draft.configPaid = c.configPaid
  draft.googlePlaceId = c.googlePlaceId ?? ''
  draft.googleMapsUrl = c.googleMapsUrl ?? ''
  draft.bookingEngineUrl = c.bookingEngineUrl ?? ''
  draft.notes = c.notes ?? ''
}

function closeDetail() {
  detail.value = null
}

/** Refleja el expediente actualizado en la tabla y en el modal. */
function apply(updated: DigitalizationCase) {
  const idx = cases.value.findIndex((x) => x.id === updated.id)
  if (idx !== -1) cases.value[idx] = updated
  detail.value = updated
}

/** Los datos que exige cada paso viajan en el mismo request del avance. */
function stepPayload(step: DigitalizationStep) {
  switch (step) {
    case 'website': return { templateKey: text(draft.templateKey), siteUrl: text(draft.siteUrl) }
    case 'config': return { configFee: fee(), configPaid: draft.configPaid }
    case 'googleMaps': return { googlePlaceId: text(draft.googlePlaceId), googleMapsUrl: text(draft.googleMapsUrl) }
    case 'googleHotel': return {}
    case 'bookingEngine': return { bookingEngineUrl: text(draft.bookingEngineUrl) }
  }
}

async function advance(step: DigitalizationStep, status: StepStatus) {
  if (!detail.value) return
  saving.value = true
  detailError.value = ''
  const id = detail.value.id
  try {
    apply(await DigitalizacionService.advanceStep(id, { step, status, ...stepPayload(step) }))
    // Abrir un expediente puede completarlo: los candidatos no cambian, la lista sí.
  } catch (e) {
    detailError.value = message(e, `No se pudo actualizar ${STEP_LABELS[step]}`)
    // El backend rechazó el avance: reponer el estado real para que el select no mienta.
    try {
      apply(await DigitalizacionService.getById(id))
    } catch { /* el error del avance ya está a la vista */ }
  } finally {
    saving.value = false
  }
}

/** Guarda los datos cargados (incluidas las notas) sin mover ningún paso. */
async function saveDetail() {
  if (!detail.value) return
  saving.value = true
  detailError.value = ''
  const input: UpdateDigitalizationCaseInput = {
    notes: draft.notes,
    configPaid: draft.configPaid,
    templateKey: text(draft.templateKey),
    siteUrl: text(draft.siteUrl),
    googlePlaceId: text(draft.googlePlaceId),
    googleMapsUrl: text(draft.googleMapsUrl),
    bookingEngineUrl: text(draft.bookingEngineUrl),
  }
  const importe = fee()
  if (importe !== undefined) input.configFee = importe
  try {
    apply(await DigitalizacionService.update(detail.value.id, input))
  } catch (e) {
    detailError.value = message(e, 'No se pudieron guardar los datos')
  } finally {
    saving.value = false
  }
}

async function removeCase(c: DigitalizationCase) {
  const ok = window.confirm(`¿Eliminar el expediente de ${c.hotelName || c.hotelId}? Esta acción no se puede deshacer.`)
  if (!ok) return
  try {
    await DigitalizacionService.remove(c.id)
    cases.value = cases.value.filter((x) => x.id !== c.id)
    if (detail.value?.id === c.id) closeDetail()
    // El hotel vuelve a ser candidato al quedar sin expediente vivo.
    await loadCandidates()
  } catch (e) {
    casesError.value = message(e, 'No se pudo eliminar el expediente')
  }
}

onMounted(() => {
  void loadCandidates()
  void loadCases()
  void loadTemplates()
})
</script>

<style scoped>
/* La fila del expediente abre el detalle: el cursor lo anuncia también en los chips de paso. */
tbody tr {
  vertical-align: middle;
}
</style>
