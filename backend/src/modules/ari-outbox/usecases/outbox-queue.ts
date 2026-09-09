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
/**
 * Intentos por fila cuando nadie configuró nada: uno por escalón de backoff. Es el valor que estaba
 * hardcodeado al encolar, y sigue siendo el default para que la cola se comporte igual que antes si
 * el operador nunca toca la config.
 */
export const DEFAULT_MAX_ATTEMPTS = BACKOFF_MS.length

/** Filas en 'processing' más viejas que esto: el proceso que las tomó murió a mitad. */
export const STALE_MS = 5 * 60_000
/**
 * Cada cuánto el proceso que está publicando renueva su lease (toca `updatedAt`) mientras dura el
 * push. Bien por debajo de STALE_MS —un quinto— para que un latido perdido, o dos, no alcancen a
 * que otro proceso declare colgada una fila que se está publicando de verdad: sin esto, entre el
 * update a 'processing' y el cierre NO hay ninguna escritura, y un push más largo que STALE_MS se
 * gana que lo reclamen por stale y lo republiquen en paralelo.
 */
export const HEARTBEAT_MS = 60_000

/**
 * Saneo mínimo del tope de intentos: entero >= 1. `sanearConfig` (usecases/outbox-admin.ts) ya
 * acota lo que entra por la API, pero `setMaxAttempts` es público y lo puede llamar cualquier
 * conector, así que la cola no confía: un 0 o un NaN dejaría filas que se dan por fallidas sin
 * haber intentado ni una vez.
 */
function saneMaxAttempts(n: unknown, fallback: number): number {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v >= 1 ? v : fallback
}

/**
 * La clave del turno pendiente de un (hotel, kind). Un solo lugar arma el string porque los dos
 * candados de `schedule` se apoyan en él: la cadena de promesas EN MEMORIA (serialización
 * intra-proceso) y la columna `pendingKey` con su índice único EN LA BASE (unicidad entre
 * procesos, ver model.ts). Si los dos dejaran de ser el mismo string, dos llamadas que la cadena
 * cree serializadas competirían igual en la tabla.
 */
const claveDePendiente = (hotelId: string, kind: string): string => `${hotelId}|${kind}`

/** Puerto de persistencia: lo implementa OrmRepository en el módulo, y un array en los tests. */
export interface AriOutboxPort {
  create(row: AriOutboxRow): Promise<AriOutboxRow>
  update(id: string, patch: Partial<AriOutboxRow>): Promise<unknown>
  findMany(query: Record<string, unknown>): Promise<AriOutboxRow[]>
  /**
   * COMPARE-AND-SWAP del módulo: aplica `patch` a las filas que matchean TODOS los pares de
   * `where` y devuelve cuántas cambió. Existe porque el puerto de repositorio del framework solo
   * sabe hacer update POR ID —un write que no puede exigir "y que siga en pending"—, así que con
   * él dos procesos que leyeron la misma fila la reclaman los dos. `orm.updateMany` sí genera el
   * UPDATE ... WHERE sobre cualquier campo; el store del módulo lo expone por acá (mismo recurso
   * que subscriptions/usecases/handle-stripe-event.ts › releaseCategorySlot).
   */
  updateWhere(where: Record<string, unknown>, patch: Partial<AriOutboxRow>): Promise<number>
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
  /** La fila se cerró bien. OPCIONAL: el drain no depende de esto (ver `notify`). */
  onSent?: (row: AriOutboxRow) => void | Promise<void>
  /** La fila agotó los intentos y quedó en `failed` DEFINITIVO (un reintento no avisa). */
  onFailed?: (row: AriOutboxRow) => void | Promise<void>
  /**
   * Identidad de ESTE proceso en la tabla (`claimedBy`). Por default un uuid por instancia: dos
   * procesos nunca comparten dueño, que es lo único que el CAS necesita.
   */
  owner?: string
  /** Renovación del lease durante el push. Default HEARTBEAT_MS; `0` lo apaga. */
  heartbeatMs?: number
  /**
   * Intentos que se le graban a cada fila al encolarla. Default DEFAULT_MAX_ATTEMPTS; el Super
   * Admin lo cambia en caliente por `setMaxAttempts`.
   */
  maxAttempts?: number
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
  private readonly onSent?: (row: AriOutboxRow) => void | Promise<void>
  private readonly onFailed?: (row: AriOutboxRow) => void | Promise<void>
  /** Quién es este proceso para la tabla. Se calcula UNA vez: es la identidad de la instancia. */
  private readonly owner: string
  private readonly heartbeatMs: number
  /** NO readonly: es config de operación y se cambia en caliente (ver setMaxAttempts). */
  private maxAttempts: number
  /**
   * Última operación encolada por clave `${hotelId}|${kind}`: serializa `schedule` (ver su doc).
   * Se limpia cuando la cadena termina y sigue siendo la última, así un hotel que agenda todo el
   * día no deja una entrada por (hotel, kind) viva para siempre.
   */
  private readonly scheduleChains = new Map<string, Promise<void>>()

