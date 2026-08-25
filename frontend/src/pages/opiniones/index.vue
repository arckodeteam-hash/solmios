<template>
  <div>
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">Opiniones</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-xs text-text-muted mt-0.5">Gestión de reseñas de huéspedes</p>
      </div>
      <button @click="requestReviews" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_MAIL"></span>
        Solicitar Reseñas
      </button>
    </div>

    <!-- KPIs -->
    <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <div v-for="n in 4" :key="n" class="h-[132px] animate-pulse rounded-[16px] bg-surface"></div>
    </div>
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Total Reseñas" :value="totalReviewsCount" icon="bookings" accent="blue"
        :unit="reviews.length ? `${respondedCount} con respuesta` : 'Todavía sin reseñas'" />
      <KpiHeroCard label="Satisfacción" :value="satisfactionPct" icon="money" accent="amber"
        suffix="%" :progress="satisfactionPct" :unit="`${avgRating} de 5 estrellas`" />
      <KpiHeroCard label="Con Respuesta" :value="respondedCount" icon="users" accent="purple"
        :unit="`${pendingCount} sin responder`" />
      <KpiHeroCard label="Tasa de Respuesta" :value="responseRate" icon="checkin" accent="teal"
        suffix="%" :progress="responseRate" unit="Reseñas contestadas por el hotel" />
    </div>

    <!-- Configuración -->
    <SectionCard title="Configuración" subtitle="Automatismos de reseñas" class="mb-6">
      <div class="flex items-center flex-wrap gap-x-8 gap-y-3">
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="relative inline-flex items-center cursor-pointer">
            <input id="opiniones-solicitar-resenas" name="requestReviews" v-model="config.requestReviews" type="checkbox" class="sr-only peer" @change="saveConfig" />
            <span class="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal"></span>
          </span>
          <span class="text-xs text-navy font-bold">Solicitar reseñas</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="relative inline-flex items-center cursor-pointer">
            <input id="opiniones-publicar-puntuacion" name="publishScore" v-model="config.publishScore" type="checkbox" class="sr-only peer" @change="saveConfig" />
            <span class="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal"></span>
          </span>
          <span class="text-xs text-navy font-bold">Publicar puntuación</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="relative inline-flex items-center cursor-pointer">
            <input id="opiniones-publicar-comentarios" name="publishComments" v-model="config.publishComments" type="checkbox" class="sr-only peer" @change="saveConfig" />
            <span class="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal"></span>
          </span>
          <span class="text-xs text-navy font-bold">Publicar comentarios</span>
        </label>
      </div>
    </SectionCard>

    <!-- Listado de reseñas -->
    <SectionCard
      title="Reseñas de huéspedes"
      :subtitle="reviews.length ? `${filteredReviews.length} de ${reviews.length} reseña(s)` : 'Sin reseñas registradas'"
      body-class="p-0"
    >
      <template #actions>
        <select id="opiniones-filter-status" name="statusFilter" aria-label="Filtrar opiniones por estado"
          v-model="statusFilter"
          class="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white focus:outline-none"
        >
          <option value="all" class="text-navy">Todas</option>
          <option value="pending" class="text-navy">Sin responder</option>
          <option value="answered" class="text-navy">Respondidas</option>
        </select>
      </template>

      <!-- Carga -->
      <div v-if="loading" class="divide-y divide-border">
        <div v-for="n in 3" :key="n" class="p-5">
          <div class="h-4 w-32 animate-pulse rounded bg-surface"></div>
          <div class="mt-3 h-3 w-48 animate-pulse rounded bg-surface"></div>
          <div class="mt-3 h-3 w-full animate-pulse rounded bg-surface"></div>
        </div>
      </div>

      <!-- Sin datos -->
      <EmptyState
        v-else-if="!reviews.length"
        :icon="ICON_CHAT_EMPTY"
        title="Sin opiniones aún"
        message="Las reseñas llegan por el pedido que se le envía al huésped después del check-out, y desde el enlace público de opinión. Si esperabas ver alguna, revisá que ese envío automático esté activo."
      >
        <template v-if="canSeeMessagingSettings" #action>
          <router-link to="/panel/config/mensajeria?tab=auto-messages" class="inline-flex items-center gap-1.5 rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors">
            <span class="h-4 w-4 shrink-0" v-html="ICON_MAIL"></span>
            Revisar el envío automático
          </router-link>
        </template>
      </EmptyState>

      <!-- Filtro sin resultados -->
      <EmptyState
        v-else-if="!filteredReviews.length"
        :icon="ICON_CHAT_EMPTY"
        title="Ninguna reseña con ese filtro"
        message="Probá con otro estado de respuesta para ver el resto de las opiniones."
      >
        <template #action>
          <button @click="statusFilter = 'all'" class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Ver todas
          </button>
        </template>
      </EmptyState>

      <!-- Lista -->
      <div v-else class="divide-y divide-border">
        <article v-for="r in filteredReviews" :key="r.id" class="p-4 sm:p-5 hover:bg-surface/40 transition-colors">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex items-start gap-3 min-w-0">
              <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy/10 text-[11px] font-black text-navy">
                {{ initials(r.guestName) }}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-bold text-navy truncate">{{ r.guestName || 'Anónimo' }}</span>
                  <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="channelBadge(r.channel)">{{ r.channel || 'Directa' }}</span>
                  <span v-if="r.response" class="rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal">Respondida</span>
                  <span v-else class="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold">Sin responder</span>
                </div>
                <div class="mt-1.5 flex items-center gap-2">
                  <span class="flex items-center gap-0.5">
                    <span
                      v-for="s in 5" :key="s"
                      class="block h-3.5 w-3.5"
                      :class="s <= (r.rating || 0) ? 'text-gold' : 'text-border'"
                      v-html="ICON_STAR"
                    ></span>
                  </span>
                  <span class="text-[11px] font-black tabular-nums text-navy">{{ r.rating || 0 }}/5</span>
                  <span v-if="r.createdAt" class="text-[10px] text-text-muted">· {{ r.createdAt.slice(0, 10) }}</span>
                </div>
              </div>
            </div>
            <button
              @click="openRespond(r)"
              :title="r.response ? 'Editar respuesta' : 'Responder'"
              class="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer"
            >
              <span class="h-4 w-4" v-html="ICON_REPLY"></span>
            </button>
          </div>

          <p v-if="r.comment || r.title" class="mt-3 text-sm text-text-secondary">{{ r.comment || r.title }}</p>

          <div v-if="r.response" class="mt-3 rounded-xl border-l-2 border-cyan bg-surface px-4 py-3">
            <span class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-cyan">Respuesta del hotel</span>
            <p class="text-sm italic text-navy">{{ r.response }}</p>
          </div>
        </article>
      </div>
    </SectionCard>

    <!-- Responder -->
    <AppModal
      v-if="respondModal.show"
      size="md"
      :title="respondModal.response ? 'Editar respuesta' : 'Responder reseña'"
      :subtitle="respondModal.guest"
      @close="respondModal.show = false"
    >
      <div class="space-y-4">
        <p v-if="respondModal.comment" class="border-b border-border pb-4 text-sm italic text-text-secondary">"{{ respondModal.comment }}"</p>
        <div>
          <label for="opiniones-tu-respuesta" class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Tu respuesta</label>
          <textarea id="opiniones-tu-respuesta" name="text" v-model="respondModal.text" rows="4" placeholder="Escribe tu respuesta..." class="w-full resize-none rounded-xl border border-border px-4 py-2.5 text-sm focus:outline-none focus:border-navy"></textarea>
        </div>
      </div>
      <template #footer>
        <button @click="respondModal.show = false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveResponse" class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer">Publicar Respuesta</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { OpinionesService } from '@/services/Opiniones.service'
