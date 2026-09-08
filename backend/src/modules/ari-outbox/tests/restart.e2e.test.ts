// ari-outbox/tests/restart.e2e.test.ts — CA-2: un reinicio dentro de la ventana de debounce YA NO
// se come el push.
//
// Es el criterio que justifica el issue entero, y solo se puede probar sobre una DB REAL: con el
// puerto en memoria de outbox-queue.test.ts, "reiniciar" no significa nada porque el array vive en
// el mismo proceso que la cola. Acá la ráfaga se agenda con UNA instancia, esa instancia se
// DESCARTA sin drenar (como un deploy que mata el proceso a los 300ms del cambio de tarifa) y una
// instancia NUEVA —con su propio repositorio y su propio publisher— levanta la fila de la misma
// SQLite y publica. Eso es exactamente lo que el coalescer en memoria no podía hacer: su Map con
// el setTimeout de 1.5s moría con el proceso y el canal quedaba con el precio viejo.
//
// El reloj es inyectado (`now`) para no esperar de verdad el debounce ni los 5 minutos de STALE_MS.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAriOutboxModels } from '../model'
import { AriOutbox, STALE_MS, type AriOutboxPort } from '../usecases/outbox-queue'
import type { AriOutboxRow } from '../types'

const DEBOUNCE_MS = 1500

let orm: any
let dbPath: string
/** El reloj del "proceso": arranca en el ahora real porque el ORM escribe `updatedAt` con
 *  `new Date()` y el reclamo de filas colgadas compara contra ese campo. */
const clock = { ms: Date.now() }
const avanzar = (ms: number) => { clock.ms += ms }

/** Cada instancia de AriOutbox se arma como en producción: su propio repo sobre el mismo ORM. */
function nuevaInstancia() {
  const repo = new OrmRepository<AriOutboxRow>(orm, 'AriOutbox') as unknown as AriOutboxPort
  const pushed: Array<{ hotelId: string; channel: string | undefined }> = []
  const outbox = new AriOutbox({ repo, now: () => clock.ms, debounceMs: DEBOUNCE_MS })
  return { repo, outbox, pushed }
}

async function filaDe(hotelId: string): Promise<AriOutboxRow> {
  const repo = new OrmRepository<AriOutboxRow>(orm, 'AriOutbox')
  const [row] = await repo.findMany({ hotelId } as any)
  expect(row).toBeTruthy()
  return row as AriOutboxRow
}

beforeAll(async () => {
  dbPath = `/tmp/solmios-ari-outbox-restart-${crypto.randomUUID()}.db`
  const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  registerAriOutboxModels(orm)
  await orm.migrate()
}, 60_000) // migrate() sobre SQLite tarda varios segundos en este sandbox (ver season-pricing.e2e)

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('CA-2 — la ráfaga sobrevive al reinicio del proceso', () => {
  it('el push sale después de un reinicio ocurrido dentro de la ventana de debounce', async () => {
    const hotelId = 'restart-hotel-1'

    // ── Proceso A: el hotel toca una tarifa y el cambio se agenda ────────────────────────────
    const a = nuevaInstancia()
    a.outbox.registerPublisher('rates', { push: async (h, c) => { a.pushed.push({ hotelId: h, channel: c }) } })
    await a.outbox.schedule(hotelId, 'rates')

    // CA-1 sobre DB real: la fila ESTÁ ESCRITA antes de cualquier drain. El coalescer en memoria
    // acá no tenía nada persistido, solo un timer.
    const agendada = await filaDe(hotelId)
    expect(agendada).toMatchObject({ hotelId, kind: 'rates', status: 'pending', attempts: 0 })
    expect(agendada.channels ?? []).toEqual([]) // ráfaga global
    expect(Date.parse(agendada.scheduledAt)).toBe(clock.ms + DEBOUNCE_MS)

    // ── REINICIO: `a` se descarta a los 300ms, sin que su drain llegue a correr nunca ────────
    avanzar(300)

    // ── Proceso B: instancia nueva, repo nuevo, publisher nuevo, misma SQLite ────────────────
    const b = nuevaInstancia()
    b.outbox.registerPublisher('rates', { push: async (h, c) => { b.pushed.push({ hotelId: h, channel: c }) } })

    avanzar(DEBOUNCE_MS) // vence el debounce que había quedado agendado por el proceso muerto
    expect(await b.outbox.drain()).toBe(1)

    // El push salió en el proceso NUEVO (el viejo nunca publicó nada) y la fila quedó cerrada.
    expect(a.pushed).toEqual([])
    expect(b.pushed).toEqual([{ hotelId, channel: undefined }])
    const drenada = await filaDe(hotelId)
    expect(drenada.status).toBe('sent')
    expect(drenada.lastError ?? null).toBeNull()

    // Y no se republica: un segundo tick del worker no vuelve a mandar el mismo cambio.
    avanzar(1000)
    expect(await b.outbox.drain()).toBe(0)
    expect(b.pushed).toHaveLength(1)
  })

  it('una fila que quedó en processing porque el proceso murió a mitad del push se reclama y se publica', async () => {
    // El otro modo de perder un push en un deploy: el proceso alcanzó a marcar la fila
    // `processing` (para que nadie más la tome) y murió antes de llamar a Channex. Sin reclamo,
    // esa fila queda invisible para siempre: no es pending, así que ningún drain la mira.
    const hotelId = 'restart-hotel-2'
    const repo = new OrmRepository<AriOutboxRow>(orm, 'AriOutbox')
    await repo.create({
      id: `colgada-${crypto.randomUUID()}`,
      hotelId,
      kind: 'rates',
      channels: ['OpenChannel'],
      status: 'processing',
      scheduledAt: new Date(clock.ms).toISOString(),
      attempts: 0,
      maxAttempts: 3,
    } as any)

    // El proceso nuevo arranca bastante después: para él ese `updatedAt` ya es viejo (el ORM lo
    // escribe con la hora real al crear, por eso el reloj del test parte del ahora real).
    avanzar(STALE_MS + 60_000)

    const b = nuevaInstancia()
    b.outbox.registerPublisher('rates', { push: async (h, c) => { b.pushed.push({ hotelId: h, channel: c }) } })

    // Un solo drain alcanza: reclamar es lo primero que hace, así que la fila entra en la misma pasada.
    expect(await b.outbox.drain()).toBe(1)
    expect(b.pushed).toEqual([{ hotelId, channel: 'OpenChannel' }]) // la ráfaga guardada, no una nueva
    expect((await filaDe(hotelId)).status).toBe('sent')
  })
})
