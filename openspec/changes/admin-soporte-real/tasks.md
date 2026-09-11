# admin-soporte-real — Tasks

> GitHub: epic #120 · issues #129–#136 (uno por bloque, mismo numerado que acá).

> `/admin/support` fue escrita contra un backend imaginario: hotel siempre vacío (`support.vue:199`),
> estados y prioridades mapeados desde valores que no existen (`:177-178`), conversación leída de
> `mensajes` en vez de `messages` (`:205`), y la respuesta de soporte se pierde al recargar porque
> nunca llama a la API (`:232-245`). El hotel no sabe quién lo atiende (`pages/support/index.vue:125,370`).

Verificación transversal de cada tarea de backend: `arckode analyze` → 0 violaciones · `bun run typecheck` · `bun test`.
De cada tarea de frontend: `bun run typecheck` (vue-tsc -b) · `bun run build` · verificado en el navegador.

## 1. Backend — solicitante, hotel y agente resueltos (REQ-SOP-01, REQ-SOP-03)

- [ ] 1.1 `tickets/usecases/enrich.ts`: `enrichTickets(tickets, { userRepo, hotelRepo })` → agrega
      `requester`, `hotel`, `assignee`. Una consulta a `users` y una a `hotels` por página.
      **Aceptación**: test con repos falsos que cuentan llamadas: 20 tickets / 7 hoteles / 12 usuarios
      → `users.findMany` 1 vez, `hotels.findMany` 1 vez. Ticket con `userId` inexistente →
      `requester.name === ''` y la página completa.
- [ ] 1.2 `TicketsService.list` y `getById` devuelven tickets enriquecidos; `TicketsDTO` gana
      `requester`, `hotel`, `assignee` en `types.ts` (API), NO en `model.ts` (BD).
      **Aceptación**: los tests existentes de `service.test.ts` siguen verdes; nuevo test
      `hotel_admin` ve `assignee.name` de un agente que no pertenece a su hotel.
- [ ] 1.3 `assignedTo` solo escribible por `userType: 'admin'`: `UpdateTicketsSchema` lo rechaza
      (400) cuando `req.user.userType !== 'admin'`.
      **Aceptación**: test de controller/service: merchant con `assignedTo` → 400; admin → 200 y persiste.
- [ ] 1.4 Cambio a `in_progress` desde admin asigna si `assignedTo` vacío.
      **Aceptación**: test: ticket sin agente, `PUT { status: 'in_progress' }` por admin →
      `assignedTo === admin.id`; ya asignado → no cambia.

## 2. Backend — conversación con autor real (REQ-SOP-02, REQ-SOP-03)

- [ ] 2.1 `tickets/usecases/add-message.ts`: valida `message` (1..4000 tras trim), arma
      `{ id, authorId, authorName, authorKind, message, createdAt }` desde `req.user`, ownership,
      409 si `closed`, asigna + pasa a `in_progress` si escribe un agente.
      **Aceptación**: tests: body con `authorKind: 'hotel'`/`authorName: 'X'` desde admin → se
      ignora, queda `support` + nombre real · hotel A sobre ticket de B → 403 · ticket `closed` → 409 ·
      primer mensaje de agente sobre `open` sin agente → `assignedTo` = agente y `status: 'in_progress'` ·
      segundo agente no roba la asignación.
- [ ] 2.2 Ruta `POST /api/tickets/:id/messages` con `guard('reports','create')` +
      `denyImpersonation()`. `index.ts` es append-only.
      **Aceptación**: test de ruta: token con `impersonatedBy` → 403.
- [ ] 2.3 `messages` fuera de `UpdateTicketsDTO` y `UpdateTicketsSchema` (400 si viene).
      **Aceptación**: test: `PUT { messages: [...] }` → 400 y la columna no cambia.
- [ ] 2.4 `normalizeMessage` en lectura: forma vieja `{ author, date, message }` → nueva.
      **Aceptación**: test con `author: 'Soporte Arckode'` → `authorKind: 'support'`; con
      `'Hotel Admin'` → `'hotel'`; `[]` → `[]`; JSON inválido → `[]` sin lanzar.
