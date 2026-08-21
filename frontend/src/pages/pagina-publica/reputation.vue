<template>
  <!--
    ReputationSettings — pestaña del admin (F3 3.5, solmi-direct-booking / reputation-aggregator).
    Configura las creds de las 3 fuentes de reseñas externas (Google Business Profile,
    TripAdvisor, StayAPI para Booking/Airbnb/Expedia). Las creds persisten en la tabla
    `configuration` vía ConfigService (keys `gbp_place_id`, `tripadvisor_api_key`, etc.).
    Botón "Sync now" dispara el pull manualmente (POST /api/external-reviews/sync-now) para
    ver cuántas reviews nuevas entraron tras guardar creds.
    Spec: reputation-aggregator/spec.md:96-110. Secrets NO se renderizan (password-like).
  -->
  <div class="space-y-5">
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Reputación externa</h2>
        <p class="text-sm text-text-muted mt-0.5">
          Conectá Google, TripAdvisor y StayAPI para importar reseñas y mostrarlas en la landing pública.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="lastSyncLabel" class="text-[11px] font-bold text-text-muted">
          {{ lastSyncLabel }}
        </span>
        <button
          @click="syncNow"
          :disabled="syncing"
          class="rounded-full bg-navy px-5 py-2 text-sm font-extrabold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ syncing ? 'Sincronizando…' : 'Sync now' }}
        </button>
      </div>
    </div>

    <!-- Sync result banner -->
    <div
      v-if="syncResult"
      class="rounded-2xl border p-4 text-sm"
      :class="syncResult.errors.length ? 'border-warning/30 bg-warning/5' : 'border-teal/30 bg-teal/5'"
    >
      <p class="font-bold text-navy">
        <template v-if="syncResult.noCreds">
          El hotel no tiene creds configuradas — nada que sincronizar.
        </template>
        <template v-else>
          Sincronización completa: {{ syncResult.inserted }} nuevas, {{ syncResult.updated }} actualizadas.
        </template>
      </p>
      <p v-if="syncResult.skippedSources > 0" class="mt-1 text-[11px] text-text-muted">
        {{ syncResult.skippedSources }} fuente(s) skipeada(s) (API caída o creds mal).
      </p>
      <ul v-if="syncResult.errors.length" class="mt-2 list-disc pl-5 text-[11px] text-danger">
        <li v-for="(e, i) in syncResult.errors" :key="i">{{ e }}</li>
      </ul>
    </div>

    <!-- GBP card -->
    <SectionCard
      title="Google Business Profile"
      subtitle="OAuth2 con service account — gratis, rate limit holgado (200k/día)">
      <template #actions>
        <span v-if="status.gbp" class="rounded-full bg-teal/10 px-3 py-1 text-[10px] font-extrabold uppercase text-teal">Configurado</span>
        <span v-else class="rounded-full bg-surface px-3 py-1 text-[10px] font-extrabold uppercase text-text-muted">Sin configurar</span>
      </template>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Place ID</label>
          <input v-model="form.gbpPlaceId" type="text" spellcheck="false" autocomplete="off"
            placeholder="accounts/123/locations/456"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
          <p class="mt-1 text-[10px] text-text-muted">Identificador del negocio en GBP. Lo sacás de Google Business Profile → ubicación.</p>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
            Service Account JSON
            <span v-if="status.gbpSA" class="ml-1 text-teal">· ya configurado</span>
          </label>
          <textarea v-model="form.gbpServiceAccount" rows="4" spellcheck="false"
            :placeholder="gbpSaPlaceholder"
            class="w-full rounded-xl border border-border px-4 py-2.5 font-mono text-xs focus:border-navy focus:outline-none resize-y"></textarea>
          <p class="mt-1 text-[10px] text-text-muted">
            Pegá el JSON completo del service account (con <code>clientEmail</code> y <code>privateKey</code>).
            Se guarda en configuration y no se vuelve a mostrar por seguridad.
          </p>
        </div>
        <button @click="saveGbp" :disabled="savingGbp"
          class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
          {{ savingGbp ? 'Guardando…' : 'Guardar Google' }}
        </button>
      </div>
    </SectionCard>

    <!-- TripAdvisor card -->
    <SectionCard
      title="TripAdvisor Content API"
      subtitle="API key + location ID — 500 req/día, requiere backlink en la landing">
      <template #actions>
        <span v-if="status.tripadvisor" class="rounded-full bg-teal/10 px-3 py-1 text-[10px] font-extrabold uppercase text-teal">Configurado</span>
        <span v-else class="rounded-full bg-surface px-3 py-1 text-[10px] font-extrabold uppercase text-text-muted">Sin configurar</span>
      </template>
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              API Key
              <span v-if="status.tripadvisorApiKey" class="ml-1 text-teal">· ya configurada</span>
            </label>
            <input v-model="form.tripadvisorApiKey" type="password" spellcheck="false" autocomplete="new-password"
              :placeholder="status.tripadvisorApiKey ? '•••••••• (vacío = mantener actual)' : 'ta-key-xxxxxxx'"
              class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Location ID</label>
            <input v-model="form.tripadvisorLocationId" type="text" spellcheck="false" autocomplete="off"
              placeholder="1234567"
              class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
          </div>
        </div>
        <p class="flex items-start gap-2 rounded-xl bg-surface p-3 text-[10px] text-text-muted leading-relaxed">
          <span class="w-3.5 h-3.5 shrink-0 mt-px text-warning" v-html="ICON_WARNING"></span>
          <span>Si activás TripAdvisor, la landing debe mostrar "Reviews by TripAdvisor" con link a la página oficial.
          TripAdvisor puede suspender la key si no hay backlink.</span>
        </p>
        <button @click="saveTripadvisor" :disabled="savingTripadvisor"
          class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
          {{ savingTripadvisor ? 'Guardando…' : 'Guardar TripAdvisor' }}
        </button>
      </div>
    </SectionCard>

    <!-- StayAPI card -->
    <SectionCard
      title="StayAPI (Booking / Airbnb / Expedia)"
      subtitle="Agregador de OTAs — mapeá cada property ID. €0-35/mes según plan">
      <template #actions>
        <span v-if="status.stayapi" class="rounded-full bg-teal/10 px-3 py-1 text-[10px] font-extrabold uppercase text-teal">Configurado</span>
        <span v-else class="rounded-full bg-surface px-3 py-1 text-[10px] font-extrabold uppercase text-text-muted">Sin configurar</span>
      </template>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
            API Key
            <span v-if="status.stayapiApiKey" class="ml-1 text-teal">· ya configurada</span>
          </label>
          <input v-model="form.stayapiApiKey" type="password" spellcheck="false" autocomplete="new-password"
            :placeholder="status.stayapiApiKey ? '•••••••• (vacío = mantener actual)' : 'stay-xxxxxxx'"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Booking property ID</label>
            <input v-model="form.stayapiBookingId" type="text" spellcheck="false" autocomplete="off"
              placeholder="1234567"
              class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none">
          </div>
          <div>
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Airbnb listing ID</label>
            <input v-model="form.stayapiAirbnbId" type="text" spellcheck="false" autocomplete="off"
              placeholder="abc-123"
              class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none">
          </div>
          <div>
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Expedia property ID</label>
            <input v-model="form.stayapiExpediaId" type="text" spellcheck="false" autocomplete="off"
              placeholder="exp-123"
              class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none">
          </div>
        </div>
        <button @click="saveStayapi" :disabled="savingStayapi"
          class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
          {{ savingStayapi ? 'Guardando…' : 'Guardar StayAPI' }}
        </button>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { ConfigService } from '@/services/Platform.service'
