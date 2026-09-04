import type { ModelDefinition, ORM } from 'arckode-framework'

export const HabitacionesModel: ModelDefinition = {
  table: 'rooms',
  fields: {
    id: { type: 'string', required: true },
    number: { type: 'string', required: true },
    name: { type: 'string' },
    type: { type: 'string', default: 'double' },
    basePrice: { type: 'number', required: true },
    status: { type: 'string', default: 'available' },
    hotelId: { type: 'string', required: true, indexed: true },
    description: { type: 'text' },
    amenities: { type: 'string', default: '' },
    capacity: { type: 'number', default: 2 },
    // Adultos/niños que se planean, feature "adultos+niños+edades" (2026-09-02). NULL (default)
    // = sin configurar todavía → los usecases de capacidad caen a `capacity` completo, ningún
    // hotel existente ve cambiar su comportamiento hasta que lo configure.
    maxAdults: { type: 'number' },
    maxChildren: { type: 'number' },
    floor: { type: 'number' },
    surfaceArea: { type: 'number', default: 0 },
    bathrooms: { type: 'number', default: 1 },
    motorPosition: { type: 'number', default: 0 },
    onlineBookingEnabled: { type: 'boolean', default: true },
    excludeFromReports: { type: 'boolean', default: false },
    descriptionJson: { type: 'string' },
  },
  timestamps: true,
}

export function registerHabitacionesModels(orm: ORM): void {
  orm.define('Rooms', HabitacionesModel)
}
