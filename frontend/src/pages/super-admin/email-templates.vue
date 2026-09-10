<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h2 class="text-xl font-black text-navy">Plantillas de Email</h2>
      <p class="text-sm text-text-muted mt-0.5">Editá el contenido y activá o desactivá los emails automáticos de la plataforma (bienvenida, trial, pagos, cancelación)</p>
    </div>

    <SectionCard title="Eventos de la plataforma" :subtitle="`${orderedTemplates.length} de ${EVENT_ORDER.length} plantilla(s)`" body-class="p-0">
      <!-- Skeleton -->
      <div v-if="loading" class="space-y-3 p-5">
        <div v-for="i in 6" :key="i" class="h-12 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <EmptyState v-else-if="!orderedTemplates.length"
        :icon="ICON_MAIL"
        title="No se pudieron cargar las plantillas"
        message="Verificá que el backend esté disponible y volvé a intentar.">
        <template #action>
          <button @click="load" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Reintentar</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Evento</th>
              <th class="text-left px-4 py-3 text-[10px]">Asunto</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Última edición</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tpl in orderedTemplates" :key="tpl.event"
              @click="openEdit(tpl)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer">
              <td class="px-4 py-3">
                <div class="text-sm font-black text-navy">{{ eventLabel(tpl.event) }}</div>
                <div class="text-[11px] text-text-muted font-mono">{{ tpl.event }}</div>
              </td>
              <td class="px-4 py-3">
                <span v-if="tpl.subject" class="block text-sm text-text-secondary truncate max-w-[320px]">{{ tpl.subject }}</span>
                <span v-else class="text-sm text-text-muted">Sin asunto</span>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <span v-if="tpl.updatedAt" class="text-xs text-text-muted">{{ formatDate(tpl.updatedAt) }}</span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
                  :class="tpl.isActive ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
                  {{ tpl.isActive ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="openEdit(tpl)" title="Editar plantilla"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EDIT"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal editar plantilla -->
    <AppModal v-if="modal.show" size="lg"
      :title="modal.event ? eventLabel(modal.event) : ''"
      subtitle="Plantilla de email de la plataforma"
      @close="modal.show = false">
      <div class="space-y-4">
        <!-- Activación -->
        <label class="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 cursor-pointer">
          <span class="min-w-0">
            <span class="block text-[11px] font-bold uppercase tracking-wide text-navy">Plantilla activa</span>
            <span class="block text-[11px] text-text-muted">{{ form.isActive ? 'Se envía a los hoteles cuando ocurre el evento' : 'Pausada: no se enviará hasta reactivarla' }}</span>
          </span>
          <span class="relative inline-flex shrink-0">
            <input v-model="form.isActive" type="checkbox" class="peer sr-only" />
            <span class="block h-6 w-11 rounded-full bg-border transition-colors peer-checked:bg-teal"></span>
            <span class="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"></span>
          </span>
        </label>

        <div>
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Evento</label>
          <div class="text-sm font-bold text-navy">{{ modal.event ? eventLabel(modal.event) : '' }}</div>
          <div class="text-[11px] text-text-muted font-mono">{{ modal.event }}</div>
        </div>

        <div v-if="modalVariables.length">
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Variables disponibles</label>
          <div class="flex flex-wrap gap-1">
            <span v-for="v in modalVariables" :key="v" @click="insertVariable(v)"
              class="px-2.5 py-1 bg-navy/5 text-navy rounded-full text-[10px] font-bold font-mono cursor-pointer hover:bg-navy/10 transition-colors">{{ variableToken(v) }}</span>
          </div>
          <p class="mt-1 text-[10px] text-text-muted">Click en una variable para insertarla en el asunto o el cuerpo (según el campo que tengas enfocado).</p>
        </div>

        <div>
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Asunto</label>
          <input ref="subjectInputEl" v-model="form.subject" type="text" class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
        </div>

        <div>
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Cuerpo (HTML)</label>
          <textarea ref="bodyTextareaEl" v-model="form.body" rows="10"
            class="w-full px-4 py-2.5 rounded-2xl border border-border text-xs resize-y font-mono"></textarea>
        </div>

        <!-- Enviar de prueba -->
        <div class="rounded-2xl border border-border bg-surface px-4 py-3">
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Enviar de prueba</label>
          <div class="flex flex-col sm:flex-row gap-2">
            <input v-model="testEmail" type="email" placeholder="tu@email.com"
              class="flex-1 px-4 py-2.5 rounded-full border border-border text-sm bg-white" />
            <button @click="sendTest" :disabled="testing || !testEmail"
              class="shrink-0 rounded-full bg-cyan px-5 py-2.5 text-sm font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
              {{ testing ? 'Enviando...' : 'Enviar prueba' }}
            </button>
          </div>
          <p v-if="testResult" class="mt-2 text-[11px] font-bold" :class="testResult.ok ? 'text-teal' : 'text-coral'">{{ testResult.message }}</p>
        </div>
      </div>

      <template #footer>
        <button @click="modal.show = false" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import {
  PlatformEmailsService,
  PLATFORM_EMAIL_EVENTS,
  parsePlatformEmailVariables,
  type PlatformEmailEvent,
  type PlatformEmailTemplate,
} from '@/services/PlatformEmails.service'

const ICON_EDIT = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>'
const ICON_MAIL = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>'

// Los eventos son fijos (los define el backend): no se crean ni se borran filas, solo se editan.
// El total del subtítulo sale de esta lista, no de un número escrito a mano (FE-14).
const EVENT_ORDER: readonly PlatformEmailEvent[] = PLATFORM_EMAIL_EVENTS
const EVENT_LABELS: Record<PlatformEmailEvent, string> = {
  welcome: 'Bienvenida',
  trial_ending: 'Aviso: trial por vencer',
  trial_expired: 'Trial vencido',
  trial_extended: 'Trial extendido',
  activation_no_rooms: 'Activación: sin habitaciones',
  activation_no_rates: 'Activación: sin tarifas',
  activation_no_channel: 'Activación: sin canales',
  trial_offer: 'Oferta: trial por vencer',
  trial_rescue_1: 'Rescate 1: trial vencido (+2 d)',
  trial_rescue_2: 'Rescate 2: trial vencido (+7 d)',
  payment_succeeded: 'Pago exitoso',
  payment_failed: 'Pago fallido',
  subscription_canceled: 'Suscripción cancelada',
  subscription_renewal_auto: 'Aviso: renovación automática',
  subscription_renewal_manual: 'Aviso: renovación manual',
  subscription_suspended: 'Suscripción suspendida',
  subscription_reactivated: 'Suscripción reactivada',
}
function eventLabel(event: PlatformEmailEvent | string): string {
  return EVENT_LABELS[event as PlatformEmailEvent] || event
}
function variableToken(v: string): string {
  return '{' + v + '}'
}

const toast = useToast()

const templates = ref<PlatformEmailTemplate[]>([])
const loading = ref(true)

// Orden estable por EVENT_ORDER, sin importar el orden en que responda el backend.
const orderedTemplates = computed(() => {
  const byEvent = new Map(templates.value.map(t => [t.event, t]))
  const known = EVENT_ORDER.map(ev => byEvent.get(ev)).filter((t): t is PlatformEmailTemplate => !!t)
  const rest = templates.value.filter(t => !EVENT_ORDER.includes(t.event))
  return [...known, ...rest]
})

async function load() {
  loading.value = true
  try {
    const r = await PlatformEmailsService.list()
    // Contrato: array directo. Defensivo por si el envelope lo anida en { data: [...] }.
    templates.value = Array.isArray(r) ? r : ((r as { data?: PlatformEmailTemplate[] })?.data ?? [])
  } catch (e) {
    templates.value = []
    toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las plantillas de email')
  } finally {
    loading.value = false
  }
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// --- Modal edición ---
const modal = ref<{ show: boolean; event: PlatformEmailEvent | null }>({ show: false, event: null })
const form = ref({ subject: '', body: '', isActive: true })
const saving = ref(false)
const subjectInputEl = ref<HTMLInputElement | null>(null)
const bodyTextareaEl = ref<HTMLTextAreaElement | null>(null)

const modalVariables = computed(() => {
  if (!modal.value.event) return []
  const tpl = templates.value.find(t => t.event === modal.value.event)
  return tpl ? parsePlatformEmailVariables(tpl.variables) : []
})

function openEdit(tpl: PlatformEmailTemplate) {
  modal.value = { show: true, event: tpl.event }
  form.value = { subject: tpl.subject || '', body: tpl.body || '', isActive: !!tpl.isActive }
  testEmail.value = ''
  testResult.value = null
}

// Inserta la variable clickeada en el campo (asunto o cuerpo) que tenga el foco.
function insertVariable(v: string) {
  const token = `{${v}}`
  const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null
  const target = (el === subjectInputEl.value || el === bodyTextareaEl.value) ? el : bodyTextareaEl.value
  if (!target) { form.value.body += token; return }
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? start
  target.value = target.value.slice(0, start) + token + target.value.slice(end)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus()
}

async function save() {
  if (!modal.value.event) return
  if (!form.value.subject.trim()) { toast.error('Falta el asunto'); return }
  saving.value = true
  try {
    const updated = await PlatformEmailsService.update(modal.value.event, {
      subject: form.value.subject,
      body: form.value.body,
      isActive: form.value.isActive,
    })
    const idx = templates.value.findIndex(t => t.event === modal.value.event)
    if (idx >= 0) templates.value[idx] = { ...templates.value[idx], ...updated }
    toast.success('Plantilla actualizada')
    modal.value.show = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo guardar la plantilla')
  } finally {
    saving.value = false
  }
}

// --- Enviar de prueba ---
const testEmail = ref('')
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

async function sendTest() {
  if (!modal.value.event || !testEmail.value) return
  testing.value = true
  testResult.value = null
  try {
    const result = await PlatformEmailsService.test(modal.value.event, testEmail.value)
    if (result?.sent) {
      testResult.value = { ok: true, message: 'Email de prueba enviado correctamente' }
      toast.success('Email de prueba enviado')
    } else {
      testResult.value = { ok: false, message: 'El servidor no pudo enviar el email de prueba' }
      toast.error('No se pudo enviar el email de prueba')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al enviar el email de prueba'
    testResult.value = { ok: false, message: msg }
    toast.error(msg)
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<style scoped></style>
