// route-permissions.test.ts — SC-03 (issue #212)
//
// Verifica, montando cada módulo REAL sobre un Router real (ver route-permission-helpers.ts), que
// las rutas protegidas exigen el module:action correcto:
//   - un rol ACOTADO sin ese permiso → 403.
//   - un rol que SÍ tiene el permiso → cualquier status que NO sea 403 (la lógica de negocio puede
//     devolver 400/404/500 contra el ORM fake vacío; lo que este archivo prueba es el GUARD, no el
//     caso de uso completo).
//
// super_admin bypassa requirePermission por diseño (ver require-permission.ts) — nunca se usa acá
// como caso negativo, solo para las rutas explícitamente "solo plataforma" (hoteles POST/DELETE).
//
// Cubre: los 11 módulos núcleo pedidos en SC-03 (reservas, huéspedes, habitaciones, facturas,
// folios, payments, housekeeping, mantenimiento, usuarios, reports, hoteles/settings) + los 8
// módulos donde este cambio corrigió un guard con module:action equivocado (regresión directa).

import { describe, it, expect } from 'bun:test'
import { mountModule, bearer, NO_PERMS_ROLE } from './route-permission-helpers'

import { ReservasModule } from '../../../modules/reservas'
import { HuespedesModule } from '../../../modules/huespedes'
import { HabitacionesModule } from '../../../modules/habitaciones'
import { FacturasModule } from '../../../modules/facturas'
import { FoliosModule } from '../../../modules/folios'
import { PaymentsModule } from '../../../modules/payments'
import { HousekeepingModule } from '../../../modules/housekeeping'
import { MantenimientoModule } from '../../../modules/mantenimiento'
import { UsuariosModule } from '../../../modules/usuarios'
import { ReportsModule } from '../../../modules/reports'
import { HotelesModule } from '../../../modules/hoteles'

import { FeedbackModule } from '../../../modules/feedback'
import { AuditlogModule } from '../../../modules/auditlog'
import { GruposModule } from '../../../modules/grupos'
import { ApikeysModule } from '../../../modules/apikeys'
import { DispositivosModule } from '../../../modules/dispositivos'
import { CashModule } from '../../../modules/cash'
import { PaquetesModule } from '../../../modules/paquetes'
import { NotificacionesModule } from '../../../modules/notificaciones'

interface RouteCase {
  label: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  /** module:action que la ruta DEBERÍA exigir (documentación del caso, no se usa en runtime). */
  permission: string
  deniedRole: string
  allowedRole: string
  body?: any
}

interface ModuleSuite {
  suiteName: string
  factory: (opts?: any) => any
  opts?: any
  customRoles?: Record<string, string[]>
  cases: RouteCase[]
}

// Rol sintético con SOLO `feedback:view` — el bug arreglado en este cambio era justamente que
// tener view alcanzaba para crear/editar/borrar. Con el fix, este rol debe recibir 403 en todo
// lo que no sea GET.
const FEEDBACK_VIEW_ONLY = 'sc03_feedback_view_only'
// Roles sintéticos "solo create" — reproducen exactamente el bug de PUT-usa-'create' en los
// módulos corregidos (grupos/apikeys/dispositivos/paquetes/notificaciones).
const RESERVATIONS_CREATE_ONLY = 'sc03_reservations_create_only'
const SETTINGS_CREATE_ONLY = 'sc03_settings_create_only'
const ROOMS_CREATE_ONLY = 'sc03_rooms_create_only'
const DASHBOARD_CREATE_ONLY = 'sc03_dashboard_create_only'
const REPORTS_VIEW_ONLY = 'sc03_reports_view_only'

