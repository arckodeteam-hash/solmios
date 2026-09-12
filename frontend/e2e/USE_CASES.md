# Casos de uso — SolmiOS (backlog de tests E2E)

Mapeo de los flujos reales del sistema (Bun + Vue 3 + arckode-framework), pensado como
**backlog para escribir tests E2E (Playwright) de a poco**, no como documentación exhaustiva
de cada pantalla. Generado leyendo el código real (backend + frontend), no inferido.

Convención de cada caso de uso — mismo criterio que las specs de `openspec/` (Given/When/Then
+ RFC 2119 implícito en "debe/no debe"):

```
### <PREFIJO>-NN — <título>
- Actor(es):
- Precondición:
- Permiso requerido:
- Flujo (Given/When/Then)
- Endpoints clave:
- UI:
- Casos borde / errores a cubrir:
- Prioridad E2E: Alta | Media | Baja
```

**Cómo usar este documento**: elegí un caso `Prioridad: Alta` de la tabla de abajo, escribí el
spec en `e2e/<dominio>/<algo>.spec.ts` (carpeta por dominio, mismo patrón que `e2e/auth/` y
`e2e/reservations/` ya existentes), corré `bun run test:e2e:headed -- e2e/...` para verlo antes
de darlo por bueno, y tachalo de acá (o dejalo — el ID sirve de referencia estable).

## Ya cubierto (no recrear)

