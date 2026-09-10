// anuncios/usecases/reads.ts — Lecturas de un anuncio POR USUARIO.
//
// Antes el "no volver a mostrar" del banner se guardaba en
// `configuration('dismissed_announcements', hotelId)`: era del HOTEL, así que el primer empleado
// que cerraba el aviso se lo ocultaba a todos sus compañeros, dueño incluido.

import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import type { AnnouncementReadDTO, AnunciosDTO, AnunciosPaginated } from '../types'

export type ReadField = 'seenAt' | 'dismissedAt'

/**
 * Marca el anuncio para ESTE usuario. Idempotente: la primera marca manda, porque el dato que
 * interesa es cuándo lo vio por primera vez, no cuántas veces recargó la página.
 */
export async function upsertRead(
  deps: {
    readsRepo: RepositoryAdapter<AnnouncementReadDTO>
    anunciosRepo: RepositoryAdapter<AnunciosDTO>
  },
  announcementId: string,
  user: { id: string; hotelId?: string },
  field: ReadField,
): Promise<AnnouncementReadDTO> {
  // Existir es condición para marcarlo: sin esto, cualquier id inventado ensucia la tabla y
  // vuelve inútil el denominador de la tasa de apertura.
  const announcement = await deps.anunciosRepo.findById(announcementId)
  if (!announcement) throw new NotFoundError('Anuncio no encontrado')

  const now = new Date().toISOString()
  const existing = await deps.readsRepo.findOne({ announcementId, userId: user.id })

  if (existing) {
    // La primera vista es la que vale: no se pisa.
    if (existing[field]) return existing
    return (await deps.readsRepo.update(existing.id, { [field]: now } as any)) ?? existing
  }

  return deps.readsRepo.create({
    announcementId,
    userId: user.id,
    hotelId: user.hotelId,
    [field]: now,
  } as any)
}

/**
 * Agrega `seen`/`dismissed` de ESTE usuario a una página ya calculada.
 *
 * Va DESPUÉS de la caché a propósito: si formara parte de la entrada cacheada, el primer empleado
 * que cierra un aviso se lo ocultaría a todos sus compañeros — que es exactamente el defecto que
 * este cambio viene a corregir, solo que movido a otra capa.
 */
export async function annotateReads(
  readsRepo: RepositoryAdapter<AnnouncementReadDTO> | undefined,
  logger: Logger,
  page: AnunciosPaginated,
  userId: string,
): Promise<AnunciosPaginated> {
  if (!readsRepo || page.data.length === 0) return page

  let reads: AnnouncementReadDTO[] = []
  try {
    reads = await readsRepo.findMany({ userId })
  } catch (e) {
    // Saber si ya lo cerró es una comodidad; no vale perder el anuncio por eso.
    logger.warn('No se pudieron leer las marcas de lectura', { error: String(e) })
    return page
  }

  const byId = new Map(reads.map((r) => [r.announcementId, r]))
  return {
    ...page,
    data: page.data.map((a) => {
      const r = byId.get(a.id)
      return { ...a, seen: !!r?.seenAt, dismissed: !!r?.dismissedAt }
    }),
  }
}
