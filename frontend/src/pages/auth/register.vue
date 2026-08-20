<template>
  <div class="min-h-screen flex">
    <!-- Columna de marca: qué incluye la prueba -->
    <div class="hidden lg:flex lg:w-2/5 relative overflow-hidden bg-navy">
      <div class="absolute inset-0 bg-gradient-to-br from-navy via-navy to-navy-light"></div>
      <div class="relative z-10 flex flex-col justify-between w-full p-12 text-white">
        <div>
          <img :src="logoWhite" alt="SolmiOS" class="h-8 w-auto">
          <div class="text-[10px] text-white/60 uppercase tracking-wide mt-1.5">Panel Hotel</div>
        </div>

        <div class="max-w-sm">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan/15 border border-cyan/30 mb-5">
            <span class="w-1.5 h-1.5 rounded-full bg-cyan"></span>
            <span class="text-[11px] font-bold text-cyan">{{ trialDays }} días gratis</span>
          </div>
          <h2 class="text-3xl font-black leading-tight mb-3">Empezá a gestionar tu hotel hoy</h2>
          <p class="text-white/70 text-sm leading-relaxed mb-8">
            Sin tarjeta de crédito. Configurás tu hotel y arrancás en minutos.
          </p>
          <ul class="space-y-3">
            <li v-for="item in perks" :key="item" class="flex items-start gap-2.5 text-sm text-white/85">
              <span class="w-4 h-4 mt-0.5 rounded-full bg-cyan/20 grid place-items-center shrink-0">
                <svg class="w-2.5 h-2.5 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
              </span>
              {{ item }}
            </li>
          </ul>
        </div>

        <p class="text-[11px] text-white/40">
          ¿Ya tenés cuenta?
          <router-link to="/login" class="text-cyan font-bold hover:underline">Iniciá sesión</router-link>
        </p>
      </div>
    </div>

    <!-- Formulario -->
    <div class="flex-1 flex items-center justify-center p-6 bg-surface">
      <div class="w-full max-w-md">
        <!-- Pasos. Se piden los datos en dos tandas para que no sea un muro de
             campos, pero la cuenta se crea de una sola vez al final: si se
             creara el usuario en el paso 1, una salida a mitad de camino dejaría
             cuentas sin hotel. -->
        <div class="flex items-center gap-2 mb-8">
          <div v-for="s in 2" :key="s" class="flex items-center gap-2 flex-1">
            <span
              class="w-7 h-7 rounded-full grid place-items-center text-xs font-black shrink-0 transition-colors"
              :class="step >= s ? 'bg-navy text-white' : 'bg-white text-text-muted border border-border'"
            >{{ s }}</span>
            <span class="text-[11px] font-bold" :class="step >= s ? 'text-navy' : 'text-text-muted'">
              {{ s === 1 ? 'Tu cuenta' : 'Tu hotel' }}
            </span>
            <span v-if="s === 1" class="h-px flex-1" :class="step > 1 ? 'bg-navy' : 'bg-border'"></span>
          </div>
        </div>

        <div v-if="referrerHotelName" class="flex items-center gap-3 px-4 py-3 rounded-xl bg-cyan/10 border-2 border-cyan/40 mb-4">
          <span class="w-2 h-2 rounded-full bg-cyan shrink-0"></span>
          <div class="min-w-0">
            <div class="text-[11px] font-bold uppercase tracking-wide text-text-muted">Te invitó</div>
            <div class="text-base font-black text-navy truncate">{{ referrerHotelName }}</div>
            <div class="text-[11px] text-text-muted">Al validar tu cuenta, gana meses gratis.</div>
          </div>
        </div>

        <h1 class="text-2xl font-black text-navy mb-1">
          {{ step === 1 ? 'Creá tu cuenta' : 'Contanos de tu hotel' }}
        </h1>
        <p class="text-sm text-text-muted mb-6">
          {{ step === 1 ? `Empezás con ${trialDays} días gratis, sin tarjeta.` : 'Estos datos se pueden cambiar después.' }}
        </p>

        <!-- Paso 1: la persona -->
        <form v-if="step === 1" @submit.prevent="goToStep2" class="space-y-4">
          <div>
            <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">
              Nombre y apellido <span class="text-danger">*</span>
            </label>
            <div class="relative">
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" v-html="ICON_USER"></span>
              <input v-model="form.ownerName" type="text" required autocomplete="name" :maxlength="LIMITS.ownerName"
              data-testid="register-owner-name"
              class="w-full pl-10 pr-4 py-2.5 bg-white border border-border rounded-xl text-sm focus:outline-none focus:border-navy"
              placeholder="Ana Pérez García">
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">
              Email <span class="text-danger">*</span>
            </label>
            <div class="relative">
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                :class="emailTouched && !emailValid ? 'text-danger' : 'text-text-muted'" v-html="ICON_MAIL"></span>
              <input v-model="form.email" type="email" required autocomplete="email" :maxlength="LIMITS.email"
                data-testid="register-email"
                class="w-full pl-10 pr-4 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:border-navy"
                :class="emailTouched && !emailValid ? 'border-danger' : 'border-border'"
                @blur="emailTouched = true"
                placeholder="vos@tuhotel.com">
            </div>
            <p v-if="emailTouched && !emailValid" class="text-[11px] text-danger mt-1">
              Escribí un email válido, con dominio completo (ej: ana@tuhotel.com).
            </p>
            <p v-else class="text-[11px] text-text-muted mt-1">Con este email vas a iniciar sesión.</p>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">
              Contraseña <span class="text-danger">*</span>
            </label>
            <div class="relative">
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" v-html="ICON_LOCK"></span>
              <input v-model="form.password" :type="showPassword ? 'text' : 'password'" required
                autocomplete="new-password" :maxlength="PASSWORD_MAX"
                data-testid="register-password"
                class="w-full pl-10 pr-11 py-2.5 bg-white border border-border rounded-xl text-sm focus:outline-none focus:border-navy"
                placeholder="Elegí una contraseña segura">
              <button type="button" @click="showPassword = !showPassword"
                :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                :title="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                class="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted hover:text-navy cursor-pointer"
                v-html="showPassword ? ICON_EYE_OFF : ICON_EYE">
              </button>
            </div>

            <!-- Fuerza + checklist. Se muestran recién al escribir: en blanco,
                 una lista de requisitos en rojo recibe mal a quien llega. -->
            <div v-if="form.password" class="mt-2">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                  <div class="h-full rounded-full transition-all duration-300"
                    :class="passwordBarClass" :style="{ width: `${(passwordScore + 1) * 20}%` }"></div>
                </div>
                <span class="text-[11px] font-bold" :class="passwordValid ? 'text-success' : 'text-text-muted'">
                  {{ passwordLabel }}
                </span>
              </div>
              <ul class="mt-2 space-y-1">
                <li v-for="req in passwordRequirements" :key="req.label"
                  class="flex items-center gap-1.5 text-[11px]"
                  :class="req.met ? 'text-success' : 'text-text-muted'">
                  <span class="w-3 h-3 shrink-0" v-html="req.met ? ICON_CHECK : ICON_DOT"></span>
                  {{ req.label }}
                </li>
              </ul>
            </div>
          </div>
          <div v-if="error" data-testid="register-error" class="text-xs text-danger bg-danger/5 border border-danger/20 rounded-xl px-3 py-2">{{ error }}</div>
          <button type="submit" :disabled="!step1Valid" data-testid="register-step1-submit"
            class="w-full py-3 rounded-xl bg-navy text-white text-sm font-black hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            Continuar
          </button>
        </form>

        <!-- Paso 2: el hotel -->
        <form v-else @submit.prevent="submit" class="space-y-4">
          <div>
            <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">
              Nombre del hotel <span class="text-danger">*</span>
            </label>
            <div class="relative">
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" v-html="ICON_BUILDING"></span>
              <input v-model="form.hotelName" type="text" required :minlength="2" :maxlength="LIMITS.hotelName"
              data-testid="register-hotel-name"
              class="w-full pl-10 pr-4 py-2.5 bg-white border border-border rounded-xl text-sm focus:outline-none focus:border-navy"
              placeholder="Hotel Boutique Palma">
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">País</label>
            <SearchSelect v-model="form.country" :options="COUNTRIES" placeholder="Buscar país..." />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Ciudad</label>
              <div class="relative">
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" v-html="ICON_PIN"></span>
              <input v-model="form.address" type="text" :maxlength="LIMITS.address"
                class="w-full pl-10 pr-4 py-2.5 bg-white border border-border rounded-xl text-sm focus:outline-none focus:border-navy"
                placeholder="Ciudad donde está el hotel">
            </div>
            </div>
            <div>
              <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Teléfono</label>
              <PhoneInput v-model="form.phone" :country="form.country" :maxlength="LIMITS.phone" />
            </div>
          </div>
          <div v-if="plans.length">
            <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Plan a probar</label>
            <select v-model="form.planId"
              class="w-full px-4 py-2.5 bg-white border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
              <option v-for="p in plans" :key="p.id" :value="p.id">
                {{ p.name }} — ${{ p.price }}/mes (después de la prueba)
              </option>
            </select>
          </div>

          <!-- Captcha. Solo aparece si hay site key configurada: sin ella el
               backend tampoco lo exige, y un hueco vacío confundiría. -->
          <div v-if="captchaSiteKey">
            <div ref="captchaEl" class="cf-turnstile"></div>
            <p v-if="captchaError" class="text-[11px] text-danger mt-1">{{ captchaError }}</p>
          </div>

          <div v-if="error" data-testid="register-error" class="text-xs text-danger bg-danger/5 border border-danger/20 rounded-xl px-3 py-2">{{ error }}</div>

          <!-- Aceptación legal. Obligatoria: sin marcar no se puede crear la cuenta.
               Los links abren en pestaña nueva (target="_blank") para no perder el
               progreso del formulario (2 pasos ya completados) si el usuario quiere
               leerlos antes de aceptar. -->
          <label class="flex items-start gap-2.5 cursor-pointer select-none">
            <input v-model="acceptedTerms" type="checkbox" data-testid="register-terms-checkbox"
              class="mt-0.5 w-4 h-4 rounded border-border text-navy focus:ring-navy cursor-pointer shrink-0">
            <span class="text-[12px] leading-relaxed text-text-secondary">
              Acepto los
              <a href="/p/terminos" target="_blank" rel="noopener" class="text-cyan font-bold hover:underline">Términos y Condiciones</a>
              y la
              <a href="/p/privacidad" target="_blank" rel="noopener" class="text-cyan font-bold hover:underline">Política de Privacidad</a>
              de SolmiOS.
            </span>
          </label>

          <div class="flex gap-2">
            <button type="button" @click="step = 1; error = ''"
              class="px-4 py-3 rounded-xl border border-border text-sm font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer">
              Atrás
            </button>
            <button type="submit" :disabled="saving || !acceptedTerms" data-testid="register-submit"
              class="flex-1 py-3 rounded-xl bg-navy text-white text-sm font-black hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {{ saving ? 'Creando tu hotel…' : `Empezar mis ${trialDays} días gratis` }}
            </button>
          </div>
        </form>

        <p class="text-[11px] text-text-muted text-center mt-6 lg:hidden">
          ¿Ya tenés cuenta?
          <router-link to="/login" class="text-cyan font-bold hover:underline">Iniciá sesión</router-link>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { SignupService, type PublicPlan } from '@/services/Signup.service'
