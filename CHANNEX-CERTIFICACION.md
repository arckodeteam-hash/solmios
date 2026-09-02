# Certificación PMS de Channex — qué nos falta

> Auditoría de la integración real (`backend/src/modules/canales/`, `backend/src/connectors/*canales*`, `backend/src/shared/usecases/booking-sync-cron.ts`) contra el checklist oficial de Channex: https://docs.channex.io/api-v.1-documentation/pms-certification-tests
>
> Hecha el 2026-09-01. Todo lo citado abajo es código que ya existe hoy en el repo — no hay nada inventado ni simulado.

## Veredicto

Según el **pre-flight checklist del propio Channex**, todavía no estamos listos para arrancar los 14 tests de certificación. Fallamos 2 de los 5 puntos obligatorios, y un tercero está débil. Channex lo dice explícito en su documento: *"If any of these is missing, stop and build it first."*

No tiene sentido llenar el formulario de certificación (https://forms.gle/xA8F3eSYBPBd8apYA) todavía — en la revisión en vivo por screenshare (etapa 4 de su proceso) se nota inmediatamente si falta una cola/rate limiter real, y nos devuelven a la etapa 1.

## 1. Checklist pre-flight de Channex

| # | Requisito de Channex | Estado | Evidencia |
|---|---|---|---|
| 1 | Detecta cambios de ARI en tiempo real (evento/observer, no polling sobre la DB) | ✅ Sí | Patrón: módulo emite socket → connector lo escucha → empuja a Channex. Ej. `backend/src/connectors/pricing-canales.ts:13-21`, `backend/src/connectors/habitaciones-canales.ts:12-15`, `backend/src/connectors/reservas-canales.ts:14-22` |
| 2 | Cola/outbox que respeta el límite de 20 llamadas ARI/minuto | ❌ **No existe** | No hay tabla de cola, no hay worker que la drene, no hay rate limiter para llamadas salientes a `api.channex.io`. El único rate limiter del repo (`backend/src/shared/middlewares/rate-limit.ts`) protege *nuestra propia API entrante*, no las llamadas salientes a Channex. |
| 3 | Retry/backoff para respuestas 429 y 5xx | ❌ **No existe** | `channexReq` (`backend/src/modules/canales/usecases/channex.ts:34-44`) es un `fetch()` desnudo: sin distinguir status code, sin `Retry-After`, sin backoff, sin reintento. Un push fallido se pierde (paths "fire-and-forget") o rompe el guardado en el panel (paths síncronos). |
| 4 | Webhook para recibir reservas + flujo de acknowledgement | ⚠️ Parcial | No hay webhook HTTP real — es **polling cada 15 minutos** contra `booking_revisions/feed` (`backend/src/shared/usecases/booking-sync-cron.ts`, cron registrado en `composition-root.ts:816-823`). El `ack` sí está bien implementado (`channex.ts:534-537`, `POST /booking_revisions/:id/ack`), y usamos el endpoint correcto (`booking_revisions/feed`, **no** el `GET /bookings` deprecado). |
| 5 | Mapeo interno (roomId/rateId) ↔ UUID de Channex | ⚠️ Débil | No hay columna que guarde el UUID. Se resuelve **en vivo, por nombre de habitación** (case-insensitive string match) en cada push (`channex.ts:336-341` y otros). Frágil: renombrar una habitación en el panel rompe el mapeo en silencio. Además gasta llamadas extra en cada push, lo que empeora el problema del punto 2. |

**Los puntos 2 y 3 son los bloqueantes reales.** El punto 5 no bloquea per se, pero agrava el punto 2 (cada push gasta 1-2 llamadas de más solo para re-resolver IDs que ya se resolvieron antes).

## 2. Qué construir, en orden de impacto

### 2.1 Cola + rate limiter (bloqueante #1)
Falta un mecanismo que:
- Encole cada cambio de ARI en vez de llamar a Channex directo desde el connector.
- Drene la cola respetando el límite de 20 llamadas/minuto (documentado en https://docs.channex.io/api-v.1-documentation/rate-limits).
- Sirva también como base para el retry (punto 2.2): un item de la cola que falla vuelve a la cola en vez de perderse.

Los connectors actuales (`pricing-canales.ts`, `habitaciones-canales.ts`, `reservas-canales.ts`) ya son el lugar correcto para *encolar* — hoy llaman directo a `CanalesService`, tendrían que pasar a insertar en la cola nueva en su lugar. No hace falta tocar el modelo de datos del resto del sistema, solo el punto de entrada a Channex.

### 2.2 Retry/backoff para 429 y 5xx (bloqueante #2)
`channexReq` (`backend/src/modules/canales/usecases/channex.ts:34-44`) necesita:
- Leer el status code de la respuesta.
- En 429: respetar `Retry-After` si viene, o backoff exponencial con jitter, y reintentar desde la cola (no perder el cambio).
- En 5xx: mismo backoff, tope de reintentos, y si se agotan, dejar constancia clara (hoy `sync_log` es solo auditoría de lectura — habría que empezar a usarlo para saber qué quedó pendiente de reintentar, o agregar los campos que le faltan: `retryCount`, `status: pending/failed`, `nextAttemptAt`).

### 2.3 Full sync real (test #1 del certificado)
`syncProperty` (`channex.ts:128-197`) hoy:
- Cubre solo **30 días**, no los ~500 que pide el test.
- Dispara **una llamada POST por cada tipo de habitación** (disponibilidad) **+ una por cada rate plan** (tarifas/restricciones) en paralelo vía `Promise.all` — no las 2 llamadas batcheadas que exige el test ("1 x 500 días Availability, 1 x 500 días Rates & restrictions").

Ya existe el patrón correcto para copiar: `pushSeasonalRates` (`channex.ts:222-307`) arma **un solo array `values[]`** con todas las entradas y manda **una** llamada — hay que aplicar la misma lógica al sync inicial, ampliando el rango de fechas.

### 2.4 Mapeo de IDs guardado (no resuelto por nombre)
Agregar una columna (ej. `channexRoomTypeId` en `Rooms`, `channexRatePlanId` en donde corresponda) que se llene una vez al crear/sincronizar el room type/rate plan en Channex, y que los pushes posteriores lean de ahí en vez de volver a pedir `GET /room_types`/`GET /rate_plans` y hacer match por título cada vez.

### 2.5 Limpieza menor (no bloqueante, pero vale la pena)
- `backend/src/connectors/booking-channex.ts` está roto: llama a `canales.pushAvailability?.({hotelId, roomType, date})` pasando un objeto donde la función espera `(hotelId: string, roomType: string)` — hoy es un no-op silencioso (el error queda tragado por su propio `.catch(() => {})`). El path real de disponibilidad funciona por otro lado (`reservas-canales.ts`), así que esto no rompe nada hoy, pero conviene arreglarlo o borrarlo para no confundir a nadie.
- `channexGroupId` existe en el tipo (`types.ts:11`) y se lee en `generateIframeToken`, pero nunca se guarda en ningún lado — queda siempre `undefined` en la práctica.

## 3. Qué declarar como "no soportado" en el formulario

Channex lo permite explícitamente ("If you cant support anything please make a note in the certification file"). Declarar:

- **`closed_to_arrival` (CTA) y `closed_to_departure` (CTD)** — no existen ni en el modelo de datos (`RoomRates`) ni en el payload que mandamos. Solo soportamos `stop_sell`, `min_stay_arrival` y `max_stay`.
- **`min_stay_through`** — solo tenemos un único campo `minStay`, siempre se manda como `min_stay_arrival`.
- **Múltiples rate plans por tipo de habitación** — hoy es 1 a 1 (un solo rate plan por room type, título `"{Room Type} Standard"`). No hay forma de representar, por ejemplo, "Best Available Rate" + "Bed & Breakfast Rate" para el mismo Twin Room. Esto ya estaba documentado como limitación conocida en el propio código (`open-channel-api.ts:96-97`).

## 4. Los 14 tests del certificado — estado esperado hoy

| # | Test | ¿Pasaría hoy? | Por qué |
|---|---|---|---|
| 1 | Full Data Update (Full Sync) | ❌ No | Solo 30 días, no ~500; no son 2 llamadas batcheadas (ver 2.3) |
| 2 | Single Date Update, Single Rate | ✅ Probablemente sí | `pushRate`/`pushSeasonalRates` cubren este caso |
| 3-8 | Multi rate plan / multi room type / stop sell / restricciones / medio año | ⚠️ No aplican tal cual | Nuestro modelo es 1 room type : 1 rate plan — hay que adaptar cada test a esa estructura y aclararlo en el formulario, tal como Channex permite para "single-unit or single-rate products" (sección "Setup Mapping" del documento) |
| 9-10 | Disponibilidad (single/multi fecha) | ✅ Probablemente sí | `pushAvailability` está bien batcheado dentro de un room type |
| 11 | Recepción de reservas (crear/modificar/cancelar + ack) | ✅ Sí, con matiz | El polling de 15 min podría ser lento para la revisión en vivo si esperan ver la reserva aparecer "en el momento" — probablemente conviene poder forzar un sync manual durante la llamada (el botón de admin ya existe) |
| 12 | Rate Limits | ❌ No | No hay limiter — ver bloqueante #1 |
| 13 | Update Logic (solo deltas, no full-sync por timer) | ✅ Sí | Confirmado: los pushes son por evento, no hay ningún timer que reenvíe todo periódicamente |
| 14 | Extra Notes (preguntas de soporte) | — | Ver sección 3 de este documento para las respuestas |

## 5. Orden recomendado

1. Cola + rate limiter (bloqueante duro, sección 2.1)
2. Retry/backoff (sección 2.2) — se apoya en la cola del paso 1
3. Full sync a 500 días batcheado (sección 2.3) — necesario para el test #1, el primero que piden
4. Mapeo de IDs guardado (sección 2.4) — mejora la eficiencia y reduce el riesgo de tropezar con el rate limit
5. Recién ahí: correr los 14 tests contra el staging de Channex, juntar los `task_id` de cada respuesta, y llenar el formulario

## Referencias
- Documento de certificación: https://docs.channex.io/api-v.1-documentation/pms-certification-tests
- Rate limits de Channex: https://docs.channex.io/api-v.1-documentation/rate-limits
- Best Practices Guide de Channex (mencionado en su documento, revisar antes de implementar la cola)
- Formulario de certificación: https://forms.gle/xA8F3eSYBPBd8apYA
