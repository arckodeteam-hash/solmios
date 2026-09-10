// normalize-message.test.ts — REQ-SOP-02/04: normaliza `messages` en lectura, nunca lanza.
import { describe, it, expect } from 'bun:test'
import { normalizeMessages } from '../usecases/normalize-message'

describe('normalizeMessages', () => {
  it('[] → []', () => {
    expect(normalizeMessages([])).toEqual([])
  })

  it('forma nueva ya persistida se conserva tal cual', () => {
    const result = normalizeMessages([
      { id: 'm1', authorId: 'u1', authorName: 'Ana', authorKind: 'hotel', message: 'Hola', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(result).toEqual([
      { id: 'm1', authorId: 'u1', authorName: 'Ana', authorKind: 'hotel', message: 'Hola', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('forma vieja { author, date, message }: "Soporte Arckode" → support', () => {
    const result = normalizeMessages([{ author: 'Soporte Arckode', date: '5 ene, 10:00', message: 'Ya lo revisamos' }])
    expect(result).toEqual([
      { id: '', authorId: '', authorName: 'Soporte Arckode', authorKind: 'support', message: 'Ya lo revisamos', createdAt: '5 ene, 10:00' },
    ])
  })

  it('forma vieja { author, date, message }: cualquier otro autor → hotel', () => {
    const result = normalizeMessages([{ author: 'Hotel Boutique Palma', date: '5 ene, 10:05', message: 'Gracias' }])
    expect(result[0].authorKind).toBe('hotel')
    expect(result[0].authorId).toBe('')
  })

  it('JSON string válido se parsea', () => {
    const result = normalizeMessages(JSON.stringify([{ author: 'Soporte Arckode', date: 'x', message: 'y' }]))
    expect(result).toHaveLength(1)
    expect(result[0].authorKind).toBe('support')
  })

  it('JSON inválido → [] sin lanzar', () => {
    expect(() => normalizeMessages('{esto no es json')).not.toThrow()
    expect(normalizeMessages('{esto no es json')).toEqual([])
  })

  it('valor no-array (objeto, null, número) → []', () => {
    expect(normalizeMessages({ foo: 'bar' })).toEqual([])
    expect(normalizeMessages(null)).toEqual([])
    expect(normalizeMessages(42)).toEqual([])
    expect(normalizeMessages(undefined)).toEqual([])
  })

  it('elemento del array que no matchea ninguna forma se descarta sin lanzar', () => {
    expect(normalizeMessages([{ foo: 'bar' }, null, 'string suelto'])).toEqual([])
  })

  it('mezcla de forma vieja y nueva en el mismo array', () => {
    const result = normalizeMessages([
      { author: 'Soporte Arckode', date: 'ayer', message: 'vieja' },
      { id: 'm2', authorId: 'u1', authorName: 'Hotel', authorKind: 'hotel', message: 'nueva', createdAt: 'hoy' },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].authorKind).toBe('support')
    expect(result[1].authorKind).toBe('hotel')
  })
})
