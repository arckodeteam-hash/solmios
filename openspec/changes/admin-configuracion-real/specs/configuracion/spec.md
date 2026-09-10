# Spec — Configuración de la plataforma (super-admin)

Convención: UI en español, base de datos y API en inglés (RFC 2119: MUST/SHOULD/MAY). Todas las
claves viven en `configuration` con `hotelId = 'platform'`. Ninguna ruta de este spec es accesible
sin `auth.authenticate('super_admin')` + `requireUserType('admin')`.

---

## REQ-CFG-01 — La pantalla no muestra campos sin efecto

La pantalla MUST NOT mostrar un control cuyo valor no sea leído por el backend o por otra vista.
Quedan eliminados: moneda por defecto, zona horaria, dominio personalizado, logo, color primario,
tarjeta Stripe de Integraciones, y la pestaña Facturación entera (método, ciclo, día de cobro, notas
de crédito, descuentos por volumen, descuento anual, impuesto).

**Given** el super-admin en `/admin/settings`
**When** recorre las pestañas
**Then** cada control visible tiene una clave de `configuration` o un endpoint que lo consume, y
`grep` de esa clave en `backend/src` devuelve al menos un lector.

## REQ-CFG-02 — Guardado por pestaña con confirmación específica

Cada pestaña MUST tener su propio botón de guardar que persiste **solo** sus claves y MUST informar
qué guardó ("Identidad de la plataforma guardada", "SMTP guardado"). El botón global "Guardar
Cambios" MUST desaparecer.

**Given** la pestaña Email con SMTP modificado
**When** el admin guarda
**Then** se hace un solo `POST /api/configuracion` con `clave: 'email_config'` y las claves de
otras pestañas no se reescriben.

## REQ-CFG-03 — Identidad de la plataforma

`configuration('plataforma')` MUST contener exactamente `{ platformName, supportEmail,
supportPhone }`. El backend MUST usar estos valores en todo correo de plataforma
(`{platform_name}`, `{support_email}`, `{support_phone}`) y como nombre del remitente cuando
`email_config.fromName` está vacío. La pestaña MUST mostrar dónde se usa cada campo.

**Given** `platformName = 'HotelPro'` y `email_config.fromName = ''`
**When** sale un correo de plataforma
**Then** el `From:` es `HotelPro <email_config.fromEmail>` y el asunto no contiene `{platform_name}`.

## REQ-CFG-04 — Email: Resend y TLS

La pestaña Email MUST permitir cargar la API key de Resend (`configuration('resend_api_key')`, la
clave que `email-service.ts:resolveResendKey` ya lee). El secreto MUST NOT volver al navegador:
`GET` devuelve `{ configured: boolean, last4?: string }`. La pestaña MUST ofrecer el modo seguro
(`secure: true` / puerto 465) que `normalizeSmtpConfig` ya soporta.

El botón "Enviar email de prueba" MUST pedir el destinatario (default: email de soporte) y MUST
reportar el proveedor que envió (`smtp` | `resend`) o el error real.

**Given** SMTP sin host y `resend_api_key` cargada
**When** se envía la prueba
**Then** el correo sale por Resend con el `From:` de `email_config` (o el nombre de la plataforma)
y la UI muestra "Enviado vía resend".

## REQ-CFG-05 — Política de contraseña aplicada

`configuration('security_policy')` MUST tener la forma `{ minLength: number (6..32),
requireUppercase, requireNumbers, requireSpecial: boolean }`. Default: `{ minLength: 6, false,
false, false }` (comportamiento actual).

El backend MUST validar contra esta política en: alta de usuario del hotel, cambio de contraseña,
restablecimiento por link, y registro público. La validación MUST vivir en un solo usecase
(`shared/usecases/password-policy.ts`) que consumen los cuatro flujos; el schema estático
(`usuarios/validators/schema.ts`) conserva `min: 6` como piso.

La UI de cada uno de esos formularios MUST mostrar la regla vigente **antes** de que el usuario
falle (`GET /api/auth/password-policy`, público, sin secretos).

Se elimina "Expiración de contraseña (días)": no hay mecanismo de expiración y no se construye en
este cambio.

**Given** `security_policy = { minLength: 10, requireNumbers: true }`
**When** un `hotel_admin` crea un usuario con clave `abcdefghij`
**Then** recibe 400 con el mensaje "La contraseña debe tener al menos un número" y el usuario no se
crea.

**Given** la misma política
**When** el registro público manda `Abcdefghi1`
**Then** el alta procede.

## REQ-CFG-06 — Protección del alta: estado real, no toggles

La pestaña Seguridad MUST reemplazar la tarjeta "Autenticación" (hoy vacía) por una tarjeta de
**solo lectura** con el estado real de: captcha Turnstile (`TURNSTILE_SECRET` presente), verificación
de email (correo de verificación cableado: `PUBLIC_URL` presente; hoy el alta entra sin verificar y
solo avisa), rate-limit del alta (valor de
`GLOBAL_RATE_MAX` o el default del middleware). Cada fila MUST decir cómo activarla (variable de
entorno y archivo) cuando está apagada.

**Given** `TURNSTILE_SECRET` ausente
**When** el admin abre Seguridad
**Then** ve "Captcha del alta: desactivado — `TURNSTILE_SECRET` en `backend/.env` +
`VITE_TURNSTILE_SITE_KEY` en el build".

## REQ-CFG-07 — Suscripciones (reemplaza a Facturación)

La pestaña "Suscripciones" MUST editar:

- `configuration('trial_days')` → `{ days: number (0..90) }`, default 15. El backend MUST leerlo en
  `signup.ts` y `publicSignupPolicy()` en lugar de la constante `TRIAL_DAYS`; el correo de
  bienvenida y el registro público MUST mostrar el valor leído.
- `configuration('subscription_settings')` → `{ reminderDaysBefore, gracePeriodDays }`, **la misma
  clave** que lee `subscription-suspension-cron.ts`. MUST NOT crearse una clave paralela.
- `requireCardOnTrial` (política de alta): MUST enlazarse a `/admin/subscriptions-founders`, no
  duplicarse.

**Given** `trial_days.days = 30`
**When** un hotel se registra
**Then** `subscription.trialEndsAt` es hoy + 30 días y el correo de bienvenida dice "30 días".

**Given** `trial_days` ausente
**When** un hotel se registra
**Then** el trial dura 15 días (sin cambio de comportamiento).

## REQ-CFG-08 — Estado de servicios por entorno

`GET /api/admin/settings/status` MUST devolver, por servicio, `{ configured: boolean, source:
'env' | 'configuration' }` y MUST NOT incluir ningún valor: Stripe plataforma
(`STRIPE_SECRET_KEY`), webhook Stripe (`STRIPE_WEBHOOK_SECRET`), Turnstile, `PUBLIC_URL`, Meta app
(`META_APP_SECRET`), Resend, SMTP, Google Maps, Channex. La pestaña Integraciones MUST mostrar esta
lista con "Configurado / Falta" y, para los de entorno, la variable que hay que setear.

**Given** el endpoint
**When** se llama como `merchant`
**Then** 403.

**Given** la respuesta
**When** se inspecciona el JSON
**Then** ningún campo contiene más de un booleano y un `source` (test que falla si aparece un
string de más de 20 caracteres).
