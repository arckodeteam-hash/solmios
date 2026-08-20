<template>
  <div class="flex min-h-screen bg-surface">
    <!-- Offline banner (PWA) -->
    <OfflineBanner />

    <!-- Impersonation Banner -->
    <div v-if="auth.impersonating" class="fixed top-0 left-0 right-0 z-50 bg-orange border-b-2 border-orange-dark px-4 py-2.5 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-sm font-extrabold text-navy">👁️ Modo supervisión: <span class="underline">{{ auth.user?.name }}</span> — {{ auth.user?.hotelName }}</span>
        <span class="text-[10px] font-bold bg-navy/10 text-navy px-2 py-0.5 rounded-full uppercase">{{ auth.user?.role }}</span>
      </div>
      <button @click="auth.stopImpersonation(); router.push('/admin')" class="text-sm font-extrabold text-navy bg-white px-4 py-1.5 rounded-lg hover:bg-surface transition-colors cursor-pointer">✕ Volver a Super Admin</button>
    </div>

    <!-- Mobile backdrop -->
    <div v-if="mobileMenuOpen" class="fixed inset-0 bg-navy/50 z-20 lg:hidden" @click="mobileMenuOpen = false"></div>

    <!-- Sidebar -->
    <aside class="cc-sidebar w-64 text-[#C4C8D0] flex flex-col shrink-0 fixed h-full z-30 border-r border-white/8 transition-transform duration-300 lg:translate-x-0"
      :class="[auth.impersonating ? 'top-10' : '', mobileMenuOpen ? 'translate-x-0' : '-translate-x-full']">
      <!-- Logo -->
      <div class="h-16 flex flex-col items-start justify-center gap-0.5 px-5 border-b border-white/8 shrink-0">
        <img :src="logoWhite" alt="SolmiOS" class="h-8 w-auto shrink-0">
        <div class="text-[9px] font-bold tracking-[2px] text-[#7C8AA5] uppercase">{{ roleLabel }}</div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 py-5 px-3 space-y-1.5 overflow-y-auto">
        <template v-for="item in visibleItems" :key="item.path || item.label">
          <!-- Parent with children -->
          <template v-if="item.children">
            <button @click="toggleSection(item.label)" class="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-[13.5px] font-bold cursor-pointer transition-all"
              :class="isSectionActive(item) ? 'bg-[#2563EB]/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-[#C4C8D0] hover:bg-white/6 hover:text-white'">
              <span class="w-[22px] h-[22px] shrink-0" :class="isSectionActive(item) ? 'text-[#60A5FA]' : 'text-[#7C8AA5]'" v-html="item.icon"></span>
              <span class="flex-1 text-left">{{ item.label }}</span>
              <span class="text-[10px] transition-transform" :class="item.expanded ? 'text-[#60A5FA]' : 'text-[#7C8AA5]'">{{ item.expanded ? '▾' : '▸' }}</span>
            </button>
            <template v-for="child in item.children" :key="child.path || child.group">
              <!-- Encabezado de bloque dentro del submenú (no navega) -->
              <div v-if="child.group" v-show="item.expanded"
                class="flex items-center gap-2 pl-12 pr-3 pt-3 pb-1.5 select-none">
                <span class="text-[9.5px] font-black uppercase tracking-[1.5px] text-[#5A6684]">{{ child.group }}</span>
                <span class="h-px flex-1 bg-white/8"></span>
              </div>

              <router-link
                v-else
                :to="child.path"
                v-show="item.expanded"
                class="flex items-center gap-2.5 pl-12 pr-3 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all cursor-pointer"
                :class="isActive(child.path) ? 'bg-[#2563EB]/14 text-white' : 'text-[#8A96AD] hover:bg-white/6 hover:text-white'"
              >
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="isActive(child.path) ? 'bg-cyan cc-glow-dot' : 'bg-[#5A6684]'"></span>
                <span>{{ child.label }}</span>
              </router-link>
            </template>
          </template>
          <!-- Simple item (no children) -->
          <router-link v-else :to="item.path"
            class="flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-[13.5px] font-bold transition-all cursor-pointer"
            :class="isActive(item.path) ? 'bg-[#2563EB]/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-[#C4C8D0] hover:bg-white/6 hover:text-white'">
            <span class="w-[22px] h-[22px] shrink-0" :class="isActive(item.path) ? 'text-[#60A5FA]' : 'text-[#7C8AA5]'" v-html="item.icon"></span>
            <span>{{ item.label }}</span>
          </router-link>
        </template>

        <!-- Ocupación Hoy (dentro del nav: scrollea junto al menú cuando los submenus expandidos exceden el alto disponible) -->
        <div class="relative mt-3 overflow-hidden rounded-2xl border border-white/8 p-4" style="background: linear-gradient(155deg, rgba(6,182,212,0.16) 0%, rgba(10,19,34,0.95) 60%);">
          <div class="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-cyan/20 blur-3xl"></div>
          <div class="relative text-[10px] font-bold tracking-wider text-[#C4C8D0] uppercase mb-3">Ocupación Hoy</div>
          <div class="relative flex items-center gap-4">
            <div class="relative h-20 w-20 shrink-0">
              <svg viewBox="0 0 36 36" class="h-20 w-20 -rotate-90" style="filter: drop-shadow(0 0 6px rgba(34,211,238,0.5));">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3.2" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#22D3EE" stroke-width="3.2" stroke-linecap="round"
                  :stroke-dasharray="`${occupancyPct * 0.974} 100`" class="transition-[stroke-dasharray] duration-700 ease-out" />
              </svg>
              <div class="absolute inset-0 flex items-center justify-center text-xl font-black text-white">{{ occupancyPct }}%</div>
            </div>
            <div class="flex-1 space-y-2">
              <div class="flex items-center justify-between text-[11px]">
                <span class="flex items-center gap-1.5 text-[#C4C8D0]"><span class="w-2 h-2 rounded-full bg-cyan"></span>Ocupadas</span>
                <span class="font-black text-white">{{ occupancyBreakdown.occupied }}</span>
              </div>
              <div class="flex items-center justify-between text-[11px]">
                <span class="flex items-center gap-1.5 text-[#C4C8D0]"><span class="w-2 h-2 rounded-full bg-blue"></span>Disponibles</span>
                <span class="font-black text-white">{{ occupancyBreakdown.available }}</span>
              </div>
              <div class="flex items-center justify-between text-[11px]">
                <span class="flex items-center gap-1.5 text-[#C4C8D0]"><span class="w-2 h-2 rounded-full bg-gray-400"></span>Mantenimiento</span>
                <span class="font-black text-white">{{ occupancyBreakdown.maintenance }}</span>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <!-- PC-2 Multi-property: Hotel Switcher -->
      <div class="border-t border-white/8 py-2 px-3 shrink-0">
        <HotelSwitcher />
      </div>

      <!-- Reloj en vivo (estilo centro de operaciones) -->
      <div class="border-t border-white/8 px-4 py-3 shrink-0">
        <div class="text-[9px] font-bold uppercase tracking-wider text-[#7C8AA5]">{{ sidebarDate }}</div>
        <div class="mt-0.5 flex items-center justify-between">
          <span class="font-mono text-2xl font-black tabular-nums text-white tracking-tight">{{ sidebarClock }}</span>
          <span class="w-5 h-5 shrink-0" :class="isNight ? 'text-[#7C8AA5]' : 'text-[#FBBF24]'"
            :style="!isNight ? 'filter: drop-shadow(0 0 5px rgba(251,191,36,0.6))' : ''" v-html="isNight ? ICON_MOON : ICON_SUN"></span>
        </div>
      </div>

      <!-- User -->
      <div class="p-4 border-t border-white/8 shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" :class="avatarClass">
            {{ userInitials }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold text-white truncate">{{ auth.user?.name ?? 'Admin' }}</div>
            <div class="text-[10px] text-[#7C8AA5]">{{ auth.currentHotel }}</div>
          </div>
          <button @click="handleLogout" class="text-[#7C8AA5] hover:text-white transition-colors cursor-pointer">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex-1 min-w-0 lg:ml-64 flex flex-col" :class="auth.impersonating ? 'mt-10' : ''">
      <!-- Verificación de email pendiente (#421): banner persistente para merchants sin email verificado -->
      <div v-if="showVerifyEmailBanner"
        class="bg-warning/12 border-b border-warning/30 px-4 md:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-4 h-4 shrink-0 text-warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>
          </span>
          <span class="text-[13px] font-bold text-navy">Verificá tu email para asegurar tu cuenta.</span>
        </div>
        <button @click="handleResendVerification" :disabled="resendingVerification"
          class="shrink-0 text-[12px] font-extrabold text-white bg-navy px-3.5 py-1.5 rounded-lg hover:bg-navy-light transition-colors disabled:opacity-50 cursor-pointer">
          {{ resendingVerification ? 'Enviando…' : 'Reenviar correo' }}
        </button>
      </div>

      <!-- Header (el dashboard general trae su propia barra oscura de comando) -->
      <!-- Header global "command center" (mismo en todas las páginas). El dashboard trae el suyo. -->
      <div v-if="!isCommandCenter" class="px-4 md:px-6 pt-4">
        <AppHeader />
      </div>
      <!-- Toggle del menú en móvil (todas las páginas) -->
      <button @click="mobileMenuOpen = true" class="lg:hidden fixed top-3 left-3 z-30 w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-white text-navy shadow-(--shadow-card) hover:bg-surface cursor-pointer">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
        </svg>
      </button>

      <!-- Anuncios internos del sistema (FC-B1) -->
      <AnnouncementBanner />
      <TrialBanner />

      <!-- Page Content -->
      <main class="flex-1 p-6" data-feedback-content>
        <Breadcrumbs v-if="!isCommandCenter" />
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useDashboardStore } from '@/stores/dashboard.store'
import { useRoomStore } from '@/stores/room.store'
import { useNow } from '@/composables/useNow'
import { useModulesStore } from '@/stores/modules.store'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'
import { isSystemRole } from '@/config/permissions'
import { AuthService } from '@/services/Auth.service'
import { MESSAGING_PATH, MESSAGING_TABS } from '@/config/messaging-tabs'
import logoWhite from '@/assets/logo/logo-horizontal-white.png'
import { PAGINA_PUBLICA_PATH } from '@/config/pagina-publica-tabs'
import AppHeader from '@/components/features/core-pms/AppHeader.vue'
import TrialBanner from '@/components/features/TrialBanner.vue'
import AnnouncementBanner from '@/components/features/core-pms/AnnouncementBanner.vue'
import OfflineBanner from '@/components/features/core-pms/OfflineBanner.vue'
import HotelSwitcher from '@/components/features/core-pms/HotelSwitcher.vue'
import Breadcrumbs from '@/components/ui/Breadcrumbs.vue'

const ICON_MENU = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"/></svg>'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const dashboard = useDashboardStore()
const roomStore = useRoomStore()
const { canRoute } = usePermissions()
const mobileMenuOpen = ref(false)

// Cierra el drawer mobile al navegar a otra ruta
watch(() => route.path, () => { mobileMenuOpen.value = false })

// El dashboard general es un "centro de operaciones" full-dark con barra propia
const isCommandCenter = computed(() => route.name === 'dashboard-general')

const { now } = useNow(1000)
const sidebarClock = computed(() =>
  new Date(now.value).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
const sidebarDate = computed(() =>
  new Date(now.value).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
const isNight = computed(() => {
  const h = new Date(now.value).getHours()
  return h >= 19 || h < 7
})

const ICONS = {
  dashboard: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.5h4.5V21H3v-7.5ZM9.75 8.25h4.5V21h-4.5V8.25ZM16.5 3h4.5v18h-4.5V3Z"/></svg>',
  calendar: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"/></svg>',
  bed: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M5 13V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>',
  user: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
  wallet: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 12h.01M3 10h18"/></svg>',
  utensils: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 3v7a2 2 0 0 0 2 2v9M9 3v7M7 3v7M18 3c-1.5 0-3 1.5-3 5s1.5 4 3 4v9"/></svg>',
  link: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5 21 3M16.5 3H21v4.5M10.5 13.5 3 21M7.5 21H3v-4.5"/></svg>',
  sparkles: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.035-.259a3.375 3.375 0 0 0 2.456-2.455L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"/></svg>',
  heart: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"/></svg>',
  usergroup: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72M18 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M18 18.72v-.235a3 3 0 0 0-3-3M6 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M6 18.72v-.235a3 3 0 0 1 3-3m3.75-6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>',
  cog: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.991a7.66 7.66 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
  support: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"/></svg>',
  tools: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"/></svg>',
  ticket: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a2.25 2.25 0 0 0-2.25-2.25V8.25A2.25 2.25 0 0 0 16.5 6h-9a2.25 2.25 0 0 0-2.25 2.25v1.5a2.25 2.25 0 0 1 0 4.5v1.5A2.25 2.25 0 0 0 7.5 18h9a2.25 2.25 0 0 0 2.25-2.25v-1.5A2.25 2.25 0 0 0 21 12Z"/></svg>',
  star: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.5a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>',
  box: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>',
  cart: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"/></svg>',
  globe: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>',
}

const ICON_SUN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.22 4.22l1.77 1.77M18 18l1.78 1.78M2.5 12H5M19 12h2.5M4.22 19.78 6 18M18 6l1.78-1.78"/></svg>'
const ICON_MOON = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M20.354 15.354A9 9 0 0 1 8.646 3.646a9.003 9.003 0 1 0 11.708 11.708Z"/></svg>'

const nonavItems = [
  {
    label: 'Dashboard', icon: ICONS.dashboard, path: '/panel/dashboard', roles: ['hotel_admin', 'receptionist'],
  },
  {
    label: 'Planning', icon: ICONS.calendar, path: '/panel/planning', roles: ['hotel_admin', 'receptionist'],
  },
  {
    label: 'Channel', icon: ICONS.link, path: '/panel/channel-manager', roles: ['hotel_admin'],
  },
  {
    // Las 8 vistas (General/Landing/Media/Apariencia/Motor de reservas/Códigos de
    // descuento/Reputación/Tracking) que vivían acá como submenú se colapsaron en
    // una sola entrada con tabs (pages/pagina-publica/index.vue), mismo patrón que
    // Mensajería. `anyOf` no aplica (ninguna tab es module-gated, todas hotel_admin).
    label: 'Página pública', icon: ICONS.globe, path: PAGINA_PUBLICA_PATH, roles: ['hotel_admin'],
  },
  {
    label: 'Reservas', icon: ICONS.calendar, roles: ['hotel_admin', 'receptionist'],
    children: [
      { label: 'Reservas', path: '/panel/reservas', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Check-in/out', path: '/panel/reservas/checkin', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Grupos', path: '/panel/reservas/grupos', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Operaciones', icon: ICONS.tools, roles: ['hotel_admin'],
    children: [
      { label: 'Limpieza', path: '/panel/operaciones/limpieza', roles: ['hotel_admin'] },
      { label: 'Mantenimiento', path: '/panel/operaciones/mantenimiento', roles: ['hotel_admin'] },
      { label: 'Proveedores de servicios', path: '/panel/operaciones/proveedores', roles: ['hotel_admin'] },
      { label: 'Chats del equipo', path: '/panel/operaciones/chats', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Restaurante', icon: ICONS.utensils, roles: ['hotel_admin', 'receptionist', 'waiter', 'kitchen'],
    children: [
      { label: 'Salón', path: '/panel/restaurante/salon', roles: ['hotel_admin', 'receptionist', 'waiter'] },
      { label: 'Cocina y Bar (KDS)', path: '/panel/restaurante/cocina', roles: ['hotel_admin', 'receptionist', 'kitchen'] },
      { label: 'Caja', path: '/panel/restaurante/caja', roles: ['hotel_admin', 'receptionist', 'waiter'] },
      { label: 'Carta', path: '/panel/restaurante/carta', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Inventario', icon: ICONS.box, path: '/panel/inventario', roles: ['hotel_admin'] },
  {
    label: 'Compras', icon: ICONS.cart, roles: ['hotel_admin'],
    children: [
      { label: 'Requisiciones', path: '/panel/compras/requisiciones', roles: ['hotel_admin'] },
      { label: 'Órdenes de compra', path: '/panel/compras/ordenes', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Huéspedes', icon: ICONS.user, path: '/panel/guests', roles: ['hotel_admin', 'receptionist'] },
  {
    label: 'Finanzas', icon: ICONS.wallet, roles: ['hotel_admin'],
    children: [
      { label: 'Facturación', path: '/panel/finanzas/facturacion', roles: ['hotel_admin'] },
      { label: 'Folios In-House', path: '/panel/finanzas/folios', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Links de Pago', path: '/panel/finanzas/links-pago', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Caja', path: '/panel/finanzas/caja', roles: ['hotel_admin'] },
      { label: 'Gastos', path: '/panel/finanzas/gastos', roles: ['hotel_admin'] },
      { label: 'Reportes', path: '/panel/finanzas/reportes', roles: ['hotel_admin'] },
      { label: 'Night Audit', path: '/panel/finanzas/night-audit', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Contabilidad', icon: ICONS.wallet, roles: ['hotel_admin'],
    children: [
      { label: 'Plan de Cuentas', path: '/panel/contabilidad/plan-cuentas', roles: ['hotel_admin'] },
      { label: 'Libro Diario', path: '/panel/contabilidad/libro-diario', roles: ['hotel_admin'] },
      { label: 'Libro Mayor', path: '/panel/contabilidad/mayor', roles: ['hotel_admin'] },
      { label: 'Reportes', path: '/panel/contabilidad/reportes', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Tesorería', icon: ICONS.wallet, roles: ['hotel_admin'],
    children: [
      { label: 'Liquidez', path: '/panel/tesoreria/dashboard', roles: ['hotel_admin'] },
      { label: 'Bancos', path: '/panel/tesoreria/bancos', roles: ['hotel_admin'] },
      { label: 'Por Cobrar / Pagar', path: '/panel/tesoreria/cuentas', roles: ['hotel_admin'] },
      { label: 'Presupuesto', path: '/panel/tesoreria/presupuesto', roles: ['hotel_admin'] },
      { label: 'Proveedores', path: '/panel/tesoreria/proveedores', roles: ['hotel_admin'] },
      { label: 'Caja chica', path: '/panel/tesoreria/caja-chica', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Reseñas', icon: ICONS.star, path: '/panel/resenas', roles: ['hotel_admin', 'receptionist'] },
  {
    label: 'IA', icon: ICONS.sparkles, roles: ['hotel_admin', 'receptionist'],
    children: [
      { label: 'Recepcionista', path: '/panel/ia/recepcionista', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Gerente IA', path: '/panel/ia/gerente', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Configuración IA', path: '/panel/ia/recepcionista/config', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'CRM', icon: ICONS.heart, roles: ['hotel_admin'],
    children: [
      { label: 'Fidelización', path: '/panel/crm', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'RRHH', icon: ICONS.usergroup, roles: ['hotel_admin', 'receptionist'],
    children: [
      { label: 'Panel RRHH', path: '/panel/rrhh/dashboard', roles: ['hotel_admin'] },
      { label: 'Empleados', path: '/panel/rrhh/empleados', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Evaluación de Desempeño', path: '/panel/rrhh/evaluacion', roles: ['hotel_admin'] },
      { label: 'Asistencia', path: '/panel/rrhh/attendance', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Nómina', path: '/panel/rrhh/payroll', roles: ['hotel_admin'] },
      { label: 'Reclutamiento', path: '/panel/rrhh/reclutamiento', roles: ['hotel_admin'] },
      { label: 'Reembolsos', path: '/panel/rrhh/reembolsos', roles: ['hotel_admin'] },
      { label: 'Organigrama', path: '/panel/rrhh/organigrama', roles: ['hotel_admin'] },
      { label: 'Equipo', path: '/panel/rrhh/team', roles: ['hotel_admin'] },
      { label: 'Activos', path: '/panel/rrhh/activos', roles: ['hotel_admin'] },
      { label: 'Capacitación', path: '/panel/rrhh/capacitacion', roles: ['hotel_admin'] },
      { label: 'Roles y Permisos', path: '/panel/rrhh/roles', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Configuración', icon: ICONS.cog, roles: ['hotel_admin'],
    // Las 5 vistas de mensajería se colapsaron en una sola entrada con tabs
    // (pages/mensajeria). Con 6 items la lista se lee de un vistazo, así que ya
    // no hacen falta los encabezados de bloque que agrupaban los 10 anteriores.
    children: [
      { label: 'Configuración Base', path: '/panel/config', roles: ['hotel_admin'] },
      { label: 'Habitaciones', path: '/panel/config/habitaciones', roles: ['hotel_admin', 'receptionist'] },
      { label: 'Temporadas y Tarifas', path: '/panel/config/tarifas', roles: ['hotel_admin'] },
      { label: 'Promociones', path: '/panel/config/promociones', roles: ['hotel_admin'] },
      // `anyOf`: /panel/config/mensajeria es CORE (no está en module-map), así que la
      // entrada se gatea por sus tabs — si el hotel no tiene habilitado ningún
      // módulo de mensajería, no se muestra.
      {
        label: 'Mensajería', path: MESSAGING_PATH, roles: ['hotel_admin', 'receptionist'],
        anyOf: MESSAGING_TABS.map(t => t.path),
      },
      { label: 'Pasarelas de Pago', path: '/panel/config/pasarelas', roles: ['hotel_admin'] },
      { label: 'Cerraduras', path: '/panel/config/cerraduras', roles: ['hotel_admin'] },
      { label: 'Dispositivos', path: '/panel/config/dispositivos', roles: ['hotel_admin'] },
      // DT-17: solo hotel_admin (no receptionist/housekeeper) — es el log de acciones sensibles.
      { label: 'Auditoría', path: '/panel/config/auditoria', roles: ['hotel_admin'] },
    ]
  },
  {
    label: 'Soporte', icon: ICONS.support, path: '/panel/support', roles: ['hotel_admin', 'receptionist'],
  },
  {
    label: 'Mis Referidos', icon: ICONS.link, path: '/panel/referidos', roles: ['hotel_admin'],
  },
]

const sectionLabels = nonavItems.filter(i => i.children).map(i => i.label)

function sectionContainsRoute(item: any) {
  // `c.path` es undefined en los encabezados de bloque: se saltean.
  return item.children?.some((c: any) => c.path && route.path.startsWith(c.path)) ?? false
}

// Todas las secciones inician colapsadas, salvo la que contiene la ruta activa
const collapsedSections = ref(new Set(
  sectionLabels.filter(label => !sectionContainsRoute(nonavItems.find(i => i.label === label)))
))

// Acordeón: abrir una sección cierra las demás, así nunca hay más de un menú principal sombreado
function toggleSection(section: string) {
  const wasOpen = !collapsedSections.value.has(section)
  const s = new Set(sectionLabels)
  if (!wasOpen) s.delete(section)
  collapsedSections.value = s
}

interface NavItem {
  label: string
  icon?: string
  path: string
  roles: string[]
  children?: NavItem[]
  expanded?: boolean
  /** Encabezado de bloque dentro de un submenú: no navega ni tiene roles. */
  group?: string
  /**
   * Rutas alternativas de gateo, para entradas que agrupan varias vistas en tabs
   * (Mensajería). El item se muestra si AL MENOS UNA está habilitada, porque su
   * propia ruta es CORE y por sí sola no gatea nada.
   */
  anyOf?: string[]
}

/** ¿El item pasa el gateo por módulo? `anyOf` gana sobre `path` cuando está. */
function navEnabled(item: { path: string; anyOf?: string[] }) {
  return item.anyOf ? item.anyOf.some(p => modules.routeEnabled(p)) : modules.routeEnabled(item.path)
}

function isSectionActive(item: any) {
  if (item.children) return sectionContainsRoute(item)
  return isActive(item.path)
}

// Estado efectivo de módulos/submódulos del hotel (global ∩ plan). El guard de rutas usa el mismo store.
const modules = useModulesStore()

const visibleItems = computed(() => {
  const role = auth.userRole ?? ''
  // Roles de SISTEMA: se muestran por nombre de rol (comportamiento histórico, intacto).
  // Roles CUSTOM (los que crea el dueño): por permiso granular — no matchean ningún nombre
  // de rol del literal, así que sin esto verían el menú vacío. `visibleLeaf` unifica ambos.
  const custom = !isSystemRole(role)
  const visibleLeaf = (item: { path: string; roles: string[]; anyOf?: string[] }) =>
    (custom ? canRoute(item.path) : item.roles.includes(role)) && navEnabled(item)
  // El literal nonavItems mezcla padres (con children, sin path) y hojas (con path);
  // unificamos a NavItem. El template usa path/expanded solo en la rama que corresponde.
  const items = nonavItems as unknown as NavItem[]
  return items
    .map((item) => {
      if (item.children) {
        // Los encabezados de bloque no tienen roles ni path: pasan el filtro y
        // después se descartan los que quedaron sin ningún item debajo (p. ej.
        // un recepcionista que no ve nada de "Integraciones").
        const withGroups = item.children.filter((c) => (c.group ? true : visibleLeaf(c)))
        const children = withGroups.filter((c, i) => !c.group || !!withGroups[i + 1] && !withGroups[i + 1].group)
        return { ...item, children, expanded: !collapsedSections.value.has(item.label) }
      }
      return item
    })
    .filter((item) => {
      // Padre: visible si le queda al menos un hijo habilitado (por rol/permiso + módulo).
      if (item.children) return item.children.length > 0
      // Hoja: por rol/permiso + su ruta habilitada (las rutas CORE quedan siempre visibles).
      return visibleLeaf(item)
    })
})

const occupancyPct = computed(() => dashboard.stats.occupancy)

const occupancyBreakdown = computed(() => {
  const byStatus = dashboard.stats.roomsByStatus
  return {
    occupied: byStatus.occupied ?? 0,
    available: byStatus.available ?? 0,
    maintenance: (byStatus.out_of_service ?? 0) + (byStatus.dirty ?? 0) + (byStatus.cleaning ?? 0),
  }
})

const toast = useToast()

// Verificación de email (#421): solo merchants (no super_admin ni impersonación) con emailVerified === false.
// `emailVerified` lo trae GET /auth/me (hidratado por restoreSession); undefined = todavía sin dato → no mostrar.
const showVerifyEmailBanner = computed(() =>
  !auth.impersonating &&
  auth.userRole !== 'super_admin' &&
  auth.user?.emailVerified === false,
)

const resendingVerification = ref(false)
async function handleResendVerification() {
  if (resendingVerification.value) return
  resendingVerification.value = true
  try {
    await AuthService.resendVerification()
    toast.success('Te reenviamos el correo', 'Revisá tu bandeja de entrada.')
  } catch (e) {
    toast.error('No se pudo reenviar', e instanceof Error ? e.message : 'Intentá de nuevo en un momento.')
  } finally {
    resendingVerification.value = false
  }
}

onMounted(() => {
  dashboard.fetchStats(auth.user?.hotelId)
  modules.ensure(auth.user?.hotelId)
  // Asegura que emailVerified esté hidratado desde /auth/me (login no lo trae).
  if (auth.isAuthenticated && auth.user?.emailVerified === undefined) auth.restoreSession()
})

const roleLabel = computed(() => {
  const labels: Record<string, string> = {
    hotel_admin: 'Panel Hotel',
    receptionist: 'Recepción',
    super_admin: 'Super Admin'
  }
  return labels[auth.userRole ?? ''] ?? 'Panel Hotel'
})

const avatarClass = computed(() => {
  const classes: Record<string, string> = {
    hotel_admin: 'bg-cyan/30 text-white',
    receptionist: 'bg-teal/30 text-white',
    super_admin: 'bg-coral/30 text-white'
  }
  return classes[auth.userRole ?? ''] ?? 'bg-cyan/30 text-white'
})

const userInitials = computed(() => {
  const name = auth.user?.name ?? 'Admin'
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
})


// Todas las rutas que el menú conoce (items sueltos + hijos de sección).
const ALL_MENU_PATHS: string[] = nonavItems.flatMap((i: any) =>
  [i.path, ...(i.children ?? []).map((c: any) => c.path)].filter(Boolean),
)

/**
 * Ruta del menú que mejor describe la ubicación actual: la MÁS LARGA que coincida.
 *
 * Con `startsWith` a secas se encendían dos items a la vez desde que las rutas pasaron a ser
 * anidadas: en /panel/config/habitaciones prendían "Configuración Base" (/panel/config) y
 * "Habitaciones". El match más largo elige uno solo, y las rutas de detalle sin entrada propia
 * (/panel/reservas/:id) siguen resaltando a su padre.
 */
const activeMenuPath = computed(() => {
  let best = ''
  for (const p of ALL_MENU_PATHS) {
    if ((route.path === p || route.path.startsWith(p + '/')) && p.length > best.length) best = p
  }
  return best
})

function isActive(path: string) {
  return activeMenuPath.value === path
}

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.cc-sidebar {
  background: linear-gradient(180deg, #0C1830 0%, #0A1426 100%);
}
.cc-glow-dot {
  box-shadow: 0 0 6px 1px rgba(34, 211, 238, 0.8);
}
</style>
