// deletion-requests/types.ts — Contratos de API del módulo (≠ model.ts, que es BD).

export const DELETION_REQUEST_STATUSES = ['received', 'verifying', 'completed', 'rejected'] as const
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number]

export const STATUS_LABELS: Record<DeletionRequestStatus, string> = {
  received: 'Recibida',
  verifying: 'Verificando identidad',
  completed: 'Completada',
  rejected: 'Rechazada',
}

/** Fila completa — solo para el admin. */
export interface DeletionRequestDTO {
  id: string
  requestNumber: string
  fullName: string
  contactHandle: string
  hotelName: string | null
  status: DeletionRequestStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** Lo que llena el huésped en /p/eliminacion-datos. */
export interface CreateDeletionRequestDTO {
  fullName: string
  contactHandle: string
  hotelName?: string
}

/** Lo que puede tocar el admin: solo status/notes (nunca los datos del solicitante). */
export interface UpdateDeletionRequestDTO {
  status?: DeletionRequestStatus
  notes?: string
}

/** Respuesta pública al enviar el formulario: el acuse de recibo, nada más. */
export interface DeletionRequestAck {
  requestNumber: string
}

export interface DeletionRequestListResult {
  data: DeletionRequestDTO[]
  total: number
}
