// Carga perezosa del SDK de Google Maps, con la key tomada de configuración (NUNCA hardcodeada).
//
// La key se administra en Admin → Configuración → Integraciones y se guarda en
// configuration(hotelId:'platform', key:'google_maps'). Cada hotel la hereda por el fallback
// a 'platform' que ya hace `getConfig`.
//
// Si no hay key configurada, `loadGoogleMaps()` devuelve null y la pantalla usa el iframe embed
// (que no requiere key pero no permite mover el pin con el mouse). Es degradación, no error:
// la plataforma tiene que seguir funcionando sin cuenta de Google.
//
// FIX 2026-08-01 — la landing PÚBLICA (`/h/:slug`, sin auth) también necesita esto para
// `MapBlock.vue`, pero `ConfigService.get()` pega a una ruta admin autenticada
// (`GET /api/configuracion/:key`, `guard('settings','view')`) que 401ea sin token. Esa pantalla
// ya recibe la key resuelta server-side en `PublicHotelInfo.googleMapsApiKey` (endpoint público
// `/api/public/hotel/:slug`), así que `loadGoogleMaps` ahora acepta un `apiKey` explícito para
// no repetir el round-trip autenticado — si no se pasa, sigue el fetch de siempre (admin).

import { ConfigService } from '@/services/Platform.service'

const SCRIPT_ID = 'google-maps-sdk'

declare global {
  interface Window {
    /** Callback global que el SDK de Google Maps invoca cuando la key es inválida/restringida
     *  (no cubierto por @types/google.maps). Ver uso en `loadGoogleMaps`. */
    gm_authFailure?: () => void
  }
}

/** Promesa compartida: el SDK se inyecta UNA sola vez aunque se entre y salga de la pestaña.
 *  Cacheada por key para no reusar el loader de un caller con la key de otro (admin vs público
 *  podrían resolver keys distintas si en el futuro cada hotel tiene la suya propia). */
const loaders = new Map<string, Promise<typeof google.maps | null>>()

async function fetchApiKey(): Promise<string> {
  try {
    const cfg = await ConfigService.get('google_maps')
    const key = (cfg as { apiKey?: string } | null)?.apiKey
    return typeof key === 'string' ? key.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Devuelve `google.maps` listo para usar, o null si no hay key (ni pasada ni configurada) o
 * falló la carga. El llamador decide el fallback; acá nunca se lanza.
 *
 * @param explicitKey Si se pasa (páginas públicas sin auth, ya la resolvió el backend), se usa
 *   directo sin pegarle a `ConfigService.get`. Si se omite, cae al fetch autenticado de siempre
 *   (admin — `settings/index.vue`).
 */
export function loadGoogleMaps(explicitKey?: string): Promise<typeof google.maps | null> {
  const cacheKey = explicitKey ?? '__admin_fetch__'
  const cached = loaders.get(cacheKey)
  if (cached) return cached
  const loader = (async () => {
    const key = explicitKey?.trim() || await fetchApiKey()
    if (!key) return null
    if (typeof window !== 'undefined' && window.google?.maps) return window.google.maps

    return new Promise<typeof google.maps | null>((resolve) => {
      let settled = false
      const settle = (v: typeof google.maps | null) => {
        if (settled) return
        settled = true
        resolve(v)
      }

      // FIX 2026-08-01 (verificado en local con key dummy) — `s.onerror` NUNCA dispara por key
      // inválida: el script de Google carga OK (200) con cualquier key, la validación es
      // ASÍNCRONA y el propio SDK la reporta vía el callback global `gm_authFailure` — el
      // comentario viejo de acá abajo ("key inválida... termina en onerror") era incorrecto,
      // nunca se había probado con una key rota. Sin esto, una key inválida/restringida a otro
      // dominio resolvía igual `window.google.maps` (el objeto existe, solo los tiles fallan) y
      // el caller mostraba un mapa roto en vez de caer al iframe.
      window.gm_authFailure = () => settle(null)

      const existing = document.getElementById(SCRIPT_ID)
      if (existing) {
        existing.addEventListener('load', () => settle(window.google?.maps ?? null))
        existing.addEventListener('error', () => settle(null))
        return
      }
      const s = document.createElement('script')
      s.id = SCRIPT_ID
      s.async = true
      // `libraries=geocoding` (GH-33): el reverse geocoding de la pantalla de Configuración usa
      // `google.maps.Geocoder`. Pedir la librería explícitamente evita depender de qué trae por
      // defecto el bundle del bootstrap, que cambia entre versiones del SDK. OJO: esto solo carga
      // el CÓDIGO cliente — la "Geocoding API" sigue siendo un producto aparte que hay que
      // habilitar para la key en Google Cloud, si no las consultas vuelven REQUEST_DENIED.
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geocoding&language=es`
      s.onerror = () => settle(null) // fallo de red/carga del script en sí (dominio inalcanzable, etc.)
      s.onload = () => settle(window.google?.maps ?? null)
      document.head.appendChild(s)
    })
  })()
  loaders.set(cacheKey, loader)
  return loader
}

/** Para tests / cambio de key en caliente: obliga a releer la configuración. */
export function resetGoogleMapsLoader(): void {
  loaders.clear()
}
