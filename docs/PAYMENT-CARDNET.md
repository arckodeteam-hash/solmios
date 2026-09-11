# CardNet Payment Page — integración verificada (PG-7.5, issue #9)

> Documento de referencia de la pasarela CardNet "Payment Page" (botón de pago web con pantalla, POST + 3DS).
> Issue GitHub #9. Protocolo verificado contra el sandbox real el 2026-09-11.
> Fuente oficial: <https://developers.cardnet.com.do/guias/boton-de-pago/web-con-pantalla-post-3ds.html>
> (el sitio es JS-only; si hace falta leerlo desde un script, sirve `https://r.jina.ai/<url>`).

## 1. Hosts

| Entorno | Host |
|---------|------|
| Test (sandbox) | `https://labservicios.cardnet.com.do` |
| Producción | `https://ecommerce.cardnet.com.do` |

> `qacardnet.cardnet.com.do` (lo que decía el issue) **no resuelve en DNS** y `lab.cardnet.com.do` **no responde en 443**. El único sandbox que funciona es `labservicios`.

---

## 2. Flujo: 4 pasos

### Paso 1 — Crear la sesión: `POST {host}/sessions`

Request JSON (servidor a servidor, desde el backend):

```json
{
  "TransactionType": "0200",
  "CurrencyCode": "214",
  "AcquiringInstitutionCode": "349",
  "MerchantNumber": "349011300",
  "MerchantTerminal": "00567856",
  "ReturnUrl": "https://hotel.zx89.site/api/pay/return/cardnet/<hotelId>?next=...",
  "CancelUrl": "https://hotel.zx89.site/reservar/cancelado",
  "PageLanguaje": "ESP",
  "OrdenId": "RSV-000123",
  "TransactionId": "000123",
  "Tax": "000000000000",
  "Amount": "000000010000",
  "MerchantName": "Hotel Demo",
  "MerchantType": "7011"
}
```

Respuesta:

```json
{ "SESSION": "sess-…", "session-key": "<64 hex>" }
```

Campos:

| Campo | Valor / formato |
|-------|-----------------|
| `TransactionType` | `0200` (venta) |
| `CurrencyCode` | `214` = DOP · `840` = USD |
| `AcquiringInstitutionCode` | por defecto `349` (el de la guía oficial); si el ejecutivo de cuenta entrega otro, va en la credencial guardada `acquiringInstitutionCode` (hoy sin campo en la UI) |
| `MerchantNumber` | afiliado (lo da el ejecutivo de cuenta) |
| `MerchantTerminal` | terminal del afiliado |
| `ReturnUrl` | a dónde CardNet hace POST al terminar (ver paso 3) |
| `CancelUrl` | a dónde vuelve el cliente si cancela |
| `PageLanguaje` (sic) | `ESP` |
| `OrdenId` | referencia nuestra, **≤ 20 caracteres** |
| `TransactionId` | **6 dígitos** |
| `Tax` | **12 dígitos**, unidades menores |
| `Amount` | **12 dígitos**, unidades menores: `000000010000` = RD$100.00 |
| `MerchantName` / `MerchantType` | opcionales |

### Paso 2 — Abrir la página hospedada: `POST {host}/authorize`

El **navegador** del cliente hace `POST {host}/authorize` con el campo `SESSION` (un `GET` devuelve 405). No hay redirect por URL: hay que renderizar un formulario auto-submit.

En solmios: `GET /api/pay/go/cardnet/:hotelId?session=` renderiza ese form auto-submit (módulo `bookingengine`, `hostedFormFor` + `renderHostedForm`).

### Paso 3 — Retorno: CardNet hace **POST form-urlencoded a `ReturnUrl`**

Al terminar (aprobado **o rechazado**) CardNet hace un `POST` con `Content-Type: application/x-www-form-urlencoded` a la `ReturnUrl`:

```
SESSION=sess-…&Description=Transaction+Received
```

No trae resultado ni monto: sólo el `SESSION`. El resultado se obtiene en el paso 4.

En solmios: `POST /api/pay/return/cardnet/:hotelId?next=…` (`parseReturnParams` lee query y body; después redirige a `next`).

### Paso 4 — Consultar el resultado: `GET {host}/sessions/{SESSION}?sk={session-key}`

Respuesta cuando la transacción terminó:

```json
{
  "ResponseCode": "00",
  "AuthorizationCode": "123456",
  "RetrivalReferenceNumber": "…",
  "TxToken": "…",
  "OrdenID": "RSV-000123",
  "TransactionId": "000123",
  "CreditCardNumber": "411111******1111",
  "SESSION": "sess-…"
}
```

| Situación | Respuesta |
|-----------|-----------|
| Aprobado | `ResponseCode` = `"00"` |
| Rechazado | `ResponseCode` = otro código (`"03"`, etc.) |
| Consulta antes de que el cliente termine | **404** `{"message":"rspdata_not_found"}` |
| `sk` incorrecta | **400** `{"message":"invalid_sk"}` |
| Sesión vencida | la sesión vence a los **30 minutos** |

