// Regresión de T-registro-ref: el link de referido que termina en el home.
//
// El catch-all del router (`/:pathMatch(.*)*` → `redirect: '/'`) se traga cualquier URL que no
// matchee EXACTO y deja al visitante en la landing. Reproducido contra producción
// (hotel.zx89.site, 2026-08-21, build `index-CRalTcqz.js`), navegador limpio y SIN sesión:
//
//   /registro?ref=hotel-ortiz-3fc8     → /registro?ref=…  h1 "Creá tu cuenta"
//   /registro//?ref=hotel-ortiz-3fc8   → /?ref=…          h1 "Gestiona tu hotel con total control"
//   //registro?ref=hotel-ortiz-3fc8    → /?ref=…          idem
//   /registro%20?ref=hotel-ortiz-3fc8  → /?ref=…          idem
//   /registro.?ref=hotel-ortiz-3fc8    → /?ref=…          idem
//
// El `?ref=` sigue en la barra pero la landing no lo lee: se pierde el alta Y la atribución.
// Son las formas que WhatsApp, el correo y cualquier cliente que autolinkea le pegan a un link.
import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { cleanPath, cleanSegment, installMangledPathRecovery } from './recover-path'

const Stub = { template: '<div />' }

/**
 * Router con la MISMA forma que el real (`src/router/index.ts`): rutas públicas con query que
 * importa, el puente `/r/:code` y el catch-all que redirige a la landing. Se instala el guard
 * de producción, no una copia.
 */
function makeRouter(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: Stub },
      { path: '/registro', name: 'registro', component: Stub },
      { path: '/verificar-email', name: 'verificar-email', component: Stub },
      { path: '/reset-password', name: 'reset-password', component: Stub },
      { path: '/book/:slug', name: 'booking-widget', component: Stub },
      // Espejo exacto del record real (`src/router/index.ts`), `cleanSegment` incluido.
      { path: '/r/:code', redirect: (to) => ({ path: '/registro', query: { ref: cleanSegment(String(to.params.code)) } }) },
      { path: '/:pathMatch(.*)*', name: 'not-found', redirect: '/' },
    ],
  })
  installMangledPathRecovery(router)
  return router
}

describe('link de referido sucio — no debe terminar en el home', () => {
  // Las 4 formas reproducidas contra producción. Antes del fix todas caían en `/`.
  const sucias = [
    ['barra duplicada al final', '/registro//?ref=hotel-ortiz-3fc8'],
    ['barra duplicada al principio', '//registro?ref=hotel-ortiz-3fc8'],
    ['espacio pegado (%20)', '/registro%20?ref=hotel-ortiz-3fc8'],
    ['punto pegado al final', '/registro.?ref=hotel-ortiz-3fc8'],
    ['espacio crudo', '/registro ?ref=hotel-ortiz-3fc8'],
    ['paréntesis de markdown', '/registro)?ref=hotel-ortiz-3fc8'],
  ] as const

  it.each(sucias)('%s → muestra el alta, no la landing', async (_caso, url) => {
    const router = makeRouter()
    await router.push(url)
    expect(router.currentRoute.value.name).toBe('registro')
  })

  it.each(sucias)('%s → conserva el código de referido', async (_caso, url) => {
    const router = makeRouter()
    await router.push(url)
    // Sin esto el alta se crea sin atribución: el hotel que refirió no cobra sus meses gratis.
    expect(router.currentRoute.value.query.ref).toBe('hotel-ortiz-3fc8')
  })

  // `/r/<código>.` NO cae en el catch-all: el punto entra al param `:code`, la ruta matchea y el
  // código roto viaja al `?ref=`. Otro agujero, mismo origen — lo tapa `cleanSegment`.
  it('el link corto /r/:code sucio llega al alta con el código SANO', async () => {
    const router = makeRouter()
    await router.push('/r/hotel-ortiz-3fc8.')
    expect(router.currentRoute.value.name).toBe('registro')
    expect(router.currentRoute.value.query.ref).toBe('hotel-ortiz-3fc8')
  })
})

