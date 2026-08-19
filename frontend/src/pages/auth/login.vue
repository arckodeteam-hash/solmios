<template>
  <div class="min-h-screen flex">
    <!-- Carrusel (solo desktop) -->
    <div class="hidden lg:flex lg:w-3/5 relative overflow-hidden bg-navy">
      <div
        v-for="(s, idx) in slides"
        :key="idx"
        class="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
        :class="idx === activeSlide ? 'opacity-100' : 'opacity-0'"
        :style="{ backgroundImage: `url(${s.image})` }"
      ></div>
      <div class="absolute inset-0 bg-gradient-to-t from-navy/95 via-navy/70 to-navy/50"></div>

      <div class="relative z-10 flex flex-col justify-between w-full p-12 text-white">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center font-black text-lg">S</div>
          <div>
            <div class="font-black text-lg leading-none">Solmi<span class="text-cyan">OS</span></div>
            <div class="text-[10px] text-white/60 uppercase tracking-wide mt-0.5">Panel Hotel</div>
          </div>
        </div>

        <div class="flex-1 flex items-center">
          <div class="max-w-md">
            <div class="w-16 h-16 rounded-2xl bg-cyan/15 flex items-center justify-center mb-6">
              <span class="w-8 h-8 text-cyan" v-html="slides[activeSlide].icon"></span>
            </div>
            <h2 class="text-3xl font-black leading-tight mb-3">{{ slides[activeSlide].title }}</h2>
            <p class="text-white/70 text-sm leading-relaxed">{{ slides[activeSlide].text }}</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-for="(s, idx) in slides"
            :key="idx"
            @click="goToSlide(idx)"
            class="h-1.5 rounded-full transition-all cursor-pointer"
            :class="idx === activeSlide ? 'w-8 bg-cyan' : 'w-1.5 bg-white/25 hover:bg-white/40'"
            :aria-label="`Ir a slide ${idx + 1}`"
          ></button>
        </div>
      </div>
    </div>

    <!-- Login -->
    <div class="w-full lg:w-2/5 flex items-center justify-center p-4 bg-surface">
      <div class="w-full max-w-md">
        <!-- Logo (solo mobile, el carrusel ya lo muestra en desktop) -->
        <div class="text-center mb-8 lg:hidden">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-navy to-blue mx-auto flex items-center justify-center font-black text-white text-2xl mb-4 shadow-lg">S</div>
          <h1 class="text-2xl font-black text-navy">Solmi<span class="text-cyan">OS</span></h1>
          <p class="text-sm text-text-muted mt-1">Hospitality OS · LATAM</p>
        </div>

        <!-- Login Form -->
        <div class="bg-white rounded-2xl border border-border card-shadow p-8">
          <h2 class="text-lg font-extrabold text-navy mb-6">Iniciar Sesión</h2>

          <form @submit.prevent="handleLogin" class="space-y-4">
            <div>
              <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Email</label>
              <input v-model="email" type="email" placeholder="admin@hotel.com" data-testid="login-email" class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30" required />
            </div>

            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide">Contraseña</label>
                <router-link to="/forgot-password" class="text-[11px] font-bold text-cyan hover:text-navy transition-colors">¿Olvidaste tu contraseña?</router-link>
              </div>
              <input v-model="password" type="password" placeholder="••••••••" data-testid="login-password" class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30" required />
            </div>

            <!-- Cuenta bloqueada por la suscripción: no alcanza con el error,
                 hay que decirle a dónde ir a resolverlo. -->
            <div v-if="error && needsPlan" class="bg-warning/10 border border-warning/30 p-3 rounded-xl">
              <div class="text-xs font-bold text-navy mb-2">{{ error }}</div>
              <router-link
                to="/registro"
                class="inline-flex px-3 py-1.5 rounded-lg bg-navy text-white text-[11px] font-bold hover:bg-navy-light transition-colors"
              >Ver planes</router-link>
            </div>
            <div v-else-if="error" class="bg-coral/10 text-coral text-xs font-bold p-3 rounded-xl">{{ error }}</div>

            <button type="submit" :disabled="loading" data-testid="login-submit" class="w-full h-11 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors disabled:opacity-50 cursor-pointer">
              {{ loading ? 'Entrando...' : 'Entrar' }}
            </button>
          </form>

          <!-- El alta pública vive en /registro y no la enlazaba NADIE: el único link a esa
               página estaba dentro del aviso de suscripción vencida, que solo ve quien YA es
               cliente. Un visitante nuevo no tenía forma de llegar. -->
          <p class="mt-5 pt-4 border-t border-border text-center text-xs text-text-secondary">
            ¿No tenés cuenta?
            <router-link to="/registro" data-testid="login-register-link" class="text-cyan font-bold hover:underline">Registrate gratis</router-link>
          </p>

          <!-- Demo Accounts (dev) -->
          <div v-if="demoAccounts.length" class="mt-6 pt-4 border-t border-border">
            <div class="text-[10px] font-bold text-text-muted uppercase mb-2 text-center">Cuentas demo</div>
            <div class="flex items-center justify-center flex-wrap gap-x-2 gap-y-1 text-xs">
              <template v-for="(account, idx) in demoAccounts" :key="account.email">
                <button @click="loginAs(account)" class="text-cyan hover:text-navy hover:underline font-bold cursor-pointer" :title="account.email">{{ account.roleLabel }}</button>
                <span v-if="idx < demoAccounts.length - 1" class="text-border">·</span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { AuthService } from '@/services/Auth.service'

