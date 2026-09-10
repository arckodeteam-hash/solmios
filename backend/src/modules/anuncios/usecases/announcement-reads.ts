// anuncios/usecases/announcement-reads.ts — quién vio y quién cerró cada aviso (ANN-4).
//
// Extraído de `service.ts` (que pasaba las 200 líneas del gate de God Object): el service ahora
// sólo delega. El comportamiento es el mismo, línea por línea — lo cubren `tests/service.test.ts`
// y `tests/reads.e2e.test.ts`.
//
// La regla del módulo: un aviso se lee y se cierra POR PERSONA, no por hotel. El par
// (announcementId, userId) es único (índice de `migrate-db.ts`).
import { NotFoundError, AuthError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import type { AnunciosDTO, AnunciosPaginated } from '../types'
import { isVisibleFor } from '../../../shared/usecases/announcement-visibility'

/**
 * Lectura de UN aviso por UN usuario — fila de `announcement_reads`. El par
 * (announcementId, userId) es único (índice de migrate-db.ts): un aviso se lee y se
 * cierra por persona, no por hotel. Ver `AnnouncementReadsModel`.
 */
export interface AnnouncementReadDTO {
  id: string
  hotelId?: string
  userId: string
  announcementId: string
  /** ISO del PRIMER visto del usuario; null hasta que el banner lo marca. */
  seenAt?: string | null
  /** ISO del ✕ del usuario; null hasta que lo cierra. */
  dismissedAt?: string | null
}

/** Un anuncio del listado con su conteo de lecturas reales (sólo el panel de plataforma lo pide). */
export type AnnouncementWithReads = AnunciosDTO & { reads?: number }

export interface CurrentUser { id: string; role: string; hotelId?: string }

export interface AnnouncementReadsDeps {
  repo: RepositoryAdapter<AnunciosDTO>
  readsRepo: RepositoryAdapter<AnnouncementReadDTO>
  userRepo: RepositoryAdapter<any>
}

/** hotelId del usuario: del token y, si no está, de la base (mismo criterio en todo el módulo). */
export async function resolveHotelId(deps: AnnouncementReadsDeps, currentUser: CurrentUser): Promise<string | undefined> {
  if (currentUser.hotelId) return currentUser.hotelId
  if (currentUser.role === 'super_admin') return undefined
  // @ignore IDOR_RISK — se busca al usuario del PROPIO token (currentUser.id), no a uno pedido.
  const user = await deps.userRepo.findById(currentUser.id)
  return user?.hotelId
}

/**
 * Un seen/dismiss sólo se registra sobre un aviso que existe y es visible para el hotel
 * del usuario (mismo criterio que `getById`): si no, NotFoundError/AuthError y ninguna
 * fila huérfana en announcement_reads.
 */
async function visibleAnnouncementOrThrow(
  deps: AnnouncementReadsDeps, id: string, currentUser: CurrentUser, hotelId?: string,
): Promise<AnunciosDTO> {
  // @ignore IDOR_RISK — la verificación de pertenencia es la línea siguiente.
  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Anuncio no encontrado')
  // Un anuncio de plataforma (audience all/admins) no tiene hotelId: la pertenencia se decide
  // por audiencia, no por igualdad de hotel (ver shared/usecases/announcement-visibility.ts).
  if (currentUser.role !== 'super_admin' && !isVisibleFor(item, { role: currentUser.role, hotelId })) {
    throw new AuthError('No autorizado')
  }
  return item
}

/**
 * Upsert de la fila de lectura por (announcementId, userId), select-then-create como
 * `markTeamRead`. Sólo escribe la marca que falta: la que ya está no se pisa (`seenAt`
 * conserva el primer visto) y ninguna borra a la otra (dismiss no toca `seenAt`).
 */
async function upsertRead(
  deps: AnnouncementReadsDeps,
  announcement: AnunciosDTO,
  currentUser: CurrentUser,
  hotelId: string | undefined,
  mark: { seenAt?: string; dismissedAt?: string },
): Promise<void> {
  const announcementId = announcement.id
  const [existing] = await deps.readsRepo.findMany({ announcementId, userId: currentUser.id })
  if (existing) {
    const patch: Partial<AnnouncementReadDTO> = {}
    if (mark.seenAt && !existing.seenAt) patch.seenAt = mark.seenAt
    if (mark.dismissedAt && !existing.dismissedAt) patch.dismissedAt = mark.dismissedAt
    if (Object.keys(patch).length === 0) return
    await deps.readsRepo.update(existing.id, patch as any)
    return
  }
  try {
    await deps.readsRepo.create({
      // Contexto de hotel de la lectura: el del usuario y, si no tiene (super_admin),
      // el del propio aviso.
      hotelId: hotelId ?? announcement.hotelId ?? '',
      userId: currentUser.id,
      announcementId,
      ...mark,
    } as any)
  } catch (e) {
    // Carrera perdida: otro request del mismo par insertó primero y el UNIQUE
    // (announcementId, userId) nos rechazó. La lectura ya está registrada —
    // idempotente, no error. Si la fila no está, el fallo era real: propagar.
    const [raced] = await deps.readsRepo.findMany({ announcementId, userId: currentUser.id })
    if (!raced) throw e
  }
}

/**
 * Marca el aviso como VISTO por ESTE usuario. Idempotente: el banner la llama en cada
 * render, pero el par (announcementId, userId) tiene UNA fila y `seenAt` conserva el
 * momento de la PRIMERA llamada — repetir no lo pisa ni duplica.
 */
export async function markSeen(deps: AnnouncementReadsDeps, id: string, currentUser: CurrentUser): Promise<void> {
  const hotelId = await resolveHotelId(deps, currentUser)
  const ann = await visibleAnnouncementOrThrow(deps, id, currentUser, hotelId)
  await upsertRead(deps, ann, currentUser, hotelId, { seenAt: new Date().toISOString() })
}

/**
 * El ✕ del banner: ESTE usuario deja de ver el aviso, el resto del hotel lo sigue viendo.
 * Setea `dismissedAt` del par (announcementId, userId) SIN tocar `seenAt`. Idempotente.
 */
export async function dismiss(deps: AnnouncementReadsDeps, id: string, currentUser: CurrentUser): Promise<void> {
  const hotelId = await resolveHotelId(deps, currentUser)
  const ann = await visibleAnnouncementOrThrow(deps, id, currentUser, hotelId)
  await upsertRead(deps, ann, currentUser, hotelId, { dismissedAt: new Date().toISOString() })
}

/**
 * Vista por usuario de la página del listado (ANN-4), aplicada DESPUÉS del cache:
 *
 * - Usuario del hotel (el banner): sin los avisos que ÉL descartó — el resto del hotel
 *   los sigue viendo igual, por eso el filtro no va en la key del cache compartido.
 * - super_admin (panel de plataforma): ve TODOS, incluso los que él mismo cerró, y cada
 *   aviso con `reads` = lecturas reales (COUNT de announcement_reads por anuncio).
 */
export async function applyUserView(
  deps: AnnouncementReadsDeps, page: AnunciosPaginated, currentUser: CurrentUser, hotelId?: string,
): Promise<AnunciosPaginated> {
  if (currentUser.role === 'super_admin') {
    const data: AnnouncementWithReads[] = await Promise.all(page.data.map(async (a) => ({
      ...a,
      reads: await deps.readsRepo.count({ announcementId: a.id }),
    })))
    return { ...page, data }
  }
  const mine = await deps.readsRepo.findMany({ userId: currentUser.id, hotelId })
  const dismissed = new Set(mine.filter((r) => r.dismissedAt).map((r) => r.announcementId))
  if (dismissed.size === 0) return page
  const data = page.data.filter((a) => !dismissed.has(a.id))
  // El total es el de la página compartida menos lo que ESTA página le ocultó a este usuario.
  return { ...page, data, total: Math.max(page.total - (page.data.length - data.length), 0) }
}
