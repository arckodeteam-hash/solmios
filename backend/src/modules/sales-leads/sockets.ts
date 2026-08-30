// sales-leads/sockets.ts — Hooks OPCIONALES hacia otros módulos.
// Los sockets son opcionales. El módulo funciona sin ellos.
import type { SalesLeadDTO } from './types'

export interface SalesLeadsSockets {
  onSalesLeadCreated?: (data: SalesLeadDTO) => Promise<void>
  onSalesLeadUpdated?: (data: SalesLeadDTO) => Promise<void>
}
