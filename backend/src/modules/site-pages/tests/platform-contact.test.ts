// site-pages/tests/platform-contact.test.ts — REQ-PIPE-07 (#148): el enlace de WhatsApp de la
// landing sale del teléfono de soporte de la plataforma, o no sale.
import { describe, it, expect } from 'bun:test'
import { resolvePlatformContact, buildPlatformWhatsappUrl } from '../usecases/platform-contact'
import { DEFAULT_PLATFORM_IDENTITY } from '../../../shared/utils/platform-identity'

function configRepoWith(value: unknown) {
  return {
    async findOne(filters: Record<string, unknown>) {
      if (filters.hotelId === 'platform' && filters.key === 'plataforma') return { value }
      return null
    },
  }
}

describe('GET /api/public/platform-contact — whatsappUrl', () => {
  it('809-555-0000 (sin prefijo) → wa.me/18095550000 con el saludo prellenado', async () => {
    const repo = configRepoWith(JSON.stringify({ platformName: 'SolmiOS', supportPhone: '809-555-0000' }))
    const { whatsappUrl } = await resolvePlatformContact(repo)
    expect(whatsappUrl).toBe(
      'https://wa.me/18095550000?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20SolmiOS%20para%20mi%20hotel',
    )
  })

  it('el saludo usa el nombre configurado de la plataforma, no un literal', async () => {
    const repo = configRepoWith({ platformName: 'Hotelera Norte', supportPhone: '+1 809 555 0000' })
    const { whatsappUrl } = await resolvePlatformContact(repo)
    expect(whatsappUrl).toStartWith('https://wa.me/18095550000?text=')
    expect(decodeURIComponent(whatsappUrl!.split('text=')[1]!)).toBe(
      'Hola, quiero información sobre Hotelera Norte para mi hotel',
    )
  })

  it('un + explícito se respeta (no se duplica el prefijo)', () => {
    expect(buildPlatformWhatsappUrl({ ...DEFAULT_PLATFORM_IDENTITY, supportPhone: '+34 600 123 456' }))
      .toStartWith('https://wa.me/34600123456?text=')
  })

  it('supportPhone vacío → null', async () => {
    const repo = configRepoWith({ platformName: 'SolmiOS', supportPhone: '' })
    expect((await resolvePlatformContact(repo)).whatsappUrl).toBeNull()
  })

  it('supportPhone inválido (muy corto / sin dígitos) → null', () => {
    expect(buildPlatformWhatsappUrl({ ...DEFAULT_PLATFORM_IDENTITY, supportPhone: '123' })).toBeNull()
    expect(buildPlatformWhatsappUrl({ ...DEFAULT_PLATFORM_IDENTITY, supportPhone: 'consultar' })).toBeNull()
  })

  it('sin fila de configuración → null (no tira)', async () => {
    expect((await resolvePlatformContact(configRepoWith(undefined))).whatsappUrl).toBeNull()
    const sinFila = { async findOne() { return null } }
    expect((await resolvePlatformContact(sinFila)).whatsappUrl).toBeNull()
  })
})
