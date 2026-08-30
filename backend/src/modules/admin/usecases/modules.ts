// admin/usecases/modules.ts — Módulos del producto que el super_admin puede activar/desactivar.
// Son los grupos top-level del panel del hotel. Los core (Dashboard, Configuración, Soporte,
// Mis Referidos —growth, siempre ON) NO se listan: siempre activos. Un módulo puede tener SUBMÓDULOS (las entradas hijas del menú) que también
// se activan/desactivan de forma granular. Estado global en configuration(hotelId='platform', key='modules').
// Default: todo activado (una clave sin entrada se considera ON). Submódulos: clave punteada `modulo.sub`.
// INDEPENDIENTE del sistema de planes: los planes eligen claves top-level (que implican sus
// sub-módulos, CS-1) y los submódulos son un toggle global de plataforma. Un submódulo se ve
// si su módulo padre entra en el plan Y está ON global.

import type { RepositoryAdapter } from 'arckode-framework'
import { resolveHotelPlan, type GateLogger } from '../../subscriptions/usecases/resolve-plan'

export interface SubModuleMeta { key: string; label: string; description: string }
export interface ModuleMeta { key: string; label: string; description: string; submodules?: SubModuleMeta[] }

export const MODULE_CATALOG: ModuleMeta[] = [
  { key: 'planning', label: 'Planning', description: 'Calendario de reservas, tarifas y temporadas' },
  { key: 'channel', label: 'Channel Manager', description: 'Sincronización con OTAs (Channex)' },
  {
    key: 'reservations', label: 'Reservas', description: 'Reservas y check-in / check-out',
    submodules: [
      { key: 'reservations.list', label: 'Reservas', description: 'Listado y alta de reservas' },
      { key: 'reservations.checkin', label: 'Check-in / Check-out', description: 'Proceso de entrada y salida' },
    ],
  },
  {
    key: 'operations', label: 'Operaciones', description: 'Limpieza, mantenimiento y proveedores',
    submodules: [
      { key: 'operations.housekeeping', label: 'Limpieza', description: 'Tareas de housekeeping' },
      { key: 'operations.maintenance', label: 'Mantenimiento', description: 'Tickets de mantenimiento' },
      { key: 'operations.providers', label: 'Proveedores de servicios', description: 'Catálogo de proveedores externos' },
      { key: 'operations.team-chat', label: 'Chats del equipo', description: 'Monitor de conversaciones del equipo' },
    ],
  },
  { key: 'guests', label: 'Huéspedes', description: 'Gestión de huéspedes' },
  {
    key: 'finance', label: 'Finanzas', description: 'Facturación, folios, caja y reportes',
    submodules: [
      { key: 'finance.billing', label: 'Facturación', description: 'Facturas y notas de crédito' },
      { key: 'finance.folios', label: 'Folios In-House', description: 'Cargos y folios de huéspedes' },
      { key: 'finance.payments', label: 'Links de Pago', description: 'Cobros por link' },
      { key: 'finance.caja', label: 'Caja', description: 'Turnos y arqueo de caja' },
      { key: 'finance.gastos', label: 'Gastos', description: 'Registro de gastos' },
      { key: 'finance.reports', label: 'Reportes', description: 'Reportes financieros' },
      { key: 'finance.night-audit', label: 'Night Audit', description: 'Cierre nocturno' },
    ],
  },
  {
    key: 'sales', label: 'Ventas', description: 'Grupos, promociones y reseñas',
    submodules: [
      { key: 'sales.groups', label: 'Grupos', description: 'Reservas de grupo' },
      { key: 'sales.packages', label: 'Promociones', description: 'Paquetes y ofertas' },
      { key: 'sales.reviews', label: 'Reseñas', description: 'Opiniones de huéspedes' },
    ],
  },
  {
    key: 'ai', label: 'IA', description: 'Recepcionista y gerente con IA',
    submodules: [
      { key: 'ai.receptionist', label: 'Recepcionista IA', description: 'Asistente de recepción con IA' },
      { key: 'ai.manager', label: 'Gerente IA', description: 'Analítica y gestión con IA' },
    ],
  },
  { key: 'crm', label: 'CRM', description: 'Fidelización de huéspedes' },
  {
    key: 'hr', label: 'RRHH', description: 'Empleados, nómina, asistencia y más',
    submodules: [
      { key: 'hr.dashboard', label: 'Panel RRHH', description: 'Resumen de recursos humanos' },
      { key: 'hr.employees', label: 'Empleados', description: 'Gestión de empleados y expedientes' },
      { key: 'hr.evaluacion', label: 'Evaluación de Desempeño', description: 'Evaluaciones de personal' },
      { key: 'hr.attendance', label: 'Asistencia', description: 'Control de asistencia' },
      { key: 'hr.payroll', label: 'Nómina', description: 'Liquidación de sueldos' },
      { key: 'hr.reclutamiento', label: 'Reclutamiento', description: 'Vacantes y candidatos' },
      { key: 'hr.reembolsos', label: 'Reembolsos', description: 'Reembolsos de gastos del personal' },
      { key: 'hr.organigrama', label: 'Organigrama', description: 'Estructura organizacional' },
      { key: 'hr.team', label: 'Equipo', description: 'Directorio del equipo' },
      { key: 'hr.activos', label: 'Activos', description: 'Activos asignados al personal' },
      { key: 'hr.capacitacion', label: 'Capacitación', description: 'Cursos y capacitaciones' },
      { key: 'hr.roles', label: 'Roles y Permisos', description: 'Roles y permisos del hotel' },
    ],
  },
  {
    key: 'settings', label: 'Configuración', description: 'Habitaciones, integraciones y notificaciones (la Configuración Base siempre está activa)',
    submodules: [
      { key: 'settings.rooms', label: 'Habitaciones', description: 'Catálogo de habitaciones' },
      { key: 'settings.auto-messages', label: 'Envíos Automáticos', description: 'Mensajes automáticos' },
      { key: 'settings.message-logs', label: 'Historial de Envíos', description: 'Historial de mensajes enviados' },
      { key: 'settings.email-queue', label: 'Cola de Emails', description: 'Cola de correos salientes' },
      { key: 'settings.whatsapp', label: 'Plantillas WhatsApp', description: 'Plantillas de WhatsApp' },
      { key: 'settings.locks', label: 'Cerraduras', description: 'Cerraduras inteligentes (TTLock)' },
      { key: 'settings.gateways', label: 'Pasarelas de Pago', description: 'Pasarelas de cobro (Stripe)' },
      { key: 'settings.devices', label: 'Dispositivos', description: 'Dispositivos vinculados' },
      { key: 'settings.push', label: 'Notificaciones Push', description: 'Tokens de notificaciones push' },
      { key: 'settings.rates', label: 'Temporadas y Tarifas', description: 'Temporadas y matriz de tarifas' },
      { key: 'settings.audit', label: 'Auditoría', description: 'Log de acciones sensibles del hotel' },
    ],
  },
  {
    // Página pública (/panel/pagina-publica): general/apariencia/reputacion/tracking viven en la
    // clave padre (todas colapsan a la MISMA ruta con ?tab=); las 4 tabs que respaldan módulos
    // de API propios tienen sub-clave. La granularidad fina gatea la API de cada módulo.
    key: 'site-pages', label: 'Página pública', description: 'Sitio público: landing, media, motor de reservas y códigos',
    submodules: [
      { key: 'site-pages.landing', label: 'Landing', description: 'Bloques de la landing pública' },
      { key: 'site-pages.media', label: 'Media', description: 'Galería de fotos del hotel' },
      { key: 'site-pages.booking', label: 'Motor de reservas', description: 'Configuración del booking engine' },
      { key: 'site-pages.promos', label: 'Códigos de descuento', description: 'Códigos promocionales del checkout' },
    ],
  },
  {
    key: 'accounting', label: 'Contabilidad', description: 'Contabilidad de doble entrada: plan de cuentas, asientos, estados financieros',
  },
  {
    key: 'treasury', label: 'Tesorería', description: 'Bancos, conciliación, flujo de caja, cuentas por cobrar/pagar y presupuesto',
    submodules: [
      // CLAVE MUERTA (inalcanzable): /panel/tesoreria/caja-chica gana por prefijo largo en
      // module-map ('/panel/tesoreria' → 'treasury'), así que esta sub-clave nunca gatea nada.
      { key: 'treasury.petty-cash', label: 'Caja chica', description: 'Fondos fijos para gastos menores' },
    ],
  },
  {
    key: 'restaurant', label: 'Restaurante', description: 'POS de restaurante: estaciones/KDS configurables, carta, mesas, comandas y cuenta',
  },
  {
    key: 'inventory', label: 'Inventario', description: 'Insumos (comida/bebida/bar/suministro): stock, costo promedio y movimientos',
  },
  {
    key: 'purchasing', label: 'Compras', description: 'Requisiciones, órdenes de compra y recepción de mercancía (genera gasto)',
  },
]

