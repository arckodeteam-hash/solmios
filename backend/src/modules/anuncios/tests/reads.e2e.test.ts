// anuncios/tests/reads.e2e.test.ts — E2E del schema de `announcement_reads` contra una SQLite REAL.
//
// No prueba lógica (esa llega con el service de seen/dismiss): prueba que el ModelDefinition
// esté COMPLETO y que la unicidad por usuario exista en la BASE. El ORM de arckode descarta al
// persistir cualquier campo que el modelo no declare, y lo hace en silencio (el anti-patrón del
// CLAUDE.md que ya costó el `channexGroupId` de canales), así que un campo olvidado no se nota
// hasta que en producción la fila vuelve sin él. Y el UNIQUE compuesto (announcementId, userId)
// NO lo emite orm.migrate — vive en migrate-db.ts como CREATE UNIQUE INDEX explícito.
//
// Por eso este archivo recorre los DOS caminos: la tabla la crea orm.migrate() sobre el
// registro real del módulo (registerAnunciosModels), y el índice es el SQL textual de
// migrate-db.ts, extraído del fuente y corrido con el mismo adapter.run() con el que el script
// lo aplica en cada deploy. Nada de copias: si el índice se borra o se edita en migrate-db.ts,
// este test se entera.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAnunciosModels } from '../model'

const HOTEL_ID = 'e2e-anuncios-hotel-1'

let orm: any
let adapter: any
let dbPath: string
let repo: OrmRepository<any>

// El índice único del deploy real, no una copia: se lee del fuente de migrate-db.ts para que si
// alguien lo renombra, lo restringe o lo borra, el test falle por el archivo que cambió y no por
// un doble que seguiría pasando verde con la garantía ausente.
function announcementReadsUniqueIndexSql(): string {
  const source = readFileSync(new URL('../../../../migrate-db.ts', import.meta.url), 'utf8')
  const match = source.match(
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_reads[\s\S]*?ON announcement_reads \(announcementId, userId\)/,
  )
  if (!match) {
    throw new Error('migrate-db.ts ya no crea el UNIQUE (announcementId, userId) de announcement_reads')
  }
  return match[0]
}

// COUNT(*) portable sobre el adapter (mismo criterio que countRows de migrate-db.ts).
async function countReads(where = '', params: unknown[] = []): Promise<number> {
  const rows = (await adapter.query(`SELECT COUNT(*) as c FROM announcement_reads ${where}`, params)) as Array<{ c: number }>
  return rows[0]?.c ?? 0
}

beforeAll(async () => {
  dbPath = `/tmp/solmios-anuncios-reads-e2e-${crypto.randomUUID()}.db`
  adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  // El registro es el del módulo: el mismo camino que recorre composition-root al bootear
  // AnunciosModule, que es donde el modelo tiene que quedar definido de verdad.
  registerAnunciosModels(orm)
  await orm.migrate()
  // orm.migrate no crea el único compuesto: corre el índice del deploy, tal cual migrate-db.ts.
  await adapter.run(announcementReadsUniqueIndexSql())
  repo = new OrmRepository<any>(orm, 'AnnouncementReads')
}, 60_000) // migrate() sobre SQLite tarda varios segundos en CI/sandbox

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('announcement_reads — el modelo declara todos los campos de la lectura por usuario', () => {
  it('persiste y relee una fila COMPLETA sin que el ORM descarte ningún campo', async () => {
    await repo.create({
      id: 'e2e-read-1',
      hotelId: HOTEL_ID,
      userId: 'e2e-user-1',
      announcementId: 'e2e-ann-1',
      // NO-default a propósito: si el modelo no declarara seenAt/dismissedAt, el ORM los
      // descartaría en silencio y la fila volvería sin ellos — el bug que este archivo vigila.
      seenAt: '2026-09-10T12:00:00.000Z',
      dismissedAt: '2026-09-10T12:05:00.000Z',
    } as any)

    const saved = await repo.findById('e2e-read-1')
    expect(saved).toBeTruthy()
    expect(saved!.hotelId).toBe(HOTEL_ID)
    expect(saved!.userId).toBe('e2e-user-1')
    expect(saved!.announcementId).toBe('e2e-ann-1')
    expect(saved!.seenAt).toBe('2026-09-10T12:00:00.000Z')
    expect(saved!.dismissedAt).toBe('2026-09-10T12:05:00.000Z')
    // timestamps: true → el ✕ compara contra estas columnas, no contra seenAt.
    expect(saved!.createdAt).toBeTruthy()
  })

  it('arranca sin marcas: seenAt y dismissedAt vuelven null hasta que el usuario las setee', async () => {
    await repo.create({
      id: 'e2e-read-2',
      hotelId: HOTEL_ID,
      userId: 'e2e-user-2',
      announcementId: 'e2e-ann-1',
    } as any)

    const saved = await repo.findById('e2e-read-2')
    expect(saved).toBeTruthy()
    // SIN `?? null` a ciegas: el fallback taparía justo lo que este caso vigila (que el campo
    // exista y venga vacío, no que el ORM lo haya descartado).
    expect(saved!.seenAt ?? null).toBeNull()
    expect(saved!.dismissedAt ?? null).toBeNull()
  })
})

