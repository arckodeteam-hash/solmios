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

      <!-- Identidad pública: tipo de alojamiento, estrellas, logo, sitio web — mudados desde
           Configuración → Hotel (tarea 1.7, docs/wizard-refactor): son públicos según el
           allow-list real de getPublicHotelInfo, no identidad administrativa. -->
      <SectionCard title="Identidad pública"
        subtitle="Lo primero que ve un huésped en tu página — tipo de alojamiento, estrellas, logo y sitio web">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Tipo de alojamiento</label>
            <select v-model="accommodationType" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none cursor-pointer">
              <!-- value = enum del backend (ACCOMMODATION_TYPE_ENUM), label en español. -->
              <option value="">Seleccionar</option>
              <option value="hotel">Hotel</option>
              <option value="apartment">Apartahotel / Apartamento</option>
              <option value="hostel">Hostal</option>
              <option value="villa">Villa / Casa</option>
              <option value="bnb">Bed &amp; Breakfast</option>
            </select>
          </div>
          <div>
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Clasificación</label>
            <select v-model="starRating" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none cursor-pointer">
              <option value="">N/A</option>
              <option value="1">1 Estrella</option>
              <option value="2">2 Estrellas</option>
              <option value="3">3 Estrellas</option>
              <option value="4">4 Estrellas</option>
              <option value="5">5 Estrellas</option>
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Sitio web</label>
            <input v-model="website" type="url" placeholder="https://" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
          </div>
        </div>
        <div class="mt-4 flex items-start gap-4">
          <div
            @dragover.prevent="logoDragging = true"
            @dragleave.prevent="logoDragging = false"
            @drop.prevent="onLogoDrop"
            @click="logoFileInput?.click()"
            class="relative w-28 h-28 rounded-xl border-2 border-dashed overflow-hidden bg-surface flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            :class="logoDragging ? 'border-cyan bg-cyan/5' : 'border-border hover:border-navy/40'">
            <img v-if="logo" :src="logo" alt="Logo" class="w-full h-full object-contain" @error="onLogoImgError" />
            <div v-else class="flex flex-col items-center gap-1 px-2 text-center pointer-events-none">
              <span class="w-5 h-5 text-navy/40" v-html="ICON_UPLOAD"></span>
              <span class="text-[9px] font-bold text-text-muted uppercase">Arrastrá o hacé clic</span>
            </div>
            <div v-if="logoUploading" class="absolute inset-0 bg-white/80 flex items-center justify-center">
              <span class="text-[10px] font-bold text-navy">Subiendo…</span>
            </div>
          </div>
          <input ref="logoFileInput" type="file" accept="image/*" class="hidden" @change="onLogoFileChange">
          <div class="flex-1">
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Logo</label>
            <input v-model="logo" type="url" placeholder="https://ejemplo.com/logo.png" class="w-full px-3 py-2 rounded-lg border border-border text-sm">
            <p class="text-[10px] text-text-muted mt-1">PNG o JPG, máximo 5MB — o pegá la URL de un logo que ya tengas alojado. Se sube apenas lo elegís, sin esperar a "Guardar".</p>
          </div>
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
          Este es un catálogo reducido para destacar en la landing — el catálogo completo
          (35 opciones por categoría, más personalizadas) vive en
          <strong>Configuración → Amenities</strong>; ambos guardan en el mismo lugar.
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
import { HotelService } from '@/services/Hotel.service'
import { useToast } from '@/composables/useToast'
import { warnOnUnsavedChanges } from '@/composables/useFieldValidation'
import { amenityIcon, HOTEL_AMENITY_CATALOG, ICON_CHECK, ICON_X_CIRCLE } from '@/components/landing/landing-icons'

const ICON_UPLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>'

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
// Claves de `hotel_amenities` que NO pertenecen al catálogo de 20 keys de esta pantalla (las
// pone Configuración → Amenities, catálogo de 35 keys con categorías). No las edita esta UI,
// pero hay que reenviarlas en cada save (F1 1.7b) — `saveAmenitiesHotel` REEMPLAZA el set
// completo, así que omitirlas las desactivaría silenciosamente cada vez que se guarda esta página.
let foreignAmenityKeys: string[] = []

const reviewFlags = reactive({ publishReviewScore: false, publishReviewComments: false })

