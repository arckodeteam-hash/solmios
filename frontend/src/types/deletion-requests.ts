// types/deletion-requests.ts — Espejo del contract del módulo backend deletion-requests
// (solicitudes de eliminación de datos, formulario público de /p/eliminacion-datos).

export const DELETION_REQUEST_STATUSES = ['received', 'verifying', 'completed', 'rejected'] as const
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number]

export const STATUS_LABELS: Record<DeletionRequestStatus, string> = {
  received: 'Recibida',
  verifying: 'Verificando identidad',
  completed: 'Completada',
  rejected: 'Rechazada',
}

export interface DeletionRequest {
  id: string
  requestNumber: string
  fullName: string
  contactHandle: string
  email: string | null
  hotelName: string | null
  status: DeletionRequestStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface DeletionRequestListResult {
  data: DeletionRequest[]
  total: number
}

export interface UpdateDeletionRequestInput {
  status?: DeletionRequestStatus
  notes?: string
}

// ── Público (formulario de /p/eliminacion-datos, sin auth) ──
export interface CreateDeletionRequestInput {
  fullName: string
  contactHandle: string
  hotelName?: string
  /** Opcional — sin esto no hay a quién mandarle el acuse de recibo por correo. */
  email?: string
}

export interface DeletionRequestAck {
  requestNumber: string
}
