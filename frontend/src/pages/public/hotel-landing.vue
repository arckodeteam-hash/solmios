<template>
  <!--
    hotel-landing.vue — Orquestador de la landing pública (F1 1.6, solmi-direct-booking / Pieza B).
    Layout `none` (sin header/footer del panel SaaS) — el router tiene meta: { layout: 'none' }
    aunque el App.vue actual no consume el meta (cada página pública arma su propio layout).

    Flujo:
      1. GET /api/public/hotel/:slug            → hotel (PublicHotelInfo). Si 404 → empty state.
      2. En paralelo (Promise.allSettled):
         - GET /api/public/hotels/:slug/landing  → bloques activos ordenados.
         - GET /api/public/hotels/:slug/media    → media (404 tolerable, F0 endpoint futuro).
         - GET /api/public/hotels/:slug/reviews  → reviews (solo si bloque `reviews` activo).
      3. Renderiza cada bloque en `sortOrder`, eligiendo el componente por `type`.
      4. Inyecta JSON-LD (Hotel + AggregateRating + FAQPage) en <head>.

    Cada bloque tiene su propio guard interno; el orquestador además filtra los que no tienen
    data para mostrar (reviews sin reseñas, faq sin items, rooms sin tarifas disponibles, etc.).
  -->
  <div v-if="loading" class="min-h-screen bg-surface flex items-center justify-center">
    <div class="text-center">
      <div class="w-12 h-12 mx-auto mb-4 rounded-full border-4 border-cyan/30 border-t-cyan animate-spin" />
      <p class="text-sm text-text-muted font-bold">Cargando…</p>
    </div>
  </div>

  <div v-else-if="error || !hotel" class="min-h-screen bg-surface flex items-center justify-center p-6">
    <div class="bg-white rounded-2xl shadow-card w-full max-w-md p-8 text-center">
      <div class="text-4xl mb-3">🏝️</div>
      <h1 class="text-lg font-black text-navy">Hotel no encontrado</h1>
      <p class="text-sm text-text-muted mt-2">
        Este enlace no corresponde a un hotel con página pública activa.
      </p>
      <router-link to="/" class="inline-block mt-6 text-sm font-extrabold text-cyan hover:text-cyan-light">Volver al inicio</router-link>
    </div>
  </div>

  <main v-else :style="themeCssVars" :data-template="activeTemplate">
    <!--
      JSON-LD (F1 1.10): el composable `useHotelJsonLd` (Pieza D) arma el payload Hotel +
      FAQPage y los inyecta como `<script type="application/ld+json">` en `<head>` (idempotente,
      los limpia en unmount). El `<component :is="'script'">` de Vue no monta scripts en <head>
      correctamente — por eso el composable inyecta via DOM.
    -->

    <!-- Playfair Display solo para boutique (carga condicional, font-display swap, fallback DM Sans) -->
    <link
      v-if="activeTemplate === 'boutique'"
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700;900&display=swap"
    />

    <!-- FIX (rediseño visual post-QA usuario) — la landing no tenía NINGÚN navbar, gap grande
         vs. referencias de hoteles boutique reales. Overlay transparente sobre el hero, anchors
         condicionales a los bloques que efectivamente van a renderizar. -->
    <LandingNavbar
      :hotel-name="hotel.name"
      :hotel-slug="hotel.slug"
      :anchors="{
        storytelling: renderedBlocks.some((b) => b.type === 'storytelling'),
        gallery: renderedBlocks.some((b) => b.type === 'gallery'),
        rooms: renderedBlocks.some((b) => b.type === 'rooms'),
        location: renderedBlocks.some((b) => b.type === 'location'),
        reviews: renderedBlocks.some((b) => b.type === 'reviews'),
      }"
    />

    <component
      v-for="block in renderedBlocks"
      :id="ANCHOR_IDS[block.type]"
      :key="block.type"
      :is="blockComponent(block.type)"
      :block="block"
      :hotel="hotel"
      :media="media"
      :reviews="reviews"
      :rooms="rooms"
      :rooms-nights="roomsNights"
      :rooms-error="roomsError"
    />

    <!--
      Motor de reserva EN la landing (no en `/book/:slug`). Se monta recién al abrirse para que
      cada apertura arranque limpia y tome el contexto del bloque que la disparó (fechas del
      hero, habitación de la card). El widget embebible sigue existiendo aparte, intacto.
    -->
    <BookingModal
      v-if="bookingOpen"
      :hotel="hotel"
      :options="bookingOptions"
      :theme-vars="themeCssVars"
      @close="bookingOpen = false"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { PublicHotelService } from '@/services/PublicHotel.service'
