<template>
  <!-- Reusa `useHotelLocationMap` (tarea 1.1) — MISMA lógica que `pagina-publica/ubicacion.vue`,
       versión compacta para caber inline en el acordeón (doc 06 punto 6). -->
  <div class="rounded-xl bg-surface/70 border border-border p-4 space-y-3">
    <div v-if="loading" class="h-40 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <p class="text-[10px] text-text-muted">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
      <div>
        <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Dirección <span class="text-danger">*</span></label>
        <input ref="addressInputEl" v-model="form.address" type="text" autocomplete="off" placeholder="Busque la dirección…" required aria-required="true"
          class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none" data-field="address">
        <ul v-if="addressSuggestions.length" class="mt-1 rounded-xl border border-border bg-white shadow-lg overflow-hidden">
          <li v-for="s in addressSuggestions" :key="`${s.lat},${s.lng}`">
            <button type="button" @click="selectAddressSuggestion(s)"
              class="w-full px-3.5 py-2 text-left text-xs text-navy hover:bg-surface cursor-pointer truncate">{{ s.label }}</button>
          </li>
        </ul>
      </div>

      <div v-show="mapsInteractive" ref="mapEl" class="w-full h-56 rounded-xl border border-border overflow-hidden"></div>
      <iframe v-if="!mapsInteractive" :src="googleMapsEmbedUrl" class="w-full h-56 rounded-xl border border-border"
        style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Ubicación del hotel"></iframe>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Provincia</label>
          <input :value="form.province" disabled class="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm disabled:opacity-70" data-field="province">
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Municipio</label>
          <input :value="form.municipality" disabled class="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm disabled:opacity-70" data-field="municipality">
        </div>
      </div>
      <p class="text-[11px] text-text-muted">
        Coordenadas y el resto de los campos geográficos, en detalle, en
        <router-link to="/panel/pagina-publica?tab=ubicacion" class="font-bold text-teal hover:underline">Página pública → Ubicación</router-link>.
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
import { ref, onMounted, nextTick } from 'vue'
import { SettingsService, type HotelFull } from '@/services/Settings.service'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import { useHotelLocationMap } from '@/composables/useHotelLocationMap'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus] }>()

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

const { saving, error, save } = useOnboardingStep(async () => {
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
</script>
