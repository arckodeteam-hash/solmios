<template>
  <!-- Centro de configuración — wizard standalone (rediseño 2026-09-09, réplica del mockup del
       usuario: header con logo + "Paso X de N", barra de pasos numerada, tarjeta blanca a dos
       columnas — panel de foto+copy a la izquierda, formulario a la derecha — y acciones
       centralizadas en el pie de la tarjeta). Pantalla propia SIN sidebar (ver router/index.ts:
       top-level route, no hijo de /panel). Los Step*.vue internos ya no dibujan su propio botón
       de guardado: exponen `save()` (y `skip()` cuando aplica) vía `defineExpose`, y este shell
       los invoca desde el botón único "Guardar y continuar" para que quede en una sola fila con
       "Anterior", como en el mockup. -->
  <div class="min-h-screen flex flex-col" style="background: var(--color-surface)">
    <!-- Header: logo + contexto, % + "Paso X de N". flex-wrap + border-b: si el contenido no
         entra en una fila (viewport angosto, zoom alto) pasa a una 2da línea en vez de comprimirse
         contra la barra de pasos de abajo — antes se veían "pisados" entre sí. -->
    <header class="px-4 sm:px-8 py-6 flex flex-wrap items-center justify-between gap-3 shrink-0 border-b border-border/60">
      <button @click="guardedNavigate(goBack)" type="button" class="flex items-center gap-3 cursor-pointer group">
        <img src="@/assets/logo/logo-horizontal-color.png" alt="SolmiOS" class="h-6 sm:h-7 w-auto">
        <span class="hidden sm:inline text-border">|</span>
        <span class="hidden sm:inline text-sm font-bold text-text-secondary group-hover:text-navy transition-colors">Configura tu propiedad</span>
      </button>
      <div v-if="status" class="flex items-center gap-3 shrink-0">
        <span class="text-sm font-black text-teal">{{ progress }}% completo</span>
        <span class="text-border">|</span>
        <span class="text-sm font-bold text-text-muted">Paso {{ activeIndex + 1 }} de {{ status.steps.length }}</span>
      </div>
    </header>

    <!-- Loading skeleton -->
    <div v-if="loading" class="flex-1 flex flex-col items-center justify-center gap-4 p-10">
      <div class="w-14 h-14 rounded-full bg-white animate-pulse"></div>
      <div class="w-64 h-4 rounded bg-white animate-pulse"></div>
    </div>

    <template v-else-if="status">
      <!-- Barra de pasos — numerada, navegable: click en cualquier círculo salta directo a ese paso. -->
      <nav class="px-4 sm:px-8 pt-6 pb-6 overflow-x-auto shrink-0" aria-label="Pasos de configuración">
        <ol class="flex items-center justify-center min-w-max mx-auto max-w-5xl">
          <li v-for="(s, i) in status.steps" :key="s.key" class="flex items-center">
            <button @click="guardedNavigate(() => activeIndex = i)" type="button"
              class="flex flex-col items-center gap-2 cursor-pointer group px-1.5"
              :aria-current="activeIndex === i ? 'step' : undefined">
              <span class="w-10 h-10 rounded-full grid place-items-center shrink-0 font-black text-sm transition-all duration-200"
                :class="stepCircleClass(s, i)">
                <svg v-if="s.done" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span v-else>{{ i + 1 }}</span>
              </span>
              <span class="text-[11px] font-bold whitespace-nowrap transition-colors"
                :class="activeIndex === i ? 'text-navy' : 'text-text-muted group-hover:text-text-secondary'">
                {{ SHORT_LABEL[s.key] ?? s.title }}
              </span>
            </button>
            <div v-if="i < status.steps.length - 1" class="w-8 sm:w-14 h-0.5 mx-1 shrink-0 rounded-full transition-colors mb-6"
              :class="s.done ? 'bg-teal' : 'bg-border'"></div>
          </li>
        </ol>
      </nav>

      <main class="flex-1 px-4 sm:px-8 pb-8">
        <!-- Estado 100%: reemplaza la tarjeta por un cierre celebratorio. -->
        <div v-if="status.completed && activeIndex === 0 && !userNavigated" class="max-w-5xl mx-auto bg-white rounded-[28px] shadow-lg shadow-slate-200/60 p-10 sm:p-16 text-center">
          <div class="w-20 h-20 rounded-full bg-teal/10 text-teal grid place-items-center mx-auto mb-5">
            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 class="text-2xl font-black text-navy mb-2">Su hotel está listo</h1>
          <p class="text-sm text-text-muted max-w-md mx-auto">
            Completó todo lo necesario. Puede repasar u optimizar los pasos opcionales desde la barra de arriba cuando quiera.
          </p>
          <button @click="guardedNavigate(goBack)" type="button" class="wizard-btn-primary mt-6">
            Volver al dashboard
          </button>
        </div>

        <template v-else>
          <!-- Tarjeta principal: panel de foto+copy (izquierda) + formulario (derecha). Bienvenida/
               Contacto/Habitaciones (1, 3 y 6 — pasos cortos) comparten el alto medido de
               Bienvenida (542px) para no "saltar" de tamaño entre ellos; Identidad/Ubicación/
               Políticas quedan con su alto natural (contenido bien distinto: logo, mapa, política
               de cancelación completa) — pedido explícito del usuario. -->
          <div class="max-w-5xl mx-auto bg-white rounded-[28px] shadow-lg shadow-slate-200/60 overflow-hidden grid grid-cols-1 lg:grid-cols-[300px_1fr]"
            :class="FIXED_HEIGHT_STEPS.has(activeStep.key) ? 'lg:h-136' : ''">
            <!-- Panel decorativo — cambia de foto/copy por paso, estático dentro del paso (no
                 forma parte del formulario). Oculto en mobile para no empujar el form abajo del
                 todo en pantallas chicas. La foto ocupa TODO el alto de la columna (grid stretch
                 por default) con el texto superpuesto abajo — degradado oscuro de abajo hacia
                 arriba para que el texto blanco quede legible sobre cualquier foto. -->
            <div class="hidden lg:block relative">
              <img :src="marketing.image" :alt="marketing.heading" class="absolute inset-0 w-full h-full object-cover">
              <div class="absolute inset-0 bg-linear-to-t from-black/85 via-black/35 to-black/0"></div>
              <div class="relative h-full flex flex-col justify-end p-7">
                <span class="w-11 h-11 rounded-xl grid place-items-center mb-4 shrink-0 bg-white/15 backdrop-blur-sm ring-1 ring-white/25 text-white">
                  <span class="w-5 h-5" v-html="STEP_META[activeStep.key]?.icon ?? ICON_DOT"></span>
                </span>
                <h3 class="text-lg font-black text-white leading-snug mb-2 [text-shadow:0_1px_4px_rgba(0,0,0,0.4)]">{{ marketing.heading }}</h3>
                <p class="text-[13px] text-white/90 leading-relaxed [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">{{ marketing.description }}</p>
                <div class="w-8 h-0.5 bg-teal-light rounded-full my-4"></div>
                <p class="text-[13px] font-serif italic text-teal-light leading-snug [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">{{ marketing.tagline }}</p>
              </div>
            </div>

            <!-- Formulario del paso activo -->
            <div class="p-6 sm:p-10 flex flex-col">
              <div class="flex items-center gap-4 mb-7">
                <span class="w-12 h-12 rounded-xl grid place-items-center shrink-0 bg-teal/10 text-teal">
                  <svg v-if="activeStep.done" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span v-else class="w-6 h-6" v-html="STEP_META[activeStep.key]?.icon ?? ICON_DOT"></span>
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
                <component :is="stepComponent(activeStep.key)" :key="activeStep.key" ref="stepRef"
                  :step="activeStep" @saved="onStepSaved" @skip="goNext" />
              </Transition>

              <!-- Acciones — una sola fila: Anterior a la izquierda, Guardar y continuar a la
                   derecha (Saltear entre medio para el único paso opcional que lo necesita). Los
                   pasos operativos (kind:'external', ej. Habitaciones) no tienen "guardado
                   inline" — su acción real es el CTA que ya renderiza el propio componente. -->
              <div class="flex flex-wrap items-center justify-between gap-3 mt-8 pt-6 border-t border-border">
                <button v-if="activeIndex > 0" @click="guardedNavigate(goPrev)" type="button" class="wizard-btn-secondary shrink-0">
                  <span class="w-4 h-4" v-html="ICON_ARROW_LEFT"></span>
                  Anterior
                </button>
                <div v-else></div>
                <div class="flex items-center gap-3 ml-auto">
                  <button v-if="!activeStep.required && activeStep.kind === 'profile'" @click="handleSkip" type="button"
                    class="text-text-secondary font-bold text-sm px-4 py-2 rounded-full hover:bg-surface transition-colors cursor-pointer shrink-0">
                    Saltear
                  </button>
                  <button v-if="activeStep.kind === 'profile'" @click="handlePrimaryAction" :disabled="submitting" type="button"
                    class="wizard-btn-primary shrink-0">
                    {{ submitting ? 'Guardando…' : 'Guardar y continuar' }}
                    <span class="w-4 h-4" v-html="ICON_ARROW_RIGHT"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Barra de ayuda — fuera de la tarjeta, mismo layout que el mockup. -->
          <div class="max-w-5xl mx-auto mt-4 bg-white rounded-2xl shadow-sm shadow-slate-200/50 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm font-bold text-navy">¿Necesita ayuda?</p>
              <p class="text-[13px] text-text-muted">Estamos acá para ayudarlo en cada paso.</p>
            </div>
            <a :href="`mailto:${SUPPORT_EMAIL}`" class="wizard-btn-secondary shrink-0">
              <span class="w-4 h-4" v-html="ICON_MAIL"></span>
              {{ SUPPORT_EMAIL }}
            </a>
          </div>
        </template>
      </main>
    </template>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { OnboardingService, type OnboardingStatus } from '@/services/Onboarding.service'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
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
const submitting = ref(false)
/** Instancia del step activo — cada Step*.vue expone `save()` (y `skip()` cuando aplica) vía
 *  `defineExpose`; el shell los invoca desde acá en vez de que cada componente dibuje su propio
 *  botón, así "Anterior"/"Guardar y continuar" quedan en una sola fila (mockup del usuario). */