import { ExternalReviewsService, type SyncNowResult } from '@/services/ExternalReviews.service'
import { useToast } from '@/composables/useToast'
import { ICON_WARNING } from '@/components/landing/landing-icons'

const toast = useToast()

/** Estado "configurado / sin configurar" leído de configuration. Solo booleanos —
 *  NUNCA traemos el valor crudo de un secret al frontend. */
const status = reactive({
  gbp: false,
  gbpSA: false,
  tripadvisor: false,
  tripadvisorApiKey: false,
  stayapi: false,
  stayapiApiKey: false,
})

/** Form draft. Los secrets arrancan vacíos: si el usuario no completa, no se pisan. */
const form = reactive({
  gbpPlaceId: '',
  gbpServiceAccount: '',
  tripadvisorApiKey: '',
  tripadvisorLocationId: '',
  stayapiApiKey: '',
  stayapiBookingId: '',
  stayapiAirbnbId: '',
  stayapiExpediaId: '',
})

async function loadStatus() {
  // Lee presencia (no valor) de cada key. Si la key existe y tiene valor no-vacío → true.
  const checks: Array<[keyof typeof status, string]> = [
    ['gbp', 'gbp_place_id'],
    ['gbpSA', 'gbp_service_account'],
    ['tripadvisorApiKey', 'tripadvisor_api_key'],
    ['tripadvisor', 'tripadvisor_location_id'],
    ['stayapiApiKey', 'stayapi_api_key'],
  ]
  for (const [field, key] of checks) {
    try {
      const v = await ConfigService.get(key)
      status[field] = v != null && String(v).trim() !== ''
    } catch { /* sin configuration init → false */ }
  }
  // StayAPI status = al menos un OTA mapeado O apiKey.
  try {
    const ids = await ConfigService.get('stayapi_hotel_ids') as Record<string, string> | null
    status.stayapi = !!(ids && typeof ids === 'object' && Object.values(ids).some(v => v && String(v).trim()))
  } catch { /* ignore */ }
  // No-secret values se cargan al form para edición (place_id, location_id, OTA ids).
  try { form.gbpPlaceId = String(await ConfigService.get('gbp_place_id') ?? '') } catch {}
  try { form.tripadvisorLocationId = String(await ConfigService.get('tripadvisor_location_id') ?? '') } catch {}
  try {
    const ids = await ConfigService.get('stayapi_hotel_ids') as Record<string, string> | null
    if (ids && typeof ids === 'object') {
      form.stayapiBookingId = String(ids.booking ?? '')
      form.stayapiAirbnbId = String(ids.airbnb ?? '')
      form.stayapiExpediaId = String(ids.expedia ?? '')
    }
  } catch {}
}

