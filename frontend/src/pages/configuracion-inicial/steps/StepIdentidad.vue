<template>
  <div class="rounded-xl bg-surface/70 border border-border p-4 space-y-3">
    <div v-if="loading" class="h-16 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <p class="text-[10px] text-text-muted">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Tipo de alojamiento <span class="text-danger">*</span></label>
          <select v-model="accommodationType" required aria-required="true" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none cursor-pointer">
            <option value="">Seleccionar</option>
            <option value="hotel">Hotel</option>
            <option value="apartment">Apartahotel / Apartamento</option>
            <option value="hostel">Hostal</option>
            <option value="villa">Villa / Casa</option>
            <option value="bnb">Bed &amp; Breakfast</option>
          </select>
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Moneda <span class="text-danger">*</span></label>
          <SearchSelect v-model="currency" :options="CURRENCIES" placeholder="Buscar moneda..." />
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Clasificación <span class="font-normal normal-case text-text-muted/70">(opcional)</span></label>
          <select v-model="starRating" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none cursor-pointer">
            <option value="">N/A</option>
            <option value="1">1 Estrella</option>
            <option value="2">2 Estrellas</option>
            <option value="3">3 Estrellas</option>
            <option value="4">4 Estrellas</option>
            <option value="5">5 Estrellas</option>
          </select>
        </div>
      </div>

      <div class="flex items-start gap-4">
        <div
          @dragover.prevent="logoDragging = true"
          @dragleave.prevent="logoDragging = false"
          @drop.prevent="onLogoDrop"
          @click="logoFileInput?.click()"
          class="relative w-20 h-20 rounded-xl border-2 border-dashed overflow-hidden bg-surface flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          :class="logoDragging ? 'border-cyan bg-cyan/5' : 'border-border hover:border-navy/40'">
          <img v-if="logo" :src="logo" alt="Logo" class="w-full h-full object-contain" />
          <div v-else class="flex flex-col items-center gap-1 px-2 text-center pointer-events-none">
            <span class="w-4 h-4 text-navy/40" v-html="ICON_UPLOAD"></span>
            <span class="text-[8px] font-bold text-text-muted uppercase">Subir logo</span>
          </div>
          <div v-if="logoUploading" class="absolute inset-0 bg-white/80 flex items-center justify-center">
            <span class="text-[9px] font-bold text-navy">Subiendo…</span>
          </div>
        </div>
        <input ref="logoFileInput" type="file" accept="image/*" class="hidden" @change="onLogoFileChange">
        <div class="flex-1 pt-1">
          <p class="text-[10px] font-bold text-text-muted uppercase mb-1">Logo <span class="font-normal normal-case text-text-muted/70">(opcional)</span></p>
          <p class="text-[11px] text-text-muted">Arrastrá una imagen o hacé clic para elegirla. PNG o JPG, máximo 5MB. Se sube al toque, sin esperar a "Guardar".</p>
        </div>
      </div>

      <p class="text-[11px] text-text-muted">
        El sitio web se carga en
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
// Alcance (tarea 3.6, decisión documentada en tareas.md): zona horaria/check-in-out quedan en
// Configuración → Hotel, sin bugs conocidos — no se duplican acá. Estrellas y logo SÍ se agregaron
// acá también a pedido explícito (2026-09-08): quedan editables en dos pantallas (acá y Página
// pública → General), pero a diferencia del bug de amenities duplicadas (D3, tarea 1.7b) — que
// pisaba datos porque `saveAmenitiesHotel` REEMPLAZA el array completo — `starRating` es un campo
// escalar vía PATCH parcial (`patchHotel` solo manda las claves presentes) y el logo se sube por
// su endpoint dedicado (`HotelService.uploadLogo`, ni siquiera pasa por el patch): ninguna de las
// dos superficies puede pisar un cambio hecho en la otra. Sitio web queda solo en Página pública.
import { ref, onMounted } from 'vue'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import { SettingsService } from '@/services/Settings.service'
import { HotelService } from '@/services/Hotel.service'
import { CURRENCIES } from '@/data/intl-catalogs'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus] }>()

const ICON_UPLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>'

const toast = useToast()
const loading = ref(true)
const accommodationType = ref('')
const currency = ref('')
const starRating = ref('')
const logo = ref('')

onMounted(async () => {
  try {
    const s = await SettingsService.get()
    accommodationType.value = s.hotel.accommodationType || ''
    currency.value = s.hotel.currency || ''
    starRating.value = s.hotel.starRating != null ? String(s.hotel.starRating) : ''
    logo.value = s.hotel.logo || ''
  } finally {
    loading.value = false
  }
})

// Logo — mismo patrón que pagina-publica/general.vue: sube DE UNA (endpoint dedicado, data URL
// base64) apenas se elige el archivo, sin esperar al botón "Guardar" general.
const logoFileInput = ref<HTMLInputElement | null>(null)
const logoDragging = ref(false)
const logoUploading = ref(false)
const LOGO_MAX_BYTES = 5 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

async function uploadLogoFile(file: File) {
  if (!file.type.startsWith('image/')) { toast.error('Solo se permiten imágenes'); return }
  if (file.size > LOGO_MAX_BYTES) { toast.error('Máximo 5MB'); return }
  logoUploading.value = true
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const result = await HotelService.uploadLogo(dataUrl, file.name)
    logo.value = result.logo
    toast.success('Logo actualizado')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo subir el logo')
  } finally {
    logoUploading.value = false
  }
}

function onLogoFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''   // permite volver a elegir el mismo archivo si el usuario se arrepiente y reintenta
  if (file) uploadLogoFile(file)
}

function onLogoDrop(e: DragEvent) {
  logoDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) uploadLogoFile(file)
}

const { saving, error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({
    accommodationType: accommodationType.value,
    currency: currency.value,
    starRating: starRating.value,
  })
}, (status) => emit('saved', status))

async function onSave() {
  await save()
  if (!error.value) toast.success('Identidad guardada')
}
</script>
