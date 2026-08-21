<template>
  <!--
    TrackingSettings — pestaña del admin (F3 3.13, solmi-direct-booking / server-tracking).
    Configura las creds de Meta CAPI (Pixel + token) y GA4 Measurement Protocol v2 para
    tracking server-side de conversiones. Las creds persisten en la tabla `configuration`
    vía ConfigService. Botón "Send test event" dispara POST /api/server-tracking/test que
    valida la config contra Meta Events Manager y GA4 Realtime.

    Spec: server-tracking/spec.md "Test mode para dev" + "Enhanced Conversions".
    Secrets (CAPI token, GA4 api_secret) NO se renderizan — password-like.
  -->
  <div class="space-y-5">
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Tracking y conversión</h2>
        <p class="text-sm text-text-muted mt-0.5">
          Server-side tracking con Meta CAPI y GA4 Measurement Protocol — recupera la data que pierden los ad-blockers y Safari ITP.
        </p>
      </div>
      <button
        @click="sendTestEvent"
        :disabled="testing"
        class="rounded-full bg-navy px-5 py-2 text-sm font-extrabold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {{ testing ? 'Enviando test…' : 'Send test event' }}
      </button>
    </div>

    <!-- Test result banner -->
    <div
      v-if="testResult"
      class="rounded-2xl border p-4 text-sm"
      :class="hasTestFailure ? 'border-warning/30 bg-warning/5' : 'border-teal/30 bg-teal/5'"
    >
      <p class="font-bold text-navy">Test event enviado</p>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        <div class="rounded-xl bg-white p-3">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold uppercase text-text-muted">Meta CAPI</span>
            <span class="rounded-full px-2 py-1 text-[10px] font-extrabold uppercase"
              :class="statusBadgeClass(testResult.meta.status)">
              {{ testResult.meta.status }}
            </span>
          </div>
          <p v-if="testResult.meta.errorMessage" class="mt-1 text-[10px] text-danger">{{ testResult.meta.errorMessage }}</p>
        </div>
        <div class="rounded-xl bg-white p-3">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold uppercase text-text-muted">GA4 MP v2</span>
            <span class="rounded-full px-2 py-1 text-[10px] font-extrabold uppercase"
              :class="statusBadgeClass(testResult.ga4.status)">
              {{ testResult.ga4.status }}
            </span>
          </div>
          <p v-if="testResult.ga4.errorMessage" class="mt-1 text-[10px] text-danger">{{ testResult.ga4.errorMessage }}</p>
        </div>
      </div>
      <p class="mt-2 text-[10px] text-text-muted leading-relaxed">
        Si Meta está configurado con <code>meta_test_event_code</code>, el evento aparece en Meta Events Manager → Test Events
        (no contamina métricas de producción). GA4 demora 30s-1min en aparecer en Realtime → Events.
      </p>
    </div>

    <!-- Meta CAPI card -->
    <SectionCard
      title="Meta Conversions API (CAPI)"
      subtitle="Server-side tracking para Meta Pixel — recupera ~30% de la data perdida por ITP/ad-blockers">
      <template #actions>
        <span v-if="status.meta" class="rounded-full bg-teal/10 px-3 py-1 text-[10px] font-extrabold uppercase text-teal">Configurado</span>
        <span v-else class="rounded-full bg-surface px-3 py-1 text-[10px] font-extrabold uppercase text-text-muted">Sin configurar</span>
      </template>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Pixel ID</label>
          <input v-model="form.metaPixelId" type="text" spellcheck="false" autocomplete="new-password"
            placeholder="123456789012345"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
          <p class="mt-1 text-[10px] text-text-muted">Lo sacás de Meta Business Manager → Events Manager → Data Sources → tu Pixel.</p>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
            Conversions API Token
            <span v-if="status.metaToken" class="ml-1 text-teal">· ya configurado</span>
          </label>
          <input v-model="form.metaCapiToken" type="password" spellcheck="false" autocomplete="new-password"
            :placeholder="status.metaToken ? '•••••••• (vacío = mantener actual)' : 'EAAG... (long-lived access token)'"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-mono focus:border-navy focus:outline-none">
          <p class="mt-1 text-[10px] text-text-muted">Generá un token en Events Manager → Settings → Conversions API → "Generate Access Token".</p>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
            Test Event Code <span class="font-normal lowercase">(opcional, solo dev/staging)</span>
          </label>
          <input v-model="form.metaTestEventCode" type="text" spellcheck="false" autocomplete="off"
            placeholder="TEST12345"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-mono focus:border-navy focus:outline-none">
          <p class="mt-1 text-[10px] text-text-muted">Mientras esté seteado, los fires van a Meta Events Manager → Test Events (NO cuentan como conversión real).</p>
        </div>
        <button @click="saveMeta" :disabled="savingMeta"
          class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
          {{ savingMeta ? 'Guardando…' : 'Guardar Meta' }}
        </button>
      </div>
    </SectionCard>

    <!-- GA4 card -->
    <SectionCard
      title="Google Analytics 4 — Measurement Protocol v2"
      subtitle="Server-side tracking para GA4 — fires 'purchase' desde el backend al confirmar la reserva">
      <template #actions>
        <span v-if="status.ga4" class="rounded-full bg-teal/10 px-3 py-1 text-[10px] font-extrabold uppercase text-teal">Configurado</span>
        <span v-else class="rounded-full bg-surface px-3 py-1 text-[10px] font-extrabold uppercase text-text-muted">Sin configurar</span>
      </template>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Measurement ID</label>
          <input v-model="form.ga4MeasurementId" type="text" spellcheck="false" autocomplete="off"
            placeholder="G-ABCDEF1234"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-mono focus:border-navy focus:outline-none">
          <p class="mt-1 text-[10px] text-text-muted">Admin → Data Streams → tu stream web → "Measurement ID".</p>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
            API Secret
            <span v-if="status.ga4Secret" class="ml-1 text-teal">· ya configurada</span>
          </label>
          <input v-model="form.ga4ApiSecret" type="password" spellcheck="false" autocomplete="new-password"
            :placeholder="status.ga4Secret ? '•••••••• (vacío = mantener actual)' : 'abc123DEF456...'"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-mono focus:border-navy focus:outline-none">
          <p class="mt-1 text-[10px] text-text-muted">Admin → Data Streams → "Measurement Protocol API secrets" → create. Requiere GA4 property.</p>
        </div>
        <button @click="saveGa4" :disabled="savingGa4"
          class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
          {{ savingGa4 ? 'Guardando…' : 'Guardar GA4' }}
        </button>
      </div>
    </SectionCard>

    <!-- Enhanced Conversions info card -->
    <SectionCard
      title="Enhanced Conversions (hashed PII)"
      subtitle="Hash SHA256 de email y teléfono antes de mandarlos a Meta — cumple TOS y LGDP/GDPR">
      <div class="space-y-3 text-[12px] text-text-secondary leading-relaxed">
        <p>
          Para atribuir conversiones a usuarios reales sin violar TOS de Meta, los campos <code>email</code> y
          <code>phone</code> del huésped se normalizan (trim + lowercase / sacar espacios y <code>+</code>) y se
          hashean con <strong>SHA256 en hex lowercase</strong> ANTES de mandarlos a Meta CAPI.
        </p>
        <p>
          Solo se mandan los hashes si el huésped marca el checkbox de consentimiento marketing en el checkout
          (<code>reservations.marketingAccepted</code>). Sin opt-in, el evento Purchase se dispara igual pero
          con <code>user_data</code> vacío (cuenta la conversión, sin atribuir a un usuario específico).
        </p>
        <p class="rounded-xl bg-surface p-3 text-[11px]">
          <strong>Importante:</strong> el <code>event_id</code> = reservationId se usa para deduplicar el fire
          server-side con el fire client-side del Meta Pixel (si lo instalás en el widget). Meta cuenta 1 evento,
          no 2.
        </p>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { ConfigService } from '@/services/Platform.service'
