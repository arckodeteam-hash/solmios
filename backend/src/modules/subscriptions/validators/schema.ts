import type { ValidationRule } from 'arckode-framework'
import { PASSWORD_MAX } from '../../../shared/password-policy'
import { EMAIL_MAX } from '../../../shared/email'

// Los `max` de acá son el tope duro de entrada: recortan antes de tocar la base
// y deben coincidir con los `maxlength` del formulario (pages/auth/register.vue).
// El formulario evita que se escriba de más; esto evita que alguien lo saltee.
//
// La fuerza de la contraseña NO se valida acá: `min` solo mide largo y el
// mensaje de error del framework es genérico. La revisa el usecase con
// shared/password-policy, que devuelve los motivos concretos en español.
// Nota sobre los mensajes: el validador del framework usa `rule.message` solo
// para `pattern` y `email`; para `min`/`max` emite un texto fijo en inglés
// ("Minimum 10 characters"). Como la UI es en español, donde hace falta un
// mensaje legible se expresa el mínimo como `pattern` con su `message`, o se
// deja la comprobación al usecase, que responde en español.
export const SignupSchema: Record<string, ValidationRule> = {
  hotelName: {
    type: 'string' as const, required: true, max: 120,
    pattern: /^[\s\S]{2,}$/,
    message: 'El nombre del hotel debe tener al menos 2 caracteres',
  },
  // `email` y no `string`: como string, "a@" pasaba la validación.
  email: {
    type: 'email' as const, required: true, max: EMAIL_MAX,
    message: 'Escribí un email válido, con dominio completo',
  },
  // Sin `min`: la longitud la valida shared/password-policy en el usecase, que
  // devuelve TODOS los motivos en español ("Debe incluir una letra mayúscula")
  // en vez del "Minimum 10 characters" genérico. `max` sí queda acá: es el tope
  // defensivo contra hashear una contraseña enorme, y tiene que cortar antes.
  password: { type: 'string' as const, required: true, max: PASSWORD_MAX },
  ownerName: { type: 'string' as const, max: 120 },
  phone: { type: 'string' as const, max: 40 },
  // `country` DEBE estar declarado acá: validateSchema devuelve únicamente los
  // campos del schema, así que un campo que el formulario manda pero el schema
  // no declara se pierde antes de llegar al usecase, sin error.
  country: { type: 'string' as const, max: 80 },
  address: { type: 'string' as const, max: 200 },
  // CS-3: obligatorio y NO vacío. Un alta sin plan creaba una suscripción trialing con
  // planId vacío y el gate la resolvía como "sin matriz" → el hotel entraba con TODO el
  // panel. `required` solo cubre undefined/null; el pattern /\S/ ataja el string vacío
  // (se evalúa sobre el valor saneado/trimmeado). Mensaje legible: si /registro no cargó
  // los planes, el usuario tiene que saber QUÉ falta, no "planId is required".
  planId: {
    type: 'string' as const, required: true, max: 60,
    pattern: /\S/,
    message: 'Elegí un plan para empezar tu prueba',
  },
  // Código de referido (`/r/:code`). Mismo motivo que el comentario de `country` arriba:
  // si no está declarado acá, validateSchema lo descarta antes de llegar al usecase.
  referralCode: { type: 'string' as const, max: 40 },
  // Token del captcha (Cloudflare Turnstile). Opcional en el schema porque el
  // backend solo lo exige cuando hay secret configurado; lo verifica el
  // controller antes de crear nada.
  captchaToken: { type: 'string' as const, max: 4096 },
}

/** POST /api/subscriptions/checkout — a qué plan se quiere suscribir el hotel logueado. */
export const CheckoutSchema: Record<string, ValidationRule> = {
  planId: { type: 'string' as const, required: true, max: 60 },
}

/**
 * #28 — retomar el Checkout del alta. Son credenciales, así que el schema solo mide forma y tope:
 * quién es y si puede se decide en el service (`resumeCheckout`), que responde el mismo error
 * genérico para todos los fallos.
 */
export const ResumeCheckoutSchema: Record<string, ValidationRule> = {
  email: { type: 'email' as const, required: true, max: EMAIL_MAX },
  password: { type: 'string' as const, required: true, max: PASSWORD_MAX },
}
