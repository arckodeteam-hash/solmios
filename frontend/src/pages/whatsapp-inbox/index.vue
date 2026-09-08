<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Conversaciones de WhatsApp</h2>
        <p class="mt-0.5 text-sm text-text-muted">Lo que te escriben los huéspedes, y tus respuestas</p>
      </div>
      <button @click="cargarLista" :disabled="cargandoLista"
        class="rounded-full border border-border px-4 py-2 text-xs font-bold text-text-secondary transition-colors hover:border-navy hover:text-navy disabled:opacity-50">
        {{ cargandoLista ? 'Actualizando…' : 'Actualizar' }}
      </button>
    </div>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
      <!-- Lista -->
      <SectionCard title="Bandeja" :subtitle="`${conversaciones.length} conversación(es) · ${sinLeer} sin leer`" body-class="p-0">
        <div v-if="cargandoLista" class="space-y-2 p-4">
          <div v-for="i in 4" :key="i" class="h-16 animate-pulse rounded-xl bg-surface"></div>
        </div>

        <EmptyState v-else-if="!conversaciones.length" :icon="ICON_CHAT"
          title="Todavía no hay conversaciones"
          message="Cuando un huésped le escriba al WhatsApp del hotel, la charla va a aparecer acá." />

        <ul v-else class="divide-y divide-border">
          <li v-for="c in conversaciones" :key="c.id">
            <button @click="abrir(c.id)"
              class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/60"
              :class="c.id === abiertaId ? 'bg-surface' : ''">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/5 text-[11px] font-black text-navy">
                {{ iniciales(c.guestName || c.guestPhone) }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-sm font-bold text-navy">{{ c.guestName || c.guestPhone || 'Huésped' }}</span>
                  <span v-if="c.unreadCount" class="ml-auto shrink-0 rounded-full bg-cyan px-2 py-0.5 text-[10px] font-black tabular-nums text-navy">
                    {{ c.unreadCount }}
                  </span>
                </span>
                <span class="mt-1 flex flex-wrap items-center gap-1.5">
                  <span class="rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide"
                    :class="estadoClase(c.status)">{{ estadoLabel(c.status) }}</span>
                  <span v-if="!c.ventana.abierta" class="rounded-full bg-surface px-2 py-0.5 text-[9px] font-bold text-text-muted">
                    Ventana cerrada
                  </span>
                  <span v-if="c.lastMessageAt" class="text-[10px] text-text-muted">{{ cuandoFue(c.lastMessageAt) }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </SectionCard>

      <!-- Hilo -->
      <SectionCard :title="hilo?.guestName || hilo?.guestPhone || 'Conversación'"
        :subtitle="hilo ? subtituloHilo : 'Elegí una conversación de la izquierda'">
        <template v-if="hilo" #actions>
          <button v-if="hilo.status !== 'human'" @click="tomar" :disabled="ocupado"
            class="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/15 disabled:opacity-50">
            Atender yo
          </button>
          <button v-else @click="soltar" :disabled="ocupado"
            class="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/15 disabled:opacity-50">
            Devolver al asistente
          </button>
        </template>

        <div v-if="cargandoHilo" class="space-y-3">
          <div v-for="i in 3" :key="i" class="h-14 animate-pulse rounded-2xl bg-surface"></div>
        </div>

        <EmptyState v-else-if="!hilo" :icon="ICON_CHAT" title="Ninguna conversación abierta"
          message="Elegí una de la lista para ver el hilo y responder." />

        <div v-else class="flex flex-col gap-4">
          <div class="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            <div v-for="m in hilo.mensajes" :key="m.id" class="flex"
              :class="m.sender === 'guest' ? 'justify-start' : 'justify-end'">
              <div class="max-w-[80%] rounded-2xl px-4 py-2.5"
                :class="m.sender === 'guest'
                  ? 'rounded-bl-sm bg-surface text-navy'
                  : m.sender === 'bot'
                    ? 'rounded-br-sm border border-cyan/25 bg-cyan/10 text-navy'
                    : 'rounded-br-sm border border-teal/20 bg-teal/10 text-navy'">
                <p class="text-xs whitespace-pre-wrap">{{ m.content }}</p>
                <div class="mt-1 text-[9px] font-bold uppercase tracking-wide"
                  :class="m.sender === 'guest' ? 'text-text-muted' : m.sender === 'bot' ? 'text-cyan' : 'text-teal'">
                  {{ autor(m) }}
                </div>
              </div>
            </div>
          </div>

          <!-- La ventana de 24 h: se muestra siempre, no solo al vencer. Deshabilitar el cuadro es
               más honesto que dejar escribir y fallar al enviar. -->
          <div v-if="!hilo.ventana.abierta" class="rounded-2xl bg-gold/10 px-4 py-3">
            <div class="text-xs font-bold text-navy">Pasaron más de 24 horas desde el último mensaje del huésped</div>
            <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">
              WhatsApp solo permite retomar la charla con una plantilla aprobada. Podés enviarla desde
              la ficha de la reserva.
            </p>
          </div>

          <div v-else class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <label class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Responder</label>
              <span class="text-[10px] font-bold tabular-nums text-text-muted">{{ tiempoRestante }}</span>
            </div>
            <textarea v-model="respuesta" rows="3" :disabled="ocupado"
              placeholder="Escribí tu respuesta al huésped…"
              class="w-full resize-none rounded-2xl border border-border px-4 py-3 text-sm transition-colors focus:border-cyan focus:outline-none"></textarea>
            <div class="flex items-center justify-between">
              <p v-if="hilo.status !== 'human'" class="text-[11px] text-text-muted">
                El asistente está respondiendo esta charla. Tocá "Atender yo" para tomarla.
              </p>
              <span v-else></span>
              <button @click="responder" :disabled="ocupado || !respuesta.trim()"
                class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-navy-light disabled:opacity-50 disabled:cursor-not-allowed">
                {{ ocupado ? 'Enviando…' : 'Enviar' }}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { AiReceptionistService } from '@/services/AiReceptionist.service'
import type { InboxConversation, InboxThread, InboxMessage } from '@/services/AiReceptionist.service'
import { TeamService } from '@/services/Team.service'
import { useToast } from '@/composables/useToast'

const SVG = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
const ICON_CHAT = `${SVG}<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`

const toast = useToast()
const conversaciones = ref<InboxConversation[]>([])
const hilo = ref<InboxThread | null>(null)
const abiertaId = ref('')
const cargandoLista = ref(true)
const cargandoHilo = ref(false)
const ocupado = ref(false)
const respuesta = ref('')

/**
 * Nombres del equipo resueltos contra /api/usuarios — NUNCA contra employee-profiles, que usa
 * otros ids y haría que toda respuesta de una persona apareciera como "Usuario".
 */
const nombres = ref<Record<string, string>>({})

const sinLeer = computed(() => conversaciones.value.reduce((s, c) => s + (c.unreadCount || 0), 0))

const ESTADO_LABEL: Record<string, string> = { active: 'Asistente', human: 'Atendida', closed: 'Cerrada' }
const ESTADO_CLASE: Record<string, string> = {
  active: 'bg-cyan/10 text-cyan', human: 'bg-teal/10 text-teal', closed: 'bg-surface text-text-muted',
}
const estadoLabel = (s: string) => ESTADO_LABEL[s] ?? s
const estadoClase = (s: string) => ESTADO_CLASE[s] ?? ESTADO_CLASE.closed

const subtituloHilo = computed(() => {
  if (!hilo.value) return ''
  const quien = hilo.value.status === 'human'
    ? `Atendida por ${nombres.value[hilo.value.assignedAgentId || ''] || 'alguien del equipo'}`
    : 'La responde el asistente automático'
  return hilo.value.ventana.abierta ? quien : `${quien} · fuera de la ventana de 24 horas`
})

const tiempoRestante = computed(() => {
  const m = hilo.value?.ventana.minutosRestantes ?? 0
  if (m <= 0) return ''
  const h = Math.floor(m / 60)
  return h > 0 ? `Quedan ${h} h ${m % 60} min para responder` : `Quedan ${m} min para responder`
})

function iniciales(nombre?: string | null): string {
  const t = String(nombre || '?').trim().split(/\s+/).slice(0, 2)
  return t.map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function autor(m: InboxMessage): string {
  if (m.sender === 'guest') return 'Huésped'
  if (m.sender === 'bot') return 'Asistente'
  return nombres.value[m.senderUserId || ''] || 'Equipo'
}

/** Fecha corta y legible; el hilo ya muestra el orden, acá alcanza con "cuándo fue". */
function cuandoFue(iso: string): string {
  const d = new Date(iso)
  const hoy = new Date()
  const mismoDia = d.toDateString() === hoy.toDateString()
  return mismoDia
    ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es', { day: '2-digit', month: 'short' })
}

async function cargarLista() {
  cargandoLista.value = true
  try {
    const r = await AiReceptionistService.inbox()
    conversaciones.value = r.data || []
  } catch {
    conversaciones.value = []
  } finally {
    cargandoLista.value = false
  }
}

async function cargarNombres() {
  try {
    const r = await TeamService.list()
    const filas = (r as any)?.data ?? r ?? []
    nombres.value = Object.fromEntries((filas as any[]).map(u => [u.id, u.name]))
  } catch {
    // Sin nombres el hilo sigue siendo legible: dice "Equipo" en vez de la persona.
  }
}

async function abrir(id: string) {
  abiertaId.value = id
  cargandoHilo.value = true
  try {
    hilo.value = await AiReceptionistService.inboxConversation(id)
    // Abrirla la marcó leída en el servidor: la lista tiene que reflejarlo sin recargar todo.
    const fila = conversaciones.value.find(c => c.id === id)
    if (fila) fila.unreadCount = 0
  } catch (e: any) {
    toast.error('No se pudo abrir la conversación', e?.message)
    hilo.value = null
  } finally {
    cargandoHilo.value = false
  }
}

async function tomar() {
  if (!hilo.value) return
  ocupado.value = true
  try {
    await AiReceptionistService.takeConversation(hilo.value.id)
    toast.success('Estás atendiendo esta conversación', 'El asistente automático no va a responder')
    await abrir(hilo.value.id)
    await cargarLista()
  } catch (e: any) {
    toast.error('No se pudo tomar', e?.message)
  } finally {
    ocupado.value = false
  }
}

async function soltar() {
  if (!hilo.value) return
  ocupado.value = true
  try {
    await AiReceptionistService.releaseConversation(hilo.value.id)
    toast.success('El asistente vuelve a responder esta conversación')
    await abrir(hilo.value.id)
    await cargarLista()
  } catch (e: any) {
    toast.error('No se pudo devolver', e?.message)
  } finally {
    ocupado.value = false
  }
}

async function responder() {
  if (!hilo.value || !respuesta.value.trim()) return
  ocupado.value = true
  try {
    await AiReceptionistService.replyConversation(hilo.value.id, respuesta.value.trim())
    respuesta.value = ''
    await abrir(hilo.value.id)
    await cargarLista()
  } catch (e: any) {
    toast.error('No se pudo enviar', e?.message || 'Revisá la conexión de WhatsApp')
  } finally {
    ocupado.value = false
  }
}

onMounted(() => { cargarLista(); cargarNombres() })
</script>