  constructor(deps: AriOutboxDeps) {
    this.repo = deps.repo
    this.now = deps.now ?? (() => Date.now())
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.newId = deps.newId ?? (() => crypto.randomUUID())
    this.onError = deps.onError ?? (() => {})
    this.onSent = deps.onSent
    this.onFailed = deps.onFailed
    this.owner = deps.owner ?? crypto.randomUUID()
    this.heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS
    this.maxAttempts = saneMaxAttempts(deps.maxAttempts, DEFAULT_MAX_ATTEMPTS)
  }

  /**
   * Cambia el tope de intentos que llevarán las PRÓXIMAS filas. Es lo que el operador guarda en la
   * config de la cola desde el Super Admin, aplicado sin reiniciar el proceso.
   *
   * DELIBERADO: no reescribe las filas que ya están en la cola. Cada fila se lleva su tope al
   * momento de encolarse y `handleFailure` lee ESE (`row.maxAttempts`), así que subir el máximo no
   * resucita nada que ya se haya dado por `failed` —para eso está el reintento manual del monitor,
   * que es una acción explícita— ni bajarlo mata reintentos que una fila viva ya tenía prometidos.
   */
  setMaxAttempts(n: number): void {
    this.maxAttempts = saneMaxAttempts(n, this.maxAttempts)
  }

  registerPublisher(kind: string, publisher: AriPublisher): void {
    this.publishers.set(kind, publisher)
  }

  /**
   * Agenda la ráfaga. Equivale al `clearTimeout` + `setTimeout` del coalescer, pero en la tabla:
   * si ya hay una fila pendiente del mismo (hotel, kind) se le fusionan los canales y se le corre
   * el vencimiento; si no, se crea. La fila queda escrita ANTES del vencimiento — el punto entero
   * de la outbox.
   *
   * SERIALIZADO por `${hotelId}|${kind}` con una cadena de promesas: el trabajo real
   * (`scheduleOne`) es un check-then-act —buscar la fila pendiente, y recién después update o
   * create— con un `await` en el medio. Los conectores llaman sin awaitear (`void
   * outbox.schedule(...)` en pricing-canales.ts) y un solo guardado de la UI dispara
   * `onRatesUpdated` y `onRateRestrictionsUpdated` a milésimas de distancia (push-coalescing.ts:1-8):
   * sin la cadena, las dos llamadas leen "no hay fila pendiente" antes de que ninguna escriba,
   * se crean DOS filas y salen DOS pushes, que es justo lo que CA-3 prohíbe. El coalescer en
   * memoria no tenía este hueco porque era 100% síncrono; esta cadena es su equivalente acá.
   *
   * DOS CANDADOS, uno por cada carrera, y ninguno reemplaza al otro:
   *
   * - INTRA-proceso: esta cadena, que se queda. Es el caso REAL y frecuente —los dos `void
   *   schedule(...)` del mismo guardado, a milésimas— y lo resuelve sin ir a la base: las dos
   *   llamadas se ordenan, la segunda ve la fila que escribió la primera y le fusiona los canales.
   *   Camino barato, cero escrituras rechazadas, cero round-trips de más.
   * - ENTRE procesos: el índice único sobre `pendingKey` (columna declarada en model.ts). El Map
   *   vive en la memoria de ESTE proceso, así que dos réplicas —o un deploy solapado— pueden leer
   *   las dos "no hay fila pendiente" y crear las dos. Ahí la base rechaza el segundo INSERT y
   *   `scheduleOne` fusiona sus canales en la fila que ganó (#65), en vez de dejar DOS ráfagas
   *   pendientes del mismo (hotel, kind) y publicar dos pushes.
   *
   * POR QUÉ `pendingKey` ES ASÍ, para el que venga a "limpiarla": lo que hace falta es unicidad de
   * (hotelId, kind) SOLO entre las filas `pending`, o sea un índice único PARCIAL con
   * `WHERE status='pending'`, y el ORM no sabe expresar predicados en un índice. La columna lo
   * emula exacto: vale `${hotelId}|${kind}` MIENTRAS la fila está pending y NULL en cualquier otro
   * estado, y como en SQL los NULL de un índice único son DISTINTOS entre sí, el historial
   * `sent`/`failed` del mismo par —cientos de filas— convive sin chocar. Quien la mantiene es el
   * ciclo de vida de acá abajo: la escribe `scheduleOne`, la borra el reclamo de `processOne`, y
   * la restauran —best-effort, ver `volverAPending`— el reintento de `handleFailure` y
   * `reclaimStale`. Sacarla, o dejarla poblada en una fila que ya no está pending, reabre el bug.
   */
  schedule(hotelId: string, kind: string, channels: Array<string | undefined> = [undefined]): Promise<void> {
    const key = claveDePendiente(hotelId, kind)
    const previa = this.scheduleChains.get(key) ?? Promise.resolve()
    const corrida = previa.then(() => this.scheduleOne(hotelId, kind, channels))
    // La cadena GUARDADA nunca rechaza: un schedule que falla no puede envenenar a los siguientes
    // ni dejar una unhandled rejection (los conectores no awaitean). El error igual le llega a
    // quien sí awaitea, por `corrida`.
    const cadena = corrida.catch(() => {})
    this.scheduleChains.set(key, cadena)
    void cadena.then(() => {
      if (this.scheduleChains.get(key) === cadena) this.scheduleChains.delete(key)
    })
    return corrida
  }

