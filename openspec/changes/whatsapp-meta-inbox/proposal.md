# whatsapp-meta-inbox

## Intent

Que cuando el huésped conteste por WhatsApp, ese mensaje **entre al PMS, se vea en un hilo y el hotel
pueda responderle** desde el panel. Es REQ-META-05 del documento del equipo de Meta (2026-09-02) y el
paso 6 de los siete que Meta exige ver en el vídeo.

Referencia MisterPlan: extiende el REQ de conversaciones de
`archive/match-misterplan/specs/whatsapp/spec.md` — allí la atención al huésped por WhatsApp quedó
resuelta como bot automático; acá se agrega **la persona**: el recepcionista tomando la conversación.

## Por qué hace falta si el webhook ya existe

El webhook está construido y es lo único serio que hay hoy del lado de Meta
(`ai-recepcionista/controller.ts:164-182`, rutas en `index.ts:144-145`, con validación de firma HMAC y
política de puerta cerrada). Pero lo que recibe **va directo al recepcionista automático**: se crea la
conversación, el modelo de lenguaje redacta una respuesta y se contesta solo.

Falta lo que el hotel necesita y lo que Meta quiere ver:

1. **Una bandeja** donde el recepcionista vea las conversaciones de WhatsApp de su hotel.
2. **Poder contestar a mano**, con el bot callado mientras tanto.
3. **Saber si todavía se puede escribir** — la ventana de 24 h — antes de intentarlo.

## Contexto (verificado en código, 2026-09-07)

- `ai_conversations` y `ai_messages` (`ai-recepcionista/model.ts`) ya guardan el hilo por huésped, con
  `channel`, `guestPhone`, `status`, `lastMessageAt` y el remitente de cada mensaje. La bandeja se
  apoya en estas tablas: **no se crea un modelo nuevo de conversación**.
- `transferConversation` y `closeConversation` ya existen en el service — sirven para "tomar" y "cerrar"
  una conversación, no hay que inventarlos.
- El envío saliente lo aporta `whatsapp-meta-messaging` (cliente + normalización + `message_logs`).
- `pages/team-chat/` es el monitor de los chats **internos** del equipo, no del huésped. No se toca.
- El webhook hoy responde a todo con el pipeline de IA; no hay forma de silenciarlo por conversación.

## Decisión

- **La bandeja es del huésped, no del bot.** Se muestra el hilo completo, con quién escribió cada
  mensaje: huésped, bot o una persona del hotel (con su nombre, resuelto por `/api/usuarios` — regla del
  proyecto).
- **Tomar la conversación silencia al bot.** Mientras una persona la tiene tomada, el pipeline de IA
  no responde. Sin esto, el huésped recibe dos respuestas distintas al mismo tiempo y el hotel queda
  como incoherente.
- **La ventana de 24 h se muestra siempre.** Un contador visible con el tiempo que queda, y el cuadro de
  texto deshabilitado cuando se cierra, ofreciendo mandar una plantilla. Es más honesto que dejar
  escribir y fallar al enviar.
- **Ventana calculada desde el último mensaje ENTRANTE**, no desde el último mensaje del hilo: una
  respuesta del hotel no reabre nada. Es la regla de Meta y es fácil de equivocar.

## Scope

- Endpoint de bandeja: conversaciones de WhatsApp del hotel, ordenadas por actividad, con no leídos.
- Endpoint de hilo + envío de respuesta humana (usa el cliente de `whatsapp-meta-messaging`).
- Tomar / soltar / cerrar una conversación, con el bot silenciado mientras está tomada.
- Cálculo y exposición de la ventana de 24 h por conversación.
- Vista de bandeja en el panel, con actualización en vivo por el socket que ya usa el módulo.

## Out of scope

- Asignación automática de conversaciones por turno o carga de trabajo.
- Respuestas rápidas guardadas, notas internas y etiquetas: v1 es el hilo y el cuadro de texto.
- Adjuntos entrantes (imágenes, audios): v1 los muestra como "archivo recibido" sin visor.
- Unificación con otros canales (email, chat web) en una sola bandeja.

## Riesgos y rollback

- **Riesgo — dos voces**: si el silenciado del bot falla, el huésped recibe respuesta doble.
  Mitigación: el bot consulta el estado de la conversación antes de responder, y se testea el caso.
- **Riesgo — privacidad**: la bandeja muestra conversaciones con datos del huésped. Va detrás del
  permiso del módulo y filtrada por `hotelId`, como todo el resto.
- **Rollback**: sin la vista nueva, el webhook vuelve a comportarse como hoy (bot siempre responde). El
  silenciado es una condición adicional, no un reemplazo del pipeline.
