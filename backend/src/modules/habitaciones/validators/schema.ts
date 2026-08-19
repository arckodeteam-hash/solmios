import type { ValidationRule } from 'arckode-framework'

// A-2 (auditoría 2026-08-19): 'family' faltaba — el selector del panel ofrece "Familiar"
// (rooms/index.vue) pero el enum lo rechazaba con 400, y el map del frontend colapsaba
// triple/quad→family al leer (Room.service.ts), así que EDITAR una triple/quad y guardar
// reenviaba 'family' → 400 (round-trip corrupto). 'family' es ahora un tipo de primera.
const ROOM_TYPE_ENUM = ['single', 'double', 'twin', 'triple', 'quad', 'suite', 'deluxe', 'presidential', 'family']
const ROOM_STATUS_ENUM = ['available', 'occupied', 'maintenance', 'cleaning', 'out_of_order', 'reserved']

export const CreateHabitacionesSchema: Record<string, ValidationRule> = {
  number: { type: 'string' as const, required: true, min: 1, max: 20 },
  name: { type: 'string' as const, max: 100 },
  type: { type: 'string' as const, enum: ROOM_TYPE_ENUM },
  basePrice: { type: 'number' as const, required: true, min: 0 },
  status: { type: 'string' as const, enum: ROOM_STATUS_ENUM },
  hotelId: { type: 'string' as const, required: true },
  description: { type: 'string' as const, max: 1000 },
  capacity: { type: 'number' as const, min: 1, max: 20 },
  floor: { type: 'number' as const, min: 0 },
  surfaceArea: { type: 'number' as const, min: 0 },
  bathrooms: { type: 'number' as const, min: 0 },
  motorPosition: { type: 'number' as const, min: 0 },
  onlineBookingEnabled: { type: 'boolean' as const },
  excludeFromReports: { type: 'boolean' as const },
  descriptionJson: { type: 'string' as const },
}

export const UpdateHabitacionesSchema: Record<string, ValidationRule> = {
  number: { type: 'string' as const, min: 1, max: 20 },
  name: { type: 'string' as const, max: 100 },
  type: { type: 'string' as const, enum: ROOM_TYPE_ENUM },
  basePrice: { type: 'number' as const, min: 0 },
  status: { type: 'string' as const, enum: ROOM_STATUS_ENUM },
  description: { type: 'string' as const, max: 1000 },
  capacity: { type: 'number' as const, min: 1, max: 20 },
  floor: { type: 'number' as const, min: 0 },
  surfaceArea: { type: 'number' as const, min: 0 },
  bathrooms: { type: 'number' as const, min: 0 },
  motorPosition: { type: 'number' as const, min: 0 },
  onlineBookingEnabled: { type: 'boolean' as const },
  excludeFromReports: { type: 'boolean' as const },
  descriptionJson: { type: 'string' as const },
}

export const BatchCreateSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  type: { type: 'string' as const, required: true, enum: ROOM_TYPE_ENUM },
  basePrice: { type: 'number' as const, required: true, min: 0 },
  from: { type: 'number' as const, required: true, min: 1 },
  to: { type: 'number' as const, required: true, min: 1 },
  floor: { type: 'number' as const, min: 0 },
  capacity: { type: 'number' as const, min: 1, max: 20 },
  bathrooms: { type: 'number' as const, min: 0 },
  surfaceArea: { type: 'number' as const, min: 0 },
  onlineBookingEnabled: { type: 'boolean' as const },
}

export const HabitacionesValidator = { create: CreateHabitacionesSchema, update: UpdateHabitacionesSchema, batch: BatchCreateSchema }
