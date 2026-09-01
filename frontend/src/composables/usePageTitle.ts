// composables/usePageTitle.ts — #654: los 71 módulos del panel Hotel Admin/Recepcionista
// usaban el mismo <h1> (nombre del hotel) en TODAS las páginas — con lector de pantalla todas
// se anunciaban igual, y las pestañas del navegador eran indistinguibles. El panel Super Admin
// ya resolvía esto bien (SuperAdminLayout.vue tiene su propio `pageTitle` por route.name); acá
// se reutiliza el MISMO diccionario es que ya alimenta el breadcrumb (Breadcrumbs.vue) — evita
// mantener dos mapeos que divergen.
import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { useRoute } from 'vue-router'

// Mismo diccionario que Breadcrumbs.vue (fuente única — Breadcrumbs.vue lo importa de acá).
export const ROUTE_LABELS: Record<string, string> = {
  panel: 'Inicio',
  admin: 'Admin',
  dashboard: 'Dashboard',
  'dashboard-general': 'Dashboard',
  planning: 'Planning',
  reservations: 'Reservas',
  reservas: 'Reservas',
  checkin: 'Check-in',
  rooms: 'Habitaciones',
  guests: 'Huéspedes',
  housekeeping: 'Limpieza',
  maintenance: 'Mantenimiento',
  'technical-providers': 'Proveedores de servicios',
  'team-chat': 'Chats del equipo',
  'channel-manager': 'Channel',
  'booking-engine': 'Booking Engine',
  'pagina-publica': 'Página pública',
  billing: 'Facturación',
  folios: 'Folios',
  payments: 'Links de Pago',
  caja: 'Caja',
  gastos: 'Gastos',
  reports: 'Reportes',
  'night-audit': 'Night Audit',
  groups: 'Grupos',
  packages: 'Promociones',
  opiniones: 'Reseñas',
  resenas: 'Reseñas',
  crm: 'CRM',
  ai: 'IA',
  'ai-receptionist': 'Recepcionista IA',
  'ai-gerente': 'Gerente IA',
  config: 'Configuración',
  rrhh: 'RRHH',
  empleados: 'Empleados',
  evaluacion: 'Evaluación de Desempeño',
  attendance: 'Asistencia',
  payroll: 'Nómina',
  reclutamiento: 'Reclutamiento',
  reembolsos: 'Reembolsos',
  organigrama: 'Organigrama',
  team: 'Equipo',
  activos: 'Activos',
  capacitacion: 'Capacitación',
  roles: 'Roles y Permisos',
  settings: 'Configuración',
  mensajeria: 'Mensajería',
  'auto-messages': 'Envíos Auto',
  'message-logs': 'Historial Envíos',
  'email-queue': 'Cola de Emails',
  'whatsapp-templates': 'Plantillas WhatsApp',
  cerraduras: 'Cerraduras',
  pagos: 'Pasarelas de Pago',
  devices: 'Dispositivos',
  'push-tokens': 'Notificaciones Push',
  notifications: 'Notificaciones',
  support: 'Soporte',
  finanzas: 'Finanzas',
  operaciones: 'Operaciones',
  ventas: 'Ventas',
  ia: 'IA',
  limpieza: 'Limpieza',
  mantenimiento: 'Mantenimiento',
  proveedores: 'Proveedores de servicios',
  chats: 'Chats del equipo',
  facturacion: 'Facturación',
  'links-pago': 'Links de Pago',
  reportes: 'Reportes',
  grupos: 'Grupos',
  promociones: 'Promociones',
  recepcionista: 'Recepcionista IA',
  gerente: 'Gerente IA',
  habitaciones: 'Habitaciones',
  pasarelas: 'Pasarelas de Pago',
  dispositivos: 'Dispositivos',
  hotels: 'Hoteles',
  subscriptions: 'Suscripciones',
  analytics: 'Analíticas',
  users: 'Usuarios',
  audit: 'Auditoría',
  feedback: 'Feedback',
  monitoring: 'Monitoreo',
  announcements: 'Anuncios',
  plans: 'Planes',
  amenities: 'Amenities',
  'api-keys': 'API Keys',
  // — Segmentos que faltaban: sin ellos el título caía al ancestro `panel` y la página
  //   se anunciaba como "Inicio". Los nombres salen del menú (AdminLayout.vue) y de los
  //   tabs de la página pública, que es lo que el usuario ve escrito en pantalla.
  aliados: 'Aliados',
  compras: 'Compras',
  ordenes: 'Órdenes de compra',
  requisiciones: 'Requisiciones',
  contabilidad: 'Contabilidad',
  'libro-diario': 'Libro Diario',
  mayor: 'Libro Mayor',
  'plan-cuentas': 'Plan de Cuentas',
  inventario: 'Inventario',
  referidos: 'Referidos',
  restaurante: 'Restaurante',
  carta: 'Carta',
  cocina: 'Cocina y Bar (KDS)',
  salon: 'Salón',
  'rrhh-dashboard': 'Panel RRHH',
  suscripcion: 'Suscripción',
  tesoreria: 'Tesorería',
  bancos: 'Bancos',
  'caja-chica': 'Caja chica',
  cuentas: 'Por Cobrar / Pagar',
  presupuesto: 'Presupuesto',
  auditoria: 'Auditoría',
  tarifas: 'Temporadas y Tarifas',
  'tarifas-fecha': 'Tarifas por fecha',
  general: 'General',
  landing: 'Landing',
  media: 'Media',
  apariencia: 'Apariencia',
  reputacion: 'Reputación',
  tracking: 'Tracking',
  codigos: 'Códigos de descuento',
  administrativo: 'Administrativo',
}

