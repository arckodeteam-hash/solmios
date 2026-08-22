// recover-path.ts — rescate de URLs públicas que llegan "sucias".
//
// EL BUG (T-registro-ref). El catch-all del router es `{ path: '/:pathMatch(.*)*', redirect: '/' }`.
// Cualquier URL que no matchee EXACTO cae ahí y termina en la landing. Para una ruta del panel eso
// es aceptable; para un link público de entrada es perder al visitante: el link de referido
// `/registro?ref=<código>` llega por WhatsApp, mail o un mensaje, y esos clientes le pegan basura
// al final o duplican la barra. Verificado contra producción (hotel.zx89.site, 2026-08-21):
//
//   /registro?ref=hotel-ortiz-3fc8     → /registro?ref=…   ✅ el alta
//   /registro//?ref=hotel-ortiz-3fc8   → /?ref=…           ❌ la landing
//   //registro?ref=hotel-ortiz-3fc8    → /?ref=…           ❌ la landing
//   /registro%20?ref=hotel-ortiz-3fc8  → /?ref=…           ❌ la landing
//   /registro.?ref=hotel-ortiz-3fc8    → /?ref=…           ❌ la landing
//
// El `?ref=` sobrevive en la barra de direcciones, pero la landing no lo lee: la atribución del
// referido se pierde y el visitante ve el home en vez del formulario. Mismo agujero para
// `/verificar-email?token=`, `/reset-password?token=`, `/r/:code` y `/book/:slug`.
//
// La corrección: ANTES de dejar que el catch-all mande a `/`, limpiar la ruta. Solo se aceptan
// transformaciones reversibles (espacios, barras duplicadas, puntuación pegada al final) y solo
// si lo limpiado resuelve a una ruta REAL — si no, sigue el camino de siempre.

import type { Router } from 'vue-router'

/** Puntuación que los clientes de chat/mail/markdown pegan al final de un link. */
const TRAILING_JUNK = /[.,;:!?)\]}>"'»…]+$/

/** Percent-encodings de espacio en blanco. Se decodifican SOLO estos para poder recortarlos. */
const ENCODED_WHITESPACE = /%(?:20|09|0a|0d)/gi

/**
 * Devuelve la versión limpia de `path`, o `null` si no hay nada que limpiar (o si limpiar no
 * deja nada útil). No decide si la ruta existe: eso lo resuelve quien llama, con el router.
 */
export function cleanPath(path: string): string | null {
  let out = path.replace(ENCODED_WHITESPACE, ' ')
  out = out.replace(/\/{2,}/g, '/')   // //registro y /registro// → /registro/
  out = out.trim()
  out = out.replace(TRAILING_JUNK, '')
  out = out.trim()
  out = out.replace(/\/+$/, '')       // /registro/ → /registro (la ruta base ya matchea igual)
  if (!out.startsWith('/')) out = '/' + out
  if (out === '/' || out === path) return null
  return out
}

/**
 * Limpia un segmento de URL usado como identificador (el `:code` de `/r/:code`). Mismo problema
 * que `cleanPath` pero un escalón más adentro: `/r/hotel-ortiz-3fc8.` SÍ matchea la ruta, así que
 * el catch-all nunca se entera — el punto entra al `?ref=` y el código queda roto (el backend no
 * lo encuentra, no se muestra "Te invitó X" y el alta se manda sin atribución). Los códigos son
 * `slug-hex4` (backend `referrals/usecases/share-link.ts`): nunca llevan puntuación ni espacios.
 */
export function cleanSegment(value: string): string {
  return value.replace(ENCODED_WHITESPACE, ' ').trim().replace(TRAILING_JUNK, '').trim()
}

/**
 * Instala el guard de rescate en un router. Se exporta como función (en vez de escribirlo inline
 * en `router/index.ts`) para poder probar EL MISMO guard que se despacha, sobre un router chico,
 * sin arrastrar las ~90 rutas reales ni sus componentes lazy.
 *
 * Cuando un record con `redirect` matchea, vue-router lo resuelve ANTES de correr los guards: `to`
 * ya es el destino (`/`) y la URL original queda en `to.redirectedFrom`. Por eso se mira
 * `redirectedFrom.name === 'not-found'` y no `to.name`.
 */
export function installMangledPathRecovery(router: Router): void {
  // Un intento por URL sucia. Vue Router ARRASTRA `redirectedFrom` a través del redirect que
  // devuelve el guard: sin esta marca el guard se vuelve a disparar sobre el destino ya limpio y
  // vue-router aborta con "Infinite redirect in navigation guard". Las navegaciones son
  // secuenciales, así que alcanza con recordar la última intentada.
  let attempted: string | null = null

  router.beforeEach((to) => {
    const from404 = to.redirectedFrom
    if (from404?.name !== 'not-found') {
      attempted = null
      return true
    }
    if (attempted === from404.path) {
      attempted = null
      return true
    }
    const fixed = cleanPath(from404.path)
    // Solo se redirige si lo limpiado es una ruta DE VERDAD. Si no, sigue el camino de siempre
    // (la landing): limpiar no puede inventar destinos.
    if (!fixed || router.resolve(fixed).name === 'not-found') return true
    attempted = from404.path
    return { path: fixed, query: from404.query, hash: from404.hash }
  })
}
