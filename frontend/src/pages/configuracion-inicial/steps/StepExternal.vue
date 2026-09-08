<template>
  <!-- Paso operativo (rooms/rates/channels/team) — un solo componente genérico para los 4
       (tarea 3.11, doc 06 sección 4): no se completa inline, manda a su pantalla real. Mismo
       contenido (how/impact/cta) que ya calculaba `OnboardingUseCase`, sin reescribir copy. -->
  <div class="rounded-xl bg-surface/70 border border-border p-4">
    <p class="text-[11px] font-black uppercase tracking-wide text-navy mb-1">Cómo se hace</p>
    <p class="text-xs text-text-secondary leading-relaxed">{{ step.how }}</p>

    <p v-if="step.impact" class="text-[11px] text-text-muted leading-relaxed mt-2.5 flex gap-1.5">
      <span class="w-3.5 h-3.5 shrink-0 mt-px text-warning" v-html="ICON_WARN"></span>
      <span>{{ step.impact }}</span>
    </p>

    <router-link
      :to="step.route"
      class="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-bold transition-colors"
      :class="step.required ? 'bg-navy text-white hover:bg-navy-light' : 'border border-border text-text-secondary hover:border-navy/30'"
    >
      {{ step.cta }}
      <span class="w-3 h-3" v-html="ICON_ARROW"></span>
    </router-link>
  </div>
</template>

<script setup lang="ts">
import type { OnboardingStep } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()

const ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>'
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>'
</script>
