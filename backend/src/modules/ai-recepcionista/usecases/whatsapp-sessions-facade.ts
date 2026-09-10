// ai-recepcionista/usecases/whatsapp-sessions-facade.ts — Fachada de la sesión legacy por QR.
//
// Las cinco operaciones que el panel expone sobre Baileys (iniciar, reconectar, detener, QR y
// estado) vivían sueltas en el service, cada una armando a mano su import dinámico y su bolsa de
// repos. Acá quedan juntas y el service se limita a delegar — el mismo motivo por el que ya se
// había extraído `whatsapp-sessions-auto.ts`: la fachada crecía sobre el límite del analyzer.
//
// Es LEGACY: no se construye nada nuevo sobre esto. Ver la nota de Baileys en CLAUDE.md.

import { autoReconnectSessions, type AutoReconnectDeps } from './whatsapp-sessions-auto'

/** Las mismas deps que la reconexión automática: es el mismo socket con las mismas piezas. */
export type SesionLegacyDeps = AutoReconnectDeps

/**
 * Levanta la sesión del hotel y devuelve el QR para escanear. El import es dinámico porque
 * `whatsapp-sessions` arrastra el cliente de Baileys, que no tiene por qué cargarse en un
 * arranque donde ningún hotel usa esta vía.
 */
export async function iniciarSesionLegacy(deps: SesionLegacyDeps, hotelId: string): Promise<{ qr: string | null; status: string }> {
  const { beginSession } = await import('./whatsapp-sessions')
  const config = (await deps.configRepo.findMany({ hotelId }))[0] || null
  return beginSession(
    hotelId, config, deps.configRepo, deps.conversationRepo, deps.messageRepo, deps.intentRepo,
    deps.sockets, deps.cache, deps.logger, deps.procesar, deps.conversacion,
  )
}

/** Reconecta las sesiones legacy que estaban activas antes del reinicio. */
export const reconectarSesionesLegacy = (deps: SesionLegacyDeps): Promise<void> => autoReconnectSessions(deps)

export async function detenerSesionLegacy(configRepo: any, hotelId: string): Promise<{ success: boolean }> {
  return (await import('./whatsapp-sessions')).endSession(hotelId, configRepo)
}

export async function qrSesionLegacy(hotelId: string): Promise<{ qr: string | null; status: string }> {
  return (await import('./whatsapp-sessions')).getQRSync(hotelId)
}

export async function estadoSesionLegacy(configRepo: any, hotelId: string): Promise<{ status: string; phone: string | null; mode: string }> {
  return (await import('./whatsapp-sessions')).getStatusSync(hotelId, configRepo)
}
