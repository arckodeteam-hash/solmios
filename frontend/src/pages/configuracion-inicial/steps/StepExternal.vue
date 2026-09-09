<template>
  <!-- Paso operativo (tarea 3.11, doc 06 sección 4): no se completa inline, manda a su pantalla
       real. Mismo contenido (how/impact/cta) que ya calculaba `OnboardingUseCase`, sin reescribir
       copy. Componente genérico — hoy solo lo usa `rooms` (rates/channels/team/amenities se
       sacaron del wizard, 2026-09-08), queda listo por si se suma otro paso operativo. -->
  <div class="rounded-2xl p-5" style="background: var(--color-surface)">
    <p class="text-[11px] font-black uppercase tracking-wide text-navy mb-1">Cómo se hace</p>
    <p class="text-sm text-text-secondary leading-relaxed">{{ step.how }}</p>

    <p v-if="step.impact" class="text-[13px] text-text-muted leading-relaxed mt-3 flex gap-1.5">
      <span class="w-4 h-4 shrink-0 mt-px text-warning" v-html="ICON_WARN"></span>
      <span>{{ step.impact }}</span>
    </p>

    <router-link :to="step.route" class="mt-4 wizard-btn-primary">
      {{ step.cta }}
      <span class="w-4 h-4" v-html="ICON_ARROW"></span>
    </router-link>
  </div>
</template>

<script setup lang="ts">
import type { OnboardingStep } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()

const ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>'
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>'
</script>
