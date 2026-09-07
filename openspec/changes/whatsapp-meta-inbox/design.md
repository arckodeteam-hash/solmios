# whatsapp-meta-inbox — Design

## Flujo completo, de la punta del huésped a la del hotel

```
 HUÉSPED            META                 SERVIDOR                        PANEL DEL HOTEL
 ───────            ────                 ────────                        ───────────────
 escribe ─────────▶
                    POST /api/ai/whatsapp/webhook/:hotelId
                    ─────────────────────▶
                              1. valida firma HMAC (ya existe hoy)
                              2. findOrCreateConversation(channel:'whatsapp')
                              3. guarda el mensaje entrante (sender:'guest')
                              4. actualiza lastInboundAt  ← reabre la ventana de 24 h
                              5. ¿la conversación está TOMADA por una persona?
                                   sí → NO responde el bot, solo notifica
                                   no → pipeline de IA como hoy
                              6. socket ────────────────────────────────▶ la bandeja se
                                                                          actualiza sola
                                                        ◀──── el recepcionista la toma
                              7. status='human', assignedAgentId=usuario
                                                        ◀──── escribe la respuesta
                              8. POST /api/ai/conversations/:id/reply
                              9. ¿ventana abierta? (lastInboundAt < 24 h)
                                   no → 409, ofrece plantilla
                              10. sendTextMessage()  (cliente de whatsapp-meta-messaging)
                    ◀─────────────────────
 recibe ◀──────────
```

## La ventana de 24 horas

`lastInboundAt` es un campo nuevo en `ai_conversations`. Se actualiza **solo** con mensajes entrantes.

```
ventanaAbierta = (ahora - lastInboundAt) < 24 h
```

Tres detalles que parecen menores y no lo son:

- **La respuesta del hotel no reabre la ventana.** Por eso no alcanza con `lastMessageAt`, que ya existe
  y se mueve con cualquier mensaje.
- **El contador se muestra siempre**, no solo cuando está por vencer: el recepcionista tiene que poder
  decidir si contesta ahora o manda una plantilla.
- **Se recalcula en el servidor en cada envío.** El contador del navegador es informativo; si el reloj
  del cliente está mal, la verdad la tiene el backend.

## Silenciar al bot: por estado, no por interruptor global

`ai_conversations.status` ya existe. Se usa así:

| `status` | Quién contesta |
|---|---|
| `active` | El bot (comportamiento de hoy) |
| `human` | **Nadie automático.** Solo la persona asignada |
| `closed` | Nadie; un mensaje nuevo del huésped la reabre como `active` |

El pipeline de IA (`processIncomingMessage`) consulta el estado **antes** de redactar. Es un `if`
temprano y barato, y es el que evita la falla más visible de una bandeja: el hotel escribiendo a la vez
que el bot.

## Quién escribió cada mensaje

`ai_messages.sender` distingue `guest` / `bot` / `agent`. Para los `agent` se agrega `senderUserId`, y el
nombre se resuelve contra **`/api/usuarios`**, no contra `employee-profiles`: es una regla explícita del
proyecto, y equivocarse acá ya produjo tres veces el mismo bug de "Sin asignar" (documentado en
`CLAUDE.md`, sección de resolución de nombres).

## Qué NO se toca

- El webhook y su validación de firma: es lo único de Meta que hoy está bien hecho. Se le agregan
  pasos (4 y 5), no se reescribe.
- El pipeline de IA: se le antepone una condición.
- `pages/team-chat/`: es el monitor de chats internos del equipo. Otra cosa, otro módulo.

## Actualización en vivo

El módulo ya emite por socket (`ai-recepcionista/sockets.ts`). La bandeja se suscribe a esos eventos:
un mensaje entrante mueve la conversación al tope de la lista sin recargar. Si el socket no está
disponible, la vista cae a recargar cada 30 s — degradado, pero funcional.
