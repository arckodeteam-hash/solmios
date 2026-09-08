// ari-outbox/tests/outbox-queue.test.ts — Qué hace la cola con una ráfaga de cambios de ARI.
//
// Los seis casos son el contrato que el coalescer en memoria ya cumplía (canales/tests/
// push-coalescing.test.ts) más lo que la tabla agrega: la ráfaga QUEDA ESCRITA antes de que venza
// el debounce, así un reinicio no se la come. Todo corre contra un puerto en memoria (un array y
// closures, sin DB) y con `now`/`newId` inyectados: nada depende del reloj real, así que el
// backoff de 15 minutos se prueba en milisegundos y sin flakes.

import { describe, it, expect } from 'bun:test'
import { AriOutbox, BACKOFF_MS, STALE_MS, type AriOutboxPort } from '../usecases/outbox-queue'
import type { AriOutboxRow } from '../types'

const HOTEL = 'h1'

/**
 * Igualdad del CAS: matchea si TODOS los pares de `where` coinciden, tratando `undefined` y `null`
 * como el mismo "sin valor" (una fila vieja trae `claimedBy` ausente donde la tabla guarda NULL).
 */
function matchea(row: AriOutboxRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = (row as unknown as Record<string, unknown>)[k]
    if (v === null || v === undefined) return actual === null || actual === undefined
    return actual === v
  })
}

/** Puerto en memoria: el mínimo que usa la cola (create/update/updateWhere/findMany). */
function makePort(clock: { ms: number }) {
  const rows: AriOutboxRow[] = []
  const port: AriOutboxPort = {
    async create(row) {
      const stored = { ...row, createdAt: new Date(clock.ms).toISOString(), updatedAt: new Date(clock.ms).toISOString() }
      rows.push(stored)
      return stored
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch, { updatedAt: new Date(clock.ms).toISOString() })
      return row ?? null
    },
    // El CAS: actualiza SOLO lo que matchea y devuelve el conteo, igual que orm.updateMany
    // (que además pisa `updatedAt` aunque el patch venga vacío — de eso vive el latido).
    async updateWhere(where, patch) {
      const match = rows.filter((r) => matchea(r, where))
      for (const row of match) Object.assign(row, patch, { updatedAt: new Date(clock.ms).toISOString() })
      return match.length
    },
    async findMany(query) {
      return rows.filter((r) => Object.entries(query).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
    },
  }
  return { port, rows }
}

interface Escenario {
  overrides?: string[]
  failOverrides?: boolean
  /** `'*'` falla siempre; un canal concreto falla solo ese target. */
  failPush?: string
  pushDelayMs?: number
}

function makeOutbox(esc: Escenario = {}) {
  const clock = { ms: Date.parse('2026-09-07T10:00:00.000Z') }
  const { port, rows } = makePort(clock)
  const pushed: Array<string | undefined> = []
  const errores: Array<string | undefined> = []
  const traza: string[] = [] // start:<n> / end:<n> para ver si dos pushes se solapan
  let n = 0
  const outbox = new AriOutbox({
    repo: port,
    now: () => clock.ms,
    debounceMs: 1500,
    newId: () => `row-${rows.length + 1}`,
    onError: (_hotelId, channel) => { errores.push(channel) },
  })
  outbox.registerPublisher('inventory', {
    push: async (_hotelId, channel) => {
      const i = ++n
      traza.push(`start:${i}`)
      if (esc.pushDelayMs) await new Promise((r) => setTimeout(r, esc.pushDelayMs))
      traza.push(`end:${i}`)
      if (esc.failPush === '*' || (esc.failPush !== undefined && esc.failPush === channel)) throw new Error('channex caído')
      pushed.push(channel)
    },
    overrideChannels: esc.overrides || esc.failOverrides
      ? async () => { if (esc.failOverrides) throw new Error('no se pudo listar'); return esc.overrides ?? [] }
      : undefined,
  })
  /** Corre el reloj: es el equivalente determinista a esperar el debounce. */
  const avanzar = (ms: number) => { clock.ms += ms }
  return { outbox, rows, pushed, errores, traza, avanzar, clock }
}