import { LandingService } from '@/services/Landing.service'
import { BookingService } from '@/services/Booking.service'
import { ApiError } from '@/services/http'
import { useHotelJsonLd } from '@/composables/useHotelJsonLd'
import { useHotelMetaTags } from '@/composables/useHotelMetaTags'
import { provideLandingBooking } from '@/composables/useLandingBooking'
import { provideLandingCancellation } from '@/composables/useLandingPolicy'
import type {
  CancellationSummary,
  LandingBlock,
  LandingBlockType,
  LandingTheme,
  LandingTemplateId,
  OpenBookingOptions,
  PublicHotelInfo,
  PublicHotelMedia,
  PublicReviewsResponse,
  PublicLandingRoom,
  RoomTypeRate,
} from '@/types'
import { PRESET_MAP } from '@/types/landing'

import LandingNavbar from '@/components/landing/LandingNavbar.vue'
import HeroBlock from '@/components/landing/HeroBlock.vue'
import TrustBadgesBlock from '@/components/landing/TrustBadgesBlock.vue'
import StorytellingBlock from '@/components/landing/StorytellingBlock.vue'
import GalleryBlock from '@/components/landing/GalleryBlock.vue'
import AmenitiesBlock from '@/components/landing/AmenitiesBlock.vue'
import MapBlock from '@/components/landing/MapBlock.vue'
import ReviewsBlock from '@/components/landing/ReviewsBlock.vue'
import RoomsBlock from '@/components/landing/RoomsBlock.vue'
import FaqBlock from '@/components/landing/FaqBlock.vue'
import PoliciesBlock from '@/components/landing/PoliciesBlock.vue'
import CtaBlock from '@/components/landing/CtaBlock.vue'
import FooterBlock from '@/components/landing/FooterBlock.vue'
import BookingModal from '@/components/landing/BookingModal.vue'

const route = useRoute()

const loading = ref(true)
const error = ref<string | null>(null)
const hotel = ref<PublicHotelInfo | null>(null)
const blocks = ref<LandingBlock[]>([])
const media = ref<PublicHotelMedia | null>(null)
const reviews = ref<PublicReviewsResponse | null>(null)
/** Noches del rango indicativo por defecto con el que se piden las tarifas (mañana → +N). */
const DEFAULT_INDICATIVE_NIGHTS = 2
/**
 * Techo del rango indicativo cuando se reintenta con el `minNights` del hotel. Es una defensa,
 * no una política: un `booking_config.minNights` cargado con un número absurdo (o un mensaje de
 * error corrupto) no puede hacernos cotizar una estadía de meses en la landing.
 */
const MAX_INDICATIVE_NIGHTS = 30

const rooms = ref<PublicLandingRoom[] | null>(null) // Poblado por GET /rates (indicativo) en onMounted.
// Noches efectivas del rango indicativo usado para pedir /rates. RoomsBlock las necesita para
// convertir `fromPrice` (TOTAL de la estadía) en precio por noche. Se setea junto con `rooms`
// para que quede atado al rango REAL consultado — si el rango cambia (p.ej. el hotel exige 3
// noches mínimas), el precio publicado sigue bien sin tocar el componente.
const roomsNights = ref(DEFAULT_INDICATIVE_NIGHTS)
/**
 * `true` cuando GET /rates falló definitivamente (después del reintento por `minNights`).
 * Distingue "no pude cargar tarifas" de "todavía no cargué" / "cargué y no hay tipos": el
 * bloque de habitaciones tiene que seguir en la página con un estado degradado en vez de
 * desaparecer en silencio (regla del proyecto: el estado vacío cubre vacío Y error de carga).
 */
