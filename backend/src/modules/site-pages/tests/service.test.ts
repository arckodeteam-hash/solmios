// site-pages/tests/site-pages.test.ts — Reglas de negocio del CMS, con repo en memoria.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import { SitePagesService } from '../service'
import type { SitePageDTO } from '../types'

// Repo fake: mismo contract que OrmRepository (solo lo que usa el service).
function makeRepo(seed: SitePageDTO[] = []) {
  const rows = new Map<string, SitePageDTO>(seed.map((r) => [r.id, { ...r }]))
  const repo: RepositoryAdapter<SitePageDTO> = {
    async findMany(filters: any = {}, opts: any = {}) {
      let out = [...rows.values()].filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as any)[k] === v),
      )
      const order = opts.orderBy as any[] | undefined
      if (order) {
        out.sort((a, b) => {
          for (const { field, dir } of order) {
            const cmp = String((a as any)[field]).localeCompare(String((b as any)[field]))
            if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
          }
          return 0
        })
      }
      return out
    },
    async findOne(filters: any) {
      return (
        [...rows.values()].find((r) =>
          Object.entries(filters).every(([k, v]) => (r as any)[k] === v),
        ) ?? null
      )
    },
    async findById(id: string) {
      return rows.get(id) ?? null
    },
    async create(data: any) {
      const row = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      } as SitePageDTO
      rows.set(row.id, row)
      return row
    },
    async update(id: string, data: any) {
      const cur = rows.get(id)
      if (!cur) throw new NotFoundError('no')
      const next = { ...cur, ...data, updatedAt: new Date().toISOString() }
      rows.set(id, next)
      return next
    },
    async delete(id: string) {
      rows.delete(id)
    },
  } as any
  return { repo, rows }
}

const log = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} } as unknown as Logger

function page(partial: Partial<SitePageDTO> & { id: string; slug: string }): SitePageDTO {
  return {
    hotelId: 'platform',
    title: `Título ${partial.slug}`,
    metaDescription: null,
    contentHtml: '<p>hola</p>',
    category: 'soporte',
    status: 'draft',
    sortOrder: 0,
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...partial,
  }
}

describe('site-pages — creación', () => {
  it('crea con defaults (draft, soporte) y scope platform', async () => {
    const { repo } = makeRepo()
    const svc = new SitePagesService(repo, log)
    const created = await svc.create({ slug: 'privacidad', title: 'Privacidad' })
    expect(created.status).toBe('draft')
    expect(created.category).toBe('soporte')
    expect(created.hotelId).toBe('platform')
  })

  it('rechaza slug duplicado con 409 (ConflictError)', async () => {
    const { repo } = makeRepo([page({ id: '1', slug: 'privacidad', status: 'published' })])
    const svc = new SitePagesService(repo, log)
    expect(svc.create({ slug: 'privacidad', title: 'Otra' })).rejects.toBeInstanceOf(ConflictError)
  })

  it('rechaza slugs inválidos (mayúsculas, espacios, acentos)', async () => {
    const svc = new SitePagesService(makeRepo().repo, log)
    for (const bad of ['Privacidad', 'sobre nosotros', 'términos', 'a--b', '-x']) {
      expect(svc.create({ slug: bad, title: 'X' })).rejects.toBeInstanceOf(ValidationError)
    }
  })

  it('acepta slugs kebab-case válidos', async () => {
    const svc = new SitePagesService(makeRepo().repo, log)
    const ok = await svc.create({ slug: 'sobre-nosotros-2', title: 'Sobre nosotros' })
    expect(ok.slug).toBe('sobre-nosotros-2')
  })

  it('rechaza category/status fuera de enum', async () => {
    const svc = new SitePagesService(makeRepo().repo, log)
    expect(svc.create({ slug: 'x', title: 'X', category: 'random' as any })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(svc.create({ slug: 'x', title: 'X', status: 'live' as any })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('site-pages — actualización', () => {
  it('actualiza campos parciales sin pisar el resto', async () => {
    const { repo, rows } = makeRepo([page({ id: '1', slug: 'ayuda', status: 'draft' })])
    const svc = new SitePagesService(repo, log)
    const updated = await svc.update('1', { status: 'published' })
    expect(updated.status).toBe('published')
    expect(updated.title).toBe('Título ayuda')
    expect(rows.get('1')!.contentHtml).toBe('<p>hola</p>')
  })

  it('permite cambiar el slug solo si no choca con otra página', async () => {
    const { repo } = makeRepo([
      page({ id: '1', slug: 'ayuda' }),
      page({ id: '2', slug: 'soporte' }),
    ])
    const svc = new SitePagesService(repo, log)
    await svc.update('1', { slug: 'centro-de-ayuda' }) // libre → OK
    expect(svc.update('1', { slug: 'soporte' })).rejects.toBeInstanceOf(ConflictError)
  })

  it('404 al actualizar una página inexistente', async () => {
    const svc = new SitePagesService(makeRepo().repo, log)
    expect(svc.update('no-existe', { title: 'X' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('site-pages — lectura pública', () => {
  it('listPublic devuelve SOLO published y ordenadas', async () => {
    const { repo } = makeRepo([
      page({ id: '1', slug: 'a-draft', status: 'draft', sortOrder: 1 }),
      page({ id: '2', slug: 'b-pub', status: 'published', sortOrder: 2 }),
      page({ id: '3', slug: 'c-pub', status: 'published', sortOrder: 1 }),
    ])
    const svc = new SitePagesService(repo, log)
    const list = await svc.listPublic()
    expect(list.map((p) => p.slug)).toEqual(['c-pub', 'b-pub'])
    expect(list[0]).not.toHaveProperty('contentHtml')
  })

  it('getPublicBySlug expone published con contenido', async () => {
    const { repo } = makeRepo([page({ id: '1', slug: 'terminos', status: 'published' })])
    const svc = new SitePagesService(repo, log)
    const pub = await svc.getPublicBySlug('terminos')
    expect(pub.contentHtml).toBe('<p>hola</p>')
    expect(pub).not.toHaveProperty('id')
  })

  it('draft e inexistente responden igual: 404 (no revela drafts)', async () => {
    const { repo } = makeRepo([page({ id: '1', slug: 'cookies', status: 'draft' })])
    const svc = new SitePagesService(repo, log)
    expect(svc.getPublicBySlug('cookies')).rejects.toBeInstanceOf(NotFoundError)
    expect(svc.getPublicBySlug('no-existe')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('site-pages — borrado', () => {
  it('borra existente y 404 si no existe', async () => {
    const { repo } = makeRepo([page({ id: '1', slug: 'vieja' })])
    const svc = new SitePagesService(repo, log)
    await svc.remove('1')
    expect(svc.remove('1')).rejects.toBeInstanceOf(NotFoundError)
  })
})
