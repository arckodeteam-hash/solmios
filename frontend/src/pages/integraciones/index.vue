<template>
  <div>
    <!-- Header de la sección. Cada vista hija trae su propio título, que se lee como el de la
         tab activa, así que acá va solo el nombre del grupo. -->
    <div class="mb-5">
      <h1 class="text-2xl font-black text-navy">Integraciones</h1>
      <p class="text-sm text-text-muted mt-0.5">Todo lo que el hotel conecta con servicios de afuera: WhatsApp, cobros, cerraduras y facturación</p>
    </div>

    <!-- Tabs -->
    <div v-if="visibleTabs.length" class="flex flex-wrap gap-2 mb-6">
      <button
        v-for="tab in visibleTabs"
        :key="tab.value"
        @click="setTab(tab.value)"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'"
      >
        <span class="h-4 w-4 shrink-0" v-html="TAB_ICONS[tab.value]"></span>
        {{ tab.label }}
      </button>
    </div>

    <!-- Se monta solo la tab seleccionada: entrar a Integraciones no dispara la carga de las cinco. -->
    <component :is="tabComponents[activeTab]" v-if="activeTab" :key="activeTab" />

    <EmptyState
      v-else
      :icon="TAB_ICONS.whatsapp"
      title="Sin acceso a Integraciones"
      message="Tu rol no tiene acceso a estas vistas, o las integraciones no están habilitadas para este hotel."
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, watch, onMounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useModulesStore } from '@/stores/modules.store'
import { INTEGRATIONS_PATH, INTEGRATION_TABS } from '@/config/integration-tabs'
import EmptyState from '@/components/ui/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const modules = useModulesStore()

// Lazy: cada vista sigue siendo su propio chunk, igual que cuando eran rutas sueltas.
const tabComponents: Record<string, Component> = {
  whatsapp: defineAsyncComponent(() => import('@/pages/integraciones/whatsapp.vue')),
  pasarelas: defineAsyncComponent(() => import('@/pages/pagos/index.vue')),
  cerraduras: defineAsyncComponent(() => import('@/pages/cerraduras/index.vue')),
  dispositivos: defineAsyncComponent(() => import('@/pages/devices/index.vue')),
  facturacion: defineAsyncComponent(() => import('@/pages/integraciones/facturacion.vue')),
}

const TAB_ICONS: Record<string, string> = {
  whatsapp: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 0 1-13.24 7.94L3 21l1.06-4.76A9 9 0 1 1 21 12Z"/></svg>',
  pasarelas: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M2 10h20M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/></svg>',
  cerraduras: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg>',
  dispositivos: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M12 21h5a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1Z"/></svg>',
  facturacion: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM8 7h8M8 11h8M8 15h5"/></svg>',
}

// Mismo criterio que Mensajería: rol + módulo habilitado, evaluado sobre la ruta ORIGINAL de cada
// vista. Las tabs que nacieron acá (`path: null`) no tienen módulo propio que gatear: entran con
// el rol, igual que la página. El rol se resuelve con `canActAsHotelAdmin` para que el super admin
// metido en la cuenta de un cliente siga viendo lo que el backend le autoriza.
const visibleTabs = computed(() => {
  const role = auth.userRole ?? ''
  return INTEGRATION_TABS.filter(
    t => (t.roles.includes(role) || (auth.canActAsHotelAdmin && t.roles.includes('hotel_admin')))
      && (t.path === null || modules.routeEnabled(t.path))
  )
})

// `route.query.tab` puede llegar como array si la URL repite el param.
const queryTab = computed(() => {
  const raw = route.query.tab
  return Array.isArray(raw) ? String(raw[raw.length - 1] ?? '') : String(raw ?? '')
})

// La tab vive en la URL (?tab=) para que el link sea compartible y el back del navegador funcione.
// Una tab pedida que no existe o no está permitida cae en la primera visible.
const activeTab = computed(() => {
  const tabs = visibleTabs.value
  if (!tabs.length) return ''
  const requested = queryTab.value
  return tabs.some(t => t.value === requested) ? requested : tabs[0].value
})

function setTab(value: string) {
  if (value === queryTab.value) return
  router.replace({ path: INTEGRATIONS_PATH, query: { ...route.query, tab: value } })
}

// Normaliza la URL al entrar sin ?tab o con una inválida. `replace` no agrega historial.
function syncUrl() {
  if (!activeTab.value) return
  if (route.path !== INTEGRATIONS_PATH) return
  if (queryTab.value === activeTab.value) return
  router.replace({ path: INTEGRATIONS_PATH, query: { ...route.query, tab: activeTab.value } })
}

onMounted(syncUrl)
// `visibleTabs` cambia cuando termina de cargar el estado de módulos del hotel.
watch([activeTab, visibleTabs], syncUrl)
</script>
