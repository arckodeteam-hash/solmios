# SPEC: Envío real por WhatsApp desde el PMS

Cubre REQ-META-04 del documento del equipo de Meta y 7.2.3 de MisterPlan (GitLab #410).
Depende de `whatsapp-meta-onboarding` (conexión) y `whatsapp-meta-templates` (plantilla aprobada).

## REQ-1: Enviar una plantilla al huésped desde la reserva

El sistema **MUST** permitir enviar una plantilla aprobada al huésped de una reserva por la Cloud API,
y **MUST** registrar el envío en `message_logs`.

### Database

Columnas nuevas en `message_logs` (`backend/src/modules/marketing/model.ts`):

| Columna | Tipo | Notas |
|---|---|---|
| `providerMessageId` | TEXT | nullable, **indexado**; el `wamid` que devuelve Meta |
| `channel` | TEXT | default `'email'`; `whatsapp_api`\|`whatsapp_manual`\|`email` |
| `templateId` | TEXT | nullable; `whatsapp_templates.id` usada |
| `errorMessage` | TEXT | nullable; motivo del fallo, en castellano |

### API endpoints

| Método | Ruta | Auth/Permiso |
|---|---|---|
| POST | `/api/reservas/:id/whatsapp` | `guard('reservations','edit')` |

### UI

Ficha de la reserva: botón "Enviar por WhatsApp" que muestra el número destino completo antes de
confirmar. Texto en castellano.

### Scenarios

#### Scenario: Envío exitoso de plantilla
- **Given** una reserva con un huésped con teléfono válido
- **And** el hotel con `connectionMode='meta'` y una plantilla con `metaStatus='APPROVED'`
- **When** POST `/api/reservas/:id/whatsapp` con `{ templateId }`
- **Then** **MUST** crear la fila en `message_logs` con `status='queued'` **antes** de llamar a Meta
- **And** **MUST** llamar `POST /v26.0/{phoneNumberId}/messages` con `type:'template'` y los parámetros
  resueltos en el orden que guardó `variables`
- **And** al recibir el `wamid` **MUST** actualizar la fila a `status='sent'` y `providerMessageId`
- **And** la respuesta **MUST** incluir el estado, y **MUST NOT** incluir el token

#### Scenario: El hotel no tiene WhatsApp conectado
- **Given** un hotel sin `connectionMode='meta'`
- **When** POST `/api/reservas/:id/whatsapp`
- **Then** **MUST** responder 409 con "Este hotel todavía no conectó su WhatsApp"
- **And** **MUST NOT** crear ninguna fila en `message_logs`
- **And** la UI **MUST** ofrecer el enlace `wa.me` de siempre como alternativa

#### Scenario: La plantilla no está aprobada
- **Given** una plantilla con `metaStatus` distinto de `'APPROVED'`
- **When** se intenta enviar
- **Then** **MUST** responder 409 explicando que Meta todavía no la aprobó
- **And** **MUST NOT** llamar a la API — Meta cobraría el intento y lo rechazaría igual

#### Scenario: Teléfono del huésped inválido
- **Given** un huésped sin teléfono, o con un teléfono que no se puede normalizar a E.164
- **When** se intenta enviar
- **Then** **MUST** responder 400 pidiendo corregir el teléfono del huésped
- **And** **MUST NOT** llamar a Meta

#### Scenario: Doble click
- **Given** un envío en curso para `(reservationId, templateId)` en el mismo día
- **When** se dispara un segundo envío idéntico
- **Then** **MUST** rechazarlo (mismo criterio que `auto-message-dedupe`)
- **And** **MUST NOT** generar una segunda conversación cobrada

#### Scenario: Ownership multi-tenant
- **Given** una reserva del hotel A
- **When** un usuario del hotel B intenta enviar
- **Then** **MUST** responder 403/404 vía `assertReservationOwned`

---

## REQ-2: Respetar la ventana de 24 horas

El sistema **MUST** impedir el envío de texto libre fuera de la ventana de 24 horas.

#### Scenario: Ventana abierta
- **Given** un mensaje entrante del huésped hace menos de 24 h
- **When** se envía `{ text }`
- **Then** **MUST** enviarlo como `type:'text'`

#### Scenario: Ventana cerrada
- **Given** el último mensaje entrante tiene más de 24 h, o no hay ninguno
- **When** se intenta enviar `{ text }`
- **Then** **MUST** responder 409 explicando que fuera de las 24 h solo se puede mandar una plantilla
- **And** la UI **MUST** ofrecer elegir una plantilla aprobada

#### Scenario: Sin bandeja de entrada todavía
- **Given** que `whatsapp-meta-inbox` no está implementado y no hay mensajes entrantes registrados
- **When** se evalúa la ventana
- **Then** **MUST** asumirla cerrada y exigir plantilla

---

## REQ-3: Reflejar el estado real de entrega

El sistema **MUST** actualizar el estado del mensaje con lo que informa Meta, y **MUST NOT** inventar
estados que Meta no confirmó.

### Scenarios

#### Scenario: Webhook de entrega
- **Given** una fila con `providerMessageId='wamid.XXX'` y `status='sent'`
- **When** llega al webhook `{ statuses:[{ id:'wamid.XXX', status:'delivered' }] }`
- **Then** **MUST** actualizar esa fila a `status='delivered'`
- **And** **MUST** ignorar en silencio un `wamid` que no exista localmente (puede ser de otro sistema)

#### Scenario: El mensaje falla
- **Given** un webhook con `status:'failed'` y un error de Meta
- **When** se procesa
- **Then** **MUST** guardar `status='failed'` y `errorMessage` traducido
- **And** el Historial de Envíos **MUST** mostrar el motivo

#### Scenario: Sin webhook, no hay ascenso de estado
- **Given** un mensaje en `status='sent'` del que Meta nunca informó nada
- **When** se consulta el historial
- **Then** **MUST** seguir mostrando "Enviado", nunca "Entregado"

#### Scenario: Estados fuera de orden
- **Given** una fila ya en `read`
- **When** llega un webhook tardío con `delivered`
- **Then** **MUST NOT** retroceder el estado

---

## REQ-4: Historial de Envíos con el canal correcto

El sistema **MUST** distinguir en el historial un envío real por API de uno abierto a mano.

#### Scenario: Envío por API
- **Given** un envío exitoso por Cloud API
- **When** se abre Historial de Envíos
- **Then** **MUST** mostrarlo con `channel='whatsapp_api'` y su estado real

#### Scenario: Envío manual (enlace)
- **Given** un hotel sin conexión que usó el enlace `wa.me`
- **When** se abre el historial
- **Then** **MUST** mostrarlo como `whatsapp_manual` con estado `queued`
- **And** **MUST NOT** presentarlo como entregado — el sistema no lo sabe
