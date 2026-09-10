# canales-admin-gestion-real — Tasks

> `/admin/channels` es una columna angosta (`channels.vue:2`) con una tabla cuyo estado se cambia con
> un `<select>` libre (`channels.vue:45-49`). No obliga a contactar al hotel, no muestra el mensaje ni
> el teléfono, no avisa a nadie (`canales/index.ts:80-84`) y la tarjeta de cuenta no dice nada de lo
> que hace falta para el alta manual. Spec: `specs/canales-admin/spec.md`.

## 1. Layout y datos que ya existen (REQ-CAN-01, REQ-CAN-05 parcial) — quick win

- [x] 1.1 Quitar `p-6 max-w-4xl mx-auto` y el `<h1>` duplicado de `channels.vue`.
      **Aceptación**: `grep "max-w-4xl" channels.vue` → vacío; captura a 1440px con la tabla a
      ancho completo y un solo título.
- [x] 1.2 Mostrar `message` del hotel y `hotels.phone`/`hotels.email` en la bandeja (enriquecer el
      listado admin con un join por `hotelId` en el usecase, no en el controller).
      **Aceptación**: test del usecase con un hotel con teléfono → la fila lo trae.
- [x] 1.3 Mostrar `channexPropertyId` (o "Sin property") y el link "Abrir en Channex" por entorno.
      **Aceptación**: hotel sin property → texto explícito; con property → link a la property.
- [x] 1.4 `notes` a `type: 'text'` + `<textarea>` en la UI.
      **Aceptación**: nota con dos líneas se guarda y vuelve con el salto.
- [x] 1.5 `validateSchema()` en `PUT /api/admin/channel-requests/:id`.
      **Aceptación**: `arckode analyze` en 0 violaciones; body `{ status: 'x' }` → 400.

## 2. Modelo del caso (REQ-CAN-02, REQ-CAN-03, REQ-CAN-04)

- [x] 2.1 `channel_requests`: agregar `appointmentAt`, `appointmentMedium`, `contactName`,
      `contactPhone`, `contactEmail`, `assignedTo`, `resolutionReason`, `closedAt` (todos opcionales).
      **Aceptación**: `RUN_MIGRATE=1` agrega las columnas en SQLite y PG; check anti-patrón ORM
      (todo campo usado está en el `orm.define`).
- [x] 2.2 Modelo `channel_request_activities` registrado en `registerCanalesModels`.
      **Aceptación**: tabla creada; `hotelId` indexado.
- [x] 2.3 `CHANNEL_REQUEST_STATUSES` con `scheduled` y `waiting_hotel`; tabla de transiciones en
      `usecases/channel-requests.ts`; `updateChannelRequest` rechaza con `ConflictError` fuera de
      tabla y exige `resolutionReason` para `rejected`.
      **Aceptación**: tests `pending→connected` = 409; `pending→rejected` sin motivo = 400;
      `connected→*` = 409.
- [x] 2.4 `scheduleAppointment()` usecase: valida `at` futuro, setea campos, pasa a `scheduled`,
      crea actividad `appointment_scheduled`/`appointment_rescheduled`.
      **Aceptación**: test con `at` pasado → 400; test de reprogramación → segunda actividad.
- [x] 2.5 Toda mutación crea su actividad (`status_changed`, `note_added`) con `actorId`/`actorName`.
      **Aceptación**: test que hace 3 cambios → 3 actividades + la de creación.
- [x] 2.6 Endpoints: `GET /api/admin/channel-requests` (con `overdue`, filtros `status`, `overdue`,
      `today`), `GET /:id` (con actividades), `POST /:id/appointment`, `POST /:id/notes`,
      `PUT /:id`. Todos con `validateSchema()` y `adminOnly`.
      **Aceptación**: test de 403 con `merchant`; `overdue: true` para cita de ayer.

## 3. Avisos (REQ-CAN-07)

- [x] 3.1 Nuevo pedido → correo a `supportEmail` + notificación in-app a `super_admin` vía connector
      `canales-notificaciones` (sin import directo del módulo).
      **Aceptación**: test con `notify` que falla → la solicitud igual se crea (regla vigente).
- [x] 3.2 Plantillas: `channel_request_scheduled`, `channel_request_connected`,
      `channel_request_rejected` con `{platform_name}`/`{support_email}` resueltos por
      `platform-identity.ts`.
      **Aceptación**: `grep -i "solmios" ` en las plantillas → vacío; test de render con fecha y medio.
- [x] 3.3 Envío al hotel en agendar/reprogramar/conectar/rechazar, registrado como actividad
      `notified_hotel`.
      **Aceptación**: test que agenda → una actividad `notified_hotel` con el destinatario.
