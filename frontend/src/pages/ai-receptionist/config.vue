<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { AiReceptionistService } from '@/services/AiReceptionist.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import QrcodeVue from 'qrcode.vue'

const ICON_ROBOT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5.5v2M5 10.5h14a1 1 0 0 1 1 1v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a1 1 0 0 1 1-1Z"/><circle cx="9" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="4" r="1.1" fill="currentColor" stroke="none"/></svg>'
const ICON_PHONE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a1.5 1.5 0 0 0 1.5-1.5v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>'
const ICON_SPARKLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"/></svg>'
const ICON_TARGET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>'
const ICON_DOCUMENT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="m9 12.75 1.5 1.5 3.75-3.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_PAUSE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M6.75 5.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75V5.25Z"/></svg>'
const ICON_CLOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_REFRESH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>'
const ICON_SAVE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7.8c0-1.68 0-2.52.327-3.162a3 3 0 0 1 1.311-1.311C5.28 3 6.12 3 7.8 3h6.982c.478 0 .717 0 .942.055.2.049.39.129.564.237.197.122.367.292.706.632l2.082 2.082c.34.34.51.51.632.706.108.175.188.365.237.564.055.225.055.464.055.942V16.2c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C17.72 21 16.88 21 15.2 21H7.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C3 18.72 3 17.88 3 16.2V7.8Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21v-6.75a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 .75.75V21M7.5 3v3.75a.75.75 0 0 0 .75.75h6a.75.75 0 0 0 .75-.75V3"/></svg>'

// Variantes h-8 w-8 para EmptyState (el contenedor del componente es de 64px)
const ICON_TARGET_EMPTY = ICON_TARGET.replace('class="w-full h-full"', 'class="h-8 w-8"')
const ICON_DOCUMENT_EMPTY = ICON_DOCUMENT.replace('class="w-full h-full"', 'class="h-8 w-8"')

const TAB_ICONS: Record<string, string> ={ whatsapp: ICON_PHONE, llm: ICON_SPARKLE, intents: ICON_TARGET, templates: ICON_DOCUMENT }

const auth = useAuthStore()
const toast = useToast()
const hotelId = auth.user?.hotelId || JSON.parse(localStorage.getItem('user') || '{}').hotelId || ''

function getHotelId() {
  if (hotelId) return hotelId
  const u = JSON.parse(localStorage.getItem('user') || '{}')
  return u.hotelId || ''
}

const tab = ref<'whatsapp' | 'llm' | 'intents' | 'templates'>('whatsapp')

// WhatsApp
const wsConfig = ref<any>(null)
const wsStatus = ref({ status: 'disconnected', phone: null as string | null, mode: 'baileys' })
const wsQR = ref<string | null>(null)
const wsLoading = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

// LLM
const llmProvider = ref('deepseek')
const llmModel = ref('deepseek-chat')
const llmApiKey = ref('')
const botName = ref('Sofía')
const businessHoursStart = ref('08:00')
const businessHoursEnd = ref('22:00')

// Intents
const intents = ref<any[]>([])
const intentsLoading = ref(true)
const saving = ref(false)

// Flags de carga (solo para los skeletons de la vista)
const configLoading = ref(true)
const activeIntents = computed(() => intents.value.filter((i: any) => i.isActive).length)

function toDataURL(qr: string): string {
  if (qr.startsWith('data:')) return qr
  if (qr.startsWith('http')) return qr
  return qr
}

async function loadConfig() {
  const hid = getHotelId()
  try {
    const cfg = await AiReceptionistService.getWhatsappConfig(hid)
    if (cfg) {
      wsConfig.value = cfg
      llmProvider.value = cfg.llmProvider || 'deepseek'
      llmModel.value = cfg.llmModel || 'deepseek-chat'
      llmApiKey.value = cfg.accessToken || ''
      botName.value = cfg.botName || 'Sofía'
      businessHoursStart.value = cfg.businessHoursStart || '08:00'
      businessHoursEnd.value = cfg.businessHoursEnd || '22:00'
    }
  } catch { toast.error('No se pudo cargar la configuración del recepcionista IA') }
  try {
    if (!hid) return
    const status = await AiReceptionistService.getWhatsappStatus(hid)
    wsStatus.value = status
    // Fetch QR if session is in qr_pending state
    if (status.status === 'qr_pending') {
      const qrRes = await AiReceptionistService.getWhatsappQR(hid)
      if (qrRes?.qr) wsQR.value = qrRes.qr
    } else {
      wsQR.value = null
    }
  } catch {} finally { configLoading.value = false }
}

async function saveLLMConfig() {
  saving.value = true
  try {
    await AiReceptionistService.updateWhatsappConfig({
      llmProvider: llmProvider.value, llmModel: llmModel.value,
      botName: botName.value,
      businessHoursStart: businessHoursStart.value,
      businessHoursEnd: businessHoursEnd.value,
    } as any)
    toast.success('Configuración guardada')
  } finally { saving.value = false }
}