describe('CA-1 — la ráfaga se persiste ANTES de que venza el debounce', () => {
  it('schedule() deja la fila pending en la tabla sin haber drenado nada', async () => {
    const { outbox, rows } = makeOutbox()
    await outbox.schedule(HOTEL, 'inventory')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ hotelId: HOTEL, kind: 'inventory', status: 'pending', attempts: 0, channels: [] })
  })

  it('un drain antes del vencimiento no publica nada y la fila sigue pending', async () => {
    const { outbox, rows, pushed } = makeOutbox()
    await outbox.schedule(HOTEL, 'inventory')
    expect(await outbox.drain()).toBe(0)
    expect(pushed).toEqual([])
    expect(rows[0]!.status).toBe('pending')
  })
})

describe('CA-3 — agrupación: la ráfaga entera sale como UN push', () => {
  it('12 schedule() del mismo hotel dejan una sola fila y un solo push', async () => {
    const { outbox, rows, pushed, avanzar } = makeOutbox()
    for (let i = 0; i < 12; i++) {
      await outbox.schedule(HOTEL, 'inventory')
      avanzar(50) // la ráfaga real llega en milésimas: cada alta corre el vencimiento
    }
    expect(rows).toHaveLength(1)
    avanzar(1500)
    expect(await outbox.drain()).toBe(1)
    expect(pushed).toEqual([undefined])
    expect(rows[0]!.status).toBe('sent')
  })

  it('otro kind del mismo hotel es su propia fila: son dos pushes distintos contra Channex', async () => {
    const { outbox, rows } = makeOutbox()
    await outbox.schedule(HOTEL, 'inventory')
    await outbox.schedule(HOTEL, 'rates')
    expect(rows).toHaveLength(2)
  })
})

describe('CA-3 — ráfaga CONCURRENTE: schedule() sin await no duplica la fila', () => {
  // Así llaman los conectores: `void outbox.schedule(...)` (pricing-canales.ts), y un solo
  // guardado de la UI dispara onRatesUpdated y onRateRestrictionsUpdated a milésimas de distancia
  // (push-coalescing.ts:1-8). Sin serializar por (hotel, kind), las dos llamadas leen "no hay fila
  // pendiente" antes de que ninguna escriba y se crean DOS filas → DOS pushes, que es justo lo que
  // CA-3 prohíbe. El coalescer en memoria no tenía el hueco porque era 100% síncrono.
  it('dos schedule() del mismo hotel/kind sin awaitear el primero dejan UNA fila y UN push', async () => {
    const { outbox, rows, pushed, avanzar } = makeOutbox()
    const a = outbox.schedule(HOTEL, 'inventory')
    const b = outbox.schedule(HOTEL, 'inventory')
    await Promise.all([a, b])

    expect(rows).toHaveLength(1)
    avanzar(1500)
    expect(await outbox.drain()).toBe(1)
    expect(pushed).toEqual([undefined])
  })

  it('la unión de canales sobrevive a la concurrencia: global + canal publica SOLO el canal', async () => {
    const { outbox, rows, pushed, avanzar } = makeOutbox({ overrides: ['booking'] })
    const a = outbox.schedule(HOTEL, 'inventory')
    const b = outbox.schedule(HOTEL, 'inventory', ['OpenChannel'])
    await Promise.all([a, b])

    expect(rows).toHaveLength(1)
    expect(rows[0]!.channels).toEqual(['OpenChannel'])
    avanzar(1500)
    await outbox.drain()
    expect(pushed).toEqual(['OpenChannel'])
  })

  it('la cadena de serialización no se acumula en memoria: la entrada se limpia al terminar', async () => {
    const { outbox } = makeOutbox()
    await Promise.all([outbox.schedule(HOTEL, 'inventory'), outbox.schedule('h2', 'rates')])
    // Un macrotask: alcanza para que corran los microtasks de limpieza de las dos cadenas.
    await new Promise((r) => setTimeout(r, 0))

    // Blanco a propósito: es la única forma de ver que un hotel que agenda todo el día no deja
    // una entrada viva por (hotel, kind) para siempre.
    expect((outbox as unknown as { scheduleChains: Map<string, unknown> }).scheduleChains.size).toBe(0)
  })
})

