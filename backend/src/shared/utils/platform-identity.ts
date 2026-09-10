// platform-identity.ts — Identidad de la plataforma (nombre, correo y teléfono de soporte) tal como
// la carga el super-admin en Configuración → Plataforma (`configuration(hotelId:'platform',
// key:'plataforma')`).
//
// Existe porque el nombre "SolmiOS" estaba hardcodeado en el remitente de Resend, en el asunto del
// email de prueba y en las 10 plantillas de plataforma: el campo "Nombre de la Plataforma" del panel
// se guardaba pero no llegaba a ningún correo. Todo lo que arme un correo de PLATAFORMA lee de acá.
//
// Recibe un `RepositoryAdapter` (no el ORM) para poder usarse desde services sin romper la regla
// cardinal. Nunca tira: sin fila o con fila rota devuelve los defaults.

import type { RepositoryAdapter } from 'arckode-framework'

export interface PlatformIdentity {
  platformName: string
  supportEmail: string
  supportPhone: string
}

export const DEFAULT_PLATFORM_IDENTITY: PlatformIdentity = {
  platformName: 'SolmiOS',
  supportEmail: '',
  supportPhone: '',
}

/**
 * Nombres de placeholder que TODA plantilla de plataforma tiene disponibles, además de las
 * propias del evento. Mismo formato `{snake_case}` que `hotel_name`/`link`.
 */
export const PLATFORM_EMAIL_VARIABLES = ['platform_name', 'support_email', 'support_phone'] as const

type ConfigRow = { value?: unknown }

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown> } catch { return null }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function resolvePlatformIdentity(
  configRepo: Pick<RepositoryAdapter<Record<string, unknown>>, 'findOne'>,
): Promise<PlatformIdentity> {
  try {
    const row = (await configRepo.findOne({ hotelId: 'platform', key: 'plataforma' })) as ConfigRow | null
    const cfg = asRecord(row?.value)
    if (!cfg) return { ...DEFAULT_PLATFORM_IDENTITY }
    return {
      platformName: str(cfg.platformName) || DEFAULT_PLATFORM_IDENTITY.platformName,
      supportEmail: str(cfg.supportEmail),
      supportPhone: str(cfg.supportPhone),
    }
  } catch {
    return { ...DEFAULT_PLATFORM_IDENTITY }
  }
}

/** Variables `{platform_name}`, `{support_email}`, `{support_phone}` listas para `renderTemplate`. */
export function platformEmailVariables(identity: PlatformIdentity): Record<string, string> {
  return {
    platform_name: identity.platformName,
    support_email: identity.supportEmail,
    support_phone: identity.supportPhone,
  }
}
