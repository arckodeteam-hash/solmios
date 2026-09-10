# admin-configuracion-real

## Intent

Que `/admin/settings` (Configuración del super-admin) **contenga solo cosas que el sistema lee**, y
que todo lo que muestre se pueda guardar y tenga efecto. Hoy la pantalla mezcla tres cosas: campos
reales (SMTP, Google Maps, Meta, Channex), campos que se guardan y nadie lee (moneda, zona horaria,
dominio), y campos que **ni siquiera se guardan** (toda la pestaña Seguridad, toda la pestaña
Facturación, el logo, el color de marca, la tarjeta de Stripe). El super-admin no tiene forma de
distinguirlos: cambia un valor, aprieta "Guardar Cambios", ve el toast, y nada pasa.

Referencia MisterPlan: no aplica — es la configuración del operador del SaaS, no del hotel.

## Para qué sirve esta pantalla (y qué no es)

Es la **configuración del operador de la plataforma** (SolmiOS Corp), no de un hotel. Lo que un
hotel configura (impuestos, moneda, pasarela de pago, WhatsApp, horarios) vive en `/panel/config/*`.
Acá va lo que aplica a **todos** los hoteles a la vez: identidad de la plataforma, cómo salen los
correos que SolmiOS le manda al dueño del hotel, credenciales de servicios que la plataforma opera en
nombre de todos (app de Meta, Google Maps, Channex), y la política de acceso.

## El problema, con evidencia

`frontend/src/pages/super-admin/settings.vue` (421 líneas). `saveSettings()` (líneas ~380-397)
persiste **solo cuatro claves**: `plataforma` (6 campos), `email_config`, `integraciones` y
`google_maps`. Todo lo demás que se ve en pantalla queda en memoria del navegador.

| Pestaña | Campo | Se guarda | Lo lee alguien | Evidencia |
|---|---|---|---|---|
| Plataforma | Nombre / Email soporte / Tel. soporte | ✅ `plataforma` | ✅ desde 2026-09-09: correos de plataforma (`shared/utils/platform-identity.ts`). Antes nadie. | `grep -rn "'plataforma'" backend/src` → solo `platform-identity.ts` y el connector de admin |
| Plataforma | Moneda por defecto | ✅ | ❌ nadie. Los planes tienen su propia `currency` (`shared/models.ts:31`), cada hotel la suya | `grep -rn "\.currency" backend/src` no toca `plataforma` |
| Plataforma | Zona horaria | ✅ | ❌ nadie. Los crons corren en la TZ del servidor; cada hotel tiene la suya | idem |
| Plataforma | Dominio personalizado | ✅ | ❌ nadie. El dominio es DNS + nginx, no un setting | idem |
| Plataforma | Logo → "Cambiar Logo" | — | ❌ botón **sin handler** | `settings.vue:39` |
| Plataforma | Color primario | ❌ (`saveSettings` no lo incluye) | ❌ | `settings.vue:44,382` |
| Email | SMTP (host/puerto/usuario/clave/remitente) | ✅ `email_config` | ✅ `services/email-service.ts:resolveSmtpConfig` | — |
| Email | Plantillas de Email | — | Leía `configuration('email_templates')`, clave que **nadie escribe** → tarjeta vacía en prod. **Corregido en local 2026-09-09** (lee `/admin/platform-emails`), pendiente de deploy | `settings.vue:245` (versión prod) |
| Email | API key de Resend | **no existe el campo** | ✅ el backend la lee de `configuration('resend_api_key')` como fallback de SMTP | `email-service.ts:resolveResendKey` |
| Email | SMTP seguro (465/TLS) | **no existe el campo** | ✅ backend soporta `secure` | `email-service.ts:normalizeSmtpConfig` |
| Seguridad | Autenticación (tarjeta) | ❌ | Lee `configuration('seguridad')`, clave que **nadie escribe** → **tarjeta vacía**, mismo bug que Plantillas | `settings.vue` `securityOptions`; `grep -rn "'seguridad'" backend/` → 0 |
| Seguridad | Longitud mínima / mayúsculas / números / especiales / expiración | ❌ | ❌ La regla real es `min: 6` fija en `usuarios/validators/schema.ts:7,16` | — |
| Integraciones | Channex · Google Maps · WhatsApp (Meta) | ✅ | ✅ | componentes/claves propias |
| Integraciones | Stripe (tarjeta) | ✅ `integraciones` (array) | ❌ nadie. Además los inputs usan `:value` sin `v-model`: lo tipeado **no vuelve al modelo**. Las llaves de Stripe de la plataforma salen de `STRIPE_SECRET_KEY` (env) y las del hotel de `/panel/config/pasarelas` | `settings.vue` comentario 2026-09-07; `infrastructure/stripe-config.ts` |
| Facturación | Método de cobro / ciclo / día de cobro / notas de crédito / descuentos / impuesto | ❌ | ❌ `grep -rn "billingMethod\|billingCycle\|graceDays\|annualDiscount" backend/src` → 0 | — |
| Facturación | Días de gracia | ❌ | ❌ acá. **El real** es `configuration('subscription_settings').gracePeriodDays`, lo lee `subscription-suspension-cron.ts:26` y se edita en `/admin/subscriptions-founders` | duplicado que no funciona |
| (fuera de la pantalla) | Días de prueba | — | `TRIAL_DAYS = 15` **constante** (`subscriptions/usecases/signup.ts:18`); issue #94 es cambiar literales a mano | — |