describe('CA-4 — cambio global: base primero, canales con tarifa propia después', () => {
  it('ráfaga sin canal publica [undefined, "OpenChannel"] en ese orden', async () => {
    const { outbox, pushed, avanzar } = makeOutbox({ overrides: ['OpenChannel'] })
    await outbox.schedule(HOTEL, 'inventory')
    avanzar(1500)
    await outbox.drain()
    expect(pushed).toEqual([undefined, 'OpenChannel'])
  })

  it('si resolver los overrides falla se publica solo la base y se avisa por onError', async () => {
    const { outbox, pushed, errores, rows, avanzar } = makeOutbox({ failOverrides: true })
    await outbox.schedule(HOTEL, 'inventory')
    avanzar(1500)
    await outbox.drain()
    expect(pushed).toEqual([undefined])
    expect(errores).toEqual([undefined])
    expect(rows[0]!.status).toBe('sent') // el push base nunca se bloquea por los overrides
  })
})

describe('CA-4 — cambio por canal: la base NO se publica', () => {
  it('ráfaga con ["OpenChannel"] publica exactamente ese canal', async () => {
    const { outbox, pushed, avanzar } = makeOutbox({ overrides: ['booking'] })
    await outbox.schedule(HOTEL, 'inventory', ['OpenChannel'])
    avanzar(1500)
    await outbox.drain()
    expect(pushed).toEqual(['OpenChannel'])
  })

  it('ráfaga mixta (global + canal) publica SOLO el canal: la base pisaría su tarifa', async () => {
    const { outbox, rows, pushed, avanzar } = makeOutbox({ overrides: ['booking'] })
    await outbox.schedule(HOTEL, 'inventory')
    await outbox.schedule(HOTEL, 'inventory', ['OpenChannel'])
    expect(rows).toHaveLength(1)
    avanzar(1500)
    await outbox.drain()
    expect(pushed).toEqual(['OpenChannel'])
  })
})

describe('CA-5 — los pushes NO se solapan', () => {
  it('con varias filas vencidas la traza alterna start/end (secuencial, nunca en paralelo)', async () => {
    const { outbox, traza, avanzar } = makeOutbox({ pushDelayMs: 5 })
    await outbox.schedule('hotel-a', 'inventory')
    await outbox.schedule('hotel-b', 'inventory')
    await outbox.schedule('hotel-c', 'inventory')
    avanzar(1500)
    expect(await outbox.drain()).toBe(3)
    expect(traza).toEqual(['start:1', 'end:1', 'start:2', 'end:2', 'start:3', 'end:3'])
  })
})

describe('CA-6 — reintentos con backoff y fallo permanente', () => {
  it('reintenta con el backoff y termina en failed con un lastError legible', async () => {
    const { outbox, rows, avanzar, clock } = makeOutbox({ failPush: '*' })
    await outbox.schedule(HOTEL, 'inventory')
    avanzar(1500)

    await outbox.drain()
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'channex caído' })
    expect(rows[0]!.scheduledAt).toBe(new Date(clock.ms + BACKOFF_MS[0]!).toISOString())

    avanzar(BACKOFF_MS[0]!)
    await outbox.drain()
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 2 })
    expect(rows[0]!.scheduledAt).toBe(new Date(clock.ms + BACKOFF_MS[1]!).toISOString())

    avanzar(BACKOFF_MS[1]!)
    await outbox.drain()
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 3, lastError: 'channex caído' })

    avanzar(BACKOFF_MS[2]!)
    expect(await outbox.drain()).toBe(0) // failed es definitivo: no se reintenta más
  })

  it('un kind sin publicador registrado falla esa fila sin romper el drain de las demás', async () => {
    const { outbox, rows, pushed, avanzar } = makeOutbox()
    await outbox.schedule(HOTEL, 'rates') // no hay publisher de 'rates' en este escenario
    await outbox.schedule(HOTEL, 'inventory')
    avanzar(1500)
    expect(await outbox.drain()).toBe(2)
    const rates = rows.find((r) => r.kind === 'rates')!
    expect(rates).toMatchObject({ status: 'pending', attempts: 1 })
    expect(rates.lastError).toContain("kind 'rates'")
    expect(rows.find((r) => r.kind === 'inventory')!.status).toBe('sent')
    expect(pushed).toEqual([undefined])
  })
})