const roomsError = ref(false)

/**
 * Política de cancelación VIGENTE del hotel, tal como la deriva el backend en `GET /rates`
 * (`cancellationSummary` ← `resolvePolicy`): la misma con la que calcula la penalidad y el
 * reembolso al cancelar. La consume `PoliciesBlock` vía inject.
 *
 * Arranca en `null` y vuelve a `null` si `/rates` falla: "no pude resolver la política" NUNCA
 * puede leerse como "se cancela gratis" — el bloque omite la tarjeta de cancelación.
 *
 * OJO: la respuesta trae además `cancellationPolicy`, un texto libre de `booking_config` que en
 * producción CONTRADICE a esta política (guarda 'flexible' en un hotel con
 * `cancellationType='strict'`). No se usa para mostrar condiciones.
 */
const cancellation = ref<CancellationSummary | null>(null)
provideLandingCancellation(cancellation)

// ─── Reserva EN la landing (BookingModal) ─────────────────────────────────
// Regla de producto: el huésped NO abandona `/h/:slug` para reservar. Los bloques piden abrir el
// modal por inject (`provideLandingBooking`) en vez de navegar a `/book/:slug`, que es el widget
// embebible para sitios de terceros — otro producto, con otra UI y otro ciclo de vida.
const bookingOpen = ref(false)
const bookingOptions = ref<OpenBookingOptions>({})

function openBooking(options: OpenBookingOptions = {}): void {
  bookingOptions.value = { ...options }
  bookingOpen.value = true
}
provideLandingBooking(openBooking)

// ─── Theme (Task B — preset + custom overrides) ───────────────────────────
// El backend manda `theme: { templateId, colors?, fonts? }` (post-Task A). El orquestador
// lo provee a los bloques vía inject('landingTheme') (Hero/Gallery renderizan variants
// estructurales según templateId). El CSS override va en el <main> vía :style="themeCssVars"
// → CSS custom properties que pisan los tokens `@theme` de main.css para todo el subtree.
const theme = ref<LandingTheme | null>(null)
provide('landingTheme', theme)

/** templateId efectivo (default classic si el backend no manda theme). */
const activeTemplate = computed<LandingTemplateId>(
  () => theme.value?.templateId ?? 'classic',
)

/**
 * themeCssVars — merge PRESET_MAP[templateId] + theme.colors (custom) → objeto de CSS custom
 * properties `{ '--color-navy': '#...', '--color-navy-light': '#...', ... }`. camelCase → kebab.
 * Las utilities `bg-navy`/`text-cyan`/etc. de Tailwind v4 compilan a `var(--color-navy)` →
 * heredan el override del <main> automáticamente. Si el backend manda un color inválido
 * (string vacío o no-hex), se cae al preset (no lo overridea).
 *
 * Nota: `--color-surface-dark` en @theme es el token, pero ThemeTokens usa `surfaceDark`
 * (camelCase) → el rename va acá para que el override aplique.
 */
const themeCssVars = computed<Record<string, string>>(() => {
  const templateId = activeTemplate.value
  const preset = PRESET_MAP[templateId] ?? PRESET_MAP.classic
  const overrides = theme.value?.colors ?? {}
  // Merge shallow: preset first, overrides ganadores. Solo tokens declarados en ThemeTokens.
  const merged = { ...preset, ...overrides } as Record<string, string>
  const vars: Record<string, string> = {}
  for (const [camelKey, value] of Object.entries(merged)) {
    if (typeof value !== 'string' || value.trim() === '') continue
    // camelCase → kebab-case (navyLight → navy-light).
    const kebab = camelKey.replace(/([A-Z])/g, '-$1').toLowerCase()
    vars[`--color-${kebab}`] = value
  }
  return vars
})