  private async scheduleOne(hotelId: string, kind: string, channels: Array<string | undefined>): Promise<void> {
    const explicit = channels.filter((c): c is string => !!c)
    const scheduledAt = this.iso(this.now() + this.debounceMs)
    const [row] = await this.repo.findMany({ hotelId, kind, status: 'pending' })
    if (row) return await this.fusionar(row, explicit, scheduledAt)

    try {
      await this.crearPendiente(hotelId, kind, explicit, scheduledAt)
    } catch (err: unknown) {
      // PERDIMOS LA CARRERA ENTRE PROCESOS: otro proceso insertó la fila pendiente de este mismo
      // (hotel, kind) entre nuestro findMany y nuestro create, y el índice único de `pendingKey`
      // rechazó el nuestro. La ráfaga NO se pierde: se fusiona en la fila que ganó, exactamente el
      // mismo merge que el camino de arriba.
      //
      // A PROPÓSITO no se mira el mensaje del error: cada motor escribe la violación de unicidad
      // distinto ('UNIQUE constraint failed' en SQLite, 'duplicate key value' en Postgres,
      // 'Duplicate entry' en MySQL) y un match por texto se rompe callado con el próximo motor o
      // la próxima versión. La prueba de que era la carrera no es el mensaje: es que al releer HAY
      // una fila pendiente del par. Si no la hay, este camino no la tapa —el create se rehace y su
      // error, sea el que sea, se propaga.
      const [ganadora] = await this.repo.findMany({ hotelId, kind, status: 'pending' })
      if (ganadora) return await this.fusionar(ganadora, explicit, scheduledAt)
      // Sin fila pendiente al releer: la ganadora ya pasó a 'processing' (el reclamo libera la
      // clave), así que el turno está vacante otra vez. UN reintento, no un bucle: si el segundo
      // create también falla, el error sube. Reintentar en loop contra una base que rechaza por
      // otro motivo colgaría el schedule para siempre, que es peor que el bug que arregla.
      await this.crearPendiente(hotelId, kind, explicit, scheduledAt)
    }
  }

  /**
   * Fusión de la ráfaga nueva sobre la fila pendiente que ya existe. UNIÓN, el mismo Set del
   * coalescer: una ráfaga mixta "global + canal X" termina publicando SOLO X, porque el hotel
   * editó la tarifa de X y la base la pisaría. No toca `pendingKey`: la fila ya tiene su turno.
   */
  private async fusionar(row: AriOutboxRow, explicit: string[], scheduledAt: string): Promise<void> {
    const merged = [...new Set([...(row.channels ?? []), ...explicit])]
    await this.repo.update(row.id, { channels: merged, scheduledAt })
  }

