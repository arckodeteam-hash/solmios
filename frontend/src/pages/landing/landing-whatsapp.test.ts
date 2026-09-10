// landing-whatsapp.test.ts — El botón flotante de WhatsApp de la home (#148, REQ-PIPE-07).
//
// El hotelero de RD/LatAm escribe por WhatsApp y la landing solo tenía "Prueba gratis" y un
// formulario de ventas con 0 usos. El botón sale del teléfono de soporte que carga el super-admin
// (`configuration('plataforma').supportPhone`), ya resuelto a `wa.me/<E.164>` por el backend.
// Regla dura: sin URL, el botón NO existe en el DOM — un botón que abre un chat con nadie es
// peor que ninguno (ya pasó en Proveedores de servicios). Y no reemplaza a "Hablar con Ventas".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// La landing pide datos públicos al montarse; sin backend el fetch falla y ensucia la salida.
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))

const getContact = vi.fn()
vi.mock('@/services/PlatformContact.service', () => ({
  PlatformContactService: { get: () => getContact() },
}))

import Landing from './index.vue'

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
}

const MOUNT_OPTS = { global: { stubs: { RouterLink: RouterLinkStub, SiteHeader: true } } }

const WA_URL = 'https://wa.me/18095550000?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20SolmiOS%20para%20mi%20hotel'

describe('landing — botón flotante de WhatsApp', () => {
  beforeEach(() => getContact.mockReset())

  it('con teléfono de soporte: el botón existe, abre wa.me en otra pestaña y no crea nada', async () => {
    getContact.mockResolvedValue({ whatsappUrl: WA_URL })
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()

    const btn = w.find('[data-testid="wa-float"]')
    expect(btn.exists()).toBe(true)
    expect(btn.element.tagName).toBe('A')
    expect(btn.attributes('href')).toBe(WA_URL)
    expect(btn.attributes('target')).toBe('_blank')
    expect(btn.attributes('rel')).toContain('noopener')
    // Es un enlace pelado: el clic no dispara ningún handler (no hay lead que crear).
    expect(btn.attributes('onclick')).toBeUndefined()
  })

  it('sin teléfono de soporte: el DOM no contiene el botón', async () => {
    getContact.mockResolvedValue({ whatsappUrl: null })
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()

    expect(w.find('[data-testid="wa-float"]').exists()).toBe(false)
    expect(w.element.querySelector('[data-testid=wa-float]')).toBeNull()
  })

  it('"Hablar con Ventas" se conserva con o sin WhatsApp', async () => {
    for (const whatsappUrl of [WA_URL, null]) {
      getContact.mockResolvedValue({ whatsappUrl })
      const w = mount(Landing, MOUNT_OPTS)
      await flushPromises()
      expect(w.findAll('button').some(b => /hablar con ventas/i.test(b.text()))).toBe(true)
    }
  })

  it('el botón no tapa el CTA "Prueba gratis" ni el widget de feedback: abajo-derecha, apilado, fijo', async () => {
    getContact.mockResolvedValue({ whatsappUrl: WA_URL })
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()

    const cls = w.find('[data-testid="wa-float"]').classes()
    // A 375px el CTA del carrusel de planes termina en x=292 y el botón (56px) con `right-6`
    // arrancaba en 295: 3px de aire. Con `right-3` arranca en 307 (15px >= 12). En md+ vuelve a
    // `right-6`, el mismo borde que FeedbackToolbar (fixed bottom-6 right-6, 56px); el `bottom`
    // lo deja encima de ese widget en vez de superpuesto (medido en el navegador).
    expect(cls).toEqual(expect.arrayContaining(['fixed', 'bottom-[5.75rem]', 'right-3', 'md:right-6', 'z-40']))
    expect(cls).not.toContain('right-6')
    expect(cls).not.toContain('bottom-6')
    // El header (con "Prueba Gratis") y el modal de ventas son z-50: nunca quedan debajo.
    expect(cls).not.toContain('z-50')
  })
})
