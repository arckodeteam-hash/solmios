# whatsapp-meta-inbox — Tasks

> **Depende de** `whatsapp-meta-onboarding` y `whatsapp-meta-messaging` (el cliente de envío y la
> normalización de teléfono salen de ahí). Es el paso 6 del vídeo que pide Meta.

## 1. Modelo
- [ ] 1.1 `ai_conversations`: agregar `lastInboundAt` y `unreadCount`.
      **Aceptación**: `RUN_MIGRATE=1` agrega las columnas; las conversaciones viejas siguen abriéndose.
- [ ] 1.2 `ai_messages`: agregar `senderUserId`.
      **Aceptación**: test que escribe y relee el campo (anti-patrón ORM: si no está declarado en el
      `orm.define`, se descarta sin avisar).
- [ ] 1.3 Actualizar los DTOs de conversación y mensaje.
      **Aceptación**: `bun run typecheck` limpio.

## 2. Webhook — registrar el entrante y respetar el silencio
- [ ] 2.1 Al recibir un mensaje: actualizar `lastInboundAt` y sumar a `unreadCount`.
      **Aceptación**: test de webhook que verifica los dos campos.
- [ ] 2.2 Anteponer al pipeline de IA la condición de estado: si `status='human'`, no responder.
      **Aceptación**: test con la conversación tomada → cero llamadas al modelo de lenguaje.
- [ ] 2.3 Una conversación `closed` que recibe un mensaje vuelve a `active`.
      **Aceptación**: test del escenario "conversación cerrada que revive".
- [ ] 2.4 Emitir el evento de socket para la bandeja.
      **Aceptación**: el evento sale con `hotelId` y el id de la conversación.

## 3. Backend — bandeja y respuesta
- [ ] 3.1 `usecases/inbox.ts`: listado de conversaciones de WhatsApp del hotel, ordenadas por
      `lastMessageAt`, con `unreadCount` y el estado de la ventana ya calculado.
      **Aceptación**: filtra por `hotelId`; test cross-tenant.
- [ ] 3.2 `usecases/conversation-window.ts`: `isWindowOpen(lastInboundAt, now)` y minutos restantes.
      **Aceptación**: tests de borde — 23 h 59 abierta, 24 h 01 cerrada, `null` cerrada.
- [ ] 3.3 `replyToConversation()`: valida ventana → envía por el cliente → guarda en el hilo → registra
      en `message_logs`. **Aceptación**: los cuatro escenarios del REQ-3.
- [ ] 3.4 `take` / `release` sobre `status` y `assignedAgentId`.
      **Aceptación**: tests de los dos, más el de que el bot deja de responder.
- [ ] 3.5 Rutas nuevas con `guard('ai', …)` y ownership.
      **Aceptación**: `arckode analyze` en 0 violaciones; ninguna ruta sin guard.
- [ ] 3.6 Connector para escribir en `message_logs` (tabla de `marketing`).
      **Aceptación**: sin import directo entre módulos.

## 4. Frontend — la vista
- [ ] 4.1 `AiReceptionist.service.ts`: `inbox()`, `conversation(id)`, `reply(id, text)`, `take(id)`,
      `release(id)`. **Aceptación**: sin `any`.
- [ ] 4.2 `pages/whatsapp-inbox/index.vue`: lista + hilo, con estados de carga, vacío y error.
      **Aceptación**: los tres estados se pueden ver; la lista no rompe en pantalla chica.
- [ ] 4.3 Nombres de las personas resueltos con `TeamService.list()` (`/api/usuarios`).
      **Aceptación**: un mensaje de una persona muestra su nombre, no un id ni "Usuario".
- [ ] 4.4 Contador de la ventana de 24 h visible, con el cuadro de texto deshabilitado al cerrarse y la
      opción de mandar plantilla. **Aceptación**: con la ventana cerrada no se puede escribir texto libre.
- [ ] 4.5 Botones de tomar / soltar, mostrando quién la tiene.
      **Aceptación**: dos usuarios distintos ven quién la tomó.
- [ ] 4.6 Actualización en vivo por socket, con caída a recarga cada 30 s.
      **Aceptación**: un mensaje entrante aparece sin recargar; cortando el socket, la vista sigue.
- [ ] 4.7 Entrada en el menú de Operaciones y ruta en el router.
      **Aceptación**: visible solo con permiso `ai:view`.

## 5. Verificación
- [ ] 5.1 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0 violaciones.
- [ ] 5.2 `cd backend && bun run typecheck && bun test`.
- [ ] 5.3 `cd frontend && bun run typecheck && bun run build`.
- [ ] 5.4 Prueba real: escribirle al número de prueba desde un celular, verlo entrar en la bandeja,
      tomar la conversación, responder y ver la respuesta en el celular.
      **Aceptación**: es el paso 6 del vídeo de Meta, grabado.
