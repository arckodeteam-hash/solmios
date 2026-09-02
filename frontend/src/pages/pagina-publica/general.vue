<template>
  <!--
    General de la Página pública — extraído de settings/index.vue (tab «public», F0 0.21
    solmi-direct-booking). Ahora vive en su propia sección del menú lateral. Configura:
      • Slug estable (URL pública /h/:slug) con availability check en vivo.
      • Título + descripción por idioma (ES base en descriptionJson, EN/PT en
        descriptionTranslations).
      • Amenities del hotel (nivel hotel — distinto de RoomAmenities).
      • Flags de reseñas públicas (publishReviewScore / publishReviewComments).
    Persiste vía SettingsService.patchHotel (PUT /api/settings/hotel), igual que antes
    lo hacía saveAll() de settings — acá con su propio botón "Guardar".
  -->
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Página pública</h2>
        <p class="text-sm text-text-muted mt-0.5">
          Configuración de la landing pública <code class="px-1 bg-surface rounded">/h/:slug</code>,
          traducciones y reseñas que ven los huéspedes.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="isDirty" class="text-[11px] font-bold text-warning">Cambios sin guardar</span>
        <button @click="save" :disabled="saving"
          class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-6">
      <div v-for="i in 4" :key="i" class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
        <div class="h-14 bg-navy animate-pulse"></div>
        <div class="p-5 space-y-3">
          <div class="h-10 bg-surface rounded-xl animate-pulse"></div>
          <div class="h-10 bg-surface rounded-xl animate-pulse"></div>
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Slug editable + availability check -->
      <SectionCard title="URL pública"
        subtitle="Slug estable que identifica tu hotel en la landing pública /h/:slug">
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Slug</label>
            <div class="flex items-center rounded-xl border bg-surface overflow-hidden focus-within:bg-white transition-colors"
              :class="slugInputBorder">
              <span class="pl-4 pr-2 text-sm font-bold text-text-muted select-none">/h/</span>
              <input v-model="slugDraft" type="text" spellcheck="false" autocomplete="off"
                placeholder="mi-hotel"
                class="flex-1 bg-transparent border-0 px-0 py-2.5 pr-3 text-sm font-bold text-navy focus:outline-none"
                :disabled="saving">
            </div>
            <p class="mt-2 text-[10px] text-text-muted">
              URL pública:
              <span class="font-bold text-navy">/h/{{ slugDraft || 'mi-hotel' }}</span>
            </p>
          </div>
          <span class="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap self-end mb-1"
            :class="slugBadgeClass">
            <span v-if="slugBadgeIcon" class="w-3 h-3 shrink-0" v-html="slugBadgeIcon"></span>
            {{ slugBadgeText }}
          </span>
        </div>
        <div class="mt-4 p-3 rounded-xl bg-surface text-[11px] text-text-muted leading-relaxed">
          Solo minúsculas, números y guiones. Editar el <strong>nombre</strong> del hotel NO cambia
          el slug (es estable). La verificación de disponibilidad es en tiempo real contra el
          endpoint público — si no podés guardar, el slug ya lo tiene otro hotel.
        </div>
      </SectionCard>

      <!-- Traducciones públicas (title + description) — ES/EN/PT -->
      <SectionCard title="Título y descripción por idioma"
        subtitle="Copy que ven los huéspedes en la landing pública y en el widget de reserva">
        <div class="flex flex-wrap gap-2 mb-4">
          <button v-for="lang in publicLangs" :key="lang.code" @click="activePublicLang = lang.code"
            class="px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer"
            :class="activePublicLang === lang.code ? 'bg-navy text-white' : 'bg-surface text-text-secondary hover:bg-navy/5'">
            <span>{{ lang.code.toUpperCase() }}</span>
            <span v-if="hasPublicTranslation(lang.code)" class="ml-1 text-teal">●</span>
          </button>
        </div>

        <!-- ES persiste en descriptionJson = {title, description} (base pública, D7).
             EN/PT persisten en descriptionTranslations[lang] = {title, description}.
             Mismo shape en los 3 idiomas — un solo bloque. -->
        <div class="space-y-4">
          <div>
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Título ({{ activePublicLang.toUpperCase() }})
            </label>
            <input v-model="publicDesc[activePublicLang].title" type="text"
              :placeholder="activePublicLang === 'es' ? 'Tu próximo destino' : `Hotel title in ${activePublicLang === 'en' ? 'English' : 'Português'}...`"
              class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:outline-none focus:border-navy">
          </div>
          <div>
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Descripción ({{ activePublicLang.toUpperCase() }})
            </label>
            <textarea v-model="publicDesc[activePublicLang].description" rows="6"
              :placeholder="activePublicLang === 'es' ? 'Descripción del hotel en español — aparece en la landing pública' : `Hotel description in ${activePublicLang === 'en' ? 'English' : 'Português'}...`"
              class="w-full rounded-xl border border-border px-4 py-3 text-sm focus:outline-none focus:border-navy resize-y"></textarea>
            <p class="mt-1 text-[10px] text-text-muted">
              {{ (publicDesc[activePublicLang].description || '').length }} / 2000 caracteres
            </p>
          </div>
        </div>
      </SectionCard>

      <!-- Amenities del hotel (catálogo fijo, nivel hotel — DISTINTO de RoomAmenities) -->
      <SectionCard title="Amenities del hotel"
        subtitle="Servicios e instalaciones del hotel que se muestran en la landing pública">
        <div class="flex flex-wrap gap-2">
          <button v-for="a in HOTEL_AMENITY_CATALOG" :key="a.key" type="button"
            @click="toggleHotelAmenity(a.key)"
            class="px-3 py-2 rounded-full text-sm font-bold transition-all cursor-pointer border"
            :class="selectedHotelAmenities.includes(a.key)
              ? 'bg-navy text-white border-navy'
              : 'bg-white text-text-secondary border-border hover:border-navy/40'">
            <span class="mr-1 inline-block w-3.5 h-3.5 align-[-2px]" v-html="amenityIcon(a.key)"></span>{{ a.label }}
          </button>
        </div>
        <p class="mt-3 text-[10px] text-text-muted">
          {{ selectedHotelAmenities.length }} seleccionado{{ selectedHotelAmenities.length === 1 ? '' : 's' }}.
          Las amenities a nivel habitación (TV, WiFi en cuarto, etc.) se configuran en
          <strong>Configuración → Amenities</strong>.
        </p>
      </SectionCard>

      <!-- Flags: qué se publica de las reseñas -->
      <SectionCard title="Reseñas públicas"
        subtitle="Controlá qué información de reseñas ven los huéspedes en la landing pública">
        <div class="space-y-3">
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div>
              <div class="text-sm font-bold text-navy">Publicar puntuación</div>
              <div class="text-[10px] text-text-muted">Muestra el score agregado (0-5) en la landing.</div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="reviewFlags.publishReviewScore" type="checkbox" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div>
              <div class="text-sm font-bold text-navy">Publicar comentarios</div>
              <div class="text-[10px] text-text-muted">Muestra el texto de las reseñas (no solo el score).</div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="reviewFlags.publishReviewComments" type="checkbox" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>
        </div>
      </SectionCard>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import SectionCard from '@/components/ui/SectionCard.vue'
