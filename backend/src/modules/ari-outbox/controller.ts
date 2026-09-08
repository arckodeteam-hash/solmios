// ari-outbox/controller.ts — Adapta el request al service y devuelve { status, body }.
// Sin lógica: los defaults y topes del listado son del service (mismo reparto que email-queue).
// Lo único propio es VALIDAR la entrada antes de bajarla (REGLA #11, como canales/controller.ts).

import { validateSchema } from 'arckode-framework'
import type { HttpRequest, Logger, ValidationRule } from 'arckode-framework'
import type { AriOutboxService, AriOutboxListQuery } from './service'
import type { AriOutboxStatus } from './types'
import { ListAriOutboxSchema } from './validators/schema'

/**
 * Del schema del listado, SOLO los filtros de texto. `page`/`limit` quedan afuera a propósito: el
 * service ya los normaliza (basura → default, tope duro de 200) y rechazar `?limit=todas` con un
 * 400 rompería una pantalla que hoy funciona. Lo que sí tiene que fallar es un `status` o un `kind`
 * fuera del conjunto válido: si pasan crudos, el filtro llega al repositorio y devuelve una lista
 * vacía en silencio, que se lee como "no hay nada en la outbox" en vez de "escribiste mal".
 */
const FiltrosSchema: Record<string, ValidationRule> = {
  hotelId: ListAriOutboxSchema.hotelId!,
  status: ListAriOutboxSchema.status!,
  kind: ListAriOutboxSchema.kind!,
}

export class AriOutboxController {
  constructor(
    private readonly service: AriOutboxService,
    private readonly logger: Logger,
  ) {}

  async index(req: HttpRequest) {
    const q = (req.query ?? {}) as Record<string, string>
    // validateSchema TIRA ValidationError, y el router la convierte en 400 con sus campos
    // (router.ts:105-106). Es la misma forma que usan apikeys/opiniones/canales: el controller no
    // atrapa para no tapar con un 400 un error que no sea de validación.
    const filtros = validateSchema(FiltrosSchema, q)

    const query: AriOutboxListQuery = {
      hotelId: filtros.hotelId as string | undefined,
      status: filtros.status as AriOutboxStatus | undefined,
      kind: filtros.kind as string | undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    }
    const result = await this.service.list(query)
    return { status: 200, body: result }
  }
}
