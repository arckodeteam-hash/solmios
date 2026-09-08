// shared/tests/phone-e164.test.ts
import { describe, it, expect } from 'bun:test'
import { toE164 } from '../utils/phone-e164'

describe('toE164', () => {
  it('agrega el prefijo del país del hotel a un número local', () => {
    expect(toE164('809-555-0000', 'DO')).toBe('18095550000')
    expect(toE164('(809) 555 0000', 'DO')).toBe('18095550000')
  })

  it('respeta el número que ya trae su prefijo', () => {
    expect(toE164('+1 809 555 0000', 'DO')).toBe('18095550000')
    expect(toE164('+52 55 1234 5678', 'DO')).toBe('525512345678')
    expect(toE164('001 809 555 0000', 'DO')).toBe('18095550000')
  })

  // El hotel a veces carga el número con prefijo pero sin el +. Duplicarlo lo rompe.
  it('no duplica el prefijo si el número ya lo trae', () => {
    expect(toE164('18095550000', 'DO')).toBe('18095550000')
  })

  it('el mismo número local da distinto según el país del hotel', () => {
    expect(toE164('5551234567', 'MX')).toBe('525551234567')
    expect(toE164('5551234567', 'CO')).toBe('575551234567')
  })

  // El bug documentado: sin país y sin prefijo, "8095550000" es ambiguo. Adivinar es peor que
  // frenar: mandarle la reserva de un huésped a un desconocido no se deshace.
  it('sin país conocido, un número local es ambiguo y se rechaza', () => {
    expect(toE164('8095550000', null)).toBeNull()
    expect(toE164('8095550000', 'XX')).toBeNull()
  })

  it('sin país, un internacional completo sí se acepta', () => {
    expect(toE164('18095550000', null)).toBe('18095550000')
  })

  it('rechaza lo que no es un teléfono', () => {
    expect(toE164('', 'DO')).toBeNull()
    expect(toE164(null, 'DO')).toBeNull()
    expect(toE164('sin teléfono', 'DO')).toBeNull()
    expect(toE164('123', 'DO')).toBeNull()
    expect(toE164('1'.repeat(20), 'DO')).toBeNull()
  })
})