- [ ] 2.5 Socket nuevo `onTicketsMessageAdded(ticket, message)` en `TicketsSockets` (append-only).
      **Aceptación**: test: al agregar mensaje se invoca el socket con el mensaje ya persistido.

## 3. Backend — caché, gate por plan y auditoría del "Entrar como" (REQ-SOP-05, REQ-SOP-07, REQ-SOP-04)

- [ ] 3.1 `tickets/usecases/cache.ts` versionada (patrón `facturas/usecases/cache.ts`): clave con
      versión por hotel + global; `create/update/addMessage/delete` bumpean ambas.
      **Aceptación**: test: `list()` como super_admin → crear ticket en hotel X → `list()` → aparece
      sin esperar TTL. Clave incluye filtros/paginación (dos consultas distintas no comparten entrada).
- [ ] 3.2 Retirar `createModuleGuard(orm)('operations.maintenance')` de las 5 rutas de `tickets/index.ts`.
      **Aceptación**: `tickets/tests/plan-gate.test.ts` invertido: hotel sin módulo mantenimiento →
      `GET/POST /api/tickets` 200/201; `/api/mantenimiento` sigue 403 (test existente del módulo).
- [ ] 3.3 `POST /api/auth/impersonate/:id` acepta body opcional `{ ticketId }` y audita
      `auth.impersonate` (`userId` agente, `hotelId` target, `entity: 'user'`, `entityId` target,
      `detail` con el ticket). Reutilizar `auditSafely`; conectar por el connector de auditoría de
      `usuarios` (crear `usuarios-auditlog.ts` si no existe).
      **Aceptación**: `impersonate.test.ts`: con `ticketId` → fila con el id en `detail`; sin body →
      fila igual sin ticket; el fallo del audit no impide la impersonación.

## 4. Frontend — `/admin/support` contra la API real (REQ-SOP-01, REQ-SOP-03, REQ-SOP-05)

- [ ] 4.1 Tipos `SupportTicket`, `TicketMessage`, `TicketParty` en `frontend/src/types/index.ts`;
      `SupportService` (o `OperationsService.tickets`) con `addMessage(id, message)`. Sin `any`.
      **Aceptación**: `vue-tsc -b` limpio; `grep -n "any" support.vue` → 0 sin justificación.
- [ ] 4.2 Reescribir `super-admin/support.vue` (cargar `solmios-ui` antes): columnas Hotel ·
      Solicitante (nombre + email + rol) · Asunto · Prioridad · Estado · Atiende · Fecha. Mapeo desde
      valores reales. Métricas calculadas. Estados cargando/vacío/error.
      **Aceptación**: `grep -n "mensajes\|Soporte Arckode\|abierto\|en_progreso" support.vue` → 0.
      Con 3 tickets `open` en la DB local, la KPI "Abiertos" dice 3 (captura).
- [ ] 4.3 Detalle: conversación desde `messages` con `authorName` + etiqueta "Soporte"; responder
      llama a `addMessage` y refresca desde la respuesta del servidor; cambio de estado
      (`open → in_progress → resolved → closed`, reabrir) por `PUT`.
      **Aceptación**: responder, F5, la respuesta sigue ahí con el nombre del agente. Cambiar a
      Resuelto, F5, sigue Resuelto y el contador lo incluye.
- [ ] 4.4 Filtro por estado (valores reales), filtro por hotel (desplegable con los hoteles del
      listado), búsqueda por asunto / hotel / nombre / email del solicitante.
      **Aceptación**: buscar `rosa@` filtra al ticket de Rosa.
- [ ] 4.5 Retirar el control de "adjuntar imagen" (no sube nada; adjuntos fuera de alcance).
      **Aceptación**: `grep -n "imagePreview\|FileReader" support.vue` → 0.

## 5. Frontend — "Entrar como" desde el ticket (REQ-SOP-04)