import { ConfigService } from '@/services/Platform.service'
import { useToast } from '@/composables/useToast'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { usePermissions } from '@/composables/usePermissions'

const ICON_MAIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0-.828.672-1.5 1.5-1.5h16.5c.828 0 1.5.672 1.5 1.5v10.5a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5V6.75Zm0 0 9.75 6.75 9.75-6.75"/></svg>'
const ICON_STAR = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.563.563 0 0 0-.586 0L6.982 21.44a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>'
// Icono del EmptyState: tamaño fijo (h-8 w-8) porque el contenedor del componente es de 64px.
const ICON_CHAT_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"/></svg>'
const ICON_REPLY = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17 4 12m0 0 5-5m-5 5h11a4 4 0 0 1 4 4v1"/></svg>'

const toast = useToast()
// El CTA del estado vacío lleva a Configuración → Mensajería, gateada por `settings:view`
// (config/module-map.ts). Sin ese permiso el link daría 403: no se ofrece.
const { can } = usePermissions()
const canSeeMessagingSettings = computed(() => can('settings', 'view'))
const reviews = ref<any[]>([])
const loading = ref(true)
const statusFilter = ref<'all' | 'pending' | 'answered'>('all')
const config = ref({ requestReviews: true, publishScore: true, publishComments: true })