// ─── Rooms (F1 hero-search-rooms-content) ──────────────────────────────────
// Bug UTC conocido del repo (ver CalendarView.vue:162 isoOf): `toISOString()` convierte a UTC
// antes de cortar, rompe "mañana" en zonas UTC-negativas (Santo Domingo, UTC-4). Construimos la
// fecha local a mano con getFullYear/getMonth/getDate, nunca toISOString ni parseo de string.
function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}
function localIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function indicativeDateRange(nights: number): { checkIn: string; checkOut: string; nights: number } {
  const now = new Date()
  const checkInDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const checkOutDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1 + nights,
  )
  return { checkIn: localIso(checkInDate), checkOut: localIso(checkOutDate), nights }
}

/** Prettify simple de un roomType string ('double' → 'Double'). Sin mapa de labels centralizado
 *  (mismo criterio de estilo que AmenitiesBlock.vue:labelFor — capitaliza palabras kebab/snake). */
function prettifyRoomType(type: string): string {
  if (type.includes(' ')) return type
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function mapRoomTypeRate(rt: RoomTypeRate): PublicLandingRoom {
  return {
    id: rt.id,
    name: prettifyRoomType(rt.name),
    fromPrice: rt.fromPrice,
    availableCount: rt.availableCount,
    capacity: rt.capacity,
    surfaceArea: rt.surfaceArea,
    photoUrl: rt.photoUrl ?? null,
  }
}

/**
 * Pide las tarifas indicativas para un rango de N noches y publica el resultado en
 * `rooms`/`roomsNights`. Lanza si la request falla (el caller decide si reintenta).
 */
/**
 * Completa lo que `/rates` trajo con los tipos del catálogo (`GET /room-types`, SIN filtro de
 * disponibilidad) que `/rates` excluyó por no tener stock continuo justo en la ventana de fechas
 * indicativa — bug real 2026-08-20: un tipo reservado esos días desaparecía ENTERO de la vitrina
 * "Habitaciones", aunque sea un producto real y vendible en cualquier otra fecha.
 *
 * El catálogo es un COMPLEMENTO, no una dependencia dura: si falla, la vitrina sigue mostrando
 * exactamente lo que `/rates` trajo (comportamiento previo a este fix, sin romper nada). Un tipo
 * ya presente en `rated` (por id) nunca se pisa — esos ya tienen precio/disponibilidad EN VIVO.
 *
 * `basePrice` del catálogo es POR NOCHE (a diferencia de `fromPrice`, que es el TOTAL de la
 * estadía) — se multiplica por `nights` para que quede en el mismo contrato que `mapRoomTypeRate`
 * y `RoomsBlock.pricePerNight()` (que divide por `nights`) siga funcionando sin tocar el
 * componente. Un tipo sin `basePrice` cargado (0) se omite: mejor no mostrar la card que publicar
 * "Desde 0 US$/noche".
 */
async function mergeWithCatalog(
  slug: string, rated: PublicLandingRoom[], nights: number,
): Promise<PublicLandingRoom[]> {
  try {
    const catalog = await PublicHotelService.getRoomTypes(slug)
    const ratedIds = new Set(rated.map((r) => r.id))
    const fallback: PublicLandingRoom[] = catalog.roomTypes
      .filter((t) => !ratedIds.has(t.id) && t.basePrice > 0)
      .map((t) => ({
        id: t.id,
        name: prettifyRoomType(t.name),
        fromPrice: t.basePrice * nights,
        availableCount: 0,
        capacity: t.capacity,
        surfaceArea: t.surfaceArea,
        photoUrl: t.photoUrl,
      }))
    return [...rated, ...fallback]
  } catch {
    return rated
  }
}

async function requestIndicativeRates(slug: string, nights: number): Promise<void> {
  const { checkIn, checkOut } = indicativeDateRange(nights)
  const ratesRes = await BookingService.getRates(slug, { checkIn, checkOut, guests: 2 })
  // La API devuelve las noches que efectivamente cotizó; es la fuente de verdad sobre el
  // rango local (que solo describe lo que PEDIMOS). Si no viene, caemos al rango pedido.
  const apiNights = Number(ratesRes.nights)
  const effectiveNights = Number.isFinite(apiNights) && apiNights > 0 ? apiNights : nights
  roomsNights.value = effectiveNights
  const rated = (ratesRes.roomTypes ?? []).map(mapRoomTypeRate)
  rooms.value = await mergeWithCatalog(slug, rated, effectiveNights)
  roomsError.value = false
  cancellation.value = ratesRes.cancellationSummary ?? null
}

/**
 * Tarifas indicativas de la landing (F1 hero-search-rooms-content).
 *
 * BUG QUE ARREGLA: el rango era fijo en 2 noches. Un hotel con `booking_config.minNights >= 3`
 * recibía 400 (`public-rates.ts` valida la estadía mínima), el catch dejaba `rooms = null` y el
 * bloque de habitaciones desaparecía ENTERO de su landing — web pública sin habitaciones ni
 * precios. Ahora el rango sale del `minNights` que declara `GET /api/public/hotel/:slug`, así
 * que la primera consulta ya es válida (antes se deducía el número parseando el TEXTO del
 * mensaje de error, que se rompía con cualquier cambio de copy y costaba un request extra).
 *
 * Sigue siendo tolerante: un hotel con el booking engine apagado devuelve 404 acá y la página
 * no se rompe — pero el bloque queda en estado degradado (`roomsError`), no invisible.
 */
async function loadIndicativeRates(slug: string, minNights: number | null): Promise<void> {
  // El techo es defensa, no política: un `minNights` cargado con un número absurdo no puede
  // hacernos cotizar una estadía de meses en la landing.
  const nights = minNights !== null && minNights > DEFAULT_INDICATIVE_NIGHTS
    ? Math.min(minNights, MAX_INDICATIVE_NIGHTS)
    : DEFAULT_INDICATIVE_NIGHTS
  try {
    await requestIndicativeRates(slug, nights)
  } catch {
    rooms.value = null
    roomsError.value = true
    // Sin política resuelta el bloque de condiciones omite la cancelación (no inventa un default).
    cancellation.value = null
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  const slug = String(route.params.slug || '').trim()
  if (!slug) {
    error.value = 'missing-slug'
    loading.value = false
    return
  }
  try {
    hotel.value = await PublicHotelService.getBySlug(slug)

    // Mientras tanto, predigo si el bloque `reviews` estará activo para condicional el fetch.
    // El list de bloques determina el render; si el fetch de bloques falla, no hay reviews.
    const [blocksRes, mediaRes] = await Promise.allSettled([
      LandingService.get(slug),
      PublicHotelService.getMedia(slug),
    ])

    if (blocksRes.status === 'fulfilled') {
      // DEFENSIVO (bug envelope, solmi-direct-booking): históricamente el backend envolvía la
      // lista en `{ data: [...] }` sobre el envelope del framework `{ success, data }` que
      // http.ts:263-270 YA desenvolvió. Tras Task A (commit 5df115a), el contract formal es
      // `{ data: LandingBlock[], theme: LandingTheme | null }`, pero soportamos ambas formas
      // (array plano, envelope sin theme, envelope con theme) para que un refactor del backend
      // no vuelva a romper la página ("Hotel no encontrado" por TypeError en useHotelJsonLd).
      const v = blocksRes.value as
        | LandingBlock[]
        | { data?: LandingBlock[]; theme?: LandingTheme | null }
      if (Array.isArray(v)) {
        blocks.value = v
      } else {
        blocks.value = v?.data ?? []
        theme.value = v?.theme ?? null
      }
    }
    // Si blocks falla, dejamos [] — la landing renderiza solo header/etc implícitamente; hoy no
    // hay fallback. El error signará con warning pero no bloquea la página completa.

    if (mediaRes.status === 'fulfilled') media.value = mediaRes.value
    // media 404 (F0 endpoint futuro en algunos deployments) → gallery/hero caen a gradiente.

    // Reviews: solo lo pido si hay bloque `reviews` activo (ahorra una request innecesaria).
    const hasReviewsBlock = blocks.value.some((b) => b.type === 'reviews')
    if (hasReviewsBlock) {
      try {
        reviews.value = await PublicHotelService.getReviews(slug, { limit: 12 })
      } catch {
        reviews.value = null // 404 tolerable — ReviewsBlock se omite si no hay data.
      }
    }

    // Rooms (F1 hero-search-rooms-content): tarifas indicativas vía GET /rates (mañana + N
    // noches, 2 adultos — N = 2 por default, o la estadía mínima que declara el hotel, así la
    // primera consulta ya es válida). Tolerante: un hotel con el booking engine desactivado
    // devuelve 404 acá, igual que reviews/media — no rompe la página.
    await loadIndicativeRates(slug, hotel.value?.minNights ?? null)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      error.value = 'not-found'
    } else {
      error.value = e instanceof Error ? e.message : 'unknown'
    }
  } finally {
    loading.value = false
  }
})