// ─── Identidad pública (tarea 1.7, docs/wizard-refactor) ────────────────────────────────────
// accommodationType/starRating/logo/website son públicos (allow-list de getPublicHotelInfo) —
// se mudaron acá desde Configuración → Hotel.
const accommodationType = ref('')
const starRating = ref('')
const website = ref('')
const logo = ref('')

// Logo — arrastrar/soltar o elegir archivo, con preview. Sube DE UNA (endpoint dedicado, data
// URL base64) en vez de esperar al botón "Guardar" general: mismo patrón que tenía Configuración
// (y que el avatar de usuario). `markLogoClean()` actualiza SOLO la clave `logo` de la foto base
// — un `markClean()` común marcaría como "guardado" cualquier otro cambio pendiente (slug,
// amenities, traducciones) sin haberlo guardado en realidad.
const logoFileInput = ref<HTMLInputElement | null>(null)
const logoDragging = ref(false)
const logoUploading = ref(false)
const LOGO_MAX_BYTES = 5 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

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
    // markLogoClean(): el cache-bust del reintento no es un cambio real del usuario — sin esto,
    // `isDirty` se dispara solo (y con él el aviso de "cambios sin guardar" al navegar) mientras
    // el logo todavía se está recuperando.
    setTimeout(() => { logo.value = `${base}?retry=${Date.now()}`; markLogoClean() }, delay)
    return
  }
  logo.value = ''
  toast.error('No se pudo cargar el logo guardado — volvé a subirlo')
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
    markLogoClean()
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

    // F1 1.7b (D3) — fuente real es `hotel_amenities` (GET /api/amenities/hotel), no la
    // columna JSON `hotels.amenities` (nunca la leía la API pública, ver public-hotel-info.ts).
    const knownKeys = new Set(HOTEL_AMENITY_CATALOG.map((a) => a.key))
    try {
      const { data } = await HotelService.amenitiesHotel()
      const activeKeys = (data || []).map((a) => a.amenityKey)
      selectedHotelAmenities.value = activeKeys.filter((k) => knownKeys.has(k))
      foreignAmenityKeys = activeKeys.filter((k) => !knownKeys.has(k))
    } catch {
      selectedHotelAmenities.value = []
      foreignAmenityKeys = []
    }

    accommodationType.value = (h.accommodationType as string) || ''
    starRating.value = h.starRating != null ? String(h.starRating) : ''
    website.value = (h.website as string) || ''
    logo.value = (h.logo as string) || ''

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
    accommodationType: accommodationType.value, starRating: starRating.value,
    website: website.value, logo: logo.value,
  })
}
function markClean() { savedSnapshot.value = snapshot() }

/** El logo se sube y persiste SOLO (endpoint dedicado, no pasa por `save()`) — ver comentario
 *  arriba de `uploadLogoFile`. Actualiza únicamente `logo` dentro de la foto base, dejando el
 *  resto del diff pendiente intacto (mismo patrón que tenía Configuración). */
function markLogoClean() {
  if (!savedSnapshot.value) return
  try {
    const baseline = JSON.parse(savedSnapshot.value)
    baseline.logo = logo.value
    savedSnapshot.value = JSON.stringify(baseline)
  } catch { /* snapshot no parseable: no debería pasar, no rompe nada dejarlo como estaba */ }
}
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
      descriptionTranslations: dtOut,
      descriptionJson: JSON.stringify(esOut),
      // Identidad pública (tarea 1.7): accommodationType/starRating/website — logo NO va acá,
      // se sube y persiste solo (uploadLogoFile).
      // Vacío se manda TAL CUAL (no `|| undefined`): `patchHotel` descarta claves `undefined`
      // del patch, así que `|| undefined` nunca podría limpiar un valor ya guardado — probado
      // en vivo: elegir "N/A" y guardar dejaba el `starRating` viejo en el backend para siempre.
      accommodationType: accommodationType.value,
      starRating: starRating.value,
      website: website.value.trim(),
    }
    if (trimmedSlug) patch.slug = trimmedSlug

    // F1 1.7b — `hotel_amenities` (tabla real), no la columna JSON `hotels.amenities`. Reenvía
    // `foreignAmenityKeys` (las de Configuración → Amenities) para no pisarlas: `saveAmenitiesHotel`
    // reemplaza el set completo.
    const [updated] = await Promise.all([
      SettingsService.patchHotel(patch),
      HotelService.saveAmenitiesHotel([...selectedHotelAmenities.value, ...foreignAmenityKeys]),
    ])
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
