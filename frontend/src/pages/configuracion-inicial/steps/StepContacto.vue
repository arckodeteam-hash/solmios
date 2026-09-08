<template>
  <div class="rounded-xl bg-surface/70 border border-border p-4 space-y-3">
    <div v-if="loading" class="h-24 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Teléfono 2</label>
          <input v-model="form.phone2" type="tel" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Sitio web</label>
          <input v-model="form.website" type="url" placeholder="https://" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
        </div>
        <div class="sm:col-span-2">
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">CIF / NIF / RNC</label>
          <input v-model="form.ownerTaxId" type="text" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
        </div>
      </div>
      <p v-if="error" class="text-[11px] font-bold text-danger">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <!-- Paso 100% opcional: "Saltear" cierra sin persistir nada y sin marcarlo como error. -->
        <button @click="$emit('skip')" type="button"
          class="text-text-secondary font-bold text-xs px-4 py-2 rounded-full hover:bg-surface transition-colors cursor-pointer">
          Saltear
        </button>
        <button @click="onSave" :disabled="saving"
          class="bg-navy text-white font-bold text-xs px-4 py-2 rounded-full hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { SettingsService } from '@/services/Settings.service'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus]; skip: [] }>()

const toast = useToast()
const loading = ref(true)
const form = ref({ phone2: '', website: '', ownerTaxId: '' })

onMounted(async () => {
  try {
    const h = (await SettingsService.get()).hotel
    form.value = { phone2: h.phone2 || '', website: h.website || '', ownerTaxId: h.ownerTaxId || '' }
  } finally {
    loading.value = false
  }
})

const { saving, error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({ ...form.value })
}, (status) => emit('saved', status))

async function onSave() {
  await save()
  if (!error.value) toast.success('Contacto guardado')
}
</script>