import { ServerTrackingService, type TestFireResult } from '@/services/ServerTracking.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()

/** Tailwind class por status del fire (spec.md statuses). */
function statusBadgeClass(status: 'pending' | 'sent' | 'failed' | 'skipped'): string {
  switch (status) {
    case 'sent': return 'bg-teal/10 text-teal'
    case 'failed': return 'bg-danger/10 text-danger'
    case 'skipped': return 'bg-surface text-text-muted'
    default: return 'bg-cyan/10 text-navy'
  }
}

/** Estado "configurado / sin configurar" leído de configuration. Solo booleanos —
 *  NUNCA traemos el valor crudo de un secret al frontend. */
const status = reactive({
  meta: false,
  metaToken: false,
  metaTestCode: false,
  ga4: false,
  ga4Secret: false,
})

/** Form draft. Los secrets arrancan vacíos: si el usuario no completa, no se pisan. */
const form = reactive({
  metaPixelId: '',
  metaCapiToken: '',
  metaTestEventCode: '',
  ga4MeasurementId: '',
  ga4ApiSecret: '',
})

async function loadStatus() {
  // Lee presencia (no valor) de cada key. Si la key existe y tiene valor no-vacío → true.
  const checks: Array<[keyof typeof status, string]> = [
    ['meta', 'meta_pixel_id'],
    ['metaToken', 'meta_capi_token'],
    ['metaTestCode', 'meta_test_event_code'],
    ['ga4', 'ga4_measurement_id'],
    ['ga4Secret', 'ga4_api_secret'],
  ]
  for (const [field, key] of checks) {
    try {
      const v = await ConfigService.get(key)
      status[field] = v != null && String(v).trim() !== ''
    } catch { /* sin configuration init → false */ }
  }
  // No-secret values se cargan al form para edición (pixel_id, test_code, measurement_id).
  try { form.metaPixelId = String(await ConfigService.get('meta_pixel_id') ?? '') } catch {}
  try { form.metaTestEventCode = String(await ConfigService.get('meta_test_event_code') ?? '') } catch {}
  try { form.ga4MeasurementId = String(await ConfigService.get('ga4_measurement_id') ?? '') } catch {}
}

