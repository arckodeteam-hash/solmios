import type { MiddlewareHandler } from 'arckode-framework'
import { ErrorContract } from 'arckode-framework'
import { cors } from 'arckode-framework/middlewares'

// Deuda "CORS sin headers en 401" del spec de reservas. El Router del framework convierte un
// ErrorContract lanzado por cualquier middleware/handler en `{ status, body }` SIN headers
// (kernel/http/router.ts, catch de runAll), y como el throw atraviesa el middleware de CORS
// sin pasar por su merge de headers (kernel/middlewares.ts:50-54), un 401/403/409/429 llega
// "pelado": el browser lo reporta como error de red/CORS en vez de como el status real, y el
// frontend no puede distinguir "sesión expirada" de "backend caído".
//
// Este wrapper mantiene el cors del framework y, si next() lanza un ErrorContract, construye
// la MISMA respuesta que construiría el catch del Router y la re-decora con el cors para que
// lleve los headers. Errores no-contrato (500 inesperados) se relanzan: el Router los loguea
// con stack antes de responder — no se enmascaran acá.
export function corsWithErrorHeaders(options: Parameters<typeof cors>[0] = {}): MiddlewareHandler {
  const decorated = cors(options)
  return async (req, next) => {
    try {
      return await decorated(req, next)
    } catch (error) {
      if (!(error instanceof ErrorContract)) throw error
      // Misma forma que el catch del Router, pero hecha ANTES para que el flujo normal del
      // cors agregue Access-Control-Allow-Origin/Allow-Credentials a la respuesta de error.
      return decorated(req, async () => ({ status: error.httpStatus, body: error.toJSON() }))
    }
  }
}
