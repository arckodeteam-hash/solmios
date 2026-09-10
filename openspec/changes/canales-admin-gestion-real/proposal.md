# canales-admin-gestion-real

## Intent

Que `/admin/channels` deje de ser "una tabla con un desplegable" y pase a ser la **gestión real de
un caso de conexión**: cada pedido de un hotel obliga a agendar una cita con el cliente, queda con
historial, avisa a las dos partes y no se cierra hasta que la OTA quedó conectada o se rechazó con
motivo. Y que la tarjeta de la cuenta Channex muestre lo que el admin necesita para hacer el alta
manual, no solo dónde pegar la API key.

Referencia MisterPlan: la activación del channel manager en MisterPlan **no es autoservicio** — la
coordina su equipo de soporte con el hotel (sesión de onboarding, luego configuración de la OTA). Lo
que replicamos es el proceso (cita → configuración → confirmación), no una pantalla en particular.

## El problema, con evidencia

Captura del usuario en prod (2026-09-10): la pantalla ocupa una columna angosta en el centro, la
tabla se achica y las notas se cortan.

| Dato | Realidad | Evidencia |
|---|---|---|
| Contenedor `p-6 max-w-4xl mx-auto` (896px) | Las demás vistas admin arrancan con `<div>` a ancho completo; el layout ya pone el padding | `channels.vue:2` vs `hotels.vue:2`, `subscriptions.vue:2` |
| Título "Canales (Channel Manager)" | Duplicado: el layout ya lo pinta en el header | `channels.vue:4`, `SuperAdminLayout.vue:292` |
| 7 columnas en 896px | Hotel en 3 líneas, "Notas internas" truncadas | captura |
| Estado = `<select>` libre | `pending → connected` sin transición, sin cita, sin contacto, sin historial | `channels.vue:45-49`, `channel-requests.ts:98-110` |
| `message` del hotel | Está en el modelo, **nunca se envía ni se muestra** | `canales/model.ts:70`, `channel-manager/index.vue:489`, `channels.vue` (0 usos) |
| Teléfono del hotel | Existe (`hotels.phone`) y no se muestra | `hoteles/model.ts:11` |
| ¿Ya tiene property en Channex? | Existe (`canales.channexPropertyId`) y no se muestra | `canales/model.ts:14`, `canales/service.ts:152` |
| Aviso al admin | Una línea de `log.info`. El hotel no recibe nada al cambiar el estado | `canales/index.ts:80-84` |
| `PUT /api/admin/channel-requests/:id` | Sin `validateSchema()` (regla del repo) | `canales/index.ts:166` |
| `notes: { type: 'string' }` | Aplasta saltos de línea: nota interna de una sola línea | `canales/model.ts:72` (motivo en `sales-leads/model.ts:20`) |
| Tarjeta de cuenta Channex | Solo credenciales. Sin entorno+URL del dashboard, webhook, properties vs hoteles, vencimiento del plan | `ChannexPlatformConfig.vue` |

## Replanteo

Una solicitud es un **caso** con un ciclo obligatorio. Nadie puede saltear el contacto con el hotel:

```
Solicitada ──agendar cita──▶ Cita agendada ──registrar resultado──▶ En configuración (Channex)
    │                              │                                        │
    │                              └─ reprogramar (cita vencida)            ├─▶ Esperando al hotel
    └──rechazar (motivo)──▶ Rechazada                                       │      (credenciales/contrato OTA)
                                                                             └─▶ Conectada
```

- Salir de `Solicitada` solo por **Agendar cita** o **Rechazar con motivo**.
- Una cita tiene fecha/hora, medio (llamada · WhatsApp · videollamada), contacto (nombre, teléfono,
  correo) y quién la atiende. Vencida sin resultado → "Reprogramar", resaltada en la bandeja.
- Cada cambio deja una **actividad** (quién, cuándo, qué, nota) — historial visible.
- Nuevo pedido → correo + notificación in-app al admin. Cita agendada / conectada / rechazada →
  correo al hotel. Cron diario: citas de hoy y vencidas.