---

## 3. Seguridad

- **No hay firma** (a diferencia de Azul con su HMAC-SHA512). El único secreto es la `session-key` que devuelve `POST /sessions`.
- solmios la persiste **cifrada** (AES-256-GCM, misma master key que las credenciales de pasarela) en la tabla `payment_gateway_sessions` (`PaymentGatewaySessionsModel`, `PaymentGatewaySessionStore`).
- El retorno sólo trae `SESSION`. El pago **sólo se asienta** si:
  1. la sesión es nuestra (existe en `payment_gateway_sessions`),
  2. pertenece al mismo `hotelId` de la ruta, y
  3. CardNet responde `ResponseCode` `"00"` en la consulta del paso 4 (hecha desde el backend con la `session-key` guardada).
- La respuesta de estado **no trae monto**: se usa el de la fila guardada al crear la sesión. Nunca se confía en nada que venga del navegador.

---

## 4. Qué se verificó el 2026-09-11 contra el sandbox

Con el comercio de pruebas de la guía oficial (`MerchantNumber 349011300` / `MerchantTerminal 00567856`) en `https://labservicios.cardnet.com.do`:

| Prueba | Resultado |
|--------|-----------|
| `POST /sessions` | 200, devuelve `SESSION` + `session-key` (64 hex) |
| Página hospedada abierta en Chromium | muestra "Pagar a: PRUEBAS ZTRANS QA3, RD$ 100.00" |
| Pago con `4111111111111111` | CardNet hace **POST** de retorno a `ReturnUrl` con `SESSION` |
| Consulta `GET /sessions/{SESSION}?sk=` después del pago | `ResponseCode` `03` (rechazado: **no hay tarjetas de prueba públicas**) |
| Consulta antes de pagar | 404 `rspdata_not_found` |
| Consulta con `sk` mala | 400 `invalid_sk` |
| `POST /sessions` con cualquier `MerchantNumber` | 200 (**no valida el afiliado** al crear la sesión) |

Test opcional (hace requests reales al sandbox, deshabilitado por defecto):

```bash
cd backend && CARDNET_SANDBOX=1 bun test --env-file .env.test src/modules/payment-gateways/tests/cardnet-sandbox.e2e.test.ts
```

---

## 5. Qué falta / cómo pasar a producción

1. Pedir al ejecutivo de cuenta de CardNet: `MerchantNumber`, `MerchantTerminal` y **tarjetas de prueba** (sin ellas el sandbox siempre responde `03`).
2. Configurar en `/panel/pagos` → CardNet: Comercio (`MerchantNumber`) + Terminal (`MerchantTerminal`). **No hay llave**: la pasarela no usa secreto estático.
3. "Probar conexión" hace un `POST /sessions` real: verifica host y formato de los campos, **no** que el afiliado exista (ver punto anterior de la tabla).
4. Hacer un pago de prueba **de punta a punta** (crear sesión → página hospedada → retorno → consulta) y confirmar `ResponseCode` `00`.
5. Recién después pasar el gateway a modo `live` (`https://ecommerce.cardnet.com.do`).

> Pendiente: los módulos `payments` / `payment-requests` **no envuelven todavía** la `ReturnUrl` con `/api/pay/return` (#196 sólo cubrió `bookingengine`). Hasta que se haga, un link de pago de esos módulos no asienta el cobro de CardNet automáticamente.

> Capacidades declaradas (`CAPABILITIES` en `modules/payment-gateways/service.ts`): `refund: false`, `void: false`, `paymentLinks: false`, `confirmation: 'pull'`. Reembolso y anulación por API son otra afiliación (la REST "sin pantalla").

---

## 6. Referencias de código

| Archivo | Qué hace |
|---------|----------|
| `backend/src/services/payment-gateway/cardnet-gateway.ts` | Cliente HTTP: crear sesión, consultar estado, hosts test/live |
| `backend/src/services/payment-gateway/registry.ts` | `PaymentGatewaySessionStore`: persiste `SESSION` + `session-key` cifrada |
| `backend/src/modules/payment-gateways/model.ts` | `PaymentGatewaySessionsModel` (tabla `payment_gateway_sessions`) |
| `backend/src/modules/bookingengine/usecases/stripe.ts` | `parseReturnParams`, `hostedFormFor`, `renderHostedForm` |
| `backend/src/modules/bookingengine/index.ts` | Rutas `/api/pay/go/:provider/:hotelId` y `/api/pay/return/:provider/:hotelId` (GET y POST) |
| `backend/src/modules/payment-gateways/tests/cardnet-gateway.test.ts` | Tests unitarios del protocolo (mocks) |
| `backend/src/modules/payment-gateways/tests/cardnet-sandbox.e2e.test.ts` | Test opcional contra el sandbox real (`CARDNET_SANDBOX=1`) |