// ─── Render: elegir componente por tipo + filtrar bloques sin data ─────────
const BLOCK_COMPONENTS: Record<LandingBlockType, unknown> = {
  hero: HeroBlock,
  'trust-badges': TrustBadgesBlock,
  storytelling: StorytellingBlock,
  gallery: GalleryBlock,
  amenities: AmenitiesBlock,
  location: MapBlock,
  reviews: ReviewsBlock,
  rooms: RoomsBlock,
  faq: FaqBlock,
  policies: PoliciesBlock,
  cta: CtaBlock,
  footer: FooterBlock,
}

/** Anchors para los links del navbar (`#hero`/`#rooms`/`#location`/`#reviews`). Los demás
 *  types no tienen link en el navbar → sin id (evita colisiones de id si el hotel tiene
 *  varios bloques del mismo type renderizados — no pasa hoy, 1 por type, pero es defensivo). */
const ANCHOR_IDS: Partial<Record<LandingBlockType, string>> = {
  hero: 'hero',
  storytelling: 'experiencias',
  gallery: 'galeria',
  rooms: 'rooms',
  location: 'location',
  reviews: 'reviews',
}

function blockComponent(type: LandingBlockType) {
  return BLOCK_COMPONENTS[type]
}

/**
 * Filtra los bloques que el orquestador NO debe pintar porque falta data externa.
 * Cada BlockComponent tiene su propio guard, pero este filtro evita pedazos vacíos
 * (mejor SEO + layout limpio). Reglas:
 *   - storytelling sin description NI mediaIds → omite (guard liviano acá; el componente
 *     hace el guard fino con la resolución real contra media.gallery)
 *   - gallery sin media.gallery           → omite
 *   - amenities sin hotel.amenities       → omite
 *   - location sin coords válidas (0,0)   → omite
 *   - reviews sin reviews/reseñas         → omite
 *   - rooms sin tarifas Y sin error de carga (200 vacío) → omite; si `/rates` FALLÓ, el
 *     bloque se pinta degradado (ver `roomsError`)
 *   - faq sin items                       → omite
 * Los demás (hero, trust-badges, cta, footer) siempre renderizan (tienen defaults).
 */