- El caso muestra lo que hace falta para el alta manual: teléfono, mensaje del hotel, property de
  Channex (o "sin property"), tipos de habitación, link directo al dashboard de Channex del entorno.
- Tarjeta de cuenta: entorno + URL del dashboard, user id, webhook registrado o no, properties en la
  cuenta vs hoteles con property (huérfanas), y fecha de vencimiento del plan Channex con alerta.

## Alternativas consideradas

| Opción | Tradeoff | Decisión |
|---|---|---|
| Reusar `sales-leads` (ya tiene `phone`, `status`, `notes`) | Otro ciclo de vida, sin `hotelId`, sin canal. Forzarlo mezcla ventas con soporte | ❌ |
| Solo agregar campos a `channel_requests` (cita, teléfono) sin tabla de actividades | Más barato, pero se pierde el historial: "¿quién la pasó a conectada y cuándo?" no se puede responder | ❌ |
| `channel_requests` ampliada + `channel_request_activities` | Una tabla más, pero el caso queda auditable y el timeline sale de ahí | ✅ |
| Cita como evento de calendario externo (Google) | Dependencia y OAuth por nada: alcanza con fecha + recordatorio por correo | ❌ (MAY después) |
| Máquina de estados en el frontend | Se saltea con un `curl`. Va en el usecase con tests | ✅ backend |

## Alcance

1. Layout a ancho completo y datos que ya existen (mensaje, teléfono, property) — quick win.
2. Modelo del caso: estados nuevos, cita, motivo de cierre, actividades, transiciones en backend.
3. Avisos: admin (nuevo pedido), hotel (cita/conectada/rechazada), cron de citas.
4. Pantalla admin: bandeja con filtros + detalle con timeline + agendar/reprogramar/cerrar.
5. Panel del hotel: pedir con mensaje + teléfono; ver la cita y el estado ampliado.
6. Tarjeta de cuenta Channex con la información operativa.
7. Verificación.

## Fuera de alcance

- Automatizar el alta en Channex (crear el channel de la OTA por API): requiere credenciales del
  hotel en la OTA y contrato; sigue siendo manual en el dashboard de Channex.
- Calendario externo / sincronización con Google Calendar.
- Migrar las solicitudes viejas a un estado nuevo: `pending`/`in_progress`/`connected`/`rejected`
  siguen siendo válidos; los nuevos estados se agregan, no reemplazan.

## Riesgo y rollback

| Riesgo | Mitigación |
|---|---|
| Estados nuevos rompen el panel del hotel (`REQUEST_CLASSES` tipado por estado) | `CHANNEL_REQUEST_LABELS` y clases cubren TODOS los estados; test que itera `CHANNEL_REQUEST_STATUSES` |
| `ADD COLUMN` en `channel_requests` (ormMigrate 1.6.2) | Campos nuevos opcionales, sin rename (rename = columna orphan) |
| Correo al hotel con datos de la cita mal renderizados | Plantilla con variables cerradas, test de render, sin `{platform_name}` hardcodeado |
| Cron de recordatorios manda dos veces | Dedup por `(requestId, appointmentAt, kind)` en `channel_request_activities` |

**Rollback**: aditivo. Columnas nuevas nullable y tabla de actividades independiente; la vista
anterior vuelve con el commit previo sin tocar datos.

## Módulos afectados

- `backend/src/modules/canales/` (model, usecases/channel-requests, index, validators, tests)
- `backend/src/modules/notificaciones/` (aviso in-app al admin) — vía connector
- `backend/src/services/email-service.ts` / plantillas (correos del caso)
- `backend/src/composition-root.ts` (cron de citas)
- `frontend/src/pages/super-admin/channels.vue` (reescritura)
- `frontend/src/components/features/ChannexPlatformConfig.vue`
- `frontend/src/pages/channel-manager/index.vue`, `frontend/src/services/Channel.service.ts`
