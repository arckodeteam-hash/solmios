# Spec — Soporte real desde el panel de la plataforma

Convención: UI en español, base de datos y API en inglés (RFC 2119: MUST/SHOULD/MAY).

Actores:
- **Agente**: usuario con `userType: 'admin'` (super_admin) operando `/admin/support`.
- **Solicitante**: usuario de un hotel (`userType: 'merchant'`) que abrió el ticket (`tickets.userId`).
- **Hotel**: cualquier usuario del hotel del ticket, que lo ve en `/panel/support`.

---

## REQ-SOP-01 — Solicitante, hotel y agente resueltos por el servidor

`GET /api/tickets` y `GET /api/tickets/:id` MUST devolver, por ticket, además de los campos
actuales:

- `requester: { id, name, email, role, active }` — el usuario de `tickets.userId`.
- `hotel: { id, name }` — el hotel de `tickets.hotelId`.
- `assignee: { id, name } | null` — el usuario de `tickets.assignedTo`.

La resolución MUST hacerse en el servidor y en lote: para una página de N tickets, como máximo
**una** consulta a `users` y **una** a `hotels` (por los ids distintos de la página), nunca una por
fila.

Si el usuario o el hotel ya no existen, el campo MUST venir con `name: ''` y el `id` original; el
listado MUST NOT fallar por un ticket huérfano.

El cliente (navegador) MUST NOT resolver nombres por su cuenta: el hotel no puede consultar usuarios
de la plataforma (el agente no está en `/api/usuarios` de ese hotel), así que el único que puede
decir "quién te atiende" es el servidor.

**Given** un ticket creado por `rosa@solmios.com` (hotel "Caribe Paradise")
**When** el agente pide `GET /api/tickets`
**Then** la fila trae `requester.name: 'Rosa …'`, `requester.email: 'rosa@solmios.com'`,
`hotel.name: 'Caribe Paradise'` y `assignee: null`.

**Given** una página de 20 tickets de 7 hoteles y 12 usuarios distintos
**When** se sirve el listado
**Then** el repositorio de usuarios recibe exactamente 1 llamada y el de hoteles exactamente 1.

**Given** un ticket cuyo `userId` ya no existe en `users`
**When** se lista
**Then** la fila viene con `requester: { id: '<el id>', name: '', email: '', role: '', active: 0 }` y
el resto de la página intacta.

### Base de datos
Ninguna. Los tres campos son derivados; no se persisten.

### API
Campos nuevos en la respuesta de `GET /api/tickets` (`data[]`) y `GET /api/tickets/:id`. Sin cambios
en los parámetros.

### UI
- `/admin/support`: columna "Hotel" con `hotel.name` y columna "Solicitante" con `requester.name`
  y, debajo, `requester.email` + rol. El detalle repite ambos en la cabecera.
- `/panel/support`: cabecera del ticket con "Atendido por {assignee.name}" o "Sin atender todavía".

---

## REQ-SOP-02 — Conversación con autor real, escrita solo por el servidor

`POST /api/tickets/:id/messages` con body `{ message: string }` MUST agregar un mensaje al ticket
con esta forma persistida en `tickets.messages`:

```
{ id, authorId, authorName, authorKind: 'support' | 'hotel', message, createdAt }
```

- `authorId`, `authorName` y `createdAt` los pone el servidor a partir de `req.user`. El body MUST
  NOT poder fijarlos: cualquier campo extra en el body se ignora.
- `authorKind` MUST derivarse del `userType` del token: `'admin'` → `'support'`, cualquier otro →
  `'hotel'`.
- `message` MUST validarse: string, 1..4000 caracteres tras `trim`.
- La ruta MUST llevar `denyImpersonation()`: un agente impersonando a un hotel no escribe en el
  ticket "como el cliente".
- Ownership: un usuario de hotel MUST solo poder escribir en tickets de su `hotelId`; el agente en
  cualquiera. Un ticket `closed` MUST rechazar mensajes nuevos con 409.
