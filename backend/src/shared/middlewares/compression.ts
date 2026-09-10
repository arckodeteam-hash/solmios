// shared/middlewares/compression.ts — #96: la descarga de un backup (y cualquier ruta que devuelva
// bytes crudos: PDF de facturas, CSV de reportes, /uploads, sitemap) llegaba corrupta desde un
// navegador. El `compression()` del framework (arckode-framework/kernel/middlewares.ts) hace
// `JSON.stringify(res.body)` de TODO cuerpo cuando el cliente manda `Accept-Encoding: gzip` y el
// resultado supera el umbral — un Buffer sale como `{"type":"Buffer","data":[…]}` gzipeado. Con
// `curl` sin `--compressed` es idéntico al disco; con `--compressed` (o desde Chrome) se reproduce.
//
// El framework no tiene mecanismo de binario aparte del Buffer (`res.stream` es SSE: escribe
// `data: chunk\n\n`) ni expone un filtro en `compression()`, así que se envuelve acá — mismo
// patrón que `corsWithErrorHeaders` y `scopedRateLimit`: el middleware del framework queda intacto
// y sólo se lo saltea cuando el cuerpo YA es un Buffer (el server lo manda tal cual, server.ts:138).
// Los JSON siguen comprimiéndose igual que antes.
import type { MiddlewareHandler } from 'arckode-framework'
import { compression } from 'arckode-framework/middlewares'

export function jsonOnlyCompression(opts: Parameters<typeof compression>[0] = {}): MiddlewareHandler {
  const compress = compression(opts)
  return async (req, next) => {
    const res = await next()
    if (Buffer.isBuffer(res.body)) return res
    return compress(req, async () => res)
  }
}
