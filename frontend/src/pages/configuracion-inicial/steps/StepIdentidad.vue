<template>
  <div class="rounded-xl bg-surface/70 border border-border p-4 space-y-3">
    <div v-if="loading" class="h-16 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Tipo de alojamiento</label>
          <select v-model="accommodationType" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none cursor-pointer">
            <option value="">Seleccionar</option>
            <option value="hotel">Hotel</option>
            <option value="apartment">Apartahotel / Apartamento</option>
            <option value="hostel">Hostal</option>
            <option value="villa">Villa / Casa</option>
            <option value="bnb">Bed &amp; Breakfast</option>
          </select>
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Moneda</label>
          <SearchSelect v-model="currency" :options="CURRENCIES" placeholder="Buscar moneda..." />
        </div>
      </div>
      <p class="text-[11px] text-text-muted">
        Estrellas, logo y sitio web se cargan en
        <router-link to="/panel/pagina-publica?tab=general" class="font-bold text-teal hover:underline">Página pública → General</router-link>.
      </p>
      <p v-if="error" class="text-[11px] font-bold text-danger">{{ error }}</p>
      <div class="flex justify-end">
        <button @click="onSave" :disabled="saving"
          class="bg-navy text-white font-bold text-xs px-4 py-2 rounded-full hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Alcance reducido a propósito (tarea 3.6, decisión documentada en tareas.md): doc 05 lista acá
// también estrellas/logo/zona horaria/check-in-out, pero estrellas y logo YA viven en Página
// pública → General (tarea 1.7) y zona horaria/check-in-out en Configuración → Hotel, ambos sin
// bugs conocidos. Agregarlos acá crearía una TERCERA superficie editando los mismos campos —
// exactamente el patrón que causó el bug de amenities duplicadas (D3, tarea 1.7b). Este paso
// solo cubre lo que realmente determina `identidad.done` en el backend: accommodationType +
// currency (`onboarding.ts`).
import { ref, onMounted } from 'vue'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import { SettingsService } from '@/services/Settings.service'
import { CURRENCIES } from '@/data/intl-catalogs'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus] }>()

const toast = useToast()
const loading = ref(true)
const accommodationType = ref('')
const currency = ref('')

onMounted(async () => {
  try {
    const s = await SettingsService.get()
    accommodationType.value = s.hotel.accommodationType || ''
    currency.value = s.hotel.currency || ''
  } finally {
    loading.value = false
  }
})

const { saving, error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({ accommodationType: accommodationType.value, currency: currency.value })
}, (status) => emit('saved', status))

async function onSave() {
  await save()
  if (!error.value) toast.success('Identidad guardada')
}
</script>