Resumen: de 5 pestañas, **2 enteras son decorado** (Seguridad, Facturación), 1 tiene la mitad muerta
(Plataforma) y 1 tiene una tarjeta muerta (Stripe en Integraciones). Solo Email (tras el fix local) e
Integraciones-menos-Stripe funcionan.

## Alcance

1. **Sacar lo que no tiene respaldo** y no lo va a tener: moneda, zona horaria, dominio, logo, color,
   tarjeta Stripe, método/ciclo/día de cobro, notas de crédito, descuentos, impuesto. Sin backend que
   los lea, mostrarlos es mentir.
2. **Email completo**: desplegar el fix de Plantillas; agregar API key de Resend (con estado
   "configurado/no", el secreto nunca vuelve al navegador) y TLS/465; el email de prueba pide
   destino.
3. **Seguridad real**: política de contraseña **persistida y aplicada** por el backend (alta de
   usuario, cambio de clave, reset, registro público) con la regla visible al usuario; y una tarjeta
   de "Protección del alta" que muestre el **estado real** de captcha, verificación de email y
   rate-limit en vez de toggles que no hacen nada.
4. **Suscripciones (reemplaza a Facturación)**: días de prueba (`trial_days`, reemplaza la constante),
   días de recordatorio y de gracia (**la misma** clave `subscription_settings` que ya lee el cron,
   sin duplicar), tarjeta obligatoria en el trial. Todo lo que ya está en `/admin/subscriptions-founders`
   se **enlaza**, no se copia.
5. **Estado de servicios por entorno** (solo lectura, sin secretos): Stripe de la plataforma,
   webhook de Stripe, Turnstile, `PUBLIC_URL`, Meta app secret. Un endpoint `GET
   /api/admin/settings/status` que devuelve `{configured: boolean}` por servicio — nunca el valor.
6. **Guardar por pestaña**: cada pestaña guarda lo suyo y dice qué guardó. Un "Guardar Cambios"
   global que persiste cuatro claves y muestra un toast genérico es lo que ocultó todo esto.

## Fuera de alcance

- Subir un logo o cambiar colores de la plataforma: son assets del build (`assets/logo/`, tokens de
  Tailwind). Si algún día se quiere white-label, es otro cambio con CDN y CSS variables.
- 2FA: no existe en el sistema. No se agrega un toggle para algo que no está construido.
- Mover secretos del `.env` a la base (Stripe, Turnstile, Meta): se **muestra el estado**, no se
  editan. Un secreto en `configuration` en texto plano ya nos costó el aviso de `stripe-config.ts`.

## Rollback

Todo es aditivo o de UI. Las claves nuevas (`security_policy`, `trial_days`, `resend_api_key`) tienen
default igual al comportamiento actual (min 6, 15 días, sin Resend). Quitar la UI no rompe nada porque
nada leía lo que se quita. Revertir el commit del frontend devuelve la pantalla anterior.
