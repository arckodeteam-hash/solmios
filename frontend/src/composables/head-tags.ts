// composables/head-tags.ts — Primitivas para escribir el <head> desde una SPA.
//
// Extraídas de useHotelMetaTags.ts, que las tenía privadas: al necesitar los mismos helpers
// para el <head> de las páginas estáticas (auth, landing) la opción era una tercera copia del
// mismo código DOM. Acá viven una sola vez y con tests.
//
// Limitación honesta (heredada, misma que documenta useHotelMetaTags): esto es una SPA sin SSR.
// Los tags se inyectan por DOM después de que corre el JS. Googlebot y los previews de
// WhatsApp/Facebook/X ejecutan JS antes de leer el <head> en la enorme mayoría de los casos, así
// que cubre el caso real dominante — pero un crawler que no ejecuta JS ve el HTML estático de
// index.html. La solución completa sería prerender/SSR, que es otro trabajo.

/**
 * Crea o actualiza un `<meta>`. Idempotente.
 *
 * Busca PRIMERO por el selector real (`[name=…]`/`[property=…]`) y recién después crea uno:
 * `index.html` ya trae un `<meta name="description">` estático SIN id, y buscar solo por id
 * creaba un SEGUNDO tag duplicado — el browser seguía leyendo el original (el primero del DOM)
 * y el meta nuevo no servía para nada. Bug verificado en producción en su momento; el orden de
 * búsqueda de acá es lo que lo evita.
 */
export function setMetaTag(attr: 'name' | 'property', key: string, id: string, content: string): void {
  if (typeof document === 'undefined') return
  let tag = (document.getElementById(id) ?? document.querySelector(`meta[${attr}="${key}"]`)) as HTMLMetaElement | null
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, key)
    document.head.appendChild(tag)
  }
  tag.id = id
  tag.setAttribute(attr, key)
  tag.setAttribute('content', content)
}

/** Crea o actualiza un `<link rel=…>` (canonical y similares). Mismo criterio de búsqueda. */
export function setLinkTag(rel: string, id: string, href: string): void {
  if (typeof document === 'undefined') return
  let tag = (document.getElementById(id) ?? document.querySelector(`link[rel="${rel}"]`)) as HTMLLinkElement | null
  if (!tag) {
    tag = document.createElement('link')
    tag.setAttribute('rel', rel)
    document.head.appendChild(tag)
  }
  tag.id = id
  tag.setAttribute('href', href)
}

/** Saca del `<head>` los tags gestionados por id. Lo que no existe se ignora. */
export function removeTagsById(ids: readonly string[]): void {
  if (typeof document === 'undefined') return
  for (const id of ids) document.getElementById(id)?.remove()
}
