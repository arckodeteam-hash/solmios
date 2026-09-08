# whatsapp-meta-messaging

## Intent

Que el hotel le **envíe de verdad** un WhatsApp al huésped desde la ficha de la reserva, por la Cloud
API de Meta, y que ese envío quede registrado en **Historial de Envíos** con su estado real de entrega.
Es REQ-META-04 del documento del equipo de Meta (2026-09-02).

Referencia MisterPlan: `archive/match-misterplan/tasks.md` 7.2.3 "Send via API (no manual click)" —
**GitLab [#410](https://gitlab.com/underworf1/solmios/-/work_items/410)**, marcada `⛔ bloqueada por
creds Meta + 7.2.2 aprobada`. Este change la desbloquea junto con `whatsapp-meta-onboarding` y
`whatsapp-meta-templates`.

## El problema real, no el aparente

Hoy **parece** que el PMS manda WhatsApp. No lo manda: arma un enlace `wa.me` y abre WhatsApp en el
navegador del recepcionista, que después aprieta enviar a mano. El propio código lo dice
(`reservas/usecases/message-log.ts:1-10`): el log se asienta con `status:'queued'` — *"preparado y
abierto"* — porque *"el sistema no puede confirmar la entrega"*.

Esto tiene tres consecuencias que este change corrige:

1. **Meta no lo acepta como evidencia.** Un enlace `wa.me` no usa los permisos que la app solicitó; el
   revisor busca ver una llamada real a la API.
2. **El hotel no sabe si llegó.** No hay acuse, ni entregado, ni leído, ni fallido.
3. **Depende de que el recepcionista tenga sesión de WhatsApp abierta** en esa computadora.

## Contexto (verificado en código, 2026-09-07)

- **El enlace `wa.me` está en tres lugares**: `components/features/ReservationModal.vue`,
  `ReservationCalendar.vue` y `ReservationWizardModal.vue`. Todos construyen la URL a mano con
  `phone.replace(/\D/g,'')`.
- **`message_logs`** (`marketing/model.ts:28-42`): `hotelId, reservationId, guestId, messageId,
  messageType, status, recipient, response, sentAt`. No tiene el id del mensaje del proveedor, ni el
  error, ni la plantilla usada.
- **`logManualMessage`** (`reservas/usecases/message-log.ts`) ya escribe la traza manual con un JSON en
  `response` (`{kind:'manual', reference, byUserId}`) — se conserva: seguirá existiendo el envío manual
  para los hoteles sin conectar.
- **No hay cliente de envío**: `rg "graph.facebook.com" backend/src/modules/` no devuelve nada.
- El envío por Baileys (`ai-recepcionista/usecases/whatsapp-baileys-client.ts:190`) existe pero es la vía
  no oficial y solo la usa el bot, no el panel.

## Decisión

- **Fuera de las 24 h solo se manda plantilla.** Un mensaje desde la ficha de una reserva casi siempre
  inicia la conversación, así que el camino por defecto es **plantilla aprobada** (depende de
  `whatsapp-meta-templates`). El texto libre queda habilitado solo cuando la ventana está abierta, y la
  UI lo dice.
- **El estado de entrega lo dicta Meta, no nosotros.** `message_logs.status` deja de ser un deseo:
  `queued` al encolar, `sent` cuando Meta acepta, y `delivered`/`read`/`failed` cuando llega el webhook
  de estado. Sin webhook, un mensaje se queda en `sent` — que es la verdad, no un `delivered` inventado.
- **Convivencia con el enlace manual.** Si el hotel no tiene WhatsApp conectado, el botón sigue
  ofreciendo el enlace `wa.me` de siempre, con su log `queued`. No se rompe lo que hoy usan los hoteles.
- **El teléfono se normaliza a E.164 en el backend**, no en cada componente. Meta rechaza cualquier otra
  cosa, y hoy la normalización está copiada en tres archivos con criterios distintos (uno de ellos ya
  tuvo el bug de armar `wa.me/8095550000` sin prefijo, documentado en `technical-providers/index.vue`).

## Scope

- Cliente de envío (`POST /{phoneNumberId}/messages`) para plantilla y texto libre.
- Normalización E.164 compartida.
- Campos nuevos en `message_logs` para el id de Meta, el error y la plantilla usada.
- Webhook de estados de entrega (`statuses`) enganchado al webhook que ya existe.
- Endpoint de envío desde una reserva + botón real en la ficha.
- Historial de Envíos mostrando el estado real.

## Out of scope

- Bandeja de conversación y respuesta del huésped (`whatsapp-meta-inbox`).
- Envío masivo / campañas de marketing por WhatsApp (`crm-campanas-v1` es otro change).
- Adjuntos, imágenes y botones interactivos — v1 es texto y plantilla de texto.
- Reintento automático de fallidos: v1 informa el fallo, el reintento lo decide una persona.

## Riesgos y rollback

- **Riesgo alto — plata del hotel**: cada conversación que se inicia se cobra. Un bucle o un doble click
  gastan dinero real. Mitigación: estado de carga que bloquea el botón, y dedupe por
  `(reservationId, templateId, día)` igual que ya hace `auto-message-dedupe`.
- **Riesgo — número equivocado**: mandarle la reserva de un huésped a otro número es una fuga de datos.
  Mitigación: el destinatario sale del huésped de la reserva, nunca de un campo libre; se muestra el
  número completo en la confirmación antes de enviar.
- **Rollback**: el envío real vive detrás de "¿el hotel tiene WhatsApp conectado?". Volver atrás es
  desconectar: la UI cae sola al enlace manual, que no se elimina en este change.
