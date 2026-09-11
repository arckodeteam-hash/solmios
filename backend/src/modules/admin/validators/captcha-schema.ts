// admin/validators/captcha-schema.ts
import type { ValidationRule } from 'arckode-framework'
import { CAPTCHA_PROVIDERS } from '../../../infrastructure/captcha'

/**
 * Configuración del captcha del alta pública (#12).
 *
 * `secret` NO es `required`: la pantalla nunca muestra el secreto guardado, así que un guardado que
 * sólo cambia el interruptor o el proveedor llega sin él y debe conservar el que ya está.
 * El mínimo de 8 evita persistir un recorte o un texto cualquiera cuando sí viene.
 */
export const CaptchaConfigSchema: Record<string, ValidationRule> = {
  enabled: { type: 'boolean' as const },
  provider: { type: 'string' as const, enum: [...CAPTCHA_PROVIDERS] },
  siteKey: { type: 'string' as const, max: 200 },
  secret: { type: 'string' as const, min: 8, max: 200 },
  // Alcance por pantalla. `login` arranca apagado: la app móvil entra por el mismo endpoint sin token.
  register: { type: 'boolean' as const },
  login: { type: 'boolean' as const },
}
