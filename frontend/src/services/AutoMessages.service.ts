import { http } from './http'

export interface AutoMessage {
  id?: string
  hotelId?: string
  title: string
  color: string
  emailSubject?: string
  emailBody?: string
  whatsappBody?: string
  channel: 'email' | 'whatsapp' | 'both'
  triggerEvent: 'reservation_created' | 'pre_checkin' | 'checkin_day' | 'checkout_day' | 'post_stay' | string
  triggerOffset: number
  variables?: string[]
  // Contrato REAL del wire (COR-2/REG-1): las RESPUESTAS llegan con isActive BOOLEAN —
  // el ORM deserializa boolean↔INTEGER al leer (kernel/db/orm-utils.ts). El 0/1 sólo
  // existe en la ESCRITURA: los schemas del backend lo declaran `type:'number'` y por
  // eso AutoMessageInput lo tipa `0 | 1`. Documentar "llega 1/0" fijó el formato
  // equivocado y con un 0 los `!== false` de la UI marcaban pausados como activos.
  isActive: boolean
  event?: string
  language?: string
  triggerType?: string
}

export interface AutoMessageInput {
  title: string
  color: string
  emailSubject?: string
  emailBody?: string
  whatsappBody?: string
  channel?: string
  triggerEvent?: string
  triggerOffset?: number
  variables?: string[]
  /** Escritura: 0/1 (schemas backend `type:'number'`); la lectura llega boolean. */
  isActive?: 0 | 1
  event?: string
  language?: string
  triggerType?: string
}

export const AutoMessagesService = {
  list: () => http.get<{ data: AutoMessage[] }>('/auto-messages'),
  create: (data: AutoMessageInput) => http.post<AutoMessage>('/auto-messages', data),
  update: (id: string, data: Partial<AutoMessageInput>) => http.put<AutoMessage>(`/auto-messages/${id}`, data),
  remove: (id: string) => http.delete<{ success: boolean }>(`/auto-messages/${id}`),
}
