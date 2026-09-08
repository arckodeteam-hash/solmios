// ari-outbox/service.ts — Orquestador del módulo: envuelve la cola y expone la consulta (CA-9).
//
// Delgado A PROPÓSITO: toda la lógica de agrupación, backoff y publicación vive en
// `usecases/outbox-queue.ts`. Acá solo se arma la instancia, se delegan sus métodos (los que el
// conector de wiring necesita) y se resuelve el listado de operación. Mismo reparto que
// email-queue/service.ts: el service opera la tabla, el worker la drena.

import type { Logger, PageResult, FindOptions } from 'arckode-framework'
import { AriOutbox, type AriOutboxPort, type AriPublisher } from './usecases/outbox-queue'
import type { AriOutboxRow, AriOutboxStatus } from './types'
import type { AriOutboxSockets } from './sockets'

/** Página del listado admin. 50 entra en una pantalla sin scrollear al infinito. */
export const DEFAULT_LIST_LIMIT = 50
/** Tope duro: la outbox de un hotel activo son cientos de filas y el listado no pagina en el cliente. */
export const MAX_LIST_LIMIT = 200

/**
 * Puerto de persistencia del módulo = lo que usa la cola + la paginación del listado.
 * `OrmRepository<AriOutboxRow>` lo satisface tal cual; en los tests lo cubre un array en memoria.
 */
export interface AriOutboxStore extends AriOutboxPort {
  paginate(
    filters: Record<string, unknown>,
    options: FindOptions & { limit: number },
  ): Promise<Pick<PageResult<AriOutboxRow>, 'data' | 'total'>>
}

export interface AriOutboxListQuery {
  hotelId?: string
  status?: AriOutboxStatus | string
  kind?: string
  limit?: number
  page?: number
}

export interface AriOutboxList {
  items: AriOutboxRow[]
  total: number
  page: number
  limit: number
}

export class AriOutboxService {
  private readonly queue: AriOutbox
  /** Hooks opcionales hacia otros módulos. Vacío = el módulo funciona igual (email-queue:15). */
  private sockets: AriOutboxSockets = {}

  constructor(
    private readonly repo: AriOutboxStore,
    private readonly logger: Logger,
  ) {
    this.queue = new AriOutbox({
      repo,
      // Un canal caído no puede quedar solo en el `lastError` de la fila: el operador mira los
      // logs del proceso cuando el listado le muestra un `failed` y quiere el detalle.
      onError: (hotelId, channel, err) => {
        this.logger.warn('AriOutbox: falló un push', {
          hotelId,
          channel: channel ?? 'base',
          error: err instanceof Error ? err.message : String(err),
        })
      },
      // El cierre de una fila se avisa por sockets. Van envueltos acá y no en el usecase porque
      // este es el lado que tiene el logger: un hook de otro módulo que tira se loguea y el drain
      // sigue publicando el resto de la cola.
      onSent: (row) => this.emit('onAriOutboxSent', row),
      onFailed: (row) => this.emit('onAriOutboxFailed', row),
    })
  }

  /**
   * Registra hooks. Se ACUMULAN (varios conectores pueden engancharse al mismo evento), igual que
   * en email-queue/service.ts:25.
   */
  setSockets(s: Partial<AriOutboxSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  /** Dispara un hook si está cableado. Un hook que falla se loguea y NO corta el drenado. */
  private async emit(event: keyof AriOutboxSockets, row: AriOutboxRow): Promise<void> {
    const hook = this.sockets[event]
    if (!hook) return
    try {
      await hook(row)
    } catch (err: unknown) {
      this.logger.warn('AriOutbox: falló un hook de sockets', {
        event,
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** Quién publica cada `kind`. Lo cablea el conector (los pushes viven en canales, no acá). */
  registerPublisher(kind: string, publisher: AriPublisher): void {
    this.queue.registerPublisher(kind, publisher)
  }

  /** Persiste la ráfaga antes de que venza el debounce: el punto entero de la outbox. */
  schedule(hotelId: string, kind: string, channels: Array<string | undefined> = [undefined]): Promise<void> {
    return this.queue.schedule(hotelId, kind, channels)
  }

  /** Un tick del worker: publica lo vencido. Devuelve cuántas filas procesó. */
  drain(): Promise<number> {
    return this.queue.drain()
  }

  /** Filas que otro proceso tomó y nunca cerró (un deploy a mitad de push). */
  reclaimStale(): Promise<number> {
    return this.queue.reclaimStale()
  }

  /**
   * CA-9: la outbox con sus filas y estados, para la pantalla de operación de la plataforma.
   * Orden por `scheduledAt` DESC —lo último agendado primero— porque quien mira la cola está
   * mirando lo que acaba de pasar, no el historial. Sin filtro de ownership: la ruta es admin.
   */
  async list(query: AriOutboxListQuery = {}): Promise<AriOutboxList> {
    const filters: Record<string, unknown> = {}
    if (query.hotelId) filters.hotelId = query.hotelId
    if (query.status) filters.status = query.status
    if (query.kind) filters.kind = query.kind

    const page = Math.max(Number(query.page) || 1, 1)
    const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
    const offset = (page - 1) * limit

    const result = await this.repo.paginate(filters, {
      offset,
      limit,
      orderBy: { field: 'scheduledAt', dir: 'DESC' },
    })
    return { items: result.data, total: result.total, page, limit }
  }
}
