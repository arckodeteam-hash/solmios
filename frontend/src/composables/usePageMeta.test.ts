// usePageMeta.test.ts — El <head> propio de las páginas estáticas.
//
// El bug: las 5 páginas de auth compartían el `<title>` y la `<description>` genéricos de
// index.html ("SolmiOS — Hospitality OS"), /registro —la única de conversión— no tenía
// description ni Open Graph propios, y ninguna declaraba política de indexación: la URL de
// /reset-password, que lleva el token de restablecimiento, era indexable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import { usePageMeta, type PageMeta } from './usePageMeta'

const DEFAULT_TITLE = 'SolmiOS — Hospitality OS'
const DEFAULT_DESCRIPTION = 'SolmiOS — Hospitality OS. Sistema integral de gestión hotelera con planning, reservas, channel manager y pagos.'

/** Reproduce el index.html real: ya trae una description estática SIN id. */
function seedStaticHead() {
  document.head.innerHTML = ''
  const m = document.createElement('meta')
  m.setAttribute('name', 'description')
  m.setAttribute('content', DEFAULT_DESCRIPTION)
  document.head.appendChild(m)
  document.title = DEFAULT_TITLE
}

function renderWith(meta: PageMeta) {
  return mount(defineComponent({ setup: () => { usePageMeta(meta); return () => h('div') } }))
}

const content = (sel: string) => document.head.querySelector(sel)?.getAttribute('content') ?? null
const href = (sel: string) => document.head.querySelector(sel)?.getAttribute('href') ?? null

beforeEach(seedStaticHead)
afterEach(() => { document.head.innerHTML = '' })

describe('usePageMeta', () => {
  it('le da a la página su propio título en vez del genérico de la SPA', () => {
    renderWith({ title: 'Iniciar sesión — SolmiOS' })
    expect(document.title).toBe('Iniciar sesión — SolmiOS')
  })

  it('NO duplica la description estática de index.html: reutiliza el tag existente', () => {
    // Regresión conocida del patrón: buscar solo por id creaba un segundo <meta name="description">
    // y el browser seguía leyendo el primero del DOM, así que la nueva no servía para nada.
    renderWith({ title: 'X', description: 'Descripción propia' })
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(content('meta[name="description"]')).toBe('Descripción propia')
  })

  it('por defecto la página es indexable', () => {
    renderWith({ title: 'X' })
    expect(content('meta[name="robots"]')).toBe('index,follow')
  })

  it('marca noindex cuando la página no es contenido de búsqueda', () => {
    renderWith({ title: 'X', index: false })
    expect(content('meta[name="robots"]')).toBe('noindex,follow')
  })

  it('marca noindex,nofollow para URLs con token (restablecer contraseña)', () => {
    renderWith({ title: 'X', index: false, follow: false })
    expect(content('meta[name="robots"]')).toBe('noindex,nofollow')
  })

  it('el canonical apunta al dominio público fijo, no al que sirvió la página', () => {
    // El mismo build corre en más de un dominio: derivar el canonical de window.location haría
    // que cada uno se declare canónico de sí mismo → contenido duplicado.
    renderWith({ title: 'X', canonicalPath: '/registro' })
    expect(href('link[rel="canonical"]')).toBe('https://solmios.com/registro')
  })

  it('sin canonicalPath no inventa un canonical', () => {
    renderWith({ title: 'X', index: false })
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('con `social` agrega Open Graph y Twitter Card coherentes con el título', () => {
    renderWith({ title: 'Crear cuenta gratis — SolmiOS', description: 'Probá gratis', canonicalPath: '/registro', social: true })
    expect(content('meta[property="og:title"]')).toBe('Crear cuenta gratis — SolmiOS')
    expect(content('meta[property="og:description"]')).toBe('Probá gratis')
    expect(content('meta[property="og:url"]')).toBe('https://solmios.com/registro')
    expect(content('meta[property="og:type"]')).toBe('website')
    expect(content('meta[property="og:site_name"]')).toBe('SolmiOS')
    expect(content('meta[name="twitter:title"]')).toBe('Crear cuenta gratis — SolmiOS')
  })

  it('sin `social` no ensucia el head con Open Graph', () => {
    renderWith({ title: 'X', index: false })
    expect(document.head.querySelector('meta[property^="og:"]')).toBeNull()
    expect(document.head.querySelector('meta[name^="twitter:"]')).toBeNull()
  })

  it('al salir restaura los defaults: un noindex filtrado sacaría la landing del índice', () => {
    const w = renderWith({ title: 'Restablecer contraseña — SolmiOS', description: 'x', index: false, follow: false, canonicalPath: '/x', social: true })
    expect(content('meta[name="robots"]')).toBe('noindex,nofollow')

    w.unmount()

    expect(document.title).toBe(DEFAULT_TITLE)
    expect(content('meta[name="description"]')).toBe(DEFAULT_DESCRIPTION)
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.head.querySelector('meta[property^="og:"]')).toBeNull()
    // Y la description sigue siendo UNA sola, no se acumulan tags entre navegaciones.
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
  })

  it('sobrevive al solapamiento de montaje: la página nueva monta ANTES de que la vieja se desmonte', () => {
    // Caso borde real de Vue Router: durante una transición las dos instancias conviven un
    // instante. Si el cleanup de la que se va corriera después del setup de la que llega, la
    // nueva se quedaría sin <head> (sin og:*, sin canonical, con el título anterior).
    const vieja = renderWith({ title: 'Vieja', description: 'dv', index: false })
    const nueva = renderWith({ title: 'Nueva', description: 'dn', canonicalPath: '/nueva', social: true })
    vieja.unmount() // llega tarde, a propósito

    expect(document.title).toBe('Nueva')
    expect(content('meta[name="description"]')).toBe('dn')
    expect(content('meta[name="robots"]')).toBe('index,follow')
    expect(href('link[rel="canonical"]')).toBe('https://solmios.com/nueva')
    expect(content('meta[property="og:title"]')).toBe('Nueva')
    nueva.unmount()
  })

  it('navegar entre dos páginas no acumula tags ni arrastra el head anterior', () => {
    const a = renderWith({ title: 'A', description: 'da', index: false })
    a.unmount()
    const b = renderWith({ title: 'B', description: 'db', canonicalPath: '/b', social: true })

    expect(document.title).toBe('B')
    expect(content('meta[name="robots"]')).toBe('index,follow')
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    b.unmount()
  })
})