describe('#58 — la fila es de UN proceso a la vez: reclamo con compare-and-swap', () => {
  const T0 = Date.parse('2026-09-07T10:00:00.000Z')

  /** Puerto compartido con UNA fila pending ya vencida: el punto de partida de la carrera. */
  async function puertoConFilaVencida() {
    const clock = { ms: T0 }
    const { port, rows } = makePort(clock)
    await port.create({
      id: 'r1',
      hotelId: HOTEL,
      kind: 'inventory',
      channels: [],
      status: 'pending',
      scheduledAt: new Date(T0 - 1000).toISOString(),
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
    })
    return { clock, port, rows }
  }

  it('dos drains concurrentes sobre la MISMA fila publican una sola vez', async () => {
    const { clock, port, rows } = await puertoConFilaVencida()
    let pushCalls = 0
    const proceso = (owner: string) => {
      const o = new AriOutbox({ repo: port, now: () => clock.ms, owner, heartbeatMs: 0 })
      o.registerPublisher('inventory', {
        // El push CEDE el control: sin un await real el drain sería atómico y la carrera no existiría.
        push: async () => { pushCalls++; await new Promise((r) => setTimeout(r, 5)) },
      })
      return o
    }
    const a = proceso('proceso-a')
    const b = proceso('proceso-b')

    await Promise.all([a.drain(), b.drain()])

    expect(pushCalls).toBe(1)
    expect(rows[0]!.status).toBe('sent')
    expect(rows[0]!.claimedBy).toBeNull() // cerrada = libre
  })

  /**
   * Un push que tarda más que STALE_MS con un segundo proceso mirando. Los dos relojes son el
   * MISMO `clock.ms` a propósito: el `updatedAt` que escribe el puerto tiene que salir de donde
   * lee reclaimStale, o el test no prueba nada.
   */
  async function escenarioPushLargo(heartbeatMs: number) {
    const { clock, port, rows } = await puertoConFilaVencida()
    const trabajador = new AriOutbox({ repo: port, now: () => clock.ms, owner: 'el-que-publica', heartbeatMs })
    trabajador.registerPublisher('inventory', { push: async () => { await new Promise((r) => setTimeout(r, 40)) } })
    const vigilante = new AriOutbox({ repo: port, now: () => clock.ms, owner: 'el-que-vigila', heartbeatMs: 0 })

    const enVuelo = trabajador.drain()
    await new Promise((r) => setTimeout(r, 10)) // ya reclamó la fila y está en el push
    clock.ms += STALE_MS + 60_000 // el push "tardó" de sobra más que la ventana de colgado
    await new Promise((r) => setTimeout(r, 15)) // margen para varios latidos con el reloj corrido
    const reclamadas = await vigilante.reclaimStale()
    await enVuelo
    return { reclamadas, rows }
  }

  it('el latido evita que un push más largo que STALE_MS sea declarado colgado', async () => {
    const { reclamadas, rows } = await escenarioPushLargo(5)

    expect(reclamadas).toBe(0)
    expect(rows[0]!.status).toBe('sent')
  })

  it('sin latido el MISMO push largo se lo lleva el otro proceso, y el zombi no cierra la fila', async () => {
    const { reclamadas, rows } = await escenarioPushLargo(0)

    expect(reclamadas).toBe(1)
    // El que estaba publicando ya no es dueño: su cierre no aplica y la fila queda lista para que
    // la republique quien la reclamó (en vez de quedar 'sent' sin que nadie la haya terminado).
    expect(rows[0]!.status).toBe('pending')
  })

  it('una fila que perdió el reclamo entre la lectura y el push no se publica', async () => {
    const { clock, port, rows } = await puertoConFilaVencida()
    let pushCalls = 0
    // Espía: otro proceso se lleva la fila JUSTO después de que este la leyó, así la lista de
    // vencidas que el drain tiene en la mano ya está vieja cuando llega a publicar.
    const espia: AriOutboxPort = {
      ...port,
      async findMany(query) {
        const res = await port.findMany(query)
        if (query.status === 'pending' && res[0]) {
          await port.updateWhere({ id: res[0].id, status: 'pending' }, { status: 'processing', claimedBy: 'otro-proceso' })
        }
        return res
      },
    }
    const outbox = new AriOutbox({ repo: espia, now: () => clock.ms, owner: 'el-perdedor', heartbeatMs: 0 })
    outbox.registerPublisher('inventory', { push: async () => { pushCalls++ } })

    await outbox.drain()

    expect(pushCalls).toBe(0)
    expect(rows[0]).toMatchObject({ status: 'processing', claimedBy: 'otro-proceso' })
  })
})
