// composables/usePageMeta.ts — <head> propio para las páginas estáticas de la app (auth, etc).
//
// Por qué existe: la SPA solo tenía el `<title>`/`<description>` de index.html, iguales para
// TODAS las páginas, y el único mecanismo dinámico (`usePageTitle`) está acoplado al panel —
// su diccionario son módulos internos y su fallback es "Dashboard". O sea: /registro, /login y
// las de contraseña compartían el título genérico del producto, /registro (la única de conversión)
// no tenía descripción ni Open Graph propios, y navegar del panel a /login dejaba colgado el
// título del panel, porque el watch de usePageTitle muere con el layout y nadie restauraba.
//
// Para la landing pública de un hotel existe `useHotelMetaTags` (metadatos derivados del hotel);
// esto es su equivalente para páginas cuyo contenido es fijo y se conoce en tiempo de compilación.

import { onBeforeUnmount, onMounted } from 'vue'
import { setMetaTag, setLinkTag, removeTagsById } from './head-tags'

/** Defaults de index.html. Si cambian allá, cambian acá — es lo que se restaura al salir. */
const DEFAULT_TITLE = 'SolmiOS — Hospitality OS'
const DEFAULT_DESCRIPTION = 'SolmiOS — Hospitality OS. Sistema integral de gestión hotelera con planning, reservas, channel manager y pagos.'

/**
 * Origen público del sitio, para el canonical. El mismo build se sirve en el dominio público y
 * en el de origen (hoy solmios.com y hotel.zx89.site): si el canonical usara
 * `window.location.origin`, cada dominio se declararía canónico de sí mismo y Google vería el
 * mismo contenido duplicado en dos sitios. Se fija uno y se lo puede cambiar por build.
 * El default coincide con el que ya usa el sitemap que emite el backend.
 */
const SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL ?? 'https://solmios.com').replace(/\/+$/, '')

/** Ids de los tags que gestiona este composable — se limpian juntos al salir de la página. */
const MANAGED_IDS = [
  'meta-description', 'meta-robots', 'canonical-link',
  'og-title', 'og-description', 'og-type', 'og-url', 'og-site-name',
  'twitter-card', 'twitter-title', 'twitter-description',
] as const

export interface PageMeta {
  /** Se muestra como `<title>` tal cual. Incluí vos el sufijo de marca. */
  title: string
  description?: string
  /**
   * `false` → `noindex`. Default `true`.
   * Ponelo en false para todo lo que no sea contenido de búsqueda: paneles, utilidades de cuenta
   * y cualquier URL que lleve un token.
   */
  index?: boolean
  /** `false` → `nofollow`. Default `true`. */
  follow?: boolean
  /**
   * Path del canonical, SIN query (`/registro`). Los parámetros de campaña (`?plan=`, `?ref=`)
   * son variantes de la misma página: dejarlos afuera consolida las señales en una sola URL.
   * Omitilo en páginas `noindex` — un canonical ahí no aporta nada.
   */
  canonicalPath?: string
  /** Agrega Open Graph + Twitter Card. Solo tiene sentido si el link se comparte. */
  social?: boolean
}

/**
 * Quién escribió el `<head>` que está puesto ahora mismo.
 *
 * Durante una transición de ruta las dos páginas conviven un instante, y el orden de los hooks
 * no está garantizado (con `<Transition>` o rutas async la que se va puede desmontarse DESPUÉS
 * de que la que llega montó). Sin este dueño, ese cleanup tardío borraba el `<head>` recién
 * escrito y la página nueva se quedaba sin título, sin canonical y sin Open Graph.
 * Cada página solo revierte si al irse sigue siendo la dueña.
 */
let currentOwner: symbol | null = null

/** Escribe el `<head>` de la página y lo revierte al salir, si nadie lo tomó mientras tanto. */
export function usePageMeta(meta: PageMeta): void {
  const index = meta.index ?? true
  const follow = meta.follow ?? true
  const token = Symbol('page-meta')

  onMounted(() => {
    if (typeof document === 'undefined') return
    currentOwner = token

    document.title = meta.title

    const description = meta.description ?? DEFAULT_DESCRIPTION
    setMetaTag('name', 'description', 'meta-description', description)
    setMetaTag('name', 'robots', 'meta-robots', `${index ? 'index' : 'noindex'},${follow ? 'follow' : 'nofollow'}`)

    if (meta.canonicalPath) setLinkTag('canonical', 'canonical-link', `${SITE_URL}${meta.canonicalPath}`)

    if (meta.social) {
      setMetaTag('property', 'og:title', 'og-title', meta.title)
      setMetaTag('property', 'og:description', 'og-description', description)
      setMetaTag('property', 'og:type', 'og-type', 'website')
      setMetaTag('property', 'og:site_name', 'og-site-name', 'SolmiOS')
      if (meta.canonicalPath) setMetaTag('property', 'og:url', 'og-url', `${SITE_URL}${meta.canonicalPath}`)
      setMetaTag('name', 'twitter:card', 'twitter-card', 'summary')
      setMetaTag('name', 'twitter:title', 'twitter-title', meta.title)
      setMetaTag('name', 'twitter:description', 'twitter-description', description)
    }
  })

  // Sin esto, el título y el `noindex` de esta página quedan puestos en la siguiente. Un
  // `noindex` filtrado a la landing la sacaría del índice de Google.
  onBeforeUnmount(() => {
    if (typeof document === 'undefined') return
    // Otra página ya tomó el <head>: revertir acá le borraría el suyo.
    if (currentOwner !== token) return
    currentOwner = null
    document.title = DEFAULT_TITLE
    setMetaTag('name', 'description', 'meta-description', DEFAULT_DESCRIPTION)
    removeTagsById(MANAGED_IDS.filter(id => id !== 'meta-description'))
  })
}
