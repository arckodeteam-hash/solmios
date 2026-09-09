// Fuente ÚNICA de las tabs de "Página pública". La usan la página contenedora
// (src/pages/pagina-publica/index.vue) para decidir qué tab renderiza y el menú
// (AdminLayout) para decidir si la entrada se muestra. Mismo patrón que
// config/messaging-tabs.ts (colapso de N rutas sueltas en una sola con tabs).
//
// `path` es la ruta ORIGINAL de cada vista — se conserva como `name` de un
// `redirect` legacy en el router (no rompe links/favoritos guardados) y como
// clave de gateo si algún día alguna tab pasa a ser module-gated.

export interface PaginaPublicaTab {
  /** Valor del query param `?tab=`. Coincide con el último segmento de la ruta vieja. */
  value: string
  label: string
  /** Ruta original — destino de los redirects legacy. */
  path: string
  roles: string[]
  /** Agrupa visualmente las tabs (8 es demasiado para una fila plana sin perder de vista la relación entre ellas). */
  group: 'Contenido' | 'Reservas' | 'Marketing'
}

export const PAGINA_PUBLICA_PATH = '/panel/pagina-publica'

export const PAGINA_PUBLICA_TABS: PaginaPublicaTab[] = [
  { value: 'general', label: 'General', path: '/panel/pagina-publica', roles: ['hotel_admin'], group: 'Contenido' },
  { value: 'ubicacion', label: 'Ubicación', path: '/panel/pagina-publica/ubicacion', roles: ['hotel_admin'], group: 'Contenido' },
  { value: 'landing', label: 'Landing', path: '/panel/pagina-publica/landing', roles: ['hotel_admin'], group: 'Contenido' },
  { value: 'media', label: 'Media', path: '/panel/pagina-publica/media', roles: ['hotel_admin'], group: 'Contenido' },
  { value: 'apariencia', label: 'Apariencia', path: '/panel/pagina-publica/apariencia', roles: ['hotel_admin'], group: 'Contenido' },
  { value: 'booking-engine', label: 'Motor de reservas', path: '/panel/booking-engine', roles: ['hotel_admin'], group: 'Reservas' },
  // "Códigos de descuento" se mudó a Configuración, al lado de Paquetes y promociones: es
  // configuración comercial (se define una vez y rige todos los canales), no contenido de la
  // landing. Tenerlo acá lo dejaba lejos de los paquetes, que son la otra mitad de lo mismo.
  { value: 'reputacion', label: 'Reputación', path: '/panel/pagina-publica/reputacion', roles: ['hotel_admin'], group: 'Marketing' },
  { value: 'tracking', label: 'Tracking', path: '/panel/pagina-publica/tracking', roles: ['hotel_admin'], group: 'Marketing' },
]

/** Rutas viejas que ahora redirigen a la tab equivalente (todas menos 'general', que YA es la ruta base). */
export const PAGINA_PUBLICA_LEGACY_PATHS = PAGINA_PUBLICA_TABS
  .filter(t => t.value !== 'general')
  .map(t => t.path)