import { ReferralsService } from '@/services/Referrals.service'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import PhoneInput from '@/components/ui/PhoneInput.vue'
import { COUNTRIES } from '@/data/locales'
import { usePasswordStrength, PASSWORD_MAX } from '@/composables/usePasswordStrength'
import { usePageMeta } from '@/composables/usePageMeta'
import { AUTH_PAGE_META } from './auth-meta'
import logoWhite from '@/assets/logo/logo-horizontal-white.png'

usePageMeta(AUTH_PAGE_META.register)

/** Debe coincidir con `TRIAL_DAYS` del backend. Se muestra en 4 lugares. */
const trialDays = 7

/**
 * Topes de cada campo. Espejan los `max` de SignupSchema en el backend: acá
 * evitan que se escriba de más, allá que alguien se saltee el formulario.
 */
const LIMITS = {
  ownerName: 120,
  email: 254,
  hotelName: 120,
  address: 200,
  phone: 40,
} as const

const ICON_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0"/></svg>'
const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="m3 8 8.25 5.5a1.5 1.5 0 0 0 1.5 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z"/></svg>'
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75M6 10.5h12a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5V12A1.5 1.5 0 0 1 6 10.5Z"/></svg>'
const ICON_BUILDING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"/></svg>'
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>'
const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
const ICON_DOT = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><circle cx="12" cy="12" r="4"/></svg>'

