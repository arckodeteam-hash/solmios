// connectors/ai-recepcionista-whatsapp.ts — La bandeja puede responderle al huésped.
//
// Une tres piezas que viven separadas a propósito: las credenciales del hotel (ai-recepcionista),
// el cliente HTTP de Meta (services/) y el historial de envíos (marketing). Sin este connector la
// bandeja muestra las conversaciones pero el botón de responder no tiene por dónde salir.

import type { ConnectorContext } from 'arckode-framework'
import { sendTextMessage, explicarErrorDeEnvio } from '../services/whatsapp-cloud-client'

interface AiModuleWithInbox {
  getWhatsappCredentials(hotelId: string): Promise<{ wabaId: string; accessToken: string; phoneNumberId: string } | null>
  setInboxDeps(p: { whatsapp: any; registrarEnvio?: (dto: Record<string, unknown>) => Promise<void> }): void
}

interface MarketingModuleWithLogs {
  createMessageLog(dto: Record<string, unknown>): Promise<unknown>
}

export function aiRecepcionistaWhatsappConnector(ctx: ConnectorContext): void {
  const ai = ctx.resolveModule<AiModuleWithInbox>('ai-recepcionista')
  const marketing = ctx.resolveModule<MarketingModuleWithLogs>('marketing')

  ai.setInboxDeps({
    whatsapp: {
      credentialsFor: async (hotelId: string) => {
        const creds = await ai.getWhatsappCredentials(hotelId)
        // Sin `phoneNumberId` no se puede enviar aunque haya token: el mensaje sale DEL número.
        return creds?.phoneNumberId
          ? { wabaId: creds.wabaId, phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken }
          : null
      },
      sendText: sendTextMessage,
      explicarError: explicarErrorDeEnvio,
    },
    registrarEnvio: async (dto) => { await marketing.createMessageLog(dto as any) },
  })
}
