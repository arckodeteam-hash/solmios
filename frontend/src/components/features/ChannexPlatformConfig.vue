<template>
  <SectionCard title="Channel Manager (Channex)" subtitle="Cuenta única de la plataforma. Todos los hoteles sincronizan OTAs con estas credenciales.">
    <template #actions>
      <span class="text-[11px] font-black px-3 py-1 rounded-full inline-flex items-center gap-1.5" :class="badge.cls">
        <span class="w-2 h-2 rounded-full" :class="badge.dot"></span>{{ badge.label }}
      </span>
    </template>
    <div class="grid md:grid-cols-2 gap-4">
      <div>
        <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">API Key de Channex</label>
        <input v-model="apiKey" type="password" autocomplete="new-password"
          :placeholder="channex.hasKey ? `Guardada (${channex.keyMasked}) — escribí para reemplazar` : 'Pegá tu user-api-key de Channex'"
          class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" />
      </div>
      <div>
        <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Entorno</label>
        <select v-model="channex.environment" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="staging">Staging (modo prueba)</option>
          <option value="production">Producción (OTAs reales)</option>
        </select>
      </div>
    </div>
    <div class="flex items-center gap-3 mt-4 flex-wrap">
      <button @click="save" class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-black hover:bg-navy/90 cursor-pointer">Guardar credenciales</button>
      <button @click="test" :disabled="testing" class="px-5 py-2.5 bg-surface text-navy rounded-xl text-sm font-bold hover:bg-surface-dark disabled:opacity-50 cursor-pointer">
        {{ testing ? 'Probando…' : 'Probar conexión' }}
      </button>
      <span v-if="testResult" class="text-xs font-bold" :class="testResult.ok ? 'text-teal' : 'text-coral'">
        {{ testResult.ok ? '✓' : '✕' }} {{ testResult.msg }}
      </span>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { ChannexAdminService, type ChannexStatus } from '@/services/Platform.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const channex = ref<ChannexStatus>({ environment: 'staging', hasKey: false, keyMasked: '' })
const apiKey = ref('')   // solo se envía si el admin escribe algo (nunca se muestra la key guardada)
const testing = ref(false)
const testResult = ref<{ ok: boolean; msg: string } | null>(null)

// Badge de estado en vivo: Sin configurar / Verificando / Conectado / Sin conexión.
const badge = computed(() => {
  if (!channex.value.hasKey) return { label: 'Sin configurar', cls: 'bg-gold/15 text-gold', dot: 'bg-gold' }
  if (testing.value) return { label: 'Verificando…', cls: 'bg-navy/10 text-navy', dot: 'bg-navy animate-pulse' }
  if (testResult.value?.ok) return { label: 'Conectado', cls: 'bg-teal/15 text-teal', dot: 'bg-teal' }
  if (testResult.value && !testResult.value.ok) return { label: 'Sin conexión', cls: 'bg-coral/15 text-coral', dot: 'bg-coral' }
  return { label: 'Configurada', cls: 'bg-teal/15 text-teal', dot: 'bg-teal' }
})

async function load() {
  try {
    channex.value = await ChannexAdminService.status()
    if (channex.value.hasKey) test()   // auto-verifica al abrir: el estado se ve sin tocar nada
  } catch { /* sin permiso / no seteado */ }
}
async function save() {
  try {
    channex.value = await ChannexAdminService.save({ environment: channex.value.environment, apiKey: apiKey.value.trim() || undefined })
    apiKey.value = ''
    testResult.value = null
    toast.success('Credenciales de Channex guardadas')
  } catch { toast.error('No se pudieron guardar las credenciales') }
}
async function test() {
  testing.value = true
  testResult.value = null
  try {
    const r = await ChannexAdminService.test()
    testResult.value = { ok: r.success, msg: r.message }
  } catch (e: any) {
    testResult.value = { ok: false, msg: e?.message || 'Error al probar la conexión' }
  } finally { testing.value = false }
}

onMounted(load)
</script>
