// ari-outbox/sockets.ts — Hooks OPCIONALES hacia otros módulos.
// El módulo funciona sin ellos: el drain publica igual y el resultado queda en la fila.
// Un conector puede pasar sockets para reaccionar al cierre de una fila (ej: avisar en la
// pantalla de operación que un push quedó en `failed` con su motivo).
import type { AriOutboxRow } from './types'

export interface AriOutboxSockets {
  onAriOutboxSent?: (row: AriOutboxRow) => Promise<void>
  onAriOutboxFailed?: (row: AriOutboxRow) => Promise<void>
}