const suites: ModuleSuite[] = [
  // ─────────────────────────── Núcleo (SC-03 prioridad) ───────────────────────────
  {
    suiteName: 'reservas',
    factory: ReservasModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/reservas', permission: 'reservations:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      { label: 'POST crear', method: 'POST', path: '/api/reservas', permission: 'reservations:create', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      { label: 'PUT actualizar', method: 'PUT', path: '/api/reservas/r1', permission: 'reservations:edit', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      // receptionist NO tiene reservations:delete por diseño (permissions.ts) — regresión real.
      { label: 'DELETE borrar', method: 'DELETE', path: '/api/reservas/r1', permission: 'reservations:delete', deniedRole: 'receptionist', allowedRole: 'hotel_admin' },
      { label: 'POST checkin', method: 'POST', path: '/api/reservas/r1/checkin', permission: 'reservations:checkin', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      // #249: registra dinero → exige billing:create (mismo permiso que POST /api/payments), no reservations:edit.
      { label: 'POST mark-paid', method: 'POST', path: '/api/reservas/r1/mark-paid', permission: 'billing:create', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      // #253: emite factura → billing:create, mismo permiso que folios/facturas POST.
      { label: 'POST invoice (#253)', method: 'POST', path: '/api/reservas/r1/invoice', permission: 'billing:create', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
    ],
  },
  {
    suiteName: 'huespedes',
    factory: HuespedesModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/huespedes', permission: 'guests:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      { label: 'POST crear', method: 'POST', path: '/api/huespedes', permission: 'guests:create', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      { label: 'PUT actualizar', method: 'PUT', path: '/api/huespedes/g1', permission: 'guests:edit', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      // receptionist NO tiene guests:delete.
      { label: 'DELETE borrar', method: 'DELETE', path: '/api/huespedes/g1', permission: 'guests:delete', deniedRole: 'receptionist', allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'habitaciones',
    factory: HabitacionesModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/habitaciones', permission: 'rooms:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      // receptionist solo tiene rooms:view, no create/edit/delete.
      { label: 'POST crear', method: 'POST', path: '/api/habitaciones', permission: 'rooms:create', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
      { label: 'PUT actualizar', method: 'PUT', path: '/api/habitaciones/rm1', permission: 'rooms:edit', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
      { label: 'DELETE borrar', method: 'DELETE', path: '/api/habitaciones/rm1', permission: 'rooms:delete', deniedRole: 'receptionist', allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'facturas',
    factory: FacturasModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/facturas', permission: 'billing:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      { label: 'POST crear', method: 'POST', path: '/api/facturas', permission: 'billing:create', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      // receptionist NO tiene billing:edit/delete (documentado explícitamente en permissions.ts).
      { label: 'PUT actualizar', method: 'PUT', path: '/api/facturas/f1', permission: 'billing:edit', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
      { label: 'DELETE borrar', method: 'DELETE', path: '/api/facturas/f1', permission: 'billing:delete', deniedRole: 'receptionist', allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'folios',
    factory: FoliosModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/folios', permission: 'billing:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      { label: 'POST crear', method: 'POST', path: '/api/folios', permission: 'billing:create', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      { label: 'POST cerrar folio', method: 'POST', path: '/api/folios/f1/close', permission: 'billing:edit', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
    ],
  },
  {
    suiteName: 'payments',
    factory: PaymentsModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/payments', permission: 'billing:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      { label: 'POST crear', method: 'POST', path: '/api/payments', permission: 'billing:create', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
      { label: 'POST reconciliación', method: 'POST', path: '/api/billing/reconciliation', permission: 'billing:edit', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
    ],
  },
  {
    suiteName: 'housekeeping',
    factory: HousekeepingModule,
    opts: {},
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/housekeeping', permission: 'housekeeping:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'housekeeper' },
      // housekeeper tiene view/edit pero NO create.
      { label: 'POST crear', method: 'POST', path: '/api/housekeeping', permission: 'housekeeping:create', deniedRole: 'housekeeper', allowedRole: 'hotel_admin', body: {} },
      { label: 'PUT actualizar', method: 'PUT', path: '/api/housekeeping/h1', permission: 'housekeeping:edit', deniedRole: NO_PERMS_ROLE, allowedRole: 'housekeeper', body: {} },
      { label: 'DELETE borrar', method: 'DELETE', path: '/api/housekeeping/h1', permission: 'housekeeping:delete', deniedRole: 'housekeeper', allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'mantenimiento',
    factory: MantenimientoModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/mantenimiento', permission: 'maintenance:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'maintenance' },
      // maintenance tiene view/edit pero NO create.
      { label: 'POST crear', method: 'POST', path: '/api/mantenimiento', permission: 'maintenance:create', deniedRole: 'maintenance', allowedRole: 'hotel_admin', body: {} },
      { label: 'PUT actualizar', method: 'PUT', path: '/api/mantenimiento/m1', permission: 'maintenance:edit', deniedRole: NO_PERMS_ROLE, allowedRole: 'maintenance', body: {} },
      { label: 'DELETE borrar', method: 'DELETE', path: '/api/mantenimiento/m1', permission: 'maintenance:delete', deniedRole: 'maintenance', allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'usuarios',
    factory: UsuariosModule,
    opts: {},
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/usuarios', permission: 'users:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      // receptionist solo tiene users:view.
      { label: 'POST crear', method: 'POST', path: '/api/usuarios', permission: 'users:create', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
      { label: 'PUT actualizar', method: 'PUT', path: '/api/usuarios/u1', permission: 'users:edit', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
      { label: 'DELETE borrar', method: 'DELETE', path: '/api/usuarios/u1', permission: 'users:delete', deniedRole: 'receptionist', allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'reports',
    factory: ReportsModule,
    cases: [
      { label: 'GET listado', method: 'GET', path: '/api/reports', permission: 'reports:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      // receptionist tiene reports:view/create/edit pero NO export.
      { label: 'GET export', method: 'GET', path: '/api/reports/export', permission: 'reports:export', deniedRole: 'receptionist', allowedRole: 'hotel_admin' },
      { label: 'POST marcar no-show', method: 'POST', path: '/api/night-audit/mark-no-shows', permission: 'reports:edit', deniedRole: 'housekeeper', allowedRole: 'receptionist', body: {} },
    ],
  },
  {
    suiteName: 'hoteles (settings)',
    factory: HotelesModule,
    cases: [
      { label: 'GET settings', method: 'GET', path: '/api/settings', permission: 'settings:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
      // receptionist solo tiene settings:view.
      { label: 'PUT settings/hotel', method: 'PUT', path: '/api/settings/hotel', permission: 'settings:edit', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
      // Alta de hotel es operación de PLATAFORMA: ni hotel_admin la tiene (solo super_admin bypassa).
      { label: 'POST hoteles (solo plataforma)', method: 'POST', path: '/api/hoteles', permission: 'hotels:create', deniedRole: 'hotel_admin', allowedRole: 'super_admin', body: {} },
    ],
  },

  // ─────────────────────────── Módulos corregidos (regresión) ───────────────────────────
  {
    suiteName: 'feedback [FIX]',
    factory: FeedbackModule,
    customRoles: { [FEEDBACK_VIEW_ONLY]: ['feedback:view'] },
    cases: [
      // POST /api/feedback es solo-login (widget global: cualquier logueado puede crear feedback);
      // NO exige feedback:create (ese permiso por defecto solo lo tiene hotel_admin, y se eligió
      // dejar crear a cualquier usuario autenticado). Por eso no se testa acá — este suite es de
      // permisos module:action. El fix real (PATCH/DELETE exigen edit/delete, no view) va abajo.
      { label: 'PATCH editar pin (bug: antes alcanzaba con view)', method: 'PATCH', path: '/api/feedback/p1', permission: 'feedback:edit', deniedRole: FEEDBACK_VIEW_ONLY, allowedRole: 'hotel_admin', body: {} },
      { label: 'DELETE borrar pin (bug: antes alcanzaba con view)', method: 'DELETE', path: '/api/feedback/p1', permission: 'feedback:delete', deniedRole: FEEDBACK_VIEW_ONLY, allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'auditlog [FIX]',
    factory: AuditlogModule,
    cases: [
      // El POST se ELIMINÓ (S-C2): se podía forjar entradas cross-tenant. El log solo lo escribe
      // el sistema por el puerto directo. Acá se verifica el permiso del GET (ruta real que queda).
      { label: 'GET listado', method: 'GET', path: '/api/auditlog', permission: 'reports:view', deniedRole: NO_PERMS_ROLE, allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'grupos [FIX]',
    factory: GruposModule,
    customRoles: { [RESERVATIONS_CREATE_ONLY]: ['reservations:create'] },
    cases: [
      { label: 'PUT actualizar (bug: antes pedía reservations:create)', method: 'PUT', path: '/api/grupos/g1', permission: 'reservations:edit', deniedRole: RESERVATIONS_CREATE_ONLY, allowedRole: 'hotel_admin', body: {} },
    ],
  },
  {
    suiteName: 'apikeys [FIX]',
    factory: ApikeysModule,
    customRoles: { [SETTINGS_CREATE_ONLY]: ['settings:create'] },
    cases: [
      { label: 'PUT actualizar (bug: antes pedía settings:create)', method: 'PUT', path: '/api/apikeys/k1', permission: 'settings:edit', deniedRole: SETTINGS_CREATE_ONLY, allowedRole: 'hotel_admin', body: {} },
    ],
  },
  {
    suiteName: 'dispositivos [FIX]',
    factory: DispositivosModule,
    customRoles: { [SETTINGS_CREATE_ONLY]: ['settings:create'] },
    cases: [
      { label: 'PUT actualizar (bug: antes pedía settings:create)', method: 'PUT', path: '/api/dispositivos/d1', permission: 'settings:edit', deniedRole: SETTINGS_CREATE_ONLY, allowedRole: 'hotel_admin', body: {} },
    ],
  },
  {
    suiteName: 'cash [FIX]',
    factory: CashModule,
    cases: [
      // receptionist tiene billing:view/create pero NO edit/delete — el bug dejaba editar/borrar
      // movimientos de caja con billing:create, que receptionist SÍ tiene.
      { label: 'PUT actualizar movimiento (bug: antes pedía billing:create)', method: 'PUT', path: '/api/caja/movements/c1', permission: 'billing:edit', deniedRole: 'receptionist', allowedRole: 'hotel_admin', body: {} },
      { label: 'DELETE borrar movimiento (bug: antes pedía billing:create)', method: 'DELETE', path: '/api/caja/movements/c1', permission: 'billing:delete', deniedRole: 'receptionist', allowedRole: 'hotel_admin' },
    ],
  },
  {
    suiteName: 'paquetes [FIX]',
    factory: PaquetesModule,
    customRoles: { [ROOMS_CREATE_ONLY]: ['rooms:create'] },
    cases: [
      { label: 'PUT actualizar (bug: antes pedía rooms:create)', method: 'PUT', path: '/api/paquetes/pk1', permission: 'rooms:edit', deniedRole: ROOMS_CREATE_ONLY, allowedRole: 'hotel_admin', body: {} },
    ],
  },
  {
    suiteName: 'notificaciones [FIX]',
    factory: NotificacionesModule,
    customRoles: { [DASHBOARD_CREATE_ONLY]: ['dashboard:create'] },
    cases: [
      { label: 'PUT actualizar (bug: antes pedía dashboard:create)', method: 'PUT', path: '/api/notificaciones/n1', permission: 'dashboard:edit', deniedRole: DASHBOARD_CREATE_ONLY, allowedRole: 'hotel_admin', body: {} },
    ],
  },
]

for (const suite of suites) {
  describe(`route permissions — ${suite.suiteName}`, () => {
    const { router, auth } = mountModule(suite.factory, suite.opts, suite.customRoles)

    for (const c of suite.cases) {
      it(`${c.label} [${c.method} ${c.path}] exige ${c.permission}`, async () => {
        const deniedRes = await router.resolve(c.method, c.path, {
          headers: bearer(auth, c.deniedRole),
          body: c.body,
        })
        expect(deniedRes.status).toBe(403)

        const allowedRes = await router.resolve(c.method, c.path, {
          headers: bearer(auth, c.allowedRole),
          body: c.body,
        })
        expect(allowedRes.status).not.toBe(403)
      })
    }
  })
}

// S-C2: el POST /api/auditlog fue eliminado (era forjable cross-tenant). Ninguna ruta debe aceptarlo.
describe('auditlog — POST cerrado (S-C2)', () => {
  const { router, auth } = mountModule(AuditlogModule)
  it('POST /api/auditlog no existe (404), ni siquiera para hotel_admin', async () => {
    const res = await router.resolve('POST', '/api/auditlog', {
      headers: bearer(auth, 'hotel_admin'),
      body: { hotelId: 'otro', action: 'forged' },
    })
    expect(res.status).toBe(404)
  })
})
