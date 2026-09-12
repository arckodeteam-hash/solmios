# Spec — Gestión de solicitudes de conexión de OTA (super-admin)

Convención: UI en español, base de datos y API en inglés (RFC 2119: MUST/SHOULD/MAY). Toda ruta
`/api/admin/*` de este spec exige `auth.authenticate('super_admin')` + `requireUserType('admin')`.
Las rutas `/api/channels/requests*` del hotel exigen `guard('channel-manager', ...)` + `resolveTenant`.

---

## REQ-CAN-01 — La pantalla usa el ancho del panel

`/admin/channels` MUST arrancar con el mismo contenedor que las demás vistas admin (sin
`max-w-4xl mx-auto` ni `p-6` propio) y MUST NOT repetir el título que el layout ya pinta en el header.
La bandeja MUST ser legible a 1280px sin que el nombre del hotel se parta en más de una línea ni las
notas se trunquen.

**Given** el super-admin en `/admin/channels` a 1440px
**When** carga la vista
**Then** el contenido ocupa el ancho del área de contenido y no hay dos "Canales (Channel Manager)".

## REQ-CAN-02 — Ciclo de vida del caso

`channel_requests.status` MUST aceptar: `pending` (Solicitada), `scheduled` (Cita agendada),
`in_progress` (En configuración), `waiting_hotel` (Esperando al hotel), `connected` (Conectada),
`rejected` (Rechazada). Los cuatro estados anteriores conservan su valor.

Transiciones permitidas (cualquier otra → 409 `ConflictError`):

| Desde | Hacia |
|---|---|
| `pending` | `scheduled` (con cita) · `rejected` (con motivo) |
| `scheduled` | `scheduled` (reprogramar) · `in_progress` · `waiting_hotel` · `rejected` |
| `in_progress` | `waiting_hotel` · `connected` · `rejected` |
| `waiting_hotel` | `in_progress` · `scheduled` · `rejected` |
| `connected` / `rejected` | ninguna (cerrado; reabrir = nueva solicitud) |

**Given** una solicitud `pending`
**When** el admin manda `PUT /api/admin/channel-requests/:id { status: 'connected' }`
**Then** 409 y la fila no cambia.

**Given** una solicitud `pending`
**When** manda `{ status: 'rejected' }` sin `resolutionReason`
**Then** 400 (validación) y la fila no cambia.

## REQ-CAN-03 — La cita es obligatoria y tiene datos

Agendar (`POST /api/admin/channel-requests/:id/appointment`) MUST recibir `{ at: ISO, medium:
'call'|'whatsapp'|'video', contactName, contactPhone, contactEmail?, note? }` validados con
`validateSchema()`. `at` MUST ser futuro. Agendar MUST dejar el caso en `scheduled`, guardar
`appointmentAt`, `appointmentMedium`, `contactName`, `contactPhone`, `contactEmail`, `assignedTo`
(el admin que agendó) y registrar una actividad `appointment_scheduled`.

Una cita con `appointmentAt < now` y estado `scheduled` es **vencida**: la bandeja MUST resaltarla
y ofrecer "Reprogramar". El backend MUST exponer `overdue: boolean` en el listado.

**Given** cita agendada para ayer, estado `scheduled`
**When** el admin lista `GET /api/admin/channel-requests`
**Then** la fila viene con `overdue: true` y aparece primera en el filtro "Vencidas".

## REQ-CAN-04 — Historial de actividades

Tabla `channel_request_activities` MUST existir: `{ id, requestId (indexed), hotelId (indexed),
kind, actorId?, actorName?, fromStatus?, toStatus?, note (text), payload (json), createdAt }`.
`kind` ∈ `created | status_changed | appointment_scheduled | appointment_rescheduled |
note_added | notified_hotel | notified_admin | reminder_sent`.

Todo cambio de estado, cita y nota MUST crear una actividad en la misma operación que el cambio.
`GET /api/admin/channel-requests/:id` MUST devolver el caso con sus actividades ordenadas por
`createdAt` descendente.

**Given** un caso que pasó `pending → scheduled → in_progress → connected`
**When** el admin abre el detalle
**Then** ve 4 actividades con quién y cuándo, más la de creación.

## REQ-CAN-05 — Datos para el alta manual

El detalle del caso MUST mostrar: `message` del hotel, teléfono y correo de quien pidió, teléfono y
correo del hotel (`hotels.phone`, `hotels.email`), `channexPropertyId` del hotel o "Sin property en
Channex", cantidad de tipos de habitación mapeados, y un enlace al dashboard de Channex del entorno
configurado (`https://staging.channex.io` o `https://app.channex.io`, a la property si existe).

`notes` MUST pasar a `type: 'text'` (multilínea).

**Given** un hotel sin `channexPropertyId`
**When** el admin abre su caso
**Then** ve "Sin property en Channex — el hotel debe Sincronizar primero" y el botón "Abrir en Channex"
apunta a la raíz del dashboard.

## REQ-CAN-06 — El hotel pide con contexto

`POST /api/channels/requests` MUST aceptar `message` (≤500) y `contactPhone` (opcional; default
`hotels.phone`). El modal del panel del hotel MUST pedir ambos. `GET /api/channels/requests` MUST
devolver `appointmentAt`, `appointmentMedium` y `status` (nunca `notes`, `assignedTo` ni actividades
internas).

