// ari-outbox/sockets.ts — Hooks OPCIONALES hacia otros módulos.
// El módulo funciona sin ellos: el drain publica igual y el resultado queda en la fila.
// Un conector puede pasar sockets para reaccionar al cierre de una fila (ej: avisar en la
// pantalla de operación que un push quedó en `failed` con su motivo).
import type { AriOutboxRow } from './types'
import type { QueueConfig } from './usecases/outbox-admin'

export interface AriOutboxSockets {
  onAriOutboxSent?: (row: AriOutboxRow) => Promise<void>
  onAriOutboxFailed?: (row: AriOutboxRow) => Promise<void>
  /**
   * Canal por el que el techo de peticiones/minuto que se guarda desde el Super Admin llega al
   * transporte de Channex, que vive en el módulo `canales`: un módulo no importa de otro, así que
   * el conector escucha acá y le pasa el valor al que hace las peticiones. Se emite al guardar la
   * config y al arrancar (applyQueueConfig), para que el valor persistido rija desde el primer tick.
   */
  onQueueConfigChanged?: (cfg: QueueConfig) => Promise<void>
}