describe('announcement_reads — un aviso se lee por usuario, no por hotel', () => {
  it('el segundo INSERT del mismo (announcementId, userId) no crea fila: el UNIQUE lo rechaza', async () => {
    await repo.create({
      id: 'e2e-read-dup-1',
      hotelId: HOTEL_ID,
      userId: 'e2e-user-dup',
      announcementId: 'e2e-ann-dup',
      seenAt: '2026-09-10T13:00:00.000Z',
    } as any)

    // El segundo "visto" del mismo par: dos requests concurrentes vieron "no hay fila" en
    // memoria; en la base sólo una puede quedarse. El service (ANN-4) resuelve el conflicto y
    // hace idempotente el camino — acá se verifica que la BASE lo rechace y que la fila
    // original quede intacta: sin esta garantía, la idempotencia del service es de palabra.
    let error: unknown = null
    try {
      await repo.create({
        id: 'e2e-read-dup-2',
        hotelId: HOTEL_ID,
        userId: 'e2e-user-dup',
        announcementId: 'e2e-ann-dup',
      } as any)
    } catch (e) {
      error = e
    }

    expect(error).toBeTruthy()
    // El texto importa: es por lo que el service va a reconocer la carrera perdida y va a
    // devolver la fila existente en vez de propagar el error.
    expect(String((error as Error).message).toLowerCase()).toContain('unique')
    expect(await repo.findById('e2e-read-dup-2')).toBeNull()
    expect(await countReads('WHERE announcementId = ? AND userId = ?', ['e2e-ann-dup', 'e2e-user-dup'])).toBe(1)
  })

  it('deja convivir lecturas del mismo aviso por usuarios distintos', async () => {
    // El caso que rompía el ✕ por hotel: A cierra el aviso y B tiene que poder leerlo igual.
    // Mismo announcementId, distinto userId → una fila por usuario, el índice no se inmuta.
    await repo.create({
      id: 'e2e-read-multi-1',
      hotelId: HOTEL_ID,
      userId: 'e2e-user-a',
      announcementId: 'e2e-ann-multi',
      seenAt: '2026-09-10T14:00:00.000Z',
    } as any)
    await repo.create({
      id: 'e2e-read-multi-2',
      hotelId: HOTEL_ID,
      userId: 'e2e-user-b',
      announcementId: 'e2e-ann-multi',
      dismissedAt: '2026-09-10T14:30:00.000Z',
    } as any)

    expect(await countReads('WHERE announcementId = ?', ['e2e-ann-multi'])).toBe(2)
    const lectora = await repo.findMany({ announcementId: 'e2e-ann-multi' } as any)
    expect(lectora.map((r: any) => r.userId).sort()).toEqual(['e2e-user-a', 'e2e-user-b'])
  })
})
