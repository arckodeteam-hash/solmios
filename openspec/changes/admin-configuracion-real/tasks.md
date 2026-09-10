# admin-configuracion-real — Tasks

> `/admin/settings` hoy: 2 pestañas enteras sin backend (Seguridad, Facturación), media pestaña
> muerta (Plataforma), una tarjeta muerta (Stripe) y una tarjeta vacía en prod (Plantillas de Email,
> corregida en local 2026-09-09, sin deploy). Detalle y evidencia en `proposal.md`.
> Orden: 1 desbloquea prod ya; 2 es el cambio de UI base; 3-6 son independientes entre sí.
>
> **Evidencia ejecutada (local, 2026-09-09, backend dev :3001 + Vite :5180, login admin@solmios.com):**
> - Seguridad → "Autenticación": tarjeta vacía (screenshot). "Longitud mínima" 8 → 12 → Guardar →
>   recargar → **8**. Con la UI en 8, `POST /api/usuarios` con `password: "abc123"` (6) → **200,
>   usuario creado** (borrado después); con 5 chars → 400 (el `min: 6` del schema).
> - Integraciones → Stripe → Conectar → tipear `pk_test_PRUEBA_123` → Guardar →
>   `GET /api/configuracion/integraciones?hotelId=platform` devuelve `value: ""`.
> - Facturación: muestra 7 / 1 / 15 / 18 — son los defaults del `ref`, no hay carga ni guardado.

## 1. Desplegar el fix de Email (REQ-CFG-03) — ya hecho en local

- [ ] 1.1 Commit + deploy de: `shared/utils/platform-identity.ts`, `platform-emails/*`,
      `services/email-service.ts`, `settings.vue`, `email-templates.vue`, `PlatformEmails.service.ts`.
      **Aceptación**: en prod la tarjeta "Plantillas de Email" lista 10 plantillas con interruptor.
- [ ] 1.2 En prod: `bun run scripts/seed-platform-email-templates.ts --refresh`.
      **Aceptación**: `SELECT subject FROM platform_email_templates WHERE subject LIKE '%SolmiOS%'` → 0
      filas; el email de prueba llega con el `From:` = nombre de la plataforma.

## 2. Sacar lo que no funciona y guardar por pestaña (REQ-CFG-01, REQ-CFG-02)

- [ ] 2.1 Eliminar de `settings.vue`: moneda, zona horaria, dominio, tarjeta "Logo y Apariencia",
      tarjeta Stripe (y la clave `integraciones`), pestaña Facturación, campo "Expiración de
      contraseña". Eliminar `securityOptions`/`configuration('seguridad')`.
      **Aceptación**: `grep -c "customDomain\|brandColor\|billingCycle\|securityOptions" settings.vue` → 0.
- [ ] 2.2 `configuration('plataforma')` queda en `{platformName, supportEmail, supportPhone}`; cada
      campo dice dónde se usa ("Nombre → remitente y plantillas", "Email → `{support_email}`").
      **Aceptación**: el POST de guardar manda solo esas 3 claves.
- [ ] 2.3 Un botón "Guardar" por pestaña; toast con el nombre de lo guardado; sin botón global.
      **Aceptación**: guardar en Email no reescribe `plataforma` (verificar en Network: un solo POST).
- [ ] 2.4 `cd frontend && bun run typecheck && bun run build` verdes.

## 3. Email completo (REQ-CFG-04)

- [ ] 3.1 Backend: `GET /api/admin/settings/resend` → `{configured, last4}`;
      `PUT /api/admin/settings/resend {apiKey}` guarda `configuration('resend_api_key')`;
      `DELETE` la borra. Nunca devuelve la key.
      **Aceptación**: test de ruta: `merchant` → 403; GET tras PUT no contiene la key.
- [ ] 3.2 Frontend: tarjeta "Resend (respaldo sin SMTP)" con estado + input de reemplazo; toggle
      "Conexión segura (465/TLS)" que persiste `secure` en `email_config`.
      **Aceptación**: con SMTP host vacío y Resend cargada, "Enviar prueba" reporta `resend`.
