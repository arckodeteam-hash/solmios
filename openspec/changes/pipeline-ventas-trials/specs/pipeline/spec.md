# Spec — Pipeline de ventas sobre trials

Convención: UI en español, DB/API en inglés (RFC 2119). Todo endpoint `/api/admin/*` exige
`auth.authenticate('super_admin')` + `requireUserType('admin')`; test de 403 para `merchant` en cada uno.

---

## REQ-PIPE-01 — Un prospecto por hotel, con etapa calculada

El sistema MUST exponer `GET /api/admin/sales-pipeline` con **una fila por hotel registrado** (fuente:
`subscriptions` ⋈ `hotels`) más una fila por `sales_leads` sin hotel asociado. La etapa MUST calcularse,
no guardarse:

| Etapa | Regla |
|---|---|
| `contact` | fila de `sales_leads` cuyo email no coincide con ningún `hotels.email` |
| `registered` | subscription `trialing` y `rooms = 0` |
| `activated` | subscription `trialing` y `rooms > 0` |
| `paying` | subscription `active` |
| `expired` | subscription `trialing` con `trialEndsAt < now` o `expired`, sin `lostAt` |
| `lost` | `sales_prospects.lostAt` presente |

Cada fila MUST incluir: `hotelId`, `hotelName`, `ownerName`, `email`, `phone`, `whatsappUrl`
(`https://wa.me/<E.164>` o null), `stage`, `trialEndsAt`, `daysLeft`, `signals`, `heat`, `nextStepAt`,
`nextStepNote`, `assignedTo`, `lostReason`, `contactedAt`.

**Given** un hotel con subscription `trialing`, `trialEndsAt` mañana y 12 filas en `rooms`
**When** se consulta el pipeline
**Then** su fila tiene `stage: 'activated'`, `daysLeft: 1`, `signals.rooms: 12`.

**Given** un `sales_leads` con email `x@y.com` y ningún hotel con ese email
**Then** aparece como `stage: 'contact'` con `hotelId: null`.

## REQ-PIPE-02 — Señales de producto y calor

`signals` MUST contener: `rooms` (count `rooms`), `rates` (count `room_rates`), `channels`
(count `channel_config`), `reservations` (count `reservations`), `lastActivityAt` (max
`audit_log.createdAt` del hotel, null si no hay). Todas por `hotelId`.

`heat` MUST calcularse: `rooms>0` +2 · `rates>0` +2 · `channels>0` +3 · `reservations>0` +3 ·
`lastActivityAt` en los últimos 3 días +2. `hot` ≥ 6, `warm` 3–5, `cold` < 3. El pipeline MUST
devolverse ordenado por: `nextStepAt` vencido primero, luego `heat` desc, luego `daysLeft` asc.

**Given** un hotel con 10 habitaciones, 0 tarifas, 0 canales, 0 reservas y última acción hace 1 día
**Then** `heat: 'warm'` (2+2 = 4).

**Given** un hotel con habitaciones, tarifas y una reserva, sin actividad en 10 días
**Then** `heat: 'hot'` (2+2+3 = 7).

## REQ-PIPE-03 — Próximo paso, responsable y pérdida

Tabla `sales_prospects` (una fila por `hotelId` o por `leadId`, ambos nullable, uno obligatorio):
`nextStepAt`, `nextStepNote`, `assignedTo` (users.id de un `super_admin`), `contactedAt`,
`lostAt`, `lostReason` (`no_response | price | missing_feature | chose_competitor | not_a_fit | other`),
`notes` (text), timestamps.

`PUT /api/admin/sales-pipeline/:key` (`key` = `hotel:<id>` o `lead:<id>`) MUST aceptar cualquier
subconjunto de esos campos, validado con `validateSchema`, y MUST hacer upsert. Marcar `lostReason`
sin `lostAt` MUST setear `lostAt = now`. Cada cambio MUST quedar en `audit_log` con `hotelId='platform'`.

**Given** `PUT` con `{ nextStepAt: '2026-09-12', nextStepNote: 'Llamar 10am' }`
**Then** el `GET` siguiente trae esos valores y el hotel aparece primero cuando `now >= 2026-09-12`.

## REQ-PIPE-04 — Aviso inmediato al registrarse un hotel

Al completar `POST /api/public/signup`, el sistema MUST encolar (best-effort, nunca rompe el alta) un
email a `SALES_LEADS_ADMIN_EMAIL` con: hotel, dueño, email, teléfono, plan elegido, enlace
`wa.me` con texto prellenado en español y enlace a `/admin/leads-ventas`. `relatedType` MUST ser
`sales-pipeline:signup`. El aviso MUST salir en la **misma petición** del alta (encolado), no en un cron.

**Given** un alta pública válida
**When** termina la petición
**Then** existe una fila en `email_queue` con `relatedType = 'sales-pipeline:signup'` y
`relatedId = hotelId`, y el `html` contiene `wa.me/` seguido del teléfono en E.164.

**Given** el sender de email no está cableado
**Then** el alta responde 200 igual.

