<template>
  <!-- Centro de configuración — wizard standalone (rediseño a pedido del usuario, 2026-09-08):
       pantalla propia SIN sidebar (ver router/index.ts: top-level route, no hijo de /panel), solo
       un botón de volver. Fondo blanco, un ícono a color distinto por paso (nada de la paleta
       navy/cyan del resto del panel a propósito) y una barra de pasos navegable — reemplaza el
       acordeón de la versión anterior (F3) por un stepper clásico: un paso activo a la vez, salto
       directo a cualquiera desde la barra. Los Step*.vue internos (formularios + guardado
       aislado) no cambiaron — solo cambió el contenedor que los muestra. -->
  <div class="min-h-screen bg-white flex flex-col">
    <!-- Top bar: volver + progreso -->
    <header class="border-b border-border px-4 sm:px-6 py-4 flex items-center justify-between shrink-0 gap-3">
      <button @click="goBack" type="button"
        class="flex items-center gap-1.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer shrink-0">
        <span class="w-4 h-4" v-html="ICON_ARROW_LEFT"></span>
        Volver
      </button>
      <div class="text-sm font-black text-navy shrink-0" v-if="status">{{ progress }}% completo</div>
    </header>

    <!-- Loading skeleton -->
    <div v-if="loading" class="flex-1 flex flex-col items-center justify-center gap-4 p-10">
      <div class="w-14 h-14 rounded-full bg-surface animate-pulse"></div>
      <div class="w-64 h-4 rounded bg-surface animate-pulse"></div>
    </div>

    <template v-else-if="status">
      <!-- Barra de pasos — navegable: click en cualquier círculo salta directo a ese paso. -->
      <nav class="border-b border-border px-4 sm:px-6 py-6 overflow-x-auto shrink-0" aria-label="Pasos de configuración">
        <ol class="flex items-center justify-center min-w-max mx-auto max-w-5xl">
          <li v-for="(s, i) in status.steps" :key="s.key" class="flex items-center">
            <button @click="activeIndex = i" type="button"
              class="flex flex-col items-center gap-1.5 cursor-pointer group px-1.5"
              :aria-current="activeIndex === i ? 'step' : undefined">
              <span class="relative w-11 h-11 rounded-full grid place-items-center shrink-0 transition-all duration-200 ring-offset-2"
                :style="stepCircleStyle(s, i)">
                <svg v-if="s.done" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span v-else class="w-5 h-5 text-white" v-html="STEP_META[s.key]?.icon ?? ICON_DOT"></span>
              </span>
              <span class="text-[10px] font-bold whitespace-nowrap transition-colors"
                :class="activeIndex === i ? 'text-navy' : 'text-text-muted group-hover:text-text-secondary'">
                {{ SHORT_LABEL[s.key] ?? s.title }}
              </span>
            </button>
            <div v-if="i < status.steps.length - 1" class="w-6 sm:w-10 h-0.5 mx-0.5 shrink-0 rounded-full transition-colors"
              :class="s.done ? 'bg-teal' : 'bg-border'"></div>
          </li>
        </ol>
      </nav>

      <!-- Panel del paso activo -->
      <main class="flex-1 overflow-y-auto px-4 sm:px-6 py-10">
        <div class="max-w-2xl mx-auto">
          <!-- Estado 100%: reemplaza el panel del paso por un cierre celebratorio. -->
          <template v-if="status.completed && activeIndex === 0 && !userNavigated">
            <div class="text-center py-10">
              <div class="w-20 h-20 rounded-full bg-teal/10 text-teal grid place-items-center mx-auto mb-5">
                <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h1 class="text-2xl font-black text-navy mb-2">Su hotel está listo</h1>
              <p class="text-sm text-text-muted max-w-md mx-auto">
                Completó todo lo necesario. Puede repasar u optimizar los pasos opcionales desde la barra de arriba cuando quiera.
              </p>
              <button @click="goBack" type="button"
                class="mt-6 bg-navy text-white font-bold text-sm px-6 py-3 rounded-full hover:bg-navy-light transition-colors cursor-pointer">
                Volver al dashboard
              </button>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center gap-4 mb-7">
              <span class="w-14 h-14 rounded-2xl grid place-items-center shrink-0 text-white"
                :style="{ background: STEP_META[activeStep.key]?.color ?? '#0A1426' }">
                <svg v-if="activeStep.done" class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span v-else class="w-7 h-7" v-html="STEP_META[activeStep.key]?.icon ?? ICON_DOT"></span>
              </span>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-xl font-black text-navy">{{ activeStep.title }}</h1>
                  <span v-if="!activeStep.required" class="text-[10px] font-bold text-text-muted bg-surface px-2 py-0.5 rounded-full shrink-0">opcional</span>
                </div>
                <p class="text-sm text-text-muted">{{ activeStep.description }}</p>
              </div>
            </div>

            <!-- SIN mode="out-in": con out-in, Vue espera el evento `transitionend` de la salida
                 antes de montar el componente entrante — si ese evento no llega (foco de pestaña,
                 throttling, navegación muy rápida) la transición queda TRABADA para siempre y el
                 panel del paso se queda en blanco a partir de ahí (reproducido: 2da navegación en
                 adelante). Sin out-in ambas fases corren en paralelo, sin esa espera. -->
            <Transition name="step-fade">
              <component :is="stepComponent(activeStep.key)" :key="activeStep.key" :step="activeStep"
                @saved="onStepSaved" @skip="goNext" />
            </Transition>

            <!-- Navegación del wizard — además de la barra de arriba, prev/next lineales. -->
            <div class="flex items-center justify-between mt-8">
              <button v-if="activeIndex > 0" @click="goPrev" type="button"
                class="flex items-center gap-1.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">
                <span class="w-4 h-4" v-html="ICON_ARROW_LEFT"></span>
                Anterior
              </button>
              <div v-else></div>
              <button v-if="activeIndex < status.steps.length - 1" @click="goNext" type="button"
                class="flex items-center gap-1.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">
                Siguiente
                <span class="w-4 h-4" v-html="ICON_ARROW_RIGHT"></span>
              </button>
            </div>
          </template>
        </div>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { OnboardingService, type OnboardingStatus } from '@/services/Onboarding.service'