export type ModuleState = Record<string, boolean>

const CONFIG_KEY = 'modules'
const PLATFORM = 'platform'

/** Todas las claves configurables: módulos top-level + submódulos. */
export function allKeys(): string[] {
  const keys: string[] = []
  for (const m of MODULE_CATALOG) {
    keys.push(m.key)
    for (const s of m.submodules ?? []) keys.push(s.key)
  }
  return keys
}

// ── Catálogo para DISPLAY (editor de planes del super_admin) ─────────────────────────
// Fuente única: el mismo MODULE_CATALOG que lee el gate. El frontend NO duplica la lista —
// la pide a GET /api/admin/modules/catalog, así una clave nueva o retirada del catálogo
// aparece/desaparece del editor sin tocar código de UI.
// `description` viaja acá (QA 2026-08-30) para que el picker de `plans.vue` muestre qué hace
// cada módulo mientras el admin lo tilda — antes solo mandaba key+label, sin ninguna pista de
// qué texto se sugeriría para la landing (ver `suggestPlanCopy`).
export interface CatalogChild { key: string; label: string; description: string }
export interface CatalogModule { key: string; label: string; description: string; children: CatalogChild[] }

/** Árbol módulo→sub-módulos con labels en español para display. */
export function moduleCatalogTree(): CatalogModule[] {
  return MODULE_CATALOG.map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description,
    children: (m.submodules ?? []).map((s) => ({ key: s.key, label: s.label, description: s.description })),
  }))
}

