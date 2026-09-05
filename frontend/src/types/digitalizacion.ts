// types/digitalizacion.ts — Espejo del contract del módulo backend `digitalizacion`
// (expediente de acompañamiento de hoteles SIN presencia digital: página web por plantilla,
// configuración completa —que se cobra—, Google Maps, Google Hotel y motor de reservas).
//
// Las seis etapas del issue se modelan como cinco pasos con estado propio + el estado global
// del expediente. Las reglas entre pasos las aplica el backend; acá solo viven los contratos.

/** Los pasos del acompañamiento, en el orden en que se muestran. */
export const DIGITALIZATION_STEPS = ['website', 'config', 'googleMaps', 'googleHotel', 'bookingEngine'] as const
export type DigitalizationStep = (typeof DIGITALIZATION_STEPS)[number]

/** Estado de cada paso por separado — los pasos no son secuenciales estrictos. */
export const STEP_STATUSES = ['pendiente', 'en_progreso', 'listo'] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

/** Estado del expediente completo. */
export const CASE_STATUSES = ['abierto', 'completado', 'cancelado'] as const
export type DigitalizationCaseStatus = (typeof CASE_STATUSES)[number]

export const STEP_LABELS: Record<DigitalizationStep, string> = {
  website: 'Página web',
  config: 'Configuración completa',
  googleMaps: 'Google Maps',
  googleHotel: 'Google Hotel',
  bookingEngine: 'Motor de reservas',
}

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  listo: 'Listo',
}

export const CASE_STATUS_LABELS: Record<DigitalizationCaseStatus, string> = {
  abierto: 'Abierto',
  completado: 'Completado',
  cancelado: 'Cancelado',
}

/** Una plantilla del catálogo de landings públicas — la sirve `GET /digitalizacion/plantillas`. */
export interface SiteTemplate {
  key: string
  name: string
  description: string
}

/** Fila completa del expediente — solo para el super_admin. */
export interface DigitalizationCase {
  id: string
  hotelId: string
  hotelName: string | null
  status: DigitalizationCaseStatus
  websiteStatus: StepStatus
  templateKey: string | null
  siteUrl: string | null
  configStatus: StepStatus
  /** null mientras no esté cotizado — el precio de la configuración aún no está definido. */
  configFee: number | null
  configCurrency: string
  configPaid: boolean
  googleMapsStatus: StepStatus
  googlePlaceId: string | null
  googleMapsUrl: string | null
  googleHotelStatus: StepStatus
  bookingEngineStatus: StepStatus
  bookingEngineUrl: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** Hotel sin presencia digital detectado por el sistema — candidato a abrir expediente. */
export interface DigitalizationCandidate {
  hotelId: string
  name: string
  slug?: string
  city?: string
  website?: string
}

/** Abrir expediente: solo hace falta el hotel, el resto arranca en 'pendiente'. */
export interface CreateDigitalizationCaseInput {
  hotelId: string
  notes?: string
}

/** Lo que puede editar el super_admin sobre un expediente ya abierto. */
export interface UpdateDigitalizationCaseInput {
  status?: DigitalizationCaseStatus
  notes?: string
  configFee?: number
  configCurrency?: string
  configPaid?: boolean
  templateKey?: string
  siteUrl?: string
  googlePlaceId?: string
  googleMapsUrl?: string
  bookingEngineUrl?: string
}

/**
 * Avance de un paso. Los datos del paso viajan en el mismo request porque las reglas del backend
 * los exigen para pasar a 'listo' (p.ej. Google Maps listo sin `googlePlaceId` → 400).
 */
export interface AdvanceStepInput {
  step: DigitalizationStep
  status: StepStatus
  templateKey?: string
  siteUrl?: string
  configFee?: number
  configCurrency?: string
  configPaid?: boolean
  googlePlaceId?: string
  googleMapsUrl?: string
  bookingEngineUrl?: string
  notes?: string
}

export interface DigitalizationListResult {
  data: DigitalizationCase[]
  total: number
}
