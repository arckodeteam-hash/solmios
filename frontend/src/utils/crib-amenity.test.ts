// utils/crib-amenity.test.ts — #292 (revisión): espejo del test del backend
// (`shared/usecases/tests/crib-amenity.test.ts`). Si cambia la regla de un lado, cambia acá.
import { describe, it, expect } from 'vitest'
import { CRIB_AMENITY_KEY, isCribAmenityKey } from './crib-amenity'

describe('isCribAmenityKey', () => {
  it('key canónica y alias por idioma/slug', () => {
    expect(CRIB_AMENITY_KEY).toBe('custom:cuna')
    for (const k of ['custom:cuna', 'custom:crib', 'custom:berco', 'custom:berço', 'custom:cuna_para_bebe', 'custom:baby_crib']) {
      expect(isCribAmenityKey(k), k).toBe(true)
    }
  })

  it('por nombre cuando la key no lo dice; palabra entera; nunca una key fija', () => {
    expect(isCribAmenityKey('custom:extra_1', 'Cuna para bebé')).toBe(true)
    expect(isCribAmenityKey('custom:extra_1', 'Berço')).toBe(true)
    expect(isCribAmenityKey('custom:extra_1', 'Crib')).toBe(true)
    expect(isCribAmenityKey('custom:cunas', 'Cunas')).toBe(false)
    expect(isCribAmenityKey('custom:cama_extra', 'Cama extra')).toBe(false)
    expect(isCribAmenityKey('wifi', 'Cuna')).toBe(false)
    expect(isCribAmenityKey(null)).toBe(false)
    expect(isCribAmenityKey('')).toBe(false)
  })
})
