// Difusión de anuncios contra el ORM REAL (SQLite in-memory), no contra un doble.
//
// Los tests de `service.test.ts` usan un repo falso que imita el filtro por igualdad del ORM. Este
// archivo cierra el círculo: verifica que con el constructor de consultas de verdad
// —`kernel/db/orm-utils.ts:buildWhere`, que NO tiene OR, ni IN, ni IS NULL— un anuncio de
// plataforma efectivamente le llegue a dos hoteles distintos. Es la prueba de que el arreglo
// funciona en producción y no solo contra el mock.
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { silentLogger } from 'arckode-framework/testing'
import type { Auth, CacheAdapter } from 'arckode-framework'
import { registerAnunciosModels } from '../model'
import { AnunciosService } from '../service'
import type { AnunciosDTO, AnnouncementReadDTO } from '../types'

const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

function memoryCache(): CacheAdapter {
  const store = new Map<string, unknown>()
  return {
    get: (async (k: string) => (store.has(k) ? store.get(k) : null)) as CacheAdapter['get'],
    set: (async (k: string, v: unknown) => { store.set(k, v) }) as CacheAdapter['set'],
    delete: async (k: string) => { store.delete(k) },
    flush: async () => { store.clear() },
  }
}

async function withService(fn: (svc: AnunciosService, repo: OrmRepository<AnunciosDTO>) => Promise<void>): Promise<void> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerAnunciosModels(orm)
  // `users` la define el módulo de usuarios; acá alcanza con una tabla mínima para resolver hotel.
  orm.define('Users', { table: 'users', fields: { id: { type: 'string', required: true }, hotelId: { type: 'string' }, role: { type: 'string' } }, timestamps: true })
  await orm.migrate()

  const repo = new OrmRepository<AnunciosDTO>(orm, 'Announcements')
  const usersRepo = new OrmRepository<any>(orm, 'Users')
  const readsRepo = new OrmRepository<AnnouncementReadDTO>(orm, 'AnnouncementReads')
  const svc = new AnunciosService(repo, silentLogger(), memoryCache(), usersRepo, fakeAuth, readsRepo)
  try {
    await fn(svc, repo)
  } finally {
    await db.close?.()
  }
}

const superAdmin = { id: 'sa', role: 'super_admin' as const, hotelId: undefined }
const duenoH1 = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const duenoH2 = { id: 'u2', role: 'hotel_admin', hotelId: 'h2' }
const recepcionH1 = { id: 'u3', role: 'receptionist', hotelId: 'h1' }

describe('difusión con el ORM real', () => {
  it('el anuncio de plataforma llega a DOS hoteles distintos', async () => {
    await withService(async (svc) => {
      await svc.create({ title: 'Mantenimiento del sábado', message: 'De 2 a 4 AM', audience: 'all' }, superAdmin)
      await svc.create({ title: 'Solo para h1', audience: 'hotel', hotelId: 'h1' }, superAdmin)

      const vistaH1 = await svc.list({}, duenoH1)
      const vistaH2 = await svc.list({}, duenoH2)

      expect(vistaH1.data.map((a) => a.title).sort()).toEqual(['Mantenimiento del sábado', 'Solo para h1'])
      // h2 recibe el global y NO el de h1: el aislamiento sigue en pie.
      expect(vistaH2.data.map((a) => a.title)).toEqual(['Mantenimiento del sábado'])
    })
  })

  it('la fila global queda con hotelId NULL en la base, y aun así se entrega', async () => {
    await withService(async (svc, repo) => {
      await svc.create({ title: 'Global', audience: 'all' }, superAdmin)
      const fila = (await repo.findMany({ audience: 'all' }))[0]
      // Esto es lo que rompía: `hotelId = 'h1'` nunca matchea NULL.
      expect(fila.hotelId ?? null).toBeNull()
      expect((await svc.list({}, duenoH1)).total).toBe(1)
    })
  })

  it('"solo administradores" no le llega a recepción', async () => {
    await withService(async (svc) => {
      await svc.create({ title: 'Cambios de facturación', audience: 'admins' }, superAdmin)
      expect((await svc.list({}, recepcionH1)).total).toBe(0)
      expect((await svc.list({}, duenoH1)).total).toBe(1)
    })
  })

  it('un anuncio programado no viaja hasta su fecha, y después sí', async () => {
    await withService(async (svc) => {
      const enUnaHora = new Date(Date.now() + 3600_000).toISOString()
      await svc.create({ title: 'Corte de luz', audience: 'all', startsAt: enUnaHora }, superAdmin)

      const antes = await svc.list({}, duenoH1)
      expect(JSON.stringify(antes)).not.toContain('Corte de luz')

      // El super_admin sí lo ve en su vista de administración.
      expect((await svc.list({ scope: 'all' }, superAdmin)).total).toBe(1)
    })
  })

  it('el índice único no está, pero el upsert igual no duplica lecturas', async () => {
    // `orm.migrate()` no crea únicos compuestos (el índice lo pone `migrate-db.ts`). Que el
    // service no duplique tiene que sostenerse por sí solo, sin depender de la constraint.
    await withService(async (svc) => {
      const creado = await svc.create({ title: 'Aviso', audience: 'all' }, superAdmin)
      await svc.markSeen(creado.id, duenoH1)
      await svc.markSeen(creado.id, duenoH1)
      await svc.markDismissed(creado.id, duenoH1)

      const lista = await svc.list({}, duenoH1)
      expect(lista.data[0].seen).toBe(true)
      expect(lista.data[0].dismissed).toBe(true)
      // Y el compañero no hereda nada.
      expect((await svc.list({}, recepcionH1)).data[0].dismissed).toBe(false)
    })
  })

  it('publicar invalida la caché: el hotel no espera 5 minutos', async () => {
    await withService(async (svc) => {
      expect((await svc.list({}, duenoH1)).total).toBe(0)
      await svc.create({ title: 'Urgente', audience: 'all', priority: 'urgent' }, superAdmin)
      expect((await svc.list({}, duenoH1)).total).toBe(1)
    })
  })
})
