// pages/auth/auth-meta.ts — El <head> de las páginas de cuenta, declarado en un solo lugar.
//
// Vive acá y no inline en cada .vue porque esto es una POLÍTICA, no un detalle de cada pantalla:
// qué se indexa, qué no, y qué URL es la canónica. Junto se lee de un vistazo y se puede testear
// sin montar componentes ni leer archivos del disco.
//
// Regla de fondo: de las cinco páginas, la única que es contenido de búsqueda es `/registro` —
// es la página de conversión del producto. Las demás son utilidades de cuenta: no aportan al
// índice, compiten con la home por las consultas de marca y, en un caso, exponen un token.
import type { PageMeta } from '@/composables/usePageMeta'

export const AUTH_PAGE_META = {
  login: {
    title: 'Iniciar sesión — SolmiOS',
    description: 'Accede a tu panel de SolmiOS para gestionar reservas, habitaciones, huéspedes y facturación de tu hotel.',
    index: false,
  },

  register: {
    // La ÚNICA indexable: es donde entra el cliente nuevo.
    title: 'Crear cuenta gratis — SolmiOS',
    description: 'Crea tu cuenta en SolmiOS y prueba gratis el sistema todo-en-uno para hoteles: reservas, channel manager, housekeeping y facturación.',
    // Sin query: `?plan=` y `?ref=` son variantes de la misma página y las señales se
    // consolidan en una sola URL.
    canonicalPath: '/registro',
    // Este link se comparte de verdad — campañas y links de referido (`/r/:code` redirige acá).
    // Sin Open Graph el preview mostraba el branding genérico de la app.
    social: true,
  },

  forgotPassword: {
    title: 'Recuperar contraseña — SolmiOS',
    description: 'Recupera el acceso a tu cuenta de SolmiOS. Te enviamos un enlace para restablecer tu contraseña.',
    index: false,
  },

  resetPassword: {
    title: 'Restablecer contraseña — SolmiOS',
    // noindex Y nofollow: la URL lleva el token de restablecimiento (`?token=`). Que se indexe
    // deja tokens de cuentas reales dentro de un índice público — es seguridad, no SEO.
    index: false,
    follow: false,
  },

  changePassword: {
    title: 'Cambiar contraseña — SolmiOS',
    // Requiere sesión: un crawler nunca ve el contenido real.
    index: false,
    follow: false,
  },
} satisfies Record<string, PageMeta>
