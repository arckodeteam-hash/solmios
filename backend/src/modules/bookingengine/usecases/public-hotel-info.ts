// bookingengine/usecases/public-hotel-info.ts — Info pública del hotel por slug (F0 0.4
// spec public-hotel-info). Allow-list ESTRICTA: nunca spread del objeto hotel — solo se
// copian explícitamente los campos públicos. Mismo patrón que restaurant/usecases/public-menu.ts.
//
// i18n: el helper compartido `resolveForLang` (shared/i18n.ts) NO aplica acá — está pensado
// para entidades con `translations: Record<lang, Partial<Record<field, string>>>` (un mapa
// por campo). El hotel guarda `descriptionTranslations: Record<lang, {title?, description?}>`
// (un solo objeto con ambos campos) y el español base vive en `descriptionJson` (string JSON,
// D7). Resolvemos inline: si `lang` matchea una key de `descriptionTranslations` se usa esa
// traducción; si no, se parsea `descriptionJson` (español base); si no hay nada, null/null.
// Ver openspec/changes/solmi-direct-booking/specs/public-hotel-info/spec.md (D2, D7).
import { NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import type { PublicHotelInfoDTO } from '../types'
import { resolveChildPolicy } from '../../../shared/usecases/child-composition'

export interface PublicHotelInfoDeps {
  hotels: RepositoryAdapter<any>
  /** Repo `Configuration` (KV) — resuelve `google_maps` con fallback a `hotelId:'platform'`.
   *  Opcional para no romper callers/tests viejos: sin él, `googleMapsApiKey` queda `null`
   *  (degrada al iframe embed, mismo criterio que el resto de las configs opcionales del módulo). */
  config?: RepositoryAdapter<any>
  /** Tabla `booking_config` — de acá salen `minNights`/`maxNights`. Opcional por el mismo
   *  criterio: sin él ambas quedan `null` (= sin límite declarado) y el cliente se comporta
   *  como antes. */
  bookingConfig?: RepositoryAdapter<any>
}

// Anti-enumeración: MISMO mensaje para "no existe" y "no activo" (no filtrar hoteles inactivos).
const NOT_FOUND_MSG = 'Hotel not found'

export async function getPublicHotelInfo(
  deps: PublicHotelInfoDeps,
  slug: string,
  lang: string | undefined,
): Promise<PublicHotelInfoDTO> {
  if (!slug) throw new NotFoundError(NOT_FOUND_MSG)

  const hotel = await deps.hotels.findOne({ slug })
  if (!hotel) throw new NotFoundError(NOT_FOUND_MSG)
  // onlineBookingStatus !== 'active' MISMO 404 — un hotel pausado no se enumera desde la ruta pública.
  if (hotel.onlineBookingStatus !== 'active') throw new NotFoundError(NOT_FOUND_MSG)

  const { title, description } = resolveI18n(hotel, lang)
  const googleMapsApiKey = await resolveGoogleMapsKey(deps.config, hotel.id)
  const stayLimits = await resolveStayLimits(deps.bookingConfig, hotel.id)
  const childPolicy = await resolveChildPolicy(deps.config, hotel.id)

  // Allow-list ESTRICTA: copia campo por campo. NUNCA `...hotel` — arrastraría ownerName,
  // taxId, wifiPassword, etc. al JSON de respuesta (ver spec, "Anti-patrón allow-list").
  return {
    id: hotel.id,
    slug: hotel.slug,
    name: hotel.name,
    title,
    description,
    descriptionTranslations: hotel.descriptionTranslations ?? null,
    accommodationType: hotel.accommodationType ?? 'hotel',
    starRating: hotel.starRating ?? null,
    latitude: hotel.latitude ?? 0,
    longitude: hotel.longitude ?? 0,
    address: hotel.address ?? null,
    province: hotel.province ?? null,
    municipality: hotel.municipality ?? null,
    locality: hotel.locality ?? null,
    postalCode: hotel.postalCode ?? null,
    phone: hotel.phone ?? null,
    email: hotel.email ?? null,
    website: hotel.website ?? null,
    checkIn: hotel.checkIn ?? '15:00',
    checkOut: hotel.checkOut ?? '12:00',
    currency: hotel.currency ?? 'USD',
    taxName: hotel.taxName ?? 'ITBIS',
    taxRate: hotel.taxRate ?? 18.0,
    cancellationType: hotel.cancellationType ?? 'flexible',
    freeCancellation: hotel.freeCancellation ?? true,
    depositRequired: hotel.depositRequired ?? true,
    depositPercent: hotel.depositPercent ?? 30,
    releaseHours: hotel.releaseHours ?? 0,
    logo: hotel.logo ?? null,
    amenities: hotel.amenities ?? null,
    onlineBookingStatus: hotel.onlineBookingStatus,
    googleMapsApiKey,
    minNights: stayLimits.minNights,
    maxNights: stayLimits.maxNights,
    widgetDefaultLanguage: stayLimits.widgetDefaultLanguage,
    widgetDefaultCurrency: stayLimits.widgetDefaultCurrency,
    widgetAccentPreset: stayLimits.widgetAccentPreset,
    childPolicy,
  }
}

/**
 * Estadía mínima/máxima de `booking_config`. Son públicas a propósito: el cliente las necesita
 * para armar una consulta válida ANTES de cotizar. La landing pide tarifas indicativas apenas
 * carga y, sin conocer el mínimo, un hotel con `minNights: 3` devolvía 400 y la web se quedaba
 * sin bloque de habitaciones. La alternativa era que el frontend dedujera el número parseando
 * el texto del mensaje de error, que se rompe con cualquier cambio de copy.
 *
 * Devuelve `null` cuando no hay límite declarado (o no hay fila de config): no inventamos un
 * mínimo de 1, porque "sin límite" y "mínimo 1" se leen distinto del lado del cliente.
 */
async function resolveStayLimits(
  bookingConfig: RepositoryAdapter<any> | undefined,
  hotelId: string,
): Promise<{
  minNights: number | null; maxNights: number | null
  widgetDefaultLanguage: string | null; widgetDefaultCurrency: string | null
  widgetAccentPreset: string | null
}> {
  const empty = { minNights: null, maxNights: null, widgetDefaultLanguage: null, widgetDefaultCurrency: null, widgetAccentPreset: null }
  if (!bookingConfig) return empty
  try {
    const cfg = await bookingConfig.findOne({ hotelId })
    return {
      minNights: positiveOrNull(cfg?.minNights),
      maxNights: positiveOrNull(cfg?.maxNights),
      // Tarea 3.4 (corrección 2026-08-25) — mismo fetch, sin pedir booking_config 2 veces.
      widgetDefaultLanguage: nonEmptyOrNull(cfg?.language),
      widgetDefaultCurrency: nonEmptyOrNull(cfg?.currency),
      // "Tema del Widget" — string libre a propósito, sin validar contra un enum acá: el
      // frontend (ACCENT_PRESETS en booking-widget.vue) es quien decide qué valores conoce y
      // cae a "sin override" ante cualquier otro. Evita tener que migrar filas viejas si el
      // set de presets cambia (ver corrección 2026-08-25: 'white'/'dark' se renombraron a
      // 'gold'/'coral' — una fila vieja con 'white' simplemente no matchea ningún preset hoy
      // y el widget se ve con sus colores de siempre, no rompe nada).
      widgetAccentPreset: nonEmptyOrNull(cfg?.theme),
    }
  } catch {
    // La info del hotel no puede caerse porque falle una config secundaria.
    return empty
  }
}

function nonEmptyOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function positiveOrNull(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Lee `configuration(hotelId, key:'google_maps')`, shape `{apiKey: string}`, con fallback a
 * `configuration(hotelId:'platform', key:'google_maps')` — MISMO mecanismo que
 * `hoteles/usecases/config-kv.ts:getConfig` (no reinventa la regla de fallback). Client-visible
 * por diseño: una Maps JS API key se restringe por dominio del lado de Google, no es secreta.
 */
async function resolveGoogleMapsKey(
  config: RepositoryAdapter<any> | undefined,
  hotelId: string,
): Promise<string | null> {
  if (!config) return null
  try {
    const own = await config.findMany({ hotelId, key: 'google_maps' })
    const platform = own.length > 0 ? own : await config.findMany({ hotelId: 'platform', key: 'google_maps' })
    const raw = platform[0]?.value
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const key = parsed?.apiKey
    return typeof key === 'string' && key.trim() ? key.trim() : null
  } catch {
    return null
  }
}

/** Resuelve title/description para `lang` (D2, D7). Fallback final SIEMPRE español base
 *  (`descriptionJson`), nunca null si hay dato base. `descriptionTranslations` NUNCA incluye
 *  'es' — el español base vive en `descriptionJson` (dos fuentes de verdad, D7). */
function resolveI18n(
  hotel: any,
  lang: string | undefined,
): { title: string | null; description: string | null } {
  // 1. Traducción declarada para `lang` (distinto de español base).
  if (lang && lang !== 'es') {
    const t = hotel.descriptionTranslations?.[lang]
    if (t && typeof t === 'object') {
      return {
        title: typeof t.title === 'string' && t.title !== '' ? t.title : null,
        description: typeof t.description === 'string' && t.description !== '' ? t.description : null,
      }
    }
  }
  // 2. Español base desde `descriptionJson` (string JSON con shape {title?, description?}).
  //    Defensivo: si es string vacío/null, o si ya es un objeto (algunas seeds), lo maneja.
  const base = parseDescriptionJson(hotel.descriptionJson)
  return {
    title: base?.title ?? null,
    description: base?.description ?? null,
  }
}

function parseDescriptionJson(raw: unknown): { title?: string; description?: string } | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'object') return raw as { title?: string; description?: string }
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as { title?: string; description?: string }
    return null
  } catch {
    return null
  }
}
