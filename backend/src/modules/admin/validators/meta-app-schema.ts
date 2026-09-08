// admin/validators/meta-app-schema.ts
import type { ValidationRule } from 'arckode-framework'

/**
 * Credenciales de la app de Meta. `appId` es público; `appSecret` es el que firma los webhooks.
 * El mínimo de 16 evita guardar por error un recorte del secreto o un texto cualquiera.
 */
export const MetaAppConfigSchema: Record<string, ValidationRule> = {
  appId: { type: 'string' as const, max: 50 },
  appSecret: { type: 'string' as const, required: true, min: 16, max: 200 },
}