/**
 * QA 2026-08-30 — un admin que arma un plan eligiendo módulos esperaba que la Descripción/
 * Features de la landing salieran solas ("¿se pone automática o cómo?"); hoy son texto libre
 * sin ninguna conexión con `modules` (ver mem `plan-modules-landing-description-gap`). Esto
 * NO reemplaza esos campos — les da un valor de arranque razonable cuando el admin los deja
 * vacíos, usando el MISMO catálogo que ya describe cada módulo (single source, GH-31-like).
 * Solo mira módulos TOP-LEVEL: si el plan trae una sub-clave suelta (`finance.billing` sin
 * `finance`), igual cuenta el módulo padre una sola vez — el resumen es a nivel de producto,
 * no de submenú.
 */
export function suggestPlanCopy(keys: readonly unknown[]): { description: string; features: string[] } {
  const set = new Set((keys ?? []).map(String))
  const mods = MODULE_CATALOG.filter((m) => set.has(m.key) || (m.submodules ?? []).some((s) => set.has(s.key)))
  if (mods.length === 0) return { description: '', features: [] }
  const labels = mods.map((m) => m.label)
  const description = labels.length === 1
    ? `Incluye ${labels[0]}.`
    : `Incluye ${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}.`
  return { description, features: mods.map((m) => m.description) }
}

/**
 * CS-9: `plans.modules` aceptaba cualquier string — un typo o una clave retirada del catálogo
 * quedaba persistida y el gate la ignoraba en silencio (el hotel "perdía" el módulo sin razón
 * visible). Devuelve las claves de la matriz que NO existen en el catálogo (deduplicadas).
 */
export function invalidPlanModuleKeys(keys: readonly unknown[]): string[] {
  const valid = new Set(allKeys())
  const seen = new Set<string>()
  const invalid: string[] = []
  for (const k of keys) {
    const key = String(k)
    if (!valid.has(key) && !seen.has(key)) {
      seen.add(key)
      invalid.push(key)
    }
  }
  return invalid
}

