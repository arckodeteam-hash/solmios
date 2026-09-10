// services/PlatformContact.service.ts — Contacto público de la PLATAFORMA (REQ-PIPE-07, #148).
//   GET /api/public/platform-contact → { whatsappUrl: string | null }
// Lo consume la landing para el botón flotante de WhatsApp. Sin auth, rate-limited por IP.
// Nunca tira: una landing sin botón es aceptable; una landing rota por un endpoint caído, no.

import { http } from './http'
import type { PlatformContact } from '@/types'

const WA_PREFIX = 'https://wa.me/'

export const PlatformContactService = {
  async get(): Promise<PlatformContact> {
    try {
      const r = await http.get<PlatformContact>('/public/platform-contact')
      const url = r?.whatsappUrl
      // Solo se acepta un enlace wa.me: cualquier otra cosa (envelope raro, HTML de un proxy)
      // dejaría un botón que abre cualquier URL en la portada del producto.
      return { whatsappUrl: typeof url === 'string' && url.startsWith(WA_PREFIX) ? url : null }
    } catch {
      return { whatsappUrl: null }
    }
  },
}
