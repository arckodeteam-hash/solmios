// shared/middlewares/request-context.ts — ata la IP (y el usuario, si ya se autenticó) al request.
//
// Va ANTES que las rutas y DESPUÉS del logger: todo lo que corra dentro del handler —incluido el
// service que escribe el audit log tres capas más abajo— puede leerlo sin recibirlo por parámetro.
// Ver `shared/request-context.ts` para por qué no se pasa a mano.
import type { MiddlewareHandler } from 'arckode-framework'
import { runWithRequestContext } from '../request-context'
import { getClientIp } from './rate-limit'

export function requestContext(): MiddlewareHandler {
  return async (req, next) => {
    // `req.user` todavía no existe acá (lo pone `authenticate`, que corre por ruta), así que el
    // userId se lee tarde: el objeto del store es el MISMO que ve el handler, y el middleware de
    // auth lo completa vía `attachUser` más abajo si hace falta. La IP sí está desde el principio.
    const ctx = { ip: getClientIp(req), userId: (req.user as { id?: string } | undefined)?.id }
    return runWithRequestContext(ctx, () => next())
  }
}
