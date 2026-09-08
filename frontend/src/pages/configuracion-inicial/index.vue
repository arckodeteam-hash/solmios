<template>
  <!--
    Centro de configuración (wizard-refactor F3, doc 05/08 D6) — acordeón de pasos, refactor de
    OnboardingGuide.vue pero como pantalla propia (no franja del dashboard). Pasos de perfil
    (`kind:'profile'`) se completan inline; operativos (`kind:'external'`) navegan a su pantalla
    real — mismo comportamiento de siempre para esos 4, solo que ahora también viven acá.

    Un solo paso abierto a la vez (tarea 3.4) — a diferencia de OnboardingGuide.vue, un paso YA
    HECHO también se puede reabrir: acá el objetivo es completar/editar, no solo leer "cómo se
    hace" (doc 05: "por si el usuario quiere repasar o editar algo opcional").
  -->
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-3">
      <div class="h-24 bg-surface rounded-2xl animate-pulse"></div>
      <div v-for="i in 6" :key="i" class="h-14 bg-surface rounded-xl animate-pulse"></div>
    </div>

    <template v-else-if="status">
      <!-- Cabecera: progreso combinado. Transición notoria una sola vez al llegar al 100%
           (tarea 3.12) — el resto del tiempo es solo la barra que avanza. -->
      <div
        class="rounded-2xl border-2 border-navy bg-navy overflow-hidden px-6 py-5 transition-all duration-500"
        :class="justCompleted ? 'celebrate' : ''"
      >
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <h1 class="text-lg font-black text-white">
              {{ status.completed ? 'Su hotel está listo' : 'Configuración inicial de su hotel' }}
            </h1>
            <p class="text-xs text-white/60 mt-0.5">
              {{ status.completed
                ? 'Completó todo lo necesario — puede repasar los pasos opcionales cuando quiera.'
                : 'Complete esto para que su hotel se vea listo en la página pública y funcione sin baches.' }}
            </p>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span class="text-2xl font-black text-cyan">{{ progress }}%</span>
            <div class="w-28 h-2 rounded-full bg-white/15 overflow-hidden">
              <div class="h-full bg-cyan transition-all duration-500" :style="{ width: progress + '%' }"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Lista de pasos -->
      <div class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden divide-y divide-border">
        <div v-for="(s, i) in status.steps" :key="s.key">
          <!-- Cabecera del paso: toda la fila abre y cierra el contenido. -->
          <div
            class="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-surface/40 transition-colors"
            @click="toggle(s.key)"
          >
            <span
              class="w-7 h-7 rounded-full grid place-items-center shrink-0 text-xs font-black"
              :class="stepIconClass(s)"
            >
              <svg v-if="s.done" class="w-3.5 h-3.5 check-pop" :class="{ 'just-saved': justSavedKey === s.key }" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span v-else-if="s.kind === 'external'" class="w-3 h-3" v-html="ICON_HEX"></span>
              <template v-else>{{ i + 1 }}</template>
            </span>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-bold text-navy">{{ s.title }}</span>
                <span v-if="typeof s.count === 'number'" class="text-[10px] font-bold text-teal bg-teal/10 px-1.5 py-0.5 rounded-full">{{ s.count }}</span>
                <span v-if="!s.required" class="text-[10px] font-bold text-text-muted bg-surface px-1.5 py-0.5 rounded-full">opcional</span>
                <span v-if="s.done" class="text-[10px] font-bold text-teal">hecho</span>
              </div>
              <p v-if="!s.done" class="text-[11px] text-text-muted mt-0.5 truncate">{{ s.description }}</p>
            </div>

            <span
              class="shrink-0 w-4 h-4 text-text-muted transition-transform duration-200"
              :class="open === s.key ? 'rotate-180' : ''"
              v-html="ICON_CHEVRON"
            ></span>
          </div>

          <!-- Contenido expandido: transición de alto + fade (tarea 3.4). -->
          <Transition name="step-expand">
            <div v-if="open === s.key" class="px-5 pb-5 pl-16 overflow-hidden">
              <component
                :is="stepComponent(s.key)"
                :step="s"
                @saved="(next: OnboardingStatus) => onStepSaved(next, s.key)"
                @skip="open = null"
              />
            </div>
          </Transition>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { OnboardingService, type OnboardingStatus, type OnboardingStep } from '@/services/Onboarding.service'
import StepBienvenida from './steps/StepBienvenida.vue'
import StepIdentidad from './steps/StepIdentidad.vue'
import StepContacto from './steps/StepContacto.vue'
import StepUbicacion from './steps/StepUbicacion.vue'
import StepPoliticas from './steps/StepPoliticas.vue'
import StepAmenities from './steps/StepAmenities.vue'
import StepExternal from './steps/StepExternal.vue'

const loading = ref(true)
const status = ref<OnboardingStatus | null>(null)
/** Paso desplegado. Uno solo por vez (tarea 3.4, mismo patrón que OnboardingGuide.vue). */
const open = ref<string | null>(null)
/** Key del paso recién guardado — anima el check de vacío a tildado y colapsa después de un
 *  breve delay (doc 05, animaciones), para que el usuario vea que quedó guardado. */
