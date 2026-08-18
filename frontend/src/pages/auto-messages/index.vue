<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Envíos Automáticos</h2>
        <p class="text-sm text-text-muted mt-0.5">Mensajes programados que se envían automáticamente según eventos de la reserva</p>
      </div>
      <button @click="openNew" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="h-4 w-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo Mensaje
      </button>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Mensajes" :value="messages.length" icon="bookings" accent="blue"
        unit="Automatizaciones configuradas" />
      <KpiHeroCard label="Activos" :value="activeCount" icon="checkin" accent="teal"
        :unit="`${activeCount} de ${messages.length} enviándose`" :progress="activeShare" />
      <KpiHeroCard label="Pausados" :value="messages.length - activeCount" icon="checkout" accent="amber"
        unit="No se envían hasta activarlos" />
    </div>

    <!-- Listado -->
    <SectionCard title="Mensajes automáticos" :subtitle="`${filtered.length} de ${messages.length} mensaje(s)`" body-class="p-0">
      <template #actions>
        <select v-model="statusFilter"
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="all">Todos</option>
          <option class="text-navy" value="active">Activos</option>
          <option class="text-navy" value="inactive">Pausados</option>
        </select>
      </template>

      <!-- Skeleton -->
      <div v-if="loading" class="space-y-3 p-5">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <EmptyState v-else-if="!filtered.length"
        :icon="ICON_MAIL"
        :title="statusFilter !== 'all' ? 'Sin mensajes con este filtro' : 'Todavía no hay mensajes automáticos'"
        :message="statusFilter !== 'all' ? 'Probá con otro estado o mirá todos los mensajes.' : 'Creá el primero para avisar al huésped al confirmar, antes del check-in o al salir.'">
        <template #action>
          <button v-if="statusFilter !== 'all'" @click="statusFilter = 'all'"
            class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Ver todos</button>
          <button v-else @click="openNew"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Nuevo mensaje</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[880px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Mensaje</th>
              <th class="text-left px-4 py-3 text-[10px]">Canal</th>
              <th class="text-left px-4 py-3 text-[10px]">Disparador</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Plantilla</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Idioma</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="msg in filtered" :key="msg.id"
              @click="openEdit(msg)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer">
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: msg.color || '#3b82f6' }"></span>
                  <div class="min-w-0">
                    <div class="text-sm font-black text-navy truncate max-w-[240px]">{{ msg.title }}</div>
                    <div v-if="msg.emailSubject" class="text-[11px] text-text-muted truncate max-w-[240px]">{{ msg.emailSubject }}</div>
                    <div v-if="msg.event" class="text-[11px] text-text-muted lg:hidden">{{ eventLabel(msg.event) }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="channelClass(msg.channel)">
                  {{ channelLabel(msg.channel) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold" :class="triggerClass(msg.triggerEvent)">
                  {{ triggerLabel(msg.triggerEvent) }}
                </span>
                <div v-if="msg.triggerOffset" class="mt-1 text-[11px] font-semibold text-text-muted tabular-nums">{{ msg.triggerOffset }} días</div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">
                <span v-if="msg.event">{{ eventLabel(msg.event) }}</span>
                <span v-else class="text-text-muted">Sin plantilla</span>
              </td>
              <td class="px-4 py-3 hidden xl:table-cell">
                <span v-if="msg.language" class="inline-flex rounded-full bg-navy/5 px-2.5 py-1 text-[10px] font-extrabold text-navy">{{ langLabel(msg.language) }}</span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
                  :class="msg.isActive !== false ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
                  {{ msg.isActive !== false ? 'Activo' : 'Pausado' }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="openEdit(msg)" title="Editar mensaje"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EDIT"></span>
                  </button>
                  <button @click.stop="removeMsg(msg)" title="Eliminar mensaje"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal crear / editar -->
    <AppModal v-if="modal.show" size="lg"
      :title="modal.edit ? 'Editar Mensaje' : 'Nuevo Mensaje'"
      subtitle="Se envía solo, según el evento de la reserva"
      @close="modal.show = false">
      <div class="space-y-4">
        <!-- Activación -->
        <label class="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 cursor-pointer">
          <span class="min-w-0">
            <span class="block text-[11px] font-bold uppercase tracking-wide text-navy">Envío activo</span>
            <span class="block text-[11px] text-text-muted">{{ form.isActive ? 'El mensaje se enviará automáticamente' : 'Pausado: no se enviará a nadie' }}</span>
          </span>
          <span class="relative inline-flex shrink-0">
            <input v-model="form.isActive" type="checkbox" class="peer sr-only" />
            <span class="block h-6 w-11 rounded-full bg-border transition-colors peer-checked:bg-teal"></span>
            <span class="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"></span>
          </span>
        </label>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="block text-[11px] font-bold text-navy uppercase mb-2">Título</label>
            <input v-model="form.title" type="text" class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
          </div>
          <div>
            <label class="block text-[11px] font-bold text-navy uppercase mb-2">Color</label>
            <input v-model="form.color" type="color" class="w-full h-10 rounded-full border border-border cursor-pointer" />
          </div>
          <div>
            <label class="block text-[11px] font-bold text-navy uppercase mb-2">Canal</label>
            <select v-model="form.channel" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
              <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="both">Ambos</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-navy uppercase mb-2">Plantilla (evento)</label>
            <select v-model="form.event" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
              <option value="checkin_welcome">Bienvenida (check-in)</option><option value="reservation_confirmed">Confirmación de reserva</option><option value="reservation_presale">Reserva pendiente de pago</option><option value="reminder">Recordatorio</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-navy uppercase mb-2">Idioma</label>
            <select v-model="form.language" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
              <option value="es">Español</option><option value="en">English</option><option value="pt">Português</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-navy uppercase mb-2">Evento Disparador</label>
            <select v-model="form.triggerEvent" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
              <option value="on_reservation">Al crear reserva</option><option value="pre_checkin">X días antes del check-in</option><option value="checkin_day">El día del check-in</option><option value="checkout_day">El día del check-out</option><option value="post_checkout">X días después del check-out</option><option value="birthday">Cumpleaños del huésped</option><option value="inactive_guests">Huéspedes inactivos (win-back)</option>
            </select>
          </div>
          <div v-if="form.triggerEvent==='pre_checkin'||form.triggerEvent==='post_checkout'||form.triggerEvent==='inactive_guests'">
            <label class="block text-[11px] font-bold text-navy uppercase mb-2">{{ form.triggerEvent === 'inactive_guests' ? 'Días de inactividad' : 'Días (offset)' }}</label>
            <input v-model.number="form.triggerOffset" type="number" min="0" class="w-full px-4 py-2.5 rounded-full border border-border text-sm tabular-nums" />
          </div>
        </div>

        <div>
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Asunto del Email</label>
          <input v-model="form.emailSubject" type="text" placeholder="Confirmación de reserva - {hotel_name}" class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
        </div>
        <div>
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Cuerpo del Email</label>
          <textarea v-model="form.emailBody" rows="5" placeholder="Hola {guest_name}, tu reserva en {hotel_name} está confirmada..." class="w-full px-4 py-2.5 rounded-2xl border border-border text-xs resize-none font-mono"></textarea>
        </div>
        <div>
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Texto WhatsApp</label>
          <textarea v-model="form.whatsappBody" rows="3" placeholder="Hola {guest_name}! Tu reserva en {hotel_name} está confirmada. Te esperamos el {checkin_date}." class="w-full px-4 py-2.5 rounded-2xl border border-border text-sm resize-none"></textarea>
        </div>
        <div>
          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Variables Disponibles</label>
          <div class="flex flex-wrap gap-1">
            <span v-for="v in variables" :key="v" @click="insertVariable(v)" class="px-2.5 py-1 bg-navy/5 text-navy rounded-full text-[10px] font-bold cursor-pointer hover:bg-navy/10 transition-colors">{{ v }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <button v-if="modal.edit" @click="deleteMsg" class="mr-auto text-[11px] font-bold text-coral hover:text-navy transition-colors cursor-pointer">Eliminar</button>
        <button @click="modal.show=false" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50">{{ saving?'Guardando...':'Guardar' }}</button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { AutoMessagesService } from '@/services/AutoMessages.service'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
const ICON_EDIT = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
const ICON_MAIL = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>'

const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Eliminado'),
  onError: () => toast.error('Error'),
})

const messages = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const editId = ref('')
const statusFilter = ref<'all' | 'active' | 'inactive'>('all')
const modal = ref({ show: false, edit: false })

const form = ref({ title:'', color:'#3b82f6', emailSubject:'', emailBody:'', whatsappBody:'', channel:'email', triggerEvent:'checkin_day', triggerOffset:0, variables:[] as string[], isActive:true, event:'checkin_welcome', language:'es', triggerType:'cron' })

const variables = ['{hotel_name}','{hotel_address}','{hotel_phone}','{guest_name}','{checkin_date}','{checkout_date}','{room_number}','{room_type}','{nights}','{total_amount}','{pending_amount}','{locator}','{wifi_network}','{wifi_password}','{lock_codes}','{reservation_image}','{pre_checkin_url}']

const activeCount = computed(() => messages.value.filter(m => m.isActive !== false).length)
const activeShare = computed(() => messages.value.length ? Math.round((activeCount.value / messages.value.length) * 100) : 0)
const filtered = computed(() => {
  if (statusFilter.value === 'active') return messages.value.filter(m => m.isActive !== false)
  if (statusFilter.value === 'inactive') return messages.value.filter(m => m.isActive === false)
  return messages.value
})

function channelLabel(c: string) { const m: any = { email:'Email', whatsapp:'WhatsApp', both:'Email + WhatsApp' }; return m[c]||c }
function triggerLabel(t: string) { const m: any = { on_reservation:'Al crear reserva', pre_checkin:'Antes del check-in', checkin_day:'Día del check-in', checkout_day:'Día del check-out', post_checkout:'Después del check-out', birthday:'Cumpleaños', inactive_guests:'Win-back inactivos' }; return m[t]||t }
function eventLabel(e?: string) { const m: any = { checkin_welcome:'Bienvenida', reservation_confirmed:'Confirmación', reservation_presale:'Pre-venta', reminder:'Recordatorio' }; return e ? (m[e]||e) : '—' }
function langLabel(l?: string) { const m: any = { es:'ES', en:'EN', pt:'PT' }; return l ? (m[l]||l) : '—' }

function channelClass(c: string) {
  const m: Record<string, string> = { email:'bg-navy/10 text-navy', whatsapp:'bg-teal/10 text-teal', both:'bg-cyan/15 text-navy' }
  return m[c] || 'bg-surface text-text-secondary'
}
function triggerClass(t: string) {
  const m: Record<string, string> = {
    on_reservation:'bg-blue/10 text-blue',
    pre_checkin:'bg-cyan/15 text-navy',
    checkin_day:'bg-teal/10 text-teal',
    checkout_day:'bg-gold/15 text-gold',
    post_checkout:'bg-purple/10 text-purple',
  }
  return m[t] || 'bg-surface text-text-secondary'
}

function insertVariable(v: string) {
  const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null
  if (!el || !('value' in el)) return
  const start = el.selectionStart || el.value.length
  el.value = el.value.slice(0, start) + v + el.value.slice(el.selectionEnd || start)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function load() {
  loading.value = true
  try { const r = await AutoMessagesService.list(); messages.value = r.data||[] } catch { toast.error('No se pudieron cargar los mensajes automáticos') }
  loading.value = false
}
function openNew() {
  editId.value=''; modal.value={ show:true, edit:false }
  form.value={ title:'', color:'#3b82f6', emailSubject:'', emailBody:'', whatsappBody:'', channel:'email', triggerEvent:'checkin_day', triggerOffset:0, variables:[], isActive:true, event:'checkin_welcome', language:'es', triggerType:'cron' }
}
function openEdit(m: any) {
  editId.value=m.id; modal.value={ show:true, edit:true }
  form.value={ title:m.title, color:m.color||'#3b82f6', emailSubject:m.emailSubject||'', emailBody:m.emailBody||'', whatsappBody:m.whatsappBody||'', channel:m.channel||'email', triggerEvent:m.triggerEvent||'checkin_day', triggerOffset:m.triggerOffset||0, variables:m.variables||[], isActive:m.isActive!==false, event:m.event||'checkin_welcome', language:m.language||'es', triggerType:m.triggerType||'cron' }
}
async function save() {
  if(!form.value.title){ toast.error('Falta título'); return }
  saving.value=true
  try {
    const data = { ...form.value }
    if(editId.value) { await AutoMessagesService.update(editId.value, data) }
    else { await AutoMessagesService.create(data) }
    toast.success(editId.value?'Actualizado':'Creado')
  } catch { toast.error('Error') }
  saving.value=false; modal.value.show=false; await load()
}
function deleteMsg() {
  askConfirm({
    title: 'Eliminar mensaje',
    message: '¿Eliminar este mensaje? No se puede deshacer.',
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await AutoMessagesService.remove(editId.value)
      modal.value.show = false
      await load()
    },
  })
}
function removeMsg(m: any) {
  editId.value = m.id
  return deleteMsg()
}

onMounted(load)
</script>

<style scoped></style>
