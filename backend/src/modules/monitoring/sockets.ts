// monitoring/sockets.ts — Hooks OPCIONALES hacia otros módulos.
// El módulo funciona sin ellos. Un conector puede engancharse para reaccionar a un backup nuevo
// (ej: avisar por notificaciones que se creó, o subirlo a un almacenamiento externo cuando exista).
import type { BackupCreated } from './types'

export interface MonitoringSockets {
  onBackupCreated?: (created: BackupCreated) => Promise<void>
}
