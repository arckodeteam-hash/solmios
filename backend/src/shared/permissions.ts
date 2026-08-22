/**
 * Permission system for hotel-level roles
 * Each hotel can create custom roles with specific permissions
 */

// Available modules in the system
export const MODULES = {
  dashboard: 'Dashboard',
  reservations: 'Reservaciones',
  guests: 'Huéspedes',
  rooms: 'Habitaciones',
  housekeeping: 'Housekeeping',
  maintenance: 'Mantenimiento',
  billing: 'Facturación',
  reports: 'Reportes',
  settings: 'Configuración',
  users: 'Usuarios',
  /** Fichar entrada/salida no es administrar usuarios: lo hace todo el personal desde la app. */
  attendance: 'Asistencia',
  /** Liquidar sueldos NO es facturar: antes usaba billing:* y recepción podía crear liquidaciones. */
  payroll: 'Nómina',
  feedback: 'Feedback',
  'channel-manager': 'Channel Manager',
  ttlock: 'Cerraduras',
  ai: 'Inteligencia Artificial',
  /** Contabilidad de doble entrada (plan de cuentas, asientos, estados financieros). */
  accounting: 'Contabilidad',
  /** Tesorería (bancos, conciliación, flujo de caja, AR/AP, presupuesto). */
  treasury: 'Tesorería',
  /** POS de restaurante — operación: mesas, comandas, cuenta, KDS. NO incluye configurar la carta
   *  (eso es `restaurant-catalog`) — un mesero/cocinero opera el POS, no reconfigura precios/menú. */
  restaurant: 'Restaurante',
  /** Config de la carta del restaurante: estaciones, categorías, ítems (precio/disponibilidad).
   *  Separado de `restaurant` a propósito (QA-ALTO): antes compartían el mismo permiso y un mesero
   *  con `restaurant:create/edit` (para abrir/editar comandas) podía TAMBIÉN crear estaciones y
   *  cambiar precios del menú — nadie se lo dio a propósito, era el mismo bucket sirviendo dos cosas
   *  con nivel de confianza muy distinto. Solo hotel_admin tiene este permiso. */
  'restaurant-catalog': 'Carta del restaurante',
  /** Inventario de insumos (comida/bebida/bar/suministro): stock, costo, movimientos. */
  inventory: 'Inventario',
  /** Compras: requisiciones, órdenes de compra, recepción de mercancía. */
  purchasing: 'Compras',
  /** Landing pública del hotel por bloques (F1 solmi-direct-booking). Solo view/edit:
   *  configurar los bloques (textos, fotos, FAQ, orden) no es CRUD de filas múltiples. */
  landing: 'Landing pública',
  /** Media del hotel (hero/gallery/room) para la landing pública (F0 solmi-direct-booking).
   *  CRUD de fotos + reorder + alt text. Solo hotel_admin lo gestiona. */
  media: 'Media del hotel',
  /** Promo codes (F2 solmi-direct-booking): códigos de descuento % o monto fijo aplicables
   *  en el widget público de reservas. Solo hotel_admin los crea/gestiona; el huésped
   *  los valida vía endpoint público sin auth (no consume este permiso). */
  promo: 'Códigos promocionales',
  /** Upsells (F2 solmi-direct-booking): extras ofrecidos en el widget público (desayuno,
   *  transfer, late checkout). Vive como sub-dominio del motor de reservas. Solo
   *  hotel_admin los gestiona; el huésped los lee por endpoint público. */
  upsells: 'Upsells del booking',
  /** Regímenes de alimentación (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes): catálogo
   *  FIJO de 3 códigos (desayuno/media pensión/todo incluido) que el hotel activa y
   *  opcionalmente pone precio. Solo hotel_admin lo gestiona; el huésped lo lee sin auth. */
  mealplans: 'Regímenes de alimentación',
} as const

// Available actions per module
export const ACTIONS = {
  view: 'Ver',
  create: 'Crear',
  edit: 'Editar',
  delete: 'Eliminar',
  export: 'Exportar',
  checkin: 'Check-in',
  checkout: 'Check-out',
} as const

