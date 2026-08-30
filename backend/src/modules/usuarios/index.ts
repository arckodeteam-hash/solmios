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

export { UsuariosService }
export type { UsuarioDTO } from './types'

/** Una foto de perfil es una sola imagen: 5 MB de base64 sobra de largo. */
const AVATAR_UPLOAD_LIMIT = 5 * 1024 * 1024

export function UsuariosModule(opts: { storage?: StorageService } = {}) {
  return createModule({
    name: 'usuarios',
    version: '1.0.0',
    description: 'Autenticación y gestión de usuarios del hotel',
    contract: {
      name: 'usuarios', version: '1.0.0',
      description: 'Login JWT + CRUD de empleados del hotel',
      actions: ['login', 'me', 'updateMe', 'uploadAvatar', 'logout', 'list', 'create', 'update', 'delete', 'changePassword', 'getHotels', 'switchHotel', 'verifyOwnerCredentials'],
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
      router.post('/api/auth/logout', [auth.authenticate()], (req) => controller.logout(req))
      // Cambia la contraseña del `req.user.id` del token y exige la actual:
      // `users:edit` es el permiso para editar a OTROS, no a uno mismo.
      router.post('/api/auth/change-password', [auth.authenticate()], (req) => controller.changePassword(req))

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

      router.get('/api/auth/hotels', guard('users', 'view'), (req) => controller.hotels(req))
      router.post('/api/auth/switch-hotel/:id', guard('users', 'edit'), (req) => controller.switchHotel(req))

      router.get('/api/usuarios', guard('users', 'view'), (req) => controller.index(req))
      // Creación de usuarios: además del permiso `users:create`, rate limit por IP
      // contra spam/abuso de alta de cuentas. `store()` puede "fallar" sin lanzar
      // (403 por rol no asignable), así que el reset solo dispara con status < 400.
      router.post('/api/usuarios', guard('users', 'create'), async (req) => {
        const key = `create-user:${getClientIp(req)}`
        const { allowed, retryAfter } = await rateLimit(key)
        if (!allowed) {
          return { status: 429, body: { error: `Demasiados intentos. Intentá en ${retryAfter} segundos` } }
        }
        const result = await controller.store(req)
        if (result.status < 400) await resetAttempts(key)
        return result
      })
      router.put('/api/usuarios/:id', guard('users', 'edit'), (req) => controller.update(req))
      router.delete('/api/usuarios/:id', guard('users', 'delete'), (req) => controller.destroy(req))

      log.info('Módulo usuarios listo')
      return service
    },
  })
}
