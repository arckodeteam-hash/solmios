// services/DeletionRequests.service.ts — Cliente API del módulo backend `deletion-requests`
// (solicitudes de eliminación de datos personales, Ley 172-13):
//   GET    /api/deletion-requests            → {data, total} — admin
//   PUT    /api/deletion-requests/:id        → DeletionRequest — admin (solo status/notes)
//   DELETE /api/deletion-requests/:id        → 204 — admin
//   POST   /api/public/deletion-requests     → {requestNumber} — público, sin auth

import { http } from './http'
import type {
  DeletionRequest,
  DeletionRequestListResult,
  UpdateDeletionRequestInput,
  CreateDeletionRequestInput,
  DeletionRequestAck,
} from '@/types/deletion-requests'

export const DeletionRequestsService = {
  list(): Promise<DeletionRequestListResult> {
    return http.get<DeletionRequestListResult>('/deletion-requests')
  },

  update(id: string, input: UpdateDeletionRequestInput): Promise<DeletionRequest> {
    return http.put<DeletionRequest>(`/deletion-requests/${id}`, input)
  },

  remove(id: string): Promise<void> {
    return http.delete<void>(`/deletion-requests/${id}`)
  },
}

// ── Público (sin auth, rate-limited) — lo consume el formulario de /p/eliminacion-datos ──
export const PublicDeletionRequests = {
  create(input: CreateDeletionRequestInput): Promise<DeletionRequestAck> {
    return http.post<DeletionRequestAck>('/public/deletion-requests', input)
  },
}