/**
 * Acciones que aplican a cada módulo. Define qué casillas ofrece la matriz de permisos al dueño.
 *
 * Sin esto, la matriz mostraba TODAS las acciones en TODOS los módulos → casillas sin sentido
 * (`billing:checkin`, `housekeeping:export`) que no respalda ninguna ruta. Y peor: `checkin`/`checkout`
 * estaban excluidos de la matriz entera, así que un rol custom nunca podía hacer check-in/out y
 * "Marcar todo" le borraba esos permisos a Recepción en silencio.
 *
 * Reglas: CRUD estándar = view/create/edit/delete. `export` solo en reports (exportar a Excel/PDF).
 * `checkin`/`checkout` son exclusivos de reservas (recibir/liberar al huésped). channel-manager,
 * ttlock y ai son módulos de configuración: solo view/edit.
 */
export const MODULE_ACTIONS: Record<string, (keyof typeof ACTIONS)[]> = {
  dashboard: ['view', 'create', 'edit', 'delete'],
  reservations: ['view', 'create', 'edit', 'delete', 'checkin', 'checkout'],
  guests: ['view', 'create', 'edit', 'delete'],
  rooms: ['view', 'create', 'edit', 'delete'],
  housekeeping: ['view', 'create', 'edit', 'delete'],
  maintenance: ['view', 'create', 'edit', 'delete'],
  billing: ['view', 'create', 'edit', 'delete'],
  reports: ['view', 'create', 'edit', 'delete', 'export'],
  settings: ['view', 'create', 'edit', 'delete'],
  users: ['view', 'create', 'edit', 'delete'],
  attendance: ['view', 'create', 'edit'],
  payroll: ['view', 'create', 'edit', 'delete'],
  feedback: ['view', 'create', 'edit', 'delete'],
  'channel-manager': ['view', 'edit'],
  ttlock: ['view', 'edit'],
  ai: ['view', 'edit'],
  accounting: ['view', 'create', 'edit', 'delete'],
  treasury: ['view', 'create', 'edit', 'delete'],
  restaurant: ['view', 'create', 'edit', 'delete'],
  inventory: ['view', 'create', 'edit', 'delete'],
  purchasing: ['view', 'create', 'edit', 'delete'],
  // Landing pública: solo view/edit (toggle, reorder, editar config). Sin create/delete
  // (los 9 bloques existen por seeder; el admin no crea/borra tipos).
  landing: ['view', 'edit'],
  // Media del hotel (F0): CRUD completo (subir/mover/borrar fotos) + reorder drag-and-drop.
  media: ['view', 'create', 'edit', 'delete'],
  // Promo codes (F2): CRUD completo. El validador público no usa permisos (endpoint sin auth).
  promo: ['view', 'create', 'edit', 'delete'],
  // Upsells (F2): CRUD completo. El endpoint público los lista sin permisos.
  upsells: ['view', 'create', 'edit', 'delete'],
  // Regímenes de alimentación: catálogo fijo, sin create/delete (solo activar + poner precio).
  mealplans: ['view', 'edit'],
}

/** Acciones válidas para un módulo. Fallback a ['view'] si el módulo no está mapeado (fail-cerrado). */
export function actionsForModule(module: string): (keyof typeof ACTIONS)[] {
  return MODULE_ACTIONS[module] ?? ['view']
}

// Permission format: "module:action" (e.g., "reservations:view", "billing:edit")
export type Permission = string