import { SettingsService, type HotelFull } from '@/services/Settings.service'
import { PublicHotelService } from '@/services/PublicHotel.service'
import { useToast } from '@/composables/useToast'
import { warnOnUnsavedChanges } from '@/composables/useFieldValidation'
import { amenityIcon, HOTEL_AMENITY_CATALOG, ICON_CHECK, ICON_X_CIRCLE } from '@/components/landing/landing-icons'

const publicLangs = [
  { code: 'es' },
  { code: 'en' },
  { code: 'pt' },
] as const

type PublicLangCode = 'es' | 'en' | 'pt'
type PublicTranslation = { title: string; description: string }
type PublicTranslations = Record<PublicLangCode, PublicTranslation>

const toast = useToast()
const loading = ref(true)
const saving = ref(false)

const activePublicLang = ref<PublicLangCode>('es')

const slugDraft = ref('')
const originalSlug = ref('')
const SLUG_REGEX = /^[a-z0-9-]+$/
type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'self' | 'invalid' | 'error'
const slugStatus = ref<SlugStatus>('idle')

const publicDesc = ref<PublicTranslations>({
  es: { title: '', description: '' },
  en: { title: '', description: '' },
  pt: { title: '', description: '' },
})

const selectedHotelAmenities = ref<string[]>([])

const reviewFlags = reactive({ publishReviewScore: false, publishReviewComments: false })

