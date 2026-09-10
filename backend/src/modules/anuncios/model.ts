// anuncios/model.ts — Schema de base de datos
import type { ModelDefinition, ORM } from 'arckode-framework'

export const AnunciosModel: ModelDefinition = {
  table: 'announcements',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string' },
    authorId: { type: 'string' },
    title: { type: 'string', required: true },
    message: { type: 'text' },
    type: { type: 'string', default: "info" },
    priority: { type: 'string', default: "medium" },
    active: { type: 'number', default: 1 },
    date: { type: 'string' },
  },
  timestamps: true,
}

/**
 * Lectura de un aviso por usuario (ANN-4). El ✕ del banner ya no oculta el aviso
 * a todo el hotel: la marca pasa de una por hotel (configuration) a una por
 * usuario, y cada uno setea sus propios momentos sobre SU fila.
 *
 * `seenAt` y `dismissedAt` arrancan null y se escriben por uso — un aviso puede
 * verse hoy (seenAt al mostrarse el banner) y cerrarse recién días después
 * (dismissedAt en el ✕), sin pisar lo que marcaron los demás. La unicidad del
 * par (announcementId, userId) no la declara el modelo porque el ORM no emite
 * UNIQUE compuesto: la garantiza `idx_announcement_reads_announcement_user`,
 * el CREATE UNIQUE INDEX explícito de migrate-db.ts.
 */
export const AnnouncementReadsModel: ModelDefinition = {
  table: 'announcement_reads',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    userId: { type: 'string', required: true, indexed: true },
    /** El aviso leído. */
    announcementId: { type: 'string', required: true },
    /** ISO del primer momento en que este usuario vio el aviso. */
    seenAt: { type: 'string' },
    /** ISO del momento en que este usuario lo cerró con el ✕. */
    dismissedAt: { type: 'string' },
  },
  timestamps: true,
}

export function registerAnunciosModels(orm: ORM): void {
  orm.define('Announcements', AnunciosModel)
  orm.define('AnnouncementReads', AnnouncementReadsModel)
}
