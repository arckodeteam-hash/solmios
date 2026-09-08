// Fuente ÚNICA de las tabs de Integraciones. La usan la página contenedora
// (src/pages/integraciones/index.vue) y el menú (AdminLayout) para decidir si la entrada se
// muestra. Mismo patrón que config/messaging-tabs.ts.
//
// Una integración es una conexión con algo de AFUERA: WhatsApp con Meta, las pasarelas con el
// banco, las cerraduras con TTLock, la facturación con la autoridad fiscal. Estaban repartidas
// entre una pestaña de Configuración Base y tres entradas sueltas del menú, así que el hotelero
// que buscaba "dónde conecto X" tenía que adivinar en cuál de las dos mitades estaba.
//
// `path` es la ruta ORIGINAL de cada vista y sigue siendo la clave de gateo en module-map.ts:
// agrupar las vistas en tabs no debe cambiar quién las puede ver. Las que nacen acá (WhatsApp,
// Facturación) no tienen ruta propia y se gatean con la de la página.

export interface IntegrationTab {
  /** Valor del query param `?tab=`. */
  value: string
  label: string
  /** Ruta original — clave de gateo por módulo. `null` para las que nacieron dentro de esta página. */
  path: string | null
  roles: string[]
}

export const INTEGRATIONS_PATH = '/panel/integraciones'

export const INTEGRATION_TABS: IntegrationTab[] = [
  { value: 'whatsapp', label: 'WhatsApp', path: null, roles: ['hotel_admin'] },
  { value: 'pasarelas', label: 'Pasarelas de pago', path: '/panel/config/pasarelas', roles: ['hotel_admin'] },
  { value: 'cerraduras', label: 'Cerraduras', path: '/panel/config/cerraduras', roles: ['hotel_admin'] },
  { value: 'dispositivos', label: 'Dispositivos', path: '/panel/config/dispositivos', roles: ['hotel_admin'] },
  { value: 'facturacion', label: 'Facturación electrónica', path: null, roles: ['hotel_admin'] },
]

/** Rutas que gatean la entrada del menú: si ninguna está habilitada, igual quedan las propias. */
export const INTEGRATION_GATED_PATHS = INTEGRATION_TABS
  .map(t => t.path)
  .filter((p): p is string => p !== null)