const savingMeta = ref(false)
async function saveMeta() {
  savingMeta.value = true
  try {
    if (form.metaPixelId.trim()) {
      await ConfigService.set('meta_pixel_id', form.metaPixelId.trim())
    }
    if (form.metaCapiToken.trim()) {
      await ConfigService.set('meta_capi_token', form.metaCapiToken.trim())
      form.metaCapiToken = '' // limpiar después de guardar (no dejar el secret en el form)
    }
    // Test code es opcional — si vacío, limpiar el valor guardado.
    if (form.metaTestEventCode.trim()) {
      await ConfigService.set('meta_test_event_code', form.metaTestEventCode.trim())
    } else if (status.metaTestCode) {
      await ConfigService.set('meta_test_event_code', '')
    }
    await loadStatus()
    toast.success('Credenciales de Meta guardadas')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    savingMeta.value = false
  }
}

const savingGa4 = ref(false)
async function saveGa4() {
  savingGa4.value = true
  try {
    if (form.ga4MeasurementId.trim()) {
      await ConfigService.set('ga4_measurement_id', form.ga4MeasurementId.trim())
    }
    if (form.ga4ApiSecret.trim()) {
      await ConfigService.set('ga4_api_secret', form.ga4ApiSecret.trim())
      form.ga4ApiSecret = ''
    }
    await loadStatus()
    toast.success('Credenciales de GA4 guardadas')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    savingGa4.value = false
  }
}

const testing = ref(false)
const testResult = ref<TestFireResult | null>(null)
async function sendTestEvent() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await ServerTrackingService.testFire()
    const both = testResult.value
    if (both.meta.status === 'sent' && both.ga4.status === 'sent') {
      toast.success('Test event enviado a Meta y GA4')
    } else if (both.meta.status === 'skipped' && both.ga4.status === 'skipped') {
      toast.info('Sin creds configuradas — guardá Pixel ID + Token y/o Measurement ID + API Secret antes de testear')
    } else {
      toast.info('Test parcial — revisá el resultado por externo')
    }
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo enviar el test event')
  } finally {
    testing.value = false
  }
}

const hasTestFailure = computed(() => {
  if (!testResult.value) return false
  return testResult.value.meta.status === 'failed' || testResult.value.ga4.status === 'failed'
})

onMounted(loadStatus)
</script>

<style scoped>
/* Intencionalmente vacío: los estilos viven en el design system global (Tailwind). */
</style>
