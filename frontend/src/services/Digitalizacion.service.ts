// services/Digitalizacion.service.ts — Cliente API del módulo backend `digitalizacion`
// (expediente de digitalización de hoteles sin presencia digital). Todas las rutas son del
// super_admin — no hay variante pública:
//   GET    /api/digitalizacion              → {data, total}
//   GET    /api/digitalizacion/candidatos   → {data} — hoteles sin web y sin expediente vivo
//   GET    /api/digitalizacion/plantillas   → {data} — catálogo de plantillas de la página
//   GET    /api/digitalizacion/:id          → DigitalizationCase
//   POST   /api/digitalizacion              → DigitalizationCase (201) — abrir expediente
//   PUT    /api/digitalizacion/:id          → DigitalizationCase — editar expediente
//   POST   /api/digitalizacion/:id/paso     → DigitalizationCase — avanzar un paso
//   DELETE /api/digitalizacion/:id          → 204

import { http } from './http'
import type {
  AdvanceStepInput,
  CreateDigitalizationCaseInput,
  DigitalizationCandidate,
  DigitalizationCase,
  DigitalizationListResult,
  SiteTemplate,
  UpdateDigitalizationCaseInput,
} from '@/types/digitalizacion'

export const DigitalizacionService = {
  list(): Promise<DigitalizationListResult> {
    return http.get<DigitalizationListResult>('/digitalizacion')
  },

  candidates(): Promise<{ data: DigitalizationCandidate[] }> {
    return http.get<{ data: DigitalizationCandidate[] }>('/digitalizacion/candidatos')
  },

  templates(): Promise<{ data: SiteTemplate[] }> {
    return http.get<{ data: SiteTemplate[] }>('/digitalizacion/plantillas')
  },

  getById(id: string): Promise<DigitalizationCase> {
    return http.get<DigitalizationCase>(`/digitalizacion/${id}`)
  },

  create(input: CreateDigitalizationCaseInput): Promise<DigitalizationCase> {
    return http.post<DigitalizationCase>('/digitalizacion', input)
  },

  update(id: string, input: UpdateDigitalizationCaseInput): Promise<DigitalizationCase> {
    return http.put<DigitalizationCase>(`/digitalizacion/${id}`, input)
  },

  advanceStep(id: string, input: AdvanceStepInput): Promise<DigitalizationCase> {
    return http.post<DigitalizationCase>(`/digitalizacion/${id}/paso`, input)
  },

  remove(id: string): Promise<void> {
    return http.delete<void>(`/digitalizacion/${id}`)
  },
}
