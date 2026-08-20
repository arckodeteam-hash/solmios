<template>
  <div class="flex min-h-screen bg-surface">
    <!-- Mobile backdrop -->
    <div v-if="mobileMenuOpen" class="fixed inset-0 bg-navy/50 z-20 lg:hidden" @click="mobileMenuOpen = false"></div>

    <!-- Sidebar -->
    <aside class="w-72 bg-navy text-white flex flex-col flex-shrink-0 fixed h-full z-30 transition-transform duration-300 lg:translate-x-0"
      :class="mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'">
      <!-- Logo -->
      <div class="h-20 flex flex-col items-start justify-center gap-1 px-5 border-b border-white/10">
        <img :src="logoWhite" alt="SolmiOS" class="h-9 w-auto shrink-0">
        <div class="text-[10px] font-bold tracking-[2px] text-gray-400 uppercase">Super Admin</div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 py-4 px-3 space-y-1 overflow-y-auto scrollbar-hide">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-semibold transition-all cursor-pointer"
          :class="isActive(item.path) ? 'bg-white/15 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'"
        >
          <span class="w-5 h-5 shrink-0" v-html="item.icon"></span>
          <span>{{ item.label }}</span>
          <span
            v-if="item.badge"
            class="ml-auto bg-coral/20 text-coral text-[10px] font-bold px-2 py-0.5 rounded-full"
          >
            {{ item.badge }}
          </span>
        </router-link>
      </nav>

      <!-- PC-2 Multi-property: Hotel Switcher (contexto de hotel activo para super_admin) -->
      <div class="border-t border-white/10 py-2 px-3">
        <HotelSwitcher />
      </div>

      <!-- Platform Status -->
      <div class="p-4 border-t border-white/10">
        <div class="bg-white/5 rounded-xl p-3 mb-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-bold text-gray-400 uppercase">Plataforma</span>
            <span class="w-2 h-2 bg-teal rounded-full animate-pulse"></span>
          </div>
          <div class="text-xs text-gray-300">Hoteles: <span class="font-bold text-white">{{ stats.hoteles || 1 }} activos</span></div>
        </div>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-coral/30 flex items-center justify-center text-sm font-bold">SA</div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold truncate">{{ auth.user?.name ?? 'Super Admin' }}</div>
            <div class="text-[10px] text-cyan">Plataforma SolmiOS</div>
          </div>
          <button @click="handleLogout" class="text-gray-400 hover:text-white transition-colors cursor-pointer">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex-1 min-w-0 lg:ml-72 flex flex-col">
      <!-- Header -->
      <header class="h-16 bg-white border-b border-border flex items-center justify-between px-4 md:px-6 sticky top-0 z-10 shadow-sm gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <button @click="mobileMenuOpen = true" class="lg:hidden shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface cursor-pointer">
            <span class="w-5 h-5 shrink-0 block" v-html="ICON_MENU"></span>
          </button>
          <h1 class="text-lg font-black text-navy truncate">{{ pageTitle }}</h1>
        </div>
        <div class="flex items-center gap-4">
          <!-- Search -->
          <div class="relative hidden md:block">
            <input type="text" placeholder="Buscar hoteles, usuarios..." class="w-72 h-9 pl-9 pr-4 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan focus:ring-2 focus:ring-cyan/20 transition-all" />
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <!-- Notifications -->
          <button class="relative p-2 rounded-lg hover:bg-surface transition-colors cursor-pointer">
            <svg class="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span class="absolute top-1.5 right-1.5 w-2 h-2 bg-coral rounded-full"></span>
          </button>

          <!-- Quick Actions -->
          <button class="hidden sm:block bg-coral text-white font-extrabold text-sm px-4 py-2 rounded-lg hover:shadow-lg transition-all cursor-pointer">
            + Nuevo Hotel
          </button>

          <!-- User Menu (Configuración / Cambiar contraseña / Salir) -->
          <UserMenu />
        </div>
      </header>

      <!-- Page Content -->
      <main class="flex-1 p-6" data-feedback-content>
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import logoWhite from '@/assets/logo/logo-horizontal-white.png'
import { useDocumentTitle } from '@/composables/usePageTitle'
import { useAuthStore } from '@/stores/auth.store'
import { http } from '@/services/http'
import HotelSwitcher from '@/components/features/core-pms/HotelSwitcher.vue'
import UserMenu from '@/components/features/core-pms/UserMenu.vue'

const ICON_MENU = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"/></svg>'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const mobileMenuOpen = ref(false)

watch(() => route.path, () => { mobileMenuOpen.value = false })

const stats = ref<any>({})

onMounted(async () => {
  try {
    const r = await http.get<any>('/admin/hoteles')
    stats.value = { hoteles: r?.total ?? r?.data?.length ?? 1 }
  } catch {}
  try {
    const m = await http.get<any>('/admin/monitoring')
    stats.value = { ...stats.value, ...m }
  } catch {}
})

