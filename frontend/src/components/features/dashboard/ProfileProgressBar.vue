<template>
  <!-- Franja delgada de progreso de configuración (wizard-refactor F4, doc 04 — reemplaza a
       OnboardingGuide.vue en el dashboard). Una sola línea integrada al header, SIN tarjeta
       propia de borde grueso: solo nombre/porcentaje/barra + un botón que abre el Centro de
       configuración. El desglose de pasos vive ahí, no acá (doc 04/05, decisión D2). -->
  <Transition name="progress-collapse">
    <div v-if="show" class="rounded-2xl bg-navy px-5 py-3 flex items-center gap-4 mb-4">
      <span class="w-2 h-2 rounded-full bg-cyan shrink-0"></span>
      <span class="text-xs font-bold text-white shrink-0">
        {{ pctRequired === 0 ? 'Empiece por acá' : `Configuración: ${pctRequired}% completa` }}
      </span>
      <div class="flex-1 h-1.5 rounded-full bg-white/15 overflow-hidden min-w-[80px]">
        <div class="h-full bg-cyan transition-all duration-500" :style="{ width: pctRequired + '%' }"></div>
      </div>
      <router-link to="/panel/configuracion-inicial"
        class="shrink-0 bg-cyan text-navy font-extrabold text-[11px] px-4 py-1.5 rounded-full hover:shadow-lg transition-all">
        Completar →
      </router-link>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { OnboardingService, type OnboardingStatus } from '@/services/Onboarding.service'

const status = ref<OnboardingStatus | null>(null)

// Doc 04 — "Qué cuenta el porcentaje": UN solo número sobre TODOS los pasos requeridos (perfil +
// operativos combinados, sin desglosar), pero los OPCIONALES (logo, teléfono 2, canales, etc.)
// NO cuentan acá — a diferencia de `doneCount`/`totalCount` del backend, que sí los incluye
// (esos alimentan el detalle del Centro de configuración, no esta franja).
const requiredSteps = computed(() => status.value?.steps.filter((s) => s.required) ?? [])
const pctRequired = computed(() => {
  const total = requiredSteps.value.length
  if (!total) return 0
  const done = requiredSteps.value.filter((s) => s.done).length
  return Math.round((done / total) * 100)
})

// 100% de lo requerido = la franja desaparece del todo, sin resabio — lo opcional pendiente
// (logo, canales, etc.) no la mantiene viva (doc 04, tabla de estados).
const show = computed(() => status.value !== null && pctRequired.value < 100)

onMounted(async () => {
  try {
    status.value = await OnboardingService.status()
  } catch {
    // Sin el estado no se muestra nada: la franja nunca debe estorbar el dashboard.
  }
})
</script>

<style scoped>
.progress-collapse-enter-active, .progress-collapse-leave-active {
  transition: max-height .3s ease, opacity .3s ease, margin-bottom .3s ease;
  max-height: 80px;
  overflow: hidden;
}
.progress-collapse-enter-from, .progress-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  margin-bottom: 0;
}
@media (prefers-reduced-motion: reduce) {
  .progress-collapse-enter-active, .progress-collapse-leave-active { transition: none; }
}
</style>
