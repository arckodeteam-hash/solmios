// digitalizacion/types.ts — Contratos de API del módulo (≠ model.ts, que es BD).
//
// Las seis etapas del issue se modelan como cinco pasos con estado propio (`DIGITALIZATION_STEPS`)
// + el estado global del expediente (`CASE_STATUSES`). El servicio es el que aplica las reglas de
// negocio entre pasos (p.ej. googleHotel exige googleMaps listo); acá solo viven los contratos.

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

export const CASE_STATUS_LABELS: Record<DigitalizationCaseStatus, string> = {
  abierto: 'Abierto',
  completado: 'Completado',
  cancelado: 'Cancelado',
}

/** Una plantilla del catálogo de landings públicas. */
export interface SiteTemplate {
  key: string
  name: string
  description: string
}

/**
 * Catálogo de plantillas para la página del hotel. Las keys son las mismas que ya usa la landing
 * pública (`LANDING_TEMPLATE_IDS` en landing/types.ts, `PRESET_MAP` en el frontend): lo que se
 * elige acá es lo que después se guarda como `templateId` del theme, no un catálogo paralelo.
 */
export const SITE_TEMPLATES: SiteTemplate[] = [
  { key: 'classic', name: 'Clásica', description: 'Azul navy + cyan. El look por defecto de SOLMI, sobrio y neutro.' },
  { key: 'modern', name: 'Moderna', description: 'Teal + coral. Vibrante, pensada para hoteles urbanos.' },
  { key: 'boutique', name: 'Boutique', description: 'Bordó + dorado. Cálida y editorial, para hoteles de nicho.' },
]

/** Keys del catálogo — fuente de verdad para validar `templateKey`. */
export const SITE_TEMPLATE_KEYS: string[] = SITE_TEMPLATES.map((t) => t.key)

/** Fila completa del expediente — solo para el super_admin. */
export interface DigitalizationCaseDTO {
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

/** Abrir expediente: solo hace falta el hotel, el resto arranca en 'pendiente'. */
export interface CreateDigitalizationCaseDTO {
  hotelId: string
  notes?: string
}

/** Lo que puede editar el super_admin sobre un expediente ya abierto. */
export interface UpdateDigitalizationCaseDTO {
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
 * Avance de un paso. Los datos del paso viajan en el mismo request porque las reglas del servicio
 * los exigen para pasar a 'listo' (p.ej. googleMaps listo sin `googlePlaceId` es ValidationError).
 */
export interface AdvanceStepDTO {
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

/** Hotel sin presencia digital detectado por el sistema — candidato a abrir expediente. */
export interface DigitalizationCandidateDTO {
  hotelId: string
  name: string
  slug?: string
  city?: string
  website?: string
}

export interface DigitalizationListResult {
  data: DigitalizationCaseDTO[]
  total: number
}
