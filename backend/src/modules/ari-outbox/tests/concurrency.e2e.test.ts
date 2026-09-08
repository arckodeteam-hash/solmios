// ari-outbox/tests/concurrency.e2e.test.ts — La prueba de fuego del #58, contra SQLite REAL.
//
// outbox-queue.test.ts ya cubre la carrera con el puerto en memoria, pero ahí el compare-and-swap
// lo implementa un array del propio test: prueba la lógica de la cola, no que el UPDATE
// condicional exista de verdad contra la base. Este archivo cierra ese hueco — dos instancias de
// `AriOutbox` (dos "procesos", con dueños distintos) drenando LA MISMA fila sobre LA MISMA SQLite,
// con el store real del módulo. Si `updateWhere` no fuera atómico, el push a Channex saldría dos
// veces: exactamente el bug de producción que el issue viene a tapar.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAriOutboxModels } from '../model'
import { AriOutbox, STALE_MS } from '../usecases/outbox-queue'
import type { AriOutboxPort } from '../usecases/outbox-queue'
import { createAriOutboxStore } from '../usecases/outbox-store'
import type { AriOutboxRow } from '../types'

const PASADO = '2020-01-01T00:00:00.000Z'

let orm: any
let dbPath: string

async function filaDe(id: string): Promise<AriOutboxRow> {
  const repo = new OrmRepository<AriOutboxRow>(orm, 'AriOutbox')
  const row = await repo.findById(id)
  expect(row).toBeTruthy()
  return row as AriOutboxRow
}

/** Una fila cruda, tal como la dejaría `schedule()` (o un proceso muerto, con `extra`). */
async function sembrar(id: string, extra: Partial<AriOutboxRow> = {}): Promise<void> {
  const repo = new OrmRepository<AriOutboxRow>(orm, 'AriOutbox')
  await repo.create({
    id,
    hotelId: `hotel-${id}`,
    kind: 'rates',
    channels: [],
    status: 'pending',
    scheduledAt: PASADO,
    attempts: 0,
    maxAttempts: 3,
    ...extra,
  } as any)
}

beforeAll(async () => {
  dbPath = `/tmp/solmios-ari-outbox-concurrency-${crypto.randomUUID()}.db`
  const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  registerAriOutboxModels(orm)
  await orm.migrate()
}, 60_000) // migrate() sobre SQLite tarda varios segundos en este sandbox (ver season-pricing.e2e)

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('dos procesos drenando la misma outbox sobre una SQLite real', () => {
  it('la fila vencida se publica UNA sola vez aunque los dos drains corran a la vez', async () => {
    const id = 'concurrency-1'
    await sembrar(id)

    // Contador COMPARTIDO: cada instancia tiene su publisher, pero los dos suman acá — es "cuántas
    // veces se llamó a Channex por esta fila", que es lo único que le importa al hotel.
    const pushes: Array<{ owner: string; hotelId: string; channel: string | undefined }> = []
    const instancia = (owner: string) => {
      // Store REAL (no el puerto en memoria) sobre el MISMO ORM: dos procesos contra una base.
      const outbox = new AriOutbox({ repo: createAriOutboxStore(orm), owner, heartbeatMs: 0 })
      outbox.registerPublisher('rates', {
        push: async (hotelId, channel) => {
          pushes.push({ owner, hotelId, channel })
          // Cede el control DENTRO del push: sin esto cada drain correría de punta a punta sin
          // soltar el loop y la carrera no llegaría a ocurrir nunca.
          await new Promise((r) => setTimeout(r, 5))
        },
      })
      return outbox
    }
    const a = instancia('proc-a')
    const b = instancia('proc-b')

    await Promise.all([a.drain(), b.drain()])

    expect(pushes).toHaveLength(1) // ⬅ el criterio del issue: un push, no dos
    const fila = await filaDe(id)
    expect(fila.status).toBe('sent')
    expect(fila.claimedBy ?? null).toBeNull() // cerrada y liberada: nadie la retiene
    expect(fila.lastError ?? null).toBeNull()
  })

  it('dos updateWhere en paralelo sobre la misma fila: uno cambia 1 y el otro 0', async () => {
    // El CAS pelado contra la base, del que cuelga todo lo demás. Si los dos devolvieran 1, el
    // reclamo de fila no reclamaría nada y el test de arriba pasaría solo por suerte de timing.
    const id = 'concurrency-2'
    await sembrar(id)
    const store = createAriOutboxStore(orm)

    const [uno, otro] = await Promise.all([
      store.updateWhere({ id, status: 'pending' }, { status: 'processing', claimedBy: 'proc-a' }),
      store.updateWhere({ id, status: 'pending' }, { status: 'processing', claimedBy: 'proc-b' }),
    ])

    expect([uno, otro].sort()).toEqual([0, 1])
    const fila = await filaDe(id)
    expect(fila.status).toBe('processing')
    expect(['proc-a', 'proc-b']).toContain(fila.claimedBy ?? '') // el ganador, y uno solo

    // Se cierra la fila a mano: `reclaimStale` del caso siguiente mira TODA la tabla, y una fila
    // dejada en `processing` acá contaría como colgada allá y ensuciaría su cuenta.
    await store.updateWhere({ id, status: 'processing' }, { status: 'sent', claimedBy: null })
  })

  it('una fila colgada SIN dueño (anterior al campo) la reclama un solo proceso', async () => {
    // `claimedBy` es null en las filas que quedaron de antes de este cambio, y en SQL
    // `claimedBy = NULL` no matchea nunca (buildWhere no genera `IS NULL`): si el store no lo
    // resolviera, esas filas se quedarían colgadas para siempre — o peor, las reclamarían los dos.
    const id = 'concurrency-3'
    await sembrar(id, { status: 'processing' })
    expect((await filaDe(id)).claimedBy ?? null).toBeNull()

    // El reloj de los dos procesos va adelantado: para ellos el `updatedAt` que el ORM escribió al
    // crear la fila ya pasó el corte de STALE_MS.
    const futuro = () => Date.now() + STALE_MS + 60_000
    const nueva = (owner: string) =>
      new AriOutbox({ repo: createAriOutboxStore(orm), owner, heartbeatMs: 0, now: futuro })

    const [a, b] = await Promise.all([nueva('proc-a').reclaimStale(), nueva('proc-b').reclaimStale()])

    expect([a, b].sort()).toEqual([0, 1]) // reclamada una vez, por uno solo
    const fila = await filaDe(id)
    expect(fila.status).toBe('pending')
    expect(fila.claimedBy ?? null).toBeNull()
  })
})