| Caso de uso | Spec |
|---|---|
| RES-01 — Alta manual de reserva (wizard 5 pasos) | `e2e/reservations/create-reservation.spec.ts` |
| RES-03 — Cancelar reserva + política (fee/refund) + 409 sobre checked_in | `e2e/reservations/cancel.spec.ts` |
| RES-04 — Check-in + cargo automático de la noche + 409 doble check-in | `e2e/reservations/checkin.spec.ts` |
| RES-05 — Check-out + settlement (folio→factura→pago) + 409 sin check-in | `e2e/reservations/checkout.spec.ts` |
| FAC-01 — Cobro de factura (total + sobrepago rechazado sin side-effects) | `e2e/billing/invoice-pay.spec.ts` |
| FAC-02 — Anular con nota de crédito (original cancelled + credit_note) + DELETE 409 | `e2e/billing/credit-note.spec.ts` |
| FAC-03 — Folio→factura atómico (cerrar+emitir en un solo request) | `e2e/billing/folio-invoice.spec.ts` |
| RES-02 — Editar reserva + IDOR hotelId + 409 solape | `e2e/reservations/edit.spec.ts` |
| OPS-03 — Regresión: nombres de staff resueltos por /api/usuarios (no employee-profiles) | `e2e/operations/staff-names.spec.ts` |
| RRHH-09 — Corrida de nómina completa (draft→calc→approve→pay) + idempotencia pay | `e2e/hr/payroll-run.spec.ts` |
| AUTH-06 — Aislamiento multi-tenant / IDOR cross-hotel + switch-hotel 403 | `e2e/auth/multitenant.spec.ts` |
| AUTH — Registro público (2 pasos) | `e2e/auth/register.spec.ts` |
| AUTH-02 — Correo de verificación real (IMAP) + enlace verifica + token de un solo uso | `e2e/auth/email-verification.spec.ts` |
| RES-17 — Circuito completo del motor web (#265): desayuno+extra+cuna → pago por webhook firmado → aviso al hotel → recibo → check-in con extras en folio → cancelación con reembolso | `e2e/reservations/public-booking-circuit.spec.ts` |
| Smoke (la app monta, login se renderiza) | `e2e/smoke.spec.ts` |

### Infra E2E (compartida por todos los specs de operaciones)
- `e2e/global-setup.ts`: 1 login por corrida → `storageState` (`e2e/.auth/admin.json`, gitignored).
  Resuelve el rate-limit del endpoint de login cuando corre la suite entera.
- `e2e/helpers/reservation-flow.ts`: `createReservationToday` (wizard reutilizable con cleanup
  de habitaciones), `createPendingInvoice` (folio→factura para specs de billing), `apiGet`/`apiPost`
  (lecturas/escrituras autenticadas para verificar efectos colaterales contra las tablas reales).
- Specs de operaciones: `test.use({ storageState: ADMIN_STORAGE_STATE })` al inicio (arrancan
  logueados, sin pasar por el form de login). Register/smoke no lo usan (prueban flujos públicos).
- `e2e/helpers/mailbox.ts`: buzón real por IMAP (`uniqueRecipient`, `waitForMessageTo`,
  `extractVerificationLink`). Lo usa AUTH-02 para afirmar "el correo llegó" con evidencia en vez
  de asumirlo. Credenciales por entorno (`MAILBOX_PASS`); sin ellas el spec se SALTA, nunca pasa
  en falso.
- `e2e/helpers/stripe-stub.ts`: doble HTTP de la API de Stripe sobre `node:http` (`startStripeStub`,
  `markSessionPaid`, `signStripeEvent`, `buildCheckoutCompletedEvent`) para que el backend cobre y
  reembolse contra un servidor local con su SDK REAL (`STRIPE_API_HOST/PORT/PROTOCOL`, sólo con claves
  `sk_test_`). Corre igual en Node (Playwright) y en Bun; `bun run e2e/helpers/stripe-stub.ts --selftest`
  valida el contrato con el SDK. Lo usa RES-17; el spec firma los webhooks con el mismo
  `STRIPE_WEBHOOK_SECRET` que recibe el backend.
- **16 specs, ~38s**, corren contra el backend de dev (`:3001`) con datos reales que persisten.

## Índice por dominio

1. [Auth & Onboarding](#1-auth--onboarding) — 11 casos (AUTH-01..11)
2. [Reservas & Planning](#2-reservas--planning) — 17 casos (RES-01..17)
3. [Facturación & Pagos](#3-facturación--pagos) — 15 casos (FAC-01..15)
4. [Operaciones: Housekeeping / Mantenimiento / Huéspedes](#4-operaciones-housekeeping--mantenimiento--huéspedes) — 14 casos (OPS-01..14)
5. [RRHH: Talento & Nómina](#5-rrhh-talento--nómina) — 14 casos (RRHH-01..14)
6. [Marketing & Comunicación](#6-marketing--comunicación) — 13 casos (MKT-01..13)
7. [Dispositivos, Inventario, Compras & Restaurante](#7-dispositivos-inventario-compras--restaurante) — 14 casos (DEV-01..14)
8. [Admin de Plataforma & Configuración](#8-admin-de-plataforma--configuración) — 15 casos (ADM-01..15)

**Total: 113 casos de uso mapeados.**

## Prioridad Alta — por dónde seguir

Los siguientes casos están marcados `Prioridad E2E: Alta` (mueven dinero, son control de acceso
crítico, o tienen un bug histórico real que amerita test de regresión). Es el orden sugerido
para las próximas sesiones de test-writing, agrupado por dominio:

**Auth**: AUTH-01 (forgot/reset password), AUTH-03 (bloqueo por trial vencido), AUTH-06
(aislamiento multi-tenant/IDOR), AUTH-07 (hotel switcher del super_admin), AUTH-08 (bloqueo de
escalada de rol).

**Reservas**: RES-02 (editar), RES-03 (cancelar + política + depósito), RES-04 (check-in +
cargo automático), RES-05 (check-out + settlement), RES-06/RES-07 (reprogramar mover/extender —
el bug recién arreglado en esta misma sesión, máxima prioridad), RES-08 (pre-checkin OCR
end-to-end), RES-10 (motor público + Stripe + concurrencia anti-overbooking).

**Facturación**: FAC-01 (cobro con tope anti-sobrepago), FAC-02 (anular ≠ borrar), FAC-03
(folio→factura atómico), FAC-04 (pago a folio), FAC-05/FAC-06 (cobro y refund con Stripe),
FAC-08 (webhook aplica pago a reserva+folio), FAC-10 (turno de caja + arqueo).

**Operaciones**: OPS-01 (ciclo limpieza completo checkout→camarera→supervisor), OPS-02 (máquina
de estados), OPS-03 (regresión: nombres por `/usuarios`, nunca `employee-profiles` — bug
recurrente histórico), OPS-06 (camarera reporta desperfecto→ticket real), OPS-07 (aprobar exige
presencia física), OPS-09 (asignación excluyente técnico/proveedor), OPS-12 (unicidad de
huésped por hotel).

**RRHH**: RRHH-01/02 (alta empleado = user+legajo, con rollback), RRHH-04 (contratos),
RRHH-05/06 (licencias con cálculo de días hábiles), RRHH-07 (fichaje con overtime/turno
nocturno), RRHH-09 (corrida de nómina completa — la más crítica, mueve plata real), RRHH-13
(reclutamiento→legajo, mismo gotcha user↔profile).

**Marketing**: MKT-01 (auto-mensajes), MKT-05 (reencolar email fallido), MKT-06 (notificaciones
in-app), MKT-07 (feedback→issue de GitHub), MKT-09/MKT-10 (reseñas: invitación pública +
respuesta admin), MKT-12/MKT-13 (CRM: cupones y puntos de fidelidad).

**Dispositivos/Inventario**: DEV-01/DEV-02 (generar/revocar código TTLock), DEV-05 (llave
maestra), DEV-08 (stock con costo promedio), DEV-10 (ciclo de compras completo), DEV-12/DEV-13
(POS restaurante: comanda→cocina→cobro→refund).

**Admin de plataforma**: ADM-01..04 (gestión de hoteles/planes/condiciones especiales/
suspensión), ADM-06 (módulos globales), ADM-07 (auditoría cross-tenant), ADM-09 (config general
del hotel), ADM-12 (programa Aliados).

---

## 1. Auth & Onboarding

### AUTH-01 — Recuperación de contraseña (forgot + reset password)
- **Actor(es):** Usuario merchant sin sesión (dueño/staff de un hotel existente).
- **Precondición:** Cuenta ya existe (`users.email`). No requiere sesión.
- **Permiso requerido:** Ninguno (rutas públicas).
- **Flujo:**
  - Given un usuario en `/forgot-password` con el email de una cuenta existente
  - When envía el formulario
  - Then el backend responde 200 genérico ("Si el email existe...") y, si el email existe, guarda `resetToken`+`resetExpires` (TTL 1h) y muestra la pantalla "Email enviado"
  - Given el usuario abre `/reset-password?token=...` con un token válido
  - When define nueva contraseña + confirmación y envía
  - Then `POST /api/auth/reset-password` actualiza el hash, invalida el `token` de sesión activo (`token: null`) y limpia `resetToken/resetExpires`; el frontend muestra "Contraseña restablecida" → vuelve a poder loguearse con la nueva clave
- **Endpoints clave:** `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`.
- **UI:** `frontend/src/pages/auth/forgot-password.vue`, `frontend/src/pages/auth/reset-password.vue`.
- **Casos borde / errores a cubrir:**
  - Email inexistente → misma respuesta 200 genérica (anti-enumeración) — el test debe verificar que NO hay diferencia observable entre email válido/inválido.
  - `/reset-password` **sin** `?token=` en la URL → la vista muestra directamente "Token inválido o expirado" sin llamar al backend.
  - Token expirado (>1h) o inexistente → 401 `AuthError('Token inválido o expirado')`.
  - Rate-limit por IP en ambos endpoints (mismo patrón que login).
  - **Bug real encontrado (no documentado antes)**: `reset-password.vue` valida `password.length < 6`, y `ResetPasswordSchema`/`ChangePasswordSchema` del backend TAMBIÉN solo exigen `min: 6` — **NO** aplican `passwordIssues()` (la política real: 10 caracteres, mayúscula/minúscula/número, no común) que sí se exige en el alta. Hoy se puede resetear la contraseña a algo como `"aaaaaa"`. Vale un test que documente este comportamiento actual (o lo marque como bug a fixear).
- **Prioridad E2E:** Alta.

### AUTH-02 — Verificación de email tras el alta (#421)
- **Actor(es):** Merchant recién registrado (hotel_admin).
- **Precondición:** Hotel creado vía signup; `emailVerifiedAt` es `null`.
- **Permiso requerido:** Sesión propia para reenviar; el link de verificación es público.
- **Flujo:**
  - Given un merchant logueado con email sin verificar
  - When entra al panel
  - Then ve el banner persistente "Verificá tu email" con botón de reenvío — NO bloquea el uso del sistema
  - When hace clic en "Reenviar" → `POST /api/auth/resend-verification`
  - Then se regenera el token, se reencola el correo y aparece un toast de éxito
  - Given el usuario abre `GET /api/public/verify-email?token=...`
  - Then redirige (302) a `/verificar-email?status={verified|invalid|expired|already_verified}`
- **Endpoints clave:** `GET /api/public/verify-email`, `POST /api/auth/resend-verification`.
- **UI:** banner en `frontend/src/layouts/AdminLayout.vue`, `frontend/src/pages/verificar-email.vue`.
- **Casos borde / errores a cubrir:** token ya usado/de cuenta ya verificada → `already_verified`; token vencido (>24h) → `expired`; token vacío/inválido → `invalid`; el banner desaparece al verificar.
- **Prioridad E2E:** Media.
- **Cubierto por** `e2e/auth/email-verification.spec.ts`: alta contra el backend real con destinatario único
  (sub-dirección `autowork+alta-<uuid>@…` — el buzón no tiene catch-all), espera del correo por IMAP, apertura
  del enlace en Chromium (`status=verified` + pantalla) y efecto en `users` (`emailVerifiedAt` seteado,
  `emailVerificationToken` en NULL); segunda visita al mismo enlace → `status=invalid`. Requiere el backend con
  `PUBLIC_URL` apuntando al FRONTEND (el 302 lleva `Location` relativo) y la config SMTP en la tabla
  `configuration` (el spec la siembra con `MAILBOX_PASS`). Falta por cubrir: reenvío desde el banner,
  `expired` y `already_verified`.

### AUTH-03 — Acceso bloqueado por trial/suscripción vencida
- **Actor(es):** Merchant de un hotel cuyo trial (15 días) o suscripción venció.
- **Precondición:** `subscriptions.status='trialing'` con `trialEndsAt` pasado, o `status` vencido, o `hotels.status` suspendido/inactivo.
- **Permiso requerido:** N/A — el bloqueo ocurre en el login mismo, antes de cualquier permiso.
- **Flujo:**
  - Given un hotel con `trialEndsAt` ya pasado
  - When el dueño intenta loguearse con credenciales correctas
  - Then `AuthError` `status:402`, `code:'SUBSCRIPTION_REQUIRED'`, `reason:'trial_expired'` — NO entra al panel
  - Given el mismo chequeo se repite en cada request autenticado (`assertHotelCanOperate`), no solo login
- **Endpoints clave:** `POST /api/auth/login`.
- **UI:** `frontend/src/pages/auth/login.vue`.
- **Casos borde / errores a cubrir:** `super_admin` NUNCA se bloquea; distinguir los 5 `DenyReason` (`trial_expired`, `subscription_expired`, `hotel_suspended`, `hotel_inactive`, `subscription_suspended`); hotel sin fila en `subscriptions` (altas viejas) NO se bloquea; el estado se "marca expired" como side-effect del propio check, no por cron.
- **Prioridad E2E:** Alta.

### AUTH-04 — Elegir plan y pagar suscripción (Stripe Checkout)
- **Actor(es):** hotel_admin (o rol con `settings:edit`).
- **Precondición:** Hotel logueado, plan con `stripePriceId`, Stripe activo en la plataforma.
- **Permiso requerido:** `settings:edit`.
- **Flujo:**
  - Given el hotel en `/panel/suscripcion` viendo su trial
  - When elige un plan y confirma
  - Then `POST /api/subscriptions/checkout {planId}` crea/reusa el Customer de Stripe (SIEMPRE de la cuenta de PLATAFORMA) y devuelve `{url}`; redirige a Stripe
  - Then el webhook `POST /api/stripe/webhook/platform` confirma el pago
- **Endpoints clave:** `GET /api/subscription/me`, `POST /api/subscriptions/checkout`, `POST /api/subscriptions/portal`, `POST /api/stripe/webhook/platform`.
- **UI:** `/panel/suscripcion`.
- **Casos borde / errores a cubrir:** plan sin `stripePriceId` → error; Stripe no configurado → error; E2E real de Checkout requiere Stripe test-mode — priorizar test de "llega a la URL" sin completar el pago.
- **Prioridad E2E:** Media.

### AUTH-05 — Guía de primeros pasos (onboarding checklist)
- **Actor(es):** hotel_admin recién dado de alta.
- **Precondición:** Hotel con datos en cero.
- **Permiso requerido:** Sesión autenticada (cualquier rol).
- **Flujo:**
  - Given un hotel recién registrado entra a `/panel/dashboard`
  - When se consulta `GET /api/onboarding/status`
  - Then 5 pasos (`rooms`, `hotel`, `rates`, `channels`, `team`) con `done` calculado de datos reales, sin flag manual
  - Then `completed:true` solo cuando los pasos `required:true` (`rooms`, `hotel`) están hechos
- **Endpoints clave:** `GET /api/onboarding/status`.
- **UI:** dashboard del panel.
- **Casos borde / errores a cubrir:** el checklist se "desmarca" si se borra lo cargado (estado derivado, no persistido); `team > 1` (el dueño mismo no cuenta).
- **Prioridad E2E:** Media.

### AUTH-06 — Multi-tenancy: aislamiento entre hoteles y entre userType
- **Actor(es):** Merchant del Hotel A intentando acceder a datos/rutas del Hotel B o `/admin/*`.
- **Precondición:** Dos hoteles distintos; sesión de un merchant del Hotel A.
- **Permiso requerido:** N/A (es la ausencia de acceso lo que se testea).
- **Flujo:**
  - Given un hotel_admin del Hotel A autenticado
  - When intenta `PUT/DELETE /api/usuarios/:id` sobre un usuario del Hotel B → 403
  - Given navega a `/admin/*` → guard `requiresSuperAdmin` lo redirige a `/panel`; a nivel API, `requireUserType('admin')` lanza `AuthError`
  - Given intenta `POST /api/auth/switch-hotel/:id` con id de OTRO hotel → `AuthError('No autorizado para este hotel')`
- **Endpoints clave:** `PUT/DELETE /api/usuarios/:id`, `POST /api/auth/switch-hotel/:id`, cualquier `/api/admin/*`.
- **UI:** router guards en `frontend/src/router/index.ts`.
- **Casos borde / errores a cubrir:** `hotelId` siempre del JWT, nunca de un param/body controlable por el cliente; rol custom navegando a sección no habilitada → redirect con toast, no 403 silencioso; módulo no incluido en el plan → redirect con toast.
- **Prioridad E2E:** Alta.

### AUTH-07 — Super admin impersona un hotel (Hotel Switcher)
- **Actor(es):** `super_admin`.
- **Precondición:** Sesión de `super_admin` activa; al menos un hotel existente.
- **Permiso requerido:** `users:edit` + rol `super_admin`.
- **Flujo:**
  - Given un `super_admin` logueado en `/admin`
  - When selecciona un hotel en `HotelSwitcher.vue`
  - Then `POST /api/auth/switch-hotel/:id` emite token nuevo con `hotelId` del hotel elegido
  - Then navega a `/panel` en modo `impersonating` (banner naranja "👁️ Modo supervisión")
- **Endpoints clave:** `GET /api/auth/hotels`, `POST /api/auth/switch-hotel/:id`.
- **UI:** `HotelSwitcher.vue`, banner en `AdminLayout.vue`.
- **Casos borde / errores a cubrir:** `super_admin` puede cambiar a cualquier hotel (a diferencia de AUTH-06); hotel inexistente → 404; acciones durante impersonación deben quedar scoped al hotel impersonado.
- **Prioridad E2E:** Alta.

### AUTH-08 — Alta de usuario del equipo con rol asignado + bloqueo de escalada
- **Actor(es):** hotel_admin dando de alta a un miembro del equipo.
- **Precondición:** Sesión hotel_admin; `users:create`.
- **Permiso requerido:** `users:create` (POST), `users:edit` (PUT).
- **Flujo:**
  - Given un hotel_admin crea un usuario con `role:'receptionist'` → `canAssignRole('hotel_admin','receptionist')` true → 201
  - Given intenta crear con `role:'hotel_admin'`/`'super_admin'` → 403 (nadie se autopromueve ni promueve a otro admin)
  - Given intenta `PUT` para escalar un `receptionist` existente a `hotel_admin` → también 403 (mismo check en update, antes solo se validaba en store — ya fixeado)
- **Endpoints clave:** `POST /api/usuarios`, `PUT /api/usuarios/:id`.
- **UI:** vista de equipo del panel.
- **Casos borde / errores a cubrir:** `receptionist` con `users:create` puede crear housekeeper/maintenance pero NO receptionist/supervisor; rol custom scoped por `hotelId`; sin `role` → default `receptionist`; rate-limit por IP.
- **Prioridad E2E:** Alta.

### AUTH-09 — Rol personalizado por hotel: creación y bloqueo de auto-escalada (S-A2)
- **Actor(es):** hotel_admin, o rol custom con `users:create`/`users:edit`.
- **Precondición:** Sesión con permiso `users:create`.
- **Permiso requerido:** `users:view/create/edit/delete`.
- **Flujo:**
  - Given `GET /api/roles/catalog` (server-driven, cada módulo trae solo sus acciones válidas)
  - When arma un rol nuevo y `POST /api/roles`
  - Given un usuario con permisos limitados intenta otorgar `billing:view` sin tenerlo → `ForbiddenError` "No puede otorgar un permiso que usted no tiene"
- **Endpoints clave:** `GET/POST /api/roles`, `GET /api/roles/catalog`, `PUT /api/roles/:id`, `POST /api/roles/:id/restore`.
- **UI:** `frontend/src/pages/roles/index.vue`.
- **Casos borde / errores a cubrir:** rol de sistema `restore` lo vuelve a su config original; `hotelId` no editable vía PUT; `super_admin` puede otorgar cualquier permiso.
- **Prioridad E2E:** Media.

### AUTH-10 — Cambio de contraseña propio (perfil autenticado)
- **Actor(es):** Cualquier usuario autenticado.
- **Precondición:** Sesión activa.
- **Permiso requerido:** Ninguno especial (sobre el propio usuario del token).
- **Flujo:**
  - Given un usuario logueado
  - When ingresa contraseña actual + nueva
  - Then `POST /api/auth/change-password` re-autentica con la actual antes de aceptar, invalida el `token` de sesión
- **Endpoints clave:** `POST /api/auth/change-password`.
- **UI:** vista de perfil.
- **Casos borde / errores a cubrir:** `currentPassword` incorrecta → no toca el hash; mismo gap que AUTH-01 (solo valida `min:6`, no la política completa).
- **Prioridad E2E:** Media.

### AUTH-11 — Programa de referidos: link `/r/:code` → registro pre-cargado
- **Actor(es):** Prospecto anónimo.
- **Precondición:** Programa habilitado; código válido de un hotel existente.
- **Permiso requerido:** Ninguno (signup público); `settings:edit` para ver `GET /api/referrals/me`.
- **Flujo:**
  - Given un prospecto abre `/r/ABC123` → redirige a `/registro?ref=ABC123`
  - Then `register.vue` resuelve el código y muestra "Te invitó {hotel}"
  - When completa el alta → `linkSignup()` crea la fila en `referrals` (best-effort, no revierte el alta si falla)
- **Endpoints clave:** `GET /api/public/referrals/resolve`, `GET /api/referrals/me`.
- **UI:** redirect en el router, banner en `register.vue`, `/panel/referidos`.
- **Casos borde / errores a cubrir:** código inexistente → no muestra banner, no rompe; auto-referido ignorado; programa desactivado no vincula; usuario YA autenticado en `/r/:code` → va directo a su panel.
- **Prioridad E2E:** Baja.

## 2. Reservas & Planning

### RES-01 — Alta manual de reserva (wizard 5 pasos)
- **Ya cubierto** por `frontend/e2e/reservations/create-reservation.spec.ts`. Falta: solape 409 al elegir habitación ocupada, `checkIn >= checkOut` rechazado.
- **Prioridad E2E:** Ya cubierto — no recrear.

### RES-02 — Editar reserva existente
- **Actor(es):** Recepcionista / hotel_admin.
- **Precondición:** Reserva existe, del hotel del usuario, no `checked_out`.
- **Permiso requerido:** `reservations:edit`.
- **Flujo:** Given reserva `confirmed` → When cambia fechas/habitación/monto y guarda → Then `PUT /api/reservas/:id` revalida disponibilidad y emite socket.
- **Endpoints clave:** `PUT /api/reservas/:id`.
- **UI:** `ReservationModal.vue` (edición, distinta del wizard de alta).
- **Casos borde / errores a cubrir:** mover a habitación con solape → 409; `hotelId` no editable (IDOR); editar reserva `checked_out`; usuario de otro hotel → 403.
- **Prioridad E2E:** Alta.

### RES-03 — Cancelar reserva desde el panel (política + penalidad + depósito)
- **Actor(es):** Recepcionista / hotel_admin.
- **Precondición:** Reserva `pending`/`confirmed`.
- **Permiso requerido:** `reservations:edit`.
- **Flujo:** Given depósito retenido → When preview + confirma → Then `POST /api/reservas/:id/cancel` marca `cancelled`, calcula fee/refund según política (channel > base > preset > default), libera depósito.
- **Endpoints clave:** `GET /:id/cancel-preview`, `POST /:id/cancel`.
- **UI:** `CancelReservationModal.vue`.
- **Casos borde / errores a cubrir:** cancelar `checked_in`/`checked_out` → 409; sin política → reembolsa 100%; doble cancelación idempotente; **deuda conocida**: `deposits.release` NO toca Stripe/`payments`, solo flag de estado.
- **Prioridad E2E:** Alta.

### RES-04 — Check-in con cargo automático de habitación
- **Actor(es):** Recepcionista.
- **Precondición:** Reserva `confirmed`/`pending`, día de check-in.
- **Permiso requerido:** `reservations:checkin`.
- **Flujo:** `POST /api/reservas/:id/checkin` transiciona a `checked_in`, postea cargo en transacción ORM, envía email con código de cerradura si aplica.
- **Endpoints clave:** `POST /:id/checkin`.
- **UI:** `/panel/reservas/checkin`, planning.
- **Casos borde / errores a cubrir:** doble check-in concurrente → `AlreadyCheckedInError` 409, no doble cargo; check-in de reserva en estado inválido → 409.
- **Prioridad E2E:** Alta.

### RES-05 — Check-out con settlement (folio → factura → pago)
- **Actor(es):** Recepcionista.
- **Precondición:** Reserva `checked_in`.
- **Permiso requerido:** `reservations:checkout`.
- **Flujo:** `POST /api/reservas/:id/checkout {settle}` orquesta close folio → create invoice → record payment.
- **Endpoints clave:** `POST /:id/checkout`.
- **UI:** planning / detalle de reserva.
- **Casos borde / errores a cubrir:** checkout sin `settle`; checkout de reserva NO `checked_in` → 409; `ValidationError` de monto inválido.
- **Prioridad E2E:** Alta.

### RES-06 — Reprogramar: mover de habitación/fecha (keep vs reprice)
- **Actor(es):** Recepcionista / hotel_admin, desde el Planning (drag-and-drop).
- **Precondición:** Reserva no `checked_out`/`cancelled`.
- **Permiso requerido:** `reservations:edit`.
- **Flujo:** drag en `ReservationCalendar.vue` → `RescheduleModal.vue` pide quote → elige `keep`/`reprice` → `POST /:id/reschedule`.
- **Endpoints clave:** `POST /:id/reschedule/quote`, `POST /:id/reschedule`.
- **UI:** `ReservationCalendar.vue` + `RescheduleModal.vue`.
- **Casos borde / errores a cubrir:** mover a habitación de otro hotel → `ConflictError`; sin cambio de noches en `keep` → diferencia $0; `reprice` más caro → cobra diferencia; más barato → `credit-block` (no se devuelve solo); destino no disponible; sin tarifas → degrada a `basePrice` con warning.
- **Prioridad E2E:** Alta — es el flujo recién investigado/arreglado en esta sesión (bug mezcla mover/extender), máxima prioridad para blindar con test.

### RES-07 — Reprogramar: extender estadía
- **Actor(es):** Recepcionista / hotel_admin.
- **Precondición:** Misma reserva activa, solo cambia `checkOut`.
- **Permiso requerido:** `reservations:edit`.
- **Flujo:** "Extender" desde menú contextual (NO drag) → mismo endpoint que RES-06 con `roomId` sin cambios.
- **Endpoints clave:** `POST /:id/reschedule/quote`, `POST /:id/reschedule`.
- **UI:** `RescheduleModal.vue` con `editable=true`.
- **Casos borde / errores a cubrir:** extender a fecha con solape de la MISMA habitación; extender a fecha anterior al checkIn → `ConflictError`; acortar da diferencia negativa. Verificar que el modal no dispare "mover habitación" al solo extender.
- **Prioridad E2E:** Alta.

### RES-08 — Pre-checkin público end-to-end (OCR + firma)
- **Actor(es):** Huésped (sin login), vía link por email.
- **Precondición:** Reserva existe, no expirada, `hash` válido.
- **Permiso requerido:** Ninguno (autorización por hash).
- **Flujo:** 5 pasos (reserva → grupo → OCR documento → firma+contrato → confirmación) → `POST /api/public/pre-checkin/:hash` marca `completed`.
- **Endpoints clave:** `GET/POST /api/public/pre-checkin/:hash`, `POST /:hash/photo`.
- **UI:** `/checkin/:hash`.
- **Casos borde / errores a cubrir:** hash expirado/inexistente; submit sin aceptar contrato/GDPR → 400; firma faltante/inválida; foto no-imagen.
- **Prioridad E2E:** Alta — flujo recién arreglado en sesión previa, sin cobertura E2E, múltiples pasos frágiles.

### RES-09 — Reserva grupal (grupo + reservas asociadas)
- **Actor(es):** hotel_admin.
- **Precondición:** Ninguna especial.
- **Permiso requerido:** `reservations:create/edit`.
- **Flujo:** crea grupo → asigna `groupId` a reservas individuales (valida cross-tenant).
- **Endpoints clave:** `POST/PUT/DELETE /api/grupos`, `PUT /api/reservas/:id`.
- **UI:** `/panel/reservas/grupos`.
- **Casos borde / errores a cubrir:** asignar grupo de otro hotel → rechazo; borrar grupo con reservas asociadas.
- **Prioridad E2E:** Media.

### RES-10 — Motor de reservas público: alta con pago (Stripe Checkout)
- **Actor(es):** Huésped anónimo, vía `/book/:slug`.
- **Precondición:** `booking_config.enabled=true`.
- **Permiso requerido:** Ninguno.
- **Flujo:** elige tipo+fechas → `POST /api/public/booking` resuelve habitación física con lock anti-overbooking → `checkoutUrl`.
- **Endpoints clave:** `GET /rates`, `POST /api/public/booking`, webhook.
- **UI:** `/book/:slug`, `/h/:slug/confirm`.
- **Casos borde / errores a cubrir:** dos huéspedes compiten por la última unidad → el segundo 409; tipo inexistente → 404; sin unidades libres → 409 (no 404); estadía > máximo; hotel pausado → 404; Stripe caído → reserva se crea igual con `checkoutUrl:null`.
- **Prioridad E2E:** Alta. El camino feliz (alta → `checkoutUrl` → webhook firmado → `confirmed`) lo cubre RES-17.

### RES-11 — Auto-cancelación pública del huésped (token HMAC)
- **Actor(es):** Huésped anónimo.
- **Precondición:** Reserva con `accessToken`, no checked_in/out.
- **Permiso requerido:** Ninguno (HMAC).
- **Flujo:** `POST /api/public/reservations/:id/cancel` valida HMAC, resuelve política.
- **Endpoints clave:** `POST /:id/cancel`, `GET /:id`.
- **UI:** `/h/:slug/confirm`.
- **Casos borde / errores a cubrir:** sin token/token incorrecto/reserva del panel → 404 uniforme (anti-enumeración); reserva checked_in/out → 409; cancelación ya procesada → idempotente.
- **Prioridad E2E:** Media-Alta. La cancelación desde la UI pública con reembolso real en la pasarela la cubre RES-17.

### RES-12 — Código promocional en el motor público
- **Actor(es):** Huésped anónimo (validación) / hotel_admin (alta).
- **Precondición:** Código activo, dentro de ventana, con usos disponibles.
- **Permiso requerido:** alta requiere `promo:create`; validación pública ninguno.
- **Flujo:** huésped ingresa código → `POST /api/public/booking` valida y aplica descuento, incrementa `uses` DENTRO de la tx de creación.
- **Endpoints clave:** `POST /api/promo-codes`, `POST /promo/validate`, `POST /api/public/booking`.
- **UI:** `/panel/promociones/codigos`, widget público.
- **Casos borde / errores a cubrir:** código vencido/inactivo/max-uses/min-amount → 400 con `promoReason`; dos huéspedes usan el último uso simultáneamente → el segundo 409, no doble incremento.
- **Prioridad E2E:** Media.

### RES-13 — Ingesta de reserva OTA (Channel Manager / Channex)
- **Actor(es):** Sistema.
- **Precondición:** Canal conectado y mapeado.
- **Permiso requerido:** `channel-manager:edit` (trigger manual).
- **Flujo:** revisión de booking cancelado (dedupe por `externalLocator`) reusa el MISMO núcleo de cancelación que el panel.
- **Endpoints clave:** `POST /api/channels/bookings/ingest`.
- **UI:** `/panel/channel-manager`.
- **Casos borde / errores a cubrir:** sin mapeo → auto-asignación con nota "AUTO-ASSIGNED ROOM"; cancelación de reserva ya checked_in → `invalid_state`, no reintenta infinito; error transitorio SÍ reintenta; revisión repetida → idempotente.
- **Prioridad E2E:** Media (integración externa difícil de e2e sin mockear Channex).

### RES-14 — Conectar canal OTA desde el panel
- **Actor(es):** hotel_admin.
- **Precondición:** Credenciales de plataforma configuradas.
- **Permiso requerido:** `channel-manager:edit`.
- **Flujo:** conecta canal → `POST /api/channels/connect` + push-rates inicial.
- **Endpoints clave:** `POST /connect`, `POST /test-connection`.
- **UI:** `/panel/channel-manager`, `/panel/channel/:id`.
- **Casos borde / errores a cubrir:** test de conexión falla; desactivar canal con bookings pendientes; mapeo incompleto.
- **Prioridad E2E:** Baja-Media.

### RES-15 — Bloqueo de disponibilidad por mantenimiento impide reserva/reprogramación
- **Actor(es):** Sistema (validación transversal).
- **Precondición:** `RoomBlocks` activo sobre la habitación.
- **Permiso requerido:** el de quien intenta la operación.
- **Flujo:** cualquier alta/edición/reprogramación hacia esa habitación en ese rango → 409, mismo criterio que un solape de reserva.
- **Endpoints clave:** `POST/PUT /api/reservas`, `/reschedule` (todos usan `assertRoomAvailable`).
- **UI:** Planning debería mostrar la habitación bloqueada visualmente.
- **Casos borde / errores a cubrir:** bloqueo con solape parcial; borde de fecha en que el bloqueo vence el día del check-in.
- **Prioridad E2E:** Media.

### RES-16 — No-show automático (night audit)
- **Actor(es):** Sistema (cron).
- **Precondición:** Reserva `confirmed`/`pending` con `checkIn` pasado sin check-in.
- **Permiso requerido:** N/A; manual requiere `reports:edit`.
- **Flujo:** `POST /api/night-audit/mark-no-shows` transiciona según `state-machine.ts`.
- **Endpoints clave:** `POST /mark-no-shows`.
- **UI:** `/panel/finanzas/night-audit`.
- **Casos borde / errores a cubrir:** **hallazgo a verificar**: la tabla de transiciones permite `pending→no_show` pero NO parece permitir `confirmed→no_show` (el caso más común) — el test debe confirmar o descartar esta inconsistencia antes de asumir que funciona; cron corriendo dos veces no debe duplicar.
- **Prioridad E2E:** Media-Alta.

### RES-17 — Circuito completo del motor de reservas web (epic #265)
- **Actor(es):** Huésped anónimo (widget `/book/:slug` y página pública `/h/:slug/confirm`), la pasarela
  (webhook), hotel_admin (campanita, check-in, folio).
- **Precondición:** Motor habilitado con confirmación instantánea; régimen `breakfast` activo por persona y
  noche; un upsell activo; política de niños con `maxBabyAge` y `custom:cuna` en las habitaciones Double;
  `hotels.email` y la config SMTP del hotel (`configuration.email_config`) apuntando al buzón de pruebas.
  El spec siembra todo por la API admin y lo restaura al final.
- **Permiso requerido:** Ninguno para el huésped; `reservations:checkin` + `billing:view` para el check-in
  y la lectura del folio.
- **Flujo:**
  - Given un huésped en `/book/:slug` con fechas futuras
  - When arma una Double con 1 adulto + 1 bebé, pide cuna, elige "Desayuno incluido", suma el extra y
    envía con "Reservar y pagar"
  - Then la reserva queda `pending` con `mealPlan=breakfast`, `needsCrib=true` y el desglose del server
    (`mealPlanTotal`, `upsellsTotal`, `roomAmenitiesTotal`) y el widget lo manda a la Checkout Session
    (página del doble, `client_reference_id` = reserva, `amount_total` = total en centavos)
  - When llega `checkout.session.completed` firmado a `POST /api/public/webhook/stripe/:hotelId`
  - Then la reserva pasa a `confirmed` (`deposit` = total, `pendingAmount` 0, `paymentMethod=card`) y hay
    una fila `charge/completed` en `payments` (`GET /api/reservations/:id` → `paymentHistory`)
  - Then el hotel ve en la campanita "Nueva reserva web — …" y "Pago recibido — …", y recibe el correo
    `reservation_new_staff` con "Pagado" en su buzón
  - Then el huésped recibe `reservation_confirmed` con el desglose (régimen × personas × noches, extra,
    cuna), el enlace "Ver mi reserva" y el recibo PDF (`GET /api/public/reservations/:id/receipt.pdf`
    responde `application/pdf`)
  - When recepción hace `POST /api/reservas/:id/checkin`
  - Then el folio nace con la noche + una línea `extra` por cada addon pagado online (`Régimen: Desayuno`,
    el upsell, `Cuna`, con sus importes base) y el prepago acreditado: saldo 0 (#269)
  - Given una SEGUNDA reserva pagada de la misma forma (la primera ya está checked_in → 409 al cancelar)
  - When el huésped abre el enlace del correo y confirma "Sí, cancelar"
  - Then la reserva queda `cancelled` con `refundStatus=done`, el doble recibió `POST /v1/refunds` sobre el
    PaymentIntent de su session por el total, `payments` tiene la fila `refund` y el cobro `refunded`, la
    página muestra "Reembolso de … procesado" y llega el correo `reservation_cancelled_guest` (#272).
- **Endpoints clave:** `POST /api/public/booking`, `POST /api/public/webhook/stripe/:hotelId`,
  `GET /api/reservas/:id`, `GET /api/reservations/:id`, `POST /api/reservas/:id/checkin`, `GET /api/folios/:id`,
  `POST /api/public/reservations/:id/cancel`, `GET /api/public/reservations/:id/receipt.pdf`; seed:
  `PUT /api/booking-engine/config`, `PUT /api/meal-plans/:code`, `POST /api/upsells`,
  `PUT /api/amenities/room/:id`, `POST /api/configuracion` (`child_policy`, `email_config`),
  `PUT /api/settings/hotel`.
- **UI:** `/book/:slug` (RoomsStep → UpsellsStep → GuestCheckoutStep → PayStep), página del doble de Stripe,
  campanita del panel (`NotificationBell.vue`), `/h/:slug/confirm` (cancelación).
- **Casos borde / errores a cubrir:** el aviso "reserva recibida sin pago" (`hasCheckout=false`), la
  aprobación manual (#271), la expiración de pendientes por cron / `checkout.session.expired` (#266) y el
  rechazo con reembolso quedan fuera de este circuito.
- **Prioridad E2E:** Alta.
- **Cubierto por** `e2e/reservations/public-booking-circuit.spec.ts` (un solo test con `test.step` por
  etapa). Requiere el backend AISLADO apuntando al doble de Stripe y el buzón real:
  ```
  # backend (además de PORT/DB_PATH/JWT_SECRET del entorno aislado)
  PUBLIC_URL=http://localhost:5174 PUBLIC_BASE_URL=http://localhost:5174 \
  STRIPE_SECRET_KEY=sk_test_stub STRIPE_WEBHOOK_SECRET=whsec_stub \
  STRIPE_API_HOST=127.0.0.1 STRIPE_API_PORT=4242 STRIPE_API_PROTOCOL=http \
    bun --env-file=<tmp>/e2e.env src/composition-root.ts
  # vite en :5174 con proxy /api → :3011 (vite.<x>.config.ts dentro de frontend/)
  # spec
  cd frontend && E2E_PORT=5174 E2E_BACKEND_URL=http://localhost:3011 MAILBOX_PASS=… \
    bunx playwright test e2e/reservations/public-booking-circuit.spec.ts --project=chromium
  ```
  `PUBLIC_URL` tiene que ser el origen del FRONTEND: el correo arma con él el enlace `/h/:slug/confirm`
  que el spec abre en Chromium. El doble (`e2e/helpers/stripe-stub.ts`, sobre `node:http`) se levanta
  dentro del spec (`beforeAll`, en 127.0.0.1:4242; `E2E_STRIPE_STUB_PORT` / `E2E_STRIPE_WEBHOOK_SECRET`
  para cambiarlos, siempre en línea con `STRIPE_API_PORT` / `STRIPE_WEBHOOK_SECRET` del backend) y
  sus ids llevan un prefijo aleatorio por proceso (`cs_test_<rand8>_<n>`): se puede correr varias
  veces contra la misma base sin chocar con la idempotencia de `payments.stripeSessionId`. Sin
  `MAILBOX_PASS` se SALTA. Persisten por corrida: 2 reservas pagadas (checked_in / cancelada con
  reembolso) en fechas aleatorias de 2028 y sus cobros.

## 3. Facturación & Pagos

### FAC-01 — Registrar cobro de una factura (parcial, total, sobrepago rechazado)
- **Actor(es):** hotel_admin, receptionist.
- **Precondición:** Factura `pending` con saldo > 0.
- **Permiso requerido:** `billing:edit`.
- **Flujo:** cobro parcial dos veces hasta completar `amountPaid`, pasa a `paid`.
- **Endpoints clave:** `POST /api/facturas/:id/pay`.
- **UI:** `/panel/finanzas/facturacion`.
- **Casos borde / errores a cubrir:** sobrepago ($150 sobre saldo $100) → 400 `ValidationError`, ningún side-effect (ya resuelto — cubrir como regresión); el asiento en `payments` se hace ANTES del update de la factura; método enviado como label en español cae en `other`.
- **Prioridad E2E:** Alta.

### FAC-02 — Anular factura con nota de crédito (anular ≠ borrar)
- **Actor(es):** hotel_admin.
- **Precondición:** Factura no `cancelled`.
- **Permiso requerido:** `billing:edit` (nota de crédito), `billing:delete` (intento de borrado bloqueado).
- **Flujo:** `POST /:id/credit-note` crea fila `type:'credit_note'`, original pasa a `cancelled`.
- **Endpoints clave:** `POST /:id/credit-note`.
- **UI:** `/panel/finanzas/facturacion`.
- **Casos borde / errores a cubrir:** `DELETE` sobre factura `paid`/`overdue`/con pagos/con facturación electrónica → 409 `ConflictError`; anular una ya `cancelled` → error; borrado SÍ permitido si `pending` sin pagos/NCF.
- **Prioridad E2E:** Alta.

### FAC-03 — Cerrar folio y emitir factura en una sola operación
- **Actor(es):** hotel_admin, receptionist.
- **Precondición:** Folio `open` con cargos.
- **Permiso requerido:** `billing:edit`.
- **Flujo:** `POST /api/folios/:id/invoice` cierra + emite + vincula, atómico.
- **Endpoints clave:** `POST /:id/invoice`.
- **UI:** `/panel/finanzas/folios`, también desde `/panel/finanzas/facturacion`.
- **Casos borde / errores a cubrir:** si falla la creación de factura tras cerrar, se reabre el folio (compensación) y se propaga el error original; si falla el `setInvoice` DESPUÉS de crear la factura, no se reabre (evita doble-facturar) — queda logueado para reconciliar a mano.
- **Prioridad E2E:** Alta.

### FAC-04 — Aplicar pago directo a un folio abierto (sin cerrar)
- **Actor(es):** receptionist.
- **Precondición:** Folio `open` con saldo.
- **Permiso requerido:** `billing:create`.
- **Flujo:** `POST /folios/:id/payments` crea línea `kind:'payment'` + asiento en `payments` (dinero primero; si falla, el folio no se toca).
- **Endpoints clave:** `POST /:id/payments`.
- **UI:** `/panel/finanzas/facturacion`.
- **Casos borde / errores a cubrir:** pago que excede el saldo → 400; folio no `open` → 400; idempotencia por `reference` prefijo `pos:` en cargos concurrentes.
- **Prioridad E2E:** Alta.

### FAC-05 — Cobro con tarjeta vía Stripe Checkout
- **Actor(es):** receptionist, huésped (paga en Stripe).
- **Precondición:** Pasarela Stripe configurada.
- **Permiso requerido:** `billing:create`.
- **Flujo:** `payment` `type:'charge'` se crea ANTES de abrir Stripe (queda registrado aunque el huésped abandone); webhook confirma a `completed`.
- **Endpoints clave:** `POST /api/payments/charge`, webhook `/payments/webhook/:hotelId`.
- **UI:** flujo de cobro embebido.
- **Casos borde / errores a cubrir:** hotel sin pasarela → 400 explícito; `reference`/`metadata` deben viajar completos (bug histórico de idempotencia POS); webhook con firma inválida → rechazado.
- **Prioridad E2E:** Alta.

### FAC-06 — Reembolsar un cobro con tarjeta
- **Actor(es):** hotel_admin.
- **Precondición:** `payment` `completed`, `method:'card'`, con `stripePaymentId` real.
- **Permiso requerido:** `billing:create`.
- **Flujo:** `POST /:id/refund` — Stripe confirma síncronamente, crea `payment` nuevo `type:'refund'`.
- **Endpoints clave:** `POST /api/payments/:id/refund`.
- **UI:** verificar si existe UI dedicada o solo API.
- **Casos borde / errores a cubrir:** cobros POS con tarjeta (`stripePaymentId:''`) → 409 explícito "reembolsá manualmente desde Stripe"; `method !== 'card'` → 400; `status !== 'completed'` → 400; hotel sin Stripe → 400.
- **Prioridad E2E:** Alta.

### FAC-07 — Crear y enviar link de pago a un huésped
- **Actor(es):** receptionist, hotel_admin.
- **Precondición:** Reserva con saldo, Stripe configurado.
- **Permiso requerido:** `billing:create`.
- **Flujo:** crea `PaymentRequest` → Checkout Session → email solo en la primera generación.
- **Endpoints clave:** `POST /payment-requests`, `POST /:id/create-checkout`.
- **UI:** `/panel/finanzas/links-pago`.
- **Casos borde / errores a cubrir:** regenerar checkout de link ya enviado no debe re-spamear el email; Stripe falla → 500 explícito.
- **Prioridad E2E:** Media.

### FAC-08 — Webhook Stripe confirma pago de un link → aplica a reserva y folio
- **Actor(es):** Sistema (Stripe → webhook).
- **Precondición:** `PaymentRequest` `pending` con sesión abierta.
- **Permiso requerido:** N/A (firma Stripe del hotel).
- **Flujo:** asienta pago idempotente, aplica "bridge" (suma a depósito de reserva, confirma si cubre total, postea cargo negativo en folio abierto).
- **Endpoints clave:** `POST /payment-requests/webhook/:hotelId`.
- **UI:** N/A (server-to-server), resultado visible en links de pago y folio.
- **Casos borde / errores a cubrir:** webhook del Hotel A pagando `PaymentRequest` del Hotel B → 403; reintento del mismo evento → no duplica; monto excede saldo del folio → se omite el cargo (estado inconsistente conocido y aceptado) pero el `payment` queda asentado igual; `checkout.session.expired`; `payment_intent.payment_failed`.
- **Prioridad E2E:** Alta.

### FAC-09 — Depósito de garantía: crear, reembolsar y liberar
- **Actor(es):** receptionist, hotel_admin.
- **Precondición:** Reserva existente.
- **Permiso requerido:** `billing:create`.
- **Flujo:** `held` → refund parcial (`partially_refunded`) / refund total (`fully_refunded`) / `release` sin refund (`released`).
- **Endpoints clave:** `POST /api/deposits`, `POST /:id/refund`, `POST /:id/release`.
- **UI:** verificar si hay página dedicada; probablemente embebido en reservas/checkout.
- **Casos borde / errores a cubrir:** **DEUDA REAL**: `create/refund/release` NO tocan Stripe ni `payments`, son solo flags — testear explícitamente que NO aparece ningún `payment` asociado (documentar, no "arreglar"); refund que excede lo disponible → 400; doble refund concurrente serializado con lock.
- **Prioridad E2E:** Media.

### FAC-10 — Turno de caja: abrir, operar y cerrar con arqueo
- **Actor(es):** receptionist (`reception`), rol restaurante (`restaurant`, cajón separado).
- **Precondición:** No hay turno `open` para ese `register`.
- **Permiso requerido:** `billing:create` (abrir/cerrar), `billing:view` (arqueo).
- **Flujo:** el arqueo compara SOLO el efectivo esperado contra lo contado — tarjeta/transferencia NUNCA entran al cajón físico.
- **Endpoints clave:** `POST /caja/shifts/open`, `POST /:id/close`, `GET /:id/reconcile`.
- **UI:** `/panel/finanzas/caja`.
- **Casos borde / errores a cubrir:** abrir turno con uno ya `open` del mismo register → 400; **deuda documentada sin resolver**: no hay unique constraint DB, dos requests casi simultáneos pueden crear 2 turnos abiertos (test de doble-click documentando el comportamiento actual); `register` SIEMPRE lo fija la ruta, nunca el body.
- **Prioridad E2E:** Alta.

### FAC-11 — Registrar gasto operativo
- **Actor(es):** hotel_admin.
- **Precondición:** Ninguna.
- **Permiso requerido:** `billing:create/edit/delete`.
- **Flujo:** gasto manual persistido con `hotelId` forzado del JWT, invalida caché versionada.
- **Endpoints clave:** `POST/PUT/DELETE /api/gastos`.
- **UI:** `/panel/finanzas/gastos`.
- **Casos borde / errores a cubrir:** editar/eliminar un gasto `source !== 'manual'` (generado por payroll/compras) → `ValidationError` "modificalo en su origen".
- **Prioridad E2E:** Media.

### FAC-12 — Reposición de caja chica (petty cash)
- **Actor(es):** hotel_admin.
- **Precondición:** Fondo con `currentBalance < targetAmount`.
- **Permiso requerido:** permiso del módulo `caja-chica`.
- **Flujo:** `requested → completed`, solo al completar se suma al saldo.
- **Endpoints clave:** `POST /petty-cash/replenishments`, `POST /:id/complete`.
- **UI:** `/panel/tesoreria/caja-chica`.
- **Casos borde / errores a cubrir:** completar una reposición ya `completed` → 403 explícito (previene doble-acreditación, buen test de doble-click).
- **Prioridad E2E:** Media.

### FAC-13 — Flujo de reembolso a empleado (draft → paid)
- **Actor(es):** Empleado (crea/envía), hotel_admin (aprueba/paga).
- **Precondición:** Gasto propio a reembolsar.
- **Permiso requerido:** `billing:create/edit/delete`.
- **Flujo:** `draft → submitted → approved → paid`, cada paso valida el estado previo exacto.
- **Endpoints clave:** `POST /expense-claims`, `:id/submit`, `:id/approve`, `:id/reject`, `:id/pay`.
- **UI:** `/panel/rrhh/reembolsos`.
- **Casos borde / errores a cubrir:** editar fuera de `draft` → 400; rechazar uno `paid` → 400; pagar algo no `approved` → 400.
- **Prioridad E2E:** Media.

### FAC-14 — Conciliación bancaria (billing) vs conciliación automática (treasury)
- **Actor(es):** hotel_admin.
- **Precondición:** Pagos completados + extracto bancario.
- **Permiso requerido:** `billing:edit`.
- **Flujo:** dos sub-sistemas DISTINTOS conviven — `POST /api/billing/reconciliation` (parece sin UI que lo consuma) vs `/panel/tesoreria/bancos` → `POST /treasury/reconcile` (auto-match ±3 días, marca `reconciled:1`).
- **Endpoints clave:** `POST /api/billing/reconciliation`, `POST /treasury/reconcile`.
- **UI:** `/panel/tesoreria/bancos` (el flujo con UI real).
- **Casos borde / errores a cubrir:** confirmar con el equipo cuál endpoint es el vigente antes de escribir el E2E — riesgo de testear un flujo muerto (`billing/reconciliation` parece huérfano de UI).
- **Prioridad E2E:** Baja.

### FAC-15 — Reporte de facturación / impuestos y export
- **Actor(es):** hotel_admin.
- **Precondición:** Facturas e ingresos en el rango.
- **Permiso requerido:** `reports:view/export`.
- **Flujo:** distingue devengado (facturado) de cobrado (`payments`); tax-report solo cuenta `type:'invoice'` `paid`.
- **Endpoints clave:** `GET /facturas/tax-report`, `/stats`, `/reports/advanced`, `/reports/export`.
- **UI:** `/panel/finanzas/reportes`.
- **Casos borde / errores a cubrir:** extras de folio vinculados por `reservationId` derivado (bug histórico de extras fuera del reporte); ventana de fecha con upper bound inclusivo; `pendingAmount`/`overdueAmount` deben ser SALDO, no total facturado.
- **Prioridad E2E:** Media.

## 4. Operaciones (Housekeeping / Mantenimiento / Huéspedes)

### OPS-01 — Ciclo completo de limpieza: checkout crea tarea → camarera ejecuta → supervisor aprueba
- **Actor(es):** Sistema (auto), Camarera (`housekeeper`), Supervisor/Admin.
- **Precondición:** Reserva con checkout ejecutado; usuario `housekeeper` existente.
- **Permiso requerido:** `housekeeping:view/edit`.
- **Flujo:** checkout crea tarea automática `pending` → asignada → `start` → evidencia → `complete` → `presence` → `approve` → habitación se libera (antes quedaba trabada, bug #392 resuelto).
- **Endpoints clave:** `PUT /:id`, `PUT /:id/start`, `PUT /:id/complete`, `POST /:id/presence`, `POST /:id/approve`.
- **UI:** `/panel/operaciones/limpieza`.
- **Casos borde / errores a cubrir:** aprobar sin `presence` → 401/403; `rating` fuera de 1-10 → 400; aprobar tarea no `completed` → error.
- **Prioridad E2E:** Alta.

### OPS-02 — Máquina de estados de limpieza: transiciones válidas e inválidas
- **Actor(es):** Camarera, Admin/Supervisor.
- **Precondición:** Tarea existente.
- **Permiso requerido:** `housekeeping:edit`.
- **Flujo:** `pending→in_progress→completed→inspected`, con `completed→pending` (rechazo) e `inspected→pending` (reapertura); salto no permitido → `ValidationError`.
- **Endpoints clave:** `start/pause/resume/complete`, `approve`, `reject`.
- **UI:** `/panel/operaciones/limpieza`.
- **Casos borde / errores a cubrir:** `start` sin `staffId` asignado; `pause`/`resume` fuera de `in_progress`; `complete` sin `startTime`.
- **Prioridad E2E:** Alta.

### OPS-03 — Regresión: nombres de personal se resuelven contra `/api/usuarios`, nunca `employee-profiles`
- **Actor(es):** Admin, Supervisor.
- **Precondición:** Usuarios `housekeeper`/`maintenance` sin fila en `employee_profiles` o con id distinto.
- **Permiso requerido:** `housekeeping:view`, `maintenance:view`.
- **Flujo:** al listar tareas/tickets, el nombre real se muestra siempre, nunca "Sin asignar"/"Usuario"/UUID crudo.
- **Endpoints clave:** `GET /api/usuarios`, `GET /api/housekeeping`, `GET /api/mantenimiento`.
- **UI:** `/panel/operaciones/limpieza`, `/panel/operaciones/mantenimiento`.
- **Casos borde / errores a cubrir:** este ES el bug histórico recurrente (team-chat, housekeeping, maintenance) — test debe fallar explícitamente si el nombre queda vacío/genérico/UUID; verificar que el selector de asignación filtre por rol correcto.
- **Prioridad E2E:** Alta.

### OPS-04 — Evidencia de limpieza en modo FOTO
- **Actor(es):** Camarera, Admin (configura requisitos).
- **Precondición:** Hotel en `completionEvidence:'photos'`.
- **Permiso requerido:** `housekeeping:edit/view`.
- **Flujo:** sube fotos por `areaId` de requisito → visibles en lightbox del detalle.
- **Endpoints clave:** `GET /photo-requirements`, `POST /:id/photos`, `DELETE /:id/photos`.
- **UI:** modal "Ver" en limpieza.
- **Casos borde / errores a cubrir:** foto > límite de tamaño; data URL con formato inválido → 400.
- **Prioridad E2E:** Media.

### OPS-05 — Evidencia de limpieza en modo VIDEO
- **Actor(es):** Camarera, Supervisor.
- **Precondición:** `completionEvidence:'video'`, storage S3 configurado.
- **Permiso requerido:** `housekeeping:edit/view`.
- **Flujo:** upload-url → PUT firmado → confirma → backend re-verifica duración real (`probeMp4`).
- **Endpoints clave:** `POST /:id/video/upload-url`, `POST /:id/video`, `GET /:id/video/view-url`.
- **UI:** detalle "Ver" en limpieza, reproductor.
- **Casos borde / errores a cubrir:** `complete` sin video en modo video → rechazado; video truncado o que excede duración máxima → rechazado.
- **Prioridad E2E:** Media (requiere S3 configurado — considerar mock/skip si no hay entorno con Backblaze).

### OPS-06 — Camarera reporta un desperfecto → abre ticket real de mantenimiento
- **Actor(es):** Camarera.
- **Precondición:** Tarea de limpieza propia.
- **Permiso requerido:** `housekeeping:edit`.
- **Flujo:** `POST /:id/report {type:'maintenance'}` crea ticket real en mantenimiento con fotos y número de habitación.
- **Endpoints clave:** `POST /:id/report`.
- **UI:** botón "Reportar" en detalle de tarea.
- **Casos borde / errores a cubrir:** doble-toque/reintento → idempotente por `sourceTaskId+description`; `type:'supervisor'` NO abre ticket; reportar en tarea de otro hotel → 403.
- **Prioridad E2E:** Alta.

### OPS-07 — Aprobar limpieza exige presencia física del supervisor
- **Actor(es):** Supervisor/Admin.
- **Precondición:** Tarea `completed`.
- **Permiso requerido:** `housekeeping:edit`.
- **Flujo:** `approve` directo sin `presence` → rechazado; `presence` primero, luego `approve {rating,note}` → aprueba.
- **Endpoints clave:** `POST /:id/presence`, `POST /:id/approve`.
- **UI:** flujo en dos pasos en la tarjeta `completed`.
- **Casos borde / errores a cubrir:** aprobar sin presencia (test negativo explícito); `presence` sobre tarea no `completed`.
- **Prioridad E2E:** Alta.

### OPS-08 — Supervisor rechaza limpieza: vuelve a la camarera para repetir
- **Actor(es):** Supervisor/Admin, Camarera.
- **Precondición:** Tarea `completed`.
- **Permiso requerido:** `housekeeping:edit`.
- **Flujo:** `POST /:id/reject {note}` → vuelve a `pending`, camarera notificada.
- **Endpoints clave:** `POST /:id/reject`.
- **UI:** botón "Rechazar" con nota.
- **Casos borde / errores a cubrir:** rechazar tarea no `completed`; la habitación NO se libera (a diferencia de approve).
- **Prioridad E2E:** Media.

### OPS-09 — Ticket de mantenimiento: asignación excluyente técnico interno vs proveedor externo
- **Actor(es):** Admin/Receptionist/Supervisor, Técnico.
- **Precondición:** Usuario `maintenance` + proveedor activo.
- **Permiso requerido:** `maintenance:create/edit`.
- **Flujo:** asignar `providerId` fuerza `assignedTo=''` (un ticket, un dueño) y viceversa.
- **Endpoints clave:** `POST/PUT /api/mantenimiento`.
- **UI:** `/panel/operaciones/mantenimiento`, `/panel/operaciones/proveedores`.
- **Casos borde / errores a cubrir:** técnico/proveedor de otro hotel → 400; asignar ambos en un request → resuelve exclusión.
- **Prioridad E2E:** Alta.

### OPS-10 — Máquina de estados de mantenimiento y auditoría de cambios
- **Actor(es):** Técnico, Admin.
- **Precondición:** Ticket `open`.
- **Permiso requerido:** `maintenance:edit/view`.
- **Flujo:** `open→in_progress→closed`, cada cambio queda en `maintenance_audit`.
- **Endpoints clave:** `POST /:id/start`, `POST /:id/complete`, `GET /:id/audit`.
- **UI:** detalle de ticket, pestaña Historial.
- **Casos borde / errores a cubrir:** `start` sobre ticket no `open`; transición inválida; borrar ticket con historial deja rastro en audit log global.
- **Prioridad E2E:** Media.

### OPS-11 — Alta/edición/baja lógica de Proveedor de servicios
- **Actor(es):** Admin, Supervisor.
- **Precondición:** Ninguna.
- **Permiso requerido:** `maintenance:view/edit`.
- **Flujo:** CRUD del catálogo; baja es LÓGICA (`active:false`), tickets viejos conservan el nombre.
- **Endpoints clave:** `GET/POST/PUT/DELETE /mantenimiento/proveedores`.
- **UI:** `/panel/operaciones/proveedores`.
- **Casos borde / errores a cubrir:** crear sin `name` → 400; proveedor de otro hotel → 404/403; dado de baja no debe aparecer en selector de asignación pero sí en tickets ya asignados.
- **Prioridad E2E:** Media.

### OPS-12 — Alta de huésped con unicidad de email/documento por hotel
- **Actor(es):** Recepcionista/Admin.
- **Precondición:** Ninguna.
- **Permiso requerido:** `guests:create`.
- **Flujo:** mismo email en el mismo hotel → 409; mismo email en OTRO hotel → permitido (unicidad por hotel).
- **Endpoints clave:** `POST/PUT /api/huespedes`.
- **UI:** `/panel/guests`.
- **Casos borde / errores a cubrir:** email inválido → 400 antes de chequear duplicado; edición que colisiona con otro huésped → 409.
- **Prioridad E2E:** Alta.

### OPS-13 — No se puede borrar un huésped con reservas/folios asociados
- **Actor(es):** Admin.
- **Precondición:** Huésped con historial.
- **Permiso requerido:** `guests:delete`.
- **Flujo:** `DELETE` sobre huésped con FK → mapeado a `ConflictError` 409 legible (no 500 crudo).
- **Endpoints clave:** `DELETE /api/huespedes/:id`.
- **UI:** `/panel/guests`.
- **Casos borde / errores a cubrir:** verificar mensaje legible; ownership cross-hotel.
- **Prioridad E2E:** Media.

### OPS-14 — Chats del equipo: monitor de mensajes agrupados con nombres resueltos
- **Actor(es):** Admin/Supervisor (solo lectura).
- **Precondición:** Mensajes entre usuarios del hotel.
- **Permiso requerido:** guard de la ruta.
- **Flujo:** agrupa por par de usuarios + canal `team:`, nombres resueltos por `/api/usuarios`.
- **Endpoints clave:** `GET /messages/all`.
- **UI:** `/panel/operaciones/chats`.
- **Casos borde / errores a cubrir:** mismo bug histórico que OPS-03; vista es solo lectura.
- **Prioridad E2E:** Baja.

> Nota: `backend/src/modules/tickets/` es un sistema de soporte/incidencias genérico separado
> (permiso `reports:*`), sin relación con los tickets de mantenimiento — no confundir en tests.

## 5. RRHH (Talento & Nómina)

### RRHH-01 — Alta de empleado (crea cuenta de usuario + legajo, con rollback)
- **Actor(es):** hotel_admin.
- **Precondición:** Hotel con módulo `hr.employees` habilitado.
- **Permiso requerido:** `users:create`.
- **Flujo:** crea `users` (login) y luego `employee_profiles`; si falla el segundo, rollback borra el user (no queda cuenta huérfana).
- **Endpoints clave:** `POST /api/usuarios`, `POST /api/employee-profiles`.
- **UI:** `/panel/rrhh/empleados`.
- **Casos borde / errores a cubrir:** verificar que el rollback efectivamente borra el user si falla el legajo; legajo duplicado para el mismo `userId+hotelId` → error.
- **Prioridad E2E:** Alta.

### RRHH-02 — Listado de empleados: nombre resuelto por `/usuarios` y datos sensibles ocultos por rol
- **Actor(es):** hotel_admin, receptionist.
- **Precondición:** Legajos activos e inactivos.
- **Permiso requerido:** `users:view`.
- **Flujo:** `GET /api/employee-profiles` enriquece con `userName` batched; si el rol no es admin, despoja `salary`/`bankAccount`/etc.
- **Endpoints clave:** `GET /api/employee-profiles`.
- **UI:** `/panel/rrhh/empleados`.
- **Casos borde / errores a cubrir:** legajo huérfano (userId ya no existe) no debe mostrar UUID crudo; `receptionist` pidiendo el listado NO debe traer `salary` en el JSON (no solo ocultarlo en UI).
- **Prioridad E2E:** Alta.

### RRHH-03 — Baja y reactivación de legajo (soft-delete reversible)
- **Actor(es):** hotel_admin.
- **Precondición:** Legajo activo.
- **Permiso requerido:** `users:delete`/`edit`.
- **Flujo:** `DELETE` → `active:0`; `POST /:id/reactivate` → vuelve a `active:1`.
- **Endpoints clave:** `DELETE /:id`, `POST /:id/reactivate`.
- **UI:** `/panel/rrhh/empleados`.
- **Casos borde / errores a cubrir:** legajo de otro hotel bloqueado; reactivar uno ya activo (idempotencia).
- **Prioridad E2E:** Media.

### RRHH-04 — Alta y terminación de contrato laboral
- **Actor(es):** hotel_admin.
- **Precondición:** Legajo existente.
- **Permiso requerido:** `users:create/edit`.
- **Flujo:** valida `salary>0`, `startDate` no futura, `endDate>=startDate`; `POST /:id/terminate` → `terminated`.
- **Endpoints clave:** `POST /employee-contracts`, `POST /:id/terminate`.
- **UI:** `/panel/rrhh/empleados` (tab Contratos).
- **Casos borde / errores a cubrir:** `salary<=0`; `startDate` futura; terminar un contrato ya terminado; rol no privilegiado listando SIN `salary` en la respuesta.
- **Prioridad E2E:** Alta.

### RRHH-05 — Solicitud de licencia/vacaciones con cálculo automático de días hábiles
- **Actor(es):** Empleado (autoservicio) o hotel_admin a nombre de otro.
- **Precondición:** Legajo válido.
- **Permiso requerido:** `users:create`.
- **Flujo:** el `days` que manda el cliente se IGNORA — el servidor recalcula restando festivos/no laborables.
- **Endpoints clave:** `POST /api/leave-requests`.
- **UI:** `/panel/rrhh/empleados` (tab Ausencias).
- **Casos borde / errores a cubrir:** `endDate<startDate`; rango 100% en festivos → 0 días → error; probar mandando un `days` absurdo y verificar que se ignora.
- **Prioridad E2E:** Alta.

### RRHH-06 — Aprobación / rechazo de solicitud de licencia
- **Actor(es):** hotel_admin/supervisor.
- **Precondición:** Solicitud `pending`.
- **Permiso requerido:** `users:edit`.
- **Flujo:** `approve`/`reject {reason}`; procesar dos veces la misma → error.
- **Endpoints clave:** `POST /:id/approve`, `POST /:id/reject`.
- **UI:** `/panel/rrhh/empleados`.
- **Casos borde / errores a cubrir:** doble aprobación/rechazo (idempotencia negativa, debe fallar la 2da vez).
- **Prioridad E2E:** Alta.

### RRHH-07 — Fichaje de entrada/salida con cálculo de horas y overtime
- **Actor(es):** Empleado (autoservicio).
- **Precondición:** Legajo, horario configurado.
- **Permiso requerido:** `attendance:create`.
- **Flujo:** entrada→salida calcula `totalHours` (descontando break) y `overtimeHours`, normalizando turnos que cruzan medianoche.
- **Endpoints clave:** `POST /clock-in`, `POST /clock-out`, `POST /break/start|end`.
- **UI:** `/panel/attendance`.
- **Casos borde / errores a cubrir:** doble entrada/salida el mismo día → error; salida sin entrada → error; turno nocturno (22:00→06:00) no debe dar overtime absurdo; break debe descontarse del total.
- **Prioridad E2E:** Alta.

### RRHH-08 — Corrección manual de fichaje por supervisor
- **Actor(es):** hotel_admin/supervisor.
- **Precondición:** Empleado del mismo hotel.
- **Permiso requerido:** `attendance:edit`.
- **Flujo:** `POST /manual` valida `employeeId` del hotel, `clockOut>clockIn`, total ≤ 24h.
- **Endpoints clave:** `POST /attendance/manual`.
- **UI:** `/panel/attendance`.
- **Casos borde / errores a cubrir:** empleado de otro hotel → error; rango > 24h → rechazado (bug histórico de nómina inflada).
- **Prioridad E2E:** Media.

### RRHH-09 — Corrida de nómina completa: crear → calcular → aprobar → pagar
- **Actor(es):** hotel_admin.
- **Precondición:** Conceptos de nómina configurados, empleados con `salary`.
- **Permiso requerido:** `payroll:create/edit`.
- **Flujo:** `draft` → prefill (salario+horas de asistencia) → `calculate` (engine: base según frecuencia, descuenta ausencias, OT, conceptos, ISR sobre base imponible) → `approve` (genera payslip numerado) → `pay` (asienta `payroll_payment_history`, idempotente).
- **Endpoints clave:** `POST /payroll/runs`, `GET /:id/prefill`, `POST /:id/calculate`, `POST /:id/approve`, `POST /:id/pay`.
- **UI:** `/panel/rrhh/payroll`.
- **Casos borde / errores a cubrir:** corrida duplicada para mismo hotel+período; `calculate` sobre no-`draft`; `approve` sobre no-`calculated`; `pay` sobre no-`approved`; `employeeId` duplicado en el array → rechazado (se pagaría 2 veces); montos negativos → rechazado; verificar el `netPay` final con un caso concreto (ausencias + OT + ISR); reintentar `pay` no duplica `payroll_payment_history`.
- **Prioridad E2E:** Alta — la más crítica del dominio, mueve plata real.

### RRHH-10 — Cancelación de corrida de nómina
- **Actor(es):** hotel_admin.
- **Precondición:** Corrida en `draft`/`calculated`/`approved` (NUNCA `paid`).
- **Permiso requerido:** `payroll:delete`.
- **Flujo:** `POST /:id/cancel` borra `payroll_run_details` y pasa a `cancelled`.
- **Endpoints clave:** `POST /runs/:id/cancel`.
- **UI:** `/panel/rrhh/payroll`.
- **Casos borde / errores a cubrir:** cancelar una `paid` → `ValidationError` explícito (el dinero ya salió).
- **Prioridad E2E:** Media.

### RRHH-11 — Evaluación de desempeño manual (crear → autoevaluación → completar, inmutable)
- **Actor(es):** hotel_admin/supervisor, empleado (autoevaluación).
- **Precondición:** Legajo del evaluado.
- **Permiso requerido:** `users:create/edit`.
- **Flujo:** `draft` → edita (incluye autoevaluación del empleado) → `complete` → de ahí en más solo lectura.
- **Endpoints clave:** `POST /performance-reviews`, `PUT /:id`, `POST /:id/complete`.
- **UI:** `/panel/rrhh/empleados` o `/panel/rrhh/evaluacion`.
- **Casos borde / errores a cubrir:** editar una ya `completed` → rechazado; completar dos veces → rechazado.
- **Prioridad E2E:** Media.

### RRHH-12 — Motor de evaluación automática (score ponderado desde data real)
- **Actor(es):** hotel_admin.
- **Precondición:** Config del motor con pesos/umbrales.
- **Permiso requerido:** `users:edit/view`.
- **Flujo:** `POST /performance-eval/run` calcula score renormalizado (si falta data de un criterio, su peso sale del denominador); empleados sin ningún dato → `skipped`, no se inventa score.
- **Endpoints clave:** `POST /performance-eval/run`, `GET /results`.
- **UI:** `/panel/rrhh/evaluacion`.
- **Casos borde / errores a cubrir:** re-correr el mismo período actualiza en vez de duplicar; empleado solo con datos de asistencia → score renormalizado sobre esos criterios únicamente; ojo con las claves de join distintas por fuente (`userId` vs `employee_profiles.id`).
- **Prioridad E2E:** Media.

### RRHH-13 — Pipeline de reclutamiento: postulante → contratado → vínculo automático a legajo (o no)
- **Actor(es):** hotel_admin.
- **Precondición:** Postulante en etapa activa.
- **Permiso requerido:** `users:create/edit`.
- **Flujo:** `hire` dispara `linkHiredApplicantToEmployee` — solo vincula/crea legajo si YA existe un `users` con ese email en el hotel; si no existe, queda `hired` SIN legajo (no fabrica credenciales).
- **Endpoints clave:** `POST /applicants/:id/stage`, `POST /:id/hire`.
- **UI:** `/panel/rrhh/reclutamiento`.
- **Casos borde / errores a cubrir:** contratar uno ya `hired` → error; email que matchea un `users` de OTRO hotel → NO debe vincularse (aislamiento del match); rechazar uno ya `hired` → error.
- **Prioridad E2E:** Alta — mezcla flujo de negocio + el gotcha user↔profile documentado en CLAUDE.md.

### RRHH-14 — Inscripción y finalización de capacitación
- **Actor(es):** hotel_admin/supervisor, empleado (recibe email).
- **Precondición:** Curso activo, empleado con legajo.
- **Permiso requerido:** `users:edit`.
- **Flujo:** `enrolled` → email con `confirmToken` → `complete` desde panel o link público sin login.
- **Endpoints clave:** `POST /training/enrollments`, `POST /:id/complete`, `GET/POST /training/confirm/:token`.
- **UI:** `/panel/rrhh/capacitacion`.
- **Casos borde / errores a cubrir:** token inválido/ya usado no debe reusarse; `employeeId` fuera del hotel → rechazado.
- **Prioridad E2E:** Baja.

## 6. Marketing & Comunicación

### MKT-01 — Crear y activar un auto-mensaje (envío automático por evento de reserva)
- **Actor(es):** hotel_admin.
- **Precondición:** Módulo `settings` habilitado en el plan.
- **Permiso requerido:** `settings:create/view/edit/delete`.
- **Flujo:** crea auto-mensaje con `triggerEvent`, canal, plantilla, activo → disponible para que el cron lo dispare.
- **Endpoints clave:** `GET/POST/PUT/DELETE /api/auto-messages`.
- **UI:** `/panel/config/mensajeria?tab=auto-messages`.
- **Casos borde / errores a cubrir:** `triggerEvent` fuera de enum → 400; editar/borrar de otro hotel → 403.
- **Prioridad E2E:** Alta.

### MKT-02 — Disparo automático del recordatorio de pre-check-in (cron + `pre_checkin_url`)
- **Actor(es):** Sistema (cron), huésped (receptor).
- **Precondición:** Auto-mensaje `pre_checkin` activo, reserva con checkIn en el offset configurado.
- **Permiso requerido:** N/A (job); ver resultado requiere `settings:view`.
- **Flujo:** ya cubierto a nivel UNITARIO (`backend/src/modules/marketing/tests/auto-messages-cron.test.ts`, dedup y variable `pre_checkin_url`). E2E: verificar que el auto-mensaje configurado en UI resulta en fila de `message-logs` correcta al invocar el trigger manualmente.
- **Endpoints clave:** N/A HTTP; `GET /api/message-logs`.
- **UI:** `/panel/config/mensajeria?tab=message-logs`.
- **Casos borde / errores a cubrir:** reserva con `preCheckinStatus=completed` → se salta; huésped sin email → log `failed`.
- **Prioridad E2E:** Media (lo core ya está cubierto a nivel unitario).

### MKT-03 — Gestionar plantillas de WhatsApp (catálogo, sin envío real)
- **Actor(es):** hotel_admin, receptionist (lectura).
- **Precondición:** **WhatsApp Business API bloqueado hoy (sin creds Meta)** — se puede probar el CRUD del catálogo, NO el envío real.
- **Permiso requerido:** `settings:view/create/edit/delete`.
- **Flujo:** CRUD de plantilla con `category` y `isActive`.
- **Endpoints clave:** `GET/POST/PUT/DELETE /api/whatsapp-templates`.
- **UI:** `/panel/config/mensajeria?tab=whatsapp-templates`.
- **Casos borde / errores a cubrir:** `category` fuera de enum → 400; `POST` sin `name` → 400; toggle `isActive` persiste (bug histórico ya fixeado).
- **Prioridad E2E:** Media.

### MKT-04 — Consultar historial de envíos (message-logs)
- **Actor(es):** hotel_admin, receptionist.
- **Precondición:** Filas en `message_logs`.
- **Permiso requerido:** `settings:view`.
- **Flujo:** filtra por `reservationId`, orden descendente por `sentAt`.
- **Endpoints clave:** `GET /api/message-logs`.
- **UI:** `/panel/config/mensajeria?tab=message-logs`.
- **Casos borde / errores a cubrir:** sin filtro trae todo el hotel.
- **Prioridad E2E:** Baja.

### MKT-05 — Cola de emails: ver fallidos y reencolar manualmente
- **Actor(es):** hotel_admin.
- **Precondición:** Email con `status=failed`.
- **Permiso requerido:** `settings:view/edit` + module gate `email-queue`.
- **Flujo:** reencolar vuelve a `pending`, `attempts=0`; el worker lo reintenta en el próximo tick.
- **Endpoints clave:** `GET /api/email-queue?status=failed`, `POST /:id/requeue`.
- **UI:** `/panel/config/mensajeria?tab=email-queue`.
- **Casos borde / errores a cubrir:** reencolar de otro hotel → 403; reencolar ya `pending` → idempotente; id inexistente → 404.
- **Prioridad E2E:** Alta — única vía manual de recuperar una notificación crítica que falló.

### MKT-06 — Notificaciones in-app (campanita): leer, marcar y borrar
- **Actor(es):** Cualquier usuario autenticado.
- **Precondición:** Notificaciones broadcast y personales.
- **Permiso requerido:** autenticación (leer/borrar propia); `dashboard:create/edit` (crear/actualizar administrativo).
- **Flujo:** ve broadcast + propias, nunca personales de otro; puede marcar leídas y borrar.
- **Endpoints clave:** `GET/PUT/DELETE /api/notificaciones`.
- **UI:** campanita global, `/panel/notifications`.
- **Casos borde / errores a cubrir:** borrar notificación personal de otro → 403; rol sin `dashboard:view` (housekeeper) igual puede LISTAR (deliberado); `PUT` exige `dashboard:edit` (bug histórico ya corregido).
- **Prioridad E2E:** Alta.

### MKT-07 — Reportar feedback de la app (bug/mejora) → crea issue en GitHub
- **Actor(es):** Cualquier usuario autenticado (staff interno, no huésped).
- **Precondición:** Sesión en cualquier pantalla del panel.
- **Permiso requerido:** autenticación (abierto a todos deliberadamente).
- **Flujo:** pin + screenshot + comentario → crea `feedback_pin` + issue REAL en GitHub con autor resuelto.
- **Endpoints clave:** `POST /api/feedback`, `POST /api/feedback/github-issue`.
- **UI:** widget flotante global.
- **Casos borde / errores a cubrir:** rate-limit por usuario → 429; falla la API de GitHub → 502 pero el pin en DB YA se creó (no se pierde el feedback); `category` fuera de enum → 400.
- **Prioridad E2E:** Alta.

### MKT-08 — Triage de feedback: admin cambia estado o elimina un pin
- **Actor(es):** hotel_admin.
- **Precondición:** Pines existentes.
- **Permiso requerido:** `feedback:view/edit/delete`.
- **Flujo:** `open → in_progress → resolved`; borrar queda auditado.
- **Endpoints clave:** `GET/PATCH/DELETE /api/feedback`.
- **UI:** panel de administración de feedback.
- **Casos borde / errores a cubrir:** pin de otro hotel → bloqueado salvo super_admin.
- **Prioridad E2E:** Media.

### MKT-09 — Invitación a reseña tras el checkout + respuesta pública del huésped
- **Actor(es):** Sistema (dispara al checkout), huésped (vía link público).
- **Precondición:** Reserva `checked_out`, huésped con email.
- **Permiso requerido:** N/A — link `/resena/:token` público, token es la autorización.
- **Flujo:** review `pending` creada al checkout → email con link → huésped responde `rating`+comentario.
- **Endpoints clave:** `GET/POST /api/public/reviews/:token`.
- **UI:** `/resena/:token`.
- **Casos borde / errores a cubrir:** token inexistente → 404; reenviar tras ya responder → 409 `already_submitted`; `rating` fuera de 1-5 → 400; huésped sin email → nunca se crea/envía (best-effort).
- **Prioridad E2E:** Alta.

### MKT-10 — Admin responde una reseña de huésped desde el panel
- **Actor(es):** hotel_admin.
- **Precondición:** Reseña con `response` vacío.
- **Permiso requerido:** `reports:view/edit` + module gate `sales.reviews`.
- **Flujo:** escribe respuesta → `respondedAt` se estampa automáticamente.
- **Endpoints clave:** `GET/PUT /api/opiniones`.
- **UI:** `/panel/resenas`.
- **Casos borde / errores a cubrir:** vaciar la respuesta → `respondedAt` vuelve a null (simetría); reseña de otro hotel → 403.
- **Prioridad E2E:** Alta.

### MKT-11 — Reseñas externas: sincronizar manualmente y controlar qué se publica
- **Actor(es):** hotel_admin.
- **Precondición:** Module gate `sales.reviews`; fetchers configurados (puede faltar en dev/test).
- **Permiso requerido:** `settings:edit` (sync-now), `reports:*` (CRUD) + `requireUserType('merchant')`.
- **Flujo:** sync manual (mismo mecanismo del cron nightly); toggles de publicación de score/comentarios.
- **Endpoints clave:** `POST /external-reviews/sync-now`.
- **UI:** `/panel/pagina-publica/reputacion`.
- **Casos borde / errores a cubrir:** sin fetchers en el entorno → 503 explícito (cubrir para no confundir con bug); usuario sin `hotelId` → 400.
- **Prioridad E2E:** Media.

### MKT-12 — CRM: crear cupón de descuento, validarlo y agotarlo
- **Actor(es):** hotel_admin.
- **Precondición:** Module gate `crm`.
- **Flujo:** cupón `maxUses` → dos usos pasan, el tercero → `ValidationError('Coupon limit reached')`.
- **Endpoints clave:** `POST /crm/coupons`, `POST /coupons/validate`.
- **UI:** `/panel/crm`.
- **Casos borde / errores a cubrir:** `value>100` en percentage → 400; cupón vencido → error; **deuda documentada**: usar el cupón NO aplica el descuento en ningún módulo de dinero real — testear solo el ciclo de vida, no la integración con facturas.
- **Prioridad E2E:** Alta.

### MKT-13 — CRM: otorgar/canjear puntos de fidelidad y verificar suba de nivel
- **Actor(es):** hotel_admin.
- **Precondición:** Huésped con historial.
- **Flujo:** puntos por estadía → tier sube automáticamente al alcanzar umbral (nunca baja); canje nunca deja saldo negativo.
- **Endpoints clave:** `POST /crm/points/award`, `POST /points/redeem`, `GET /balance/:guestId`.
- **UI:** `/panel/crm`.
- **Casos borde / errores a cubrir:** canjear más de lo disponible → rechaza o clampea (verificar comportamiento exacto); una cancelación no debe bajar el tier ya alcanzado.
- **Prioridad E2E:** Alta.

## 7. Dispositivos, Inventario, Compras & Restaurante

### DEV-01 — Generar código de acceso TTLock para una reserva
- **Actor(es):** Recepcionista, Hotel Admin.
- **Precondición:** Reserva con habitación que tiene cerradura vinculada; TTLock conectado.
- **Permiso requerido:** `ttlock:edit`.
- **Flujo:** "+ Generar código" crea PIN de 6 dígitos en BD y lo empuja al hardware.
- **Endpoints clave:** `POST /api/ttlock/generate-code/:reservationId`.
- **UI:** `RoomLockModal.vue` (compartido por `/panel/config/cerraduras` y el wizard de reserva).
- **Casos borde / errores a cubrir:** cerradura offline → código `pending` sin tocar hardware; habitación sin cerradura → 400; reserva de otro hotel → 403.
- **Prioridad E2E:** Alta.

### DEV-02 — Revocar código de acceso (borra el PIN físico)
- **Actor(es):** Recepcionista, Hotel Admin.
- **Precondición:** Código `active`.
- **Permiso requerido:** `ttlock:edit`.
- **Flujo:** borra el PIN del hardware ANTES de marcar `revoked` en BD (si falla el hardware, no queda "revocado" con el PIN aún abriendo).
- **Endpoints clave:** `DELETE /api/ttlock/code/:id`.
- **UI:** `/panel/config/cerraduras`, `RoomLockModal.vue`.
- **Casos borde / errores a cubrir:** código de otro hotel → 403/404; fallo de red al borrar → NO cambia a `revoked`.
- **Prioridad E2E:** Alta.

### DEV-03 — Sincronizar cerraduras + generación automática al pagar la seña
- **Actor(es):** Hotel Admin; sistema (webhook Stripe).
- **Precondición:** Cuenta TTLock conectada.
- **Permiso requerido:** `ttlock:edit`.
- **Flujo:** sync trae cerraduras remotas; el pago de seña dispara `generateCodeIfAbsent` (no duplica si ya hay uno activo/pending, respeta toggle `autoCodesEnabled`).
- **Endpoints clave:** `POST /api/ttlock/sync`.
- **UI:** `/panel/config/cerraduras`.
- **Casos borde / errores a cubrir:** reintento del webhook no duplica PIN; cerradura con auto-códigos desactivados se salta el automático (el manual sí funciona).
- **Prioridad E2E:** Media.

### DEV-04 — Verificar códigos activos y registros de actividad
- **Actor(es):** Hotel Admin.
- **Precondición:** Cerradura sincronizada.
- **Permiso requerido:** `ttlock:view`.
- **Flujo:** lectura en vivo del hardware (PIN vigentes, últimas aperturas 30 días).
- **Endpoints clave:** `GET /locks/:id/active-codes`, `GET /locks/:id/records`.
- **UI:** `/panel/config/cerraduras`.
- **Casos borde / errores a cubrir:** cerradura offline → 400 explícito.
- **Prioridad E2E:** Media.

### DEV-05 — Crear llave maestra (PIN único en todas las cerraduras)
- **Actor(es):** Hotel Admin (bloqueado para recepción).
- **Precondición:** Al menos una cerradura registrada.
- **Permiso requerido:** `ttlock:edit` + rol hotel_admin/super_admin.
- **Flujo:** PIN se aplica a TODAS las cerraduras; si alguna falla, informa cuáles quedaron sin acceso.
- **Endpoints clave:** `POST /api/ttlock/master-keys`.
- **UI:** `/panel/config/cerraduras` tab "Llaves maestras".
- **Casos borde / errores a cubrir:** hotel sin cerraduras → 400; falla en todas → no crea la llave; falla parcial → `status:'partial'`; rol receptionist bloqueado.
- **Prioridad E2E:** Alta.

### DEV-06 — Gestionar puertas de una llave maestra y ver historial de accesos
- **Actor(es):** Hotel Admin.
- **Precondición:** Llave maestra existente.
- **Permiso requerido:** `ttlock:view/edit` + rol admin.
- **Flujo:** agregar/quitar puertas puntuales; revocar completa borra de todas (informa fallos parciales).
- **Endpoints clave:** `POST/DELETE /master-keys/:id/locks/:lockId`, `GET /:id/access-log`, `DELETE /:id`.
- **UI:** modales "Puertas" / "¿Dónde entró?".
- **Casos borde / errores a cubrir:** revocar con cerradura offline → `revoked < total`, UI debe reflejar el fallo.
- **Prioridad E2E:** Media.

### DEV-07 — Monitor de sesiones/dispositivos conectados (solo lectura — bug conocido)
- **Actor(es):** Hotel Admin.
- **Precondición:** Sesiones registradas en tabla `devices`.
- **Permiso requerido:** `settings:view`.
- **Flujo:** lista sesiones con filtros.
- **Endpoints clave:** `GET /api/dispositivos`.
- **UI:** `/panel/config/dispositivos`.
- **Casos borde / errores a cubrir:** **los botones "Cerrar sesión"/"Cerrar todas" NO llaman a ningún endpoint** — solo filtran el array local en Vue; tras F5 reaparecen. Documentar el gap, no testear la revocación como si funcionara.
- **Prioridad E2E:** Baja (solo lectura).

### DEV-08 — Alta de insumo + entrada de stock (costo promedio ponderado)
- **Actor(es):** Hotel Admin, encargado de inventario.
- **Precondición:** Ninguna.
- **Permiso requerido:** `inventory:create/edit`.
- **Flujo:** entrada de stock recalcula `avgCost` ponderado; ledger auditable con `balanceAfter`.
- **Endpoints clave:** `POST /inventario/items`, `POST /items/:id/movements`.
- **UI:** `/panel/inventario`.
- **Casos borde / errores a cubrir:** movimiento repetido con mismo `(source,sourceId)` → idempotente (UNIQUE); `quantity<0` → 400.
- **Prioridad E2E:** Alta.

### DEV-09 — Salida de stock (venta POS) y ajuste por conteo físico
- **Actor(es):** Sistema (venta), Hotel Admin (ajuste manual).
- **Precondición:** Insumo con stock.
- **Permiso requerido:** `inventory:edit`.
- **Flujo:** `out` puede dejar stock negativo (no bloquea la venta); `adjust` fija el stock exacto sin tocar `avgCost`.
- **Endpoints clave:** `POST /items/:id/movements` (`out`/`adjust`).
- **UI:** `/panel/inventario`.
- **Casos borde / errores a cubrir:** `adjust` con costo se ignora; movimiento de otro hotel → 403.
- **Prioridad E2E:** Media.

### DEV-10 — Ciclo completo de compras: requisición → aprobación → orden → recepción → facturación
- **Actor(es):** Solicitante, Aprobador, Recepción de mercancía.
- **Precondición:** Insumos existentes (opcional, línea libre).
- **Permiso requerido:** `purchasing:create/edit`.
- **Flujo:** `draft→submit→approved` → OC copia líneas → recepción parcial/total suma stock → `markInvoiced` genera UN gasto (dedup) → `closed`.
- **Endpoints clave:** `POST /requisitions`, `:id/submit`, `:id/transition`, `POST /orders`, `:id/receive`, `:id/invoice`.
- **UI:** `/panel/compras/requisiciones`, `/panel/compras/ordenes`.
- **Casos borde / errores a cubrir:** enviar requisición de OTRO usuario → 409; recibir más de lo pendiente → 400; línea repetida en el payload no duplica stock (fix QA-H1); doble-facturar dedup; transición inválida → 409.
- **Prioridad E2E:** Alta.

### DEV-11 — Orden de compra directa (sin requisición previa)
- **Actor(es):** Hotel Admin.
- **Precondición:** Proveedor opcional.
- **Permiso requerido:** `purchasing:create`.
- **Flujo:** líneas manuales, impuesto de `configuration('taxes')`, moneda de `hotels.currency`.
- **Endpoints clave:** `POST /compras/orders`.
- **UI:** `/panel/compras/ordenes`.
- **Casos borde / errores a cubrir:** `supplierId` inexistente → 400; línea sin descripción → 400.
- **Prioridad E2E:** Media.

### DEV-12 — POS Restaurante: comanda de salón → cocina (KDS) → cargo a la habitación
- **Actor(es):** Mesero, Cocina.
- **Precondición:** Mesa libre, reserva activa con `roomId`.
- **Permiso requerido:** `restaurant:view/create/edit`.
- **Flujo:** abre comanda `dine_in` → envía a cocina (KDS) → factura → carga SUBTOTAL NETO al folio (evita doble ITBIS).
- **Endpoints clave:** `POST /orders`, `:id/send`, `:id/bill`, `:id/charge-to-room`, `GET /kds`.
- **UI:** `/panel/restaurante/salon`, `/cocina`, `/cobrar/:id`.
- **Casos borde / errores a cubrir:** segunda comanda en mesa ocupada → 409; cargar a habitación con propina → 400 (no se transfiere, hay que cobrarla directo); comanda `cancelled` que se intenta liquidar → 409.
- **Prioridad E2E:** Alta.

### DEV-13 — POS Restaurante: cobro directo con propina y reembolso de tarjeta
- **Actor(es):** Cajero, reembolso requiere `billing:create`.
- **Precondición:** Comanda `billed`/`served`.
- **Permiso requerido:** `restaurant:edit`.
- **Flujo:** efectivo cobra el total bruto; tarjeta abre Stripe (comanda `processing_payment`, mesa NO se libera hasta confirmación); refund solo si `settlement:'payment'`.
- **Endpoints clave:** `POST /orders/:id/pay`, `POST /:id/refund`.
- **UI:** `/panel/restaurante/cobrar/:id`.
- **Casos borde / errores a cubrir:** doble click en "Cobrar con tarjeta" → 409 esperando confirmación; reembolsar orden cargada a folio → 409 (deuda: folio no tiene reversión v1); cancelar en `processing_payment` → 409.
- **Prioridad E2E:** Alta.

### DEV-14 — Catálogo de Ofertas (paquetes/combos y servicios adicionales)
- **Actor(es):** Hotel Admin.
- **Precondición:** Ninguna.
- **Permiso requerido:** `rooms:*` (reusa el permiso de habitaciones) + module gate `sales.packages`.
- **Flujo:** CRUD estándar de paquetes con KPIs derivados.
- **Endpoints clave:** `GET/POST/PUT/DELETE /api/paquetes`.
- **UI:** `/panel/config/promociones`.
- **Casos borde / errores a cubrir:** catálogo standalone — no confundir con `reservation_addons` (módulo aparte, líneas libres cargadas directo a la reserva).
- **Prioridad E2E:** Baja.

## 8. Admin de Plataforma & Configuración

### ADM-01 — Gestionar hotel cliente desde plataforma (cambiar plan/estado/datos)
- **Actor(es):** super_admin.
- **Precondición:** Hotel existente, catálogo de planes.
- **Permiso requerido:** rol `super_admin` + `requireUserType('admin')` (ownership por sentinel `__platform__`, no `guard('module','action')`).
- **Flujo:** cambia plan/status/datos; valida que el plan exista en el catálogo.
- **Endpoints clave:** `GET/PUT /api/admin/hoteles`.
- **UI:** `/admin/hotels`.
- **Casos borde / errores a cubrir:** plan inexistente → 400; hotel inexistente → 404; merchant intentando pegarle a esta ruta → 401/403.
- **Prioridad E2E:** Alta.

### ADM-02 — CRUD de planes de suscripción (features/modules/limits)
- **Actor(es):** super_admin.
- **Precondición:** Ninguna.
- **Permiso requerido:** rol `super_admin`.
- **Flujo:** crea/edita plan con `features`/`modules`/`limits`; `slug` se recalcula si cambia el nombre.
- **Endpoints clave:** `GET/POST/PUT/DELETE /api/admin/plans`.
- **UI:** `/admin/plans`.
- **Casos borde / errores a cubrir:** `name`/`price` faltantes → error; el framework descarta campos complejos (array/object) y el controller los re-inyecta manualmente (riesgo de regresión si se rompe ese merge); borrar un plan asignado a hoteles activos (verificar si hay guard — candidato a bug real).
- **Prioridad E2E:** Alta.

### ADM-03 — Condiciones especiales de suscripción (descuento manual / mes gratis / Fundador-Pionero)
- **Actor(es):** super_admin.
- **Precondición:** Suscripción activa; para categoría, cupo disponible.
- **Permiso requerido:** rol `super_admin`.
- **Flujo:** asigna categoría con CAS (compare-and-swap) sobre el cupo, crea `SubscriptionDiscounts` auditable.
- **Endpoints clave:** `GET /subscriptions/search`, `POST /:hotelId/special-conditions`, `GET/PUT /categories`, `GET/PUT /settings`.
- **UI:** `/admin/subscriptions`, `/admin/subscriptions/founders-pioneers`.
- **Casos borde / errores a cubrir:** sin cupo → error; race de dos admins por el último cupo (CAS pierde uno con mensaje claro); hotel que perdió la categoría antes → rechazo gateado por toggle `founderChurnBlocksReturn`; `discountPct` fuera de rango; desasignar categoría libera el slot y revoca el discount (antes quedaba huérfano, ya fixeado); email sin cuenta → 404.
- **Prioridad E2E:** Alta.

### ADM-04 — Suspender / reactivar suscripción manualmente
- **Actor(es):** super_admin.
- **Precondición:** Suscripción activa (o suspendida, para reactivar).
- **Permiso requerido:** rol `super_admin`.
- **Flujo:** suspensión manual NO dispara `founder_history` (a diferencia de la expiración de gracia); reactivar limpia los campos de suspensión.
- **Endpoints clave:** `POST /:hotelId/suspend`, `POST /:hotelId/reactivate`.
- **UI:** `/admin/subscriptions`.
- **Casos borde / errores a cubrir:** hotel sin suscripción registrada → 404.
- **Prioridad E2E:** Alta.

### ADM-05 — Overrides de módulos por hotel (3ra capa de entitlement)
- **Actor(es):** super_admin.
- **Precondición:** `moduleKey` válido en el catálogo.
- **Permiso requerido:** rol `super_admin`.
- **Flujo:** override `enabled` habilita un módulo pese al plan del hotel; entitlement final = global ∩ plan ∩ override.
- **Endpoints clave:** `GET/POST/DELETE /admin/hotels/:hotelId/module-overrides`.
- **UI:** detalle de hotel en `/admin/hotels`.
- **Casos borde / errores a cubrir:** `moduleKey` inválido → 400; upsert (segundo POST actualiza, no duplica); delete inexistente → 404.
- **Prioridad E2E:** Media.

### ADM-06 — Activar/desactivar módulos del producto globalmente
- **Actor(es):** super_admin (edita), cualquier logueado (lee estado efectivo).
- **Precondición:** Ninguna.
- **Permiso requerido:** edición `super_admin`; lectura cualquiera.
- **Flujo:** desactivar un módulo global lo saca del menú de TODOS los hoteles (salvo override puntual).
- **Endpoints clave:** `GET/PUT /admin/modules`, `GET /api/modules`.
- **UI:** `/admin/modules`.
- **Casos borde / errores a cubrir:** módulos "base" (Dashboard/Configuración/Soporte) siempre activos; cruce con override de ADM-05 (visible solo en el hotel con override, no globalmente).
- **Prioridad E2E:** Alta.

### ADM-07 — Auditoría: consulta de bitácora de acciones
- **Actor(es):** super_admin (cross-hotel), hotel_admin (solo su hotel).
- **Precondición:** Entradas en `audit_log` (solo el sistema escribe, no hay POST HTTP expuesto).
- **Permiso requerido:** `reports:view`.
- **Flujo:** super_admin ve todo, hotel_admin ve filtrado por `assertOwnership`.
- **Endpoints clave:** `GET /api/auditlog`, `GET /api/auditlog/:id`.
- **UI:** `/admin/audit`, `/panel/config/auditoria`.
- **Casos borde / errores a cubrir:** hotel_admin leyendo entrada de otro hotel → 403; listado sin caché (frescura forense inmediata); paginación con tope de `limit`.
- **Prioridad E2E:** Alta.

### ADM-08 — Monitoreo de servidor / salud del sistema
- **Actor(es):** super_admin.
- **Precondición:** Ninguna.
- **Permiso requerido:** rol `super_admin`.
- **Flujo:** métricas agregadas (uptime, salud de servicios).
- **Endpoints clave:** `GET /api/admin/monitoring`.
- **UI:** `/admin/monitoring`.
- **Casos borde / errores a cubrir:** solo lectura, cubrir carga inicial + refresco.
- **Prioridad E2E:** Media.

### ADM-09 — Configuración general del hotel
- **Actor(es):** hotel_admin.
- **Precondición:** Hotel existente.
- **Permiso requerido:** `settings:view/edit`.
- **Flujo:** edita datos/logo/condiciones; el hotel SIEMPRE sale del token (solo super_admin puede overridear con `?hotelId=`).
- **Endpoints clave:** `GET /api/settings`, `PUT /settings/hotel`, `POST /settings/logo`.
- **UI:** `/panel/config` (tabs Hotel/Ubicación/Descripción/Condiciones/Emergencias/RRHH/Amenities/Integraciones).
- **Casos borde / errores a cubrir:** logo sin body o mimetype no-imagen → 400, límite 5MB; contactos de emergencia: lectura sin `settings:view` (housekeeper/maintenance deben poder leerlos), escritura sí exige el permiso; facturación electrónica ya persiste como objeto (regresión de forma); captcha apagado no debe romper el flujo; usuario sin hotel → 404.
- **Prioridad E2E:** Alta.

### ADM-10 — Gestión de API Keys para integraciones externas
- **Actor(es):** hotel_admin (propias), super_admin (cualquier hotel o global).
- **Precondición:** Ninguna.
- **Permiso requerido:** `settings:view/create/edit/delete`.
- **Flujo:** genera secreto, guarda solo el hash; el valor en claro se muestra UNA sola vez.
- **Endpoints clave:** `GET/POST/PUT/DELETE /api/apikeys`, consumida vía `x-api-key` en `/api/public/v1/*`.
- **UI:** `/admin/api-keys`.
- **Casos borde / errores a cubrir:** cerrar el modal sin copiar el secreto → irrecuperable; key revocada realmente falla en `apiKeyAuth`; bug histórico de permiso en PUT ya corregido.
- **Prioridad E2E:** Media.

### ADM-11 — Webhooks salientes configurables (con guard anti-SSRF)
- **Actor(es):** hotel_admin, super_admin.
- **Precondición:** Ninguna.
- **Permiso requerido:** `settings:view/create/edit/delete`.
- **Flujo:** registra URL + eventos, valida anti-SSRF, secreto HMAC mostrado una sola vez; "Probar" hace un POST de prueba.
- **Endpoints clave:** `GET/POST/PUT/DELETE /api/webhooks`, `POST /:id/test`.
- **UI:** `/admin/api-keys` (vista combinada).
- **Casos borde / errores a cubrir:** URL a `localhost`/IP privada/metadata cloud → rechazada; protocolo no http/https → rechazado; revalidación antes de cada dispatch (mitiga DNS rebinding, difícil de e2e-testear pero documentar).
- **Prioridad E2E:** Media.

### ADM-12 — Programa Aliados: solicitud y aprobación de certificación
- **Actor(es):** hotel_admin (solicita), super_admin (aprueba/rechaza).
- **Precondición:** Sin solicitud `pending` previa.
- **Permiso requerido:** merchant (aplicar), admin (revisar).
- **Flujo:** cuestionario → `pending` → aprobación crea/actualiza `Partner` con `payoutMode:'monthly'` fijo.
- **Endpoints clave:** `POST /aliados/certification/apply`, `GET /admin/aliados/certification-requests`, `:id/approve`, `:id/reject`.
- **UI:** `/panel/aliados`, `/admin/aliados`.
- **Casos borde / errores a cubrir:** segunda solicitud con una `pending` → 409; aprobar/rechazar ya revisada → 409; conversión a Aliado normal sigue siendo MANUAL, nunca automática al cruzar umbral.
- **Prioridad E2E:** Alta.

### ADM-13 — Programa Aliados: tramos de comisión y marcar comisión pagada
- **Actor(es):** super_admin.
- **Precondición:** Comisiones generadas.
- **Permiso requerido:** rol `super_admin`.
- **Flujo:** marca pagada (idempotente); editar tiers reemplaza la tabla completa.
- **Endpoints clave:** `GET/PUT /admin/aliados/tiers`, `POST /commissions/:id/mark-paid`.
- **UI:** `/admin/aliados`.
- **Casos borde / errores a cubrir:** `aliado_certificado` siempre 20% fijo, nunca escala por tramos aunque se editen; no confundir con el programa de Referrals (meses gratis, distinto).
- **Prioridad E2E:** Media.

### ADM-14 — Activos del hotel: asignar y devolver a un empleado
- **Actor(es):** hotel_admin/receptionist con `users:edit`.
- **Precondición:** Activo `available`; empleado del mismo hotel.
- **Permiso requerido:** `users:*` + module gate `hr.activos`.
- **Flujo:** asignar → `assigned`; devolver → vuelve a `available`.
- **Endpoints clave:** `POST /assets/:id/assign`, `POST /:id/return`.
- **UI:** `/panel/rrhh/activos`.
- **Casos borde / errores a cubrir:** asignar un activo `retired` → error; asignar a empleado de OTRO hotel → error explícito (IDOR); módulo desactivado → 403 (cruce con ADM-06).
- **Prioridad E2E:** Media.

### ADM-15 — Contabilidad: asiento de doble entrada + cierre de período
- **Actor(es):** hotel_admin con permiso de contabilidad.
- **Precondición:** Plan de cuentas sembrado.
- **Permiso requerido:** módulo `accounting`.
- **Flujo:** asiento balanceado (SUM débito=SUM crédito) → cierre de período solo si cuadra → lifecycle `open→closed→locked` estricto.
- **Endpoints clave:** `POST /accounting/journal`, `:id/post`, `POST /periods/:id/close`, `:id/lock`.
- **UI:** `/panel/contabilidad/*`.
- **Casos borde / errores a cubrir:** asiento con menos de 2 líneas → 400; línea con débito Y crédito (o ninguno) → 400; valor NaN (bug histórico ya fixeado); cuenta de otro hotel o no-postable → 400; cerrar período descuadrado → error con montos exactos; postear en período cerrado/bloqueado → 409; bloquear un período `open` sin cerrar → 409.
- **Prioridad E2E:** Media.
