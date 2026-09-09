<template>
  <div class="space-y-4">
    <div v-if="loading" class="h-24 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <p class="text-[11px] text-text-muted">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nombre del hotel <span class="text-danger">*</span></label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_BUILDING"></span>
            <input v-model="form.name" type="text" required aria-required="true" maxlength="100" class="wizard-input">
          </div>
        </div>
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">País <span class="text-danger">*</span></label>
          <SearchSelect v-model="form.country" :options="COUNTRIES" placeholder="Buscar país..." />
        </div>
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Teléfono principal <span class="text-danger">*</span></label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_PHONE"></span>
            <input v-model="form.phone" type="tel" required aria-required="true" maxlength="20" class="wizard-input"
              :style="fieldError ? 'border-color: var(--color-danger)' : ''">
          </div>
        </div>
        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Email de contacto <span class="text-danger">*</span></label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_MAIL"></span>
            <input v-model="form.email" type="email" required aria-required="true" maxlength="200" class="wizard-input">
          </div>
        </div>
        <div class="sm:col-span-2">
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Tu nombre (dueño o gerente) <span class="text-danger">*</span></label>
          <div class="wizard-field">
            <span class="wizard-field-icon" v-html="ICON_USER"></span>
            <input v-model="ownerName" type="text" required aria-required="true" maxlength="100" class="wizard-input">
          </div>
        </div>
      </div>
      <p v-if="fieldError || error" class="text-[11px] font-bold text-danger">{{ fieldError || error }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import { SettingsService } from '@/services/Settings.service'
import { AuthService } from '@/services/Auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { COUNTRIES, countryName } from '@/data/locales'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus] }>()

const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></svg>'
const ICON_PHONE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a1.5 1.5 0 0 0 1.5-1.5v-3.108a1.5 1.5 0 0 0-1.06-1.435l-4.185-1.395a1.5 1.5 0 0 0-1.536.365l-1.146 1.146a11.25 11.25 0 0 1-5.11-5.11l1.146-1.147a1.5 1.5 0 0 0 .365-1.535L8.058 3.81A1.5 1.5 0 0 0 6.623 2.75H3.75a1.5 1.5 0 0 0-1.5 1.5v2.5Z"/></svg>'
const ICON_MAIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>'
const ICON_USER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.964 0a9 9 0 1 0-11.964 0m11.964 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'

const toast = useToast()
const loading = ref(true)
const form = ref({ name: '', country: '', phone: '', email: '' })
const ownerName = ref('')
/** `phone` requerido explícito (doc 08 D1) — validación de campo, ANTES de tocar la red: no
 *  reusa `error` del composable (ese es para fallas del PUT). Guardar sin teléfono no persiste. */
const fieldError = ref('')

onMounted(async () => {
  try {
    const s = await SettingsService.get()
    const h = s.hotel
    // countryName() acepta el nombre o el ISO viejo ('DO'): la columna quedó con los dos
    // formatos conviviendo (mismo criterio que settings/index.vue y pagina-publica/ubicacion.vue)
    // — sin esto, un hotel con 'DO' guardado no matchea ninguna opción del SearchSelect.
    form.value = { name: h.name || '', country: countryName(h.country) || h.country || '', phone: h.phone || '', email: h.email || '' }
    ownerName.value = useAuthStore().user?.name || ''
  } finally {
    loading.value = false
  }
})

const { error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({
    name: form.value.name, country: form.value.country, phone: form.value.phone, email: form.value.email,
  })
  // El nombre del dueño/gerente vive en `users.name`, NO en `hotels.ownerName` (ese es un campo
  // fiscal distinto de Configuración → Hotel — doc 02 sección B). Solo si cambió: evita un PUT
  // extra en cada guardado de este paso.
  const authStore = useAuthStore()
  if (ownerName.value.trim() && ownerName.value !== authStore.user?.name) {
    const updated = await AuthService.updateMe({ name: ownerName.value.trim() })
    if (authStore.user) {
      authStore.user.name = updated.name
      localStorage.setItem('user', JSON.stringify(authStore.user))
    }
  }
}, (status) => emit('saved', status))

async function onSave() {
  fieldError.value = form.value.phone.trim() ? '' : 'El teléfono principal es obligatorio'
  if (fieldError.value) return
  await save()
  if (!error.value) toast.success('Bienvenida guardada')
}

// El botón "Guardar y continuar" vive en el shell (index.vue) — expone `save` para que lo invoque
// desde ahí, así "Anterior"/"Guardar y continuar" quedan en una sola fila (mockup del usuario).
defineExpose({ save: onSave })
</script>
