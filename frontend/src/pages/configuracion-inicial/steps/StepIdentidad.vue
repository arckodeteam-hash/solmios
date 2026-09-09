<template>
  <div class="space-y-4">
    <div v-if="loading" class="h-16 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <p class="text-[11px] text-text-muted">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Tipo de alojamiento <span class="text-danger">*</span></label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_BUILDING"></span>
            <select v-model="accommodationType" required aria-required="true" class="wizard-select">
              <option value="">Seleccionar</option>
              <option value="hotel">Hotel</option>
              <option value="apartment">Apartahotel / Apartamento</option>
              <option value="hostel">Hostal</option>
              <option value="villa">Villa / Casa</option>
              <option value="bnb">Bed &amp; Breakfast</option>
            </select>
          </div>
        </div>
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Moneda <span class="text-danger">*</span></label>
          <SearchSelect v-model="currency" :options="CURRENCIES" placeholder="Buscar moneda..." />
        </div>
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Clasificación <span class="font-normal normal-case text-text-muted/70">(opcional)</span></label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_STAR"></span>
            <select v-model="starRating" class="wizard-select">
              <option value="">N/A</option>
              <option value="1">1 Estrella</option>
              <option value="2">2 Estrellas</option>
              <option value="3">3 Estrellas</option>
              <option value="4">4 Estrellas</option>
              <option value="5">5 Estrellas</option>
            </select>
          </div>
        </div>
      </div>

      <div class="flex items-start gap-4 rounded-2xl border-2 border-dashed p-4 transition-colors"
        :class="logoDragging ? 'border-teal bg-teal/5' : 'border-border'">
        <div
          @dragover.prevent="logoDragging = true"
          @dragleave.prevent="logoDragging = false"
          @drop.prevent="onLogoDrop"
          @click="logoFileInput?.click()"
          class="relative w-16 h-16 rounded-xl overflow-hidden bg-white border border-border flex items-center justify-center shrink-0 cursor-pointer">
          <img v-if="logo" :src="logo" alt="Logo" class="w-full h-full object-contain" @error="onLogoImgError">
          <span v-else class="w-6 h-6 text-teal" v-html="ICON_UPLOAD"></span>
          <div v-if="logoUploading" class="absolute inset-0 bg-white/80 flex items-center justify-center">
            <span class="text-[9px] font-bold text-navy">Subiendo…</span>
          </div>
        </div>
        <input ref="logoFileInput" type="file" accept="image/*" class="hidden" @change="onLogoFileChange">
        <div class="flex-1 pt-1">
          <p class="text-[10px] font-bold text-text-muted uppercase mb-1">Logo <span class="font-normal normal-case text-text-muted/70">(opcional)</span></p>
          <p class="text-[13px] text-text-secondary leading-relaxed">Arrastrá una imagen o hacé clic para elegirla. PNG o JPG, máximo 5MB. Se sube al toque, sin esperar a "Guardar".</p>
        </div>
      </div>

      <div class="flex items-center gap-2 rounded-2xl px-4 py-3 bg-teal/10">
        <span class="w-4 h-4 text-teal shrink-0" v-html="ICON_GLOBE"></span>
        <p class="text-[13px] text-navy">
          El sitio web se carga en
          <router-link to="/panel/pagina-publica?tab=general" class="font-bold text-teal hover:underline">Página pública → General</router-link>.
        </p>
      </div>
      <p v-if="error" class="text-[11px] font-bold text-danger">{{ error }}</p>
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
const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></svg>'
const ICON_STAR = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.48 3.5a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>'
const ICON_GLOBE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>'

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

/** El error visto en producción (reportado 2026-09-09): justo después de subir, el archivo
 *  existe en el storage con los bytes correctos pero el `<img>` lo carga con 404/502 durante un
 *  rato (confirmado: hasta ~1 minuto en dev con `bun --hot`, probablemente el server
 *  reiniciándose o el filesystem local con el archivo recién escrito todavía no disponible para
 *  otro proceso) — a los pocos segundos el mismo archivo ya sirve 200 sin que nadie lo toque. En
 *  vez de rendirse en el primer error, reintenta con backoff (1s/2s/4s) antes de mostrar el
 *  estado vacío — el cache-bust (`?retry=`) evita que el navegador reuse la respuesta fallida. */
const logoRetries = ref(0)
const MAX_LOGO_RETRIES = 3
function onLogoImgError() {
  if (logoRetries.value < MAX_LOGO_RETRIES) {
    const delay = 1000 * 2 ** logoRetries.value
    logoRetries.value++
    const base = logo.value.split('?')[0]
    setTimeout(() => { logo.value = `${base}?retry=${Date.now()}` }, delay)
    return
  }
  logo.value = ''
  toast.error('No se pudo cargar el logo guardado — volvé a subirlo')
}

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
    logoRetries.value = 0
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

const { error, save } = useOnboardingStep(async () => {
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

defineExpose({ save: onSave })
</script>