**Given** el hotel pide Booking.com con mensaje "Hotel ID en Booking: 123456"
**When** el admin abre el caso
**Then** ve el mensaje textual y el teléfono.

## REQ-CAN-07 — Avisos

- Nuevo pedido → correo a `configuration('plataforma').supportEmail` (si está) + notificación in-app
  para `super_admin` (módulo `notificaciones`, vía connector). Best-effort: el fallo no pierde la
  solicitud (regla actual de `requestChannel`).
- Cita agendada / reprogramada → correo al `contactEmail` (o al que pidió) con fecha, hora, medio y
  quién lo va a contactar.
- `connected` → correo al hotel "Tu canal X quedó conectado".
- `rejected` → correo al hotel con `resolutionReason`.
- Cron diario 08:00 (hora del servidor): recordatorio al admin con citas de hoy y vencidas. Dedup por
  `(requestId, appointmentAt, 'reminder_sent')`.

Todo correo MUST usar `{platform_name}`/`{support_email}` de `platform-identity.ts`, sin nombre de
plataforma escrito a mano.

**Given** una cita agendada
**When** se agenda dos veces el mismo día con la misma `appointmentAt`
**Then** el hotel recibe un correo por la primera y otro por la reprogramación, y el recordatorio del
cron sale una sola vez.

### Reserva OTA ingresada (#246, REQ-RWP-03)

- La ingesta de una revisión de Channex que CREA una reserva (`booking-ingestion.ts`, después de
  `orm.create('Reservations')`) emite el socket `onOtaBookingIngested({ hotelId, reservationId, ota })`
  (declarado en `sockets.ts` y en `events` del contrato del módulo, append-only). Dedupe,
  modificación y cancelación NO lo emiten.
- El connector `canales-notificaciones` lo escucha y llama a
  `shared/usecases/notify-reservation-received` con origen `ota`: campanita a los usuarios activos
  del hotel con `reservations:view` (permisos de la fila `roles`), correo a `hotels.email` con
  `{platform_name}`, push si `pushtokens` está. Best-effort: un fallo del aviso no deshace la
  reserva ni impide el ack de la revisión.
- (REQ-HAC-02, #257) La unidad que recibe la reserva OTA se elige con `availableOfType`
  (`shared/usecases/type-availability.ts`): la primera unidad vendible del tipo que no esté ocupada
  esas noches. Si el tipo no tiene ninguna libre, la reserva se crea igual (nunca se dropea un
  booking OTA) sobre la primera unidad del tipo y `notes` lleva `⚠ OVERBOOKING: sin unidad libre de
  <tipo> para esas fechas`. Sin `checkIn`/`checkOut` en el dto, o si la consulta falla, se conserva
  el comportamiento anterior (primera unidad del tipo).

**Given** una revisión nueva de Channex para un hotel con recepción y camarera
**When** la ingesta crea la reserva
**Then** el socket se emite una vez y la recepción ve "Nueva reserva de {OTA} — …" en la campanita;
la camarera no. Una revisión de modificación de esa misma reserva no emite nada.

## REQ-CAN-08 — Bandeja y detalle

La bandeja MUST tener filtros: **Sin atender** (`pending`), **Citas de hoy**, **Vencidas**,
**En gestión** (`scheduled`+`in_progress`+`waiting_hotel`), **Cerradas**. Default: Sin atender +
Vencidas. Cada fila: hotel, canal, quién pidió (con teléfono), fecha del pedido, estado con badge,
próxima acción (cita con fecha o "Agendar"), responsable.

El detalle (drawer o página) MUST ofrecer: Agendar/Reprogramar cita, Cambiar estado (solo a los
permitidos desde el actual), Rechazar con motivo, Nota interna multilínea, Abrir en Channex, y el
timeline de REQ-CAN-04. El canal propio (`solmios-open`) conserva "Conectar ahora".

**Given** un caso `in_progress`
**When** el admin abre el selector de estado
**Then** solo ve `waiting_hotel`, `connected` y `rejected`.

## REQ-CAN-09 — Tarjeta de cuenta Channex

`GET /api/admin/channex-config` MUST devolver además: `dashboardUrl` (por entorno),
`webhook: { registered: boolean, callbackUrl }` (reusar `GET /api/admin/channex-webhook`),
`properties: { inAccount: number, hotelsWithProperty: number, orphans: string[] }` (properties de la
cuenta sin hotel que las referencie), y `planExpiresAt` (fecha manual en
`configuration('channex_account')`, editable desde la tarjeta).

La tarjeta MUST mostrar esos datos y MUST alertar en rojo si `planExpiresAt` está a ≤15 días o
vencido, y en ámbar si el webhook no está registrado.

**Given** `planExpiresAt = 2026-09-09` y hoy 2026-09-10
**When** el admin abre `/admin/channels`
**Then** ve "Plan de Channex vencido el 09 sept 2026 — la ingesta de reservas puede estar cortada".

## REQ-CAN-10 — Compatibilidad del panel del hotel

`CHANNEL_REQUEST_LABELS` y las clases de badge del panel del hotel MUST cubrir los 6 estados. Un
test MUST iterar `CHANNEL_REQUEST_STATUSES` y fallar si falta una etiqueta.