import StepBienvenida from './steps/StepBienvenida.vue'
import StepIdentidad from './steps/StepIdentidad.vue'
import StepContacto from './steps/StepContacto.vue'
import StepUbicacion from './steps/StepUbicacion.vue'
import StepPoliticas from './steps/StepPoliticas.vue'
import StepExternal from './steps/StepExternal.vue'

const router = useRouter()
const loading = ref(true)
const status = ref<OnboardingStatus | null>(null)
const activeIndex = ref(0)
/** Distingue "está en el 0% de recorrido del wizard, casualmente en el paso 0" (no navegó
 *  todavía) de "ya navegó" — sin esto, un hotel 100% completo que hace click en el paso 1 de la
 *  barra volvería a ver la pantalla de cierre en vez del contenido de ese paso. */
const userNavigated = ref(false)

function goBack() { router.push('/panel/dashboard') }
function goPrev() { userNavigated.value = true; if (activeIndex.value > 0) activeIndex.value-- }
function goNext() {
  userNavigated.value = true
  if (status.value && activeIndex.value < status.value.steps.length - 1) activeIndex.value++
}

const activeStep = computed(() => status.value!.steps[activeIndex.value]!)

const progress = computed(() => {
  if (!status.value) return 0
  const required = status.value.steps.filter((s) => s.required)
  if (!required.length) return 0
  return Math.round((required.filter((s) => s.done).length / required.length) * 100)
})

const STEP_COMPONENTS: Record<string, unknown> = {
  bienvenida: StepBienvenida, identidad: StepIdentidad, contacto: StepContacto,
  ubicacion: StepUbicacion, politicas: StepPoliticas,
  rooms: StepExternal,
}
function stepComponent(key: string) { return STEP_COMPONENTS[key] }

