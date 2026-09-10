// monitoring/usecases/error-logs.ts — Registro persistido de errores 5xx/429 (REQ-MON-02).
//
// Tres decisiones que vienen del design:
//   · Fire-and-forget (decisión 5): `record()` no devuelve promesa y NUNCA lanza. El middleware lo
//     llama en el camino de la respuesta y un fallo de la base —el escenario donde más importa no
//     empeorar las cosas— se traga con un log.
//   · Agrupación por (path, message): 500 repeticiones del mismo error son UNA fila con `count` y
//     `lastSeenAt`, no 500 filas. Las escrituras se SERIALIZAN en una cadena de promesas: doce
//     errores simultáneos harían doce `findOne` que no ven nada y doce `create`; en cadena, el
//     segundo ya encuentra la fila del primero.
//   · Retención por antigüedad (`ERROR_LOG_RETENTION_DAYS`, default 30): el ORM sólo filtra por
//     igualdad, así que las viejas se eligen en memoria y se borran de a una.

import type { FindOptions, Logger } from 'arckode-framework'
import type { ErrorEvent } from '../../../shared/observability/http-metrics'
import type { ErrorLogRow } from '../types'

export const DEFAULT_ERROR_LOG_RETENTION_DAYS = 30
export const DEFAULT_ERROR_LIST_LIMIT = 50
export const MAX_ERROR_LIST_LIMIT = 200
const MESSAGE_MAX = 500
const STACK_MAX = 2000
const MS_PER_DAY = 86_400_000

/** Lo mínimo de RepositoryAdapter<ErrorLogRow> que usa el registro; en tests lo cubre un array. */
export interface ErrorLogsRepo {
  findOne(filters: Record<string, unknown>): Promise<ErrorLogRow | null>
  findMany(filters?: Record<string, unknown>, options?: FindOptions): Promise<ErrorLogRow[]>
  create(data: Omit<ErrorLogRow, 'id'>): Promise<ErrorLogRow>
  update(id: string, patch: Partial<Omit<ErrorLogRow, 'id'>>): Promise<ErrorLogRow | null>
  delete(id: string): Promise<boolean>
}

export interface ErrorLogsOptions {
  retentionDays?: number
  now?: () => Date
}

export interface ErrorLogsEnv {
  ERROR_LOG_RETENTION_DAYS?: string
}

export function resolveRetentionDays(env: ErrorLogsEnv = process.env as ErrorLogsEnv): number {
  const n = Number(env.ERROR_LOG_RETENTION_DAYS)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_ERROR_LOG_RETENTION_DAYS
}

/** Basura → default; tope duro para que la pantalla no pida la tabla entera. */
export function normalizeLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_ERROR_LIST_LIMIT
  return Math.min(Math.trunc(n), MAX_ERROR_LIST_LIMIT)
}

export class ErrorLogs {
  readonly retentionDays: number
  private readonly now: () => Date
  /** Cola serial de escrituras: cada `record` se encadena detrás del anterior. */
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly repo: ErrorLogsRepo,
    private readonly logger: Logger,
    opts: ErrorLogsOptions = {},
  ) {
    this.retentionDays = opts.retentionDays ?? resolveRetentionDays()
    this.now = opts.now ?? (() => new Date())
  }

  /** Fire-and-forget: encola la escritura y vuelve. Nunca lanza, nunca rechaza. */
  record(event: ErrorEvent): void {
    this.chain = this.chain
      .then(() => this.persist(event))
      .catch((err: unknown) => {
        this.logger.warn('ErrorLogs: no se pudo persistir el error', {
          path: event.path,
          error: err instanceof Error ? err.message : String(err),
        })
      })
  }

  /** Espera a que se vacíe la cola de escrituras (tests y apagado ordenado). */
  flush(): Promise<void> {
    return this.chain
  }

  private async persist(event: ErrorEvent): Promise<void> {
    const seenAt = this.now().toISOString()
    const message = (event.message || `HTTP ${event.statusCode}`).slice(0, MESSAGE_MAX)
    const existing = await this.repo.findOne({ path: event.path, message })
    if (existing) {
      const patch: Partial<Omit<ErrorLogRow, 'id'>> = {
        count: (existing.count ?? 1) + 1,
        lastSeenAt: seenAt,
        statusCode: event.statusCode,
      }
      // El stack sólo se completa si la fila no tenía uno: el primero es tan útil como el último.
      if (!existing.stack && event.stack) patch.stack = event.stack.slice(0, STACK_MAX)
      await this.repo.update(existing.id, patch)
      return
    }
    await this.repo.create({
      hotelId: event.hotelId ?? null,
      method: event.method,
      path: event.path,
      statusCode: event.statusCode,
      message,
      stack: event.stack ? event.stack.slice(0, STACK_MAX) : null,
      count: 1,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })
  }

  /** Más reciente primero: quien mira la lista quiere lo que acaba de pasar. */
  list(limit?: unknown): Promise<ErrorLogRow[]> {
    return this.repo.findMany({}, { limit: normalizeLimit(limit), orderBy: { field: 'lastSeenAt', dir: 'DESC' } })
  }

  remove(id: string): Promise<boolean> {
    return this.repo.delete(id)
  }

  /** Borra lo visto por última vez hace más de `retentionDays`. Devuelve cuántas filas se fueron. */
  async purge(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - this.retentionDays * MS_PER_DAY).toISOString()
    const rows = await this.repo.findMany({}, { orderBy: { field: 'lastSeenAt', dir: 'ASC' } })
    const viejas = rows.filter((r) => r.lastSeenAt < cutoff)
    const results = await Promise.all(viejas.map((r) => this.repo.delete(r.id)))
    return results.filter(Boolean).length
  }
}