const stepRef = ref<{ save?: () => Promise<void>; skip?: () => void; isDirty?: boolean } | null>(null)
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

/** Cambios sin guardar: cada Step*.vue expone `isDirty` (mismo patrón que
 *  `pagina-publica/general.vue`) y ESTE shell decide qué hacer con eso, ya que es quien controla
 *  la navegación entre pasos (barra de pasos, "Anterior", volver al dashboard). Sin esto, saltar
 *  de paso sin guardar descarta en silencio lo tipeado — reportado con el país del paso 1: se
 *  cambiaba y, si no se guardaba antes de saltar a Ubicación, el mapa seguía centrado en el país
 *  viejo porque Ubicación recarga los datos del hotel desde el backend al montar. */
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm()
function guardedNavigate(action: () => void) {
  if (!stepRef.value?.isDirty) { action(); return }
  askConfirm({
    title: 'Cambios sin guardar',
    message: 'Este paso tiene cambios sin guardar. Si cambia de paso ahora, se van a perder.',
    confirmLabel: 'Cambiar sin guardar',
    danger: true,
    run: async () => action(),
  })
}

async function handlePrimaryAction() {
  if (!stepRef.value?.save || submitting.value) return
  submitting.value = true
  try {
    await stepRef.value.save()
  } finally {
    submitting.value = false
  }
}
function handleSkip() { guardedNavigate(() => stepRef.value?.skip?.()) }

