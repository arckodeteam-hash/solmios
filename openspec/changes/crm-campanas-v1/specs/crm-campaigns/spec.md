# CRM Campaigns Specification

## Purpose

Convertir los segmentos en envíos: componer un email, elegir un segmento, enviar a sus
miembros por la cola existente, y dejar log auditable con anti-reenvío. Hoy el segmento solo
exporta CSV — el CRM no puede comunicarse con sus propios huéspedes.

Equivalente MisterPlan: "Campaigns/Email marketing" — empareja con envío simple; A/B y
métricas de apertura quedan fuera (documentado en el proposal).

## Requirements

### Requirement: Ciclo de vida de una campaña

El sistema MUST permitir crear campañas (draft) con nombre, segmento, asunto y cuerpo HTML,
y enviarlas explícitamente. `send` resuelve los miembros CON el mismo `SegmentUseCase`
que la vista (una sola definición de quién es miembro), encola una fila por huésped en
`email_queue` (worker existente), y marca `status:'sent'` con `sentCount`. Una campaña ya
enviada no se reenvía (409).

#### Scenario: envío completo

- GIVEN campaña draft ligada al segmento "VIP" (3 miembros con email)
- WHEN el admin envía
- THEN se encolan 3 filas en email_queue con el subject/html de la campaña, la campaña queda
  `sent` con sentCount=3, y quedan 3 filas en campaign_sends

#### Scenario: miembro sin email

- GIVEN segmento con un miembro sin email
- WHEN se envía
- THEN ese miembro se omite (y NO cuenta en sentCount) sin fallar el envío de los demás

#### Scenario: reenvío bloqueado

- GIVEN campaña ya sent
- WHEN se llama a send de nuevo
- THEN 409 sin encolar nada

### Requirement: Variables del cuerpo

`send` MUST resolver `{{nombre}}`, `{{hotel}}` y `{{puntos}}` por destinatario antes de
encolar. Variable desconocida se deja literal (no rompe el envío).

#### Scenario: personalización

- GIVEN cuerpo "Hola {{nombre}}, tenés {{puntos}} puntos"
- WHEN se envía a Carlos (5.400 puntos)
- THEN la fila encolada dice "Hola Carlos, tenés 5400 puntos"

### Requirement: Log con anti-reenvío

Cada envío MUST dejar `campaign_sends {campaignId, guestId, email, sentAt}`. Si un huésped
ya figura para esa campaña, no se encola otra vez (defensa extra además del 409 de campaña).

#### Scenario: huésped repetido en dos evaluaciones del segmento

- GIVEN segmento que resuelve a Carlos dos veces (data sucia)
- WHEN se envía
- THEN Carlos recibe UNA sola fila

## API

- `POST /api/crm/campaigns` — crear draft (`guests:create`).
- `GET /api/crm/campaigns` — listar (`guests:view`).
- `POST /api/crm/campaigns/:id/send` — enviar (`guests:edit`).
- Encolado vía connector `crm-emailqueue` (puerto `enqueue(hotelId, to, subject, html)`).

## DB

- `campaigns`: id, hotelId, name, segmentId, subject, body(text), status(draft|sent),
  sentCount, sentAt, timestamps.
- `campaign_sends`: id, hotelId, campaignId, guestId, email, sentAt, timestamps.

## UI

- Tab "Campañas" en `/panel/crm`: listado (estado, destinatarios, fecha), form de alta
  (segmento select, asunto, cuerpo con nota de variables), botón Enviar con confirmación
  que muestra "se enviará a N huéspedes".