const renderedBlocks = computed<LandingBlock[]>(() => {
  const list = [...blocks.value].sort((a, b) => a.sortOrder - b.sortOrder)
  return list.filter((b) => shouldRender(b))
})

function shouldRender(b: LandingBlock): boolean {
  switch (b.type) {
    case 'storytelling': {
      const cfg = (b.config ?? {}) as Record<string, unknown>
      const hasDescription = typeof cfg.description === 'string' && cfg.description.trim().length > 0
      const hasMedia = Array.isArray(cfg.mediaIds) && cfg.mediaIds.length > 0
      return hasDescription || hasMedia
    }
    case 'gallery':
      return (media.value?.gallery?.length ?? 0) > 0
    case 'amenities':
      return (hotel.value?.amenities?.length ?? 0) > 0
    case 'location': {
      const lat = hotel.value?.latitude
      const lng = hotel.value?.longitude
      return (
        typeof lat === 'number' && typeof lng === 'number' &&
        Number.isFinite(lat) && Number.isFinite(lng) &&
        !(lat === 0 && lng === 0) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      )
    }
    case 'reviews':
      return (reviews.value?.reviews?.length ?? 0) > 0
    case 'rooms':
      // Con tarifas → cards. Sin tarifas por un FALLO de carga → el bloque igual se pinta en
      // estado degradado (RoomsBlock lo resuelve con `roomsError`): un hotel no puede quedarse
      // sin sección de habitaciones porque `/rates` respondió mal. Sin fallo y sin tipos
      // (respuesta 200 vacía = sin disponibilidad para el rango indicativo) se sigue omitiendo.
      return (rooms.value?.length ?? 0) > 0 || roomsError.value
    case 'faq': {
      const items = (b.config ?? {}).items
      return Array.isArray(items) && items.length > 0
    }
    case 'policies': {
      // Solo si hay AL MENOS un dato real que mostrar. El bloque no tiene contenido propio: todo
      // sale de la política vigente y de la configuración del hotel. Sin nada de eso, no se pinta
      // una sección "Políticas y condiciones" vacía (peor: una que sugiera condiciones que nadie
      // configuró). El componente repite el guard fino card por card.
      const h = hotel.value
      const hasSchedule = !!(h?.checkIn?.trim() || h?.checkOut?.trim())
      const hasStayLimits = (h?.minNights ?? 0) > 1 || (h?.maxNights ?? 0) > 0
      return cancellation.value !== null || hasSchedule || hasStayLimits
    }
    case 'hero':
    case 'trust-badges':
    case 'cta':
    case 'footer':
      return true
    default:
      return true
  }
}

