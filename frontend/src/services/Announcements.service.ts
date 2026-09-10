import { http } from './http'

export type AnnouncementType = 'info' | 'success' | 'warning' | 'critical' | 'maintenance' | string
export type AnnouncementPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Announcement {
  id: string
  hotelId?: string
  authorId?: string
  title: string
  message?: string
  type: AnnouncementType
  priority: AnnouncementPriority
  active: boolean | number
  date?: string
  createdAt?: string
}

export const AnnouncementsService = {
  /** Lista anuncios activos (filtra por hotel del usuario o global) */
  list: (params?: { hotelId?: string; activeOnly?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.hotelId) qs.set('hotelId', params.hotelId)
    if (params?.activeOnly) qs.set('active', '1')
    const query = qs.toString()
    return http.get<{ data: Announcement[] }>(`/anuncios${query ? `?${query}` : ''}`)
  },
  create: (data: Omit<Announcement, 'id'>) => http.post<Announcement>('/anuncios', data),
  update: (id: string, data: Partial<Announcement>) => http.put<Announcement>(`/anuncios/${id}`, data),
  remove: (id: string) => http.delete<{ success: boolean }>(`/anuncios/${id}`),
  /** Marca el anuncio como visto por el usuario del token (idempotente, sin body). */
  seen: (id: string) => http.post<void>(`/anuncios/${id}/seen`),
  /** Descarta el anuncio para el usuario del token (el ✕ del banner, sin body). */
  dismiss: (id: string) => http.post<void>(`/anuncios/${id}/dismiss`),
}

const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>'
const ICON_SUCCESS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
const ICON_WARNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>'
const ICON_CRITICAL = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12 15a.75.75 0 01-.75-.75V8.25a.75.75 0 011.5 0v6a.75.75 0 01-.75.75zm0 3a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25z" clip-rule="evenodd"/></svg>'
const ICON_MAINTENANCE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.11 4.111m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"/></svg>'
const ICON_DEFAULT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46"/></svg>'

export const ANNOUNCEMENT_META: Record<string, { icon: string; bgClass: string; textClass: string; borderClass: string }> = {
  info: { icon: ICON_INFO, bgClass: 'bg-blue-50', textClass: 'text-blue-800', borderClass: 'border-blue-200' },
  success: { icon: ICON_SUCCESS, bgClass: 'bg-emerald-50', textClass: 'text-emerald-800', borderClass: 'border-emerald-200' },
  warning: { icon: ICON_WARNING, bgClass: 'bg-amber-50', textClass: 'text-amber-800', borderClass: 'border-amber-200' },
  critical: { icon: ICON_CRITICAL, bgClass: 'bg-red-50', textClass: 'text-red-800', borderClass: 'border-red-200' },
  maintenance: { icon: ICON_MAINTENANCE, bgClass: 'bg-purple-50', textClass: 'text-purple-800', borderClass: 'border-purple-200' },
}

export function announcementMeta(type: string) {
  return ANNOUNCEMENT_META[type] || { icon: ICON_DEFAULT, bgClass: 'bg-gray-50', textClass: 'text-gray-800', borderClass: 'border-gray-200' }
}
