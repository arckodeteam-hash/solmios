// auth-meta.test.ts — La política de <head> de las páginas de cuenta.
//
// El bug: las 5 páginas compartían el `<title>` y la `<description>` genéricos de index.html
// ("SolmiOS — Hospitality OS"); /registro —la única de conversión— no tenía description,
// canonical ni Open Graph propios; y ninguna declaraba política de indexación, así que la URL
// de /reset-password, que lleva el token de restablecimiento, era indexable.
import { describe, it, expect } from 'vitest'

import { AUTH_PAGE_META } from './auth-meta'
import type { PageMeta } from '@/composables/usePageMeta'
import robots from '../../../public/robots.txt?raw'

// `satisfies` en el módulo preserva el tipo literal de cada entrada (bueno para autocompletado),
// así que la unión resultante no expone las props opcionales al iterar. El cast es seguro
// justamente porque `satisfies Record<string, PageMeta>` ya validó la forma en compilación.
const PAGES = Object.entries(AUTH_PAGE_META) as [string, PageMeta][]
/** `register` no declara `index` (usa el default indexable); tipar acá lo hace legible. */
const REGISTER: PageMeta = AUTH_PAGE_META.register

describe('política de <head> de las páginas de cuenta', () => {
  it('las cinco declaran título propio con el sufijo de marca', () => {
    expect(PAGES).toHaveLength(5)
    for (const [name, meta] of PAGES) {
      expect(meta.title, name).toMatch(/ — SolmiOS$/)
      expect(meta.title.replace(' — SolmiOS', '').length, name).toBeGreaterThan(0)
    }
  })

  it('ningún título se repite (si no, las pestañas vuelven a ser indistinguibles)', () => {
    const titles = PAGES.map(([, m]) => m.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('/registro es la única indexable: es la página de conversión', () => {
    expect(REGISTER.index).not.toBe(false)
    for (const [name, meta] of PAGES.filter(([n]) => n !== 'register')) {
      expect(meta.index, name).toBe(false)
    }
  })

  it('/registro declara canonical sin query y Open Graph', () => {
    const r = REGISTER
    expect(r.canonicalPath).toBe('/registro')
    expect(r.canonicalPath).not.toContain('?')
    expect(r.social).toBe(true)
    expect((r.description ?? '').length).toBeGreaterThan(80)
  })

  it('la página del token de restablecimiento va noindex Y nofollow', () => {
    const reset: PageMeta = AUTH_PAGE_META.resetPassword
    expect(reset.index).toBe(false)
    expect(reset.follow).toBe(false)
  })

  it('ninguna noindex declara canonical ni Open Graph (no aportan y confunden señales)', () => {
    for (const [name, meta] of PAGES.filter(([n]) => n !== 'register')) {
      expect(meta, name).not.toHaveProperty('canonicalPath')
      expect(meta, name).not.toHaveProperty('social')
    }
  })

  it('las descriptions caben en un snippet de buscador (~160 caracteres)', () => {
    for (const [name, meta] of PAGES) {
      if (meta.description) expect(meta.description.length, name).toBeLessThanOrEqual(160)
    }
  })
})

describe('robots.txt', () => {
  it('NO bloquea /registro — es la página que tiene que posicionar', () => {
    expect(robots).not.toMatch(/^Disallow:\s*\/registro\s*$/m)
  })

  it('ya no bloquea /register, una ruta que no existe en el router', () => {
    expect(robots).not.toMatch(/^Disallow:\s*\/register\s*$/m)
  })

  it('bloquea las utilidades de cuenta, incluida la que lleva el token', () => {
    // Segunda capa sobre el `noindex`: esta app es una SPA sin SSR, el meta se inyecta por JS y
    // un crawler que no lo ejecute (o que indexe antes de renderizar) no llega a verlo.
    for (const path of ['/login', '/forgot-password', '/reset-password', '/change-password']) {
      expect(robots, path).toMatch(new RegExp(`^Disallow:\\s*${path}\\s*$`, 'm'))
    }
  })

  it('bloquea panel y admin, y apunta al sitemap del dominio público', () => {
    expect(robots).toMatch(/^Disallow:\s*\/panel\/\s*$/m)
    expect(robots).toMatch(/^Disallow:\s*\/admin\/\s*$/m)
    expect(robots).toMatch(/^Sitemap:\s*https:\/\/solmios\.com\/sitemap\.xml\s*$/m)
  })
})
