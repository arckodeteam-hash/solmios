// enrichment.test.ts — #141: el log guarda IP y nombre de usuario.
//
// Medido en producción antes de esto: 5 de 414 filas con `ip` (1,2%) y 243 sin `userName`, así
// que la pantalla decía "Sistema" para el 59% de las acciones que hizo una persona. Las columnas
// existían en la tabla; lo que faltaba era llenarlas.
//
// El caso que importa de verdad es el último: que la IP sobreviva desde el middleware HTTP hasta
// un service tres capas más abajo, sin pasarla por parámetro.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AuditlogService } from '../service'
import { runWithRequestContext } from '../../../shared/request-context'
import { requestContext } from '../../../shared/middlewares/request-context'

function makeService(opts: { user?: any; userRepoThrows?: boolean } = {}) {
  const rows: any[] = []
  const repo = {
    create: async (d: any) => { const row = { id: `al${rows.length + 1}`, ...d }; rows.push(row); return row },
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    update: async () => null, delete: async () => true, count: async () => rows.length,
    paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<any>
  const userRepo = {
    findById: async (id: string) => {
      if (opts.userRepoThrows) throw new Error('DB caída')
      return opts.user === undefined ? { id, name: 'Rosa Camarera' } : opts.user
    },
  } as unknown as RepositoryAdapter<any>
  const hotelRepo = { findMany: async () => [] } as unknown as RepositoryAdapter<any>
  const cache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
  const svc = new AuditlogService(repo, userRepo, hotelRepo, silentLogger(), cache, {} as any)
  return { svc, rows }
}

const entry = { userId: 'u1', action: 'invoice.delete', entity: 'invoice', entityId: 'inv-9', hotelId: 'h1' }

describe('#141 — la entrada guarda desde dónde y quién', () => {
  it('toma la IP del request en curso, sin que el llamador la pase', async () => {
    const { svc, rows } = makeService()
    await runWithRequestContext({ ip: '190.80.1.7' }, () => svc.create(entry))
    expect(rows[0].ip).toBe('190.80.1.7')
  })

  it('resuelve el nombre del usuario desde `users`', async () => {
    const { svc, rows } = makeService()
    await svc.create(entry)
    expect(rows[0].userName).toBe('Rosa Camarera')
  })

  it('lo que el llamador YA trae no se pisa (una IP explícita gana)', async () => {
    const { svc, rows } = makeService()
    await runWithRequestContext({ ip: '190.80.1.7' }, () =>
      svc.create({ ...entry, ip: '10.0.0.9', userName: 'Nombre del evento' }))
    expect(rows[0].ip).toBe('10.0.0.9')
    expect(rows[0].userName).toBe('Nombre del evento')
  })

  it('un cron corre fuera de un request: sin IP, sin romper', async () => {
    const { svc, rows } = makeService()
    await svc.create({ action: 'subscription.suspend', entity: 'subscription' })
    expect(rows[0].ip).toBeUndefined()
    expect(rows[0].userName).toBeUndefined() // sin userId no hay a quién resolver
  })

  it('`unknown` (sin proxy ni socket) no se guarda: un dato falso es peor que ninguno', async () => {
    const { svc, rows } = makeService()
    await runWithRequestContext({ ip: 'unknown' }, () => svc.create(entry))
    expect(rows[0].ip).toBeUndefined()
  })

  it('si la base de usuarios falla, la entrada IGUAL se escribe (el log no se pierde)', async () => {
    const { svc, rows } = makeService({ userRepoThrows: true })
    await runWithRequestContext({ ip: '190.80.1.7' }, () => svc.create(entry))
    expect(rows).toHaveLength(1)
    expect(rows[0].ip).toBe('190.80.1.7')
    expect(rows[0].userName).toBeUndefined()
  })

  it('un usuario borrado no rompe: queda la acción sin nombre', async () => {
    const { svc, rows } = makeService({ user: null })
    await svc.create(entry)
    expect(rows).toHaveLength(1)
    expect(rows[0].userName).toBeUndefined()
  })
})

describe('#141 — la IP viaja desde el middleware HTTP hasta el service', () => {
  it('un request con Cloudflare-IP termina escribiendo esa IP en el log', async () => {
    const { svc, rows } = makeService()
    const router = new Router()
    router.use(requestContext())
    // Ruta cualquiera que audita "tres capas abajo", como hace un service real.
    router.get('/api/cosa', async () => {
      await Promise.resolve() // el contexto tiene que sobrevivir a los awaits del camino
      await svc.create(entry)
      return { status: 200, body: { ok: true } }
    })

    const res = await router.resolve('GET', '/api/cosa', { headers: { 'cf-connecting-ip': '201.229.44.10' } })

    expect(res.status).toBe(200)
    expect(rows[0].ip).toBe('201.229.44.10')
  })

  it('sin request no hay contexto que se filtre de un pedido a otro', async () => {
    const { svc, rows } = makeService()
    const router = new Router()
    router.use(requestContext())
    router.get('/api/cosa', async () => { await svc.create(entry); return { status: 200, body: {} } })

    await router.resolve('GET', '/api/cosa', { headers: { 'cf-connecting-ip': '201.229.44.10' } })
    await svc.create(entry) // fuera de todo request

    expect(rows[0].ip).toBe('201.229.44.10')
    expect(rows[1].ip).toBeUndefined()
  })
})
