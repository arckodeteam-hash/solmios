// grupos/model.ts — Schema de base de datos
import type { ModelDefinition, ORM } from 'arckode-framework'

export const GruposModel: ModelDefinition = {
  table: 'groups',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    leadGuestId: { type: 'string' },
    totalRooms: { type: 'number', default: 1 },
    checkIn: { type: 'string' },
    checkOut: { type: 'string' },
    status: { type: 'string', default: "pending" },
    totalAmount: { type: 'number', default: 0 },
    /** #276 (MR-11) — lo cobrado online por el grupo entero (lo asienta `settle()` del motor). */
    paidAmount: { type: 'number', default: 0 },
    notes: { type: 'text' },
    createdAt: { type: 'string' },
  },
  timestamps: true,
}

export function registerGruposModels(orm: ORM): void {
  orm.define('Groups', GruposModel)
}