- [ ] 5.1 Botón "Entrar como {requester.name}" en la cabecera del detalle → `auth.loginAs(requester.id, { ticketId })`
      → `router.push('/panel/support?ticket=<id>')`. Estado "Entrando…" sin doble clic. Deshabilitado
      con `title` si `requester.active === 0` o `role === 'super_admin'`. Error del servidor → toast
      con el mensaje y se queda en `/admin/support`.
      **Aceptación**: en el navegador: entrar como Rosa → franja "viendo como Rosa / Caribe Paradise",
      URL `/panel/support?ticket=…`, ticket abierto. Con usuario inactivo → botón deshabilitado y
      `title` "Usuario inactivo". `AuthService.impersonate` manda `{ ticketId }` en el body.
- [ ] 5.2 `pages/support/index.vue`: leer `?ticket=` al montar y abrir ese ticket si está en la lista.
      **Aceptación**: `/panel/support?ticket=<id inexistente>` no rompe ni abre nada.

## 6. Frontend — el hotel sabe quién lo atiende (REQ-SOP-02, REQ-SOP-03)

- [ ] 6.1 `pages/support/index.vue`: "Atendido por {assignee.name}" / "Sin atender todavía"; nunca
      un id. Cada burbuja con `authorName`; las de `authorKind: 'support'` con etiqueta "Soporte";
      las propias con el nombre real del usuario (no "Hotel Admin").
      **Aceptación**: `grep -n "Hotel Admin\|Soporte Arckode" index.vue` → 0. Con un ticket atendido
      por Ana, la cabecera dice "Atendido por Ana" (captura).
- [ ] 6.2 Responder usa `addMessage`; se elimina el `update(..., { messages })`.
      **Aceptación**: `grep -n "messages:" index.vue` → 0 en escrituras. `support-empty.test.ts` sigue verde.

## 7. Backend — notificación al hotel (REQ-SOP-06)

- [x] 7.1 `connectors/tickets-notificaciones.ts`: engancha `onTicketsMessageAdded` (solo
      `authorKind: 'support'`) y `onTicketsUpdated` (cambio de estado por admin) → notificación para
      el hotel con nombre del agente + asunto + link `/panel/support?ticket=<id>`. Registrar en
      `composition-root.ts`. Fallo tragado y logueado.
      **Aceptación**: test del connector: mensaje de soporte → 1 notificación con el nombre del agente;
      mensaje del hotel → 0; repositorio de notificaciones que lanza → el mensaje igual queda guardado.
- [ ] 7.2 SHOULD: email al solicitante por `email-queue` con el mismo texto. Si no entra en esta
      entrega, dejar aquí la deuda con fecha.
      **Aceptación**: fila en `email_queue` con destinatario = `requester.email`, o deuda anotada.
      **Deuda (2026-09-10, #135)**: no entró. El módulo `email-queue` sólo expone `list`/`requeue`;
      el `enqueue` real es `EmailService.enqueue` (`services/email-service.ts`), que se construye en
      `bootstrapEmail()` DESPUÉS de `system.start()` — referenciarlo desde un connector da
      ReferenceError por TDZ (ver nota en `composition-root.ts` junto a `bookingengine-payments`).
      Camino previsto: `tickets.setEmailDeps(...)` inyectado desde `infrastructure/email-bootstrap.ts`
      (mismo patrón que `crm`/`wallet-pass`), reutilizando los textos de `shared/usecases/notify-ticket.ts`.

## 8. Verificación

- [ ] 8.1 Backend: `arckode analyze` (0 violaciones) · `bun run typecheck` · `bun test` (tickets,
      usuarios, connectors) — todos verdes, salida citada.
- [ ] 8.2 Frontend: `bun run typecheck` · `bun run build` · recorrido en navegador de los dos lados
      (agente responde → hotel ve nombre + notificación → agente entra como el solicitante → ticket
      abierto) con capturas.
- [ ] 8.3 `CLAUDE.md`: fila del change en "Estado SDD" y nota en Deudas: `support:*` como permiso
      propio, adjuntos, email (si quedó en SHOULD).

## Deudas que deja este change (registrarlas al cerrar)
- Permiso propio `support:view/create` en vez de reutilizar `reports:*`.
- Adjuntos en mensajes (storage + límites).
- Email al solicitante si 7.2 quedó fuera.
