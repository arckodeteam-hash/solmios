// connectors/reservas-whatsapp.ts — Le da a `reservas` la capacidad de mandar WhatsApp por Meta.
//
// Las credenciales de cada hotel viven en `ai-recepcionista`; el cliente HTTP, en services/. Los
// módulos no se importan entre sí, así que este connector es el único punto donde se juntan.
// El token nunca sale hacia el navegador: `reservas` lo usa para firmar la llamada y no lo devuelve.

import type { ConnectorContext } from 'arckode-framework'
import { sendTemplateMessage, sendTextMessage, explicarErrorDeEnvio } from '../services/whatsapp-cloud-client'

interface AiRecepcionistaModule {
  getWhatsappCredentials(hotelId: string): Promise<{ wabaId: string; accessToken: string; phoneNumberId: string } | null>
}

interface ReservasModuleWithWhatsapp {
  setWhatsappPort(port: {
    credentialsFor(hotelId: string): Promise<{ wabaId: string; phoneNumberId: string; accessToken: string } | null>
    sendTemplate: typeof sendTemplateMessage
    sendText: typeof sendTextMessage
    explicarError: typeof explicarErrorDeEnvio
  }): void
}

export function reservasWhatsappConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<ReservasModuleWithWhatsapp>('reservas')
  const ai = ctx.resolveModule<AiRecepcionistaModule>('ai-recepcionista')

  reservas.setWhatsappPort({
    credentialsFor: async (hotelId: string) => {
      const creds = await ai.getWhatsappCredentials(hotelId)
      // Sin `phoneNumberId` no se puede enviar aunque haya token: el envío sale DEL número.
      return creds?.phoneNumberId
        ? { wabaId: creds.wabaId, phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken }
        : null
    },
    sendTemplate: sendTemplateMessage,
    sendText: sendTextMessage,
    explicarError: explicarErrorDeEnvio,
  })
}
