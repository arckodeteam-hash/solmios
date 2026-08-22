// address-components.ts — traduce los `address_components` de la Geocoding API de Google (o la
// respuesta de Nominatim/OpenStreetMap) a los cuatro campos que muestra la pantalla de
// Configuración: Provincia, Municipio, Localidad y Código Postal.
//
// GH-33 — por qué esto es un módulo aparte y no cuatro líneas dentro del .vue:
//
// El esquema de Google es genérico y NO calza 1:1 con ninguna división administrativa nacional.
// El mapeo anterior leía `municipality` únicamente de `administrative_area_level_2`, y Google no
// devuelve ese componente en buena parte de República Dominicana (en el Distrito Nacional, por
// ejemplo, la provincia y el municipio son la misma entidad y solo viene `locality`), así que el
// campo Municipio quedaba vacío incluso cuando el geocoding respondía perfecto.
//
// La regla es una CADENA DE FALLBACKS del componente más específico al más general, sin nombrar
// ningún país: cada campo se resuelve con el primer componente disponible de su cadena. Es mejor
// esfuerzo — los campos siguen siendo editables y el llamador avisa qué quedó sin resolver.
//
// Nominatim fallback (MAPGEO): cuando no hay API key de Google, se usa la reverse geocoding
// de OpenStreetMap (gratis, sin key). La respuesta tiene un esquema distinto (`address.state`,
// `address.city`, etc.) que se normaliza al mismo `MappedAddress`.

/** Subconjunto de `google.maps.GeocoderAddressComponent` que realmente usamos. */
export interface AddressComponent {
  long_name: string
  short_name?: string
  types: string[]
}

/** Los cuatro campos de dirección de la pantalla de Configuración. */
export interface MappedAddress {
  province: string
  municipality: string
  locality: string
  postalCode: string
}

export type AddressField = keyof MappedAddress

/**
 * Cadenas de fallback, del componente más específico al más general.
 *
 * - `province`: entidad civil de primer orden bajo el país (en RD, la provincia).
 * - `municipality`: entidad de segundo orden; si Google no la trae, la ciudad hace de municipio,
 *   y si tampoco hay ciudad se cae a la de primer orden (provincia == municipio, caso capital).
 * - `locality`: ciudad/pueblo; si no viene, el sector o barrio.
 * - `postalCode`: código postal exacto, o el prefijo cuando Google solo tiene ese nivel.
 */
const FALLBACK_CHAINS: Record<AddressField, readonly string[]> = {
  province: ['administrative_area_level_1'],
  municipality: ['administrative_area_level_2', 'locality', 'postal_town', 'administrative_area_level_1'],
  locality: ['locality', 'postal_town', 'sublocality_level_1', 'sublocality', 'neighborhood', 'administrative_area_level_3'],
  postalCode: ['postal_code', 'postal_code_prefix'],
}

/** Etiquetas visibles, para poder decirle al usuario exactamente qué campo quedó sin resolver. */
export const ADDRESS_FIELD_LABELS: Record<AddressField, string> = {
  province: 'Provincia',
  municipality: 'Municipio',
  locality: 'Localidad',
  postalCode: 'Código Postal',
}

/**
 * Resuelve los cuatro campos a partir de los componentes de Google.
 * Un campo que no se pudo resolver vuelve como string vacío — nunca inventa un valor.
 */
export function mapAddressComponents(components: readonly AddressComponent[] | undefined | null): MappedAddress {
  const list = Array.isArray(components) ? components : []
  const firstOf = (chain: readonly string[]): string => {
    for (const type of chain) {
      const hit = list.find((c) => Array.isArray(c?.types) && c.types.includes(type))
      const value = hit?.long_name?.trim()
      if (value) return value
    }
    return ''
  }
  return {
    province: firstOf(FALLBACK_CHAINS.province),
    municipality: firstOf(FALLBACK_CHAINS.municipality),
    locality: firstOf(FALLBACK_CHAINS.locality),
    postalCode: firstOf(FALLBACK_CHAINS.postalCode),
  }
}

/** Campos que quedaron sin resolver, en el orden en que se muestran en pantalla. */
export function unresolvedFields(mapped: MappedAddress): AddressField[] {
  return (Object.keys(ADDRESS_FIELD_LABELS) as AddressField[]).filter((f) => !mapped[f])
}

/**
 * Traduce el fallo del Geocoder a un mensaje accionable en español.
 *
 * El SDK rechaza con un error cuyo `code`/`message` trae el status de la API. Distinguirlos importa
 * porque las acciones son distintas: `REQUEST_DENIED` es una API que falta habilitar en Google
 * Cloud (la Geocoding API es un producto SEPARADO de la Maps JavaScript API: tener la key del mapa
 * NO alcanza), mientras que `ZERO_RESULTS` es simplemente un punto sin datos.
 */