function hasPublicTranslation(lang: string): boolean {
  const t = publicDesc.value[lang as PublicLangCode]
  return !!(t && ((t.title || '').trim() || (t.description || '').trim()))
}

function toggleHotelAmenity(key: string) {
  if (selectedHotelAmenities.value.includes(key)) {
    selectedHotelAmenities.value = selectedHotelAmenities.value.filter(k => k !== key)
  } else {
    selectedHotelAmenities.value = [...selectedHotelAmenities.value, key]
  }
}

const slugInputBorder = computed(() => {
  switch (slugStatus.value) {
    case 'invalid': return 'border-danger'
    case 'taken': return 'border-danger'
    case 'available': return 'border-teal'
    case 'self': return 'border-teal'
    case 'checking': return 'border-cyan'
    default: return 'border-border focus-within:border-navy/40'
  }
})

const slugBadgeClass = computed(() => {
  switch (slugStatus.value) {
    case 'invalid': return 'bg-danger/10 text-danger'
    case 'taken': return 'bg-danger/10 text-danger'
    case 'available': return 'bg-teal/10 text-teal'
    case 'self': return 'bg-teal/10 text-teal'
    case 'checking': return 'bg-cyan/10 text-navy'
    case 'error': return 'bg-warning/10 text-warning'
    default: return 'bg-surface text-text-muted'
  }
})

const slugBadgeText = computed(() => {
  switch (slugStatus.value) {
    case 'invalid': return 'Formato inválido'
    case 'taken': return 'No disponible'
    case 'available': return 'Disponible'
    case 'self': return 'Tu slug actual'
    case 'checking': return 'Verificando…'
    case 'error': return 'No se pudo verificar'
    default: return originalSlug.value ? 'Sin cambios' : 'Pendiente'
  }
})

const slugBadgeIcon = computed(() => {
  switch (slugStatus.value) {
    case 'taken': return ICON_X_CIRCLE
    case 'available':
    case 'self': return ICON_CHECK
    default: return ''
  }
})

/**
 * Availability check del slug contra el endpoint público. 200 + id distinto → tomado;
 * 404 → disponible. Debounce 500ms para no agotar el rate-limit.
 * NOTA: hasta F0 0.4 el endpoint /api/public/hotel/:slug es un stub (devuelve 200 con
 * datos falsos). El código queda correcto para cuando F0 0.4 se implemente.
 */
let slugCheckTimer: ReturnType<typeof setTimeout> | null = null
async function checkSlugAvailability(slug: string) {
  const trimmed = slug.trim()
  if (!trimmed) { slugStatus.value = 'idle'; return }
  if (!SLUG_REGEX.test(trimmed)) { slugStatus.value = 'invalid'; return }
  if (trimmed === originalSlug.value) { slugStatus.value = 'self'; return }

  slugStatus.value = 'checking'
  try {
    const data = await PublicHotelService.getBySlug(trimmed)
    slugStatus.value = data?.id && hotelId && data.id === hotelId ? 'self' : 'taken'
  } catch (e) {
    const err = e as { status?: number }
    slugStatus.value = err?.status === 404 ? 'available' : 'error'
  }
}

watch(slugDraft, (val) => {
  if (slugCheckTimer) clearTimeout(slugCheckTimer)
  if (!val || !val.trim()) { slugStatus.value = 'idle'; return }
  slugCheckTimer = setTimeout(() => { void checkSlugAvailability(val) }, 500)
})

let hotelId = ''

