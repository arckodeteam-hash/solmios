import { http } from './http'

export interface WhatsappTemplate {
  id?: string
  hotelId?: string
  name: string
  body: string
  category?: string
  // INTEGER 0/1 en el API (UpdateTemplateSchema `type: 'number'`, ORM boolean↔INTEGER).
  isActive: boolean | number
}

export const WhatsappService = {
  list: () => http.get<{ data: WhatsappTemplate[] }>('/whatsapp-templates'),
  create: (data: { name: string; body: string; category?: string; isActive?: boolean | number }) =>
    http.post<WhatsappTemplate>('/whatsapp-templates', data),
  update: (id: string, data: Partial<WhatsappTemplate>) =>
    http.put<WhatsappTemplate>(`/whatsapp-templates/${id}`, data),
  remove: (id: string) => http.delete<{ success: boolean }>(`/whatsapp-templates/${id}`),
  /** Genera un link wa.me con texto pre-rellenado */
  link: (phone: string, text: string) => {
    const clean = phone.replace(/[^0-9]/g, '')
    return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`
  },
}
