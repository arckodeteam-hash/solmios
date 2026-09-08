# SPEC: Bandeja de conversaciones de WhatsApp

Cubre REQ-META-05 del documento del equipo de Meta. Depende de `whatsapp-meta-onboarding` (conexión) y
de `whatsapp-meta-messaging` (cliente de envío).

## REQ-1: El mensaje del huésped entra y queda visible

El sistema **MUST** registrar todo mensaje entrante de WhatsApp en el hilo del huésped y **MUST**
mostrarlo en una bandeja del hotel.

### Database

Columnas nuevas en `ai_conversations` (`ai-recepcionista/model.ts`):

| Columna | Tipo | Notas |
|---|---|---|
| `lastInboundAt` | TEXT | nullable; timestamp del último mensaje **del huésped**. Base de la ventana de 24 h |
| `unreadCount` | INTEGER | default 0; entrantes sin leer por el hotel |

Columna nueva en `ai_messages`:

| Columna | Tipo | Notas |
|---|---|---|
| `senderUserId` | TEXT | nullable; `users.id` cuando `sender='agent'` |

### API endpoints

| Método | Ruta | Auth/Permiso |
|---|---|---|
| GET | `/api/ai/inbox` | `guard('ai','view')` |
| GET | `/api/ai/conversations/:id` | `guard('ai','view')` |
| POST | `/api/ai/conversations/:id/reply` | `guard('ai','edit')` |
| POST | `/api/ai/conversations/:id/take` | `guard('ai','edit')` |
| POST | `/api/ai/conversations/:id/release` | `guard('ai','edit')` |

### UI

Panel → Operaciones → "Conversaciones de WhatsApp". Lista a la izquierda, hilo a la derecha. Castellano.

### Scenarios

#### Scenario: Llega un mensaje del huésped
- **Given** un hotel conectado y un huésped que escribe
- **When** Meta entrega el webhook con la firma válida
- **Then** **MUST** guardarse el mensaje con `sender='guest'`
- **And** **MUST** actualizarse `lastInboundAt` y sumar 1 a `unreadCount`
- **And** **MUST** emitirse el evento de socket para que la bandeja se actualice sin recargar

#### Scenario: Firma inválida
- **Given** un webhook sin firma o con firma que no valida
- **When** llega
- **Then** **MUST** rechazarse (comportamiento actual, no se modifica)
- **And** **MUST NOT** crear conversación ni mensaje

#### Scenario: Bandeja filtrada por hotel
- **Given** conversaciones de los hoteles A y B
- **When** un usuario del hotel A hace GET `/api/ai/inbox`
- **Then** **MUST** ver solo las de A

---

## REQ-2: Tomar la conversación silencia al bot

El sistema **MUST** impedir que el recepcionista automático conteste una conversación que una persona
tomó.

#### Scenario: Tomar la conversación
- **Given** una conversación en `status='active'`
- **When** POST `/api/ai/conversations/:id/take`
- **Then** **MUST** pasar a `status='human'` con `assignedAgentId` del usuario
- **And** un mensaje entrante posterior **MUST NOT** disparar respuesta automática
- **And** **MUST** registrarse igual y notificar

#### Scenario: Soltar la conversación
- **Given** una conversación en `status='human'`
- **When** POST `/api/ai/conversations/:id/release`
- **Then** **MUST** volver a `status='active'` y el bot **MUST** retomar

#### Scenario: Conversación cerrada que revive
- **Given** una conversación en `status='closed'`
- **When** el huésped escribe de nuevo
- **Then** **MUST** volver a `active` y **MUST** aparecer en la bandeja

---

## REQ-3: Responder desde el panel dentro de la ventana

El sistema **MUST** permitir responder con texto libre mientras la ventana de 24 horas esté abierta, y
**MUST** impedirlo cuando esté cerrada.

#### Scenario: Respuesta dentro de la ventana
- **Given** `lastInboundAt` hace menos de 24 h
- **When** POST `/api/ai/conversations/:id/reply` con `{ text }`
- **Then** **MUST** enviarse por la Cloud API como `type:'text'`
- **And** **MUST** guardarse en el hilo con `sender='agent'` y `senderUserId`
- **And** **MUST** registrarse en `message_logs` con `channel='whatsapp_api'`

#### Scenario: Ventana cerrada
- **Given** `lastInboundAt` hace más de 24 h, o es nulo
- **When** se intenta responder con texto
- **Then** **MUST** responder 409 explicando la regla de las 24 horas
- **And** **MUST NOT** llamar a Meta
- **And** la UI **MUST** ofrecer enviar una plantilla aprobada

#### Scenario: El servidor manda sobre el reloj del navegador
- **Given** un navegador con la hora adelantada que cree que la ventana sigue abierta
- **When** envía la respuesta
- **Then** el servidor **MUST** recalcular y rechazar si está cerrada

#### Scenario: Ownership
- **Given** una conversación del hotel A
- **When** un usuario del hotel B intenta responder
- **Then** **MUST** responder 403/404

---

## REQ-4: El hilo dice quién habló

El sistema **MUST** distinguir en la vista los mensajes del huésped, del bot y de cada persona del hotel.

#### Scenario: Mensaje de una persona
- **Given** un mensaje con `sender='agent'` y `senderUserId`
- **When** se abre el hilo
- **Then** **MUST** mostrarse el nombre resuelto contra `/api/usuarios`
- **And** **MUST NOT** resolverse contra `employee-profiles` (ids distintos: mostraría "Usuario")

#### Scenario: Mensaje del bot
- **Given** un mensaje con `sender='bot'`
- **When** se abre el hilo
- **Then** **MUST** identificarse como respuesta automática, distinguible de una persona

---

## REQ-5: No leídos

El sistema **MUST** indicar cuántas conversaciones tienen mensajes sin leer.

#### Scenario: Abrir una conversación la marca leída
- **Given** una conversación con `unreadCount=3`
- **When** el usuario la abre
- **Then** **MUST** quedar en 0
- **And** el contador de la bandeja **MUST** bajar en consecuencia
