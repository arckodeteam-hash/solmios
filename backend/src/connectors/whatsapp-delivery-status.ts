// connectors/whatsapp-delivery-status.ts — El acuse de entrega de Meta llega a `message_logs`.
//
// El webhook lo recibe `ai-recepcionista`; `message_logs` es tabla de `marketing`. Este connector
// une las dos puntas sin que los módulos se importen entre sí: marketing expone las dos operaciones
// mínimas y acá se arma con ellas el puerto que espera el webhook.

import type { ConnectorContext } from 'arckode-framework'

interface MarketingModuleWithLogs {
  findLogByProviderMessageId(wamid: string): Promise<{ id: string; status?: string } | null>
  updateLogStatus(id: string, patch: { status: string; errorMessage?: string }): Promise<void>
}

interface AiModuleWithDelivery {
  setDeliveryStatusPort(port: {
    findByProviderMessageId(wamid: string): Promise<{ id: string; status?: string } | null>
    updateStatus(id: string, patch: { status: string; errorMessage?: string }): Promise<void>
  }): void
}

export function whatsappDeliveryStatusConnector(ctx: ConnectorContext): void {
  const ai = ctx.resolveModule<AiModuleWithDelivery>('ai-recepcionista')
  const marketing = ctx.resolveModule<MarketingModuleWithLogs>('marketing')

  ai.setDeliveryStatusPort({
    findByProviderMessageId: (wamid) => marketing.findLogByProviderMessageId(wamid),
    updateStatus: (id, patch) => marketing.updateLogStatus(id, patch),
  })
}