- [ ] 3.3 "Enviar email de prueba" abre un input de destino (default `supportEmail`) y muestra el
      proveedor o el error real.
      **Aceptación**: destino inválido → no llama al backend, muestra el error inline.

## 4. Política de contraseña real (REQ-CFG-05)

- [ ] 4.1 `shared/usecases/password-policy.ts`: `readPasswordPolicy(configRepo)` +
      `validatePassword(pwd, policy): string | null` (mensaje en español o null).
      **Aceptación**: tests unitarios de las 4 reglas y del default `{6,false,false,false}`.
- [ ] 4.2 Aplicar en: `usuarios` create/update (clave), `auth` reset, `subscriptions` signup público.
      **Aceptación**: test por flujo: clave que viola la política → 400 con el mensaje, sin escritura.
- [ ] 4.3 `GET /api/auth/password-policy` público → la política vigente (sin secretos).
      **Aceptación**: responde sin token.
- [ ] 4.4 Frontend: `security_policy` editable en Seguridad; los formularios de alta de usuario,
      cambio de clave, reset y registro muestran la regla vigente antes de enviar.
      **Aceptación**: cambiar `minLength` a 10 en admin → el registro público muestra "mínimo 10".
- [ ] 4.5 `arckode analyze` 0 violaciones; `bun test` verde.

## 5. Estado de protección del alta y de servicios (REQ-CFG-06, REQ-CFG-08)

- [ ] 5.1 `GET /api/admin/settings/status` → `{ stripe, stripeWebhook, turnstile, publicUrl,
      metaApp, resend, smtp, googleMaps, channex }` cada uno `{configured, source}`.
      **Aceptación**: test que serializa la respuesta y falla si algún string supera 20 caracteres;
      `merchant` → 403.
- [ ] 5.2 Seguridad: tarjeta "Protección del alta" (captcha, verificación de email, rate-limit) de
      solo lectura, con la variable a setear cuando está apagado. "Verificación de email" reporta
      si el correo de verificación está cableado (`PUBLIC_URL` presente) — hoy el alta entra sin
      verificar y solo avisa.
      **Aceptación**: sin `TURNSTILE_SECRET` la fila dice "desactivado" y nombra la variable.
- [ ] 5.3 Integraciones: lista de servicios "Configurado / Falta" debajo de Channex/Maps/Meta.
      **Aceptación**: con `.env` de dev sin Stripe la fila dice "Falta — `STRIPE_SECRET_KEY`".

## 6. Suscripciones en vez de Facturación (REQ-CFG-07)

- [ ] 6.1 Backend: `configuration('trial_days')` leído en `signup.ts` y `publicSignupPolicy()`;
      `TRIAL_DAYS` pasa a ser el default, no el valor.
      **Aceptación**: test: config 30 → `trialEndsAt` = +30; sin config → +15. Cierra la parte
      dinámica de #94.
- [ ] 6.2 Frontend: pestaña "Suscripciones" con `trial_days`, `subscription_settings`
      (`reminderDaysBefore`, `gracePeriodDays` — misma clave que el cron) y link a
      `/admin/subscriptions-founders` para tarjeta obligatoria y cuenta regresiva.
      **Aceptación**: guardar `gracePeriodDays = 3` acá se ve en `/admin/subscriptions-founders` y
      viceversa (misma fila).
- [ ] 6.3 El registro público y el correo de bienvenida leen los días del backend, no de un literal.
      **Aceptación**: con `trial_days.days = 30` guardado, `/registro` muestra "30 días" sin rebuild
      y el correo de bienvenida de un alta nueva dice "30 días". Test: `welcomeVerificationEmail`
      recibe `trialDays` desde `publicSignupPolicy()`, no desde `TRIAL_DAYS`.

## 7. Cierre

- [ ] 7.1 `CLAUDE.md`: sección "Configuración de la plataforma" con la tabla clave → lector.
- [ ] 7.2 Verificación: `bun run typecheck` (ambos) + `arckode analyze` + `bun test` + QA visual de
      las 5 pestañas (Plataforma, Email, Seguridad, Integraciones, Suscripciones) en prod con
      screenshot de cada una adjunto al issue.
