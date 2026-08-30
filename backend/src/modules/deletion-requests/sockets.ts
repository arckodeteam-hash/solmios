// deletion-requests/sockets.ts — Hooks OPCIONALES hacia otros módulos.
// Los sockets son opcionales. El módulo funciona sin ellos.
import type { DeletionRequestDTO } from './types'

export interface DeletionRequestsSockets {
  onDeletionRequestCreated?: (data: DeletionRequestDTO) => Promise<void>
  onDeletionRequestUpdated?: (data: DeletionRequestDTO) => Promise<void>
}