// Default permissions for system roles
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  // Hotel Admin - full access to everything
  // El dueño del hotel administra TODO su hotel. Le faltaban los `:delete` de billing/housekeeping/
  // maintenance y los `:create/:edit/:delete` de dashboard (anuncios, notificaciones), reports
  // (opiniones, tickets, night-audit) y settings (dispositivos, api keys, auto-mensajes, bloqueos de
  // tarifa): 32 endpoints eran inalcanzables para él, incluido borrar una factura o un gasto.
  //
  // Alta/baja de HOTELES no está acá: es operación de plataforma (`hotels:*`, solo super_admin).
  hotel_admin: [
    'dashboard:view', 'dashboard:create', 'dashboard:edit', 'dashboard:delete',
    'reservations:view', 'reservations:create', 'reservations:edit', 'reservations:delete', 'reservations:checkin', 'reservations:checkout',
    'guests:view', 'guests:create', 'guests:edit', 'guests:delete',
    'rooms:view', 'rooms:create', 'rooms:edit', 'rooms:delete',
    'housekeeping:view', 'housekeeping:create', 'housekeeping:edit', 'housekeeping:delete',
    'maintenance:view', 'maintenance:create', 'maintenance:edit', 'maintenance:delete',
    'billing:view', 'billing:create', 'billing:edit', 'billing:delete',
    'reports:view', 'reports:export', 'reports:create', 'reports:edit', 'reports:delete',
    'settings:view', 'settings:edit', 'settings:create', 'settings:delete',
    'users:view', 'users:create', 'users:edit', 'users:delete',
    'attendance:view', 'attendance:create', 'attendance:edit',
    // Nómina es del dueño del hotel, no de recepción: por eso payroll:* NO está en receptionist.
    'payroll:view', 'payroll:create', 'payroll:edit', 'payroll:delete',
    // SC-03: el guard de /api/feedback exigía SOLO `feedback:view` en post/patch/delete (cualquiera
    // con acceso de lectura podía crear/editar/borrar pines). Al separar los guards por acción real
    // (create/edit/delete), hotel_admin necesita los cuatro permisos para no perder la funcionalidad
    // que ya usaba de hecho.
    'feedback:view', 'feedback:create', 'feedback:edit', 'feedback:delete',
    'channel-manager:view', 'channel-manager:edit',
    'ttlock:view', 'ttlock:edit',
    'ai:view', 'ai:edit',
    // Contabilidad y tesorería: son del dueño del hotel (finanzas), no de recepción.
    'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:delete',
    'treasury:view', 'treasury:create', 'treasury:edit', 'treasury:delete',
    // POS de restaurante: el dueño configura todo (estaciones, carta, mesas) y opera.
    'restaurant:view', 'restaurant:create', 'restaurant:edit', 'restaurant:delete',
    'restaurant-catalog:view', 'restaurant-catalog:create', 'restaurant-catalog:edit', 'restaurant-catalog:delete',
    // Inventario y compras: el dueño gestiona insumos, stock, requisiciones y órdenes de compra.
    'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:delete',
    'purchasing:view', 'purchasing:create', 'purchasing:edit', 'purchasing:delete',
    // Landing pública (F1): el dueño configura los bloques, el orden y los textos.
    'landing:view', 'landing:edit',
    // Media del hotel (F0): el dueño sube/edita/reordena las fotos de la landing.
    'media:view', 'media:create', 'media:edit', 'media:delete',
    // Promo codes (F2): el dueño crea/edita códigos de descuento del widget de reservas.
    'promo:view', 'promo:create', 'promo:edit', 'promo:delete',
    // Upsells (F2): el dueño gestiona los extras del widget (desayuno, transfer, late checkout).
    'upsells:view', 'upsells:create', 'upsells:edit', 'upsells:delete',
    // Regímenes de alimentación (tasks.md 2.2/2.4): el dueño activa/desactiva y pone precio.
    'mealplans:view', 'mealplans:edit',
  ],

  // Receptionist — la operación del mostrador. Los permisos siguen a lo que el menú del panel le
  // muestra (AdminLayout.vue): sin esto ve páginas que la API le contesta 403.
  //   billing:view/create  → Folios In-House (cargos y pagos) y Links de Pago
  //   users:view           → Empleados (solo lectura)
  //   settings:view        → Plantillas de WhatsApp e Historial de Envíos (solo lectura)
  //   reports:create/edit  → abrir y responder tickets de Soporte y Opiniones
  //   ai:edit              → responder una conversación del recepcionista IA
  // NO lleva `billing:edit` ni `billing:delete`: cerrar un folio, emitir la factura o borrarla es
  // del hotel_admin.
  receptionist: [
    'dashboard:view',
    'reservations:view', 'reservations:create', 'reservations:edit', 'reservations:checkin', 'reservations:checkout',
    'guests:view', 'guests:create', 'guests:edit',
    'rooms:view',
    'housekeeping:view',
    'maintenance:view',
    'billing:view', 'billing:create',
    'reports:view', 'reports:create', 'reports:edit',
    'settings:view',
    'users:view',
    'attendance:view', 'attendance:create',
    'ttlock:view',
    'ai:view', 'ai:edit',
    // Toma comandas, las envía a cocina y las cobra desde el mostrador (create+edit); la config
    // (estaciones/carta = `restaurant-catalog`) y el borrado/cancelación (delete) son del hotel_admin.
    'restaurant:view', 'restaurant:create', 'restaurant:edit',
    // Landing pública (F1): recepción puede previsualizarla (view) pero no editar la config.
    'landing:view',
  ],

  // Housekeeper - cleaning tasks only
  housekeeper: [
    'rooms:view',
    'housekeeping:view', 'housekeeping:edit',
    // Ficha desde la app. Ve sus propios registros, no los de los demás.
    'attendance:view', 'attendance:create',
  ],

  // Supervisor - approve housekeeping, view rooms
  supervisor: [
    'dashboard:view',
    'rooms:view',
    'housekeeping:view', 'housekeeping:edit',
    // Supervisa el mantenimiento del hotel: ve los tickets y los asigna a un
    // técnico. `edit` cubre la asignación (PUT /mantenimiento/:id con assignedTo).
    'maintenance:view', 'maintenance:edit',
    // Ficha, y además corrige fichajes y arma turnos del equipo.
    'attendance:view', 'attendance:create', 'attendance:edit',
  ],

  // Maintenance - maintenance tasks only
  maintenance: [
    'rooms:view',
    'maintenance:view', 'maintenance:edit',
    // Ficha desde la app, igual que el resto del personal.
    'attendance:view', 'attendance:create',
  ],

  // Mesero — solo el POS del restaurante desde el Salón: abre comandas, agrega/edita líneas,
  // las envía a cocina, cobra en el mostrador. Sin acceso a reservas/huéspedes/facturación del
  // hotel (eso es receptionist). Config de la carta/estaciones (`restaurant-catalog`) y cancelar
  // comandas (`restaurant:delete`) son del hotel_admin — NO se le da `restaurant-catalog` a
  // propósito (QA-ALTO): sin este split, `restaurant:edit` alcanzaba para cambiar precios/menú.
  waiter: [
    'restaurant:view', 'restaurant:create', 'restaurant:edit',
    // Ficha desde el panel, igual que el resto del personal operativo.
    'attendance:view', 'attendance:create',
  ],

  // Cocina — solo el KDS: ve la cola de pedidos por estación y marca el estado de cada línea
  // (nueva → preparando → lista). No abre comandas, no cobra, no edita la carta
  // (`restaurant-catalog` no se le da — mismo criterio que waiter).
  kitchen: [
    'restaurant:view', 'restaurant:edit',
    'attendance:view', 'attendance:create',
  ],
}

