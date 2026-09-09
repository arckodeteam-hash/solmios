// connectors/marketing-whatsapp-meta.ts — Le da a `marketing` acceso a la cuenta de WhatsApp del hotel.
//
// Las plantillas viven en `marketing`; las credenciales de WhatsApp (WABA ID + token), en la
// configuración del módulo `ai-recepcionista`. Los módulos no se importan entre sí, así que este
// connector es el único punto donde las dos cosas se tocan: marketing declara el puerto
// (`MetaWhatsappCredentialsPort`) y acá se enchufa la implementación real, junto con el cliente HTTP
// de Meta.
//
// El token NUNCA sale de este camino hacia el navegador: `marketing` lo usa para firmar la llamada a
// Meta y no lo devuelve en ninguna respuesta.

import type { ConnectorContext } from 'arckode-framework'
import { createMetaTemplate, getMetaTemplateStatus } from '../services/whatsapp-cloud-client'
import type { WhatsappCloudCredentials } from '../services/whatsapp-cloud-client'

interface AiRecepcionistaModule {
  getWhatsappCredentials(hotelId: string): Promise<{ wabaId: string; accessToken: string; phoneNumberId: string } | null>
}

interface MarketingModuleWithMeta {
  setMetaCredsDeps(deps: {
    credentials: { getMetaCredentials(hotelId: string): Promise<WhatsappCloudCredentials | null> }
    client: { create: typeof createMetaTemplate; getStatus: typeof getMetaTemplateStatus }
  }): void
}

export function marketingWhatsappMetaConnector(ctx: ConnectorContext): void {
  const marketing = ctx.resolveModule<MarketingModuleWithMeta>('marketing')
  const ai = ctx.resolveModule<AiRecepcionistaModule>('ai-recepcionista')

  marketing.setMetaCredsDeps({
    credentials: {
      getMetaCredentials: async (hotelId: string): Promise<WhatsappCloudCredentials | null> => {
        const creds = await ai.getWhatsappCredentials(hotelId)
        return creds
          ? { wabaId: creds.wabaId, accessToken: creds.accessToken, phoneNumberId: creds.phoneNumberId }
          : null
      },
    },
    client: { create: createMetaTemplate, getStatus: getMetaTemplateStatus },
  })
}