const justSavedKey = ref<string | null>(null)
/** El 100% es un evento que pasa una sola vez en la vida del hotel — transición notoria solo
 *  la primera vez que se detecta acá (no cada vez que se reabre la pantalla ya completa). */
const justCompleted = ref(false)
let wasCompleted = false

const ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>'
// Rombo — refuerza que un paso operativo manda a otra pantalla, ANTES de abrirlo (doc 05).
const ICON_HEX = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M12 2 3 12l9 10 9-10-9-10z"/></svg>'

// Mismo criterio que ProfileProgressBar.vue (doc 04, "Qué cuenta el porcentaje"): SOLO pasos
// requeridos, opcionales afuera del numerador y el denominador. Antes esto usaba
// `doneCount`/`totalCount` del backend (que sí incluye opcionales) — mostraba un % distinto al
// de la franja del dashboard (ej. 80% ahí, 60% acá para el mismo hotel), que leía como un bug
// aunque los dos números fueran "correctos" para lo que medían cada uno. Los pasos opcionales
// se siguen viendo con su check individual en la lista de abajo, solo no cuentan acá arriba.
const requiredSteps = computed(() => status.value?.steps.filter((s) => s.required) ?? [])
const progress = computed(() => {
  const total = requiredSteps.value.length
  if (!total) return 0
  const done = requiredSteps.value.filter((s) => s.done).length
  return Math.round((done / total) * 100)
})

function stepIconClass(s: OnboardingStep): string {
  if (s.done) return 'bg-teal text-white'
  if (s.kind === 'external') return 'bg-navy/10 text-navy'
  return 'border-2 border-border text-text-muted'
}

// Import estático (no `defineAsyncComponent`): esta pantalla ya es su propio chunk lazy-cargado
// por el router (`router/index.ts`), así que separar cada step en OTRO chunk async no ahorra
// nada real acá — y con `defineAsyncComponent` dentro de un `<Transition>` la resolución async
// se pisa mal con el auto-stubbing de `@vue/test-utils` (ver index.test.ts).
const STEP_COMPONENTS: Record<string, unknown> = {
  bienvenida: StepBienvenida,
  identidad: StepIdentidad,
  contacto: StepContacto,
  ubicacion: StepUbicacion,
  politicas: StepPoliticas,
  amenities: StepAmenities,
  // Un solo componente genérico para los 4 pasos operativos (doc 06 sección 4) — misma UI que
  // ya usa OnboardingGuide.vue hoy para estos 4, no hace falta uno por paso.
  rooms: StepExternal,
  rates: StepExternal,
  channels: StepExternal,
  team: StepExternal,
}
function stepComponent(key: string) { return STEP_COMPONENTS[key] }

function toggle(key: string) {
  open.value = open.value === key ? null : key
}

// `savedKey` viene del `s.key` capturado en el scope del v-for al momento de registrar el
// listener (tarea 3.4/3.12) — NO de `open.value` al momento en que la promesa resuelve. Si el
// usuario guarda el paso A y cambia a B ANTES de que el request de A termine, `open.value` ya
// es B cuando este callback corre: usar `open.value` acá le atribuía la animación/auto-colapso
// de "guardado" al paso B (que el usuario recién abrió, ni tocó el botón), cerrándoselo solo.
function onStepSaved(next: OnboardingStatus, savedKey: string) {
  status.value = next
  justSavedKey.value = savedKey
  // Breve delay antes de colapsar: tiempo para ver el check animado (doc 05). Solo colapsa si
  // el paso guardado sigue siendo el que está abierto — si el usuario ya se movió a otro, no
  // le toca la pantalla.
  setTimeout(() => {
    if (open.value === savedKey) open.value = null
    if (justSavedKey.value === savedKey) justSavedKey.value = null
  }, 700)
  checkJustCompleted(next)
}

function checkJustCompleted(next: OnboardingStatus) {
  if (next.completed && !wasCompleted) {
    justCompleted.value = true
    setTimeout(() => { justCompleted.value = false }, 900)
  }
  wasCompleted = next.completed
}

onMounted(async () => {
  try {
    const s = await OnboardingService.status()
    status.value = s
    wasCompleted = s.completed
    // Arranca abierto el primer paso pendiente — igual criterio que OnboardingGuide.vue: si hay
    // que tocar para ver el formulario, la mayoría no toca.
    open.value = s.steps.find((x) => !x.done)?.key ?? null
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.step-expand-enter-active, .step-expand-leave-active {
  transition: max-height .2s ease, opacity .2s ease;
  max-height: 700px;
  overflow: hidden;
}
.step-expand-enter-from, .step-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.check-pop { transition: transform .15s ease; }
.check-pop.just-saved { animation: checkPop .25s ease; }
@keyframes checkPop {
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.25); opacity: 1; }
  100% { transform: scale(1); }
}

.celebrate { animation: celebrateFade .5s ease; }
@keyframes celebrateFade {
  0% { transform: scale(0.98); opacity: .7; }
  60% { transform: scale(1.01); }
  100% { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .step-expand-enter-active, .step-expand-leave-active { transition: none; }
  .check-pop.just-saved, .celebrate { animation: none; }
}
</style>