/**
 * Check if a user has a specific permission
 * @param userPermissions - Array of permissions from the user's role
 * @param module - Module name (e.g., 'reservations')
 * @param action - Action name (e.g., 'view')
 * @returns true if the user has the permission
 */
export function hasPermission(userPermissions: Permission[], module: string, action: string): boolean {
  if (!userPermissions || !Array.isArray(userPermissions)) return false
  const required = `${module}:${action}`
  // `*:*` lo asigna loadPermissions a super_admin. require-permission ya lo deja pasar antes de
  // llegar acá, pero reconocerlo evita que el bypass sea el único punto que sostiene el acceso total.
  return userPermissions.includes('*:*') ||
    userPermissions.includes(required) ||
    userPermissions.includes(`${module}:*`)
}

/**
 * Check if a user has any permission for a module
 * @param userPermissions - Array of permissions from the user's role
 * @param module - Module name
 * @returns true if the user has any permission for the module
 */
export function hasModuleAccess(userPermissions: Permission[], module: string): boolean {
  if (!userPermissions || !Array.isArray(userPermissions)) return false
  return userPermissions.some(p => p.startsWith(`${module}:`))
}

/**
 * Get all permissions for a role
 * @param roleName - Role name (e.g., 'hotel_admin')
 * @param customPermissions - Custom permissions from the role record (overrides defaults)
 * @returns Array of permissions
 */
/**
 * Un permiso válido es `modulo:accion` (o `modulo:*`, o `*:*`). La tabla `roles` de instalaciones
 * viejas guarda otro formato (`billing.read`, con punto). `hasPermission` solo entiende dos puntos,
 * así que devolver esos permisos tal cual dejaría al usuario SIN ACCESO A NADA — y en silencio.
 */
const isValidPermission = (p: unknown): p is Permission => typeof p === 'string' && p.includes(':')

export function getRolePermissions(roleName: string, customPermissions?: Permission[]): Permission[] {
  const custom = Array.isArray(customPermissions) ? customPermissions.filter(isValidPermission) : []
  // Solo pisamos los defaults si la DB trae permisos que el sistema sabe evaluar. Una fila con el
  // formato viejo (o corrupta) cae al mapa estático en vez de bloquear al usuario.
  if (custom.length > 0) return custom
  return DEFAULT_ROLE_PERMISSIONS[roleName] || []
}
