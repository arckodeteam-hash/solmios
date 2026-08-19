<template>
  <div class="relative overflow-hidden rounded-[20px] border border-[#06B6D4]/25 bg-white p-5 shadow-(--shadow-card)">
    <div class="pointer-events-none absolute -top-20 -left-20 h-56 w-56 rounded-full bg-[#06B6D4]/10 blur-3xl cc-breathe"></div>

    <div class="relative flex items-center justify-between">
      <h2 class="text-xs font-black uppercase tracking-wider text-navy">IA Hotel</h2>
      <span class="flex items-center gap-1.5 rounded-full bg-[#06B6D4]/12 px-2.5 py-1 text-[9px] font-extrabold uppercase text-[#0891B2]">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22D3EE]"></span>
        Analizando
      </span>
    </div>

    <div class="relative mt-4 flex items-center gap-4">
      <!-- Avatar -->
      <div class="relative hidden h-40 w-40 shrink-0 place-items-center sm:grid">
        <img :src="robotIcon" alt="IA Hotel" class="h-full w-full object-contain cc-robot-glow" />
      </div>

      <div class="min-w-0 flex-1">
        <p class="text-sm font-black text-navy">{{ greeting }}, {{ userName }} 👋</p>
        <p class="mt-0.5 text-[11px] text-text-secondary">Analicé los datos del hotel y esto es lo que encontré:</p>

        <ul class="mt-3.5 space-y-2.5">
          <li v-for="(ins, i) in displayInsights" :key="i" class="flex items-start gap-2.5 text-xs" :style="{ animationDelay: `${i * 80}ms` }">
            <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" :class="TONE_BG[ins.tone]">
              <span class="block h-3 w-3" :class="TONE_TEXT[ins.tone]" v-html="TONE_ICON[ins.tone]"></span>
            </span>
            <!-- v-html a propósito: los insights se COMPONEN en el dashboard con <b> para
                 resaltar la cifra ("ocupación del <b>82%</b>"). Con interpolación normal el
                 usuario leía los tags crudos en pantalla. Las cadenas se arman íntegramente
                 en código (números y labels de catálogos constantes) — no entra texto de
                 huésped, reserva ni de ningún otro input, así que no hay superficie de XSS. -->
            <span class="pt-0.5 text-text-secondary" v-html="ins.text"></span>
          </li>
        </ul>
      </div>
    </div>

    <router-link to="/panel/ia/recepcionista"
      class="relative mt-4 block rounded-xl border border-[#2563EB]/30 bg-[#2563EB]/8 px-4 py-2.5 text-center text-[11px] font-extrabold text-[#2563EB] transition-all hover:bg-[#2563EB]/15">
      Ver todas las recomendaciones
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import robotIcon from '@/assets/RobotoIADashboard.png'

export interface AiInsight { text: string; tone: 'ok' | 'warn' | 'danger' | 'info' }

const props = defineProps<{ userName: string; insights: AiInsight[] }>()

const ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
const ICON_WARNING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"/></svg>'
const ICON_ALERT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-1.5a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg>'
const ICON_TREND = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 18 6.41-6.41a2.25 2.25 0 0 1 3.18 0l2.12 2.12a2.25 2.25 0 0 0 3.18 0L21.75 9M15 9h6.75V15"/></svg>'

const TONE_ICON: Record<AiInsight['tone'], string> = { ok: ICON_CHECK, warn: ICON_WARNING, danger: ICON_ALERT, info: ICON_TREND }
const TONE_TEXT: Record<AiInsight['tone'], string> = {
  ok: 'text-[#16A34A]', warn: 'text-[#D97706]', danger: 'text-[#DC2626]', info: 'text-[#0891B2]',
}
const TONE_BG: Record<AiInsight['tone'], string> = {
  ok: 'bg-[#22C55E]/15', warn: 'bg-[#F59E0B]/15', danger: 'bg-[#EF4444]/15', info: 'bg-[#22D3EE]/15',
}

/** Sugerencias genéricas para completar la lista cuando hay pocos hallazgos reales del día */
const FALLBACK_TIPS: AiInsight[] = [
  { text: 'Revisá las tarifas de temporada alta para maximizar tus ingresos.', tone: 'info' },
  { text: 'Enviá un mensaje de bienvenida automático a los huéspedes que llegan hoy.', tone: 'info' },
  { text: 'Confirmá que el Channel Manager esté sincronizando correctamente.', tone: 'info' },
  { text: 'Revisá las opiniones recientes para detectar oportunidades de mejora.', tone: 'info' },
]
const MIN_ITEMS = 4

const displayInsights = computed<AiInsight[]>(() => {
  if (props.insights.length >= MIN_ITEMS) return props.insights
  return [...props.insights, ...FALLBACK_TIPS.slice(0, MIN_ITEMS - props.insights.length)]
})

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
})
</script>

<style scoped>
.cc-breathe { animation: cc-breathe 5s ease-in-out infinite; }
@keyframes cc-breathe {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.cc-robot-glow {
  filter: drop-shadow(0 0 14px rgba(37, 99, 235, 0.65)) drop-shadow(0 0 34px rgba(6, 182, 212, 0.4));
}
</style>