const ICONS = {
  dashboard: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.5h4.5V21H3v-7.5ZM9.75 8.25h4.5V21h-4.5V8.25ZM16.5 3h4.5v18h-4.5V3Z"/></svg>',
  hotel: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>',
  card: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path stroke-linecap="round" d="M3 10h18"/></svg>',
  clipboard: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-7 7h6m-6 4h6"/></svg>',
  sparkles: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.035-.259a3.375 3.375 0 0 0 2.456-2.455L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"/></svg>',
  ticket: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 1 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 1 0 0-4V7Z"/></svg>',
  wallet: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 12h.01M3 10h18"/></svg>',
  chart: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m3 17 6-6 4 4 8-8M21 7v6m0-6h-6"/></svg>',
  user: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
  usergroup: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72M18 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M18 18.72v-.235a3 3 0 0 0-3-3M6 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M6 18.72v-.235a3 3 0 0 1 3-3m3.75-6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>',
  monitor: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17 9 20l-.75 1M13.25 17 14 20l.75 1M3 13.5h18M5 17h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z"/></svg>',
  document: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>',
  megaphone: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 11v2a2 2 0 0 0 2 2h1l3 5v-5h1l8 3V6l-8 3H6a2 2 0 0 0-2 2Z"/></svg>',
  chat: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"/></svg>',
  key: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10 17.75H8v2H6v2H2v-3.75l6.408-6.408c.403-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"/></svg>',
  shield: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.286Z"/></svg>',
  cog: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.991a7.66 7.66 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
  channels: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 0 0 0 12.728m12.728 0a9 9 0 0 0 0-12.728M8.464 8.464a5 5 0 0 0 0 7.072m7.072 0a5 5 0 0 0 0-7.072M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>',
  modules: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  mail: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="m3 7 9 6 9-6"/></svg>',
}

const navItems = computed(() => {
  const s = stats.value
  return [
    { path: '/admin', label: 'Dashboard', icon: ICONS.dashboard },
    { path: '/admin/hotels', label: 'Hoteles', icon: ICONS.hotel, badge: s.hoteles || undefined },
    { path: '/admin/plans', label: 'Planes', icon: ICONS.card },
    { path: '/admin/modules', label: 'Módulos', icon: ICONS.modules },
    { path: '/admin/subscriptions', label: 'Suscripciones', icon: ICONS.clipboard },
    { path: '/admin/referrals', label: 'Referidos', icon: ICONS.megaphone },
    { path: '/admin/aliados', label: 'Aliados', icon: ICONS.megaphone },
    { path: '/admin/support', label: 'Soporte', icon: ICONS.ticket, badge: s.ticketsAbiertos || undefined },
    { path: '/admin/billing', label: 'Facturación', icon: ICONS.wallet },
    { path: '/admin/analytics', label: 'Analytics', icon: ICONS.chart },
    { path: '/admin/users', label: 'Usuarios', icon: ICONS.user },
    { path: '/admin/empleados', label: 'Empleados', icon: ICONS.usergroup },
    { path: '/admin/monitoring', label: 'Monitoreo', icon: ICONS.monitor },
    { path: '/admin/audit', label: 'Auditoría', icon: ICONS.document },
    { path: '/admin/feedback', label: 'Feedback', icon: ICONS.chat },
    { path: '/admin/announcements', label: 'Anuncios', icon: ICONS.megaphone },
    { path: '/admin/channels', label: 'Canales', icon: ICONS.channels },
    { path: '/admin/api-keys', label: 'API & Webhooks', icon: ICONS.key },
    { path: '/admin/email-templates', label: 'Plantillas de Email', icon: ICONS.mail },
    { path: '/admin/sitio', label: 'Sitio Público', icon: ICONS.document },
    { path: '/admin/roles', label: 'Roles & Permisos', icon: ICONS.shield },
    { path: '/admin/settings', label: 'Configuración', icon: ICONS.cog },
  ]
})

const pageTitle = computed(() => {
  const titles: Record<string, string> = {
    'super-admin': 'Dashboard',
    'super-admin-hotels': 'Gestión de Hoteles',
    'super-admin-plans': 'Planes de Suscripción',
    'super-admin-modules': 'Módulos del Producto',
    'super-admin-subscriptions': 'Suscripciones',
    'super-admin-subscriptions-founders': 'Cupos Fundador / Pionero',
    'super-admin-referrals': 'Programa de Referidos',
    'super-admin-aliados': 'Programa Aliados',
    'super-admin-support': 'Soporte',
    'super-admin-billing': 'Facturación',
    'super-admin-analytics': 'Analytics',
    'super-admin-users': 'Usuarios',
    'super-admin-empleados': 'Gestión de Empleados',
    'super-admin-monitoring': 'Monitoreo del Sistema',
    'super-admin-audit': 'Auditoría',
    'super-admin-feedback': 'Feedback',
    'super-admin-announcements': 'Anuncios & Comunicados',
    'super-admin-api-keys': 'API Keys & Webhooks',
    'super-admin-email-templates': 'Plantillas de Email',
    'super-admin-sitio': 'Sitio Público (solmios.com)',
    'super-admin-roles': 'Roles & Permisos',
    'super-admin-channels': 'Canales (Channel Manager)',
    'super-admin-settings': 'Configuración',
  }
  return titles[route.name as string] ?? 'Super Admin'
})

// El <h1> ya salía bien de acá, pero la PESTAÑA no: nunca se tocaba `document.title`, así que
// navegando por /admin el navegador seguía mostrando el título de la pantalla anterior
// (el del panel, o "Iniciar sesión" si venías del login).
useDocumentTitle(pageTitle)

function isActive(path: string) {
  if (path === '/admin') return route.path === '/admin'
  return route.path.startsWith(path)
}

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>
