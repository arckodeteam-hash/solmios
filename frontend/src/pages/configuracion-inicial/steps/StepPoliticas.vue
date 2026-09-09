<template>
  <div class="space-y-4">
    <div v-if="loading" class="h-24 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <div>
        <p class="text-xs font-black uppercase tracking-wide text-navy mb-1.5">Impuesto</p>
        <!-- R1 (doc 08): el default 'ITBIS'/18% está sesgado a RD — nunca dejarlo pasar en
             silencio. Si el país no es RD y los valores siguen siendo el default, aviso explícito. -->
        <p v-if="showTaxWarning" class="text-xs font-bold text-warning bg-warning/10 rounded-lg px-3 py-2 mb-2 flex gap-1.5">
          <span class="w-3.5 h-3.5 shrink-0 mt-px" v-html="ICON_WARN"></span>
          <span>Estos valores son el default de República Dominicana (ITBIS 18%) — su hotel está en {{ country || 'otro país' }}. Confírmelos o cámbielos antes de guardar.</span>
        </p>
        <p class="text-xs text-text-muted mb-2.5">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-text-muted">Nombre del impuesto <span class="text-danger">*</span></label>
            <div class="wizard-field">
              <span class="wizard-field-icon" v-html="ICON_TAG"></span>
              <input v-model="taxName" type="text" required aria-required="true" maxlength="50" class="wizard-input">
            </div>
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-text-muted">Tasa (%) <span class="text-danger">*</span></label>
            <div class="wizard-field">
              <span class="wizard-field-icon" v-html="ICON_PERCENT"></span>
              <input v-model.number="taxRate" type="number" min="0" max="100" step="0.1" required aria-required="true" class="wizard-input">
            </div>
          </div>
        </div>
        <p v-if="error" class="text-xs font-bold text-danger mt-2">{{ error }}</p>
      </div>

      <div class="border-t border-border pt-4">
        <p class="text-xs font-black uppercase tracking-wide text-navy mb-2">Política de cancelación <span class="font-normal normal-case text-text-muted/70">(opcional)</span></p>
        <CancellationPolicyEditor :hotel-id="hotelId" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { SettingsService } from '@/services/Settings.service'
import { countryName } from '@/data/locales'
import CancellationPolicyEditor from '@/components/booking/CancellationPolicyEditor.vue'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus] }>()

const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>'
const ICON_TAG = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.83.699 2.53 0l7.163-7.163a1.79 1.79 0 0 0 0-2.53L13.352 3.659A2.25 2.25 0 0 0 11.762 3H9.568Z"/><path d="M6 6h.008v.008H6V6Z"/></svg>'
const ICON_PERCENT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>'

const toast = useToast()
const loading = ref(true)
const hotelId = ref('')
const country = ref('')
const taxName = ref('')
const taxRate = ref<number | null>(null)

const showTaxWarning = computed(() =>
  country.value && country.value !== 'República Dominicana' && taxName.value === 'ITBIS' && taxRate.value === 18,
)

onMounted(async () => {
  try {
    const h = (await SettingsService.get()).hotel
    hotelId.value = h.id
    // countryName() normaliza el ISO viejo ('DO') al nombre — sin esto, un hotel con 'DO'
    // guardado disparaba el aviso R1 en falso (país 'DO' !== 'República Dominicana') aunque
    // el hotel SÍ fuera dominicano (mismo criterio que settings/index.vue y ubicacion.vue).
    country.value = countryName(h.country) || h.country || ''
    taxName.value = h.taxName || ''
    taxRate.value = h.taxRate ?? null
  } finally {
    loading.value = false
  }
})

const { error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({ taxName: taxName.value, taxRate: taxRate.value })
}, (status) => emit('saved', status))

async function onSaveTaxes() {
  await save()
  if (!error.value) toast.success('Impuesto guardado')
}

defineExpose({ save: onSaveTaxes })
</script>
