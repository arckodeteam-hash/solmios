# whatsapp-meta-onboarding — Design

## Auth flow (integración externa — documentación obligatoria)

Embedded Signup es OAuth con una vuelta extra: la ventana de Meta no devuelve un token, devuelve un
**código de un solo uso** que solo el servidor puede canjear, porque el canje exige el `app_secret`.

```
 NAVEGADOR (panel del hotel)                    SERVIDOR (SOLMI OS)                 META
 ───────────────────────────                    ───────────────────                 ────
 1. El hotel lee la advertencia
    ("tu número deja de andar
     en el celular") y acepta
 2. FB.login({ config_id, response_type:'code',
               override_default_response_type:true })
    ────────────────────────────────────────────────────────────────────────────────▶
 3.                                     el hotel elige negocio, número, y verifica por SMS
    ◀────────────────────────────────────────────────────────────────────────────────
    { code }  ← un solo uso, expira en ~30 s
 4. POST /api/ai/whatsapp/connect
    { code, phoneNumberId, wabaId }   ← los dos ids llegan por el evento del SDK
    ──────────────────────────────▶
 5.                            GET /v26.0/oauth/access_token
                               ?client_id=APP_ID&client_secret=APP_SECRET&code=...
                               ──────────────────────────────────────────────────▶
                               ◀── { access_token }  ← permanente, del NEGOCIO DEL HOTEL
 6.                            POST /v26.0/{wabaId}/subscribed_apps   (Bearer token)
                               → suscribe NUESTRA app al WABA del hotel: sin esto los
                                 webhooks de ese hotel nunca llegan.
 7.                            POST /v26.0/{phoneNumberId}/register  { messaging_product,
                                 pin }  → activa el número en la nube (PIN de 2FA)
 8.                            GET /v26.0/{phoneNumberId}
                               ?fields=display_phone_number,verified_name,quality_rating
                               GET /v26.0/{wabaId}?fields=name,currency,account_review_status
 9.                            persist en ai_whatsapp_config (fila del hotel)
    ◀──────────────────────────
 10. La tarjeta muestra número, negocio y estado
```

**El `app_secret` vive solo en el servidor** (`META_APP_SECRET` en `backend/.env`, junto al
`WHATSAPP_APP_SECRET` que ya usa el webhook). El `access_token` del hotel se guarda en
`ai_whatsapp_config.accessToken` y **nunca** sale en una respuesta HTTP: `redactWhatsappConfig`
(`ai-recepcionista/usecases/whatsapp-config.ts:47`) ya lo recorta y sigue siendo el único camino de
salida al navegador.

## Por qué el canje no puede hacerse en el frontend

Meta permite pedir el token directo desde el navegador (`response_type: 'token'`), y es tentador porque
ahorra un endpoint. No se hace: ese token es de larga duración y quedaría en el JavaScript de la página,
o sea en la máquina de cualquier recepcionista con la consola abierta. Con él se puede escribirle a
todos los huéspedes del hotel. Por eso `override_default_response_type: true` y canje server-side.

## Qué se guarda y por qué

`ai_whatsapp_config` ya tiene `phoneNumberId`, `wabaId`, `accessToken`, `verifyToken`, `connectionMode`.
Lo que falta es todo lo que el hotel necesita **ver** para confiar en que quedó conectado, más lo mínimo
para diagnosticar cuando algo falle:

| Campo | Para qué |
|---|---|
| `displayPhoneNumber` | El número en formato legible (`+1 809 555 0000`). Es lo primero que el hotel busca en la tarjeta. |
| `verifiedName` | El nombre del negocio como lo aprobó Meta — si dice otra cosa, conectó la cuenta equivocada. |
| `businessName` | Nombre del portfolio comercial dueño del WABA. |
| `qualityRating` | `GREEN`/`YELLOW`/`RED`. Si baja, Meta restringe el envío: hay que verlo antes del corte. |
| `messagingLimit` | Tope de conversaciones/día (250 sin verificar). Explica un "no se envió" que no es un bug. |
| `accountReviewStatus` | Si el negocio del hotel está verificado ante Meta. |
| `connectedAt` / `connectedByUserId` | Quién conectó y cuándo. Auditoría: la conexión mueve el WhatsApp de un negocio real. |
| `connectionError` | Último error de Meta, para que el panel diga *qué* pasó en vez de "no conectado". |

`connectionMode` pasa a ser el discriminador de verdad: `'meta'` cuando la conexión es la oficial,
`'baileys'` para lo legacy. Nada del código de Baileys se borra en este change.

## Decisión: la conexión es del hotel, no de la plataforma

Hoy la tarjeta está en `/admin/settings` (super-admin, `configuration(hotelId:'platform')`). Eso no
puede funcionar: no hay un WhatsApp de SOLMI OS que sirva a todos los hoteles, cada uno conecta el suyo.
La tarjeta nueva va en el panel del hotel. En `/admin/settings` queda, si se quiere, una **lista de solo
lectura** de qué hoteles tienen WhatsApp conectado — útil para soporte, sin capacidad de configurar.

## Estados de la tarjeta

Un solo componente con cinco estados, porque el hotel necesita distinguirlos:

| Estado | Qué se ve |
|---|---|
| `disconnected` | La advertencia + el botón "Conectar WhatsApp" |
| `connecting` | Spinner mientras el servidor canjea el código (paso 5-9). No se puede cancelar a mitad. |
| `connected` | Número, negocio, calidad, límite diario, "Desconectar" |
| `error` | Qué dijo Meta, en castellano, y el botón para reintentar |
| `legacy_baileys` | Aviso de que este hotel usa la vía vieja (QR) y hay que migrarlo |

## Desconectar

`DELETE /api/ai/whatsapp/connection` hace, en este orden: `DELETE /{wabaId}/subscribed_apps` en Meta
(deja de recibir webhooks) y recién después limpia `accessToken`/`phoneNumberId`/`wabaId` locales.
Si el paso en Meta falla, **no** se limpia lo local: dejaría al hotel recibiendo webhooks que ya no
puede atender, sin forma de reintentar la baja desde el panel.

## Riesgo: el número deja de funcionar en el celular

Es el punto que más va a doler en soporte. El flujo lo dice dos veces:
- en la advertencia previa, con la alternativa (usar un número nuevo) puesta al lado;
- en la confirmación de desconexión, aclarando que recuperar el número en la app del celular es un
  trámite del lado de Meta, no un botón del PMS.
