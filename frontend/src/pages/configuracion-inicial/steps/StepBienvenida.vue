<template>
  <div class="rounded-xl bg-surface/70 border border-border p-4 space-y-3">
    <div v-if="loading" class="h-24 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <p class="text-[10px] text-text-muted">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Nombre del hotel <span class="text-danger">*</span></label>
          <input v-model="form.name" type="text" required aria-required="true" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">País <span class="text-danger">*</span></label>
          <SearchSelect v-model="form.country" :options="COUNTRIES" placeholder="Buscar país..." />
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Teléfono principal <span class="text-danger">*</span></label>
          <input v-model="form.phone" type="tel" required aria-required="true" class="w-full rounded-xl border px-3.5 py-2 text-sm focus:border-navy focus:outline-none"
            :class="fieldError ? 'border-danger' : 'border-border'">
        </div>
        <div>
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Email de contacto <span class="text-danger">*</span></label>
          <input v-model="form.email" type="email" required aria-required="true" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
        </div>
        <div class="sm:col-span-2">
          <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Tu nombre (dueño o gerente) <span class="text-danger">*</span></label>
          <input v-model="ownerName" type="text" required aria-required="true" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
        </div>
      </div>
      <p v-if="fieldError || error" class="text-[11px] font-bold text-danger">{{ fieldError || error }}</p>
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

const { saving, error, save } = useOnboardingStep(async () => {
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
</script>
