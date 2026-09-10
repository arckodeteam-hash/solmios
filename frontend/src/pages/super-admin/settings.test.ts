// settings.test.ts — CFG-2 (#99): la pantalla de settings del super-admin guarda POR PESTAÑA.
//
// Qué se protege acá:
//   1. El Guardar de la pestaña Email hace UN solo POST y es a la clave 'email_config' (el
//      botón global "Guardar Cambios" que había antes disparaba cuatro claves de una: al fallar
//      una, no se sabía cuál).
//   2. El Guardar de la pestaña Plataforma persiste EXACTAMENTE {platformName, supportEmail,
//      supportPhone}: los campos sin lector en el backend (moneda, zona, dominio) ya no viajan.
//   3. El botón global "Guardar Cambios" no existe en ninguna pestaña.
//   4. El Guardar de Integraciones persiste sólo la clave de Google Maps.
//
// Platform.service se mockea entero: la página (y ChannexPlatformConfig, que monta adentro)
// no tocan la red, y los POST a /api/configuracion se cuentan sobre el mock.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: vi.fn(), set: vi.fn() },
  PlatformService: {
    getMetaWhatsapp: vi.fn(),
    saveMetaWhatsapp: vi.fn(),
    getResend: vi.fn(),
    saveResend: vi.fn(),
    deleteResend: vi.fn(),
    getSettingsStatus: vi.fn(),
    testEmail: vi.fn(),
  },
  ChannexAdminService: { status: vi.fn(), save: vi.fn(), test: vi.fn() },
}))

import Settings from './settings.vue'
import { ConfigService, PlatformService, ChannexAdminService } from '@/services/Platform.service'
import type { SettingsStatus } from '@/services/Platform.service'

const PLATAFORMA = { platformName: 'SolmiOS', supportEmail: 'soporte@solmios.com', supportPhone: '+1 809 555 0000' }

/** Todos los servicios "no configurados": basta para pintar las tablas de solo-lectura. */
const STATUS_APAGADO = Object.fromEntries(
  ['stripe', 'stripeWebhook', 'turnstile', 'publicUrl', 'metaApp', 'resend', 'smtp', 'googleMaps', 'channex']
    .map((clave) => [clave, { configured: false, source: null }]),
) as SettingsStatus

let wrapper: VueWrapper | null = null

async function montar() {
  wrapper = mount(Settings)
  await flushPromises()
  return wrapper
}

/** Botones cuyo texto exacto es `texto` (distinto de "contiene": 'Guardar' ≠ 'Guardar key'). */
function botones(texto: string) {
  return wrapper!.findAll('button').filter((b) => b.text().trim() === texto)
}

/** Click en la pestaña por su label ('Email', 'Plataforma', …). */
async function irATab(label: string) {
  expect(botones(label), `no hay pestaña "${label}"`).toHaveLength(1)
  await botones(label)[0]!.trigger('click')
  await flushPromises()
}

/** El único botón con ese texto — si hubiera dos, el test grita en vez de clickear cualquiera. */
async function clickUnico(texto: string) {
  const found = botones(texto)
  expect(found, `se esperaba 1 botón "${texto}", hay ${found.length}`).toHaveLength(1)
  await found[0]!.trigger('click')
  await flushPromises()
}

function clavesGuardadas(): string[] {
  return vi.mocked(ConfigService.set).mock.calls.map((c) => c[0])
}

describe('settings (super-admin) — un Guardar por pestaña', () => {
  beforeEach(() => {
    vi.mocked(ConfigService.get).mockReset().mockImplementation(async (key: string) => {
      if (key === 'plataforma') return { ...PLATAFORMA }
      if (key === 'email_templates') return []
      return null // email_config / smtp / google_maps sin configurar
    })
    vi.mocked(ConfigService.set).mockReset().mockResolvedValue(undefined)
    vi.mocked(PlatformService.getMetaWhatsapp).mockReset().mockResolvedValue({
      appId: '', graphVersion: 'v23.0', configurado: false, origen: null, pista: null, puedeGuardar: true,
    })
    vi.mocked(PlatformService.getResend).mockReset().mockResolvedValue({ configured: false, last4: null })
    vi.mocked(PlatformService.getSettingsStatus).mockReset().mockResolvedValue(STATUS_APAGADO)
    vi.mocked(ChannexAdminService.status).mockReset().mockResolvedValue({
      environment: 'staging', hasKey: false, keyMasked: '', channexUserId: '', dashboardUrl: '',
      webhook: { registered: false, callbackUrl: '' },
      properties: { inAccount: 0, hotelsWithProperty: 0, orphans: [] },
      planExpiresAt: '', planDaysLeft: null, planExpired: false,
    })
    vi.mocked(ChannexAdminService.test).mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('monta con las cuatro pestañas (sin facturación) y sin tocar ConfigService.set', async () => {
    await montar()

    for (const label of ['Plataforma', 'Email', 'Seguridad', 'Integraciones']) {
      expect(botones(label), `falta la pestaña ${label}`).toHaveLength(1)
    }
    expect(botones('Facturación')).toHaveLength(0)
    expect(ConfigService.set).not.toHaveBeenCalled()
  })

  it('el Guardar de la pestaña Email hace UN solo POST y es a email_config', async () => {
    await montar()
    await irATab('Email')

    await clickUnico('Guardar')

    // Un POST, una clave: si el handler vuelve a guardar de a varias claves, esto falla.
    expect(clavesGuardadas()).toEqual(['email_config'])
    const [clave, valor, hotelId] = vi.mocked(ConfigService.set).mock.calls[0]!
    expect(clave).toBe('email_config')
    expect(hotelId).toBe('platform')
    // Shape canónico que lee el motor de envío (backend EmailService).
    expect(valor).toEqual({
      host: '', port: 587, secure: false, user: '', pass: '', fromEmail: '', fromName: '',
    })
  })

  it('el Guardar de la pestaña Plataforma persiste EXACTAMENTE los tres campos', async () => {
    await montar()
    await irATab('Plataforma')

    await clickUnico('Guardar')

    expect(clavesGuardadas()).toEqual(['plataforma'])
    // toEqual de objeto exacto: ni moneda, ni zona horaria, ni dominio pueden colarse.
    expect(vi.mocked(ConfigService.set).mock.calls[0]).toEqual([
      'plataforma',
      { platformName: 'SolmiOS', supportEmail: 'soporte@solmios.com', supportPhone: '+1 809 555 0000' },
      'platform',
    ])
  })

  it('el Guardar de la pestaña Integraciones persiste sólo la clave de Google Maps', async () => {
    await montar()
    await irATab('Integraciones')

    await clickUnico('Guardar')

    expect(clavesGuardadas()).toEqual(['google_maps'])
    expect(vi.mocked(ConfigService.set).mock.calls[0]![1]).toEqual({ apiKey: '' })
  })

  it('no existe el botón global "Guardar Cambios" en ninguna pestaña', async () => {
    await montar()

    for (const label of ['Plataforma', 'Email', 'Seguridad', 'Integraciones']) {
      await irATab(label)
      const globales = wrapper!.findAll('button').filter((b) => b.text().includes('Guardar Cambios'))
      expect(globales, `la pestaña ${label} no puede tener botón global de guardado`).toHaveLength(0)
    }
  })
})
