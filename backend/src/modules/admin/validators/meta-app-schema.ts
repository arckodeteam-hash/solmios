// admin/validators/meta-app-schema.ts
import type { ValidationRule } from 'arckode-framework'

/**
 * Credenciales de la app de Meta. `appId` es público; `appSecret` es el que firma los webhooks;
 * `webhookVerifyToken` es la contraseña del GET de alta de la URL (`hub.verify_token`).
 * Ninguno es obligatorio en el PUT: cada campo vacío conserva lo guardado. Que venga al menos uno
 * de los dos lo exige el usecase (`guardarMetaApp`). Los mínimos evitan guardar un recorte o un
 * texto cualquiera.
 */
export const MetaAppConfigSchema: Record<string, ValidationRule> = {
  appId: { type: 'string' as const, max: 50 },
  appSecret: { type: 'string' as const, min: 16, max: 200 },
  webhookVerifyToken: { type: 'string' as const, min: 8, max: 200 },
}
