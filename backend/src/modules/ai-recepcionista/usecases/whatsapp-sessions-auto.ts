// ai-recepcionista/usecases/whatsapp-sessions-auto.ts — Reconexión de las sesiones legacy (QR).
//
// Al reiniciar el servidor, las sesiones de Baileys se pierden: son un socket vivo, no un token.
// Esto las vuelve a levantar para los hoteles que todavía usan esa vía. Movido acá tal cual estaba
// en el service, que había pasado el límite de tamaño del analyzer.
//
// Es LEGACY: no se construye nada nuevo sobre esto. Ver la nota de Baileys en CLAUDE.md.

import type { Logger } from 'arckode-framework'

export interface AutoReconnectDeps {
  configRepo: any
  conversationRepo: any
  messageRepo: any
  intentRepo: any
  sockets: any
  cache: any
  logger: Logger
  procesar: (conversationId: string, texto: string, hotelId: string) => Promise<unknown>
  conversacion: (dto: any) => Promise<any>
}

export async function autoReconnectSessions(deps: AutoReconnectDeps): Promise<void> {
  const { beginSession } = await import('./whatsapp-sessions')
  const configs = await deps.configRepo.findMany({})

  for (const cfg of configs) {
    if (cfg.connectionMode !== 'baileys' || !cfg.baileysCredentials) continue
    deps.logger.info('Reconectando sesión legacy de WhatsApp', { hotelId: cfg.hotelId })
    try {
      await beginSession(
        cfg.hotelId, cfg, deps.configRepo, deps.conversationRepo, deps.messageRepo, deps.intentRepo,
        deps.sockets, deps.cache, deps.logger, deps.procesar, deps.conversacion,
      )
    } catch (e: any) {
      // Que un hotel no reconecte no puede frenar a los demás ni tumbar el arranque.
      deps.logger.warn('No se pudo reconectar la sesión legacy', { hotelId: cfg.hotelId, error: e?.message })
    }
  }
}
