// site-pages/service.ts — Lógica del CMS de páginas del sitio público del SaaS.
// CRUD para super_admin (platform) + lecturas públicas de páginas published.
// Reglas de negocio: slug único (409), slug kebab-case, category/status en enum,
// draft invisible para el público (404 igual que inexistente — no filtra su existencia).
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ConflictError, ValidationError } from 'arckode-framework'
import type {
  SitePageDTO,
  CreateSitePageDTO,
  UpdateSitePageDTO,
  PublicSitePage,
  PublicSitePageSummary,
  SitePageListResult,
  SitePageCategory,
  SitePageStatus,
} from './types'
import { SITE_PAGE_CATEGORIES, SITE_PAGE_STATUSES } from './types'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new ValidationError('slug: solo minúsculas, números y guiones (ej: sobre-nosotros)')
  }
}

function assertCategory(category: string): asserts category is SitePageCategory {
  if (!(SITE_PAGE_CATEGORIES as readonly string[]).includes(category)) {
    throw new ValidationError(`category: debe ser una de ${SITE_PAGE_CATEGORIES.join(', ')}`)
  }
}

function assertStatus(status: string): asserts status is SitePageStatus {
  if (!(SITE_PAGE_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status: debe ser ${SITE_PAGE_STATUSES.join(' o ')}`)
  }
}

function toPublic(page: SitePageDTO): PublicSitePage {
  return {
    slug: page.slug,
    title: page.title,
    metaDescription: page.metaDescription,
    contentHtml: page.contentHtml,
    category: page.category,
    updatedAt: page.updatedAt,
  }
}

export class SitePagesService {
  constructor(
    private readonly repo: RepositoryAdapter<SitePageDTO>,
    private readonly logger: Logger,
  ) {}

  /** Lista completa para el admin (todas las páginas, drafts incluidos). */
  async list(): Promise<SitePageListResult> {
    const data = await this.repo.findMany(
      {},
      { orderBy: [{ field: 'sortOrder', dir: 'ASC' }, { field: 'title', dir: 'ASC' }] },
    )
    return { data, total: data.length }
  }

  async getById(id: string): Promise<SitePageDTO> {
    // Scope plataforma (hotelId='platform'): no hay hotel contra el que assertionar
    // ownership — el acceso ya lo cerró el guard de ruta (super_admin). Read por
    // filtro único explícito.
    const page = await this.repo.findOne({ id })
    if (!page) throw new NotFoundError('Página no encontrada')
    return page
  }

  async create(input: CreateSitePageDTO): Promise<SitePageDTO> {
    assertSlug(input.slug)
    assertCategory(input.category ?? 'soporte')
    if (input.status !== undefined) assertStatus(input.status)

    const existing = await this.repo.findOne({ slug: input.slug })
    if (existing) throw new ConflictError(`Ya existe una página con slug "${input.slug}"`)

    // `as any` como en apikeys/service.ts: createdAt/updatedAt los llena el ORM
    // (timestamps: true en el modelo).
    const page = await this.repo.create({
      hotelId: 'platform',
      slug: input.slug,
      title: input.title,
      metaDescription: input.metaDescription ?? null,
      contentHtml: input.contentHtml ?? '',
      category: input.category ?? 'soporte',
      status: input.status ?? 'draft',
      sortOrder: input.sortOrder ?? 0,
    } as any)
    this.logger.info('site-pages: creada', { slug: page.slug, status: page.status })
    return page
  }

  async update(id: string, input: UpdateSitePageDTO): Promise<SitePageDTO> {
    await this.getById(id) // 404 si no existe
    if (input.slug !== undefined) {
      assertSlug(input.slug)
      const dup = await this.repo.findOne({ slug: input.slug })
      if (dup && dup.id !== id) {
        throw new ConflictError(`Ya existe una página con slug "${input.slug}"`)
      }
    }
    if (input.category !== undefined) assertCategory(input.category)
    if (input.status !== undefined) assertStatus(input.status)

    const updated = await this.repo.update(id, {
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.metaDescription !== undefined && { metaDescription: input.metaDescription }),
      ...(input.contentHtml !== undefined && { contentHtml: input.contentHtml }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    })
    // Carrera: pudo borrarse entre el getById y el update — mismo 404.
    if (!updated) throw new NotFoundError('Página no encontrada')
    this.logger.info('site-pages: actualizada', { id, slug: updated.slug, status: updated.status })
    return updated
  }

  async remove(id: string): Promise<void> {
    await this.getById(id)
    await this.repo.delete(id)
    this.logger.info('site-pages: eliminada', { id })
  }

  /** Índice público: solo published, sin contenido. */
  async listPublic(): Promise<PublicSitePageSummary[]> {
    const pages = await this.repo.findMany(
      { status: 'published' },
      { orderBy: [{ field: 'sortOrder', dir: 'ASC' }, { field: 'title', dir: 'ASC' }] },
    )
    return pages.map((p) => ({ slug: p.slug, title: p.title, category: p.category, updatedAt: p.updatedAt }))
  }

  /**
   * Página pública por slug. Draft o inexistente → mismo 404 (no revela que una
   * página exista en borrador).
   */
  async getPublicBySlug(slug: string): Promise<PublicSitePage> {
    const page = await this.repo.findOne({ slug })
    if (!page || page.status !== 'published') throw new NotFoundError('Página no encontrada')
    return toPublic(page)
  }
}
