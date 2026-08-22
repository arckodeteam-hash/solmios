// pasarelas-setup-empty.test.ts — El vacío de /panel/config/pasarelas bloquea el cobro (issue #19).
//
// La vista SIEMPRE pinta las 4 tarjetas del catálogo (Stripe/Azul/CardNet/PayPal), así que un hotel
// sin ninguna pasarela conectada no ve ningún vacío: ve cuatro tarjetas y un badge chiquito que
// dice "Sin configurar". Mientras tanto no puede cobrar una sola reserva online. Lo que se protege:
//   1. Cero pasarelas → aviso de que no se puede cobrar + primer paso.
//   2. Pasarela cargada pero apagada NO cuenta como cobrar: el aviso cambia de texto, no desaparece.
//   3. Con una pasarela activa no hay aviso.
//   4. El botón solo aparece con `billing:edit` — todas las rutas de /api/payment-gateways lo exigen
//      (backend modules/payment-gateways/index.ts:61-65), así que sin el permiso termina en 403.
//   5. El primer paso abre el formulario que YA existe en la vista, no una pantalla inventada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

let gatewaysData: unknown[] = []

vi.mock('@/services/PaymentGateway.service', () => ({
  PaymentGatewayService: {
    list: async () => ({ data: gatewaysData }),
    upsert: async () => ({}),
    setEnabled: async () => ({}),
    remove: async () => ({}),
    test: async () => ({ ok: true, message: 'ok' }),
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))
vi.mock('@/composables/useApiError', () => ({ useApiError: () => ({ handle: vi.fn() }) }))
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmModal: ref(null),
    confirmBusy: ref(false),
    askConfirm: vi.fn(),
    runConfirm: vi.fn(),
  }),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { hotelId: 'h1' } }),
}))

let granted: string[] = []
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({
    can: (m: string, a: string) => granted.includes(`${m}:${a}`),
    canRoute: () => true,
    permissions: { value: granted },
  }),
}))

import Pasarelas from './index.vue'

const MOUNT_OPTS = {
  global: {
    stubs: {
      SectionCard: { template: '<section><slot name="actions" /><slot /></section>' },
      SkeletonLoader: true,
      ConfirmModal: true,
    },
  },
}

function gateway(over: Record<string, unknown> = {}) {
  return {
    id: 'gw1', provider: 'stripe', mode: 'test', currency: 'usd', enabled: true, isDefault: true,
    hasSecret: true, secretMask: 'sk_…1234', hasWebhookSecret: false, hasMerchantId: false, hasCert: false,
    ...over,
  }
}

beforeEach(() => {
  gatewaysData = []
  granted = ['billing:edit']
})

describe('/panel/config/pasarelas — sin pasarela no hay cobro online', () => {
  it('sin ninguna pasarela conectada avisa que no se puede cobrar', async () => {
    const w = mount(Pasarelas, MOUNT_OPTS)
    await flushPromises()

    const alert = w.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('Todavía no podés cobrar online')
    expect(alert.text()).toContain('Conectar una pasarela')
  })

  it('una pasarela cargada pero desactivada sigue siendo "no puedo cobrar"', async () => {
    gatewaysData = [gateway({ enabled: false })]
    const w = mount(Pasarelas, MOUNT_OPTS)
    await flushPromises()

    const alert = w.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('Ninguna pasarela está activa')
    expect(alert.text()).toContain('Activar pasarela')
  })

  it('con una pasarela activa no muestra el aviso', async () => {
    gatewaysData = [gateway({ enabled: true })]
    const w = mount(Pasarelas, MOUNT_OPTS)
    await flushPromises()

    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('sin billing:edit avisa igual pero no ofrece el botón', async () => {
    granted = ['billing:view']
    const w = mount(Pasarelas, MOUNT_OPTS)
    await flushPromises()

    const alert = w.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('Todavía no podés cobrar online')
    expect(alert.findAll('button')).toHaveLength(0)
  })

  it('el primer paso abre el formulario de credenciales que ya existe', async () => {
    const w = mount(Pasarelas, MOUNT_OPTS)
    await flushPromises()

    expect(w.find('#pagos-stripe-secret-key').exists()).toBe(false)
    await w.find('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(w.find('#pagos-stripe-secret-key').exists()).toBe(true)
  })
})