const activeStep = computed(() => status.value!.steps[activeIndex.value]!)

/** Pasos 1, 3 y 6 (Bienvenida/Contacto/Habitaciones) comparten un alto fijo — pedido explícito
 *  del usuario, "ponlo del alto de paso 1". Identidad/Ubicación/Políticas (2, 4, 5) quedan con
 *  su alto natural. */
const FIXED_HEIGHT_STEPS = new Set(['bienvenida', 'contacto', 'rooms'])

// Mismo criterio que ProfileProgressBar.vue del dashboard (doc 04): SOLO pasos requeridos, los
// opcionales (Contacto, etc.) no cuentan ni para el numerador ni el denominador.
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
const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>'
const ICON_DOT = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><circle cx="12" cy="12" r="4"/></svg>'
const SUPPORT_EMAIL = 'soporte@solmios.com'

// Réplica del mockup del usuario (2026-09-09): un solo acento (teal, `--color-teal` del design
// system) en vez de un color distinto por paso — el ícono es lo único que cambia entre pasos,
// siempre sobre el mismo cuadrado mint. `rooms` reusa el ícono de cama que ya usa AdminLayout.vue.
const STEP_META: Record<string, { icon: string }> = {
  bienvenida: {
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12 11.204 3.045a1.125 1.125 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg>',
  },
  identidad: {
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path stroke-linecap="round" stroke-linejoin="round" d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path stroke-linecap="round" stroke-linejoin="round" d="M10 6h4M10 10h4M10 14h4M10 18h4"/></svg>',
  },
  contacto: {
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a1.5 1.5 0 0 0 1.5-1.5v-3.108a1.5 1.5 0 0 0-1.06-1.435l-4.185-1.395a1.5 1.5 0 0 0-1.536.365l-1.146 1.146a11.25 11.25 0 0 1-5.11-5.11l1.146-1.147a1.5 1.5 0 0 0 .365-1.535L8.058 3.81A1.5 1.5 0 0 0 6.623 2.75H3.75a1.5 1.5 0 0 0-1.5 1.5v2.5Z"/></svg>',
  },
  ubicacion: {
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>',
  },
  politicas: {
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7 7.5 3v5.25c0 4.5-3 7.409-7.5 8.75-4.5-1.341-7.5-4.25-7.5-8.75V5.75l7.5-3Z"/></svg>',
  },
  rooms: {
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M5 13V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>',
  },
}

