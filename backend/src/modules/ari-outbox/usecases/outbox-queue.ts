// ari-outbox/usecases/outbox-queue.ts — La cola de pushes de ARI, en tabla en vez de en memoria.
//
// Es el port a `ari_outbox` de canales/usecases/push-coalescing.ts: mismo comportamiento visible
// (agrupar la ráfaga de un hotel con debounce y publicar UN push, secuencial, base primero y
// canales con override después), pero con la ráfaga ESCRITA antes de que venza el debounce. El
// coalescer la guardaba en un Map con un setTimeout de 1.5s: un deploy o un crash dentro de esa
// ventana se comía el push y el canal quedaba con el precio viejo sin rastro de nada pendiente.
//
// La parte de cola —attempts, backoff, fallo permanente, reclamo de filas colgadas— es el mismo
// molde de services/email-service.ts (processQueue/processOne/reclaimStale/handleFailure): una
// cola más en el repo, no un mecanismo nuevo.

import type { AriOutboxRow, AriOutboxStatus } from '../types'

/** Ventana de agrupación de la ráfaga: el mismo 1.5s que el coalescer en memoria. */
export const DEFAULT_DEBOUNCE_MS = 1500
/** Backoff tras cada fallo: 1min, 5min, 15min. Igual que la cola de emails. */
export const BACKOFF_MS = [60_000, 300_000, 900_000]
/** Filas en 'processing' más viejas que esto: el proceso que las tomó murió a mitad. */
export const STALE_MS = 5 * 60_000

/** Puerto de persistencia: lo implementa OrmRepository en el módulo, y un array en los tests. */
export interface AriOutboxPort {
  create(row: AriOutboxRow): Promise<AriOutboxRow>
  update(id: string, patch: Partial<AriOutboxRow>): Promise<unknown>
  findMany(query: Record<string, unknown>): Promise<AriOutboxRow[]>
}

export type AriPushFn = (hotelId: string, channel?: string) => Promise<unknown>

/** Quién sabe publicar un `kind`. `overrideChannels` son los canales con tarifa propia. */
export interface AriPublisher {
  push: AriPushFn
  overrideChannels?: (hotelId: string) => Promise<string[]>
}

export interface AriOutboxDeps {
  repo: AriOutboxPort
  now?: () => number
  debounceMs?: number
  newId?: () => string
  onError?: (hotelId: string, channel: string | undefined, err: unknown) => void
}

export class AriOutbox {
  private readonly publishers = new Map<string, AriPublisher>()
  /** Guard de reentrada: una sola pasada de drain por proceso a la vez (email-service:189). */
  private draining = false
  private readonly repo: AriOutboxPort
  private readonly now: () => number
  private readonly debounceMs: number
  private readonly newId: () => string
  private readonly onError: (hotelId: string, channel: string | undefined, err: unknown) => void

  constructor(deps: AriOutboxDeps) {
    this.repo = deps.repo
    this.now = deps.now ?? (() => Date.now())
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.newId = deps.newId ?? (() => crypto.randomUUID())
    this.onError = deps.onError ?? (() => {})
  }

  registerPublisher(kind: string, publisher: AriPublisher): void {
    this.publishers.set(kind, publisher)
  }

  /**
   * Agenda la ráfaga. Equivale al `clearTimeout` + `setTimeout` del coalescer, pero en la tabla:
   * si ya hay una fila pendiente del mismo (hotel, kind) se le fusionan los canales y se le corre
   * el vencimiento; si no, se crea. La fila queda escrita ANTES del vencimiento — el punto entero
   * de la outbox.
   */
  async schedule(hotelId: string, kind: string, channels: Array<string | undefined> = [undefined]): Promise<void> {
    const explicit = channels.filter((c): c is string => !!c)
    const scheduledAt = this.iso(this.now() + this.debounceMs)
    const [row] = await this.repo.findMany({ hotelId, kind, status: 'pending' })
    if (row) {
      // UNIÓN, el mismo Set del coalescer: una ráfaga mixta "global + canal X" termina publicando
      // SOLO X, porque el hotel editó la tarifa de X y la base la pisaría.
      const merged = [...new Set([...(row.channels ?? []), ...explicit])]
      await this.repo.update(row.id, { channels: merged, scheduledAt })
      return
    }
    await this.repo.create({
      id: this.newId(),
      hotelId,
      kind,
      channels: explicit,
      status: 'pending' as AriOutboxStatus,
      scheduledAt,
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
    })
  }

