<template>
  <!-- Header de la sección. El <h2> de cada vista hija queda debajo y se lee
       como título de la tab activa, así que acá va solo el nombre del grupo
       (mismo patrón que pages/mensajeria/index.vue). -->
  <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-black text-navy">Página pública</h1>
      <p class="text-sm text-text-muted mt-0.5">Landing, motor de reservas, reputación y marketing — todo lo que ve y usa el huésped en un solo lugar.</p>
    </div>
    <!-- Vive ACÁ y no en cada vista: se está editando la misma página pública en las 8 tabs, así
         que poder ir a verla no depende de en cuál estés. Antes existía sólo en Landing y
         Apariencia — desde Media, Motor de reservas o Tracking no había forma de abrirla. -->
    <a
      v-if="publicSlug"
      :href="publicUrl"
      target="_blank"
      rel="noopener"
      class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-navy transition-colors hover:border-navy/40"
    >
      Ver en la web pública
      <span aria-hidden="true" class="text-cyan">↗</span>
    </a>
  </div>

  <!-- Tabs agrupadas: 8 vistas en una sola fila plana se leen mal, así que se -->
  <!-- agrupan por tema (mismo lenguaje visual que los headers de grupo del sidebar). -->
  <div class="mb-6 space-y-3">
    <div v-for="group in visibleGroups" :key="group.name">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-[10px] font-black uppercase tracking-[1.5px] text-text-muted">{{ group.name }}</span>
        <span class="h-px flex-1 bg-border"></span>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="tab in group.tabs"
          :key="tab.value"
          type="button"
          @click="setTab(tab.value)"
          class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
          :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'"
        >
          <span class="h-4 w-4 shrink-0" v-html="TAB_ICONS[tab.value]"></span>
          {{ tab.label }}
        </button>
      </div>
    </div>
  </div>

  <!-- Vista activa. Se monta solo la tab seleccionada: cada una hace su propio
       fetch al montarse, así entrar a Página pública no dispara 8 cargas. -->
  <component :is="tabComponents[activeTab]" v-if="activeTab" :key="activeTab" />

  <EmptyState
    v-else
    :icon="TAB_ICONS.general"
    title="Sin acceso a Página pública"
    message="Tu rol no tiene acceso a estas vistas."
  />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, onMounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { PAGINA_PUBLICA_PATH, PAGINA_PUBLICA_TABS } from '@/config/pagina-publica-tabs'
import EmptyState from '@/components/ui/EmptyState.vue'
import { SettingsService } from '@/services/Settings.service'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// Slug del hotel para el link "Ver en la web pública". Se pide UNA vez acá en vez de una por tab.
// Sin slug el link no se muestra: la landing todavía no tiene dirección a la que ir.
const publicSlug = ref('')
const publicUrl = computed(() => `/h/${encodeURIComponent(publicSlug.value)}`)

// Lazy: cada vista sigue siendo su propio chunk, igual que cuando eran rutas.
const tabComponents: Record<string, Component> = {
  general: defineAsyncComponent(() => import('./general.vue')),
  landing: defineAsyncComponent(() => import('./landing.vue')),
  media: defineAsyncComponent(() => import('./media.vue')),
  apariencia: defineAsyncComponent(() => import('./apariencia.vue')),
  'booking-engine': defineAsyncComponent(() => import('@/pages/booking-engine/index.vue')),
  'promo-codes': defineAsyncComponent(() => import('@/pages/promo-codes/index.vue')),
  reputacion: defineAsyncComponent(() => import('./reputation.vue')),
  tracking: defineAsyncComponent(() => import('./tracking.vue')),
}

const TAB_ICONS: Record<string, string> = {
  general: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.75 6H7.5m9 12h3.75M10.5 18a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.75 18H7.5m9-6h3.75M13.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.75 12H7.5"/></svg>',
  landing: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/></svg>',
  media: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>',
  apariencia: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.6 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16.5a4.5 4.5 0 0 0 4.5-4.5C21 6 17 3 12 3Z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>',
  'booking-engine': '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/><circle cx="6" cy="6" r=".6" fill="currentColor" stroke="none"/><circle cx="8.5" cy="6" r=".6" fill="currentColor" stroke="none"/></svg>',
  'promo-codes': '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z"/></svg>',
  reputacion: '<svg fill="currentColor" viewBox="0 0 24 24" class="w-full h-full"><path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.7l-6.1 3.3 1.5-6.8-5.2-4.7 6.9-.7Z"/></svg>',
  tracking: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M6 21V10M12 21V4M18 21v-7"/></svg>',
}

const visibleTabs = computed(() => {
  const role = auth.userRole ?? ''
  return PAGINA_PUBLICA_TABS.filter(t => t.roles.includes(role))
})

const visibleGroups = computed(() => {
  const order: string[] = ['Contenido', 'Reservas', 'Marketing']
  return order
    .map(name => ({ name, tabs: visibleTabs.value.filter(t => t.group === name) }))
    .filter(g => g.tabs.length > 0)
})

// La tab vive en la URL (?tab=) para que sea linkeable y el back del navegador
// funcione. Una tab pedida que no existe o no está permitida cae en la primera
// visible en lugar de dejar la pantalla vacía.
const activeTab = computed(() => {
  const tabs = visibleTabs.value
  if (!tabs.length) return ''
  const requested = queryTab.value
  return tabs.some(t => t.value === requested) ? requested : tabs[0].value
})

// `route.query.tab` puede llegar como array si la URL repite el param; se
// normaliza a string en los dos lados de la comparación.
const queryTab = computed(() => {
  const raw = route.query.tab
  return Array.isArray(raw) ? String(raw[raw.length - 1] ?? '') : String(raw ?? '')
})

function setTab(value: string) {
  if (value === queryTab.value) return
  router.replace({ path: PAGINA_PUBLICA_PATH, query: { ...route.query, tab: value } })
}

// Normaliza la URL cuando se entra sin ?tab (o con 'general' implícito), o con
// una tab inválida/no permitida. `replace` no agrega entrada al historial.
function syncUrl() {
  if (!activeTab.value) return
  if (route.path !== PAGINA_PUBLICA_PATH) return
  if (queryTab.value === activeTab.value) return
  router.replace({ path: PAGINA_PUBLICA_PATH, query: { ...route.query, tab: activeTab.value } })
}

onMounted(syncUrl)
onMounted(async () => {
  try {
    const s = await SettingsService.get()
    publicSlug.value = (s.hotel?.slug as string) || ''
  } catch { /* sin slug o sin permiso: el link simplemente no aparece */ }
})
watch(activeTab, syncUrl)
</script>
