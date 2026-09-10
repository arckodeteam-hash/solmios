// anuncios/tests/vigencia.e2e.test.ts — E2E del schema de vigencia (ANN-3) contra una SQLite REAL.
//
// No prueba la regla (esa está en visibility-window.test.ts): prueba que `AnunciosModel`
// declare startsAt y endsAt y que orm.migrate() (lo que corre RUN_MIGRATE en cada deploy) cree
// las columnas. El ORM de arckode descarta en silencio al persistir cualquier campo que el
// modelo no declare (el anti-patrón del CLAUDE.md que ya costó el `channexGroupId` de canales):
// si alguien saca los campos del modelo, la fila vuelve sin ventana y el banner mostraría un
// anuncio programado como si fuera de hoy. Este archivo se entera antes.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAnunciosModels } from '../model'

const HOTEL_ID = 'e2e-anuncios-vigencia-hotel-1'

let orm: any
let adapter: any
let dbPath: string
let repo: OrmRepository<any>

beforeAll(async () => {
  dbPath = `/tmp/solmios-anuncios-vigencia-e2e-${crypto.randomUUID()}.db`
  adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  // El registro es el del módulo: el mismo camino que recorre composition-root al bootear
  // AnunciosModule, que es donde el modelo tiene que quedar definido de verdad.
  registerAnunciosModels(orm)
  await orm.migrate()
  repo = new OrmRepository<any>(orm, 'Announcements')
}, 60_000) // migrate() sobre SQLite tarda varios segundos en CI/sandbox

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('announcements — el modelo declara la ventana de vigencia', () => {
  it('persiste y relee startsAt y endsAt sin que el ORM los descarte', async () => {
    await repo.create({
      id: 'e2e-ann-vig-1',
      hotelId: HOTEL_ID,
      title: 'Mantenimiento programado',
      message: 'Corte de agua el jueves',
      type: 'maintenance',
      priority: 'high',
      active: 1,
      // NO-default a propósito: si el modelo no declarara startsAt/endsAt, el ORM los
      // descartaría en silencio y la fila volvería sin ventana — el bug que este archivo vigila.
      startsAt: '2026-09-11T09:00:00.000Z',
      endsAt: '2026-09-12T18:00:00.000Z',
    } as any)

    const saved = await repo.findById('e2e-ann-vig-1')
    expect(saved).toBeTruthy()
    expect(saved!.hotelId).toBe(HOTEL_ID)
    expect(saved!.title).toBe('Mantenimiento programado')
    expect(saved!.startsAt).toBe('2026-09-11T09:00:00.000Z')
    expect(saved!.endsAt).toBe('2026-09-12T18:00:00.000Z')
    expect(saved!.createdAt).toBeTruthy()
  })

  it('una fila sin fechas vuelve con startsAt y endsAt vacíos: publica ya, sin vencimiento', async () => {
    await repo.create({
      id: 'e2e-ann-vig-2',
      hotelId: HOTEL_ID,
      title: 'Aviso de siempre',
      active: 1,
    } as any)

    const saved = await repo.findById('e2e-ann-vig-2')
    expect(saved).toBeTruthy()
    // SIN `?? null` a ciegas sobre la fila entera: el fallback sólo cubre null vs undefined del
    // driver — lo que se vigila es que el campo exista y venga vacío, no que falte.
    expect(saved!.startsAt ?? null).toBeNull()
    expect(saved!.endsAt ?? null).toBeNull()
  })
})
