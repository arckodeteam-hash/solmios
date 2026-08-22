import { http } from './http'

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
}

export interface WhatsappTemplateInput {
  name: string
  body: string
  category?: string
  /** Escritura: 0/1 (UpdateTemplateSchema `type: 'number'`); la lectura llega boolean. */
  isActive?: 0 | 1
}

export const WhatsappService = {
  list: () => http.get<{ data: WhatsappTemplate[] }>('/whatsapp-templates'),
  create: (data: WhatsappTemplateInput) =>
    http.post<WhatsappTemplate>('/whatsapp-templates', data),
  update: (id: string, data: Partial<WhatsappTemplateInput>) =>
    http.put<WhatsappTemplate>(`/whatsapp-templates/${id}`, data),
  remove: (id: string) => http.delete<{ success: boolean }>(`/whatsapp-templates/${id}`),
  /** Genera un link wa.me con texto pre-rellenado */
  link: (phone: string, text: string) => {
    const clean = phone.replace(/[^0-9]/g, '')
    return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`
  },
}
