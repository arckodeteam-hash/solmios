// site-pages/sockets.ts — Hooks OPCIONALES hacia otros módulos.
// Los sockets son opcionales. El módulo funciona sin ellos.
// Un conector puede pasar sockets para reaccionar a cambios del CMS del sitio
// (ej: invalidar caché del landing cuando se publica una página).

import type { SitePageDTO } from './types'

export interface SitePagesSockets {
  onSitePageCreated?: (data: SitePageDTO) => Promise<void>
  onSitePageUpdated?: (data: SitePageDTO) => Promise<void>
  onSitePageDeleted?: (id: string, slug: string) => Promise<void>
  onSitePagePublished?: (slug: string) => Promise<void>
}
