import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useModulesStore } from '@/stores/modules.store'
import { permissionModuleForPath } from '@/config/module-map'
import { hasPermission, isSystemRole } from '@/config/permissions'
import { useToast } from '@/composables/useToast'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/pages/landing/index.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/hotel-fundador',
      name: 'hotel-fundador',
      component: () => import('@/pages/hotel-fundador/index.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/checkin/:hash',
      name: 'pre-checkin',
      component: () => import('@/pages/pre-checkin/index.vue'),
      meta: { layout: 'none' },
    },
    {
      // F2 2.11 (solmi-direct-booking) — reemplazo del widget SPA viejo. La ruta /book/:slug
      // punta ahora al NUEVO widget multi-step (pages/public/booking-widget.vue), que reusa
      // useBooking + 6 step components. El archivo pages/booking-widget/index.vue fue borrado.
      // Sin auth guard: el backend rate-limita por IP y los endpoints públicos no requieren sesión.
      // Embebible en sitios externos via /widget/loader.js (shim iframe con ?embed=1, F2 2.13).
      path: '/book/:slug',
      name: 'booking-widget',
      component: () => import('@/pages/public/booking-widget.vue'),
      meta: { layout: 'none' },
    },
    {
      // F1 1.5 (solmi-direct-booking) — Landing pública del hotel por slug. Sin auth guard
      // (igual que /book/:slug): el backend rate-limita por IP y el endpoint público de
      // bloques solo devuelve active=1. El componente orquesta PublicHotel + Landing services.
      path: '/h/:slug',
      name: 'hotel-landing',
      component: () => import('@/pages/public/hotel-landing.vue'),
      meta: { layout: 'none' },
    },
    {
      // F3 3.17 (solmi-direct-booking) — Página pública STANDALONE post-redirect Stripe.
      // Llega con query `?booking=:id&token=:token` (placeholders literales por deuda del
      // backend stripe.ts que no reemplaza — F2 dejó sessionStorage backup). Sin auth guard.
      // Sub-ruta de /h/:slug para distinguirla de la landing sin pisar ese path.
      path: '/h/:slug/confirm',
      name: 'booking-confirmation',
      component: () => import('@/pages/public/booking-confirmation.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/auth/login.vue'),
      meta: { layout: 'none' },
    },
    {
      // Alta pública: acá aterriza el "Prueba Gratis" de la landing.
      path: '/registro',
      name: 'registro',
      component: () => import('@/pages/auth/register.vue'),
      meta: { layout: 'none' },
    },
    {
      // Link de referido (PLAN-REFERIDOS.md). Redirige al registro con el código pre-cargado
      // en vez de una página propia — es solo un puente, la UI real vive en /registro.
      path: '/r/:code',
      redirect: (to) => ({ path: '/registro', query: { ref: to.params.code } }),
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/pages/auth/forgot-password.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/pages/auth/reset-password.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('@/pages/auth/change-password.vue'),
      meta: { layout: 'none' },
    },
    {
      // #421: destino del redirect de GET /api/public/verify-email?token=… → ?status=<outcome>
      path: '/verificar-email',
      name: 'verificar-email',
      component: () => import('@/pages/verificar-email.vue'),
      meta: { layout: 'none' },
    },
    {
      // Reseña pública post-checkout: el huésped responde el invite sin login (token = autorización).
      path: '/resena/:token',
      name: 'resena',
      component: () => import('@/pages/resena/index.vue'),
      meta: { layout: 'none' },
    },
    {
      // Carta pública de solo lectura (F7) — huésped escaneando el QR de su mesa, SIN sesión.
      // Sin meta requiresXxx: el guard de abajo no toca esta ruta (no empieza con /panel/).
      path: '/menu/:hotelId',
      name: 'public-menu',
      component: () => import('@/pages/public/menu.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/legal/terminos',
      name: 'legal-terminos',
      component: () => import('@/pages/legal/terminos.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/legal/privacidad',
      name: 'legal-privacidad',
      component: () => import('@/pages/legal/privacidad.vue'),
      meta: { layout: 'none' },
    },
    {
      path: '/admin',
      component: () => import('@/layouts/SuperAdminLayout.vue'),
      meta: { requiresSuperAdmin: true },
      children: [
        {
          path: '',
          name: 'super-admin',
          component: () => import('@/pages/super-admin/index.vue'),
        },
        {
          path: 'hotels',
          name: 'super-admin-hotels',
          component: () => import('@/pages/super-admin/hotels.vue'),
        },
        {
          path: 'subscriptions',
          name: 'super-admin-subscriptions',
          component: () => import('@/pages/super-admin/subscriptions.vue'),
        },
        {
          path: 'subscriptions/founders-pioneers',
          name: 'super-admin-subscriptions-founders',
          component: () => import('@/pages/super-admin/subscriptions-founders.vue'),
        },
        {
          path: 'referrals',
          name: 'super-admin-referrals',
          component: () => import('@/pages/super-admin/referrals.vue'),
        },
        {
          path: 'aliados',
          name: 'super-admin-aliados',
          component: () => import('@/pages/super-admin/aliados.vue'),
        },
        {
          path: 'email-templates',
          name: 'super-admin-email-templates',
          component: () => import('@/pages/super-admin/email-templates.vue'),
        },
        {
          path: 'sitio',
          name: 'super-admin-sitio',
          component: () => import('@/pages/super-admin/sitio.vue'),
        },
        {
          path: 'support',
          name: 'super-admin-support',
          component: () => import('@/pages/super-admin/support.vue'),
        },
        {
          path: 'billing',
          name: 'super-admin-billing',
          component: () => import('@/pages/super-admin/billing.vue'),
        },
        {
          path: 'analytics',
          name: 'super-admin-analytics',
          component: () => import('@/pages/super-admin/analytics.vue'),
        },
        {
          path: 'users',
          name: 'super-admin-users',
          component: () => import('@/pages/super-admin/users.vue'),
        },
        {
          path: 'channels',
          name: 'super-admin-channels',
          component: () => import('@/pages/super-admin/channels.vue'),
        },
        {
          path: 'settings',
          name: 'super-admin-settings',
          component: () => import('@/pages/super-admin/settings.vue'),
        },
        {
          path: 'audit',
          name: 'super-admin-audit',
          component: () => import('@/pages/super-admin/audit.vue'),
        },
        {
          path: 'feedback',
          name: 'super-admin-feedback',
          component: () => import('@/pages/super-admin/feedback.vue'),
        },
        {
          path: 'monitoring',
          name: 'super-admin-monitoring',
          component: () => import('@/pages/super-admin/monitoring.vue'),
        },
        {
          path: 'announcements',
          name: 'super-admin-announcements',
          component: () => import('@/pages/super-admin/announcements.vue'),
        },
        {
          path: 'plans',
          name: 'super-admin-plans',
          component: () => import('@/pages/super-admin/plans.vue'),
        },
        {
          path: 'modules',
          name: 'super-admin-modules',
          component: () => import('@/pages/super-admin/modules.vue'),
        },
        {
          path: 'api-keys',
          name: 'super-admin-api-keys',
          component: () => import('@/pages/super-admin/api-keys.vue'),
        },
        {
          path: 'roles',
          name: 'super-admin-roles',
          component: () => import('@/pages/super-admin/roles.vue'),
        },
        {
          path: 'empleados',
          name: 'super-admin-empleados',
          component: () => import('@/pages/empleados/index.vue'),
        },
      ],
    },
    {
      path: '/panel',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { requiresHotelAuth: true },
      children: [
        {
          // Mesero/cocina solo tienen UN ítem en el menú (Salón/Cocina) — aterrizar en el
          // dashboard general (que no pueden usar) sería confuso. Van directo a su pantalla.
          path: '',
          redirect: () => {
            const role = useAuthStore().userRole
            if (role === 'waiter') return '/panel/restaurante/salon'
            if (role === 'kitchen') return '/panel/restaurante/cocina'
            return '/panel/dashboard'
          },
        },
        // Compat: las URLs viejas de RRHH (planas) redirigen a las nuevas bajo /panel/rrhh/*,
        // así no se rompen links guardados ni bookmarks.
        { path: 'empleados', redirect: '/panel/rrhh/empleados' },
        { path: 'attendance', redirect: '/panel/rrhh/attendance' },
        { path: 'payroll', redirect: '/panel/rrhh/payroll' },
        { path: 'team', redirect: '/panel/rrhh/team' },
        { path: 'activos', redirect: '/panel/rrhh/activos' },
        { path: 'capacitacion', redirect: '/panel/rrhh/capacitacion' },
        { path: 'roles', redirect: '/panel/rrhh/roles' },
        { path: 'rrhh-dashboard', redirect: '/panel/rrhh/dashboard' },
        // Compat: el resto de las URLs planas, agrupadas bajo el prefijo de su sección.
        // La jerarquía sale del catálogo de módulos (config/module-map.ts): finance.* → /finanzas,
        // operations.* → /operaciones, sales.* → /ventas, ai.* → /ia, settings.* → /config.
        // Mismo criterio que RRHH arriba: la ruta vieja redirige, no muere en 404.
        { path: 'reservations', redirect: (to) => ({ path: '/panel/reservas', query: to.query }) },
        { path: 'checkin', redirect: (to) => ({ path: '/panel/reservas/checkin', query: to.query }) },
        { path: 'housekeeping', redirect: (to) => ({ path: '/panel/operaciones/limpieza', query: to.query }) },
        { path: 'maintenance', redirect: (to) => ({ path: '/panel/operaciones/mantenimiento', query: to.query }) },
        { path: 'technical-providers', redirect: (to) => ({ path: '/panel/operaciones/proveedores', query: to.query }) },
        { path: 'team-chat', redirect: (to) => ({ path: '/panel/operaciones/chats', query: to.query }) },
        { path: 'billing', redirect: (to) => ({ path: '/panel/finanzas/facturacion', query: to.query }) },
        { path: 'folios', redirect: (to) => ({ path: '/panel/finanzas/folios', query: to.query }) },
        { path: 'payments', redirect: (to) => ({ path: '/panel/finanzas/links-pago', query: to.query }) },
        { path: 'caja', redirect: (to) => ({ path: '/panel/finanzas/caja', query: to.query }) },
        { path: 'gastos', redirect: (to) => ({ path: '/panel/finanzas/gastos', query: to.query }) },
        { path: 'reports', redirect: (to) => ({ path: '/panel/finanzas/reportes', query: to.query }) },
        { path: 'night-audit', redirect: (to) => ({ path: '/panel/finanzas/night-audit', query: to.query }) },
        { path: 'groups', redirect: (to) => ({ path: '/panel/reservas/grupos', query: to.query }) },
        { path: 'packages', redirect: (to) => ({ path: '/panel/config/promociones', query: to.query }) },
        { path: 'opiniones', redirect: (to) => ({ path: '/panel/resenas', query: to.query }) },
        // Reorg "Ventas" → alineado con MisterPlan: Grupos a Reservas, Promociones a Config, Reseñas top-level.
        { path: 'ventas/grupos', redirect: (to) => ({ path: '/panel/reservas/grupos', query: to.query }) },
        { path: 'ventas/promociones', redirect: (to) => ({ path: '/panel/config/promociones', query: to.query }) },
        { path: 'ventas/opiniones', redirect: (to) => ({ path: '/panel/resenas', query: to.query }) },
        { path: 'ai-receptionist/config', redirect: (to) => ({ path: '/panel/ia/recepcionista/config', query: to.query }) },
        { path: 'ai-receptionist', redirect: (to) => ({ path: '/panel/ia/recepcionista', query: to.query }) },
        { path: 'ai-gerente', redirect: (to) => ({ path: '/panel/ia/gerente', query: to.query }) },
        { path: 'settings', redirect: (to) => ({ path: '/panel/config', query: to.query }) },
        { path: 'rooms', redirect: (to) => ({ path: '/panel/config/habitaciones', query: to.query }) },
        { path: 'mensajeria', redirect: (to) => ({ path: '/panel/config/mensajeria', query: to.query }) },
        { path: 'pagos', redirect: (to) => ({ path: '/panel/config/pasarelas', query: to.query }) },
        { path: 'cerraduras', redirect: (to) => ({ path: '/panel/config/cerraduras', query: to.query }) },
        { path: 'devices', redirect: (to) => ({ path: '/panel/config/dispositivos', query: to.query }) },
        {
          path: 'dashboard',
          name: 'dashboard-general',
          component: () => import('@/pages/dashboard/index.vue'),
        },
        // Compat: URLs viejas del dashboard, retiradas en favor de /panel/dashboard — redirect por links/bookmarks guardados.
        { path: 'dashboard/general', redirect: '/panel/dashboard' },
        { path: 'dashboard/administrativo', redirect: '/panel/dashboard' },
        {
          path: 'reservas',
          name: 'reservations',
          component: () => import('@/pages/reservations/index.vue'),
        },
        {
          path: 'config/habitaciones',
          name: 'rooms',
          component: () => import('@/pages/rooms/index.vue'),
        },
        {
          path: 'config/tarifas',
          name: 'tarifas',
          component: () => import('@/pages/tarifas/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'guests',
          name: 'guests',
          component: () => import('@/pages/guests/index.vue'),
        },
        {
          path: 'finanzas/facturacion',
          name: 'billing',
          component: () => import('@/pages/billing/index.vue'),
        },
        {
          path: 'finanzas/reportes',
          name: 'reports',
          component: () => import('@/pages/reports/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        // Contabilidad (CTB-7) — plan de cuentas, libro diario, mayor, reportes.
        { path: 'contabilidad/plan-cuentas', name: 'accounting-accounts', component: () => import('@/pages/contabilidad/plan-cuentas.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'contabilidad/libro-diario', name: 'accounting-journal', component: () => import('@/pages/contabilidad/libro-diario.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'contabilidad/mayor', name: 'accounting-ledger', component: () => import('@/pages/contabilidad/mayor.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'contabilidad/reportes', name: 'accounting-reports', component: () => import('@/pages/contabilidad/reportes.vue'), meta: { requiresHotelAdmin: true } },
        // Tesorería (TES-6) — liquidez, bancos, AR/AP, presupuesto.
        { path: 'tesoreria/dashboard', name: 'treasury-dashboard', component: () => import('@/pages/tesoreria/dashboard.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'tesoreria/bancos', name: 'treasury-banks', component: () => import('@/pages/tesoreria/bancos.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'tesoreria/cuentas', name: 'treasury-accounts', component: () => import('@/pages/tesoreria/cuentas.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'tesoreria/presupuesto', name: 'treasury-budget', component: () => import('@/pages/tesoreria/presupuesto.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'tesoreria/proveedores', name: 'treasury-suppliers', component: () => import('@/pages/tesoreria/proveedores.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'tesoreria/caja-chica', name: 'treasury-petty-cash', component: () => import('@/pages/tesoreria/caja-chica.vue'), meta: { requiresHotelAdmin: true } },
        // Restaurante / POS (RES-7) — operacional (meseros/recepción); gateado por module-map (restaurant).
        // QA-ALTO: defensa en profundidad — el backend ya rechaza mutaciones de carta sin
        // restaurant-catalog:*, pero sin esta meta un mesero/cocina podía navegar acá por URL
        // directa y ver los botones de editar habilitados (aunque el submit fallara 403).
        { path: 'restaurante/carta', name: 'restaurant-menu', component: () => import('@/pages/restaurante/carta.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'restaurante/salon', name: 'restaurant-floor', component: () => import('@/pages/restaurante/salon.vue') },
        { path: 'restaurante/comanda/:id', name: 'restaurant-order', component: () => import('@/pages/restaurante/comanda.vue') },
        { path: 'restaurante/cocina', name: 'restaurant-kds', component: () => import('@/pages/restaurante/cocina.vue') },
        { path: 'restaurante/cobrar/:id', name: 'restaurant-pay', component: () => import('@/pages/restaurante/cobrar.vue') },
        { path: 'restaurante/caja', name: 'restaurant-cash', component: () => import('@/pages/restaurante/caja.vue') },
        // Inventario + Compras (INV/COM) — gateado por module-map (inventory / purchasing).
        { path: 'inventario', name: 'inventory', component: () => import('@/pages/inventario/index.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'compras/requisiciones', name: 'purchasing-requisitions', component: () => import('@/pages/compras/requisiciones.vue'), meta: { requiresHotelAdmin: true } },
        { path: 'compras/ordenes', name: 'purchasing-orders', component: () => import('@/pages/compras/ordenes.vue'), meta: { requiresHotelAdmin: true } },
        {
          path: 'operaciones/limpieza',
          name: 'housekeeping',
          component: () => import('@/pages/housekeeping/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'operaciones/mantenimiento',
          name: 'maintenance',
          component: () => import('@/pages/maintenance/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'operaciones/proveedores',
          name: 'technical-providers',
          component: () => import('@/pages/technical-providers/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'operaciones/chats',
          name: 'team-chat',
          component: () => import('@/pages/team-chat/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'finanzas/night-audit',
          name: 'night-audit',
          component: () => import('@/pages/night-audit/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'reservas/grupos',
          name: 'groups',
          component: () => import('@/pages/groups/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'resenas',
          name: 'opiniones',
          component: () => import('@/pages/opiniones/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'finanzas/gastos',
          name: 'gastos',
          component: () => import('@/pages/gastos/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'config',
          name: 'settings',
          component: () => import('@/pages/settings/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        // Página pública + Motor de reservas: antes eran pestañas dentro de Configuración
        // (settings/index.vue). UX: van en su propia sección del menú lateral.
        {
          path: 'pagina-publica',
          name: 'pagina-publica-general',
          component: () => import('@/pages/pagina-publica/general.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'pagina-publica/landing',
          name: 'pagina-publica-landing',
          component: () => import('@/pages/pagina-publica/landing.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          // Gestor de imágenes del hotel (hero/gallery/room) — panel-pagina-publica-gaps.
          path: 'pagina-publica/media',
          name: 'pagina-publica-media',
          component: () => import('@/pages/pagina-publica/media.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'pagina-publica/apariencia',
          name: 'pagina-publica-apariencia',
          component: () => import('@/pages/pagina-publica/apariencia.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'pagina-publica/reputacion',
          name: 'pagina-publica-reputacion',
          component: () => import('@/pages/pagina-publica/reputation.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'pagina-publica/tracking',
          name: 'pagina-publica-tracking',
          component: () => import('@/pages/pagina-publica/tracking.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'support',
          name: 'support',
          component: () => import('@/pages/support/index.vue'),
        },
        {
          path: 'booking-engine',
          name: 'booking-engine',
          component: () => import('@/pages/booking-engine/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'reservas/checkin',
          name: 'checkin',
          component: () => import('@/pages/checkin/index.vue'),
        },
        {
          path: 'config/promociones',
          name: 'packages',
          component: () => import('@/pages/packages/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          // FIX 2026-07-31 — el widget público ya validaba códigos de descuento (F2.5) pero
          // no había ninguna pantalla para crearlos: /api/promo-codes tenía CRUD completo sin UI.
          path: 'promociones/codigos',
          name: 'promo-codes',
          component: () => import('@/pages/promo-codes/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'ia/recepcionista',
          name: 'ai-receptionist',
          component: () => import('@/pages/ai-receptionist/chat.vue'),
        },
        {
          path: 'ia/recepcionista/config',
          name: 'ai-receptionist-config',
          component: () => import('@/pages/ai-receptionist/config.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/empleados',
          name: 'empleados',
          component: () => import('@/pages/empleados/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'rrhh/empleados/:id/expediente',
          name: 'empleado-expediente',
          component: () => import('@/pages/empleados/expediente.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'rrhh/evaluacion',
          name: 'rrhh-evaluacion',
          component: () => import('@/pages/rrhh-evaluacion/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/dashboard',
          name: 'rrhh-dashboard',
          component: () => import('@/pages/rrhh-dashboard/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/payroll',
          name: 'payroll',
          component: () => import('@/pages/payroll/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/attendance',
          name: 'attendance',
          component: () => import('@/pages/attendance/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'rrhh/reclutamiento',
          name: 'reclutamiento',
          component: () => import('@/pages/reclutamiento/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/reembolsos',
          name: 'reembolsos',
          component: () => import('@/pages/reembolsos/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/organigrama',
          name: 'organigrama',
          component: () => import('@/pages/organigrama/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'ia/gerente',
          name: 'ai-gerente',
          component: () => import('@/pages/ai-gerente/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'crm',
          name: 'crm',
          component: () => import('@/pages/crm/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'planning',
          name: 'planning',
          component: () => import('@/pages/planning/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'channel-manager',
          name: 'channel-manager',
          component: () => import('@/pages/channel-manager/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'channel/:id',
          name: 'channel-detail',
          component: () => import('@/pages/channel-detail/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          // Contenedor de Mensajería: las 5 vistas de abajo pasaron a ser tabs
          // suyas (ver config/messaging-tabs.ts). NO lleva requiresHotelAdmin —
          // el recepcionista entra para ver Plantillas WhatsApp e Historial; la
          // página filtra las tabs por rol y por módulo habilitado.
          path: 'config/mensajeria',
          name: 'mensajeria',
          component: () => import('@/pages/mensajeria/index.vue'),
        },
        // Rutas viejas → tab equivalente. Se conservan (con su `name`) para no
        // romper links guardados ni favoritos. Conservan la query original.
        {
          path: 'email-queue',
          name: 'email-queue',
          redirect: (to) => ({ path: '/panel/config/mensajeria', query: { ...to.query, tab: 'email-queue' } }),
        },
        {
          path: 'config/dispositivos',
          name: 'devices',
          component: () => import('@/pages/devices/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          // DT-17: antes solo /admin/* (plataforma) podía leer el audit log. El backend YA
          // aislaba correctamente por hotelId (resolveTenant fuerza al hotel del token para
          // cualquier rol que no sea super_admin) — solo faltaba la página.
          path: 'config/auditoria',
          name: 'auditoria',
          component: () => import('@/pages/auditoria/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'auto-messages',
          name: 'auto-messages',
          redirect: (to) => ({ path: '/panel/config/mensajeria', query: { ...to.query, tab: 'auto-messages' } }),
        },
        {
          // Estado de la prueba/suscripción y planes. A esta página apunta el
          // aviso de "te quedan N días" y el corte por vencimiento.
          path: 'suscripcion',
          name: 'suscripcion',
          component: () => import('@/pages/suscripcion/index.vue'),
        },
        {
          path: 'referidos',
          name: 'referidos',
          component: () => import('@/pages/referidos/index.vue'),
        },
        {
          path: 'aliados',
          name: 'aliados',
          component: () => import('@/pages/aliados/index.vue'),
        },
        {
          path: 'config/cerraduras',
          name: 'cerraduras',
          component: () => import('@/pages/cerraduras/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'config/pasarelas',
          name: 'pagos',
          component: () => import('@/pages/pagos/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'finanzas/caja',
          name: 'caja',
          component: () => import('@/pages/caja/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'whatsapp-templates',
          name: 'whatsapp-templates',
          redirect: (to) => ({ path: '/panel/config/mensajeria', query: { ...to.query, tab: 'whatsapp-templates' } }),
        },
        {
          path: 'notifications',
          name: 'notifications',
          component: () => import('@/pages/notifications/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'finanzas/folios',
          name: 'folios',
          component: () => import('@/pages/folios/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'finanzas/links-pago',
          name: 'payments',
          component: () => import('@/pages/payments/index.vue'),
          meta: { requiresHotelAuth: true },
        },
        {
          path: 'rrhh/team',
          name: 'team',
          component: () => import('@/pages/team/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/roles',
          name: 'roles',
          component: () => import('@/pages/roles/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/activos',
          name: 'activos',
          component: () => import('@/pages/activos/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'rrhh/capacitacion',
          name: 'capacitacion',
          component: () => import('@/pages/capacitacion/index.vue'),
          meta: { requiresHotelAdmin: true },
        },
        {
          path: 'message-logs',
          name: 'message-logs',
          redirect: (to) => ({ path: '/panel/config/mensajeria', query: { ...to.query, tab: 'message-logs' } }),
        },
        {
          path: 'push-tokens',
          name: 'push-tokens',
          redirect: (to) => ({ path: '/panel/config/mensajeria', query: { ...to.query, tab: 'push-tokens' } }),
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      redirect: '/',
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // Rutas solo para invitados (sin sesión): login y registro. Un usuario ya logueado no debe
  // poder verlas —ni llegar vía /r/:code, que redirige a /registro—; se lo manda a su panel/admin.
  if (to.path === '/login' || to.path === '/registro') {
    if (auth.isAuthenticated) {
      if (auth.isSuperAdmin && !auth.impersonating) {
        return '/admin'
      } else {
        return '/panel'
      }
    }
    return true
  }

  if (to.meta.requiresSuperAdmin) {
    if (!auth.isAuthenticated) return '/login'
    if (!auth.isSuperAdmin && !auth.impersonating) return '/panel'
  }

  if (to.meta.requiresHotelAuth) {
    if (!auth.isAuthenticated) return '/login'
    if (auth.isSuperAdmin && !auth.impersonating) return '/admin'
  }

  if (to.meta.requiresHotelAdmin) {
    if (!auth.isAuthenticated) return '/login'
    // super_admin y hotel_admin pasan siempre. Un rol CUSTOM pasa si su permiso cubre la ruta
    // (mismo criterio que el menú: <module>:view, CORE siempre accesible). Roles de sistema
    // no-admin (recepción, limpieza…) → a su panel, como antes. El backend igual valida 403.
    if (!auth.isSuperAdmin && !auth.isHotelAdmin) {
      const role = auth.userRole ?? ''
      const mod = permissionModuleForPath(to.path)
      const allowed = !isSystemRole(role) && (!mod || hasPermission(auth.user?.permissions, mod, 'view'))
      if (!allowed) return '/panel'
    }
  }

  // ── Bloqueo genérico por permiso (QA-MEDIO): `requiresHotelAdmin` arriba solo cubre las rutas
  // marcadas con esa meta. Un rol de permisos mínimos (mesero, cocina) navegando por URL directa a
  // una ruta /panel/* SIN esa meta pero SÍ mapeada en ROUTE_TO_PERMISSION (reservas, huéspedes,
  // facturación…) no rebotaba — quedaba en una pantalla que no es la suya (el backend igual le
  // niega los datos con 403, esto es UX, no el gate de seguridad). Rutas CORE (sin mapeo, ej.
  // dashboard) siguen accesibles a cualquiera con sesión, a propósito.
  if (to.path.startsWith('/panel/') && auth.isAuthenticated && !auth.isSuperAdmin && !auth.isHotelAdmin) {
    const mod = permissionModuleForPath(to.path)
    if (mod && !hasPermission(auth.user?.permissions, mod, 'view')) return '/panel'
  }

  // ── Bloqueo por módulo/submódulo: no basta con ocultar del menú, la URL directa también se bloquea ──
  // Aplica solo a rutas del panel del hotel y cuando hay sesión de hotel (usuario del hotel o super_admin
  // impersonando). El estado efectivo (global ∩ plan del hotel) sale de GET /api/modules, cacheado por hotel.
  if (to.path.startsWith('/panel/') && auth.isAuthenticated) {
    const modules = useModulesStore()
    await modules.ensure(auth.user?.hotelId)
    if (!modules.routeEnabled(to.path)) {
      // Módulo/submódulo no habilitado para este hotel → a su dashboard (siempre CORE/accesible).
      // #634: antes redirigía en silencio — quien tipeaba la URL directa no entendía por qué
      // "desaparecía" la sección. Un toast no requiere saber la label exacta del módulo.
      if (to.path !== '/panel/dashboard') {
        useToast().warning('Sección no disponible', 'Este módulo no está incluido en tu plan actual.')
        return '/panel/dashboard'
      }
      return false
    }
  }

  return true
})

// ── Recuperación de chunks obsoletos tras un deploy ──────────────────────────
// Vite parte la app en chunks con hash de contenido. Cuando se publica un build nuevo, los
// chunks viejos dejan de existir en el server: una pestaña ya abierta (o un index.html cacheado)
// intenta cargar el chunk viejo → 404 → el import() dinámico de la ruta rechaza, Vue Router no
// monta la vista y el menú queda muerto. Detectamos ESE error puntual y forzamos una recarga a la
// ruta destino para traer el index.html + los chunks nuevos. El flag en sessionStorage recarga una
// sola vez por destino: si tras recargar sigue fallando, no es un deploy (chunk realmente roto) y
// evitamos un loop infinito de recargas.
const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload (?:CSS|module)/i
const RELOAD_FLAG = 'router:chunk-reload'

router.onError((error: unknown, to) => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!CHUNK_ERROR_RE.test(message)) return
  const target = to?.fullPath || window.location.pathname
  if (sessionStorage.getItem(RELOAD_FLAG) === target) return
  sessionStorage.setItem(RELOAD_FLAG, target)
  window.location.assign(target)
})

router.afterEach(() => {
  // Navegación exitosa → limpiar el flag para permitir futuras auto-recuperaciones.
  sessionStorage.removeItem(RELOAD_FLAG)
})

export default router