- [x] 3.4 Cron diario de citas (hoy + vencidas) al admin, dedup por
      `(requestId, appointmentAt, 'reminder_sent')`. Registrar en `composition-root.ts`.
      **Aceptación**: test que corre el cron dos veces → un solo envío.

## 4. Pantalla admin (REQ-CAN-08)

- [x] 4.1 Bandeja con filtros Sin atender · Citas de hoy · Vencidas · En gestión · Cerradas;
      default Sin atender + Vencidas; contadores por filtro.
      **Aceptación**: verificado en navegador con datos sembrados de cada estado.
- [x] 4.2 Fila: hotel, canal, quién pidió + teléfono, fecha, badge de estado, próxima acción
      (cita con fecha o botón "Agendar"), responsable. Vencidas resaltadas.
      **Aceptación**: captura a 1280px y 1440px sin truncados.
- [x] 4.3 Detalle (drawer): datos para el alta manual (REQ-CAN-05), Agendar/Reprogramar (modal con
      fecha, hora, medio, contacto), selector de estado limitado a transiciones válidas, Rechazar
      con motivo obligatorio, nota multilínea, "Abrir en Channex", "Conectar ahora" para
      `solmios-open`.
      **Aceptación**: en `in_progress` el selector solo ofrece `waiting_hotel`/`connected`/`rejected`.
- [x] 4.4 Timeline de actividades en el detalle.
      **Aceptación**: se ven quién/cuándo/qué de cada cambio.
- [x] 4.5 Estados loading/empty/error propios; `Channel.service.ts` sin `any`.
      **Aceptación**: `vue-tsc -b` limpio; `grep "as any" channels.vue` → vacío.

## 5. Panel del hotel (REQ-CAN-06, REQ-CAN-10)

- [x] 5.1 Modal "¿Pedir esta conexión?" con mensaje (≤500) y teléfono de contacto (default
      `hotels.phone`); `requestChannel` envía ambos.
      **Aceptación**: el pedido llega al admin con mensaje y teléfono.
- [x] 5.2 Tarjeta de la OTA muestra la cita ("Te llamamos el 12 sept 10:00 por WhatsApp") y los 6
      estados con etiqueta y color.
      **Aceptación**: test que itera `CHANNEL_REQUEST_STATUSES` contra `CHANNEL_REQUEST_LABELS` y
      `REQUEST_CLASSES`.
- [x] 5.3 `forHotel()` sigue sin exponer `notes`, `assignedTo` ni actividades.
      **Aceptación**: test de forma del payload.

## 6. Tarjeta de cuenta Channex (REQ-CAN-09)

- [x] 6.1 `getStatus()` devuelve `dashboardUrl`, `webhook.registered`, `properties.{inAccount,
      hotelsWithProperty, orphans}`, `planExpiresAt`.
      **Aceptación**: test con cliente Channex falso con 3 properties y 2 hoteles → 1 huérfana.
- [x] 6.2 `configuration('channex_account').planExpiresAt` editable desde la tarjeta.
      **Aceptación**: guardar y recargar conserva la fecha.
- [x] 6.3 Alertas: rojo si plan vencido o ≤15 días; ámbar si webhook no registrado; lista de
      huérfanas con nombre y id.
      **Aceptación**: captura con fecha vencida → alerta roja con la fecha.
- [x] 6.4 Reemplazar la tarjeta "Cómo conectar un hotel" por el checklist del alta manual
      (Sincronizar → property → channel en Channex con credenciales de la OTA → mapeo → prueba).
      **Aceptación**: cada paso enlaza a la pantalla o al dashboard que corresponde.

## 7. Verificación

- [x] 7.1 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0
      violaciones; `bun run typecheck && bun test` verdes.
- [x] 7.2 `cd frontend && bun run typecheck && bun run build` verdes; capturas a 1280/1440 y móvil
      con datos sembrados de los 6 estados (navegador real, sin desborde horizontal de página y con
      el botón "Abrir" visible a 1280 — la tabla escondía la acción principal porque Tailwind corta
      por viewport y el menú lateral se come 288px).
- [x] 7.3 Deploy: `RUN_MIGRATE=1` en prod (columnas + tabla nueva) + `bun run scripts/seed-platform-email-templates.ts`
      (inserta las 3 plantillas nuevas, insert-only); verificar en prod que el plan de Channex
      (memoria: vencía 2026-09-09) figura en la tarjeta con su alerta. **PENDIENTE — no se desplegó.**
