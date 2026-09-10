# admin-soporte-real

## Intent

Que `/admin/support` sirva para **dar soporte de verdad**: que el equipo de la plataforma vea
**quién** escribió (nombre, email, rol) y **desde qué hotel**, pueda **responder** y que esa
respuesta llegue al cliente, pueda **entrar a la cuenta del solicitante** con un clic para
reproducir el problema, y que el hotel sepa en todo momento **quién lo está atendiendo**.

Referencia MisterPlan: no aplica — MisterPlan no expone su mesa de ayuda dentro del producto. Esto
es operación propia del SaaS.

## El problema, con evidencia

`frontend/src/pages/super-admin/support.vue` (257 líneas) fue escrita contra un backend imaginario.
Cruzada con el módulo real (`backend/src/modules/tickets`):

| Síntoma | Causa | Evidencia |
|---|---|---|
| La columna "Hotel" está vacía y no se ve quién escribió | El mapeo pone `hotel: ''` y el ticket solo trae `userId` y `hotelId` crudos; nadie los resuelve | `support.vue:199` · `tickets/service.ts:34-67` |
| Todos los tickets aparecen "Abierto" y prioridad "Normal"; las métricas de arriba son inútiles | Mapea `abierto/en_progreso/cerrado` y `alta/urgente/media/baja`, pero el backend guarda `open/in_progress/resolved/closed` y `low/medium/high/urgent` | `support.vue:177-178` vs `tickets/types.ts:1-3` |
| La conversación siempre está vacía | Lee `t.mensajes`; la columna del modelo es `messages` | `support.vue:205` vs `tickets/model.ts:18` |
| Lo que responde soporte **se pierde al recargar** | `sendMessage` hace `push` en memoria y nunca llama a la API | `support.vue:232-245` |
| El hotel no sabe quién lo atendió | El autor va fijo como `'Soporte Arckode'`; `assignedTo` nunca se setea y, cuando existe, el hotel lo ve como id crudo | `support.vue:235` · `pages/support/index.vue:125-127,370` |
| El hotel escribe como `'Hotel Admin'`, sea quien sea | Autor hardcodeado del lado del cliente | `pages/support/index.vue:370` |
| Cualquier usuario del hotel puede **fabricar** mensajes "de soporte" | `messages` es escribible por `PUT /api/tickets/:id` con cualquier `author` | `tickets/types.ts:41-50` · `validators/schema.ts` |
| Un ticket nuevo tarda hasta 5 minutos en aparecerle al admin | La clave de caché del super admin es `tickets:list:all` y `create/update` solo invalidan `tickets:list:{hotelId}` | `tickets/service.ts:58-66,88,103` |
| No hay forma de entrar como el solicitante | `POST /api/auth/impersonate/:id` y `auth.loginAs()` existen, pero solo se usan desde `hotels.vue` y `users.vue` | `usuarios/usecases/impersonate.ts` · `stores/auth.store.ts:146-186` |
| Un hotel cuyo plan no incluye "Mantenimiento" **no puede abrir un ticket de soporte** | `/api/tickets` está gateado por `operations.maintenance`; la página de soporte del hotel asume lo contrario | `tickets/index.ts:35-41` vs `pages/support/index.vue:62` |

## Lo que SÍ existe y se reutiliza (no se construye)

- **Impersonación segura**: `usuarios/usecases/impersonate.ts` emite un JWT de 2 h con el rol real
  del cliente, `userType: 'merchant'` y el claim `impersonatedBy`; `denyImpersonation()` protege las
  rutas que cambian credenciales. El frontend ya tiene `auth.loginAs()` y la franja "estás viendo
  como…". Solo falta el botón en el ticket.
- **Notificaciones in-app**: `modules/notificaciones` + el patrón de connectors (`src/connectors/`).
- **Audit log**: `shared/usecases/audit.ts` (`auditSafely`) ya está inyectado en `TicketsService`.
- **Caché versionada**: patrón de `facturas/usecases/cache.ts` (bump de versión, no borrado por clave).

## Alcance

