// shared/utils/platform-identity.ts — Identidad de la PLATAFORMA (nombre, email y teléfono de soporte).
//
// Vive en `shared` y no en un módulo porque lo necesitan DOS que no se pueden importar entre sí:
// `services/email-service.ts` (el From de Resend, el asunto del email de prueba y el fromName SMTP
// cuando el admin lo deja vacío) y `modules/platform-emails` (las variables {platform_name},
// {support_email}, {support_phone} de cada plantilla). Mismo precedente que `rate-plans.ts`.
//
// CFG-1: el super-admin guarda el nombre de la plataforma en /admin/settings, pero los correos
// salían con 'SolmiOS' escrito a mano en el código y en las plantillas seedeadas. Acá se lee la
// fila configuration(key='plataforma', hotelId='platform') que persiste ese formulario
// (`{platformName, supportEmail, supportPhone, currency, timezone, customDomain}`) y se
// normaliza a un shape mínimo con defaults campo a campo: un campo vacío o con tipo raro cae a
// su default sin arrastrar a los demás. Nunca tira — un envío de email no puede fallar porque
// la config esté rota o la base no responda.

export interface PlatformIdentity {
  platformName: string
  supportEmail: string
  supportPhone: string
}

export const DEFAULT_PLATFORM_IDENTITY: PlatformIdentity = {
  platformName: 'SolmiOS',
  supportEmail: 'soporte@solmios.com',
  supportPhone: '',
}

/** Key y scope bajo los que /admin/settings persiste el formulario de plataforma. */
export const PLATFORM_IDENTITY_QUERY = { hotelId: 'platform', key: 'plataforma' } as const

/** String trimmeado si `raw` es un string no vacío; si no, el default del campo. */
function pickString(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : fallback
}

/**
 * Lee configuration(key='plataforma', hotelId='platform'). Nunca tira: si falta la fila, el
 * JSON está roto o `findOne` rechaza → defaults. `findOne` tiene el mismo contrato que
 * `RepositoryAdapter.findOne` (recibe el where y devuelve la fila o null); `value` puede venir
 * como string JSON (SQLite) o ya como objeto.
 */
export async function readPlatformIdentity(
  findOne: (query: Record<string, unknown>) => Promise<unknown>,
): Promise<PlatformIdentity> {
  try {
    const row = await findOne({ ...PLATFORM_IDENTITY_QUERY })
    const raw = (row as { value?: unknown } | null | undefined)?.value
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_PLATFORM_IDENTITY }
    const cfg = parsed as Record<string, unknown>
    return {
      platformName: pickString(cfg.platformName, DEFAULT_PLATFORM_IDENTITY.platformName),
      supportEmail: pickString(cfg.supportEmail, DEFAULT_PLATFORM_IDENTITY.supportEmail),
      supportPhone: pickString(cfg.supportPhone, DEFAULT_PLATFORM_IDENTITY.supportPhone),
    }
  } catch {
    return { ...DEFAULT_PLATFORM_IDENTITY }
  }
}

/** Variables para `renderTemplate`: `{platform_name}`, `{support_email}`, `{support_phone}`. */
export function platformVariables(identity: PlatformIdentity): Record<string, string> {
  return {
    platform_name: identity.platformName,
    support_email: identity.supportEmail,
    support_phone: identity.supportPhone,
  }
}
