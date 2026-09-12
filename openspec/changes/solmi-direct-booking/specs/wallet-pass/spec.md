# Wallet Pass Specification (F3)

## Purpose

Generar automáticamente un **wallet pass** (Apple Wallet + Google Wallet) al confirmar
la reserva, con el código TTLock embebido. Ningún booking engine del mercado hace esto
nativo — es uno de los 3 gaps estructurales diferenciales.

TTLock ya está integrado (`ttlock` module + connector `reservas-ttlock.ts` — generaba
código al confirmar reserva). Este spec agrega el layer de wallet pass: tomar ese código
y empaquetarlo en `.pkpass` (Apple) + Google pass object, persistir URLs, y mandar email
al huésped con ambos links.

Decisión (D4 en `design.md`): wallet en F3, NO diferir. Reuso del conector TTLock
existente. Apple requiere cert del hotel dueño ($99/año Apple Developer Program), Google
es gratis. Si Apple no configurado → solo Google pass + email con código TTLock visible.

Equivalente MisterPlan: "Check-in digital con llave móvil" — MisterPlan tiene el check-in
pero NO genera wallet pass nativo; este spec supera al integrar TTLock.

## Requirements

### Requirement: Generación automática al confirmar

El wallet pass MUST generarse automáticamente cuando el webhook Stripe confirma la
reserva (post-F0 unificación). El huésped recibe email con links Apple+Google + código
TTLock visible como fallback.

#### Scenario: Reserva confirmada genera pass

- GIVEN reserva con `paymentStatus='paid'` tras webhook Stripe
- WHEN `onReservationConfirmed` fires
- THEN se genera 1 fila en `wallet_passes` con `appleUrl`, `googleUrl`, `lockCode` (no
  null), `generatedAt`

### Requirement: Reuso del código TTLock

El wallet pass MUST obtener el `lockCode` del conector `reservas-ttlock.ts` existente
(que ya genera el código al confirmar). NO debe haber 2 códigos generados — el pass
reusa el que TTLock ya creó.

#### Scenario: TTLock genera código, pass lo reusa

- GIVEN webhook confirma reserva
- WHEN `onReservationConfirmed` dispara
- THEN `reservas-ttlock.ts` genera `lockCode` (vía `ttlock` module), `reservas-wallet.ts`
  lo recibe y lo embebe en el pass — 1 solo código TTLock, no 2

### Requirement: Apple Wallet pass opcional por hotel

Apple requiere cert Apple Developer del hotel ($99/año, NO cubierto por SOLMI OS). El
pass Apple MUST generarse solo si `configuration(key='apple_pass_cert')` está configurado
y válido. Si no, el sistema genera solo Google pass + email con código TTLock visible.

#### Scenario: Hotel sin cert Apple

- GIVEN hotel sin `apple_pass_cert`
- WHEN se confirma reserva
- THEN `wallet_passes.appleUrl=null`, `googleUrl=<url>`, `lockCode=<code>` — el email
  explica "Agrega tu pase a Google Wallet o usa este código: <code>"

#### Scenario: Hotel con cert Apple válido

- GIVEN hotel con cert válido
- WHEN se confirma reserva
- THEN `wallet_passes.appleUrl=<url>` (link al `.pkpass`), `googleUrl=<url>`, email con
  ambos botones "Agregar a Apple Wallet" + "Agregar a Google Wallet"

#### Scenario: Cert Apple vencido

- GIVEN hotel con cert vencido (firma falla)
- WHEN se confirma reserva
- THEN loguea `apple_pass_error: cert_expired`, `appleUrl=null`, Google pass igual se
  genera (graceful degradation)

### Requirement: Google Wallet pass siempre disponible

Google Wallet es gratis (service account + JWT). El pass Google MUST generarse siempre
que `configuration(key='google_wallet_service_account')` esté configurado (default on
para todos los hoteles, sin costo extra).

### Requirement: Pass regenera si cambia room assignment

Si el admin reasigna habitación después del check-in (cambio de room), el pass MUST
regenerarse con el nuevo `lockCode`. El pass anterior se marca obsoleto (no se sirve más).

#### Scenario: Reasignación de habitación

- GIVEN reserva confirmada con `wallet_pass` generado
- WHEN admin cambia `reservation.roomId` a otra habitación
- THEN `reservas-ttlock.ts` dispara `onRoomReassigned`, `reservas-wallet.ts` regenera el
  pass con nuevo `lockCode`, persiste nueva fila en `wallet_passes` (la vieja se marca
  `obsoleteAt`)

### Requirement: Pase parcial para reservas sin habitación y completado al asignar (#262, REQ-HAC-07)

Con HAC-01 la reserva nace sin `roomId`, así que al pagar no hay cerradura ni `lockCode` y
`generatePass` no persiste nada. El cron de pre-llegada MUST poder mandar igual un pase PARCIAL
(`usecases/partial-pass.ts` → `service.sendPartialPassEmailNow`): tipo vendido, fechas y horario,
habitación "Por asignar", SIN bloque de código y con asunto "Tu pase de reserva — {hotel}".
La fila `wallet_passes` se crea con `lockCode: ''` ANTES de encolar el correo (el UNIQUE por
`reservationId` es lo que impide un doble envío entre corridas solapadas) y se marca `emailSentAt`
al enviarse; si el envío falla la fila se borra para reintentar. Una fila con `lockCode` o con
`emailSentAt` no se reenvía.

