// sitemap.test.ts — Qué declara el sitemap del sitio.
//
// El bug: el sitemap listaba SOLO las landings de hotel (`/h/:slug`), así que las páginas con
// las que se busca y se contrata el producto —la home y el alta— quedaban afuera. El sitio se
// anunciaba a Google como un directorio de hoteles y nada más.
import { describe, it, expect } from 'bun:test'

import { buildSitemapXml, STATIC_SITEMAP_PATHS, resolveBaseUrl } from '../usecases/sitemap'

const BASE = 'https://solmios.com'
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

describe('buildSitemapXml — páginas del producto', () => {
  it('incluye la home y el alta aunque no haya ningún hotel publicado', () => {
    const out = locs(buildSitemapXml(BASE, []))
    expect(out).toContain('https://solmios.com/')
    expect(out).toContain('https://solmios.com/registro')
  })

  it('declara la home con barra final, no como origin pelado', () => {
    expect(locs(buildSitemapXml(BASE, []))).toContain('https://solmios.com/')
    expect(locs(buildSitemapXml(BASE, []))).not.toContain('https://solmios.com')
  })

  it('NO anuncia ninguna página que el frontend marca noindex', () => {
    // Listar en el sitemap una URL que después responde `noindex` es una señal contradictoria.
    const out = locs(buildSitemapXml(BASE, [{ slug: 'hotel-a' }]))
    for (const p of ['/login', '/forgot-password', '/reset-password', '/change-password', '/panel', '/admin']) {
      expect(out.some((l) => l.endsWith(p)), p).toBe(false)
    }
  })

  it('las páginas del producto van primero y después el directorio de hoteles', () => {
    const out = locs(buildSitemapXml(BASE, [{ slug: 'hotel-a' }, { slug: 'hotel-b' }]))
    expect(out.slice(0, STATIC_SITEMAP_PATHS.length).every((l) => !l.includes('/h/'))).toBe(true)
    expect(out).toContain('https://solmios.com/h/hotel-a')
    expect(out).toContain('https://solmios.com/h/hotel-b')
    expect(out).toHaveLength(STATIC_SITEMAP_PATHS.length + 2)
  })

  it('respeta el baseUrl y no duplica la barra', () => {
    const out = locs(buildSitemapXml('https://otro.com/', [{ slug: 'x' }]))
    expect(out).toContain('https://otro.com/')
    expect(out).toContain('https://otro.com/registro')
    expect(out.some((l) => l.includes('//registro'))).toBe(false)
  })

  it('las estáticas no llevan lastmod inventado; las de hotel sí cuando existe', () => {
    const xml = buildSitemapXml(BASE, [{ slug: 'h1', updatedAt: '2026-01-02T03:04:05.000Z' }])
    expect((xml.match(/<lastmod>/g) ?? [])).toHaveLength(1)
    expect(xml).toContain('<lastmod>2026-01-02T03:04:05.000Z</lastmod>')
  })

  it('sigue siendo XML válido con cero hoteles', () => {
    const xml = buildSitemapXml(BASE, [])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
    expect(xml).not.toContain('<url>\n\n')
  })

  it('escapa caracteres reservados del slug de un hotel', () => {
    expect(buildSitemapXml(BASE, [{ slug: 'a&b' }])).toContain('/h/a&amp;b')
  })
})

describe('resolveBaseUrl', () => {
  it('PUBLIC_BASE_URL gana sobre el host del request', () => {
    const prev = process.env.PUBLIC_BASE_URL
    process.env.PUBLIC_BASE_URL = 'https://solmios.com'
    expect(resolveBaseUrl({ headers: { host: 'origen-interno.local' } })).toBe('https://solmios.com')
    if (prev === undefined) delete process.env.PUBLIC_BASE_URL
    else process.env.PUBLIC_BASE_URL = prev
  })
})
