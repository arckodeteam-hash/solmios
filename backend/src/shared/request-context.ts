// shared/request-context.ts — el "quién y desde dónde" del request en curso (#141).
//
// El audit log tiene columnas `ip` y `userName` desde siempre, y en producción estaban vacías en
// el 99% y el 59% de las filas: nadie las llenaba. El motivo es estructural — quien escribe la
// entrada es un service, tres o cuatro llamadas por debajo del handler HTTP, y ahí ya no hay
// `req`. Pasar la IP a mano por cada `auditSafely` significaría tocar ~30 connectors y confiar en
// que nadie se olvide: la próxima entrada nueva volvería a salir sin IP.
//
// `AsyncLocalStorage` resuelve eso sin tocar ninguna firma: un middleware guarda la IP al entrar
// el request y cualquier código que corra dentro de esa cadena async puede leerla. Es el mismo
// mecanismo que usan los request-id de cualquier server Node.
//
// Solo va acá lo que es del REQUEST, no del negocio: IP y usuario. Nada más — esto no es un
// contenedor de estado global disfrazado.
import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  /** IP real del cliente, ya resuelta con `getClientIp` (Cloudflare → nginx → socket). */
  ip?: string
  /** `users.id` del token, si el request venía autenticado. */
  userId?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

/** Corre `fn` con el contexto atado. Lo llama el middleware, una vez por request. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

/**
 * Contexto del request en curso. Devuelve `{}` fuera de un request (un cron, un script, un test):
 * ahí no hay IP ni usuario, y esa ausencia es la verdad — la entrada queda como "Sistema".
 */
export function currentRequestContext(): RequestContext {
  return storage.getStore() ?? {}
}
