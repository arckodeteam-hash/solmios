import type { AiWhatsappConfigDTO, CreateAiWhatsappConfigDTO } from '../types'

/** Reads the single WhatsApp config row for a hotel (one per hotel). */
export async function getWhatsappConfig(repo: any, hotelId: string): Promise<AiWhatsappConfigDTO | null> {
  const configs = await repo.findMany({ hotelId })
  return configs[0] || null
}

/** Upserts the WhatsApp config: updates the existing row or creates a new one with defaults. */
export async function updateWhatsappConfig(
  repo: any,
  hotelId: string,
  dto: CreateAiWhatsappConfigDTO,
): Promise<AiWhatsappConfigDTO> {
  const existing = (await repo.findMany({ hotelId }))[0]
  if (existing) {
    const updated = await repo.update(existing.id, { ...dto, isActive: 1 } as any)
    return updated!
  }
  return repo.create({
    id: crypto.randomUUID(), hotelId,
    phoneNumberId: dto.phoneNumberId, wabaId: dto.wabaId || null,
    accessToken: dto.accessToken, verifyToken: dto.verifyToken,
    webhookUrl: null, isActive: 1,
    businessHoursStart: dto.businessHoursStart || '08:00',
    businessHoursEnd: dto.businessHoursEnd || '22:00',
    businessDays: dto.businessDays || [1, 2, 3, 4, 5, 6, 7],
    outsideHoursMessage: dto.outsideHoursMessage || null,
    autoReplyDelay: dto.autoReplyDelay || 1000, maxAutoRetries: dto.maxAutoRetries || 3,
    transferAgentPhone: dto.transferAgentPhone || null,
    dailyMessageLimit: dto.dailyMessageLimit || 1000,
  } as any)
}

/**
 * Quita los SECRETOS de la config antes de devolverla al cliente (IA-C1).
 *
 * `getWhatsappConfig`/`updateWhatsappConfig` devolvían la fila entera por GET/PUT, con el
 * `accessToken` de WhatsApp, el `llmApiKey` y TODO el bundle de credenciales de Baileys en claro
 * → cualquiera con `ai:edit` secuestraba la sesión de WhatsApp del hotel. Estos valores nunca
 * deben salir del servidor. Se reemplazan por flags `hasX` para que el frontend sepa si están
 * configurados sin verlos. Los consumidores INTERNOS (pipeline LLM, sesión Baileys) usan el repo
 * directo, no esta proyección.
 */
export function redactWhatsappConfig(config: any): any {
  if (!config) return null
  const { accessToken, verifyToken, baileysCredentials, llmApiKey, ...safe } = config
  return {
    ...safe,
    hasAccessToken: !!accessToken,
    hasVerifyToken: !!verifyToken,
    hasBaileysCredentials: !!baileysCredentials,
    hasLlmApiKey: !!llmApiKey,
  }
}

/** Credenciales de la cuenta de WhatsApp del hotel, tal como las guardó la conexión. */
export interface WhatsappCredentials {
  wabaId: string
  accessToken: string
  phoneNumberId: string
}

/**
 * Devuelve las credenciales EN CLARO para uso interno del servidor (hoy: el módulo `marketing`,
 * que las necesita para crear plantillas en Meta a nombre del hotel).
 *
 * Es lo contrario de `redactWhatsappConfig`, y a propósito: esta salida NUNCA va al navegador.
 * Solo se alcanza desde un connector, nunca desde una ruta HTTP. `null` cuando el hotel todavía
 * no conectó su WhatsApp — quien llama debe tratarlo como "no conectado", no como un error.
 */
export async function getWhatsappCredentials(repo: any, hotelId: string): Promise<WhatsappCredentials | null> {
  if (!hotelId) return null
  const config = await getWhatsappConfig(repo, hotelId)
  if (!config?.accessToken || !config?.wabaId) return null
  return {
    wabaId: String(config.wabaId),
    accessToken: String(config.accessToken),
    phoneNumberId: String((config as any).phoneNumberId ?? ''),
  }
}
