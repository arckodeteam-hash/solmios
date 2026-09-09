<template>
  <div class="relative" ref="menuRef">
    <!-- Trigger: avatar + nombre + chevron -->
    <button
      type="button"
      @click="open = !open"
      class="flex items-center gap-2 rounded-full pl-1.5 pr-2.5 py-1.5 transition-colors cursor-pointer"
      :class="[transparent ? 'hover:bg-white/5' : 'bg-surface hover:bg-surface-dark', { 'ring-2 ring-cyan/30': open }]"
      aria-haspopup="menu"
      :aria-expanded="open"
    >
      <div v-if="placeholder" class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-white/10 text-slate-300 overflow-hidden">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5Zm0 2c-3.866 0-7 2.239-7 5v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1c0-2.761-3.134-5-7-5Z" /></svg>
      </div>
      <div v-else class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" :class="avatarClass">
        {{ initials }}
      </div>
      <div class="hidden sm:block text-left leading-tight">
        <div class="text-xs font-bold max-w-[120px] truncate" :class="dark ? 'text-white' : 'text-navy'">{{ name }}</div>
        <div class="text-[10px]" :class="dark ? 'text-slate-400' : 'text-text-muted'">{{ roleLabel }}</div>
      </div>
      <svg class="w-4 h-4 transition-transform" :class="[dark ? 'text-slate-400' : 'text-text-muted', { 'rotate-180': open }]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      role="menu"
      class="absolute right-0 mt-2 w-60 bg-white rounded-2xl shadow-2xl overflow-hidden z-50"
    >
      <!-- Info usuario -->
      <div class="px-4 py-3 border-b border-border/60">
        <div class="flex items-center gap-3">
          <div v-if="placeholder" class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-navy/10 text-navy/50 overflow-hidden">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5Zm0 2c-3.866 0-7 2.239-7 5v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1c0-2.761-3.134-5-7-5Z" /></svg>
          </div>
          <div v-else class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" :class="avatarClass">
            {{ initials }}
          </div>
          <div class="min-w-0">
            <div class="text-sm font-bold text-navy truncate">{{ name }}</div>
            <div class="text-[11px] text-text-muted truncate">{{ email }}</div>
          </div>
        </div>
      </div>

      <!-- Opciones -->
      <div class="py-1.5">
        <router-link
          v-for="opt in options"
          :key="opt.path"
          :to="opt.path"
          @click="open = false"
          role="menuitem"
          class="flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-navy hover:bg-surface transition-colors cursor-pointer"
        >
          <span class="w-4.5 h-4.5 shrink-0" v-html="opt.icon"></span>
          <span>{{ opt.label }}</span>
        </router-link>
      </div>

      <!-- Separador + Salir -->
      <div class="border-t border-border/60 py-1.5">
        <button
          type="button"
          @click="logout"
          role="menuitem"
          class="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-coral hover:bg-coral/5 transition-colors cursor-pointer"
        >
          <svg class="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span>Salir</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'

defineProps<{
  /** Sin fondo/borde en el trigger — para headers oscuros que ya tienen su propio fondo */
  transparent?: boolean
  /** Muestra un ícono silueta genérico en vez de las iniciales coloreadas */
  placeholder?: boolean
  /** Texto del trigger en blanco/slate — para headers oscuros. El dropdown siempre queda claro. */
  dark?: boolean
}>()

const auth = useAuthStore()
const router = useRouter()

const open = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const name = computed(() => auth.user?.name ?? 'Usuario')
const email = computed(() => auth.user?.email ?? '')
const initials = computed(() =>
  name.value.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(),
)

// QA-MEDIO: le faltaban housekeeper/maintenance/supervisor/waiter/kitchen — esos roles veían la
// línea de rol vacía bajo su nombre (y el avatar caía al color de admin por defecto).
const ROLE_LABELS: Record<string, string> = {
  hotel_admin: 'Hotel Admin',
  receptionist: 'Recepción',
  super_admin: 'Super Admin',
  housekeeper: 'Limpieza',
  maintenance: 'Mantenimiento',
  supervisor: 'Supervisor',
  waiter: 'Mesero',
  kitchen: 'Cocina',
}
const roleLabel = computed(() => ROLE_LABELS[auth.userRole ?? ''] ?? '')

const avatarClass = computed(() => {
  const classes: Record<string, string> = {
    hotel_admin: 'bg-cyan/30 text-white',
    receptionist: 'bg-teal/30 text-white',
    super_admin: 'bg-coral/30 text-white',
    housekeeper: 'bg-teal-light/30 text-white',
    maintenance: 'bg-gold/30 text-white',
    supervisor: 'bg-navy-light/30 text-white',
    waiter: 'bg-blue/30 text-white',
    kitchen: 'bg-coral-light/30 text-white',
  }
  return classes[auth.userRole ?? ''] ?? 'bg-cyan/30 text-white'
})

const ICON_SETTINGS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.991a7.66 7.66 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_KEY = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10 17.75H8v2H6v2H2v-3.75l6.408-6.408c.403-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"/></svg>'

const ICON_PLAN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"/></svg>'

// Opciones del menú. super_admin usa la ruta de super-admin, el resto la del panel.
// "Mi plan" solo para el dueño/gerente del hotel: es donde la convención lo hace buscar
// (facturación vive en el menú de la cuenta) y hasta acá no había ninguna entrada al panel
// de suscripción salvo el aviso de la prueba, que desaparece apenas el hotel paga.
const options = computed(() => {
  const isSuperAdmin = auth.userRole === 'super_admin'
  const items = [
    { icon: ICON_SETTINGS, label: 'Configuración', path: isSuperAdmin ? '/admin/settings' : '/panel/config' },
  ]
  if (!isSuperAdmin && auth.canActAsHotelAdmin) {
    items.push({ icon: ICON_PLAN, label: 'Mi plan', path: '/panel/suscripcion' })
  }
  items.push({ icon: ICON_KEY, label: 'Cambiar contraseña', path: '/change-password' })
  return items
})

// Cerrar al clickear fuera
function handleClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))

// Cerrar con Escape
function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => document.addEventListener('keydown', handleEsc))
onUnmounted(() => document.removeEventListener('keydown', handleEsc))

async function logout() {
  open.value = false
  await auth.logout()
  router.push('/login')
}
</script>

<style scoped>
</style>