1. El servidor resuelve **solicitante** (`requester`), **hotel** y **quien atiende** (`assignee`)
   en el listado y el detalle. Nada de resolver ids en el navegador.
2. La conversación pasa por un endpoint propio (`POST /api/tickets/:id/messages`): el autor lo pone
   el servidor. `messages` deja de ser escribible por `PUT`.
3. Quien atiende queda registrado: la primera respuesta de soporte (o pasar a "En progreso") asigna
   el ticket al agente. El hotel ve "Atendido por {nombre}" y el nombre del agente en cada respuesta.
4. Botón **"Entrar como {solicitante}"** en el detalle del ticket, con auditoría del acceso vinculado
   al ticket, aterrizando en el ticket del lado del hotel.
5. `/admin/support` reescrita contra la API real: estados y prioridades correctos, métricas que
   suman, cambio de estado, filtro por hotel, búsqueda por hotel/solicitante.
6. Notificación in-app al hotel cuando soporte responde o cambia el estado, con el nombre del agente.
7. Los tickets de soporte dejan de estar gateados por el módulo de mantenimiento del plan.

## Fuera de alcance

- Adjuntos en los mensajes (la UI actual lo simula con `imagePreview`, que nunca se sube). Requiere
  storage y límites; queda para un change propio. En esta entrega el control se retira, no se deja
  roto.
- SLA, tiempos de primera respuesta, reportes de soporte.
- Notificación por email al hotel (queda como SHOULD, detrás de la in-app).
- Asignación a un agente distinto del que responde (no hay más de un agente de plataforma hoy).

## Riesgo y rollback

| Riesgo | Mitigación |
|---|---|
| Un usuario del hotel fabrica un mensaje "de soporte" | `messages` sale del `UpdateTicketsSchema`; el único camino de escritura es `POST /:id/messages`, donde `authorKind` se deriva del `userType` del token, nunca del body. |
| El botón "Entrar como" convierte el ticket en una llave a cualquier cuenta | Reutiliza `impersonateUser` tal cual (rol real, `merchant`, 2 h, sin refresh). Se agrega auditoría con `ticketId`. Deshabilitado si el solicitante está inactivo o es super admin (el backend ya lo rechaza; la UI lo explica antes). |
| Responder un ticket mientras se impersona a un hotel se registraría como si lo escribiera el cliente | `denyImpersonation()` en `POST /:id/messages`: soporte responde desde `/admin/support`, no desde adentro de la cuenta del cliente. |
| Mensajes viejos con forma `{author, date, message}` rompen la lectura | Normalización en lectura (`normalizeMessage`) tolerante a la forma vieja; no se migra data. |
| Resolver nombres por fila multiplica consultas | Resolución en lote por página: una consulta a `users` y una a `hotels` con los ids distintos de la página. |
| Sacar el gate por plan abre `/api/tickets` a hoteles que hoy reciben 403 | Es el comportamiento buscado: pedir ayuda no depende del plan. El aislamiento por `hotelId` no cambia. |

**Rollback**: cambios aditivos en el backend (endpoint nuevo, campos derivados en la respuesta).
Volver la vista al commit anterior restaura la UI; `messages` vuelve al `UpdateTicketsSchema` con un
revert de un archivo. No hay cambio de esquema en base.

## Módulos afectados

- `backend/src/modules/tickets/` (service, controller, types, validators, index — append-only)
- `backend/src/modules/tickets/usecases/` (nuevo: `enrich.ts`, `add-message.ts`, `cache.ts`)
- `backend/src/connectors/tickets-notificaciones.ts` (nuevo)
- `backend/src/modules/usuarios/` (auditoría del impersonate con `ticketId`)
- `frontend/src/pages/super-admin/support.vue` (reescritura)
- `frontend/src/pages/support/index.vue` (quién atiende, autor real, aterrizaje por `?ticket=`)
- `frontend/src/services/Operations.service.ts` o `Support.service.ts` (nuevo método `addMessage`)
- `frontend/src/types/index.ts` (tipos `SupportTicket`, `TicketMessage`, `TicketParty`)