  /** Worker: reclama lo colgado y procesa las filas vencidas. Devuelve cuántas procesó. */
  async drain(): Promise<number> {
    if (this.draining) return 0
    this.draining = true
    try {
      await this.reclaimStale()
      const now = this.iso(this.now())
      const pending = await this.repo.findMany({ status: 'pending' })
      const due = pending
        .filter((r) => !r.scheduledAt || r.scheduledAt <= now)
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
      // DE A UNA, nunca Promise.all: todos los pushes escriben los mismos rate plans y el último
      // gana. Paralelizar reintroduce el bug de producción del 2026-09-05 (la suite pasó de los
      // $330 del canal a los $120 de la base ocho segundos después de mover una temporada).
      for (const row of due) await this.processOne(row)
      return due.length
    } finally {
      this.draining = false
    }
  }

  /** Filas que otro proceso tomó y nunca cerró: vuelven a pending, vencidas ya. */
  async reclaimStale(): Promise<number> {
    const cutoff = this.iso(this.now() - STALE_MS)
    const stuck = await this.repo.findMany({ status: 'processing' })
    let reclaimed = 0
    for (const row of stuck) {
      if (row.updatedAt && row.updatedAt >= cutoff) continue
      await this.repo.update(row.id, { status: 'pending', scheduledAt: this.iso(this.now()) })
      reclaimed++
    }
    return reclaimed
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  private async processOne(row: AriOutboxRow): Promise<void> {
    // Se reclama primero para que un segundo proceso no la tome mientras se publica.
    await this.repo.update(row.id, { status: 'processing' })
    const publisher = this.publishers.get(row.kind)
    // Un kind sin publicador es un fallo de la fila, no un throw: las demás filas se siguen drenando.
    if (!publisher) return this.handleFailure(row, new Error(`sin publisher registrado para kind '${row.kind}'`))

    // Ráfaga con canales → solo esos. Ráfaga vacía → cambio GLOBAL: la base y DESPUÉS los canales
    // con tarifa propia (si solo saliera la base, borraría los precios por canal).
    const targets: Array<string | undefined> = row.channels?.length
      ? [...row.channels]
      : [undefined, ...(await this.resolveOverrides(row.hotelId, publisher))]

    let firstError: unknown = null
    for (const channel of targets) {
      try {
        await publisher.push(row.hotelId, channel)
      } catch (err: unknown) {
        firstError ??= err // un canal caído no corta a los siguientes (como hoy), pero la fila reintenta
        this.onError(row.hotelId, channel, err)
      }
    }
    if (firstError) return this.handleFailure(row, firstError)
    await this.repo.update(row.id, { status: 'sent', lastError: null })
  }

  /** Sin resolver (o si falla) se publica solo la base: mejor eso que un precio elegido al azar. */
  private async resolveOverrides(hotelId: string, publisher: AriPublisher): Promise<string[]> {
    if (!publisher.overrideChannels) return []
    try {
      return await publisher.overrideChannels(hotelId)
    } catch (err: unknown) {
      this.onError(hotelId, undefined, err)
      return []
    }
  }

  /** Reintento con backoff o fallo permanente (email-service.ts:344 con otro nombre de campo). */
  private async handleFailure(row: AriOutboxRow, err: unknown): Promise<void> {
    const attempts = Number(row.attempts || 0) + 1
    const lastError = err instanceof Error ? err.message || String(err) : String(err)
    const maxAttempts = Number(row.maxAttempts || BACKOFF_MS.length)
    if (attempts >= maxAttempts) {
      await this.repo.update(row.id, { status: 'failed', attempts, lastError })
      return
    }
    const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
    await this.repo.update(row.id, {
      status: 'pending',
      attempts,
      lastError,
      scheduledAt: this.iso(this.now() + backoff),
    })
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString()
  }
}
