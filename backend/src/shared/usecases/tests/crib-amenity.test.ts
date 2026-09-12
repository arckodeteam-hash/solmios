// shared/usecases/tests/crib-amenity.test.ts — #292 (revisión): la cuna se reconocía SOLO por el
// literal `custom:cuna`; "Cuna para bebé", "Crib" o "Berço" generan otro slug y quedaban afuera.
import { describe, it, expect } from 'bun:test'
import { CRIB_AMENITY_KEY, isCribAmenityKey } from '../crib-amenity'

describe('isCribAmenityKey — reconocimiento de la cuna entre las amenidades personalizadas', () => {
  it('la key canónica y sus alias por idioma', () => {
    expect(CRIB_AMENITY_KEY).toBe('custom:cuna')
    expect(isCribAmenityKey('custom:cuna')).toBe(true)
    expect(isCribAmenityKey('custom:crib')).toBe(true)
    expect(isCribAmenityKey('custom:berco')).toBe(true)
    expect(isCribAmenityKey('custom:berço')).toBe(true)
  })

  it('slug derivado de un nombre más largo ("Cuna para bebé" → custom:cuna_para_bebe)', () => {
    expect(isCribAmenityKey('custom:cuna_para_bebe')).toBe(true)
    expect(isCribAmenityKey('custom:baby_crib')).toBe(true)
    expect(isCribAmenityKey('custom:berco_de_bebe')).toBe(true)
  })

  it('decide por el NOMBRE cuando la key no lo dice (fila con key custom y nombre editado)', () => {
    expect(isCribAmenityKey('custom:extra_1', 'Cuna para bebé')).toBe(true)
    expect(isCribAmenityKey('custom:extra_1', 'Crib')).toBe(true)
    expect(isCribAmenityKey('custom:extra_1', 'Berço')).toBe(true)
    expect(isCribAmenityKey('custom:extra_1', 'CUNA')).toBe(true)
  })

  it('palabra entera: "Cunas"/"Cribs"/"Incubadora" no son cuna; "Cama cuna" sí', () => {
    expect(isCribAmenityKey('custom:cunas', 'Cunas')).toBe(false)
    expect(isCribAmenityKey('custom:cribs')).toBe(false)
    expect(isCribAmenityKey('custom:incubadora', 'Incubadora')).toBe(false)
    expect(isCribAmenityKey('custom:cama_cuna', 'Cama cuna')).toBe(true)
  })

  it('nunca una key fija del catálogo ni basura, aunque el nombre diga cuna', () => {
    expect(isCribAmenityKey('wifi', 'Cuna')).toBe(false)
    expect(isCribAmenityKey('cuna')).toBe(false)
    expect(isCribAmenityKey('', 'Cuna')).toBe(false)
    expect(isCribAmenityKey(null, 'Cuna')).toBe(false)
    expect(isCribAmenityKey(undefined)).toBe(false)
    expect(isCribAmenityKey('custom:cama_extra', 'Cama extra')).toBe(false)
    expect(isCribAmenityKey('custom:cama_extra', 42)).toBe(false)
  })
})
