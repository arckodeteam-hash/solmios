<template>
  <div class="max-w-2xl">
    <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-extrabold text-navy">Facturación Electrónica</h3>
        <span class="text-[10px] font-bold px-2 py-1 rounded-full"
          :class="fiscalConfig.enabled ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
          {{ fiscalConfig.enabled ? 'Numeración activa' : 'Desactivada' }}
        </span>
      </div>
      <div class="p-4 bg-surface rounded-xl space-y-3">
        <div class="flex items-center gap-3">
          <span class="w-5 h-5 text-navy/50 shrink-0" v-html="ICON_RECEIPT"></span>
          <div class="min-w-0">
            <div class="text-sm font-bold text-navy">NCF (Comprobante Fiscal)</div>
            <div class="text-[10px] text-text-muted">Numera cada factura correlativamente según la autoridad fiscal de tu país</div>
          </div>
        </div>
        <div class="flex items-center justify-between p-3 bg-white rounded-xl">
          <div class="text-sm font-bold text-navy">Activar numeración fiscal</div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input v-model="fiscalConfig.enabled" type="checkbox" class="sr-only peer">
            <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
          </label>
        </div>
        <div v-if="fiscalConfig.enabled" class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Autoridad</label>
            <select v-model="fiscalConfig.authority" class="w-full px-3 py-2 rounded-full border border-border text-sm cursor-pointer">
              <option value="DGII">DGII (Rep. Dominicana)</option>
              <option value="DIAN">DIAN (Colombia)</option>
              <option value="SAT">SAT (México)</option>
              <option value="SUNAT">SUNAT (Perú)</option>
              <option value="SII">SII (Chile)</option>
              <option value="AFIP">AFIP (Argentina)</option>
              <option value="none">Otra / Manual</option>
            </select>
          </div>
          <div>
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Serie</label>
            <input v-model="fiscalConfig.serie" placeholder="E31" class="w-full px-3 py-2 rounded-full border border-border text-sm">
          </div>
        </div>
        <p v-if="fiscalConfig.enabled" class="text-[10px] text-text-muted">
          Próximo NCF: {{ nextNcfPreview }}. El envío a {{ fiscalConfig.authority === 'none' ? 'la autoridad' : fiscalConfig.authority }} requiere credenciales del país — todavía no está conectado, así que el NCF queda local por ahora.
        </p>
        <button @click="saveFiscalConfig" :disabled="fiscalSaving"
          class="w-full px-4 py-2 bg-navy text-white rounded-full text-sm font-bold hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
          {{ fiscalSaving ? 'Guardando...' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ConfigService } from '@/services/Platform.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()

const ICON_RECEIPT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>'

// Facturación electrónica / NCF (configuration['electronic_invoicing']) — antes esta tab solo
// mostraba una card informativa sin ningún campo: no existía forma de setear `enabled`, así que
// nextNcf() (fiscal.ts) siempre devolvía null aunque la UI insinuara "NCF automático".
const fiscalConfig = reactive({ enabled: false, serie: 'E31', authority: 'DGII', sequence: 0 })
const fiscalSaving = ref(false)

// Foto de lo guardado, para avisar al salir con cambios pendientes. Venía del control global de
// Configuración Base; al mudarse acá el bloque se lo trae puesto en vez de perderlo.
const guardado = ref('')
const snapshot = () => JSON.stringify(fiscalConfig)
const sucio = computed(() => snapshot() !== guardado.value)

async function loadFiscalConfig() {
  try {
    const c = await ConfigService.get('electronic_invoicing') as
      { enabled?: boolean; serie?: string; authority?: string; sequence?: number } | null
    if (c) {
      fiscalConfig.enabled = !!c.enabled
      fiscalConfig.serie = c.serie || 'E31'
      fiscalConfig.authority = c.authority || 'DGII'
      fiscalConfig.sequence = c.sequence ?? 0
    }
  } catch { /* default: desactivado */ }
  guardado.value = snapshot()
}

// Mismo formato que buildNcf() en fiscal.ts — preview, la numeración real la arma el backend.
const nextNcfPreview = computed(() => {
  const seq = String((fiscalConfig.sequence || 0) + 1).padStart(11, '0')
  const serie = fiscalConfig.serie || 'E31'
  const auth = fiscalConfig.authority || 'MANUAL'
  return `${serie}${auth === 'DGII' ? '' : '-'}${seq}`.replace('--', '-')
})

async function saveFiscalConfig() {
  fiscalSaving.value = true
  try {
    await ConfigService.set('electronic_invoicing', {
      enabled: fiscalConfig.enabled, serie: fiscalConfig.serie.trim() || 'E31',
      authority: fiscalConfig.authority, sequence: fiscalConfig.sequence,
    })
    guardado.value = snapshot()
    toast.success('Facturación electrónica guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    fiscalSaving.value = false
  }
}

onMounted(loadFiscalConfig)

onBeforeRouteLeave(() => {
  if (!sucio.value) return true
  return window.confirm('Hay cambios sin guardar en Facturación electrónica. ¿Salir igual?')
})
</script>