async function readRaw(
  configRepo: RepositoryAdapter<any>,
  logger?: GateLogger,
): Promise<{ row: any; value: Record<string, boolean> }> {
  const rows = await configRepo.findMany({ hotelId: PLATFORM, key: CONFIG_KEY })
  const row = (rows as any[])?.[0]
  let value: unknown = {}
  if (row) {
    if (typeof row.value === 'string') {
      // R3-3: un valor corrupto (escritura a mano, migración truncada) reventaba con 500 en
      // CADA ruta gateada del hotel. La clave corrupta se IGNORA (defaults ON) + ERROR: no
      // se pierde el hotel por una toggle global ilegible, pero el problema queda visible.
      try {
        value = JSON.parse(row.value)
      } catch {
        logger?.error("configuration(platform,'modules') con JSON corrupto — se ignoran los overrides globales (defaults ON)")
        value = {}
      }
    } else {
      value = row.value
    }
  }
  return { row, value: value && typeof value === 'object' ? value as Record<string, boolean> : {} }
}

/** Estado completo: cada módulo/submódulo del catálogo con su on/off (default ON si no está seteado). */
export async function getModuleState(configRepo: RepositoryAdapter<any>, logger?: GateLogger): Promise<ModuleState> {
  const { value } = await readRaw(configRepo, logger)
  const state: ModuleState = {}
  for (const k of allKeys()) state[k] = value[k] !== false
  return state
}

/**
 * Estado EFECTIVO para un hotel: global-ON ∩ (módulos y submódulos del plan) ∩ (override por hotel).
 * El plan.modules es una lista plana de claves top-level Y submódulos punteados (`finance.night-audit`).
 * super_admin / sin plan → solo global.
 * Retrocompat:
 *  - Plan sin módulos definidos (array vacío) → incluye TODO (los planes viejos no pierden nada).
 *  - Plan que lista un módulo top-level → él y TODOS sus sub-módulos (expansión padre→hijos, CS-1).
 *  - Sub-clave punteada listada sin su padre → habilita SOLO esa sub-clave: ni el padre ni
 *    sus hermanos (la expansión es padre→hijos, nunca hijos→padre — R3-2).
 * El toggle global siempre manda: si un módulo/submódulo está apagado global, se cae para todos.
 *
 * 3ra capa — overrides por hotel (overridesRepo + hotelId opcionales, retrocompatible):
 *  - status:'enabled'  → fuerza ON aunque el plan no lo incluya (trial / concesión manual del super_admin).
 *  - status:'disabled' → fuerza OFF aunque el plan sí lo incluya (bloqueo comercial / deudor).
 *  - Vigencia: startsAt futuro → no aplica aún; endsAt pasado → se ignora (trial vencido respeta el plan).
 *  - Un override solo pisa claves que existen en el catálogo (state[moduleKey]); claves desconocidas se ignoran.
 *  - Sin overridesRepo/hotelId (3 args) → comportamiento idéntico al previo (global ∩ plan).
 */
export async function getModuleStateForPlan(
  configRepo: RepositoryAdapter<any>,
  plansRepo: RepositoryAdapter<any>,
  planSlug?: string,
  overridesRepo?: RepositoryAdapter<any>,
  hotelId?: string,
  logger?: GateLogger,
): Promise<ModuleState> {
  const global = await getModuleState(configRepo, logger)
  let planModules: string[] | null = null
  if (planSlug) {
    const plan = ((await plansRepo.findMany({ slug: planSlug })) as any[])?.[0]
    const raw = plan?.modules ? (typeof plan.modules === 'string' ? JSON.parse(plan.modules) : plan.modules) : []
    if (Array.isArray(raw) && raw.length) planModules = raw.map(String)
    // Slug desconocido → sin matriz → todo incluido. LEGACY explícito: los hoteles creados
    // antes de `plans` tienen `hotels.plan` con valores que ya no existen en la tabla.
  }
  return applyPlanState(configRepo, planModules, overridesRepo, hotelId)
}

/**
 * Estado EFECTIVO para un HOTEL: global ∩ plan ∩ override. A diferencia de getModuleStateForPlan,
 * el plan NO sale del espejo `hotels.plan` — lo resuelve `resolveHotelPlan` (suscripción activa
 * primero, legacy después). Esta es la función que usan el gate de API (require-module.ts), el
 * menú del panel (`GET /api/modules`) y los públicos que dependen del módulo (public-menu.ts).
 */
