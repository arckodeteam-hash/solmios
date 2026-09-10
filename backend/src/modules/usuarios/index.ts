// usuarios/index.ts — PUERTA PÚBLICA (auth + gestión de usuarios)
import { createModule, OrmRepository } from 'arckode-framework'
import { jwtTokenAdapter } from 'arckode-framework/adapters/jwt'
import type { StorageService } from 'arckode-framework/modules/storage'
import { bodyLimit } from 'arckode-framework/middlewares'
import { registerUsuariosModels } from './model'
import { UsuariosService } from './service'
import { UsuariosController } from './controller'
import { rateLimit, resetAttempts, getClientIp } from '../../shared/middlewares/rate-limit'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { denyImpersonation } from '../../infrastructure/auth/deny-impersonation'
import { impersonateUser } from './usecases/impersonate'
import { passwordPolicyHandler } from '../../shared/usecases/password-policy'
import { auditSafely } from '../../shared/usecases/audit'

export { UsuariosService }
export type { UsuarioDTO } from './types'

/** Una foto de perfil es una sola imagen: 5 MB de base64 sobra de largo. */
const AVATAR_UPLOAD_LIMIT = 5 * 1024 * 1024

export function UsuariosModule(opts: { storage?: StorageService } = {}) {
  return createModule({
    name: 'usuarios',
    // 1.1.0: + POST /api/auth/impersonate/:id (el super admin entra como un usuario cliente).
    version: '1.1.0',
    description: 'Autenticación y gestión de usuarios del hotel',
    contract: {
      name: 'usuarios', version: '1.1.0',
      description: 'Login JWT + CRUD de empleados del hotel',
      actions: ['login', 'me', 'updateMe', 'uploadAvatar', 'logout', 'list', 'create', 'update', 'delete', 'changePassword', 'getHotels', 'switchHotel', 'verifyOwnerCredentials', 'impersonate'],
      events: ['user.created', 'user.disabled'],
      tables: ['users'],
      dependencies: [],
      rules: ['Password hasheado bcrypt', 'Login emite JWT', 'Solo hotel_admin gestiona usuarios', 'El perfil propio no requiere users:edit'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('usuarios: auth dependency required')
      registerUsuariosModels(orm)
      const repo = new OrmRepository<any>(orm, 'Users')
      const hotelRepo = new OrmRepository<any>(orm, 'Hotels')
      const configRepo = new OrmRepository<any>(orm, 'Configuration')
      const log = logger.child('usuarios')
      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const service = new UsuariosService(repo, log, cache, auth, hotelRepo, configRepo, roleRepo)
      const controller = new UsuariosController(service, log, opts.storage, roleRepo)

      const guard = createPermissionGuard(auth, roleRepo)

      // Auth (públicas) — con rate limiting en login
      router.post('/api/auth/login', async (req) => {
        // `req.remoteAddress` detrás de nginx es siempre localhost: la IP real del
        // cliente viaja en X-Forwarded-For (getClientIp la extrae con fallback).
        const ip = getClientIp(req)
        const key = `login:${ip}`
        const { allowed, retryAfter } = await rateLimit(key)
        if (!allowed) {
          return { status: 429, body: { error: `Demasiados intentos. Intentá en ${retryAfter} segundos` } }
        }
        // Un login fallido lanza, así que no llega a resetear el contador.
        // Antes se reseteaba con cualquier resultado y el límite nunca se alcanzaba.
        const result = await controller.login(req)
        await resetAttempts(key)
        return result
      })
      // `me` y `logout` operan sobre el propio usuario del token, no sobre la
      // tabla de usuarios: pedirles `users:view` dejaba a supervisor, camarera y
      // mantenimiento sin poder leer su propio perfil ni cerrar sesión (403).
      router.get('/api/auth/me', [auth.authenticate()], (req) => controller.me(req))
      // El perfil propio: `users:edit` es el permiso para editar a OTROS. Sin estas
      // rutas, una camarera no podía ni cambiarse el nombre ni ponerse una foto.
      router.put('/api/auth/me', [auth.authenticate()], (req) => controller.updateMe(req))
      router.post('/api/auth/avatar', [auth.authenticate(), bodyLimit(AVATAR_UPLOAD_LIMIT)], (req) => controller.uploadAvatar(req))
      // Sin denyImpersonation, un admin impersonando pondría `users.token = null` del CLIENTE y le cortaría su sesión real.
      router.post('/api/auth/logout', [auth.authenticate(), denyImpersonation()], (req) => controller.logout(req))
      // Cambia la contraseña del `req.user.id` del token y exige la actual:
      // `users:edit` es el permiso para editar a OTROS, no a uno mismo.
      // Y denyImpersonation porque cambiarle la contraseña al cliente desde su propia sesión no es soporte, es tomarle la cuenta.
      router.post('/api/auth/change-password', [auth.authenticate(), denyImpersonation()], (req) => controller.changePassword(req))

      // Verificación de email (#421). El GET es público (llega desde el link del correo) con
      // rate-limit por IP; el reenvío es autenticado y limitado para no ser un cañón de spam.
      router.get('/api/public/verify-email', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`verify-email:${getClientIp(req)}`)
        if (!allowed) return { status: 429, body: { error: `Demasiados intentos. Probá en ${retryAfter}s` } }
        return controller.verifyEmail(req)
      })
      router.post('/api/auth/resend-verification', [auth.authenticate()], async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`resend-verif:${(req.user as any)?.id || getClientIp(req)}`)
        if (!allowed) return { status: 429, body: { error: `Demasiados reenvíos. Probá en ${retryAfter}s` } }
        return controller.resendVerification(req)
      })
      // forgot-password SIEMPRE responde 200 con el mismo mensaje genérico exista o no
      // el email (anti-enumeración, ver controller.forgotPassword). Por eso NO se resetea
      // el contador nunca acá: si se reseteara en cada respuesta "exitosa" (que es
      // prácticamente cualquier request bien formado) el rate limit quedaría anulado.
      // Solo decae por la ventana de tiempo del propio middleware.
      router.post('/api/auth/forgot-password', async (req) => {
        const key = `forgot-password:${getClientIp(req)}`
        const { allowed, retryAfter } = await rateLimit(key)
        if (!allowed) {
          return { status: 429, body: { error: `Demasiados intentos. Intentá en ${retryAfter} segundos` } }
        }
        return controller.forgotPassword(req)
      })
      router.post('/api/auth/reset-password', async (req) => {
        const key = `reset-password:${getClientIp(req)}`
        const { allowed, retryAfter } = await rateLimit(key)
        if (!allowed) {
          return { status: 429, body: { error: `Demasiados intentos. Intentá en ${retryAfter} segundos` } }
        }
        // Token inválido/expirado lanza AuthError (service.resetPassword), así que no
        // llega a resetear el contador. Solo un reset exitoso lo hace.
        const result = await controller.resetPassword(req)
        await resetAttempts(key)
        return result
      })
      // Refresh token — pública (el access token ya expiró)
      router.post('/api/auth/refresh', (req) => controller.refresh(req))
      // Política de contraseñas (REQ-CFG-05): pública para que los formularios la muestren antes de fallar; no expone secretos.
      router.get('/api/auth/password-policy', () => passwordPolicyHandler(configRepo))

      router.get('/api/auth/hotels', guard('users', 'view'), (req) => controller.hotels(req))
      // La sesión de impersonación pasa `guard` (tiene permisos ['*:*'] por el claim), así que sin
      // denyImpersonation switch-hotel le emitiría un token nuevo SIN `impersonatedBy` —perdiendo la
      // marca de auditoría— y CON refresh token, cuando la impersonación no tiene refresh a propósito.
      router.post('/api/auth/switch-hotel/:id', [...guard('users', 'edit'), denyImpersonation()], (req) => controller.switchHotel(req))
      // Impersonación: se cablea inline contra el usecase (no pasa por el service, que
      // ya roza el límite de tamaño del analyzer). Doble candado: rol super_admin Y
      // userType 'admin' — un token de impersonación (userType 'merchant') no puede
      // encadenar otra impersonación.
      router.post('/api/auth/impersonate/:id', [auth.authenticate('super_admin'), requireUserType('admin')], async (req: any) => {
        const result = await impersonateUser({ repo, hotelRepo, auth }, { id: req.user.id, role: req.user.role }, req.params.id)
        // Que un admin entre a la cuenta de un cliente no puede pasar en silencio.
        log.warn('impersonación', { adminId: req.user.id, targetId: result.user.id, hotelId: result.user.hotelId })
        // REQ-SOP-04: rastro de auditoría de POR QUÉ soporte entró a la cuenta — el ticket que
        // originó la impersonación, si vino de la pantalla de soporte (`{ ticketId }` opcional).
        // auditSafely nunca revienta la respuesta: si el audit log falla, la impersonación ya
        // completó igual. service.auditPort es el mismo puerto que llena usuarios-auditlog.
        const ticketId = typeof req.body?.ticketId === 'string' ? req.body.ticketId : undefined
        await auditSafely(service.auditPort, log, {
          hotelId: result.user.hotelId ?? undefined,
          userId: req.user.id,
          action: 'auth.impersonate',
          entity: 'user',
          entityId: result.user.id,
          detail: ticketId ? `Impersonación desde ticket ${ticketId}` : 'Impersonación',
        })
        return { status: 200, body: result }
      })

      router.get('/api/usuarios', guard('users', 'view'), (req) => controller.index(req))
      // Creación de usuarios: además del permiso `users:create`, rate limit por IP
      // contra spam/abuso de alta de cuentas. `store()` puede "fallar" sin lanzar
      // (403 por rol no asignable), así que el reset solo dispara con status < 400.
      router.post('/api/usuarios', [...guard('users', 'create'), denyImpersonation()], async (req) => {
        const key = `create-user:${getClientIp(req)}`
        const { allowed, retryAfter } = await rateLimit(key)
        if (!allowed) {
          return { status: 429, body: { error: `Demasiados intentos. Intentá en ${retryAfter} segundos` } }
        }
        const result = await controller.store(req)
        if (result.status < 400) await resetAttempts(key)
        return result
      })
      // El ABM de usuarios queda fuera de la impersonación por la misma razón que change-password:
      // la sesión tiene permisos ['*:*'] (se los da loadPermissions por el claim), así que `guard`
      // la deja pasar a escribir usuarios. Sin este candado, una sesión de soporte de 2h podía
      // cambiarle la contraseña a alguien sin pedir la actual o moverle el rol: cambios que quedan
      // escritos mucho después de que la sesión caduque. Definir quién es quién no es parte de
      // mirar la cuenta de un cliente: se hace desde el panel de super admin, con identidad propia.
      router.put('/api/usuarios/:id', [...guard('users', 'edit'), denyImpersonation()], (req) => controller.update(req))
      router.delete('/api/usuarios/:id', [...guard('users', 'delete'), denyImpersonation()], (req) => controller.destroy(req))

      log.info('Módulo usuarios listo')
      return service
    },
  })
}