  /** El INSERT de la fila pendiente, con la clave del turno puesta. Tira si el turno está tomado. */
  private async crearPendiente(hotelId: string, kind: string, explicit: string[], scheduledAt: string): Promise<void> {
    await this.repo.create({
      id: this.newId(),
      hotelId,
      kind,
      channels: explicit,
      status: 'pending' as AriOutboxStatus,
      scheduledAt,
      attempts: 0,
      // El tope viaja EN LA FILA: cambiar la config después no toca a las ya encoladas.
      maxAttempts: this.maxAttempts,
      lastError: null,
      // El candado: mientras esta fila esté pending, nadie más puede crear otra del mismo par.
      pendingKey: claveDePendiente(hotelId, kind),
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

  /**
   * Filas que otro proceso tomó y nunca cerró: vuelven a pending, vencidas ya. La prueba de vida
   * sigue siendo `updatedAt` contra el cutoff, pero ahora el dueño la renueva mientras publica
   * (ver el latido de processOne), así que un push largo ya no cuenta como colgado.
   *
   * El reclamo va con CAS guardado por el dueño LEÍDO: si dos procesos corren reclaimStale a la
   * vez, solo uno cambia la fila y solo ese suma; el otro ve 0 y la deja en paz.
   */
  async reclaimStale(): Promise<number> {
    const cutoff = this.iso(this.now() - STALE_MS)
    const stuck = await this.repo.findMany({ status: 'processing' })
    let reclaimed = 0
    for (const row of stuck) {
      if (row.updatedAt && row.updatedAt >= cutoff) continue
      // `?? null` y no `row.claimedBy` a secas: una fila anterior a este campo lo trae undefined, y
      // un filtro por undefined no es un filtro por "sin dueño".
      // Vuelve a pending, así que le toca recuperar la clave del turno: por `volverAPending`, que
      // aguanta que el turno ya esté tomado por una ráfaga nueva.
      const won = await this.volverAPending(
        { id: row.id, status: 'processing', claimedBy: row.claimedBy ?? null },
        { status: 'pending', scheduledAt: this.iso(this.now()), claimedBy: null },
        row,
      )
      if (won > 0) reclaimed++
    }
    return reclaimed
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  private async processOne(row: AriOutboxRow): Promise<void> {
    // EL CORAZÓN DEL FIX. El reclamo es un compare-and-swap, no un write por id: la fila pasa a
    // 'processing' SOLO si sigue en 'pending'. Los dos procesos que leyeron la misma fila vencida
    // llegan hasta acá, pero uno cambia 1 fila y el otro 0 — y el que ve 0 se va sin publicar, que
    // es exactamente el push duplicado que antes salía dos veces.
    // `pendingKey: null` en el mismo patch: al dejar de estar pending la fila LIBERA su turno, y
    // una ráfaga nueva del mismo (hotel, kind) puede crear su propia fila mientras esta se
    // publica. No es un cambio de comportamiento —`scheduleOne` siempre buscó con
    // `status: 'pending'`, así que una fila en 'processing' nunca frenó una ráfaga nueva—: es lo
    // que mantiene la columna fiel a su invariante (poblada si y sólo si la fila está pending),
    // sin la cual el índice único bloquearía el próximo push del hotel hasta que este termine.
    const won = await this.repo.updateWhere(
      { id: row.id, status: 'pending' },
      { status: 'processing', claimedBy: this.owner, pendingKey: null },
    )
    if (won === 0) return

    // El lease se renueva mientras dura el push: `updatedAt` es la única prueba de vida que mira
    // reclaimStale, y entre el reclamo y el cierre no hay ninguna otra escritura.
    const heartbeat = this.startHeartbeat(row)
    try {
      const publisher = this.publishers.get(row.kind)
      // Un kind sin publicador es un fallo de la fila, no un throw: las demás filas se siguen drenando.
      if (!publisher) return await this.handleFailure(row, new Error(`sin publisher registrado para kind '${row.kind}'`))

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
      if (firstError) return await this.handleFailure(row, firstError)
      // Mismo CAS, ahora guardado por dueño: si devuelve 0 la fila YA NO ES NUESTRA —se la llevó un
      // reclamo por stale y otro proceso la está publicando— y este es el zombi. No la pisa ni
      // avisa un `onSent` de un trabajo que ahora es de otro.
      const cerrada = await this.repo.updateWhere(
        { id: row.id, status: 'processing', claimedBy: this.owner },
        { status: 'sent', lastError: null, claimedBy: null },
      )
      if (cerrada === 0) return
      await this.notify(this.onSent, { ...row, status: 'sent', lastError: null })
    } finally {
      // OBLIGATORIO y cubriendo TODO lo de arriba (handleFailure incluido): un intervalo vivo
      // retiene el loop de eventos y deja colgado al proceso —y a `bun test`.
      if (heartbeat) clearInterval(heartbeat)
    }
  }

  /** Renueva el lease cada `heartbeatMs`. `null` si está apagado (heartbeatMs 0). */
  private startHeartbeat(row: AriOutboxRow): ReturnType<typeof setInterval> | null {
    if (this.heartbeatMs <= 0) return null
    const timer = setInterval(() => {
      void (async () => {
        try {
          // Patch vacío a propósito: updateMany igual pisa `updatedAt`, que es lo único que
          // reclaimStale lee. Guardado por dueño para no revivir una fila que ya perdimos.
          await this.repo.updateWhere({ id: row.id, status: 'processing', claimedBy: this.owner }, {})
        } catch (err: unknown) {
          // Un latido perdido no puede tumbar el drain: lo peor que pasa es que la fila se declare
          // colgada y otro proceso la reclame, que es el comportamiento seguro de siempre.
          this.onError(row.hotelId, undefined, err)
        }
      })()
    }, this.heartbeatMs)
    // El latido no puede ser el motivo de que el proceso no termine.
    ;(timer as { unref?: () => void }).unref?.()
    return timer
  }

  /**
   * Avisa el cierre de una fila. Los hooks son OPCIONALES y de otro módulo: si uno tira, se
   * reporta por onError y el drain SIGUE. La fila ya está cerrada en la tabla; un hook roto no
   * puede dejar el resto de la cola sin publicar.
   */
  private async notify(hook: ((row: AriOutboxRow) => void | Promise<void>) | undefined, row: AriOutboxRow): Promise<void> {
    if (!hook) return
    try {
      await hook(row)
    } catch (err: unknown) {
      this.onError(row.hotelId, undefined, err)
    }
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
    const maxAttempts = Number(row.maxAttempts || DEFAULT_MAX_ATTEMPTS)
    // Las dos salidas van con el mismo CAS guardado por dueño que el cierre bueno: si la fila ya
    // no es nuestra, el fallo es de un push que otro proceso está rehaciendo — ni se pisa ni avisa.
    const mia = { id: row.id, status: 'processing' as AriOutboxStatus, claimedBy: this.owner }
    if (attempts >= maxAttempts) {
      const cerrada = await this.repo.updateWhere(mia, { status: 'failed', attempts, lastError, claimedBy: null })
      if (cerrada === 0) return
      // Definitivo: no hay más reintentos. El reintento con backoff NO avisa (la fila sigue viva).
      await this.notify(this.onFailed, { ...row, status: 'failed', attempts, lastError })
      return
    }
    // Reintento: la fila VUELVE a pending, así que vuelve a competir por el turno del par y le
    // toca recuperar `pendingKey`. Best-effort (ver `volverAPending`): el turno puede haberlo
    // tomado una ráfaga nueva mientras esta estaba en 'processing'.
    // La OTRA rama —'failed' definitivo— y el cierre en 'sent' no tocan la columna a propósito:
    // salen de 'processing', donde el reclamo ya la dejó en NULL, y escribirla de nuevo sería una
    // escritura de más sin ningún invariante que sostener.
    const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
    await this.volverAPending(
      mia,
      {
        status: 'pending',
        attempts,
        lastError,
        scheduledAt: this.iso(this.now() + backoff),
        claimedBy: null,
      },
      row,
    )
  }

  /**
   * Devuelve una fila a 'pending' restaurando su `pendingKey`, y si el turno ya está tomado la
   * devuelve igual SIN la clave. Lo usan las dos vueltas atrás de la cola: el reintento con
   * backoff de `handleFailure` y el reclamo de `reclaimStale`.
   *
   * BEST-EFFORT a propósito. Mientras la fila estaba en 'processing' su turno quedó libre, así que
   * una ráfaga nueva del mismo (hotel, kind) pudo crear otra fila pending: restaurar la clave ahí
   * viola el índice único. Ante eso, la fila vuelve a pending con `pendingKey` NULL — que es
   * EXACTAMENTE el comportamiento anterior a #65 (dos filas pending del mismo par conviviendo, el
   * drain publica las dos), o sea ninguna regresión, y muchísimo mejor que la alternativa: tirar
   * desde acá aborta el `for` de `drain`/`reclaimStale` y deja sin procesar todas las filas que
   * venían detrás. Por eso este método NUNCA propaga: devuelve 0 y sigue.
   *
   * El primer rechazo no se reporta por `onError`: es contención esperada, no una falla. El
   * segundo sí, porque ya no se explica por el índice (la base está caída, la fila no existe) y un
   * silencio ahí escondería una fila que se quedó en 'processing' para siempre.
   */
  private async volverAPending(
    where: Record<string, unknown>,
    patch: Partial<AriOutboxRow>,
    row: AriOutboxRow,
  ): Promise<number> {
    try {
      return await this.repo.updateWhere(where, { ...patch, pendingKey: claveDePendiente(row.hotelId, row.kind) })
    } catch {
      try {
        return await this.repo.updateWhere(where, patch)
      } catch (err: unknown) {
        this.onError(row.hotelId, undefined, err)
        return 0
      }
    }
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString()
  }
}
