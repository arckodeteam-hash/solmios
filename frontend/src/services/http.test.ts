import { describe, it, expect } from 'vitest'
import { toApiUrl } from './http'

// Regresión: `'/apikeys'.startsWith('/api')` es true → la ruta salía sin `/api/` y daba 404.
describe('toApiUrl', () => {
  it('prefija /api a las rutas de los services', () => {
    expect(toApiUrl('/webhooks')).toBe('/api/webhooks')
    expect(toApiUrl('/admin/hoteles?page=2')).toBe('/api/admin/hoteles?page=2')
  })
  it('NO confunde /apikeys ni /api-keys con una ruta ya prefijada', () => {
    expect(toApiUrl('/apikeys')).toBe('/api/apikeys')
    expect(toApiUrl('/apikeys/abc')).toBe('/api/apikeys/abc')
    expect(toApiUrl('/api-keys?hotelId=h1')).toBe('/api/api-keys?hotelId=h1')
  })
  it('respeta las rutas que ya llevan /api', () => {
    expect(toApiUrl('/api/auth/login')).toBe('/api/auth/login')
    expect(toApiUrl('/api')).toBe('/api')
  })
})
