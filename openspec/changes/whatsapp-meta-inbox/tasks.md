# whatsapp-meta-inbox — Tasks

> **Depende de** `whatsapp-meta-onboarding` y `whatsapp-meta-messaging` (el cliente de envío y la
> normalización de teléfono salen de ahí). Es el paso 6 del vídeo que pide Meta.

## 1. Modelo
- [x] 1.1 `ai_conversations`: agregar `lastInboundAt` y `unreadCount`.
      **Aceptación**: `RUN_MIGRATE=1` agrega las columnas; las conversaciones viejas siguen abriéndose.
- [x] 1.2 `ai_messages`: agregar `senderUserId`.
      **Aceptación**: test que escribe y relee el campo (anti-patrón ORM: si no está declarado en el
      `orm.define`, se descarta sin avisar).
- [x] 1.3 Actualizar los DTOs de conversación y mensaje.
      **Aceptación**: `bun run typecheck` limpio.

## 2. Webhook — registrar el entrante y respetar el silencio
- [x] 2.1 Al recibir un mensaje: actualizar `lastInboundAt` y sumar a `unreadCount`.
      **Aceptación**: test de webhook que verifica los dos campos.
- [x] 2.2 Anteponer al pipeline de IA la condición de estado: si `status='human'`, no responder.
      **Aceptación**: test con la conversación tomada → cero llamadas al modelo de lenguaje.
- [x] 2.3 Una conversación `closed` que recibe un mensaje vuelve a `active`.
      **Aceptación**: test del escenario "conversación cerrada que revive".
- [x] 2.4 Emitir el evento de socket para la bandeja.
      **Aceptación**: el evento sale con `hotelId` y el id de la conversación.

## 3. Backend — bandeja y respuesta
- [x] 3.1 `usecases/inbox.ts`: listado de conversaciones de WhatsApp del hotel, ordenadas por
      `lastMessageAt`, con `unreadCount` y el estado de la ventana ya calculado.
      **Aceptación**: filtra por `hotelId`; test cross-tenant.
- [x] 3.2 `usecases/conversation-window.ts`: `isWindowOpen(lastInboundAt, now)` y minutos restantes.
      **Aceptación**: tests de borde — 23 h 59 abierta, 24 h 01 cerrada, `null` cerrada.
- [x] 3.3 `replyToConversation()`: valida ventana → envía por el cliente → guarda en el hilo → registra
      en `message_logs`. **Aceptación**: los cuatro escenarios del REQ-3.
- [x] 3.4 `take` / `release` sobre `status` y `assignedAgentId`.
      **Aceptación**: tests de los dos, más el de que el bot deja de responder.
- [x] 3.5 Rutas nuevas con `guard('ai', …)` y ownership.
      **Aceptación**: `arckode analyze` en 0 violaciones; ninguna ruta sin guard.
- [x] 3.6 Connector para escribir en `message_logs` (tabla de `marketing`).
      **Aceptación**: sin import directo entre módulos.

## 4. Frontend — la vista
- [x] 4.1 `AiReceptionist.service.ts`: `inbox()`, `conversation(id)`, `reply(id, text)`, `take(id)`,
      `release(id)`. **Aceptación**: sin `any`.
- [x] 4.2 `pages/whatsapp-inbox/index.vue`: lista + hilo, con estados de carga, vacío y error.
      **Aceptación**: los tres estados se pueden ver; la lista no rompe en pantalla chica.
- [x] 4.3 Nombres de las personas resueltos con `TeamService.list()` (`/api/usuarios`).
      **Aceptación**: un mensaje de una persona muestra su nombre, no un id ni "Usuario".
- [x] 4.4 Contador de la ventana de 24 h visible, con el cuadro de texto deshabilitado al cerrarse y la
      opción de mandar plantilla. **Aceptación**: con la ventana cerrada no se puede escribir texto libre.
- [x] 4.5 Botones de tomar / soltar, mostrando quién la tiene.
      **Aceptación**: dos usuarios distintos ven quién la tomó.
- [x] 4.6 Actualización en vivo por socket, con caída a recarga cada 30 s.
      **Aceptación**: un mensaje entrante aparece sin recargar; cortando el socket, la vista sigue.
- [x] 4.7 Entrada en el menú de Operaciones y ruta en el router.
      **Aceptación**: visible solo con permiso `ai:view`.

## 5. Verificación
- [x] 5.1 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0 violaciones.
- [x] 5.2 `cd backend && bun run typecheck && bun test`.
- [x] 5.3 `cd frontend && bun run typecheck && bun run build`.
- [x] 5.4 Prueba real: escribirle al número de prueba desde un celular, verlo entrar en la bandeja,
      tomar la conversación, responder y ver la respuesta en el celular.
      **Aceptación**: es el paso 6 del vídeo de Meta, grabado.

---

## Estado (2026-09-07, rama `meta-config`)

**21 de 24 tareas.** Falta:

- **La actualización automática es por SONDEO, no por socket.** El design decía socket, pero el
  frontend de este proyecto no tiene cliente de WebSocket: los "sockets" del backend son internos
  entre módulos. Se hizo lo mismo que `team-chat` — sondeo cada 20 s y **solo con la pestaña
  visible**, más un refresco inmediato al volver a la pestaña. Sondear una pestaña de fondo gasta
  batería y cuota para nadie.
- **5.4 — la prueba real** de escribirle al número desde un celular y verlo entrar: sigue
  pendiente del número de prueba registrado en la consola de Meta.

### Decisiones que quedaron en el código

**El bot se calla por estado, no por interruptor.** `registrarEntrante` devuelve si la conversación
está tomada por una persona, y el webhook decide con eso si llama al pipeline del modelo. Es un `if`
temprano y barato, y evita la falla más visible de una bandeja: el hotel y el bot contestando a la
vez, con dos respuestas distintas al mismo huésped.

**La ventana de 24 h la recalcula el servidor en cada envío.** El contador que muestra la vista es
informativo: un navegador con la hora mal haría intentar un envío que Meta rechaza y cobra igual.

**Los nombres del equipo se resuelven contra `/api/usuarios`**, no contra `employee-profiles` — la
regla del proyecto que ya produjo tres veces el mismo bug de "Sin asignar".

### Gates

| Gate | Resultado |
|---|---|
| `arckode analyze` | ✅ VÁLIDO |
| `bun test` (backend) | ✅ 4913 pass, 0 fail |
| `vitest` (frontend) | ✅ 1260 pass, 93 archivos |
| `vue-tsc -b` + `vite build` | ✅ `✓ built` |
| Migración SQLite | ✅ `lastInboundAt`, `unreadCount`, `senderUserId` |

Un test del propio repo (`usePageTitle.test.ts`) atajó que la ruta nueva no tenía título curado.