async function startWhatsapp() {
  const hid = getHotelId()
  if (!hid) { toast.error('No se detectó el hotel', 'Recargá la página'); return }
  wsLoading.value = true
  try {
    const res = await AiReceptionistService.startWhatsappSession(hid)
    if (res.qr) wsQR.value = toDataURL(res.qr)
    // Fetch status separately — don't let loadConfig errors block the flow
    try {
      const status = await AiReceptionistService.getWhatsappStatus(hid)
      wsStatus.value = status
      if (status.status === 'qr_pending') {
        const qrRes = await AiReceptionistService.getWhatsappQR(hid)
        if (qrRes?.qr) wsQR.value = qrRes.qr
      }
    } catch {}
    startPolling()
  } catch(e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sin respuesta del servidor'
    const friendly = msg.includes('HTML') || msg.includes('<!')
      ? 'El backend no respondió JSON. Verificá que esté corriendo: cd backend && bun run dev'
      : msg
    toast.error('Error al conectar', friendly)
  } finally { wsLoading.value = false }
}

async function stopWhatsapp() {
  stopPolling()
  try { await AiReceptionistService.stopWhatsappSession(getHotelId()) } catch {}
  wsQR.value = null
  await loadConfig()
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    const hid = getHotelId()
    if (!hid) return
    try {
      const status = await AiReceptionistService.getWhatsappStatus(hid)
      wsStatus.value = status
      if (status.status === 'qr_pending') {
        const qrRes = await AiReceptionistService.getWhatsappQR(hid)
        if (qrRes?.qr) wsQR.value = toDataURL(qrRes.qr)
      } else if (status.status === 'connected') {
        wsQR.value = null
        stopPolling()
      }
    } catch {}
  }, 3000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function loadIntents() {
  try { const res = await AiReceptionistService.listIntents(); intents.value = res.data || [] } catch { toast.error('No se pudieron cargar las intenciones') } finally { intentsLoading.value = false }
}

async function toggleIntentActive(intent: any) {
  await AiReceptionistService.updateIntent(intent.id, { isActive: intent.isActive ? 0 : 1 })
  await loadIntents()
}

const providers = [
  { value: 'deepseek', label: 'DeepSeek (recomendado, más barato)' },
  { value: 'zai', label: 'Z.AI GLM' },
  { value: 'openai', label: 'OpenAI GPT-4o' },
  { value: 'ollama', label: 'Ollama (local, gratis)' },
]

onMounted(() => { loadConfig(); loadIntents(); startPolling() })
onBeforeUnmount(() => { stopPolling() })
</script>