describe('otras rutas públicas con query que decide el resultado', () => {
  it('/verificar-email conserva el status tras limpiar la URL', async () => {
    const router = makeRouter()
    await router.push('/verificar-email.?status=ok')
    expect(router.currentRoute.value.name).toBe('verificar-email')
    expect(router.currentRoute.value.query.status).toBe('ok')
  })

  it('/reset-password conserva el token tras limpiar la URL', async () => {
    const router = makeRouter()
    await router.push('//reset-password?token=abc123')
    expect(router.currentRoute.value.name).toBe('reset-password')
    expect(router.currentRoute.value.query.token).toBe('abc123')
  })

  it('el widget de reserva conserva el slug y el hash', async () => {
    const router = makeRouter()
    await router.push('/book/hotel-ortiz//?adults=2#fechas')
    expect(router.currentRoute.value.name).toBe('booking-widget')
    expect(router.currentRoute.value.params.slug).toBe('hotel-ortiz')
    expect(router.currentRoute.value.query.adults).toBe('2')
    expect(router.currentRoute.value.hash).toBe('#fechas')
  })
})

describe('el rescate no inventa destinos', () => {
  it('una URL que no existe ni limpia sigue cayendo en la landing', async () => {
    const router = makeRouter()
    await router.push('/no-existe-esta-ruta?ref=x')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('una URL sucia de una ruta inexistente también cae en la landing (sin loop)', async () => {
    const router = makeRouter()
    await router.push('//no-existe//?ref=x')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('no toca las URLs que ya matchean', async () => {
    const router = makeRouter()
    await router.push('/registro?ref=hotel-ortiz-3fc8')
    expect(router.currentRoute.value.name).toBe('registro')
    expect(router.currentRoute.value.fullPath).toBe('/registro?ref=hotel-ortiz-3fc8')
  })

  it('la barra final legítima se sigue respetando (ya matcheaba antes)', async () => {
    const router = makeRouter()
    await router.push('/registro/?ref=hotel-ortiz-3fc8')
    expect(router.currentRoute.value.name).toBe('registro')
  })
})

describe('cleanPath', () => {
  it('devuelve null cuando no hay nada que limpiar', () => {
    expect(cleanPath('/registro')).toBeNull()
    expect(cleanPath('/panel/dashboard')).toBeNull()
  })

  it('devuelve null si limpiar deja solo la raíz (no hay destino que rescatar)', () => {
    expect(cleanPath('//')).toBeNull()
    expect(cleanPath('/.')).toBeNull()
  })

  it('colapsa barras, recorta espacios y puntuación pegada', () => {
    expect(cleanPath('//registro')).toBe('/registro')
    expect(cleanPath('/registro//')).toBe('/registro')
    expect(cleanPath('/registro%20')).toBe('/registro')
    expect(cleanPath('/registro.')).toBe('/registro')
    expect(cleanPath('/registro),')).toBe('/registro')
  })

  it('no destroza un segmento que legítimamente lleva puntos en el medio', () => {
    expect(cleanPath('/p/terminos-v1.2')).toBeNull()
  })
})

describe('cleanSegment', () => {
  it('saca la puntuación y los espacios que pega el cliente de chat', () => {
    expect(cleanSegment('hotel-ortiz-3fc8.')).toBe('hotel-ortiz-3fc8')
    expect(cleanSegment('hotel-ortiz-3fc8)')).toBe('hotel-ortiz-3fc8')
    expect(cleanSegment('hotel-ortiz-3fc8%20')).toBe('hotel-ortiz-3fc8')
  })

  it('no toca un código sano', () => {
    expect(cleanSegment('hotel-ortiz-3fc8')).toBe('hotel-ortiz-3fc8')
  })
})