export function geocodeErrorMessage(err: unknown): { variant: 'error' | 'warning'; title: string; detail: string } {
  const raw = [
    (err as { code?: unknown } | null)?.code,
    (err as { message?: unknown } | null)?.message,
    String(err ?? ''),
  ]
    .map((v) => (typeof v === 'string' ? v : ''))
    .join(' ')
    .toUpperCase()

  if (raw.includes('ZERO_RESULTS')) {
    return {
      variant: 'warning',
      title: 'Google no tiene dirección para ese punto',
      detail: 'Movelo a un punto con calles cerca o completá los campos a mano.',
    }
  }
  if (raw.includes('REQUEST_DENIED') || raw.includes('API_NOT_ACTIVATED') || raw.includes('NOT_AUTHORIZED')) {
    return {
      variant: 'error',
      title: 'La Geocoding API de Google está rechazando la consulta',
      detail: 'Habilitá "Geocoding API" en el proyecto de Google Cloud de la key (Admin → Integraciones) y revisá que la key no esté restringida a Maps JavaScript. Mientras tanto, completá los campos a mano.',
    }
  }
  if (raw.includes('OVER_QUERY_LIMIT') || raw.includes('OVER_DAILY_LIMIT')) {
    return {
      variant: 'error',
      title: 'Se agotó la cuota de Google Geocoding',
      detail: 'Revisá la facturación del proyecto de Google Cloud. Mientras tanto, completá los campos a mano.',
    }
  }
  return {
    variant: 'error',
    title: 'No se pudo completar la dirección automáticamente',
    detail: 'Revisá tu conexión a internet y volvé a mover el pin, o completá los campos a mano.',
  }
}

// ─── Nominatim (OpenStreetMap) fallback ──────────────────────────────────────────────────────

/** Respuesta del `address` de Nominatim. Subset de lo que realmente usamos. */
interface NominatimAddress {
  state?: string          // provincia / estado (RD: "Santo Domingo", "La Altagracia", ...)
  state_district?: string // distrito / municipio a veces (si `city` no viene)
  city?: string           // ciudad / municipio
  town?: string           // fallback si city no existe (pueblos)
  village?: string        // fallback para localidades rurales
  county?: string         // a veces mapea a municipio (varía por país)
  suburb?: string         // sector / barrio
  neighbourhood?: string  // vecindario
  postcode?: string       // código postal
}

interface NominatimResponse {
  address?: NominatimAddress
}

/**
 * Normaliza la respuesta de Nominatim a `MappedAddress`.
 *
 * La semántica de los campos de Nominatim varía fuertemente por país:
 * - `state` ≈ provincia (primer nivel administrativo bajo el país).
 * - `city` / `town` / `village` ≈ municipio (segundo nivel).
 * - `suburb` / `neighbourhood` ≈ localidad/sector.
 * - `county` ≈ alternativa a municipio cuando no hay `city`.
 */
function mapNominatimAddress(addr: NominatimAddress | undefined): MappedAddress {
  if (!addr) return { province: '', municipality: '', locality: '', postalCode: '' }
  return {
    province: addr.state?.trim() ?? '',
    municipality: addr.city?.trim() || addr.town?.trim() || addr.village?.trim()
      || addr.county?.trim() || addr.state_district?.trim() || '',
    locality: addr.suburb?.trim() || addr.neighbourhood?.trim() || addr.city?.trim()
      || addr.town?.trim() || addr.village?.trim() || '',
    postalCode: addr.postcode?.trim() ?? '',
  }
}

/**
 * Reverse geocoding via Nominatim (OpenStreetMap): gratis, sin API key.
 * Se usa como fallback cuando Google no puede: sin key configurada, o con la Geocoding API
 * deshabilitada para la key (producto SEPARADO de la Maps JavaScript que dibuja el mapa).
 *
 * Nominatim tiene un rate limit de 1 req/s (política de uso). No se aplica debouncing
 * acá porque el llamador ya secuencia con `geocodeSeq` y se llama UNA vez por
 * dragend/click/pegado — no por frame de arrastre.
 */
export async function reverseGeocodeNominatim(lat: number, lng: number): Promise<MappedAddress> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&addressdetails=1&accept-language=es`
  const res = await fetch(url, {
    headers: {
      // Nominatim pide un User-Agent identificable (no un genérico). Desde el navegador
      // fetch NO puede setear User-Agent (header prohibido: viaja el del browser); este
      // header solo aplica si algún día la llamada se corre al backend.
      'User-Agent': 'SOLMIOS-ConfigPanel/1.0 (https://solmios.com)',
    },
  })
  if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`)
  const data = await res.json() as NominatimResponse
  return mapNominatimAddress(data.address)
}
