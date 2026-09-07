<template>
  <div>
    <!-- Header de la sección. El <h2> de cada vista hija queda debajo y se lee
         como título de la tab activa, así que acá va solo el nombre del grupo. -->
    <div class="mb-5">
      <h1 class="text-2xl font-black text-navy">Mensajería</h1>
      <p class="text-sm text-text-muted mt-0.5">Envíos automáticos, plantillas y trazabilidad de lo que se le manda al huésped</p>
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

    <!-- Vista activa. Se monta solo la tab seleccionada: cada una hace su propio
         fetch al montarse, así entrar a Mensajería no dispara 5 cargas. -->
    <component :is="tabComponents[activeTab]" v-if="activeTab" :key="activeTab" />

    <!-- Sin ninguna tab: rol sin acceso o los módulos de mensajería están
         desactivados para el hotel. El menú ya oculta la entrada en ese caso;
         esto cubre la entrada directa por URL. -->
    <EmptyState
      v-else
      :icon="TAB_ICONS['message-logs']"
      title="Sin acceso a Mensajería"
      message="Tu rol no tiene acceso a estas vistas, o los módulos de mensajería no están habilitados para este hotel."
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, watch, onMounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useModulesStore } from '@/stores/modules.store'
import { MESSAGING_PATH, MESSAGING_TABS } from '@/config/messaging-tabs'
import EmptyState from '@/components/ui/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const modules = useModulesStore()

// Lazy: cada vista sigue siendo su propio chunk, igual que cuando eran rutas.
const tabComponents: Record<string, Component> = {
  'auto-messages': defineAsyncComponent(() => import('@/pages/auto-messages/index.vue')),
  'whatsapp-templates': defineAsyncComponent(() => import('@/pages/whatsapp-templates/index.vue')),
  'message-logs': defineAsyncComponent(() => import('@/pages/message-logs/index.vue')),
  'email-queue': defineAsyncComponent(() => import('@/pages/email-queue/index.vue')),
  'push-tokens': defineAsyncComponent(() => import('@/pages/push-tokens/index.vue')),
}

const TAB_ICONS: Record<string, string> = {
  'auto-messages': '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
  'whatsapp-templates': '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h8M8 14h5M21 12a9 9 0 0 1-13.24 7.94L3 21l1.06-4.76A9 9 0 1 1 21 12Z"/></svg>',
  'message-logs': '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m-6 8h6m-6 4h4"/></svg>',
  'email-queue': '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="m3 8 8.25 5.5a1.5 1.5 0 0 0 1.5 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z"/></svg>',
  'push-tokens': '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M14.86 17.09a3 3 0 0 1-5.72 0m8.86-4.09V10a5 5 0 1 0-10 0v3l-1.6 2.4a.6.6 0 0 0 .5.93h12.2a.6.6 0 0 0 .5-.93L18 13Z"/></svg>',
}

// Mismo criterio que el menú: rol + módulo habilitado, evaluado sobre la ruta
// ORIGINAL de cada vista (ver comentario en config/messaging-tabs.ts).
// El rol se resuelve con `canActAsHotelAdmin`, no con el nombre crudo: el super admin que está
// DENTRO de la cuenta de un cliente conserva permisos ['*:*'] y el backend le autoriza estas
// pantallas igual, pero el rol VISIBLE es el del cliente (recepción, mesero…) y las tabs de
// nivel hotel_admin desaparecían. El gateo por módulo se mantiene tal cual: eso es del plan
// del hotel, no del rol de quien mira.
const visibleTabs = computed(() => {
  const role = auth.userRole ?? ''
  return MESSAGING_TABS.filter(
    t => (t.roles.includes(role) || (auth.canActAsHotelAdmin && t.roles.includes('hotel_admin')))
      && modules.routeEnabled(t.path)
  )
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
  router.replace({ path: MESSAGING_PATH, query: { ...route.query, tab: value } })
}

// Normaliza la URL cuando se entra sin ?tab, o con una tab inválida/no permitida
// (p. ej. un recepcionista abriendo un link a ?tab=email-queue). `replace` no
// agrega entrada al historial: el back sigue saliendo de Mensajería.
function syncUrl() {
  if (!activeTab.value) return
  if (route.path !== MESSAGING_PATH) return
  if (queryTab.value === activeTab.value) return
  router.replace({ path: MESSAGING_PATH, query: { ...route.query, tab: activeTab.value } })
}

onMounted(syncUrl)
// `visibleTabs` cambia cuando termina de cargar el estado de módulos del hotel:
// recién ahí se sabe si la tab de la URL es válida.
watch([activeTab, visibleTabs], syncUrl)
</script>
