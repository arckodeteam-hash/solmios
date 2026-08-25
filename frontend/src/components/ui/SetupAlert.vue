<script setup lang="ts">
// SetupAlert.vue — Aviso de configuración FALTANTE que bloquea la operación.
//
// No es un estado vacío (para eso está EmptyState.vue, que centra un cartel cuando una lista no
// trae filas). Acá el problema no es "no hay datos": es que sin esa configuración el hotel no
// puede tarifar ni cobrar, y el usuario tiene que enterarse arriba de todo y con un paso concreto.
//
// Props: title (obligatorio), message.
// Slot #action para el primer paso — el llamador decide si mostrarlo según el permiso del usuario.
//
// Uso:
//   <SetupAlert title="Todavía no podés cobrar online" message="...">
//     <template v-if="can('billing', 'edit')" #action>
//       <button @click="configure">Configurar pasarela</button>
//     </template>
//   </SetupAlert>
defineProps<{
  title: string
  message?: string
}>()

const ICON_ALERT =
  '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z"/></svg>'
</script>

<template>
  <div role="alert" class="flex gap-3 rounded-2xl border border-coral/30 bg-coral/5 px-4 py-3.5">
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-coral/15 text-coral">
      <span class="h-4.5 w-4.5" v-html="ICON_ALERT"></span>
    </span>
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-black text-coral">{{ title }}</h3>
      <p v-if="message" class="mt-1 text-xs leading-relaxed text-text-secondary">{{ message }}</p>
      <div v-if="$slots.action" class="mt-3">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>

<style scoped></style>