const savingGbp = ref(false)
async function saveGbp() {
  savingGbp.value = true
  try {
    if (form.gbpPlaceId.trim()) {
      await ConfigService.set('gbp_place_id', form.gbpPlaceId.trim())
    }
    // Solo se actualiza el service account si el usuario pegó uno nuevo.
    const sa = form.gbpServiceAccount.trim()
    if (sa) {
      try { JSON.parse(sa) } catch { toast.error('El JSON del service account no es válido'); return }
      await ConfigService.set('gbp_service_account', sa)
      form.gbpServiceAccount = ''
    }
    await loadStatus()
    toast.success('Credenciales de Google guardadas')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    savingGbp.value = false
  }
}

const savingTripadvisor = ref(false)
async function saveTripadvisor() {
  savingTripadvisor.value = true
  try {
    if (form.tripadvisorLocationId.trim()) {
      await ConfigService.set('tripadvisor_location_id', form.tripadvisorLocationId.trim())
    }
    if (form.tripadvisorApiKey.trim()) {
      await ConfigService.set('tripadvisor_api_key', form.tripadvisorApiKey.trim())
      form.tripadvisorApiKey = ''
    }
    await loadStatus()
    toast.success('Credenciales de TripAdvisor guardadas')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    savingTripadvisor.value = false
  }
}

const savingStayapi = ref(false)
async function saveStayapi() {
  savingStayapi.value = true
  try {
    if (form.stayapiApiKey.trim()) {
      await ConfigService.set('stayapi_api_key', form.stayapiApiKey.trim())
      form.stayapiApiKey = ''
    }
    // Mapeo de OTAs — solo las que tienen valor.
    const ids: Record<string, string> = {}
    if (form.stayapiBookingId.trim()) ids.booking = form.stayapiBookingId.trim()
    if (form.stayapiAirbnbId.trim()) ids.airbnb = form.stayapiAirbnbId.trim()
    if (form.stayapiExpediaId.trim()) ids.expedia = form.stayapiExpediaId.trim()
    await ConfigService.set('stayapi_hotel_ids', ids)
    await loadStatus()
    toast.success('Credenciales de StayAPI guardadas')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    savingStayapi.value = false
  }
}

const syncing = ref(false)
const syncResult = ref<SyncNowResult | null>(null)
async function syncNow() {
  syncing.value = true
  syncResult.value = null
  try {
    syncResult.value = await ExternalReviewsService.syncNow()
    if (syncResult.value.inserted > 0) {
      toast.success(`${syncResult.value.inserted} reseña(s) nueva(s) importada(s)`)
    } else if (!syncResult.value.noCreds && syncResult.value.errors.length === 0) {
      toast.info('Sincronización completa — sin reviews nuevas')
    }
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo sincronizar')
  } finally {
    syncing.value = false
  }
}

const lastSyncLabel = computed(() => {
  if (!syncResult.value) return ''
  if (syncResult.value.noCreds) return ''
  const r = syncResult.value
  return `Último sync: ${r.inserted} nuevas · ${r.updated} actualizadas`
})

/** Placeholder del textarea del service account. Si ya está configurado, avisa que dejándolo
 *  vacío NO se pisa el actual; si no, muestra un ejemplo del shape esperado. */
const gbpSaPlaceholder = computed(() =>
  status.gbpSA
    ? '•••••••• (dejá vacío para mantener el actual)'
    : '{ "clientEmail": "sa-name@project.iam.gserviceaccount.com", "privateKey": "-----BEGIN PRIVATE KEY-----\\n..." }',
)

onMounted(loadStatus)
</script>

<style scoped>
/* Intencionalmente vacío: los estilos viven en el design system global (Tailwind). */
</style>