- `messages` MUST salir de `UpdateTicketsDTO` y de `UpdateTicketsSchema`: `PUT /api/tickets/:id` con
  `messages` en el body MUST responder 400 (o ignorar el campo — elegir uno y testearlo; se prefiere
  400 para que el cliente viejo falle ruidoso).
- El endpoint MUST devolver el ticket completo enriquecido (REQ-SOP-01) con el mensaje ya incluido.

**Lectura tolerante**: los tickets existentes tienen mensajes con forma `{ author, date, message }`
(escritos por el frontend viejo) o `[]`. El servidor MUST normalizarlos al leer: `author` →
`authorName`, `authorKind: author === 'Soporte Arckode' ? 'support' : 'hotel'`, `authorId: ''`,
`date` → `createdAt` (string tal cual). No se migran datos.

**Given** el agente autenticado (`userType: 'admin'`)
**When** hace `POST /api/tickets/:id/messages { message: 'Ya lo estamos viendo', authorKind: 'hotel', authorName: 'X' }`
**Then** el mensaje persistido tiene `authorKind: 'support'`, `authorName` = nombre real del agente,
y el ticket responde 200 con `messages[-1]` igual a eso.

**Given** un usuario del hotel A
**When** hace `POST /api/tickets/<ticket del hotel B>/messages`
**Then** 403 y el ticket B no cambia.

**Given** un agente con token de impersonación (`impersonatedBy` presente)
**When** hace `POST /api/tickets/:id/messages`
**Then** 403 "No disponible mientras estás viendo la cuenta de un cliente".

**Given** un ticket con `messages: [{ author: 'Hotel Admin', date: '3 sep, 10:15', message: 'hola' }]`
**When** se lee por `GET /api/tickets/:id`
**Then** `messages[0]` es `{ authorId: '', authorName: 'Hotel Admin', authorKind: 'hotel', message: 'hola', createdAt: '3 sep, 10:15' }`.

**Given** un usuario del hotel
**When** hace `PUT /api/tickets/:id { messages: [...] }`
**Then** 400 y `tickets.messages` no cambia.

### Base de datos
Ninguna. Se usa la columna JSON `tickets.messages` existente; cambia la forma de los elementos
nuevos y se tolera la vieja al leer.

### API
- `POST /api/tickets/:id/messages` → 200 `TicketsDTO` enriquecido · 400 validación · 403 ownership /
  impersonación · 404 · 409 ticket cerrado.
- `PUT /api/tickets/:id`: `messages` ya no es aceptado.

### UI
- Ambas vistas envían por `SupportService.addMessage(id, message)`; ninguna arma el objeto mensaje.
- Cada burbuja muestra `authorName` y, si `authorKind === 'support'`, una etiqueta "Soporte".
- El control de "adjuntar imagen" de `/admin/support` se retira (no sube nada hoy).

---

## REQ-SOP-03 — Quién atiende el ticket

`tickets.assignedTo` MUST contener el `users.id` del agente que atiende.

- La **primera** respuesta de un agente (`POST /:id/messages` con `authorKind: 'support'`) sobre un
  ticket sin `assignedTo` MUST asignárselo. Si ya tiene agente, no cambia.
- Pasar el estado a `in_progress` desde un agente MUST asignar el ticket a ese agente si no tenía.
- Si el ticket estaba `open` y un agente responde, el estado MUST pasar a `in_progress` (responder
  es atender).
- `assignedTo` MUST solo poder escribirse desde un token con `userType: 'admin'`: un usuario del
  hotel que mande `assignedTo` en `PUT` recibe 400.
- El ticket enriquecido (REQ-SOP-01) trae `assignee: { id, name }`.

**Given** un ticket `open` sin agente
**When** el agente "Ana" responde
**Then** `assignedTo` = id de Ana, `status: 'in_progress'`, y `GET /api/tickets/:id` desde el hotel
trae `assignee.name: 'Ana'`.

**Given** un ticket ya asignado a "Ana"
**When** el agente "Luis" responde
**Then** `assignedTo` sigue siendo Ana; el mensaje de Luis lleva `authorName: 'Luis'`.