## REQ-PIPE-05 — Extender el trial

`POST /api/admin/subscriptions/:hotelId/extend-trial { days: 1..30 }` MUST: sumar `days` a
`max(trialEndsAt, now)`, poner `status = 'trialing'`, limpiar `trialReminderSentAt` y
`trialExpiredEmailSentAt` (para que los recordatorios vuelvan a salir), registrar en `audit_log`, y
encolar al hotel el correo `trial_extended` (plantilla de plataforma nueva, con `{days_left}` y
`{platform_name}`).

**Given** un hotel `trialing` vencido hace 5 días
**When** se extiende 7 días
**Then** `trialEndsAt = now + 7d`, `status = 'trialing'`, ambos `*SentAt` en null, y hay un
`email_queue` con `relatedType = 'platform_email:trial_extended'`.

**Given** `days: 31`
**Then** 400.

## REQ-PIPE-06 — Vista `/admin/leads-ventas` reemplazada por el pipeline

La página MUST mostrar el pipeline con: filtro por etapa y por calor, buscador, columna "Vencen hoy"
arriba (prospectos con `nextStepAt <= hoy`), y por fila: nombre del hotel + dueño, botones
**WhatsApp** (`wa.me`), **Email** (`mailto:`), **Llamar** (`tel:`), chips de señales
(`12 hab · 0 tarifas · 0 canales · 0 reservas · visto hace 3 d`), badge de calor, días de trial
restantes, próximo paso (editable inline: fecha + nota + responsable), y acciones **Extender trial**
(7 / 15 días), **Marcar contactado**, **Perdido** (con motivo obligatorio). Estados loading / vacío /
error. Los `sales_leads` de contacto MUST seguir visibles con etapa `contact` y su mensaje.

**Given** un prospecto con `nextStepAt` de ayer
**Then** aparece en el bloque "Vencen hoy" con estilo de alerta.

**Given** clic en "Perdido" sin motivo
**Then** no se envía la petición y se muestra el error inline.

## REQ-PIPE-07 — WhatsApp en la landing

La landing MUST mostrar un botón flotante de WhatsApp cuando `configuration('plataforma').supportPhone`
tenga un número válido (E.164 tras normalizar), con texto prellenado "Hola, quiero información sobre
SolmiOS para mi hotel". Sin número, el botón MUST NOT renderizarse. El clic solo abre el enlace: NO crea un
`sales_leads` (no hay datos del visitante). El botón "Hablar con Ventas" se conserva.

**Given** `supportPhone = '809-555-0000'`
**Then** el enlace es `https://wa.me/18095550000?text=...`.

---

# Fase B

## REQ-PIPE-08 — Secuencia de activación por comportamiento

Cron diario que, por cada hotel `trialing` no perdido, evalúa y envía **como máximo un correo por
día** según la primera regla que aplique (dedup en `sales_prospects.sequenceSent` JSON `{event: date}`):

| Evento (plantilla de plataforma) | Regla |
|---|---|
| `activation_no_rooms` | día ≥ 1 desde el alta y `rooms = 0` |
| `activation_no_rates` | `rooms > 0` y `rates = 0` desde hace ≥ 2 días |
| `activation_no_channel` | `rates > 0`, `channels = 0`, día ≥ 3 |
| `trial_offer` | `daysLeft <= 3` y `stage = 'activated'` |

Cada plantilla MUST existir en `seed-platform-email-templates.ts` con `{hotel_name}`, `{link}`,
`{platform_name}`, `{support_email}`, `{support_phone}`, y ser editable desde `/admin/email-templates`.
Un hotel con `contactedAt` en los últimos 2 días MUST NOT recibir correos de la secuencia (ya hay un
humano encima).

**Given** un hotel con alta hace 2 días, `rooms = 0`, `activation_no_rooms` ya enviado ayer
**When** corre el cron
**Then** no se envía nada (dedup).

## REQ-PIPE-09 — Rescate de trial vencido

Para `stage = 'expired'`: correo `trial_rescue_1` a los 2 días del vencimiento y `trial_rescue_2` a los
7; a los 14 días sin actividad ni `contactedAt`, el cron MUST marcar `lostAt = now`,
`lostReason = 'no_response'`. Extender el trial MUST reiniciar el ciclo.

**Given** un hotel vencido hace 14 días sin actividad
**When** corre el cron
**Then** `lostAt` queda seteado y no se envía más nada.

## REQ-PIPE-10 — Embudo semanal

`GET /api/admin/sales-pipeline/funnel?weeks=8` MUST devolver por semana ISO: `registered`,
`activated` (rooms > 0 dentro de la semana del alta + 7 días), `paying` (primer `active` esa semana),
`lost` agrupado por `lostReason`. El dashboard del super-admin MUST mostrarlo como tabla de 8 semanas
con tasas `activated/registered` y `paying/registered`.

**Given** 10 altas en la semana W, 4 con rooms > 0 y 1 pagando
**Then** la fila W reporta `40%` y `10%`.
