<template>
  <div class="space-y-4">
    <div v-if="loading" class="h-24 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Teléfono 2</label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_PHONE"></span>
            <input v-model="form.phone2" type="tel" class="wizard-input">
          </div>
        </div>
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Sitio web</label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_GLOBE"></span>
            <input v-model="form.website" type="url" placeholder="https://" class="wizard-input">
          </div>
        </div>
        <div class="sm:col-span-2">
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">CIF / NIF / RNC</label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_ID"></span>
            <input v-model="form.ownerTaxId" type="text" class="wizard-input">
          </div>
        </div>
      </div>
      <p v-if="error" class="text-[11px] font-bold text-danger">{{ error }}</p>
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

const ICON_PHONE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a1.5 1.5 0 0 0 1.5-1.5v-3.108a1.5 1.5 0 0 0-1.06-1.435l-4.185-1.395a1.5 1.5 0 0 0-1.536.365l-1.146 1.146a11.25 11.25 0 0 1-5.11-5.11l1.146-1.147a1.5 1.5 0 0 0 .365-1.535L8.058 3.81A1.5 1.5 0 0 0 6.623 2.75H3.75a1.5 1.5 0 0 0-1.5 1.5v2.5Z"/></svg>'
const ICON_GLOBE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>'
const ICON_ID = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.25" y="4.5" width="19.5" height="15" rx="2"/><path d="M6.75 15c.4-1.5 1.6-2.25 2.75-2.25s2.35.75 2.75 2.25M9.5 9.5a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0ZM14.25 9h4.5M14.25 12.75h4.5"/></svg>'

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

const { error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({ ...form.value })
}, (status) => emit('saved', status))

async function onSave() {
  await save()
  if (!error.value) toast.success('Contacto guardado')
}

defineExpose({ save: onSave, skip: () => emit('skip') })
</script>
