// hotel-slug.test.ts — El slug público que se le asigna a un hotel al crearlo.
//
// Ancla una regresión concreta: el alta pública creaba el hotel SIN slug, y el único lugar que lo
// poblaba era un seeder que hay que correr a mano. Un hotel que se registraba quedaba sin página
// pública (`GET /api/public/hotels/:slug` no lo encontraba) y fuera del sitemap, sin ninguna señal.
import { describe, it, expect } from 'bun:test'
import { slugifyHotelName, shortHash, buildHotelSlug } from './hotel-slug'

const libre = async () => false
const ocupado = async () => true

describe('slugifyHotelName', () => {
  it('normaliza nombre, acentos y símbolos', () => {
    expect(slugifyHotelName('Hotel Boutique Palma')).toBe('hotel-boutique-palma')
    expect(slugifyHotelName('Posada Los Álamos')).toBe('posada-los-alamos')
    expect(slugifyHotelName('  Hostal   Ñandú & Co.  ')).toBe('hostal-nandu-co')
  })

  it('no deja guiones dobles ni de borde', () => {
    expect(slugifyHotelName('--Hotel -- Sol--')).toBe('hotel-sol')
  })

  it('un nombre sin letras utilizables da vacío (el caller decide el fallback)', () => {
    expect(slugifyHotelName('★★★')).toBe('')
    expect(slugifyHotelName('')).toBe('')
  })
})

describe('buildHotelSlug', () => {
  it('slug libre: el nombre tal cual', async () => {
    expect(await buildHotelSlug('h1', 'Hotel Boutique Palma', libre)).toBe('hotel-boutique-palma')
  })

  it('slug ocupado: desempata con el hash del ID, no del nombre', async () => {
    const a = await buildHotelSlug('hotel-a', 'Hotel Sol', ocupado)
    const b = await buildHotelSlug('hotel-b', 'Hotel Sol', ocupado)
    expect(a).toBe(`hotel-sol-${shortHash('hotel-a')}`)
    expect(b).toBe(`hotel-sol-${shortHash('hotel-b')}`)
    expect(a).not.toBe(b)   // dos hoteles con el MISMO nombre no chocan
  })

  it('es determinístico: recalcularlo da lo mismo', async () => {
    expect(await buildHotelSlug('h1', 'Hotel Sol', ocupado))
      .toBe(await buildHotelSlug('h1', 'Hotel Sol', ocupado))
  })

  it('nombre sin letras utilizables cae a hotel-<hash>, nunca a vacío', async () => {
    expect(await buildHotelSlug('h9', '★★★', libre)).toBe(`hotel-${shortHash('h9')}`)
    expect(await buildHotelSlug('h9', '', libre)).toBe(`hotel-${shortHash('h9')}`)
  })

  it('el fallback por nombre vacío no consulta colisión: el hash del id ya es único', async () => {
    let consultas = 0
    await buildHotelSlug('h9', '', async () => { consultas++; return false })
    expect(consultas).toBe(0)
  })
})
