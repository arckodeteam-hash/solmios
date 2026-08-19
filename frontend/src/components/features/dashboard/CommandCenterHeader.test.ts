// CommandCenterHeader.test.ts — La identidad del hotel en el bloque de marca del panel.
//
// El bug que estos tests cierran: el template traía una URL de Unsplash escrita a mano, así que
// TODOS los hoteles del SaaS mostraban la misma foto de stock de un lobby ajeno y cada carga del
// panel pegaba a un CDN de terceros. Ahora el bloque usa `hotels.logo` — el logo real, que llega
// por GET /settings junto al nombre y las estrellas.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import CommandCenterHeader from './CommandCenterHeader.vue'

vi.mock('@/composables/usePageTitle', () => ({ usePageTitle: () => ({ value: 'Dashboard' }) }))

const STUBS = {
  EmergencyButton: true,
  NotificationBell: true,
  UserMenu: true,
}

function render(props: Record<string, unknown> = {}) {
  return mount(CommandCenterHeader, {
    props: { hotelName: 'Hotel Demo', apiOnline: true, ...props },
    global: { stubs: STUBS },
  })
}

describe('CommandCenterHeader — identidad del hotel', () => {
  it('NUNCA carga una imagen de un host externo (regresión: la foto de stock de Unsplash)', () => {
    // Este es el test que impide que vuelva el bug original: ninguna imagen del header puede
    // apuntar afuera. Si alguien pega otra URL de un banco de fotos, esto falla.
    const w = render({ logoUrl: '/uploads/hotel-logos/demo.png' })
    for (const img of w.findAll('img')) {
      expect(img.attributes('src') ?? '').not.toMatch(/^https?:\/\//)
    }
  })

  it('sin logo cargado no dibuja ninguna imagen (no pide nada a la red)', () => {
    expect(render().findAll('img')).toHaveLength(0)
    expect(render({ logoUrl: null }).findAll('img')).toHaveLength(0)
    expect(render({ logoUrl: '' }).findAll('img')).toHaveLength(0)
  })

  it('muestra el logo del hotel cuando está cargado', () => {
    const w = render({ logoUrl: '/uploads/hotel-logos/demo.png' })
    const imgs = w.findAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].attributes('src')).toBe('/uploads/hotel-logos/demo.png')
  })

  it('si el logo ya no resuelve, deja de dibujarlo en vez de mostrar un recuadro roto', async () => {
    const w = render({ logoUrl: '/uploads/hotel-logos/borrado.png' })
    await w.get('img').trigger('error')
    expect(w.findAll('img')).toHaveLength(0)
  })

  it('al cambiar de hotel el logo nuevo tiene otra chance de cargar', async () => {
    // Sin este reset, un logo roto en el hotel A dejaba sin logo al hotel B tras el switcher.
    const w = render({ logoUrl: '/uploads/a.png' })
    await w.get('img').trigger('error')
    expect(w.findAll('img')).toHaveLength(0)

    await w.setProps({ logoUrl: '/uploads/b.png' })
    expect(w.findAll('img')).toHaveLength(1)
    expect(w.get('img').attributes('src')).toBe('/uploads/b.png')
  })

  it('el nombre del hotel se muestra aunque no haya logo', () => {
    expect(render({ hotelName: 'Hotel Demo' }).text()).toContain('Hotel Demo')
  })
})