<template>
  <div class="h-full bg-surface overflow-y-auto">
    <div class="max-w-4xl mx-auto p-6">
      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 bg-gradient-to-br from-cyan to-teal rounded-xl flex items-center justify-center shadow-sm text-white">
            <span class="w-5 h-5 shrink-0" v-html="ICON_ROBOT"></span>
          </div>
          <div>
            <h1 class="text-xl font-black text-navy">Configuración de la Recepcionista IA</h1>
            <p class="text-xs text-text-muted mt-0.5">Personalizá el comportamiento de tu recepcionista virtual</p>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="mb-6 flex gap-2 overflow-x-auto pb-1">
        <button v-for="t in [{k:'whatsapp',l:'WhatsApp'},{k:'llm',l:'Modelo IA'},{k:'intents',l:'Intenciones'},{k:'templates',l:'Plantillas'}]" :key="t.k"
          @click="tab = t.k as any"
          class="flex shrink-0 items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
          :class="tab === t.k ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
          <span class="w-4 h-4 shrink-0" v-html="TAB_ICONS[t.k]"></span> {{ t.l }}
        </button>
      </div>

      <!-- WhatsApp Tab -->
      <div v-if="tab === 'whatsapp'" class="space-y-5">
        <SectionCard title="Conexión de WhatsApp"
          subtitle="Vinculá el número del hotel para que la IA responda los mensajes entrantes">
          <!-- Skeleton mientras se resuelve el estado de la sesión -->
          <div v-if="configLoading" class="space-y-4">
            <div class="flex items-center gap-3">
              <div class="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface"></div>
              <div class="flex-1 space-y-2">
                <div class="h-4 w-48 animate-pulse rounded bg-surface"></div>
                <div class="h-3 w-64 animate-pulse rounded bg-surface"></div>
              </div>
            </div>
            <div class="h-10 w-44 animate-pulse rounded-full bg-surface"></div>
          </div>

          <template v-else>
            <!-- Estado de la sesión -->
            <div class="flex items-center gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3">
              <div :class="['h-10 w-10 shrink-0 grid place-items-center rounded-full p-2',
                wsStatus.status === 'connected' ? 'bg-teal/10 text-teal' : wsStatus.status === 'qr_pending' ? 'bg-gold/10 text-gold' : 'bg-white text-text-muted']">
                <span class="h-full w-full" v-html="wsStatus.status === 'connected' ? ICON_CHECK_CIRCLE : wsStatus.status === 'qr_pending' ? ICON_PHONE : ICON_PAUSE"></span>
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span :class="['rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide',
                    wsStatus.status === 'connected' ? 'bg-teal/10 text-teal' : wsStatus.status === 'qr_pending' ? 'bg-gold/10 text-gold' : 'bg-border/60 text-text-muted']">
                    {{ wsStatus.status === 'connected' ? 'Conectado' : wsStatus.status === 'qr_pending' ? 'Esperando QR' : 'Desconectado' }}
                  </span>
                  <span v-if="wsStatus.status === 'connected' && wsStatus.phone" class="text-sm font-bold text-navy tabular-nums">{{ wsStatus.phone }}</span>
                </div>
                <p class="mt-1 text-[11px] text-text-muted">
                  {{ wsStatus.status === 'connected'
                    ? 'El bot está respondiendo automáticamente los mensajes entrantes.'
                    : wsStatus.status === 'qr_pending'
                      ? 'Escaneá el código con tu celular para terminar de vincular.'
                      : 'Conectá el número para que la recepcionista IA empiece a responder.' }}
                </p>
              </div>
            </div>

            <!-- QR de vinculación -->
            <div v-if="wsQR && wsStatus.status === 'qr_pending'" class="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div class="rounded-2xl border border-border bg-white p-3">
                <QrcodeVue :value="wsQR" :size="192" level="M" render-as="svg" class="rounded-lg" />
              </div>
              <div class="min-w-0">
                <p class="text-[11px] font-bold uppercase tracking-wide text-text-muted">Cómo vincular</p>
                <ol class="mt-2 space-y-1 text-xs text-text-secondary">
                  <li>1. Abrí WhatsApp en tu celular.</li>
                  <li>2. Entrá en Ajustes → Dispositivos vinculados.</li>
                  <li>3. Tocá "Vincular un dispositivo" y escaneá el código.</li>
                </ol>
                <p class="mt-2 text-[10px] text-text-muted">No perdés el número: vos y el bot ven los mismos mensajes.</p>
              </div>
            </div>

            <!-- Acciones -->
            <div class="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-5">
              <button @click="startWhatsapp" :disabled="wsLoading"
                class="flex cursor-pointer items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition-all disabled:opacity-50"
                :class="wsStatus.status === 'connected' ? 'bg-navy hover:bg-navy-light' : 'bg-teal hover:bg-teal-light'">
                <span class="h-4 w-4 shrink-0" v-html="wsLoading ? ICON_CLOCK : wsStatus.status === 'disconnected' ? ICON_PHONE : ICON_REFRESH"></span>
                {{ wsLoading ? 'Conectando...' : wsStatus.status === 'disconnected' ? 'Conectar WhatsApp' : 'Reconectar' }}
              </button>
              <button v-if="wsStatus.status === 'connected'" @click="stopWhatsapp"
                class="cursor-pointer rounded-full border border-border px-5 py-2.5 text-sm font-bold text-coral transition-colors hover:border-coral/40 hover:bg-coral/5">
                Desconectar
              </button>
            </div>
          </template>
        </SectionCard>
      </div>

      <!-- LLM Tab -->
      <div v-if="tab === 'llm'" class="space-y-5">
        <SectionCard title="Cerebro de la IA"
          subtitle="Modelo que redacta las respuestas. DeepSeek cuesta ~$1.60/mes por hotel">
          <div v-if="configLoading" class="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div v-for="i in 3" :key="i" class="space-y-2">
              <div class="h-3 w-24 animate-pulse rounded bg-surface"></div>
              <div class="h-11 animate-pulse rounded-xl bg-surface"></div>
            </div>
          </div>
          <div v-else class="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Proveedor</label>
              <select v-model="llmProvider"
                class="w-full cursor-pointer rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy focus:border-navy focus:outline-none">
                <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
              </select>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Modelo</label>
              <input v-model="llmModel" placeholder="deepseek-chat"
                class="w-full rounded-xl border border-border px-4 py-2.5 text-sm text-navy focus:border-navy focus:outline-none" />
            </div>
            <div class="sm:col-span-2">
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">API Key</label>
              <!-- autocomplete="new-password": es la API key del proveedor LLM, un secreto que
                   define el operador. Sin esto Chrome la rellenaba con una credencial guardada
                   y se guardaba cifrada una clave que nadie tipeó (GH-32). -->
              <input v-model="llmApiKey" type="password" placeholder="sk-..."
                autocomplete="new-password" name="llm-api-key"
                class="w-full rounded-xl border border-border px-4 py-2.5 text-sm text-navy focus:border-navy focus:outline-none" />
              <p class="mt-1.5 text-[11px] text-text-muted">Se guarda cifrada y solo se usa para hablar con el proveedor elegido.</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Identidad y horario"
          subtitle="Con qué nombre se presenta la recepcionista y en qué franja atiende">
          <div v-if="configLoading" class="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div v-for="i in 3" :key="i" class="space-y-2">
              <div class="h-3 w-24 animate-pulse rounded bg-surface"></div>
              <div class="h-11 animate-pulse rounded-xl bg-surface"></div>
            </div>
          </div>
          <div v-else class="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nombre del bot</label>
              <input v-model="botName" placeholder="Sofía"
                class="w-full rounded-xl border border-border px-4 py-2.5 text-sm text-navy focus:border-navy focus:outline-none" />
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Horario inicio</label>
              <input v-model="businessHoursStart" type="time"
                class="w-full rounded-xl border border-border px-4 py-2.5 text-sm tabular-nums text-navy focus:border-navy focus:outline-none" />
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Horario fin</label>
              <input v-model="businessHoursEnd" type="time"
                class="w-full rounded-xl border border-border px-4 py-2.5 text-sm tabular-nums text-navy focus:border-navy focus:outline-none" />
            </div>
          </div>
        </SectionCard>

        <div class="flex justify-end">
          <button @click="saveLLMConfig" :disabled="saving || configLoading"
            class="flex cursor-pointer items-center gap-1.5 rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition-colors hover:bg-navy-light disabled:opacity-50">
            <span class="h-4 w-4 shrink-0" v-html="ICON_SAVE"></span>
            {{ saving ? 'Guardando...' : 'Guardar configuración' }}
          </button>
        </div>
      </div>

      <!-- Intents Tab -->
      <div v-if="tab === 'intents'">
        <SectionCard title="Intenciones"
          :subtitle="intentsLoading ? 'Cargando respuestas automáticas...' : `${activeIntents} activas de ${intents.length} · respuestas automáticas de la recepcionista`"
          body-class="p-0">
          <!-- Skeleton -->
          <div v-if="intentsLoading" class="space-y-3 p-5">
            <div v-for="i in 4" :key="i" class="flex items-center justify-between gap-3">
              <div class="flex-1 space-y-2">
                <div class="h-4 w-56 animate-pulse rounded bg-surface"></div>
                <div class="h-3 w-80 max-w-full animate-pulse rounded bg-surface"></div>
              </div>
              <div class="h-6 w-11 shrink-0 animate-pulse rounded-full bg-surface"></div>
            </div>
          </div>

          <EmptyState v-else-if="!intents.length" :icon="ICON_TARGET_EMPTY" title="Sin intenciones configuradas"
            message="Todavía no hay respuestas automáticas cargadas para este hotel." />

          <div v-else class="px-5">
            <div v-for="intent in intents" :key="intent.id"
              class="flex items-center justify-between gap-3 border-b border-border py-4 last:border-0">
              <div class="min-w-0 flex-1">
                <div class="mb-1 flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-purple/10 px-2 py-0.5 text-[10px] font-extrabold text-purple">Sistema</span>
                  <span class="text-sm font-bold text-navy">{{ intent.name }}</span>
                  <span v-if="intent.category" class="text-[10px] uppercase tracking-wide text-text-muted">{{ intent.category }}</span>
                </div>
                <p v-if="intent.responseTemplate" class="max-w-lg truncate text-[11px] text-text-muted">{{ intent.responseTemplate }}</p>
              </div>
              <button @click="toggleIntentActive(intent)"
                :aria-label="intent.isActive ? 'Desactivar intención' : 'Activar intención'"
                :class="['relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors', intent.isActive ? 'bg-teal' : 'bg-border']">
                <span :class="['inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform', intent.isActive ? 'translate-x-6' : 'translate-x-1']" />
              </button>
            </div>
          </div>
        </SectionCard>
      </div>

      <!-- Templates Tab (placeholder) -->
      <div v-if="tab === 'templates'">
        <SectionCard title="Plantillas de respuesta"
          subtitle="Mensajes predefinidos para check-in, check-out, bienvenida y fuera de horario"
          body-class="p-0">
          <EmptyState :icon="ICON_DOCUMENT_EMPTY" title="Plantillas en camino"
            message="Vas a poder editar los mensajes predefinidos de check-in, check-out, bienvenida y fuera de horario. Próximamente." />
        </SectionCard>
      </div>
    </div>
  </div>
</template>
