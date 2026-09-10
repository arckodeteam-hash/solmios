// site-pages/usecases/platform-contact.ts — Contacto público de la PLATAFORMA (REQ-PIPE-07, #148).
//
// La landing de SolmiOS tenía "Prueba gratis" y "Hablar con Ventas" (0 usos). El hotelero de
// RD/LatAm escribe por WhatsApp; este usecase arma el enlace `wa.me` a partir del teléfono de
// soporte que el super-admin carga en Configuración → Plataforma (`configuration('plataforma')`).
//
// Devuelve `null` cuando no hay número o no se puede llevar a E.164: el botón flotante NO se
// renderiza (mejor sin botón que un botón que abre un chat con nadie — ya pasó en
// `pages/technical-providers/index.vue`). No crea `sales_leads`: no hay datos del visitante.
import type { RepositoryAdapter } from 'arckode-framework'
import { resolvePlatformIdentity, type PlatformIdentity } from '../../../shared/utils/platform-identity'
import { toE164 } from '../../../shared/utils/phone-e164'

export interface PlatformContact {
  whatsappUrl: string | null
}

/**
 * País que se asume cuando el teléfono de soporte viene sin prefijo (`809-555-0000`).
 * La plataforma opera desde República Dominicana; `configuration('plataforma')` no guarda país.
 * Un número con `+` explícito se respeta tal cual (ver `toE164`).
 */
export const PLATFORM_DEFAULT_COUNTRY = 'DO'

/** Texto prellenado del chat. `{platform_name}` sale de la misma configuración, no de un literal. */
export function whatsappGreeting(platformName: string): string {
  return `Hola, quiero información sobre ${platformName} para mi hotel`
}

/** Función pura: identidad → enlace `wa.me` o `null`. Testeable sin repo. */
export function buildPlatformWhatsappUrl(identity: PlatformIdentity): string | null {
  const e164 = toE164(identity.supportPhone, PLATFORM_DEFAULT_COUNTRY)
  if (!e164) return null
  return `https://wa.me/${e164}?text=${encodeURIComponent(whatsappGreeting(identity.platformName))}`
}

export async function resolvePlatformContact(
  configRepo: Pick<RepositoryAdapter<Record<string, unknown>>, 'findOne'>,
): Promise<PlatformContact> {
  const identity = await resolvePlatformIdentity(configRepo)
  return { whatsappUrl: buildPlatformWhatsappUrl(identity) }
}