`generatePass` MUST tratar una fila parcial como pendiente, no como idempotente: al resolverse un
`lockCode` (connector `reservas-wallet` escucha `reservas.onRoomAssigned` y llama
`generatePass(id, false)`) la completa in-place (`lockCode`, `appleUrl`, `googleUrl`,
`generatedAt`, `emailSentAt: null`) para que el cron mande el pase completo. Sin `lockCode`
(TTLock apagado) la parcial queda intacta.

#### Scenario: pase parcial y completado
- GIVEN reserva `confirmed` sin `roomId` con llegada a 20 h
- WHEN corre el cron de pre-llegada
- THEN el huésped recibe UN correo "Tu pase de reserva" con "Por asignar" y sin código; `wallet_passes` tiene una fila `lockCode: ''` con `emailSentAt`
- WHEN recepción (o el sistema) le asigna habitación
- THEN la misma fila queda con `lockCode` y `emailSentAt: null`, y el siguiente tick manda el pase completo

### Requirement: Email al huésped con ambos links

Tras generar el pass, el sistema MUST encolar email "Tu pase de reserva + código de
acceso" via `email-bootstrap.ts`. Template HTML con:
- Botón "Agregar a Apple Wallet" (si `appleUrl` presente).
- Botón "Agregar a Google Wallet" (si `googleUrl` presente).
- Sección fallback con `lockCode` visible en mono font.
- Detalles de la reserva (hotel, fechas, habitación).

### Requirement: Best-effort, no bloquea webhook

Si la generación del pass falla (cualquier razón), el webhook de confirmación MUST
igual completarse — la reserva queda `confirmed` aunque el pass no se haya generado.
El error se loguea y se reintenta via cron aparte.

#### Scenario: Pass falla, webhook OK

- GIVEN webhook confirma reserva, generador de pass crashea
- WHEN el webhook termina
- THEN la reserva está `confirmed` (no rollback), `wallet_passes` no tiene fila, el log
  muestra `wallet_pass_error`, un cron reintenta cada 1h hasta succeeds o 24h

## Database

- **NEW TABLE** `wallet_passes` (módulo `wallet-pass`)

| Column | Type | Nullability | Notes |
|---|---|---|---|
| `id` | TEXT (uuid) | REQUIRED PK | |
| `hotelId` | TEXT | REQUIRED | FK `hotels.id`, multi-tenant. |
| `reservationId` | TEXT | REQUIRED | FK `reservations.id`. UNIQUE (1 pass vigente por reserva). |
| `appleUrl` | string | nullable | URL firmada al `.pkpass`. Null si cert no configurado/inválido. |
| `googleUrl` | string | nullable | URL "Add to Google Wallet" (JWT). Null si SA no configurada. |
| `lockCode` | string | REQUIRED | Código TTLock embebido. |
| `generatedAt` | datetime | REQUIRED | Timestamp de generación. |
| `obsoleteAt` | datetime | nullable | Set si se regenera por reasignación. |
| `createdAt`, `updatedAt` | datetime | REQUIRED | |

UNIQUE INDEX `(reservationId) WHERE obsoleteAt IS NULL` (PG); en SQLite validación en
usecase (1 pass vigente por reserva).

Anti-patrón ORM (D5): todas las columnas declaradas en `orm.define('WalletPass', ...)`.

## API

### Interno (no público)

- Connector `reservas-wallet.ts` subscribe a `onReservationConfirmed` y
  `onRoomReassigned` → dispara usecase.
- Use case `generate-pass.ts`: orquesta TTLock connector + passkit (Apple) + Google
  Wallet API.

### Cron recovery

- Cron cada 1h: busca reservas `confirmed` SIN `wallet_pass` vigente y (intentos < 24h) →
  reintenta. Best-effort.

### Admin

- `GET /api/wallet-pass/reservation/:reservationId` — devuelve pass actual (admin).

## UI

### Página de confirmación (`frontend/src/pages/public/booking-confirmation.vue`, F3 3.17)

- Estado confirmed/pending/failed.
- Card "Tu acceso al hotel":
  - Si `appleUrl`: botón "Agregar a Apple Wallet" (link directo al `.pkpass`).
  - Si `googleUrl`: botón "Agregar a Google Wallet" (link al save URL).
  - Sección fallback: `lockCode` en mono font grande + ícono de llave.
- Detalles completos de la reserva.

### Email template

HTML responsive con ambos botones + sección código visible + detalles. Asunto:
"Tu pase de reserva + código de acceso — {hotelName}".

## Auth / cert flow (REQUIRED)

### Apple Passkit

1. Hotel dueño paga Apple Developer Program ($99/año).
2. Crea Pass Type ID (`pass.com.solmios.<hotel-slug>`) + signing certificate.
3. Sube `.p12` exportado a Settings → SOLMI OS lo guarda en `configuration(key='apple_pass_cert')`
   con passphrase por separado.
4. SOLMI OS usa `passkit-generator` (npm) para crear `.pkpass` con el cert + team ID +
   passType ID.
5. El `.pkpass` se sirve desde una URL firmada (S3 + presigned URL, 30 días TTL).

### Google Wallet

1. Hotel dueño (o SOLMI OS operator) crea Google Cloud project + service account.
2. Habilita Google Wallet API + crea pass class (`SOLMIOS_{hotelId}`).
3. Sube service account JSON a Settings.
4. SOLMI OS genera JWT con claim para crear pass object por reserva, retorna save URL.
5. URL "Add to Google Wallet" es de la forma
   `https://pay.google.com/gp/v/save/<jwt>` — el usuario click → save en su Google Wallet.
