// types/site-pages.ts — Espejo del contract del módulo backend site-pages
// (páginas del sitio público del SaaS: footer de solmios.com).

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

export interface SitePage {
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

export interface CreateSitePageInput {
  slug: string
  title: string
  metaDescription?: string
  contentHtml?: string
  category?: SitePageCategory
  status?: SitePageStatus
  sortOrder?: number
}

export type UpdateSitePageInput = Partial<CreateSitePageInput>

export interface SitePageListResult {
  data: SitePage[]
  total: number
}
