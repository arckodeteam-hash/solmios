// ari-outbox/tests/queue-config.test.ts — CA-3: el tope de reintentos que se configura desde el
// Super Admin es el que la fila se lleva al encolarse.
//
// El punto fino que fija este test no es el número: es CUÁNDO se decide. La fila guarda su
// `maxAttempts` en el momento del `schedule`, y `handleFailure` lee ESE — así, cambiar la config
// no reescribe la cola ya encolada ni resucita filas que se dieron por fallidas. Todo contra un
// puerto en memoria y con `now`/`newId` inyectados (mismo molde que tests/outbox-queue.test.ts:8-51).

import { describe, it, expect } from 'bun:test'
import { AriOutbox, DEFAULT_MAX_ATTEMPTS, type AriOutboxPort } from '../usecases/outbox-queue'
import { AriOutboxService, type AriOutboxStore } from '../service'
import type { AriOutboxRow } from '../types'

const HOTEL = 'h1'
const DEBOUNCE_MS = 1500

/** Igualdad del CAS: `undefined` y `null` son el mismo "sin valor" (fila vieja sin la columna). */
function matchea(row: AriOutboxRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = (row as unknown as Record<string, unknown>)[k]
    if (v === null || v === undefined) return actual === null || actual === undefined
    return actual === v
  })
}

/** Puerto en memoria: lo mínimo que usa la cola (create/update/updateWhere/findMany). */
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

function makeOutbox(maxAttempts?: number) {
  const clock = { ms: Date.parse('2026-09-08T10:00:00.000Z') }
  const { port, rows } = makePort(clock)
  const outbox = new AriOutbox({
    repo: port,
    now: () => clock.ms,
    debounceMs: DEBOUNCE_MS,
    newId: () => `row-${rows.length + 1}`,
    heartbeatMs: 0, // sin latido: el test no publica nada y un intervalo vivo cuelga a bun test
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  })
  return { clock, outbox, rows }
}

describe('CA-3 — el tope de reintentos configurado se respeta al encolar', () => {
  it('la cola construida con maxAttempts 5 escribe 5 en la fila', async () => {
    const { outbox, rows } = makeOutbox(5)
    await outbox.schedule(HOTEL, 'rates')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.maxAttempts).toBe(5)
  })

  it('sin configurar nada, el default sigue siendo 3 (la cola se comporta como antes)', async () => {
    const { outbox, rows } = makeOutbox()
    await outbox.schedule(HOTEL, 'rates')
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3)
    expect(rows[0]!.maxAttempts).toBe(3)
  })

  it('setMaxAttempts cambia el tope de las PRÓXIMAS filas y no toca las ya encoladas', async () => {
    const { clock, outbox, rows } = makeOutbox(3)
    await outbox.schedule('hotel-viejo', 'rates')
    expect(rows[0]!.maxAttempts).toBe(3)

    // El operador guarda 7 en el Super Admin: el service lo baja a la cola por acá.
    outbox.setMaxAttempts(7)
    clock.ms += DEBOUNCE_MS
    await outbox.schedule('hotel-nuevo', 'rates')

    expect(rows).toHaveLength(2)
    expect(rows[1]!.maxAttempts).toBe(7)
    // Lo importante: la fila anterior conserva el suyo. Subir el máximo no puede resucitar filas
    // que ya se dieron por fallidas — para eso está el reintento manual del monitor.
    expect(rows[0]!.maxAttempts).toBe(3)
  })

  it('un tope inválido (0, negativo o no numérico) se ignora y deja el vigente', async () => {
    const { clock, outbox, rows } = makeOutbox(4)
    outbox.setMaxAttempts(0)
    outbox.setMaxAttempts(-2)
    outbox.setMaxAttempts(Number.NaN)
    await outbox.schedule(HOTEL, 'rates')
    expect(rows[0]!.maxAttempts).toBe(4)

    // Y un decimal se trunca a entero: la columna cuenta intentos, no fracciones.
    outbox.setMaxAttempts(6.9)
    clock.ms += DEBOUNCE_MS
    await outbox.schedule('otro-hotel', 'rates')
    expect(rows[1]!.maxAttempts).toBe(6)
  })

  it('la fila falla definitivamente al llegar al tope que ella misma se llevó', async () => {
    const { clock, outbox, rows } = makeOutbox(1)
    outbox.registerPublisher('rates', { push: async () => { throw new Error('Channex 500') } })
    await outbox.schedule(HOTEL, 'rates')

    // Con tope 1 no hay backoff: el primer fallo ya es definitivo.
    clock.ms += DEBOUNCE_MS
    await outbox.drain()
    expect(rows[0]!.status).toBe('failed')
    expect(rows[0]!.attempts).toBe(1)
    expect(rows[0]!.lastError).toBe('Channex 500')
  })
})


// El eslabón que faltaba: que lo que el operador GUARDA llegue de verdad a la cola. El service es
// quien envuelve la `AriOutbox`, así que si no le delega el tope, `PUT /config` responde 200, la
// pantalla muestra el número nuevo y la cola sigue encolando con el viejo — un CA-3 de mentira.
describe('CA-3 — la config guardada llega a la cola, no solo a la tabla', () => {
  function makeService(guardadas: Array<Record<string, unknown>>) {
    const clock = { ms: Date.parse('2026-09-08T10:00:00.000Z') }
    const { port, rows } = makePort(clock)
    const store = {
      ...port,
      async paginate() { return { data: rows, total: rows.length } },
      async count(filters: Record<string, unknown>) { return (await port.findMany(filters)).length },
    } as unknown as AriOutboxStore
    const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger } } as any
    let actual = { maxAttempts: DEFAULT_MAX_ATTEMPTS, maxPerMinute: 18 }
    const config = {
      async leer() { return actual },
      async guardar(patch: Partial<typeof actual>) { actual = { ...actual, ...patch }; guardadas.push({ ...actual }); return actual },
    }
    return { service: new AriOutboxService(store, logger, config), rows }
  }

  it('setQueueConfig deja el tope nuevo en la próxima fila encolada', async () => {
    const guardadas: Array<Record<string, unknown>> = []
    const { service, rows } = makeService(guardadas)

    await service.setQueueConfig({ maxAttempts: 8 })
    await service.schedule(HOTEL, 'rates')

    expect(guardadas.at(-1)).toMatchObject({ maxAttempts: 8 })
    expect(rows[0]?.maxAttempts).toBe(8)
  })

  it('applyQueueConfig aplica al arrancar lo que ya estaba guardado', async () => {
    const guardadas: Array<Record<string, unknown>> = []
    const { service, rows } = makeService(guardadas)
    await service.setQueueConfig({ maxAttempts: 6 })

    // Un proceso nuevo: la cola arranca con el default y solo el apply la pone al día.
    const fresco = makeService(guardadas)
    await fresco.service.setQueueConfig({ maxAttempts: 6 })
    await fresco.service.applyQueueConfig()
    await fresco.service.schedule(HOTEL, 'inventory')

    expect(fresco.rows[0]?.maxAttempts).toBe(6)
    expect(rows).toHaveLength(0)
  })
})