export async function getModuleStateForHotel(
  configRepo: RepositoryAdapter<any>,
  plansRepo: RepositoryAdapter<any>,
  subscriptionsRepo: RepositoryAdapter<any>,
  hotelId: string | undefined,
  overridesRepo?: RepositoryAdapter<any>,
  /** Espejo legacy `hotels.plan` — solo se consulta si el hotel no tiene suscripción activa. */
  hotelPlanSlug?: string,
  logger?: GateLogger,
): Promise<ModuleState> {
  if (!hotelId || hotelId === 'platform') {
    // Plataforma/super_admin: sin plan de hotel, solo el toggle global (como hoy).
    return getModuleStateForPlan(configRepo, plansRepo, undefined, overridesRepo, hotelId, logger)
  }
  const resolved = await resolveHotelPlan(subscriptionsRepo, plansRepo, hotelId, hotelPlanSlug, logger)
  return applyPlanState(configRepo, resolved.modules, overridesRepo, hotelId, logger)
}

/**
 * CS-1: un módulo padre IMPLICA sus sub-módulos (`padre` → todos los `padre.*`). El guard de
 * la API exige la SUB-clave (`moduleGuard('reservations.list')` protege /api/reservas*), así
 * que un plan que lista `reservations` sin `reservations.list` dejaba TODO el módulo en 403:
 * la jerarquía del catálogo es implícita y el que arma la matriz (seeder/admin) no tiene que
 * saber qué sub-claves exige cada ruta. La expansión es padre→hijos, NUNCA al revés: listar
 * `finance.billing` sin `finance` no prende al padre ni a sus hermanos — pero desde R3-2 la
 * sub-clave listada SÍ habilita su sub-módulo por sí misma (ver applyPlanState).
 */
function expandPlanModules(planModules: string[]): Set<string> {
  const set = new Set(planModules)
  for (const m of MODULE_CATALOG) {
    if (set.has(m.key)) for (const s of m.submodules ?? []) set.add(s.key)
  }
  return set
}

/** Núcleo compartido: aplica global ∩ matriz del plan ∩ overrides sobre el catálogo. */
async function applyPlanState(
  configRepo: RepositoryAdapter<any>,
  planModules: string[] | null,
  overridesRepo?: RepositoryAdapter<any>,
  hotelId?: string,
  logger?: GateLogger,
): Promise<ModuleState> {
  const global = await getModuleState(configRepo, logger)
  const effective = planModules ? expandPlanModules(planModules) : null
  const has = (k: string) => !effective || effective.has(k)
  const state: ModuleState = {}
  for (const m of MODULE_CATALOG) {
    const moduleOn = global[m.key] !== false && has(m.key)
    state[m.key] = moduleOn
    const fatherGlobalOn = global[m.key] !== false
    for (const s of m.submodules ?? []) {
      // R3-2: la sub-clave listada habilita el sub-módulo por sí misma, sin exigir el
      // padre en la matriz (essential promete finance.billing/payments SIN 'finance':
      // bajo "padre = módulo completo", listar el padre regalaría los 8 sub-módulos que
      // el plan no incluye). El padre NO queda implicado por sus hijos, y el toggle
      // global del padre sigue apagando la sección entera (fatherGlobalOn).
      state[s.key] = fatherGlobalOn && global[s.key] !== false && has(s.key)
    }
  }

  // 3ra capa: overrides por hotel. Aplica DESPUÉS de global ∩ plan → puede forzar ON u OFF.
  // Solo se consideran overrides vigentes (startsAt ya empezado Y endsAt no expirado).
  if (overridesRepo && hotelId) {
    const now = new Date().toISOString()
    const rows = ((await overridesRepo.findMany({ hotelId })) as any[]) ?? []
    for (const o of rows) {
      const started = !o.startsAt || o.startsAt <= now
      const notExpired = !o.endsAt || o.endsAt > now
      if (started && notExpired && o.moduleKey in state) {
        state[o.moduleKey] = o.status === 'enabled'
      }
    }
  }
  return state
}

/** Aplica un patch parcial (solo claves del catálogo) y persiste. Devuelve el estado resultante. */
export async function setModuleState(configRepo: RepositoryAdapter<any>, patch: ModuleState): Promise<ModuleState> {
  const { row } = await readRaw(configRepo)
  const current = await getModuleState(configRepo)
  const next: ModuleState = { ...current }
  const valid = new Set(allKeys())
  for (const k of Object.keys(patch || {})) if (valid.has(k)) next[k] = !!patch[k]
  if (row) await configRepo.update(row.id, { value: next })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: PLATFORM, key: CONFIG_KEY, value: next })
  return next
}