/**
 * Site key del captcha (Cloudflare Turnstile). Es pública por diseño. Si no
 * está definida en el build, el captcha no se muestra y el backend tampoco lo
 * exige: el registro sigue funcionando, protegido solo por rate-limit.
 */
const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

const perks = [
  'Reservas, habitaciones y huéspedes',
  'Limpieza y mantenimiento del día',
  'Cobros, caja y facturación',
  'Sin tarjeta de crédito',
]

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const step = ref(1)
const saving = ref(false)
const error = ref('')
const plans = ref<PublicPlan[]>([])

// Link de referido (`/r/:code` → redirige acá con `?ref=`). Se muestra "Te invitó X" si el
// código existe; si no, se manda igual en el alta (el backend lo ignora sin romper el registro).
const referralCode = ref((route.query.ref as string) || '')
/** Plan preseleccionado desde la tabla de precios (`/registro?plan=professional`). Es solo una
 *  preferencia: se valida contra los planes de la API antes de usarse (ver onMounted). */
const requestedPlanSlug = computed(() => String(route.query.plan ?? '').trim().toLowerCase())
const referrerHotelName = ref('')

const form = ref({
  ownerName: '', email: '', password: '',
  hotelName: '', country: '', address: '', phone: '', planId: '',
})

const showPassword = ref(false)
const emailTouched = ref(false)
const acceptedTerms = ref(false)

