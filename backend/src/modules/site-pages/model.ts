// site-pages/model.ts — Schema de la tabla site_pages (páginas del sitio público del SaaS).
// Scope PLATAFORMA: hotelId siempre 'platform' (mismo convenio que configuration con scope
// 'platform' — NO es contenido por hotel). El módulo es el único dueño del modelo (regla
// anti modelos-duales: no definirlo en shared/models.ts).
import type { ModelDefinition, ORM } from 'arckode-framework'

export const SitePagesModel: ModelDefinition = {
  table: 'site_pages',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', default: 'platform' },
    // URL pública de la página (ej: /privacidad). Único — índice en migrate-db.ts.
    slug: { type: 'string', required: true },
    title: { type: 'string', required: true },
    metaDescription: { type: 'string' },
    // Contenido de la página (HTML). Lo renderiza el sitio público del SaaS.
    contentHtml: { type: 'text' },
    // producto | empresa | soporte | legal | blog — columnas del footer del sitio.
    category: { type: 'string', default: 'soporte' },
    // draft | published — el endpoint público SOLO expone published.
    status: { type: 'string', default: 'draft' },
    sortOrder: { type: 'number', default: 0 },
  },
  timestamps: true,
}

export function registerSitePagesModels(orm: ORM): void {
  orm.define('SitePages', SitePagesModel)
}
