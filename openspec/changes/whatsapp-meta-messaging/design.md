# whatsapp-meta-messaging — Design

## Auth flow (integración externa)

No hay flujo propio: usa el `accessToken` del hotel que dejó `whatsapp-meta-onboarding` en
`ai_whatsapp_config`, leído server-side por el mismo connector. El token nunca sale al navegador.

```
 PANEL (ficha de reserva)          SERVIDOR                                  META
 ────────────────────────          ────────                                  ────
 1. "Enviar confirmación
     por WhatsApp"
 2. POST /api/reservas/:id/whatsapp
    { templateId }  ó  { text }
    ─────────────────────────▶
 3.                  ¿el hotel tiene conexión 'meta'?  ── no ──▶ 409 "no conectado"
                                                                (la UI cae al enlace wa.me)
 4.                  ¿hay ventana de 24 h abierta?
                       sí → puede ir texto libre
                       no → OBLIGA plantilla aprobada
 5.                  message_logs.create(status:'queued')  ← antes de salir a la red:
                                                             si Meta corta, queda el rastro
 6.                  POST /v26.0/{phoneNumberId}/messages
                     { messaging_product:'whatsapp', to:'18095550000',
                       type:'template', template:{ name, language,
                         components:[{type:'body', parameters:[…]}] } }
                     ──────────────────────────────────────────────────▶
                     ◀── { messages:[{ id: 'wamid.XXX' }] }
 7.                  message_logs.update(status:'sent', providerMessageId:'wamid.XXX')
    ◀─────────────────────────
 8. La ficha muestra "Enviado"

 … minutos después, sin que nadie mire:
 9.                  ◀── POST /api/ai/whatsapp/webhook/:hotelId
                         { statuses:[{ id:'wamid.XXX', status:'delivered' }] }
10.                  message_logs.update(status:'delivered')
```

## La ventana de 24 horas, en una tabla

| Situación | Qué se puede mandar |
|---|---|
| El huésped escribió hace menos de 24 h | Texto libre **o** plantilla |
| Pasaron más de 24 h, o nunca escribió | **Solo** plantilla aprobada |

La ventana se calcula con el último mensaje **entrante** de ese huésped. Mientras
`whatsapp-meta-inbox` no exista, no hay mensajes entrantes registrados: el sistema asume **ventana
cerrada** y exige plantilla. Es la respuesta segura — asumir lo contrario produce un error de Meta y una
conversación cobrada que no se entrega.

## Estado del mensaje: quién lo decide

```
queued ──▶ sent ──▶ delivered ──▶ read
   │         │
   └──▶ failed ◀────┘
```

- `queued`: la fila se crea **antes** de llamar a Meta. Si el proceso muere en el medio, queda la
  evidencia de que se intentó.
- `sent`: Meta aceptó y devolvió un `wamid`. **No** significa que el huésped lo recibió.
- `delivered` / `read` / `failed`: llegan por webhook, minutos después. Nadie los escribe a mano.

El error de `failed` viene con `errorMessage` traducido: "el número no tiene WhatsApp" y "el huésped
bloqueó al hotel" son cosas distintas para el recepcionista.

## Campos nuevos en `message_logs`

| Columna | Para qué |
|---|---|
| `providerMessageId` | El `wamid` de Meta. Es la única forma de emparejar el webhook de estado con la fila. **Indexado**: el webhook busca por ahí. |
| `channel` | `whatsapp_api` \| `whatsapp_manual` \| `email`. Hoy `messageType` mezcla el canal con el modo; se separa para poder contar cuántos envíos fueron reales. |
| `templateId` | Qué plantilla se usó. Sin esto no se puede saber qué texto recibió el huésped, porque la plantilla puede editarse después. |
| `errorMessage` | El motivo del fallo, en castellano. |

`response` **no** se toca: sigue guardando el JSON de traza manual (`{kind:'manual',…}`) y la clave de
dedupe de los auto-mensajes. Cambiarle el significado rompería `auto-message-dedupe` y la proyección
del detalle de la reserva.

## Normalización del teléfono

Hoy hay tres implementaciones distintas en el frontend (`ReservationModal`, `ReservationCalendar`,
`ReservationWizardModal`) y una de ellas ya produjo un bug documentado: un teléfono cargado sin prefijo
armaba `wa.me/8095550000`, que WhatsApp no resuelve — el botón existía y no contactaba a nadie
(`pages/technical-providers/index.vue`).

Se centraliza en el backend, en `shared/utils/phone-e164.ts`:
- toma el teléfono del huésped y el país del hotel;
- si ya viene con `+`, respeta el prefijo;
- si no, antepone el del hotel;
- si el resultado no es un E.164 plausible, **falla antes de llamar a Meta** con un mensaje que le pide
  al hotel corregir el teléfono del huésped.

Los tres componentes del frontend pasan a usar el mismo endpoint, así que dejan de normalizar por su
cuenta.

## Por qué el log se escribe antes de enviar

Es tentador crear la fila con el `wamid` ya adentro, en una sola escritura. No se hace: si Meta acepta
el mensaje y nuestro proceso se cae antes de guardar, el huésped recibió algo que el hotel no puede ver
en ningún lado — y el mismo mensaje se va a volver a mandar (y cobrar). Con la fila `queued` previa,
una anomalía deja rastro y el dedupe la ve.
