// ari-outbox/tests/model.e2e.test.ts — E2E del schema de `ari_outbox` contra una SQLite REAL.
//
// No prueba lógica: prueba que el ModelDefinition esté COMPLETO. El ORM de arckode descarta al
// persistir cualquier campo que el modelo no declare, y lo hace en silencio —sin warning, sin
// error—, así que un campo olvidado no se nota hasta que en producción la fila vuelve sin él
// (es el anti-patrón que documenta CLAUDE.md y que ya costó el `channexGroupId` de canales).
//
// Por eso el test inserta una fila con TODOS los campos en valores NO-default (si se cayera uno,
// el default lo taparía y el test pasaría igual) y la relee campo por campo desde la DB.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAriOutboxModels } from '../model'
import type { AriOutboxRow } from '../types'

const HOTEL_ID = 'e2e-outbox-hotel-1'

let orm: any
let dbPath: string
let repo: OrmRepository<any>

beforeAll(async () => {
  dbPath = `/tmp/solmios-ari-outbox-e2e-${crypto.randomUUID()}.db`
  const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  // SOLO el modelo de la outbox: la tabla no depende de ninguna otra (el hotelId es una columna
  // de tenancy, no una FK), así que si esto no migra solo, el modelo está mal.
  registerAriOutboxModels(orm)
  await orm.migrate()
  repo = new OrmRepository<any>(orm, 'AriOutbox')
}, 60_000) // migrate() sobre SQLite tarda varios segundos en CI/sandbox

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('ari_outbox — el modelo declara todos los campos que usa la cola', () => {
  it('persiste y relee una fila COMPLETA sin que el ORM descarte ningún campo', async () => {
    const row: AriOutboxRow = {
      id: 'e2e-outbox-1',
      hotelId: HOTEL_ID,
      kind: 'rates',
      // Ráfaga con canales explícitos: el caso que obliga a que `channels` sea json y plural.
      channels: ['OpenChannel', 'Booking'],
      status: 'failed',
      scheduledAt: '2026-09-07T12:34:56.000Z',
      attempts: 2,
      maxAttempts: 5,
      lastError: 'Channex respondio 422: rate_plan_id desconocido',
      // Dueño de la fila: es la mitad del compare-and-swap del drain, así que la columna tiene que
      // existir DE VERDAD en la tabla migrada. Sin esto el ORM lo descartaría en silencio y el
      // reclamo guardado por dueño no guardaría nada.
      claimedBy: 'worker-e2e-1',
      // Candado de la fila pendiente: la columna tiene que EXISTIR en la tabla migrada, si no el
      // ORM la descartaría en silencio y scheduleOne creería estar reservando el turno mientras
      // guarda un NULL — o sea, la doble fila pendiente que este campo existe para impedir. Acá
      // sólo se verifica el ida y vuelta de la columna (que la coherencia con el status la maneja
      // el ciclo de vida de la cola); el caso de abajo prueba la unicidad contra la base.
      pendingKey: `${HOTEL_ID}|rates`,
    }
    await repo.create(row as any)

    const saved = await repo.findById('e2e-outbox-1') as AriOutboxRow | null
    expect(saved).toBeTruthy()
    expect(saved!.id).toBe('e2e-outbox-1')
    expect(saved!.hotelId).toBe(HOTEL_ID)
    expect(saved!.kind).toBe('rates')
    expect(saved!.channels).toEqual(['OpenChannel', 'Booking']) // json ida y vuelta, no "[object Object]"
    expect(saved!.status).toBe('failed')
    expect(saved!.scheduledAt).toBe('2026-09-07T12:34:56.000Z')
    expect(saved!.attempts).toBe(2)      // no el default 0
    expect(saved!.maxAttempts).toBe(5)   // no el default 3
    expect(saved!.lastError).toBe('Channex respondio 422: rate_plan_id desconocido')
    expect(saved!.claimedBy).toBe('worker-e2e-1')
    expect(saved!.pendingKey).toBe(`${HOTEL_ID}|rates`)
    // timestamps: true → el listado admin ordena por acá.
    expect(saved!.createdAt).toBeTruthy()
  })

  it('aplica los defaults de la cola cuando la ráfaga se agenda con lo mínimo', async () => {
    // Así la va a crear schedule(): un cambio GLOBAL, sin canales, listo para el primer intento.
    await repo.create({
      id: 'e2e-outbox-2',
      hotelId: HOTEL_ID,
      kind: 'inventory',
      scheduledAt: '2026-09-07T13:00:00.000Z',
    } as any)

    const saved = await repo.findById('e2e-outbox-2') as AriOutboxRow | null
    expect(saved).toBeTruthy()
    expect(saved!.status).toBe('pending')
    expect(saved!.attempts).toBe(0)
    expect(saved!.maxAttempts).toBe(3)
    // SIN `?? []`: el fallback taparía exactamente lo que este archivo vigila. Si el default `[]`
    // del campo json no se aplicara y la columna volviera null/undefined, `?? []` haría pasar el
    // test y schedule() crearía filas con `channels` nulo, que el drain lee como cambio global.
    expect(saved!.channels).toEqual([]) // [] = cambio global: base + canales con override
  })

  it('el update refresca `updatedAt`: es con lo que reclaimStale() detecta una fila colgada', async () => {
    // outbox-queue.ts::reclaimStale() compara `updatedAt` contra el corte de STALE_MS para devolver
    // a pending las filas que un proceso caído dejó en `processing`. Si el ORM no persistiera el
    // campo o volviera con otro formato, esas filas no se reclamarían NUNCA y el push se perdería
    // igual que antes de la outbox — el bug que el módulo existe para evitar.
    const antes = await repo.findById('e2e-outbox-2') as AriOutboxRow
    expect(antes.updatedAt).toBeTruthy()

    await repo.update('e2e-outbox-2', { status: 'processing' } as any)
    const saved = await repo.findById('e2e-outbox-2') as AriOutboxRow

    expect(saved.status).toBe('processing')
    expect(typeof saved.updatedAt).toBe('string')
    expect(isNaN(Date.parse(saved.updatedAt!))).toBe(false)         // ISO parseable, no un blob
    expect(saved.updatedAt).toBe(new Date(saved.updatedAt!).toISOString())
    expect(Date.parse(saved.updatedAt!)).toBeGreaterThanOrEqual(Date.parse(saved.createdAt!))
    expect(Date.parse(saved.updatedAt!)).toBeGreaterThanOrEqual(Date.parse(antes.updatedAt!))

    // Se deja como estaba: el caso de abajo consulta por status='pending'.
    await repo.update('e2e-outbox-2', { status: 'pending' } as any)
  })

  it('consulta por hotel y estado — el filtro que usan el drain y el listado admin', async () => {
    const pendientes = await repo.findMany({ hotelId: HOTEL_ID, status: 'pending' } as any)
    expect(pendientes.map((r: AriOutboxRow) => r.id)).toEqual(['e2e-outbox-2'])
  })
})