const SHORT_LABEL: Record<string, string> = {
  bienvenida: 'Bienvenida', identidad: 'Identidad', contacto: 'Contacto', ubicacion: 'Ubicación',
  politicas: 'Políticas', rooms: 'Habitaciones',
}

const ICON_ARROW_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/></svg>'
const ICON_ARROW_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/></svg>'
const ICON_DOT = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><circle cx="12" cy="12" r="4"/></svg>'

// Un color e ícono bien distinto por paso — a propósito FUERA de la paleta navy/cyan del resto
// del panel: el pedido explícito fue "que tengamos un wizard increíble", no otra pantalla más
// del panel administrativo. `rooms` reusa el ícono de cama que ya usa AdminLayout.vue (mismo
// path, ya verificado en producción).
const STEP_META: Record<string, { color: string; icon: string }> = {
  bienvenida: {
    color: '#3B82F6', // blue-500
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12 11.204 3.045a1.125 1.125 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg>',
  },
  identidad: {
    color: '#8B5CF6', // violet-500
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.5a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>',
  },
  contacto: {
    color: '#14B8A6', // teal-500
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a1.5 1.5 0 0 0 1.5-1.5v-3.108a1.5 1.5 0 0 0-1.06-1.435l-4.185-1.395a1.5 1.5 0 0 0-1.536.365l-1.146 1.146a11.25 11.25 0 0 1-5.11-5.11l1.146-1.147a1.5 1.5 0 0 0 .365-1.535L8.058 3.81A1.5 1.5 0 0 0 6.623 2.75H3.75a1.5 1.5 0 0 0-1.5 1.5v2.5Z"/></svg>',
  },
  ubicacion: {
    color: '#F97316', // orange-500
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>',
  },
  politicas: {
    color: '#EF4444', // red-500
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7 7.5 3v5.25c0 4.5-3 7.409-7.5 8.75-4.5-1.341-7.5-4.25-7.5-8.75V5.75l7.5-3Z"/></svg>',
  },
  rooms: {
    color: '#22C55E', // green-500
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M5 13V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>',
  },
}

function stepCircleStyle(s: { key: string; done: boolean }, i: number): Record<string, string> {
  const color = STEP_META[s.key]?.color ?? '#0A1426'
  const isActive = activeIndex.value === i
  return {
    background: s.done ? '#0D9488' /* teal-600, mismo tono que el resto del panel para "hecho" */ : color,
    boxShadow: isActive ? `0 0 0 3px white, 0 0 0 5px ${s.done ? '#0D9488' : color}` : 'none',
    transform: isActive ? 'scale(1.08)' : 'scale(1)',
  }
}

function onStepSaved(next: OnboardingStatus) {
  const savedIndex = activeIndex.value
  status.value = next
  // Breve pausa para que se vea el check tildarse en la barra antes de avanzar solo al
  // siguiente paso — flujo de wizard, no un colapso de acordeón.
  setTimeout(() => {
    if (activeIndex.value === savedIndex) goNext()
  }, 500)
}

onMounted(async () => {
  try {
    const s = await OnboardingService.status()
    status.value = s
    // Arranca en el primer paso pendiente (si hay uno) — si ya está todo completo, arranca en 0
    // y se muestra el cierre celebratorio en vez del contenido del paso.
    const firstPending = s.steps.findIndex((x) => !x.done)
    activeIndex.value = firstPending === -1 ? 0 : firstPending
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
/* Solo el paso ENTRANTE hace fade — sin mode="out-in" el saliente y el entrante conviven un
   instante en el DOM; si el saliente también transicionara (position estática) se vería un
   salto de layout con los dos apilados. El saliente desaparece al instante (sin leave-active),
   el entrante hace fade-in solo. */
.step-fade-enter-active {
  transition: opacity .15s ease;
}
.step-fade-enter-from {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .step-fade-enter-active { transition: none; }
}
</style>
