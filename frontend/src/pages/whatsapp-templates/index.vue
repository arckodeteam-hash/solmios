<template>
  <div>
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Plantillas WhatsApp</h2>
        <p class="text-sm text-text-muted mt-0.5">Textos predefinidos reutilizables al comunicarte con huéspedes</p>
      </div>
      <button @click="openNew" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">+ Nueva Plantilla</button>
    </div>

    <!-- Estadísticas rápidas -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Plantillas" :value="templates.length" icon="bookings" accent="blue"
        unit="Textos guardados" />
      <KpiHeroCard label="Activas" :value="activeCount" icon="checkin" accent="teal"
        :unit="`${inactiveCount} inactiva(s)`" :progress="activePct" />
      <KpiHeroCard label="Categorías" :value="categoriesCount" icon="building" accent="purple"
        unit="En uso" />
    </div>

    <!-- Lista de plantillas -->
    <SectionCard
      title="Listado de plantillas"
      :subtitle="`${templates.length} plantilla(s) · ${activeCount} activa(s)`"
      body-class="p-0"
    >
      <template #actions>
        <button @click="openNew" class="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/15 transition-colors cursor-pointer">
          Nueva plantilla
        </button>
      </template>

      <!-- Carga: esqueleto de filas -->
      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
      </div>

      <EmptyState
        v-else-if="!templates.length"
        :icon="ICON_MESSAGE"
        title="Todavía no hay plantillas"
        message="Creá tu primera plantilla para responder más rápido a tus huéspedes por WhatsApp."
      >
        <template #action>
          <button @click="openNew" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Crear plantilla
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[820px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Plantilla</th>
              <th class="text-left px-4 py-3 text-[10px]">Mensaje</th>
              <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Variables</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="t in templates"
              :key="t.id"
              @click="openEdit(t)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer"
            >
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/5 text-navy">
                    <span class="block h-4 w-4" v-html="categoryIcon(t.category)"></span>
                  </span>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-navy truncate">{{ t.name }}</div>
                    <div class="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                      {{ categoryLabel(t.category) }}
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <p v-if="t.body" class="max-w-[360px] text-xs text-text-secondary line-clamp-2">{{ t.body }}</p>
                <span v-else class="text-xs text-text-muted">Sin contenido</span>
              </td>
              <td class="px-4 py-3 text-right hidden lg:table-cell">
                <span v-if="variableCount(t.body)" class="inline-flex items-center rounded-full bg-gold/10 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-gold">
                  {{ variableCount(t.body) }}
                </span>
                <span v-else class="text-xs text-text-muted">Sin variables</span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide"
                  :class="t.isActive ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">
                  {{ t.isActive ? 'Activa' : 'Inactiva' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button v-if="t.body" @click.stop="testTemplate(t)" title="Probar en WhatsApp"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_SEND"></span>
                  </button>
                  <button @click.stop="openEdit(t)" title="Editar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal crear/editar -->
    <AppModal
      v-if="modal.show"
      size="lg"
      :title="modal.edit ? 'Editar plantilla' : 'Nueva plantilla'"
      subtitle="Se envía por WhatsApp con las variables reemplazadas"
      @close="modal.show = false"
    >
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="sm:col-span-2">
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Nombre *</label>
            <!-- Error de validación anclado al campo (mismo fix que auto-messages): un toast
                 efímero con el modal abierto se lee como "Guardar no hace nada". -->
            <input v-model="form.name" @input="nameError = ''" type="text" data-testid="whatsapp-template-name"
              placeholder="Bienvenida, Confirmación, etc."
              class="w-full px-4 py-2.5 rounded-full border text-sm focus:outline-none focus:border-cyan transition-colors" :class="nameError ? 'border-coral' : 'border-border'" />
            <p v-if="nameError" data-testid="whatsapp-template-name-error" class="mt-1 text-[11px] font-bold text-coral">{{ nameError }}</p>
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Categoría</label>
            <select v-model="form.category" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer focus:outline-none focus:border-cyan transition-colors">
              <option value="general">General</option>
              <option value="reservation">Reserva</option>
              <option value="checkin">Check-in</option>
              <option value="checkout">Check-out</option>
              <option value="payment">Pago</option>
              <option value="marketing">Marketing</option>
            </select>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer rounded-2xl border border-border bg-surface/60 px-4 py-3">
          <input v-model="form.isActive" type="checkbox" class="w-4 h-4 rounded text-cyan" />
          <span class="text-xs font-bold text-navy">Plantilla activa</span>
          <span class="text-[11px] text-text-muted">— disponible al escribirle a un huésped</span>
        </label>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted">Cuerpo del mensaje *</label>
            <span class="text-[10px] font-bold tabular-nums" :class="(form.body || '').length > 1024 ? 'text-coral' : 'text-text-muted'">
              {{ (form.body || '').length }} / 1024
            </span>
          </div>
          <textarea v-model="form.body" @input="bodyError = ''" rows="6" data-testid="whatsapp-template-body"
            :class="bodyError ? 'border-coral' : 'border-border'"
            placeholder="Hola {guest_name}! Gracias por reservar en {hotel_name}. Te esperamos el {checkin_date} en {room_number}."
            class="w-full px-4 py-3 rounded-2xl border text-sm resize-none focus:outline-none focus:border-cyan transition-colors"></textarea>
          <p v-if="bodyError" data-testid="whatsapp-template-body-error" class="mt-1 text-[11px] font-bold text-coral">{{ bodyError }}</p>
          <p class="text-[10px] text-text-muted mt-1">Longitud máxima de WhatsApp: 1024 caracteres.</p>
        </div>

        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Variables disponibles (click para insertar)</label>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="v in variables" :key="v" @click="insertVariable(v)" type="button"
              class="px-2.5 py-1 bg-navy/5 text-navy rounded-full text-[10px] font-bold cursor-pointer hover:bg-navy/10 transition-colors">{{ v }}</button>
          </div>
        </div>

        <!-- Preview como burbuja de chat -->
        <div v-if="form.body" class="border-t border-border pt-4">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Vista previa</div>
          <div class="rounded-2xl bg-surface p-4">
            <div class="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-teal/20 bg-teal/10 px-4 py-3">
              <p class="text-xs whitespace-pre-wrap text-navy">{{ preview }}</p>
              <div class="mt-1.5 text-right text-[9px] font-bold text-teal">Ejemplo con datos de demo</div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <button v-if="modal.edit" @click="deleteTemplate" class="mr-auto text-[11px] font-bold text-coral hover:text-navy transition-colors cursor-pointer">Eliminar</button>
        <button @click="modal.show = false" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando...' : 'Guardar' }}</button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { WhatsappService } from '@/services/Whatsapp.service'
import type { WhatsappTemplate } from '@/services/Whatsapp.service'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'

const SVG_OPEN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
const ICON_X = `${SVG_OPEN}<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
const ICON_MESSAGE = `${SVG_OPEN}<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`
const ICON_CALENDAR = `${SVG_OPEN}<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`
const ICON_BELL = `${SVG_OPEN}<path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z"/><path d="M20 16a8 8 0 0 0-16 0"/><path d="M12 4v4"/><path d="M10 4h4"/></svg>`
const ICON_LOGOUT = `${SVG_OPEN}<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`
const ICON_CARD = `${SVG_OPEN}<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`
const ICON_MEGAPHONE = `${SVG_OPEN}<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>`
const ICON_SEND = `${SVG_OPEN}<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`
const ICON_PENCIL = `${SVG_OPEN}<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`

const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Eliminada'),
  onError: (e) => toast.error((e as any)?.message || 'Error'),
})
const templates = ref<WhatsappTemplate[]>([])
const loading = ref(true)
const saving = ref(false)
const editId = ref('')
const modal = ref({ show: false, edit: false })

const form = ref<{ name: string; body: string; category: string; isActive: boolean }>({
  name: '', body: '', category: 'general', isActive: true,
})
const nameError = ref('')
const bodyError = ref('')

const variables = ['{guest_name}', '{hotel_name}', '{checkin_date}', '{checkout_date}', '{room_number}', '{nights}', '{total_amount}', '{pending_amount}', '{locator}', '{wifi_network}', '{wifi_password}', '{lock_codes}']

const activeCount = computed(() => templates.value.filter(t => t.isActive).length)
const categoriesCount = computed(() => new Set(templates.value.map(t => t.category || 'general')).size)

const inactiveCount = computed(() => templates.value.length - activeCount.value)
// % de plantillas activas — alimenta el anillo del KPI.
const activePct = computed(() => templates.value.length
  ? Math.round((activeCount.value / templates.value.length) * 100)
  : 0)

// Cuántos placeholders {{variable}} tiene la plantilla — se muestra por fila.
function variableCount(body?: string): number {
  return body ? (body.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).length : 0
}

// Mismas claves que el desplegable de categoría del formulario.
const CATEGORY_LABELS: Record<string, string> = {
  general: 'General', reservation: 'Reserva', checkin: 'Check-in',
  checkout: 'Check-out', payment: 'Pago', marketing: 'Marketing',
}
const categoryLabel = (c?: string): string => CATEGORY_LABELS[c || 'general'] ?? (c || 'General')

/** Preview con variables reemplazadas por valores demo */
const preview = computed(() => {
  return (form.value.body || '')
    .replace(/\{guest_name\}/g, 'María García')
    .replace(/\{hotel_name\}/g, 'Hotel Paraíso')
    .replace(/\{checkin_date\}/g, '15 Jul 2026')
    .replace(/\{checkout_date\}/g, '18 Jul 2026')
    .replace(/\{room_number\}/g, '204')
    .replace(/\{nights\}/g, '3')
    .replace(/\{total_amount\}/g, '$360')
    .replace(/\{pending_amount\}/g, '$120')
    .replace(/\{locator\}/g, 'HX-7842')
    .replace(/\{wifi_network\}/g, 'HotelParaiso-Guest')
    .replace(/\{wifi_password\}/g, 'paraiso2026')
    .replace(/\{lock_codes\}/g, '458219')
})

function categoryIcon(c?: string) {
  const icons: Record<string, string> = { general: ICON_MESSAGE, reservation: ICON_CALENDAR, checkin: ICON_BELL, checkout: ICON_LOGOUT, payment: ICON_CARD, marketing: ICON_MEGAPHONE }
  return icons[c || 'general'] || ICON_MESSAGE
}

function insertVariable(v: string) {
  form.value.body = (form.value.body || '') + v
}

async function load() {
  loading.value = true
  try {
    const r = await WhatsappService.list()
    templates.value = r.data || []
  } catch {
    templates.value = []
  } finally {
    loading.value = false
  }
}

function openNew() {
  editId.value = ''
  nameError.value = ''; bodyError.value = ''
  modal.value = { show: true, edit: false }
  form.value = { name: '', body: '', category: 'general', isActive: true }
}

function openEdit(t: WhatsappTemplate) {
  editId.value = t.id || ''
  nameError.value = ''; bodyError.value = ''
  modal.value = { show: true, edit: true }
  form.value = {
    name: t.name,
    body: t.body || '',
    category: t.category || 'general',
    isActive: t.isActive !== false,
  }
}

async function save() {
  // Validación anclada a cada campo (antes: solo toast efímero → el click parecía muerto).
  if (!form.value.name.trim()) {
    nameError.value = 'El nombre es obligatorio'
    toast.error('Falta nombre', 'Completá el campo Nombre del modal')
    return
  }
  if (!form.value.body.trim()) {
    bodyError.value = 'El cuerpo del mensaje es obligatorio'
    toast.error('Falta cuerpo', 'Escribí el texto que se le enviará al huésped')
    return
  }
  nameError.value = ''; bodyError.value = ''
  saving.value = true
  try {
    // isActive como 1/0: el schema del backend (UpdateTemplateSchema) lo declara `number`
    // y un boolean revienta el PUT con 400. SIN hotelId: lo inyecta el controller del token.
    const data = { name: form.value.name.trim(), body: form.value.body, category: form.value.category, isActive: form.value.isActive ? 1 : 0 }
    if (editId.value) {
      await WhatsappService.update(editId.value, data)
      toast.success('Plantilla actualizada')
    } else {
      await WhatsappService.create(data)
      toast.success('Plantilla creada')
    }
    modal.value.show = false
    await load()
  } catch (e: any) {
    // El modal queda abierto: no se pierde lo escrito.
    toast.error('No se pudo guardar', e?.message || 'Revisá los datos e intentá de nuevo')
  } finally {
    saving.value = false
  }
}

function deleteTemplate() {
  if (!editId.value) return
  askConfirm({
    title: 'Eliminar plantilla',
    message: '¿Eliminar esta plantilla? No se puede deshacer.',
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await WhatsappService.remove(editId.value)
      modal.value.show = false
      await load()
    },
  })
}

/** Abre WhatsApp Web con datos demo */
function testTemplate(t: WhatsappTemplate) {
  const text = (t.body || '')
    .replace(/\{guest_name\}/g, 'Demo Huésped')
    .replace(/\{hotel_name\}/g, 'Demo Hotel')
    .replace(/\{checkin_date\}/g, '15 Jul 2026')
    .replace(/\{checkout_date\}/g, '18 Jul 2026')
    .replace(/\{room_number\}/g, '101')
    .replace(/\{nights\}/g, '3')
    .replace(/\{total_amount\}/g, '$300')
    .replace(/\{pending_amount\}/g, '$0')
    .replace(/\{locator\}/g, 'DEMO-001')
    .replace(/\{wifi_network\}/g, 'DemoWiFi')
    .replace(/\{wifi_password\}/g, 'demo1234')
    .replace(/\{lock_codes\}/g, '123456')
  const url = WhatsappService.link('18295551234', text)
  window.open(url, '_blank')
}

onMounted(load)
</script>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-active .modal-panel, .modal-fade-leave-active .modal-panel { transition: transform 0.2s ease, opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-from .modal-panel, .modal-fade-leave-to .modal-panel { opacity: 0; transform: translateY(8px) scale(0.98); }
</style>