// Espejo de shared/password-policy.ts del backend. La validación que decide es
// la del servidor; esto es para no tener que apretar "Continuar" para saber qué
// falta.
const {
  requirements: passwordRequirements,
  isValid: passwordValid,
  score: passwordScore,
  label: passwordLabel,
  barClass: passwordBarClass,
} = usePasswordStrength(
  computed(() => form.value.password),
  () => ({ email: form.value.email, name: form.value.hotelName }),
)

/**
 * Mismo criterio que `isValidEmail` del backend: algo, arroba, dominio con
 * punto y TLD de 2+. No pretende cubrir el RFC entero, solo descartar lo
 * imposible. Que la dirección exista de verdad lo dirá la verificación por
 * correo.
 */
const emailValid = computed(() => {
  const e = form.value.email.trim()
  if (!e || e.length > LIMITS.email || e.includes('..')) return false
  return /^[^\s@,;:<>()[\]\\]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(e)
})

/** El botón de "Continuar" se habilita recién cuando el paso 1 está completo. */
const step1Valid = computed(() =>
  form.value.ownerName.trim().length > 0 && emailValid.value && passwordValid.value,
)

// — Captcha —
const captchaEl = ref<HTMLElement | null>(null)
const captchaToken = ref('')
const captchaError = ref('')
let captchaWidgetId: string | undefined

/** API que inyecta el script de Turnstile en `window`. */
interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
function turnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

/** Carga el script una sola vez, aunque se entre y salga del paso 2. */
function loadCaptchaScript(): Promise<void> {
  const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  if (turnstile()) return Promise.resolve()
  const existing = document.querySelector(`script[src="${SRC}"]`)
  if (existing) return new Promise((res) => existing.addEventListener('load', () => res()))
  return new Promise((res, rej) => {
    const sc = document.createElement('script')
    sc.src = SRC
    sc.async = true
    sc.defer = true
    sc.onload = () => res()
    sc.onerror = () => rej(new Error('no se pudo cargar el captcha'))
    document.head.appendChild(sc)
  })
}

