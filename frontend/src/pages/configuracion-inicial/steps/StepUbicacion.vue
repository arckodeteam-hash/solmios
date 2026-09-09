<template>
  <!-- Reusa `useHotelLocationMap` (tarea 1.1) — MISMA lógica que `pagina-publica/ubicacion.vue`,
       versión compacta para caber inline en el acordeón (doc 06 punto 6). -->
  <div class="space-y-4">
    <div v-if="loading" class="h-40 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <p class="text-[11px] text-text-muted">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
      <div>
        <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Dirección <span class="text-danger">*</span></label>
        <div class="wizard-field">
          <span class="wizard-field-icon" v-html="ICON_PIN"></span>
          <input ref="addressInputEl" v-model="form.address" type="text" autocomplete="off" placeholder="Busque la dirección…" required aria-required="true"
            class="wizard-input" data-field="address">
        </div>
        <ul v-if="addressSuggestions.length" class="mt-1 rounded-xl border border-border bg-white shadow-lg overflow-hidden">
          <li v-for="s in addressSuggestions" :key="`${s.lat},${s.lng}`">
            <button type="button" @click="selectAddressSuggestion(s)"
              class="w-full px-3.5 py-2 text-left text-xs text-navy hover:bg-surface cursor-pointer truncate">{{ s.label }}</button>
          </li>
        </ul>
      </div>

      <div v-show="mapsInteractive" ref="mapEl" class="w-full h-56 rounded-2xl border border-border overflow-hidden"></div>
      <iframe v-if="!mapsInteractive" :src="googleMapsEmbedUrl" class="w-full h-56 rounded-2xl border border-border"
        style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Ubicación del hotel"></iframe>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Provincia</label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_MAP"></span>
            <input :value="form.province" disabled class="wizard-input" style="background: var(--color-surface); opacity: .8" data-field="province">
          </div>
        </div>
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Municipio</label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_MAP"></span>
            <input :value="form.municipality" disabled class="wizard-input" style="background: var(--color-surface); opacity: .8" data-field="municipality">
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 rounded-2xl px-4 py-3 bg-teal/10">
        <span class="w-4 h-4 text-teal shrink-0" v-html="ICON_GLOBE"></span>
        <p class="text-[13px] text-navy">
          Coordenadas y el resto de los campos geográficos, en detalle, en
          <router-link to="/panel/pagina-publica?tab=ubicacion" class="font-bold text-teal hover:underline">Página pública → Ubicación</router-link>.
        </p>
      </div>

      <p v-if="error" class="text-[11px] font-bold text-danger">{{ error }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { SettingsService, type HotelFull } from '@/services/Settings.service'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import { useHotelLocationMap } from '@/composables/useHotelLocationMap'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus] }>()

const ICON_PIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>'
const ICON_MAP = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6.75 3.75 9v11.25L9 18l6 2.25 5.25-2.25V6.75L15 9l-6-2.25Z"/><path d="M9 6.75v11.25M15 9v11.25"/></svg>'
const ICON_GLOBE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>'

const toast = useToast()
const loading = ref(true)

type LocationForm = Pick<Partial<HotelFull>, 'country' | 'address' | 'latitude' | 'longitude' | 'province' | 'municipality' | 'locality' | 'postalCode'>
const form = ref<LocationForm>({ country: '', address: '', latitude: undefined, longitude: undefined, province: '', municipality: '', locality: '', postalCode: '' })

const {
  mapEl, mapsInteractive, googleMapsEmbedUrl, initInteractiveMap,
  addressInputEl, addressSuggestions, initAddressAutocomplete, selectAddressSuggestion,
  markLocationLoaded,
} = useHotelLocationMap(form)

onMounted(async () => {
  try {
    const h = (await SettingsService.get()).hotel
    form.value = {
      country: h.country || '',
      address: h.address || '',
      latitude: h.latitude ? Number(h.latitude) : undefined,
      longitude: h.longitude ? Number(h.longitude) : undefined,
      province: h.province || '', municipality: h.municipality || '',
      locality: h.locality || '', postalCode: h.postalCode || '',
    }
  } finally {
    loading.value = false
    await nextTick()
    await initInteractiveMap()
    await initAddressAutocomplete()
    markLocationLoaded()
  }
})

const { error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({
    address: form.value.address, latitude: form.value.latitude, longitude: form.value.longitude,
    province: form.value.province, municipality: form.value.municipality,
    locality: form.value.locality, postalCode: form.value.postalCode,
  })
}, (status) => emit('saved', status))

async function onSave() {
  await save()
  if (!error.value) toast.success('Ubicación guardada')
}

defineExpose({ save: onSave })
</script>
