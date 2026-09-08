// ari-outbox/service.ts — Orquestador del módulo: envuelve la cola y expone la consulta (CA-9).
//
// Delgado A PROPÓSITO: toda la lógica de agrupación, backoff y publicación vive en
// `usecases/outbox-queue.ts`. Acá solo se arma la instancia, se delegan sus métodos (los que el
// conector de wiring necesita) y se resuelve el listado de operación. Mismo reparto que
// email-queue/service.ts: el service opera la tabla, el worker la drena.

import { NotFoundError } from 'arckode-framework'
import type { Logger, PageResult, FindOptions } from 'arckode-framework'
import { AriOutbox, type AriOutboxPort, type AriPublisher } from './usecases/outbox-queue'
import {
  contarPorEstado, reintentar, sanearConfig, QUEUE_CONFIG_DEFAULTS,
  type OutboxCountFilters, type OutboxCounts, type QueueConfig, type QueueConfigStore,
} from './usecases/outbox-admin'
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
  /** La fila YA escrita: el reintento manual la devuelve al cliente (el puerto de la cola no la pide). */
  update(id: string, patch: Partial<AriOutboxRow>): Promise<AriOutboxRow | null>
  /** COUNT por filtros para el monitor. Opcional: un store que no lo trae cuenta sobre findMany. */
  count?(filters: Record<string, unknown>): Promise<number>
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
    // Config persistida de la cola. OPCIONAL: sin ella el módulo corre con los valores del código.
    // Llega como puerto ya construido (index.ts) porque el service no puede recibir el `orm`.
    private readonly config?: QueueConfigStore,
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
  private async emit(event: keyof AriOutboxSockets, payload: any): Promise<void> {
    const hook = this.sockets[event]
    if (!hook) return
    try {
      await hook(payload)
    } catch (err: unknown) {
      this.logger.warn('AriOutbox: falló un hook de sockets', {
        event,
        id: payload?.id,
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

  /** Contadores por estado del monitor. Toda la aritmética (qué es "en reintento") vive en el usecase. */
  stats(filtros: OutboxCountFilters = {}): Promise<OutboxCounts> {
    const findMany = (f: Record<string, unknown>) => this.repo.findMany(f)
    const count = (f: Record<string, unknown>) => this.repo.count?.(f) ?? findMany(f).then((r) => r.length)
    return contarPorEstado({ count, findMany }, filtros)
  }

  /**
   * Reintento manual desde el Super Admin. El log queda a propósito: es una acción de un operador
   * sobre la cola, y sin él nadie puede explicar después por qué una fila `failed` volvió a salir.
   */
  async retry(id: string): Promise<AriOutboxRow> {
    const row = await reintentar(this.repo, id, new Date().toISOString())
    if (!row) throw new NotFoundError('Fila no encontrada en la outbox')
    this.logger.info('AriOutbox: reintento manual', { id })
    return row
  }

  /** La config vigente de la cola; sin puerto cableado, la del código. */
  getQueueConfig(): Promise<QueueConfig> {
    return this.config ? this.config.leer() : Promise.resolve({ ...QUEUE_CONFIG_DEFAULTS })
  }

  /**
   * Guarda un patch de config y la aplica EN EL ACTO: si solo se persistiera, el techo nuevo de
   * peticiones/minuto regiría recién en el próximo reinicio y la pantalla diría una cosa mientras
   * la cola hace otra.
   */
  async setQueueConfig(patch: Partial<QueueConfig>): Promise<QueueConfig> {
    const cfg = this.config ? await this.config.guardar(patch) : sanearConfig({ ...QUEUE_CONFIG_DEFAULTS, ...patch })
    await this.emit('onQueueConfigChanged', cfg)
    return cfg
  }

  /** Aplica la config guardada al arrancar (lo llama composition-root): mismo camino que un PUT. */
  async applyQueueConfig(): Promise<QueueConfig> {
    const cfg = await this.getQueueConfig()
    await this.emit('onQueueConfigChanged', cfg)
    return cfg
  }
}
