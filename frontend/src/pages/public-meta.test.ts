// public-meta.test.ts — <head> de las páginas públicas del producto.
//
// El bug: la home y la landing del Programa Hotel Fundador no declaraban metadatos, así que
// ambas se anunciaban como "SolmiOS — Hospitality OS" (el título por defecto de la SPA) y
// competían entre sí por las mismas consultas.
import { describe, it, expect } from 'vitest'

import { PUBLIC_PAGE_META } from './public-meta'
import { AUTH_PAGE_META } from './auth/auth-meta'
import type { PageMeta } from '@/composables/usePageMeta'

const PAGES = Object.entries(PUBLIC_PAGE_META) as [string, PageMeta][]

describe('páginas públicas del producto', () => {
  it('cada una declara título propio con el sufijo de marca', () => {
    for (const [name, meta] of PAGES) {
      expect(meta.title, name).toContain('SolmiOS')
      expect(meta.title.length, name).toBeGreaterThan(10)
    }
  })

  it('los títulos son distintos entre sí y del default de la SPA', () => {
    const titles = PAGES.map(([, m]) => m.title)
    expect(new Set(titles).size).toBe(titles.length)
    expect(titles).not.toContain('SolmiOS — Hospitality OS')
  })

  it('son indexables y declaran canonical y Open Graph: son la cara pública', () => {
    for (const [name, meta] of PAGES) {
      expect(meta.index, name).not.toBe(false)
      expect(meta.canonicalPath, name).toBeTruthy()
      expect(meta.social, name).toBe(true)
    }
  })

  it('la home es canónica en "/" y no en una variante con query o barra de más', () => {
    expect(PUBLIC_PAGE_META.landing.canonicalPath).toBe('/')
  })

  it('las descriptions caben en un snippet de buscador', () => {
    for (const [name, meta] of PAGES) {
      expect(meta.description, name).toBeTruthy()
      expect(meta.description!.length, name).toBeLessThanOrEqual(160)
      expect(meta.description!.length, name).toBeGreaterThan(80)
    }
  })
})

describe('coherencia con el sitemap del backend', () => {
  it('lo indexable del frontend es exactamente lo que el sitemap declara', () => {
    // `STATIC_SITEMAP_PATHS` (backend/src/modules/bookingengine/usecases/sitemap.ts) lista estas
    // mismas tres. Son proyectos separados y no se pueden importar entre sí, así que el par de
    // tests actúa de candado: agregar una página indexable de un solo lado rompe este.
    const indexables = [
      ...Object.values(PUBLIC_PAGE_META),
      ...Object.values(AUTH_PAGE_META as Record<string, PageMeta>),
    ]
      .filter((m) => m.canonicalPath)
      .map((m) => m.canonicalPath!)
      .sort()

    expect(indexables).toEqual(['/', '/hotel-fundador', '/registro'])
  })

  it('ninguna página noindex declara canonical (no debe entrar al sitemap)', () => {
    for (const [name, meta] of Object.entries(AUTH_PAGE_META as Record<string, PageMeta>)) {
      if (meta.index === false) expect(meta.canonicalPath, name).toBeUndefined()
    }
  })
})
