import type { MiddlewareHandler } from 'arckode-framework'

/**
 * Toma el token de un parámetro de la query y lo deja donde `auth.authenticate()` lo espera
 * (`Authorization: Bearer …`). Solo si NO vino header: el header siempre gana.
 *
 * Para clientes que no pueden mandar headers — `EventSource` (SSE, #211). Va SIEMPRE con un token
 * de vida corta (ticket de 60 s), nunca con el JWT de sesión: la query queda en el access.log.
 *
 * @example
 * router.get('/api/x/events', [bearerFromQuery('ticket'), ...guard('x', 'view')], handler)
 */
export function bearerFromQuery(param = 'ticket'): MiddlewareHandler {
  return async (req, next) => {
    const fromQuery = req.query?.[param]
    if (!req.headers['authorization'] && fromQuery) {
      req.headers['authorization'] = `Bearer ${fromQuery}`
    }
    return next()
  }
}
