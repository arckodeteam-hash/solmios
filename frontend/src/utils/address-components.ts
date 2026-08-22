// address-components.ts — traduce los `address_components` de la Geocoding API de Google a los
// cuatro campos que muestra la pantalla de Configuración: Provincia, Municipio, Localidad y
// Código Postal.
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