// ─── JSON-LD (F1 1.10 — composable useHotelJsonLd, Pieza D) ────────────────
// El composable arma los payloads Hotel/LodgingBusiness + FAQPage y los inyecta en <head>
// (watch immediate + cleanup en onBeforeUnmount). El orquestador solo le pasa los refs; mismo
// comportamiento que el inline original (commit 555bf82): aggregateRating solo si count>0 y
// score!=null, FAQPage solo con items válidos, makesOffer omitido hasta F2.
useHotelJsonLd({ hotel, media, reviews, blocks, rooms, roomsNights })

// FIX (auditoría UX/SEO) — la landing no tenía meta description dinámica ni ningún tag
// og:*/twitter:* — compartir el link de un hotel mostraba branding genérico de la SPA en vez
// del hotel. Ver composable para la limitación honesta (SPA sin SSR real).
useHotelMetaTags({ hotel, media })

// FIX 2026-07-31 (QA en prod) — la pestaña del navegador quedaba con el título genérico del
// SPA ("SolmiOS — Hospitality OS") en TODAS las landings públicas en vez del nombre del hotel
// (afecta SEO + UX de pestañas múltiples). Se restaura el default al salir para no filtrar el
// nombre del hotel a otras páginas del panel que no setean su propio título.
const DEFAULT_TITLE = 'SolmiOS — Hospitality OS'
watch(hotel, (h) => {
  document.title = h?.name ? `${h.name} — Reserva directa` : DEFAULT_TITLE
}, { immediate: true })
onBeforeUnmount(() => { document.title = DEFAULT_TITLE })
</script>

<!--
  Estilos NO scoped (Task B): los selectores por atributo `main[data-template='...']` necesitan
  perforar scope. Tailwind v4 ya genera utilities; acá solo detalles puntuales (tipografía
  boutique + cards editoriales).
-->
<style>
/* Boutique: headings en Playfair Display (cargado por <link> condicional en el template),
   fallback DM Sans (font-sans). Solo aplicado dentro del main con data-template=boutique. Las
   reglas viven acá (no scoped) para perforar el scope de hotel-landing y llegar a los bloques. */
main[data-template='boutique'] h1,
main[data-template='boutique'] h2 {
  font-family: 'Playfair Display', 'DM Sans', Georgia, serif;
  letter-spacing: -0.01em;
}

/* Boutique: cards editoriales — radius menor (0.5rem), fondo crema cálido y borde vino sutil.
   Suma los dos detalles que diferencian .card boutique de la card default (16px, blanca). */
main[data-template='boutique'] .card {
  border-radius: 0.5rem;
  background: #FFFCF7;
  border-color: rgba(74, 29, 29, 0.12);
}
</style>
