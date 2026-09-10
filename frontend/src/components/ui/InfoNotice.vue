<script setup lang="ts">
// InfoNotice.vue — Aviso INFORMATIVO arriba de una vista: qué es esto y cómo se usa.
//
// No es SetupAlert (coral: falta una configuración y bloquea operar) ni EmptyState (no hay filas).
// Acá no hay nada roto: la pantalla es técnica y quien la abre necesita el contexto sin ir a la
// documentación. Se lee una vez y se puede plegar; el estado de plegado es por navegador.
//
// Props: title (obligatorio), storageKey (opcional: si viene, recuerda el plegado en localStorage).
// Slot default: el cuerpo (párrafos, listas, <code>).
import { ref } from 'vue'

const props = defineProps<{
  title: string
  storageKey?: string
}>()

function readCollapsed(): boolean {
  if (!props.storageKey) return false
  try { return localStorage.getItem(`info-notice:${props.storageKey}`) === '1' } catch { return false }
}

const collapsed = ref(readCollapsed())

function toggle() {
  collapsed.value = !collapsed.value
  if (!props.storageKey) return
  try { localStorage.setItem(`info-notice:${props.storageKey}`, collapsed.value ? '1' : '0') } catch { /* modo privado */ }
}

const ICON_INFO =
  '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 16v-4m0-4h.01"/></svg>'
</script>

<template>
  <div role="note" class="flex gap-3 rounded-2xl border border-cyan/30 bg-cyan/5 px-4 py-3.5">
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan/15 text-navy">
      <span class="h-4.5 w-4.5" v-html="ICON_INFO"></span>
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-sm font-black text-navy">{{ title }}</h3>
        <button type="button" @click="toggle" class="shrink-0 text-[11px] font-bold text-text-muted hover:text-navy cursor-pointer"
          :aria-expanded="!collapsed">
          {{ collapsed ? 'Ver explicación' : 'Ocultar' }}
        </button>
      </div>
      <div v-if="!collapsed" class="mt-1.5 space-y-1.5 text-xs leading-relaxed text-text-secondary [&_code]:rounded [&_code]:bg-white [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-navy [&_strong]:text-navy">
        <slot />
      </div>
    </div>
  </div>
</template>
