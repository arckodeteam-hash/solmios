// services/SalesPipeline.service.ts — Cliente API del pipeline de ventas (super admin, #147):
//   GET  /api/admin/sales-pipeline                          → {data, total} (SalesPipelineRow[])
//   GET  /api/admin/sales-pipeline/assignees                → {data} (usuarios admin: id, name, email)
//   GET  /api/admin/sales-pipeline/funnel?weeks=8           → SalesFunnelResult (embudo semanal, #151)
//   PUT  /api/admin/sales-pipeline/:key                     → SalesProspect (key = hotel:<id> | lead:<id>)
//   POST /api/admin/subscriptions/:hotelId/extend-trial     → ExtendTrialResult ({days} 1..30)
//
// El GET viene con el envelope de listado del framework (`data` + `meta.pagination.total`); `http`
// lo reconstruye como `{data, total}`.

import { http } from './http'
import type {
  ExtendTrialResult,
  SalesAssigneesResult,
  SalesFunnelResult,
  SalesPipelineResult,
  SalesProspect,
  UpdateSalesProspectInput,
} from '@/types/sales-pipeline'

export const SalesPipelineService = {
  list(): Promise<SalesPipelineResult> {
    return http.get<SalesPipelineResult>('/admin/sales-pipeline')
  },

  /** Responsables posibles: `assignedTo` guarda `users.id`, no texto libre. */
  assignees(): Promise<SalesAssigneesResult> {
    return http.get<SalesAssigneesResult>('/admin/sales-pipeline/assignees')
  },

  /** Embudo semanal (#151): `weeks` 1..26, default 8 en el backend. */
  funnel(weeks = 8): Promise<SalesFunnelResult> {
    return http.get<SalesFunnelResult>(`/admin/sales-pipeline/funnel?weeks=${weeks}`)
  },

  updateProspect(key: string, input: UpdateSalesProspectInput): Promise<SalesProspect> {
    return http.put<SalesProspect>(`/admin/sales-pipeline/${encodeURIComponent(key)}`, input)
  },

  extendTrial(hotelId: string, days: number): Promise<ExtendTrialResult> {
    return http.post<ExtendTrialResult>(`/admin/subscriptions/${encodeURIComponent(hotelId)}/extend-trial`, { days })
  },
}
