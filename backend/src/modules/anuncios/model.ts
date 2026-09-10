// anuncios/model.ts — Schema de base de datos
import type { ModelDefinition, ORM } from 'arckode-framework'

export const AnunciosModel: ModelDefinition = {
  table: 'announcements',
  fields: {
    id: { type: 'string', required: true },
    // Vacío/nulo = anuncio de plataforma (no pertenece a ningún hotel).
    hotelId: { type: 'string' },
    authorId: { type: 'string' },
    title: { type: 'string', required: true },
    message: { type: 'text' },
    type: { type: 'string', default: "info" },
    priority: { type: 'string', default: "medium" },
    active: { type: 'number', default: 1 },
    date: { type: 'string' },
    // A quién va dirigido: 'hotel' (solo `hotelId`) | 'all' (todos los hoteles) |
    // 'admins' (todos los hoteles, solo usuarios administradores).
    //
    // Existe porque el ORM solo sabe filtrar por IGUALDAD (`orm-utils.ts:buildWhere`): no hay
    // forma de pedirle `hotelId IS NULL`, así que un anuncio de plataforma era imposible de
    // encontrar desde el listado de un hotel. Esta columna SIEMPRE tiene valor, y por eso sí es
    // consultable. Ver `usecases/visibility.ts`.
    audience: { type: 'string', default: 'hotel' },
    // Ventana de vigencia (ISO 8601). Nulas = visible desde siempre y para siempre.
    startsAt: { type: 'string' },
    endsAt: { type: 'string' },
  },
  timestamps: true,
}

/**
 * Lectura de un anuncio POR USUARIO.
 *
 * Antes el "no volver a mostrar" del banner se guardaba en
 * `configuration('dismissed_announcements', hotelId)`: era del HOTEL, así que el primer empleado
 * que cerraba el aviso se lo ocultaba a todos sus compañeros, dueño incluido.
 *
 * El único compuesto `(announcementId, userId)` NO se declara acá: el ORM no crea índices únicos
 * compuestos. Se crea con `CREATE UNIQUE INDEX` explícito en `migrate-db.ts`.
 */
export const AnnouncementReadsModel: ModelDefinition = {
  table: 'announcement_reads',
  fields: {
    id: { type: 'string', required: true },
    announcementId: { type: 'string', required: true },
    userId: { type: 'string', required: true },
    hotelId: { type: 'string' },
    seenAt: { type: 'string' },
    dismissedAt: { type: 'string' },
  },
  timestamps: true,
}

export function registerAnunciosModels(orm: ORM): void {
  orm.define('Announcements', AnunciosModel)
  orm.define('AnnouncementReads', AnnouncementReadsModel)
}
