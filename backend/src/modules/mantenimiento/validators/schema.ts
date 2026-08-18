import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'
import { MAX_TEXT_LENGTH, MIN_TEXT_LENGTH } from '../../../shared/validators/limits'

const CATEGORY_ENUM = ['general', 'plumbing', 'electrical', 'hvac', 'furniture', 'appliance', 'structural', 'pest_control', 'carpentry', 'painting', 'electronics']
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent']
const STATUS_ENUM = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
export const PHOTO_TYPE_ENUM = ['before', 'after', 'during']
// Un solo tope para todo el texto que escribe una persona.
const NOTES_MAX_LENGTH = MAX_TEXT_LENGTH

export const CreateMantenimientoSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  title: { type: 'string' as const, required: true, min: MIN_TEXT_LENGTH, max: MAX_TEXT_LENGTH },
  roomId: { type: 'string' as const },
  roomNumber: { type: 'string' as const, max: 20 },
  description: { type: 'string' as const, max: NOTES_MAX_LENGTH },
  category: { type: 'string' as const, enum: CATEGORY_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  assignedTo: { type: 'string' as const, max: 100 },
  // Proveedor EXTERNO: alternativo a `assignedTo` (el ticket lo resuelve alguien de afuera).
  providerId: { type: 'string' as const, max: 100 },
  estimatedCost: { type: 'number' as const, min: 0 },
  reportedDate: { type: 'string' as const },
  resolvedDate: { type: 'string' as const },
  // Sin las fotos no se sabe qué hay que arreglar. `reportedBy` NO se acepta del
  // cliente: lo pone el service desde el token.
  photos: { type: 'array' as const },
}

export const UpdateMantenimientoSchema: Record<string, ValidationRule> = {
  title: { type: 'string' as const, min: MIN_TEXT_LENGTH, max: MAX_TEXT_LENGTH },
  roomId: { type: 'string' as const },
  roomNumber: { type: 'string' as const, max: 20 },
  description: { type: 'string' as const, max: NOTES_MAX_LENGTH },
  category: { type: 'string' as const, enum: CATEGORY_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  assignedTo: { type: 'string' as const, max: 100 },
  // Proveedor EXTERNO: alternativo a `assignedTo` (el ticket lo resuelve alguien de afuera).
  providerId: { type: 'string' as const, max: 100 },
  estimatedCost: { type: 'number' as const, min: 0 },
  reportedDate: { type: 'string' as const },
  resolvedDate: { type: 'string' as const },
}

// Notes dedicado: reemplaza el check inline `if (!notes)` del controller.
// Mismo límite que el campo notes en CreateMantenimientoSchema — un solo techo por campo.
export const AddNotesSchema: Record<string, ValidationRule> = {
  notes: { type: 'string' as const, required: true, min: 1, max: NOTES_MAX_LENGTH },
}

export const MantenimientoValidator = { create: CreateMantenimientoSchema, update: UpdateMantenimientoSchema }

export const CompleteMantenimientoSchema: Record<string, ValidationRule> = {
  notes: { type: 'string' as const, max: MAX_TEXT_LENGTH },
}

export const AddPhotoMantenimientoSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const, enum: PHOTO_TYPE_ENUM },
  /** Data URL `data:image/jpeg;base64,…`. Los bytes viajan en el JSON: el router
   *  del framework no propaga los archivos de un multipart al handler. */
  photo: { type: 'string' as const, required: true },
  fileName: { type: 'string' as const, max: 200 },
}

// Campos del perfil del proveedor, compartidos por alta y edición.
const PROVIDER_PROFILE_FIELDS: Record<string, ValidationRule> = {
  specialty: { type: 'string' as const, max: 80 },
  phone: { type: 'string' as const, max: 40 },
  // El framework valida formato de email nativamente con este tipo — antes era 'string'
  // y "foobar" se guardaba sin objeción.
  email: { type: 'email' as const, max: 120 },
  notes: { type: 'text' as const, max: NOTES_MAX_LENGTH },
  address: { type: 'string' as const, max: 200 },
  rate: { type: 'string' as const, max: 80 },
  // Días CSV en inglés ("mon,tue,…"); el frontend arma la cadena. Formato "HH:mm".
  workDays: { type: 'string' as const, max: 40 },
  workStart: { type: 'string' as const, max: 5 },
  workEnd: { type: 'string' as const, max: 5 },
}

/** Alta de un SERVICIO EXTERNO (proveedor/contratista). */
export const CreateProviderSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true, min: MIN_TEXT_LENGTH, max: 120 },
  ...PROVIDER_PROFILE_FIELDS,
  // El formulario de alta permite crear directo como inactivo — antes no estaba declarado,
  // el validador lo descartaba y el usecase lo ignoraba (el checkbox era decorativo).
  active: { type: 'boolean' as const },
}

/** Edición: todo opcional (merge parcial). */
export const UpdateProviderSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: MIN_TEXT_LENGTH, max: 120 },
  ...PROVIDER_PROFILE_FIELDS,
  active: { type: 'boolean' as const },
}