onMounted(async () => {
  try {
    const s = await SettingsService.get()
    const h = s.hotel as HotelFull & Record<string, unknown>
    hotelId = (h.id as string) || ''

    slugDraft.value = (h.slug as string) || ''
    originalSlug.value = (h.slug as string) || ''
    slugStatus.value = (h.slug as string) ? 'self' : 'idle'

    selectedHotelAmenities.value = Array.isArray(h.amenities) ? [...(h.amenities as string[])] : []

    reviewFlags.publishReviewScore = h.publishReviewScore === 1 || h.publishReviewScore === true
    reviewFlags.publishReviewComments = h.publishReviewComments === 1 || h.publishReviewComments === true

    // descriptionJson: base pública en español, {title, description} (spec public-hotel-info
    // D7). Defensivo con el shape viejo (mapa {es,en,fr,...} de la extinta "Descripción
    // Multilingüe" de Configuración): si no hay title/description pero sí `.es` string,
    // se recupera como descripción inicial (se re-guarda en el shape nuevo al primer save).
    let esBase: { title?: string; description?: string } = {}
    try {
      const raw = h.descriptionJson
      const parsed = typeof raw === 'string' && raw.startsWith('{')
        ? JSON.parse(raw) : (raw && typeof raw === 'object' ? raw : {})
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.title === 'string' || typeof parsed.description === 'string') {
          esBase = { title: parsed.title, description: parsed.description }
        } else if (typeof parsed.es === 'string') {
          esBase = { description: parsed.es }
        }
      }
    } catch { /* esBase queda vacío */ }

    const dt = (h.descriptionTranslations && typeof h.descriptionTranslations === 'object')
      ? h.descriptionTranslations as Record<string, { title?: string; description?: string }>
      : {}
    publicDesc.value = {
      es: { title: esBase.title || '', description: esBase.description || '' },
      en: { title: (dt.en?.title as string) || '', description: (dt.en?.description as string) || '' },
      pt: { title: (dt.pt?.title as string) || '', description: (dt.pt?.description as string) || '' },
    }
  } catch {
    toast.error('Error al cargar los datos de la página pública')
  } finally {
    loading.value = false
    await nextTick()
    markClean()
  }
})

// ─── Cambios sin guardar ─────────────────────────────────────────────────────
const savedSnapshot = ref('')
function snapshot(): string {
  return JSON.stringify({
    slugDraft: slugDraft.value, selectedHotelAmenities: selectedHotelAmenities.value,
    publicDesc: publicDesc.value, reviewFlags,
  })
}
function markClean() { savedSnapshot.value = snapshot() }
const isDirty = computed(() => savedSnapshot.value !== '' && snapshot() !== savedSnapshot.value)

onBeforeRouteLeave(() => {
  if (!isDirty.value) return true
  return window.confirm('Tenés cambios sin guardar en la página pública. ¿Salir y descartarlos?')
})
let stopUnloadWarning: (() => void) | null = null
onMounted(() => { stopUnloadWarning = warnOnUnsavedChanges(() => isDirty.value) })
onUnmounted(() => { stopUnloadWarning?.() })

async function save() {
  if (saving.value) return
  const trimmedSlug = slugDraft.value.trim()
  if (trimmedSlug && !SLUG_REGEX.test(trimmedSlug)) {
    toast.error('El slug solo puede tener minúsculas, números y guiones')
    return
  }

  saving.value = true
  try {
    // descriptionJson: base pública en español, {title, description} (spec public-hotel-info D7).
    const esOut: { title?: string; description?: string } = {
      title: (publicDesc.value.es.title || '').trim() || undefined,
      description: (publicDesc.value.es.description || '').trim() || undefined,
    }

    // descriptionTranslations: nunca incluye 'es'. Solo EN/PT con data, descarta vacíos.
    const dtOut: Record<string, { title?: string; description?: string }> = {}
    for (const code of ['en', 'pt'] as const) {
      const t = publicDesc.value[code]
      if ((t.title || '').trim() || (t.description || '').trim()) {
        dtOut[code] = {
          title: (t.title || '').trim() || undefined,
          description: (t.description || '').trim() || undefined,
        }
      }
    }

    const patch: Record<string, unknown> = {
      // publishReviewComments FALTABA en el keys[] de saveAll de settings (descarte
      // silencioso — anti-patrón ORM documentado). Acá se persiste siempre.
      publishReviewScore: reviewFlags.publishReviewScore,
      publishReviewComments: reviewFlags.publishReviewComments,
      amenities: selectedHotelAmenities.value,
      descriptionTranslations: dtOut,
      descriptionJson: JSON.stringify(esOut),
    }
    if (trimmedSlug) patch.slug = trimmedSlug

    const updated = await SettingsService.patchHotel(patch)
    if (trimmedSlug) originalSlug.value = trimmedSlug
    // Refresca descriptionTranslations desde el backend (por si descartó keys vacías).
    if (updated?.descriptionTranslations && typeof updated.descriptionTranslations === 'object') {
      const dt = updated.descriptionTranslations as Record<string, { title?: string; description?: string }>
      publicDesc.value.en = { title: dt.en?.title || '', description: dt.en?.description || '' }
      publicDesc.value.pt = { title: dt.pt?.title || '', description: dt.pt?.description || '' }
    }
    markClean()
    toast.success('Página pública guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
</style>