/** Panel decorativo (foto + copy) del costado izquierdo — reusa las mismas fotos de Unsplash que
 *  ya sirve `auth/login.vue` (probadas, sin depender de subir assets nuevos al repo). */
const PHOTO_1 = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'
const PHOTO_2 = 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=800&q=80'
const PHOTO_3 = 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=800&q=80'
const PHOTO_4 = 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=800&q=80'

const STEP_MARKETING: Record<string, { image: string; heading: string; description: string; tagline: string }> = {
  bienvenida: {
    image: PHOTO_1,
    heading: 'Bienvenido a bordo',
    description: 'Empecemos por lo básico: cómo se llama su hotel y cómo lo contactamos.',
    tagline: 'Su hotel, listo en minutos',
  },
  identidad: {
    image: PHOTO_2,
    heading: 'Su alojamiento, su historia',
    description: 'Cuéntenos los detalles de su propiedad para mostrarla al mundo de la mejor manera.',
    tagline: 'Más reservas, mejores experiencias',
  },
  contacto: {
    image: PHOTO_3,
    heading: 'Que lo encuentren fácil',
    description: 'Sume los datos extra que ayudan a un huésped a confiar y contactarlo.',
    tagline: 'Cerca de sus huéspedes',
  },
  ubicacion: {
    image: PHOTO_4,
    heading: 'Marque el mapa',
    description: 'Una ubicación exacta es la diferencia entre una reserva y una duda.',
    tagline: 'Fácil de encontrar, fácil de reservar',
  },
  politicas: {
    image: PHOTO_1,
    heading: 'Reglas claras, menos sorpresas',
    description: 'Defina impuestos y cancelación para que cada reserva sea prolija.',
    tagline: 'Transparencia que genera confianza',
  },
  rooms: {
    image: PHOTO_2,
    heading: 'Lo que va a vender',
    description: 'Cargue sus habitaciones para que el calendario cobre vida.',
    tagline: 'Cada habitación, una oportunidad',
  },
}
const marketing = computed(() => STEP_MARKETING[activeStep.value.key] ?? STEP_MARKETING.bienvenida!)

function stepCircleClass(s: { done: boolean }, i: number): string {
  const isActive = activeIndex.value === i
  if (s.done) return isActive ? 'bg-teal text-white ring-2 ring-offset-2 ring-teal' : 'bg-teal text-white'
  if (isActive) return 'bg-white border-2 text-navy scale-110' + ' border-teal'
  return 'bg-white border-2 border-border text-text-muted'
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
