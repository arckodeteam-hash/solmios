// pages/public-meta.ts — <head> de las páginas públicas del producto.
//
// Mismo criterio que `pages/auth/auth-meta.ts`: la política junta, no dispersa en cada .vue.
// Estas dos son las únicas páginas públicas propias que no tenían metadatos — el resto ya los
// resuelve por su cuenta (`/p/:slug` y la landing de cada hotel derivan los suyos del contenido).
//
// Las dos son indexables a propósito: son las páginas con las que el producto se busca y se
// comparte. Sin esto, ambas se anunciaban como "SolmiOS — Hospitality OS", el título por defecto
// de la SPA, y competían entre sí por las mismas consultas.
import type { PageMeta } from '@/composables/usePageMeta'

export const PUBLIC_PAGE_META = {
  /** Home del producto. Es la que tiene que posicionar por las consultas de categoría. */
  landing: {
    title: 'SolmiOS — Software de gestión hotelera todo-en-uno',
    description: 'Plataforma todo-en-uno para hoteles, hostales y alojamientos: reservas, channel manager, housekeeping y facturación conectados en un solo sistema.',
    canonicalPath: '/',
    social: true,
  },

  /** Landing de campaña del Programa Hotel Fundador (link propio, se comparte suelto). */
  hotelFundador: {
    title: 'Programa Hotel Fundador — SolmiOS',
    description: 'Calcula cuánto pierde tu hotel por operar con herramientas que no se hablan entre sí, y conoce las condiciones del Programa Hotel Fundador.',
    canonicalPath: '/hotel-fundador',
    social: true,
  },
} satisfies Record<string, PageMeta>