**Given** un usuario del hotel
**When** hace `PUT /api/tickets/:id { assignedTo: '<id>' }`
**Then** 400.

### Base de datos
Ninguna: `assignedTo` ya existe (`tickets/model.ts:17`).

### API
Reglas anteriores sobre `POST /:id/messages` y `PUT /:id`.

### UI
- `/panel/support`, detalle: bloque "Atendido por" con `assignee.name` (nunca un id). Sin agente:
  "Sin atender todavía". Cada respuesta de soporte muestra el nombre del agente y la etiqueta
  "Soporte". Las respuestas propias muestran el nombre real del usuario que escribió, no "Hotel
  Admin".
- `/admin/support`, listado: columna "Atiende" con `assignee.name` o "—".

---

## REQ-SOP-04 — Entrar a la cuenta del solicitante desde el ticket

El detalle del ticket en `/admin/support` MUST ofrecer el botón **"Entrar como {requester.name}"**.

- MUST usar `auth.loginAs(requester.id)` (endpoint existente `POST /api/auth/impersonate/:id`). No
  se crea otro mecanismo de impersonación.
- Tras entrar, la app MUST navegar a `/panel/support?ticket={id}` y `/panel/support` MUST abrir ese
  ticket en el detalle si existe en la lista.
- El botón MUST estar deshabilitado, con el motivo en `title`, cuando `requester.active === 0`
  ("Usuario inactivo") o `requester.role === 'super_admin'`; y MUST NOT mostrarse si la sesión
  actual ya es de impersonación (`auth.impersonating`).
- Mientras se entra, el botón MUST deshabilitarse (sin doble clic) y mostrar "Entrando…".
- El backend MUST registrar en el audit log la impersonación: `action: 'auth.impersonate'`,
  `userId: <agente>`, `hotelId: <del target>`, `entity: 'user'`, `entityId: <target>`, y
  `detail` con el `ticketId` cuando el body trae `{ ticketId }`. El body es opcional; sin él se
  audita igual, sin ticket.
- Si el backend rechaza (403 inactivo / super admin, 404), la UI MUST mostrar el mensaje del
  servidor y quedarse en `/admin/support`.

**Given** un ticket de Rosa (activa, `receptionist`, hotel Caribe Paradise)
**When** el agente pulsa "Entrar como Rosa"
**Then** la franja de impersonación dice que está viendo como Rosa / Caribe Paradise, la URL es
`/panel/support?ticket=<id>` y el ticket está abierto en el detalle; en `audit_log` hay una fila
`auth.impersonate` con `entityId` = id de Rosa y `detail` que contiene el id del ticket.

**Given** un ticket cuyo solicitante está inactivo
**When** se abre el detalle
**Then** el botón está deshabilitado y su `title` dice "Usuario inactivo".

**Given** una sesión que ya está impersonando
**When** se navega a `/admin/support`
**Then** la ruta no es accesible (comportamiento actual de `canAccessSuperAdmin`) — no hay nada que
cambiar, solo verificarlo.

### Base de datos
Ninguna (usa `audit_log` existente).

### API
`POST /api/auth/impersonate/:id` acepta body opcional `{ ticketId?: string }` solo para auditoría.

### UI
Botón en la cabecera del detalle del ticket, junto al estado.

---

## REQ-SOP-05 — `/admin/support` contra la API real

La vista MUST:

- Mapear estados y prioridades **desde los valores reales** (`open/in_progress/resolved/closed`,
  `low/medium/high/urgent`) a etiquetas en español. Un ticket `resolved` MUST aparecer como
  "Resuelto", no como "Abierto".
- Calcular las métricas de cabecera (Total, Abiertos, En progreso, Resueltos, Urgentes) desde el
  listado real. Con 3 tickets `open` MUST decir "Abiertos: 3".
- Leer la conversación de `messages` (no `mensajes`).
- Permitir cambiar el estado desde el detalle: `open → in_progress → resolved → closed`, y reabrir
  (`resolved/closed → open`). Cada cambio MUST persistirse por `PUT /api/tickets/:id { status }` y
  reflejarse al recargar.
