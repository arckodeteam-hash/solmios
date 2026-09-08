// ai-recepcionista/usecases/whatsapp-usage-deps.ts — Arma las dependencias del consumo.
//
// Vive fuera del service por el mismo motivo que `whatsapp-connection-deps`: el service delega y no
// tiene por qué conocer cómo se construye cada pieza.

import { ConflictError } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import type { UsageDeps } from './whatsapp-usage'

export function usageDepsDe(puertos: Omit<UsageDeps, 'logger'> | null, logger: Logger): UsageDeps {
  // `null` significa que el connector no corrió: es una falla de despliegue, no del hotel.
  if (!puertos) throw new ConflictError('El consumo de WhatsApp no está disponible en este servidor.')
  return { logger, ...puertos }
}
