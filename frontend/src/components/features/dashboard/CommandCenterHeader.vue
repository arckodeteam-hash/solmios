<template>
  <div class="flex flex-wrap items-center md:items-stretch gap-4">
    <!-- Versión compacta para mobile: título del módulo + estado (pl para dejar lugar al toggle del menú) -->
    <div class="flex md:hidden items-center min-w-0 pl-11">
      <div class="min-w-0">
        <h1 class="text-sm font-black text-navy uppercase leading-tight truncate">{{ pageTitle }}</h1>
        <div class="flex items-center gap-1 text-[10px] font-black" :class="apiOnline ? 'text-teal' : 'text-coral'">
          <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="apiOnline ? 'bg-teal' : 'bg-coral'"></span>
          <span class="truncate">{{ hotelName }} · {{ apiOnline ? 'Operativo' : 'Sin conexión' }}</span>
        </div>
      </div>
    </div>

    <!-- Identidad — logo real del hotel sobre el azul de marca. Oculta en mobile.
         Antes acá había una foto de stock de Unsplash con el logo de nadie. -->
    <div class="cc-identity relative hidden w-40 shrink-0 items-center gap-3 overflow-hidden rounded-lg px-4 py-2 sm:w-48 md:flex lg:w-56 xl:w-64">
      <img
        v-if="logo"
        :src="logo"
        alt=""
        class="h-9 w-9 shrink-0 rounded-md bg-white/10 object-contain p-1"
        @error="logoFailed = true"
      />

      <div class="min-w-0">
        <h1 class="text-sm md:text-base font-black tracking-tight text-white uppercase leading-none truncate">{{ pageTitle }}</h1>
        <div class="mt-1.5 flex items-center gap-1.5">
          <span class="text-[11px] font-bold text-white/70 uppercase tracking-tight truncate">{{ hotelName }}</span>
          <div class="flex items-center gap-0.5 shrink-0">
            <svg v-for="i in 5" :key="i" class="h-3 w-3 shrink-0" :class="i <= stars ? 'text-[#F59E0B]' : 'text-white/15'" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 0 0 .95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.446a1 1 0 0 0-.363 1.118l1.287 3.957c.3.922-.755 1.688-1.538 1.118l-3.367-2.446a1 1 0 0 0-1.176 0l-3.367 2.446c-.783.57-1.838-.196-1.538-1.118l1.286-3.957a1 1 0 0 0-.363-1.118L2.062 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 0 0 .95-.69l1.286-3.958Z" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Única card real: pills de estado — se oculta en mobile, no entra el diseño de una sola fila -->
    <div class="cc-status-card relative hidden flex-1 min-w-0 overflow-hidden rounded-2xl border border-white/8 px-4 py-4 md:block lg:px-6 lg:py-5">
      <div class="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-[#2563EB]/15 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-[#06B6D4]/10 blur-3xl"></div>

      <div class="relative flex flex-nowrap items-center gap-2.5 lg:gap-4 xl:gap-6">
        <!-- Estado del hotel -->
        <div class="cc-pill">
          <span class="relative flex h-2.5 w-2.5 shrink-0">
            <span class="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" :class="apiOnline ? 'bg-[#22C55E]' : 'bg-[#EF4444]'"></span>
            <span class="relative inline-flex h-2.5 w-2.5 rounded-full" :class="apiOnline ? 'bg-[#22C55E] cc-glow-green' : 'bg-[#EF4444]'"></span>
          </span>
          <div class="min-w-0">
            <div class="cc-pill-label truncate">Estado del Hotel</div>
            <div class="truncate text-[12px] font-black leading-tight" :class="apiOnline ? 'text-[#22C55E]' : 'text-[#EF4444]'">
              {{ apiOnline ? 'OPERATIVO' : 'SIN CONEXIÓN' }}
            </div>
            <div class="cc-pill-sub truncate">{{ apiOnline ? 'Todo funciona correctamente' : 'Reintentando conexión…' }}</div>
          </div>
        </div>

        <!-- Sincronización channel manager -->
        <div class="cc-pill">
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg" :class="lastSync ? 'bg-[#2563EB]/20 text-[#60A5FA]' : 'bg-white/5 text-slate-500'">
            <svg class="h-3.5 w-3.5" :class="lastSync ? 'animate-[spin_6s_linear_infinite]' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 9A7.5 7.5 0 0 1 19 8m-.5 7A7.5 7.5 0 0 1 5 16" />
            </svg>
          </span>
          <div class="min-w-0">
            <div class="cc-pill-label truncate">Sincronización</div>
            <div class="truncate text-[12px] font-black leading-tight" :class="lastSync ? 'text-white' : 'text-slate-500'">{{ lastSync ? syncAgoShort : syncLoading ? '…' : 'Sin conectar' }}</div>
            <div class="cc-pill-sub truncate">{{ lastSync ? syncAgoLong : syncLoading ? 'Consultando el channel manager' : 'Channel Manager no configurado' }}</div>
          </div>
        </div>

        <!-- Clima (solo si el hotel tiene coordenadas y la API respondió) -->
        <div class="cc-pill">
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg" :class="weather ? 'bg-[#F59E0B]/20' : 'bg-white/5'">
            <template v-if="weather">{{ weather.icon }}</template>
            <svg v-else class="h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
            </svg>
          </span>
          <div class="min-w-0">
            <div class="cc-pill-label truncate">Clima</div>
            <div class="truncate text-[12px] font-black leading-tight" :class="weather ? 'text-white' : 'text-slate-500'">{{ weather ? `${Math.round(weather.temp)}°C` : '—' }}</div>
            <div class="cc-pill-sub truncate">{{ weather ? weather.label : 'No disponible' }}</div>
          </div>
        </div>

        <!-- Recepción -->
        <div class="cc-pill">
          <span class="relative flex h-2.5 w-2.5 shrink-0">
            <span class="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" :class="alerts > 0 ? 'bg-[#F59E0B]' : 'bg-[#22C55E]'"></span>
            <span class="relative inline-flex h-2.5 w-2.5 rounded-full" :class="alerts > 0 ? 'bg-[#F59E0B]' : 'bg-[#22C55E] cc-glow-green'"></span>
          </span>
          <div class="min-w-0">
            <div class="cc-pill-label truncate">Recepción</div>
            <div class="truncate text-[12px] font-black leading-tight" :class="alerts > 0 ? 'text-[#F59E0B]' : 'text-[#22C55E]'">
              {{ alerts > 0 ? `${alerts} PENDIENTE${alerts === 1 ? '' : 'S'}` : 'ONLINE' }}
            </div>
            <div class="cc-pill-sub truncate">{{ alerts > 0 ? 'Requiere atención' : 'Todo Normal' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Herramientas — sin card propia, se integra con el fondo claro del dashboard -->
    <div class="ml-auto flex items-center gap-1.5 py-1">
      <EmergencyButton />
      <NotificationBell />
      <UserMenu placeholder transparent />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import { relativeTime } from '@/composables/useRelativeTime'
import { usePageTitle } from '@/composables/usePageTitle'
import EmergencyButton from '@/components/features/core-pms/EmergencyButton.vue'
import NotificationBell from '@/components/features/core-pms/NotificationBell.vue'
import UserMenu from '@/components/features/core-pms/UserMenu.vue'
import type { WeatherInfo } from '@/services/Weather.service'

// #654: el <h1> real es el módulo actual (Reservas, Gastos…), no el hotel — con lector de
// pantalla las 71 páginas se anunciaban todas igual, y document.title no cambiaba entre rutas.
const pageTitle = usePageTitle()

const props = defineProps<{
  hotelName: string
  /**
   * Logo del hotel (`hotels.logo`, el mismo que sale en facturas y emails). Antes acá había
   * una URL de Unsplash escrita en el template: todos los hoteles del SaaS veían la misma
   * foto de stock de un lobby ajeno y cada carga pegaba a un CDN de terceros.
   *
   * Llega por GET /settings, que es lo que ya se pide para el nombre y las estrellas: así el
   * bloque se ve igual para TODOS los roles del panel. Leerlo de `hotel-media` (la galería de
   * la landing) parecía equivalente pero exige `media:view`, permiso que solo tiene
   * `hotel_admin` — recepción se quedaba sin identidad y con un 403 en cada carga.
   *
   * Sin logo cargado no se dibuja imagen: queda el fondo de marca, sin pedirle nada a nadie.
   */
  logoUrl?: string | null
  starRating?: number | string | null
  apiOnline: boolean
  lastSync?: string | null
  /**
   * Todavía no llegó la respuesta del channel manager. Sin esto, la barra afirmaba
   * "Sin conectar · Channel Manager no configurado" durante los segundos que tarda la
   * consulta — a un hotel que SÍ estaba sincronizado.
   */
  syncLoading?: boolean
  weather?: WeatherInfo | null
  /** Incidencias/tareas abiertas que recepción debería mirar */
  alerts?: number
}>()

/** Un logo borrado del storage no debe dejar un recuadro roto: se trata como "sin logo". */
const logoFailed = ref(false)
const logo = computed(() => (logoFailed.value ? null : props.logoUrl || null))

const { now } = useNow(1000)

const stars = computed(() => Math.min(5, Math.max(0, Number(props.starRating) || 0)))
const alerts = computed(() => props.alerts ?? 0)

// Al switchear de hotel llega otra URL: hay que volver a darle una chance de cargar.
watch(() => props.logoUrl, () => { logoFailed.value = false })

const syncAgoLong = computed(() => relativeTime(props.lastSync, now.value))
const syncAgoShort = computed(() => {
  if (!props.lastSync) return '—'
  const diff = Math.max(0, Math.floor((now.value - new Date(props.lastSync).getTime()) / 1000))
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
})

</script>

<style scoped>
.cc-identity {
  background: linear-gradient(135deg, #0C1830 0%, #0A1426 100%);
}
.cc-status-card {
  background:
    radial-gradient(1200px 300px at 20% -50%, rgba(37, 99, 235, 0.14), transparent),
    linear-gradient(180deg, #0C1830 0%, #0A1426 100%);
  box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.45);
}
.cc-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 0%;
  min-width: 0;
}
.cc-glow-green {
  box-shadow: 0 0 6px 1px rgba(34, 197, 94, 0.6), 0 0 14px 4px rgba(34, 197, 94, 0.3);
}
.cc-pill-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--color-text-muted);
}
.cc-pill-sub {
  font-size: 10px;
  color: var(--color-text-secondary);
}
</style>