/**
 * Título por PATH COMPLETO, para las páginas cuyo último segmento es ambiguo.
 *
 * El diccionario de arriba traduce un segmento suelto, y eso no alcanza cuando el mismo
 * segmento significa cosas distintas según dónde cuelgue: `dashboard` es "Liquidez" bajo
 * tesorería y "Panel RRHH" bajo RRHH; `config` es "Configuración Base" en la raíz y
 * "Configuración IA" dentro del recepcionista. Acá gana el path exacto.
 */
export const PAGE_TITLES: Record<string, string> = {
  '/panel/config': 'Configuración Base',
  '/panel/dashboard/general': 'Dashboard General',
  '/panel/dashboard/administrativo': 'Dashboard Administrativo',
  '/panel/tesoreria/dashboard': 'Liquidez',
  '/panel/tesoreria/proveedores': 'Proveedores',
  '/panel/rrhh/dashboard': 'Panel RRHH',
  '/panel/ia/recepcionista/config': 'Configuración IA',
}

/** 'caja-chica' → 'Caja chica'. Mismo criterio que usa Breadcrumbs para lo no mapeado. */
export function capitalizeSegment(segment: string): string {
  const clean = segment.replace(/-/g, ' ')
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/**
 * Título de la página actual.
 *
 * Antes esto recorría los segmentos de atrás hacia adelante y devolvía el PRIMERO que
 * estuviera en el diccionario. Como `panel` está mapeado a 'Inicio', toda ruta cuyo último
 * segmento faltara terminaba anunciándose como "Inicio" — 27 de las 117 páginas del panel
 * (tesorería, contabilidad, restaurante, compras, inventario…), y las que colgaban de un
 * padre mapeado heredaban el nombre del padre: `/panel/pagina-publica/media` decía
 * "Página pública". El breadcrumb de la misma pantalla, en cambio, decía "Media": el
 * diccionario nunca fue el problema, sí la escalada hacia el ancestro.
 *
 * Orden: path exacto → último segmento navegable → el segmento capitalizado. NUNCA se sube
 * a un ancestro: un título aproximado del lugar donde estás es mejor que el nombre correcto
 * de otro lugar.
 */
export function moduleLabelForPath(path: string, params: Record<string, unknown> = {}): string {
  const exact = PAGE_TITLES[path.replace(/\/+$/, '')]
  if (exact) return exact

  const paramValues = new Set(Object.values(params).flat().filter(Boolean) as string[])
  const segments = path.split('/').filter(Boolean)

  // Último segmento que no sea un :param (un id no es el nombre de la página).
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!
    if (paramValues.has(seg)) continue
    return ROUTE_LABELS[seg] ?? capitalizeSegment(seg)
  }
  return ROUTE_LABELS.panel ?? 'Inicio'
}

/** Sufijo de marca de la pestaña. En un solo lugar para que no se escriba distinto en cada uno. */
const TITLE_SUFFIX = 'SolmiOS'

/**
 * Mantiene `document.title` en sincronía con un label reactivo.
 *
 * Existe aparte de `usePageTitle` porque no todos los layouts resuelven su nombre igual: el
 * panel lo deriva del path y el super-admin de `route.name`. SuperAdminLayout tenía su propio
 * `pageTitle` bien resuelto para el <h1>, pero no lo propagaba a la pestaña: navegando por
 * /admin el navegador seguía mostrando el título de la pantalla ANTERIOR.
 */
export function useDocumentTitle(label: Ref<string> | ComputedRef<string>): void {
  watch(label, (l) => {
    if (typeof document !== 'undefined') document.title = `${l} — ${TITLE_SUFFIX}`
  }, { immediate: true })
}

/** h1 real por módulo + document.title reactivo. Un solo `watch` global evita registrar N. */
export function usePageTitle(): ComputedRef<string> {
  const route = useRoute()
  const label = computed(() => moduleLabelForPath(route.path, route.params))
  useDocumentTitle(label)
  return label
}
