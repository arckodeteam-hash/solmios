import { http } from './http'

/** Estado de aprobación ante Meta. `none` = la plantilla nunca salió del PMS. */
export type TemplateApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected'

export interface WhatsappTemplate {
  id?: string
  hotelId?: string
  name: string
  body: string
  category?: string
  // Contrato REAL del wire (COR-2/REG-1): la RESPUESTA llega boolean — el ORM
  // deserializa boolean↔INTEGER al leer. El 0/1 es sólo el formato de ESCRITURA
  // (schemas backend `type:'number'`) → WhatsappTemplateInput.isActive es `0 | 1`.
  isActive: boolean
  /** Idioma con el que se registra en Meta. */
  language?: string
  /** Categoría de META (MARKETING/UTILITY/AUTHENTICATION) — distinta de `category`, que es la nuestra. */
  metaCategory?: string
  /** Lo escribe el servidor con lo que contesta Meta. El frontend solo lo muestra. */
  approvalStatus?: TemplateApprovalStatus
  metaTemplateId?: string
  metaRejectedReason?: string
  metaSyncedAt?: string
  /** Nombres de variables en el orden que Meta les asignó: [0] es {{1}}. */
  metaVariableOrder?: string[]
}

export interface WhatsappTemplateInput {
  name: string
  body: string
  category?: string
  /** Escritura: 0/1 (UpdateTemplateSchema `type: 'number'`); la lectura llega boolean. */
  isActive?: 0 | 1
  language?: string
  metaCategory?: string
}

export const WhatsappService = {
  list: () => http.get<{ data: WhatsappTemplate[] }>('/whatsapp-templates'),
  create: (data: WhatsappTemplateInput) =>
    http.post<WhatsappTemplate>('/whatsapp-templates', data),
  update: (id: string, data: Partial<WhatsappTemplateInput>) =>
    http.put<WhatsappTemplate>(`/whatsapp-templates/${id}`, data),
  remove: (id: string) => http.delete<{ success: boolean }>(`/whatsapp-templates/${id}`),

  /**
   * Crea de una vez las plantillas recomendadas que le falten al hotel, ya redactadas y validadas
   * contra las reglas de forma de Meta. Idempotente: tocarlo dos veces no duplica nada.
   */
  seedRecomendadas: () =>
    http.post<{ creadas: string[]; yaExistian: string[] }>('/whatsapp-templates/recomendadas', {}),

  /** Manda la plantilla a Meta para que la revise. Devuelve la plantilla ya en 'pending'. */
  submitToMeta: (id: string) =>
    http.post<WhatsappTemplate>(`/whatsapp-templates/${id}/submit`, {}),
  /** Pregunta a Meta cómo quedó. Es POST porque escribe: actualiza la copia local. */
  syncStatus: (id: string) =>
    http.post<WhatsappTemplate>(`/whatsapp-templates/${id}/sync-status`, {}),

  /** Genera un link wa.me con texto pre-rellenado */
  link: (phone: string, text: string) => {
    const clean = phone.replace(/[^0-9]/g, '')
    return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`
  },
}