/**
 * Barrera de N participantes: la promesa que devuelve `llegar()` no se resuelve hasta que llegaron
 * los N. Sirve para FIJAR el entrelazado de la carrera en vez de confiar en el timing del runtime:
 * sin ella, las dos llamadas pueden serializarse por casualidad (la primera termina su INSERT
 * antes de que la segunda haga su SELECT), el test pasaría igual con el bug puesto y no probaría
 * nada. Con la barrera en el `create`, los dos procesos hacen su lectura ANTES de que cualquiera
 * escriba, que es exactamente la ventana del issue.
 */
function crearBarrera(participantes: number): { llegar: () => Promise<void> } {
  let llegaron = 0
  let abrir!: () => void
  const abierta = new Promise<void>((r) => { abrir = r })
  return {
    llegar: () => {
      // Una vez abierta se queda abierta: el reintento del perdedor no puede quedarse esperando.
      if (++llegaron >= participantes) abrir()
      return abierta
    },
  }
}

/** El store real del módulo, con el `create` demorado hasta que los dos procesos hayan leído. */
function storeConBarrera(barrera: { llegar: () => Promise<void> }): AriOutboxPort {
  const base = createAriOutboxStore(orm)
  return {
    ...base,
    create: async (row) => {
      await barrera.llegar()
      return await base.create(row)
    },
  }
}

describe('dos procesos agendando el mismo (hotel, kind) sobre una SQLite real', () => {
  it('dos procesos distintos que agendan el mismo (hotel,kind) a la vez dejan UNA sola fila', async () => {
    // DOS INSTANCIAS DISTINTAS, y ese es el punto ENTERO del test: cada `AriOutbox` tiene su
    // propio `scheduleChains` (el Map en memoria que serializa los schedule del MISMO proceso) y
    // su propio `owner`, así que entre ellas no hay ningún candado de proceso — igual que dos
    // réplicas del backend o un deploy solapado. Reescribir esto con una sola instancia lo
    // convierte en lo que `outbox-queue.test.ts` ya prueba (la carrera intra-proceso, que la
    // cadena de promesas resuelve) y deja el bug del #65 sin cubrir: lo único que puede impedir
    // acá las DOS filas pendientes es el índice único de `pendingKey` en la base.
    const hotelId = 'hotel-carrera-create'
    const barrera = crearBarrera(2)
    const proceso = (owner: string) =>
      new AriOutbox({ repo: storeConBarrera(barrera), owner, heartbeatMs: 0 })

    // A LA VEZ: se largan las dos promesas y recién después se esperan. Canales DISTINTOS en cada
    // ráfaga para poder comprobar la mitad que de verdad importa — que el que pierde la carrera no
    // pierde su ráfaga, sino que la fusiona en la fila que ganó.
    const uno = proceso('proc-a').schedule(hotelId, 'rates', ['booking'])
    const otro = proceso('proc-b').schedule(hotelId, 'rates', ['expedia'])
    await Promise.all([uno, otro])

    const repo = new OrmRepository<AriOutboxRow>(orm, 'AriOutbox')
    const pendientes = await repo.findMany({ hotelId, kind: 'rates', status: 'pending' })
    expect(pendientes).toHaveLength(1) // ⬅ el criterio del issue: una fila, no dos
    const [fila] = pendientes
    expect([...(fila.channels ?? [])].sort()).toEqual(['booking', 'expedia']) // ninguna ráfaga se perdió
    expect(fila.pendingKey).toBe(`${hotelId}|rates`) // el turno queda tomado por ESA fila
  })
})
