// services/SitePages.service.ts — Cliente API del CMS de páginas del sitio público
// (módulo backend `site-pages`, scope plataforma, solo super_admin):
//   GET    /api/site-pages            → {data: SitePage[], total}
//   GET    /api/site-pages/:id        → SitePage
//   POST   /api/site-pages            → SitePage (201)
//   PUT    /api/site-pages/:id        → SitePage
//   DELETE /api/site-pages/:id        → 204
// La lectura pública (`/api/public/site-pages[/:slug]`) la consume el landing, no el panel.

import { http } from './http'
import type { SitePage, SitePageListResult, CreateSitePageInput, UpdateSitePageInput } from '@/types/site-pages'

export const SitePagesService = {
  list(): Promise<SitePageListResult> {
    return http.get<SitePageListResult>('/site-pages')
  },

  getById(id: string): Promise<SitePage> {
    return http.get<SitePage>(`/site-pages/${id}`)
  },

  create(input: CreateSitePageInput): Promise<SitePage> {
    return http.post<SitePage>('/site-pages', input)
  },

  update(id: string, input: UpdateSitePageInput): Promise<SitePage> {
    return http.put<SitePage>(`/site-pages/${id}`, input)
  },

  remove(id: string): Promise<void> {
    return http.delete<void>(`/site-pages/${id}`)
  },
}