const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>'
const ICON_GLOBE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.25 0 4-4 4-9s-1.75-9-4-9-4 4-4 9 1.75 9 4 9ZM3.5 9h17M3.5 15h17"/></svg>'
const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5M21 12h-4a1.5 1.5 0 0 0 0 3h4v-3Z"/></svg>'
const ICON_CHART = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M8 17V10m5 7V6m5 11v-4"/></svg>'

const slides = [
  { icon: ICON_BUILDING, title: 'Todo tu hotel, en un solo panel', text: 'Reservas, habitaciones, huéspedes y facturación conectados en tiempo real.', image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80' },
  { icon: ICON_GLOBE, title: 'Sincronizado con tus canales', text: 'Booking, Airbnb, Expedia y más — disponibilidad y tarifas siempre al día.', image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1200&q=80' },
  { icon: ICON_WALLET, title: 'Cobros sin fricción', text: 'Links de pago, folios, caja y reportes financieros en un solo flujo.', image: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80' },
  { icon: ICON_CHART, title: 'Decisiones basadas en datos', text: 'Ocupación, ADR, RevPAR y procedencia de huéspedes en tiempo real.', image: 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80' },
]
const activeSlide = ref(0)
let slideTimer: ReturnType<typeof setInterval> | undefined

function goToSlide(idx: number) {
  activeSlide.value = idx
  restartTimer()
}

function restartTimer() {
  if (slideTimer) clearInterval(slideTimer)
  slideTimer = setInterval(() => {
    activeSlide.value = (activeSlide.value + 1) % slides.length
  }, 5000)
}

onMounted(restartTimer)
onUnmounted(() => { if (slideTimer) clearInterval(slideTimer) })

const router = useRouter()
const auth = useAuthStore()

// #644 — precargar credenciales reales (aunque sean demo) en el `value` del input las deja
// visibles en el DOM/HTML sin ninguna interacción (view-source, devtools, o directamente click
// en "Entrar" sin tocar nada = login como Super Admin). Los botones de cuentas demo (`loginAs`)
// ya llenan y envían por su cuenta — no hace falta ningún default acá.
const email = ref('')
const password = ref('')
const error = ref('')
/** El corte por suscripción se resuelve contratando, no reintentando la clave. */
const needsPlan = ref(false)
const loading = ref(false)

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  hotel_admin: 'Hotel Admin',
  receptionist: 'Recepcionista',
  housekeeper: 'Camarera',
  supervisor: 'Supervisor',
  maintenance: 'Mantenimiento',
}

// Cuentas demo fijas (solo roles de panel web — camarera/mantenimiento van en la app móvil)
const FIXED_DEMO_ACCOUNTS = [
  { name: 'Super Admin', email: 'admin@solmios.com', password: 'demo123', role: 'super_admin' },
  { name: 'Hotel Admin Demo', email: 'hotel@solmios.com', password: 'demo123', role: 'hotel_admin' },
  { name: 'Recepcionista Demo', email: 'recepcion@solmios.com', password: 'demo123', role: 'receptionist' },
]

// Los botones de auto-login se muestran SOLO si el backend tiene el demo habilitado:
// `GET /api/public/users` es fail-closed (V6, `getPublicUsers`) — devuelve `[]` salvo en
// dev o con `DEMO_LOGIN=1` en el .env del server. La señal es RUNTIME, no de build:
// prender/apagar los botones en producción es setear la env y restartear, sin redeploy.
// Sin la env, el array queda vacío y el bloque `v-if` no se renderiza.
const demoAccounts = ref<any[]>([])

onMounted(async () => {
  try {
    // Raw fetch justified: public endpoint, no auth required, AuthService has no method for this.
    // Matches http.ts behavior: check response.ok, parse JSON, handle errors.
    const r = await fetch('/api/public/users')
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${r.statusText}`)
    }
    const json = await r.json()
    const list = Array.isArray(json) ? json : (json.data || [])
    // Lista vacía = demo deshabilitado en el server: sin botones, silencioso.
    if (!Array.isArray(list) || list.length === 0) return

    // Fusionar cuentas del endpoint con las fijas (evitar duplicados por email)
    const knownEmails = new Set(FIXED_DEMO_ACCOUNTS.map((u) => u.email))
    const extra = list
      .filter((u: any) => u.email && !knownEmails.has(u.email))
      .map((u: any) => ({
        name: u.name,
        email: u.email,
        password: 'demo123',
        roleLabel: ROLE_LABELS[u.role] || u.role,
      }))
    demoAccounts.value = [
      ...FIXED_DEMO_ACCOUNTS.map((u) => ({
        name: u.name,
        email: u.email,
        password: u.password,
        roleLabel: ROLE_LABELS[u.role] || u.role,
      })),
      ...extra,
    ]
  } catch (e) {
    // Silently degrade — demo accounts are a convenience, not critical. Log for debugging.
    console.warn('Failed to load demo accounts:', e)
  }
})

async function handleLogin() {
  loading.value = true
  error.value = ''
  needsPlan.value = false
  try {
    await auth.login(email.value, password.value)
    const role = auth.userRole
    if (role === 'super_admin') {
      router.push('/admin')
    } else {
      router.push('/panel')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Error al iniciar sesión'
    needsPlan.value = /prueba|suscripci|plan|suspendida|desactivada/i.test(error.value)
  } finally {
    loading.value = false
  }
}

function loginAs(account: { email: string; password: string; name: string; role: string }) {
  email.value = account.email
  password.value = account.password
  handleLogin()
}
</script>