// El candado de unicidad de la fila pendiente. Se prueba contra la SQLite REAL y no contra un
// doble a propósito: la garantía no es de la cola, es de la BASE — es lo único atómico que hay
// cuando dos procesos hacen a la vez el check-then-act de scheduleOne. Un doble en memoria daría
// verde con el índice ausente, que es exactamente el bug.
//
// El índice acá lo emite `orm.migrate()`: la tabla es NUEVA en cada corrida de este archivo, y para
// una tabla nueva ormMigrate escribe el `UNIQUE` inline en el CREATE TABLE desde el `unique: true`
// del modelo. Por eso NO se crea un `CREATE UNIQUE INDEX` a mano: sería un segundo índice sobre la
// misma columna y taparía justo lo que este caso vigila (que el MODELO traiga la garantía). El
// `CREATE UNIQUE INDEX idx_ari_outbox_pending_key` de migrate-db.ts es para el otro camino, el de
// las bases que ya existían: ahí ormMigrate hace ALTER TABLE ADD COLUMN y el UNIQUE inline no sale.
describe('ari_outbox — pendingKey: la base impide dos filas pendientes del mismo (hotelId, kind)', () => {
  const HOTEL_UNIQ = 'e2e-outbox-hotel-uniq'
  const CLAVE = `${HOTEL_UNIQ}|rates`

  it('rechaza el segundo INSERT con el mismo pendingKey', async () => {
    await repo.create({
      id: 'e2e-outbox-uniq-1',
      hotelId: HOTEL_UNIQ,
      kind: 'rates',
      scheduledAt: '2026-09-07T14:00:00.000Z',
      pendingKey: CLAVE,
    } as any)

    // El segundo proceso: mismo hotel, mismo kind, misma ventana de debounce. En memoria los dos
    // vieron "no hay pendiente"; en la base sólo uno puede quedarse con el turno.
    let error: unknown = null
    try {
      await repo.create({
        id: 'e2e-outbox-uniq-2',
        hotelId: HOTEL_UNIQ,
        kind: 'rates',
        scheduledAt: '2026-09-07T14:00:01.000Z',
        pendingKey: CLAVE,
      } as any)
    } catch (e) {
      error = e
    }

    expect(error).toBeTruthy()
    // El texto importa: es por lo que scheduleOne va a reconocer la carrera perdida y fusionar sus
    // canales en la fila existente en vez de propagar el error.
    expect(String((error as Error).message).toLowerCase()).toContain('unique')
    expect(await repo.findById('e2e-outbox-uniq-2')).toBeNull()

    const pendientes = await repo.findMany({ hotelId: HOTEL_UNIQ, status: 'pending' } as any)
    expect(pendientes.map((r: AriOutboxRow) => r.id)).toEqual(['e2e-outbox-uniq-1']) // UNA sola
  })

  it('deja convivir varias filas con pendingKey NULL — el historial sent/failed del mismo par', async () => {
    // Mismo (hotelId, kind) que la fila de arriba, pero ya drenadas: el pendingKey se limpió al
    // reclamarlas. Si el índice fuera sobre (hotelId, kind) a secas, el segundo push del día sería
    // imposible; funciona porque en SQL dos NULL NO son iguales dentro de un índice único, que es
    // lo que hace del único plano el equivalente exacto del parcial WHERE status='pending'.
    await repo.create({
      id: 'e2e-outbox-null-1', hotelId: HOTEL_UNIQ, kind: 'rates',
      status: 'sent', scheduledAt: '2026-09-07T10:00:00.000Z',
    } as any)
    await repo.create({
      id: 'e2e-outbox-null-2', hotelId: HOTEL_UNIQ, kind: 'rates',
      status: 'failed', scheduledAt: '2026-09-07T11:00:00.000Z', lastError: 'Channex 500',
    } as any)

    const historial = await repo.findMany({ hotelId: HOTEL_UNIQ, kind: 'rates' } as any)
    expect(historial.map((r: AriOutboxRow) => r.id).sort()).toEqual(
      ['e2e-outbox-null-1', 'e2e-outbox-null-2', 'e2e-outbox-uniq-1'],
    )
    for (const id of ['e2e-outbox-null-1', 'e2e-outbox-null-2']) {
      const fila = await repo.findById(id) as AriOutboxRow
      expect(fila.pendingKey ?? null).toBeNull() // fuera de pending nadie ocupa el turno
    }
  })
})
