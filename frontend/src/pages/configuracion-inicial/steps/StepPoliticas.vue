<template>
  <div class="rounded-xl bg-surface/70 border border-border p-4 space-y-4">
    <div v-if="loading" class="h-24 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <div>
        <p class="text-[11px] font-black uppercase tracking-wide text-navy mb-2">Impuesto</p>
        <!-- R1 (doc 08): el default 'ITBIS'/18% está sesgado a RD — nunca dejarlo pasar en
             silencio. Si el país no es RD y los valores siguen siendo el default, aviso explícito. -->
        <p v-if="showTaxWarning" class="text-[11px] font-bold text-warning bg-warning/10 rounded-lg px-3 py-2 mb-2 flex gap-1.5">
          <span class="w-3.5 h-3.5 shrink-0 mt-px" v-html="ICON_WARN"></span>
          <span>Estos valores son el default de República Dominicana (ITBIS 18%) — su hotel está en {{ country || 'otro país' }}. Confírmelos o cámbielos antes de guardar.</span>
        </p>
        <p class="text-[10px] text-text-muted mb-2">Los campos marcados con <span class="text-danger font-bold">*</span> son obligatorios.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Nombre del impuesto <span class="text-danger">*</span></label>
            <input v-model="taxName" type="text" required aria-required="true" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
          </div>
          <div>
            <label class="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Tasa (%) <span class="text-danger">*</span></label>
            <input v-model.number="taxRate" type="number" min="0" max="100" step="0.1" required aria-required="true" class="w-full rounded-xl border border-border px-3.5 py-2 text-sm focus:border-navy focus:outline-none">
          </div>
        </div>
        <p v-if="error" class="text-[11px] font-bold text-danger mt-2">{{ error }}</p>
        <div class="flex justify-end mt-2">
          <button @click="onSaveTaxes" :disabled="saving"
            class="bg-navy text-white font-bold text-xs px-4 py-2 rounded-full hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {{ saving ? 'Guardando...' : 'Guardar impuesto' }}
          </button>
        </div>
      </div>

      <div class="border-t border-border pt-4">
        <p class="text-[11px] font-black uppercase tracking-wide text-navy mb-2">Política de cancelación <span class="font-normal normal-case text-text-muted/70">(opcional)</span></p>
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

const { saving, error, save } = useOnboardingStep(async () => {
  await SettingsService.patchHotel({ taxName: taxName.value, taxRate: taxRate.value })
}, (status) => emit('saved', status))

async function onSaveTaxes() {
  await save()
  if (!error.value) toast.success('Impuesto guardado')
}
</script>