async function mountCaptcha() {
  if (!captchaSiteKey || captchaWidgetId !== undefined) return
  try {
    await loadCaptchaScript()
    await nextTick()
    const api = turnstile()
    if (!api || !captchaEl.value) return
    captchaWidgetId = api.render(captchaEl.value, {
      sitekey: captchaSiteKey,
      callback: (token: string) => { captchaToken.value = token; captchaError.value = '' },
      'expired-callback': () => { captchaToken.value = '' },
      'error-callback': () => {
        captchaToken.value = ''
        captchaError.value = 'No se pudo cargar la verificación. Revisá tu conexión.'
      },
    })
  } catch {
    captchaError.value = 'No se pudo cargar la verificación anti-robots. Recargá la página.'
  }
}

// El widget vive en el paso 2, que no está montado hasta que se llega.
watch(step, (s) => { if (s === 2) void mountCaptcha() })

onUnmounted(() => {
  if (captchaWidgetId !== undefined) turnstile()?.remove(captchaWidgetId)
})

onMounted(async () => {
  try {
    const res = await SignupService.publicPlans()
    plans.value = res ?? []
    // El plan que el visitante eligió en la tabla de precios de la landing viaja como
    // `?plan=<slug>`. Se resuelve contra los planes REALES que devolvió la API: un slug
    // desconocido (plan dado de baja, link viejo, URL manipulada) se ignora y cae al default,
    // así nunca se manda un planId inventado al alta.
    const wanted = requestedPlanSlug.value
    const matched = wanted ? plans.value.find(p => p.slug === wanted) : undefined
    if (matched) form.value.planId = matched.id
    else if (plans.value.length && !form.value.planId) form.value.planId = plans.value[0]!.id
  } catch { /* los planes son opcionales para registrarse */ }

  if (referralCode.value) {
    try {
      const { referrerHotelName: name } = await ReferralsService.resolve(referralCode.value)
      referrerHotelName.value = name
    } catch { /* código inválido/vencido: no se muestra el banner, el alta sigue igual */ }
  }
})

function goToStep2() {
  error.value = ''
  emailTouched.value = true
  if (!emailValid.value) {
    error.value = 'Revisá el email: falta el dominio o tiene un error de tipeo.'
    return
  }
  if (!passwordValid.value) {
    error.value = 'La contraseña todavía no cumple los requisitos de seguridad.'
    return
  }
  step.value = 2
}

/**
 * Crea la cuenta y entra derecho al panel: pedirle que inicie sesión después de
 * registrarse es un paso extra sin sentido, ya escribió su contraseña.
 */
async function submit() {
  error.value = ''
  // El botón ya queda deshabilitado sin aceptar, pero se valida de nuevo acá
  // por si se dispara el submit del form por otro medio (Enter, etc.).
  if (!acceptedTerms.value) {
    error.value = 'Tenés que aceptar los Términos y la Política de Privacidad para continuar.'
    return
  }
  // Sin token no se manda: el backend lo rechazaría igual, pero el token se
  // consume en el intento y habría que resolver el captcha de nuevo por nada.
  if (captchaSiteKey && !captchaToken.value) {
    captchaError.value = 'Completá la verificación anti-robots para continuar.'
    return
  }
  saving.value = true
  try {
    await SignupService.signup({
      hotelName: form.value.hotelName.trim(),
      email: form.value.email.trim(),
      password: form.value.password,
      ownerName: form.value.ownerName.trim(),
      country: form.value.country.trim(),
      address: form.value.address.trim(),
      phone: form.value.phone.trim(),
      planId: form.value.planId || undefined,
      referralCode: referralCode.value || undefined,
      captchaToken: captchaToken.value || undefined,
    })
    await auth.login(form.value.email.trim(), form.value.password)
    router.push('/panel/dashboard')
  } catch (e: any) {
    // El email repetido se decide en el paso 1: se vuelve ahí para corregirlo.
    error.value = e?.message || 'No se pudo crear la cuenta. Intentá de nuevo.'
    // El token de Turnstile es de un solo uso: sin resetear, todo reintento
    // vuelve a fallar por captcha aunque se corrija lo que estaba mal.
    captchaToken.value = ''
    if (captchaWidgetId !== undefined) turnstile()?.reset(captchaWidgetId)
    if (/email/i.test(error.value)) step.value = 1
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
</style>