- Filtrar por estado (valores reales) y por hotel (desplegable con los hoteles presentes en el
  listado), y buscar por asunto, nombre de hotel y nombre/email del solicitante.
- Mostrar estados vacío, cargando y error propios (no "0 tickets" mientras carga).
- No contener ningún literal de datos: ni `'Soporte Arckode'` como autor, ni hoteles, ni
  respuestas de ejemplo.

Caché del listado: `TicketsService.list` MUST invalidar correctamente la lista del super admin
cuando un ticket se crea, se actualiza o recibe un mensaje. Se adopta el patrón versionado de
`facturas/usecases/cache.ts` (bump de versión), no borrado por clave fija.

**Given** un hotel crea un ticket
**When** el agente recarga `/admin/support` en el mismo segundo
**Then** el ticket está en la lista (no 5 minutos después).

**Given** el agente cambia un ticket a "Resuelto" y recarga
**Then** sigue en "Resuelto" y el contador "Resueltos" lo incluye.

### Base de datos
Ninguna.

### API
Sin endpoints nuevos (usa REQ-SOP-01/02 y `PUT /:id { status }`).

### UI
Reescritura de `frontend/src/pages/super-admin/support.vue` respetando `solmios-ui` (KPIs, tabla,
estados vacíos). Tipos en `frontend/src/types/index.ts`, sin `any`.

---

## REQ-SOP-06 — El hotel se entera de que lo atendieron

Cuando un agente **responde** un ticket o **cambia su estado**, el sistema MUST crear una
notificación in-app para el hotel del ticket (`modules/notificaciones`, vía connector
`tickets-notificaciones`) con el nombre del agente: "Ana respondió tu ticket «Asunto»" / "Ana marcó
tu ticket «Asunto» como Resuelto". La notificación MUST enlazar a `/panel/support?ticket={id}`.

- Un fallo al notificar MUST NOT hacer fallar la respuesta ni el cambio de estado (mismo criterio
  que `auditSafely`).
- Los mensajes escritos por el propio hotel MUST NOT generar notificación al hotel.
- SHOULD enviarse también por email al solicitante, usando la cola existente (`email-queue`), con
  el mismo texto. Si no se implementa en esta entrega, MUST quedar registrado como deuda en
  `tasks.md`.

**Given** un agente responde el ticket T del hotel H
**When** el solicitante abre el panel
**Then** tiene una notificación nueva con el nombre del agente y el asunto; al clicarla se abre T.

**Given** el repositorio de notificaciones lanza una excepción
**When** el agente responde
**Then** la respuesta queda guardada y el endpoint devuelve 200; el fallo queda en el log.

### Base de datos
Ninguna (tabla `notifications` existente).

### API
Ninguna nueva.

### UI
La campana existente muestra la notificación; el link abre el ticket.

---

## REQ-SOP-07 — Pedir ayuda no depende del plan

`/api/tickets` MUST NOT estar gateado por el módulo `operations.maintenance` del plan: cualquier
hotel activo, en cualquier plan, MUST poder listar, crear y responder sus tickets de soporte.

Las incidencias de mantenimiento internas del hotel tienen su propio módulo (`/api/mantenimiento`),
que sí sigue gateado; los tickets son el canal hacia la plataforma.

El permiso granular se mantiene: `reports:view` para ver, `reports:create` para abrir. (Se conserva
para no ampliar el alcance; queda anotado como deuda que "soporte" merece su propio módulo de
permiso.)

**Given** un hotel en un plan sin el módulo de mantenimiento
**When** su admin hace `GET /api/tickets` y `POST /api/tickets`
**Then** 200 y 201; y `/api/mantenimiento` sigue dando 403.

### Base de datos
Ninguna.

### API
Se retira `createModuleGuard(orm)('operations.maintenance')` de las 5 rutas de `tickets/index.ts`.
El test `tickets/tests/plan-gate.test.ts` se invierte para afirmar el nuevo comportamiento.

### UI
Ninguna.