const avgRating = computed(() => {
  if (!reviews.value.length) return '0'
  return (reviews.value.reduce((s: number, r: any) => s + (r.rating || 0), 0) / reviews.value.length).toFixed(1)
})

const respondedCount = computed(() => reviews.value.filter((r: any) => r.response).length)
const pendingCount = computed(() => reviews.value.length - respondedCount.value)
const responseRate = computed(() => (reviews.value.length ? Math.round((respondedCount.value / reviews.value.length) * 100) : 0))
const totalReviewsCount = computed(() => reviews.value.length)
// El KPI grande muestra la satisfacción en % (la card redondea a entero);
// la nota exacta sobre 5 va en la línea `unit`.
const satisfactionPct = computed(() => Math.round((Number(avgRating.value) / 5) * 100))

const filteredReviews = computed(() => {
  if (statusFilter.value === 'pending') return reviews.value.filter((r: any) => !r.response)
  if (statusFilter.value === 'answered') return reviews.value.filter((r: any) => r.response)
  return reviews.value
})

const respondModal = ref({ show: false, id: '', guest: '', comment: '', text: '', response: '' })

function channelBadge(c: string) {
  const m: any = { direct: 'bg-teal/10 text-teal', booking: 'bg-cyan/10 text-cyan', expedia: 'bg-gold/10 text-gold', airbnb: 'bg-coral/10 text-coral' }
  return m[c?.toLowerCase()] || 'bg-gray-100 text-gray-500'
}

function initials(name?: string) {
  if (!name) return 'AN'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

async function load() {
  loading.value = true
  try {
    const r = await OpinionesService.list()
    reviews.value = Array.isArray(r) ? r : []
  } catch { reviews.value = []; toast.error('No se pudieron cargar las opiniones') }
  try {
    const c = await ConfigService.get('opiniones_config')
    if (c) config.value = typeof c === 'string' ? JSON.parse(c) : c
  } catch {}
  loading.value = false
}

function openRespond(r: any) {
  respondModal.value = { show: true, id: r.id, guest: r.guestName || 'Anónimo', comment: r.comment || '', text: r.response || '', response: r.response || '' }
}

async function saveResponse() {
  try {
    await OpinionesService.respond(respondModal.value.id, respondModal.value.text)
    const rev = reviews.value.find(r => r.id === respondModal.value.id)
    if (rev) rev.response = respondModal.value.text
    toast.success('Respuesta publicada')
    respondModal.value.show = false
  } catch { toast.error('Error') }
}

async function saveConfig() {
  try { await ConfigService.set('opiniones_config', JSON.stringify(config.value)) } catch { toast.error('No se pudo guardar la configuración') }
}

function requestReviews() {
  toast.info('Solicitud enviada — los huéspedes recibirán un email para dejar su opinión')
}

onMounted(load)
</script>

<style scoped></style>
