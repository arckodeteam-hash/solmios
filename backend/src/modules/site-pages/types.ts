// site-pages/types.ts — Contratos de API del módulo (≠ model.ts, que es BD).

export const SITE_PAGE_CATEGORIES = ['producto', 'empresa', 'soporte', 'legal', 'blog'] as const
export type SitePageCategory = (typeof SITE_PAGE_CATEGORIES)[number]

export const SITE_PAGE_STATUSES = ['draft', 'published'] as const
export type SitePageStatus = (typeof SITE_PAGE_STATUSES)[number]

export const CATEGORY_LABELS: Record<SitePageCategory, string> = {
  producto: 'Producto',
  empresa: 'Empresa',
  soporte: 'Soporte',
  legal: 'Legal',
  blog: 'Blog',
}

/** Fila completa — solo para el admin (el público usa las variantes Public*). */
export interface SitePageDTO {
  id: string
  hotelId: string
  slug: string
  title: string
  metaDescription: string | null
  contentHtml: string
  category: SitePageCategory
  status: SitePageStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateSitePageDTO {
  slug: string
  title: string
  metaDescription?: string
  contentHtml?: string
  category?: SitePageCategory
  status?: SitePageStatus
  sortOrder?: number
}

export interface UpdateSitePageDTO {
  slug?: string
  title?: string
  metaDescription?: string | null
  contentHtml?: string
  category?: SitePageCategory
  status?: SitePageStatus
  sortOrder?: number
}

/** Ítem del índice público (sin contenido): lista el sitio para armar menús/sitemap. */
export interface PublicSitePageSummary {
  slug: string
  title: string
  category: SitePageCategory
  updatedAt: string
}

/** Página pública completa (solo status='published'). */
export interface PublicSitePage {
  slug: string
  title: string
  metaDescription: string | null
  contentHtml: string
  category: SitePageCategory
  updatedAt: string
}

export interface SitePageListResult {
  data: SitePageDTO[]
  total: number
}
