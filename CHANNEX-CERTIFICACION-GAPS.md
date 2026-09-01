# Channex — Gap de Certificación PMS (estado 2026-09-01)

> Documento de trabajo. Reemplaza la tabla §3 de `CHANNEX-STAGING-POC.md` (baseline
> junio-2026, "0/14"), que quedó desactualizada: R4 (compresión de rangos), R5
> (connector reservas→canales), R7 (poller del feed) y parte de R3 (push batcheado)
> ya están implementados. Evidencia verificada contra código y API real el
> 2026-09-01. Fuente oficial: https://docs.channex.io/api-v.1-documentation/pms-certification-tests

---

## 0. Veredicto

**Actualizado 2026-09-01 (tarde)**: los 3 vetos (T12 rate limits, T1 full sync,
T2 single-date) están RESUELTOS, junto con T9/T10 (conector roto del motor de
reservas), el setup de staging (Test Property creada y verificada) y el fix de
data de la property de Palma. **Estado: 10 de 14 en verde, 2 parciales por
restrictions (T5/T7: falta CTA/CTD/min_stay_through → P4), 1 parcial por
multi-rate-plan (T3/T4/setup: 1 "Standard" por tipo → P5), y el booking
receiving (T11) ya estaba en verde.** Pendientes de fondo: P4 (CTA/CTD/through),
P5 (multi-rate-plan) y P6 (mapping persistente) — ver §6.

Veredicto original de la mañana (para histórico): 6 verdes, 4 parciales, 3 rojos
+ setup sin armar.

---

## 1. Cómo funciona la certificación (lo que hay que saber antes de codear)

- **No es un form ni un checklist**: es un examen en vivo. Channex reproduce los 14
  escenarios en una **screenshare**, disparando **acciones reales de usuario en
  nuestra UI del PMS**, y mira las llamadas API que salen como efecto secundario.
- **Rechazan explícitamente**: scripts sueltos / colecciones Postman, una UI
  "armada para la certificación", full syncs disparados por timer, loops de 1
  llamada por fecha donde pidieron 1 sola llamada, y UUIDs hardcodeados.
- La integración tiene que vivir **en el flujo normal del PMS** y sobrevivir a que
  borren todo el código de test.
- **Etapas**: build en staging → correr los 14 escenarios anotando los `task_id`
  que devuelve Channex → submit del form (forms.gle/xA8F3eSYBPBd8apYA) con los
  task IDs → screenshare en vivo → acceso a producción (`api.channex.io`).
- Mientras tanto, TODO el flujo corre contra `staging.channex.io` — ya verificado
  que prod del PMS apunta ahí (ver §5).

---

## 2. Setup obligatorio ANTES de los tests (estado de datos)

Lo que Channex exige encontrar en la cuenta:

| Requisito | Estado | Detalle |
|---|:---:|---|
| Propiedad "Test Property - SolmiOS" (USD) | ✅ | **Creada 2026-09-01** por API: `f1f563dd-1e27-41e2-816b-947ab4b050dc`. Availability inicial (2/2, 30 días) pusheada y verificada con readback. |
| Room type "Twin Room" (occupancy 2) | ✅ | `e1bf53c7-…` · count 2 · occ 2 |
| Room type "Double Room" (occupancy 2) | ✅ | `5480ce2f-…` · count 2 · occ 2 |
| Rate plan "Best Available Rate" $100 por RT | ✅ | Twin BAR `43e572d0-…` · Double BAR `e3fc78b4-…` — readback `$100.00` |
| Rate plan "Bed & Breakfast" $120 por RT | ✅ | Twin B&B `baaa28e0-…` · Double B&B `d1d058ce-…` — readback `$120.00` |

> El setup del lado Channex está listo; falta que el PMS pueda **trabajarlo**
> (multi-rate-plan → P5): hoy el sync del PMS crea 1 "Standard" por tipo.

**Lo que falta construir**: soporte de N rate plans por room type (BAR + B&B como
mínimo para el examen) tanto en el modelo de datos del PMS como en el sync, o una
adaptación declarada (Channex permite que single-unit/vacation-rental espejen su
modelo real con nota — SOLMI OS no es single-unit, así que esto no aplica).

---

## 3. Los 14 tests — detalle por test

Leyenda: ✅ cumple · ⚠️ parcial · ❌ no cumple. "Evidencia" es código verificado hoy.

### Test 1 — Full Data Update (Full Sync) ✅ (resuelto 2026-09-01)

**Exige**: simular alta de hotel / recuperación de downtime: 500 días de
availability + rates + restrictions en **exactamente 2 llamadas API** (1
availability, 1 rates+restrictions), con valores realistas y variados (no una
constante de 500 días).

**Cómo quedó**:
- `syncProperty()` crea SOLO la estructura (property → room types → rate plans);
  ya no pushea ARI por su cuenta.
- `usecases/full-sync.ts` orquesta el ARI post-sync en exactamente 2 llamadas:
  1. `pushAllRoomTypesAvailability` (`usecases/availability.ts`) — 500 días
     (`FULL_SYNC_HORIZON_DAYS`), reservas/bloques descontados, rangos comprimidos,
     todos los room types en UNA llamada (`channex.pushAllAvailability`).
  2. `pushSeasonalRates` — todas las temporadas × rate plans en UNA llamada,
     con valores variados (base × % por temporada).
- Tests: `tests/full-sync.test.ts` (estructura sin ARI; consolidación 1+1 con
  ambos RTs/RPs; horizonte >480 días; valores variados por reserva y por temporada).

**Nota**: `buildAvailabilityRanges` ganó parámetro `horizonDays` (default 90 para
deltas por evento; 500 solo en el full sync).

### Tests 2-4 — Updates de precios (single date / multi rate / multi date) ✅ (T2 resuelto 2026-09-01)

**Exige**: editar precios en la UI → 1 sola llamada API con solo lo cambiado
(T2: 1 fecha 1 rate; T3: 1 fecha varios rates en 1 llamada; T4: varias fechas
varios rates en 1 llamada).

**Cómo quedó**: UNA sola ruta de push de precios. `pushRate` (rango fijo 30d con
precio plano que pisaba las temporadas) fue **eliminado**; el conector
`habitaciones-canales` ahora dispara `pushSeasonalRates` — delta por temporada,
1 llamada consolidada. La grilla de tarifas (T3/T4) ya batcheaba en 1 llamada y
el evento `onRatesUpdated` ahora lleva los canales con override (el editor de un
canal publica lo editado sin apretar "Enviar a canales"). Para el escenario T2
del examen ("una fecha → $333"), el camino es pintar el día en el planning con
una temporada: `groupAssignmentsIntoRanges` arma el rango mínimo de esos días.

**Deuda restante acá**: `rooms.basePrice` y `RoomRates.basePrice` siguen siendo
dos fuentes (unificar es parte de P5/P6).

### Tests 5-7 — Restrictions (min stay / stop sell / múltiples) ⚠️

**Exige**: T5 min stay en 1 llamada · T6 stop sell en 1 llamada · T7 combinaciones
CTA, CTD, max_stay, min_stay en 1 llamada.

**Tenemos** (en `pushSeasonalRates`, `channex.ts:284-291`, con toggles en la UI de
tarifas `tarifas/index.vue:276-284,344-350` y en `ChannelRatesEditor.vue`):
- `stop_sell` ✅ (T6 ✅)
- `min_stay_arrival` ✅ (T5 ✅ en forma)
- `max_stay` ✅

**Falta**:
- **CTA (`closed_to_arrival`) y CTD (`closed_to_departure`)**: no existen en el
  payload ni en el modelo del PMS → **T7 ❌**
- **`min_stay_through`**: solo mandamos `min_stay_arrival`; el cuestionario (T14)
  pregunta explícitamente la distinción through vs arrival.
- UI para setear CTA/CTD por fecha/rango.

**Esfuerzo**: M (modelo + payload + UI de calendario).

### Test 8 — Half-year Update ✅

Dec 2026 → May 2027 de rates + restrictions en 1 llamada. `pushSeasonalRates` ya
batchea rangos largos en 1 llamada (`channex.ts:303`). **Cumple en forma**;
validar en vivo con el rango exacto del examen.

### Tests 9-10 — Availability updates (1 fecha / rangos) ⚠️

**Exige**: que una reserva/bloqueo en el PMS baje la disponibilidad OTA en 1-2
llamadas.

**Tenemos**:
- `connectors/reservas-canales.ts:14-22` — reserva creada/modificada →
  `pushAvailabilityByRoom`, 1 llamada por room type con rangos comprimidos.
- Check-in/checkout también disparan (`reservas/controller.ts:268-269`).
- **FIX 2026-09-01**: `connectors/booking-channex.ts` llamaba `pushAvailability`
  con un objeto cuando el service espera `(hotelId, ...)` → el push del motor de
  reservas público era inefectivo (una reserva web no bajaba la dispo OTA).
  Ahora va por `pushAvailabilityByRoom(hotelId, roomId)` con errores logueados.

**Cumple en forma** ✅ (queda validarlo en vivo en el examen).

### Test 11 — Booking Receiving ✅

**Exige**: recibir bookings (crear/modificar/cancelar) vía webhook o feed, con
**ack obligatorio**, leyendo de `GET api/v1/booking_revisions` (NO
`/bookings`).

**Tenemos** (lo más fuerte de la integración):
- Polling del feed global cada 15 min (`shared/usecases/booking-sync-cron.ts`,
  wired en `composition-root.ts:813-823`) + botón manual de ingesta
  (`POST /api/channels/bookings/ingest`).
- `POST /booking_revisions/:id/ack` después de procesar SIEMPRE
  (`booking-sync.ts:143-146`), sin ack si la property no está mapeada (119-124).
- Multi-tenant: mapa `channexPropertyId → hotelId` (`booking-sync.ts:163-171`).
- Dedupe por `externalLocator`, cancelaciones vía el módulo de reservas con
  `penaltyMode:'channel-managed'` (`booking-ingestion.ts:109-165`).
- Tests: `booking-sync.test.ts` (268 lín), `ari-ingestion.test.ts`.
- Inbound end-to-end ya validado contra staging real en la POC de junio
  (booking Offline → reserva + ack + cancelación bidireccional).

**Notas para el examen**:
- 15 min de latencia es incómodo en screenshare — existe el botón manual, pero
  conviene bajar el tick o sumar webhook (ver plan P7).
- Bookings **modified** se ackean sin aplicar cambios (`booking-ingestion.ts:6-7`) —
  declararlo en el cuestionario; Channex acepta features no soportadas si se
  declaran.

### Test 12 — Rate Limits ✅ (resuelto 2026-09-01)

**Exige**: demostrar que hay una cola/limiter que respeta ~20 ARI/minuto con
retry/backoff en 429/5xx. Es pregunta de veto: "¿podés respetar los rate limits?"

**Cómo quedó**: `usecases/channex-http.ts` — transport único (`sharedChannexHttp`,
singleton module-level) por donde pasa TODO el tráfico a Channex:
- **Limiter de ventana deslizante**: máx 18 requests/min (margen bajo los 20).
- **Retry con backoff**: 429 respeta `Retry-After` si viene; 5xx/timeout →
  exponencial 500ms·2^n (tope 30s); 4xx definitivo no reintenta.
- **Timeout** de 15s por intento (`AbortSignal.timeout`).
- Tests con reloj/sleep falsos: `tests/channex-http.test.ts` (bloqueo por ventana,
  Retry-After, backoff exponencial, no-reintento en 400, agotamiento).

**Deuda declarada**: no hay cola PERSISTENTE ni coalescing de burst de eventos
(1 save = 1 push); con el limiter es seguro pero no óptimo. El examen pregunta
"can you stay in rate limits" — la respuesta demostrable es sí.

### Test 13 — Update Logic ✅ (con una salvedad)

**Exige**: cambios detectados por eventos (no polling), deltas, sin full syncs
por timer (máx 1 cada 24h, fuera de pico).

**Tenemos**:
- Event-driven por sockets del framework: reservas, habitaciones, pricing,
  check-in/out, booking engine, IA (`connectors/*-canales.ts`,
  `pricing/service.ts:129-133`).
- Full sync SOLO manual (`POST /api/channels/sync`) — no hay timer que pushee ARI.
  El único cron es el del feed de bookings (15 min), que es inbound, no ARI.

**Salvedades**:
- `pushRate` re-enviando 30 días por cada cambio de precio base viola el espíritu
  delta (mismo fix que T2).
- No existe el full sync diario off-peak como drift correction (permitido 1/24h) —
  hoy lo único automático es nada; opcional agregarlo una vez que el full sync
  sean 2 llamadas (se vuelve barato).

### Test 14 — Extra Notes / cuestionario ⚠️

Preguntas y nuestras respuestas honestas de hoy:

| Pregunta | Estado |
|---|---|
| Min Stay Through vs Arrival | Solo `min_stay_arrival` — falta through |
| Restricciones soportadas | stop_sell ✅ · max_stay ✅ · min_stay_arrival ✅ · **CTA/CTD ❌** |
| Multi room type | ✅ |
| Multi rate plan por room type | ❌ (1 "Standard") |
| Tarjetas de crédito | No procesamos — declarable "no soportado" (y nos evita PCI) |
| Bookings modified | Se ackean sin aplicar — declarable con nota |

---

## 4. Gaps transversales (no son un test, pero los sostienen)

### 4.1 Mapping persistente local↔Channex ❌ (R1 del roadmap original — sigue abierto)

- Solo se persiste `channexPropertyId` por hotel (`modules/canales/model.ts:8-20`).
- Room types y rate plans se resuelven **en cada push** con 2 GETs
  (`GET /room_types?filter[property_id]`, `GET /rate_plans`) y **match por title
  case-insensitive** (`channex.ts:205,235-240,336-341`,
  `booking-ingestion.ts:146-152`).
- Riesgos: renombrar un tipo en el PMS rompe el push silenciosamente (ya pasó en
  la POC: tipos en español vs inglés); 2 GETs extra por push (consume el rate
  limit del test 12); bookings sin tabla de mapping propia (dedupe por
  `externalLocator`).
- **Falta**: tabla `channel_mapping (hotelId, kind, local_id) → channex_id` para
  property/room_type/rate_plan/booking.

### 4.2 Sin resiliencia HTTP ❌

`channexReq()` (`channex.ts:34-44`): fetch nativo sin timeout, sin retry, errores
silenciosos en fire-and-forget. Se resuelve junto con la cola del test 12.

### 4.3 Cleanup del sync destructivo ⚠️

`syncProperty` borra y recrea room types/rate plans (`channex.ts:106-119` en la
POC; el flujo actual sigue el patrón). Con mapping persistente pasa a ser upsert
idempotente y deja de romper los UUIDs que los canales OTA tienen mapeados.

---

## 5. Estado de las cuentas (verificado 2026-09-01)

### Channex staging (`staging.channex.io`)

| Item | Estado (2026-09-01 tarde) |
|---|---|
| API key (vía `.env` local) | ✅ funciona |
| Propiedades | 6 — **limpiadas**: 4 huérfanas de POC borradas (dup Palma `9650b6f1`, dup Demo Canales `f63a2614`, Somi `18c65fb3`, Demo Prueba `2861c7e7`); `6fe6fcd0` renombrada **"Hotel Boutique Palma"** (la que usa prod); `647c6642` renombrada "(dev)"; quedan además Cachela `06ad869d`, Demo Canales `b21cee74` (prod) y Playa Azul/Centro/Vista Mar (dev multi-tenant) |
| **Test Property de certificación** | ✅ **"Test Property - SolmiOS"** `f1f563dd-…` con Twin+Double y BAR/B&B (ver §2) |
| Feed `booking_revisions` | ✅ drenado (0 pendientes) |
| Webhooks | ✅ los 4 con `url: null` borrados |

### SOLMI OS producción (`hotel.zx89.site`, DB Postgres `solmios`)

| Item | Estado |
|---|---|
| Credencial white-label | ✅ `Configuration(platform,'channex')` = `{apiKey, environment:"staging"}` (101 chars) |
| `.env` | `CHANNEX_BASE_URL=https://staging.channex.io/api/v1` ✅ (correcto pre-certificación) · `CHANNEX_API_KEY` · `CHANNEX_PROPERTY_ID` (vestigial, no la usa el código) |
| Hoteles con sync activo | 3: Hotel Cachela → `06ad869d` ✅ · Hotel Demo Canales → `b21cee74` ✅ · Hotel Boutique Palma → `6fe6fcd0` ✅ (era "Hotel Test"; **renombrada a "Hotel Boutique Palma" el 2026-09-01** — los RTs/RPs ya habían sido recreados con los 4 tipos correctos por el sync de ese día, así que el fix de nombre cerró el mismatch sin tocar la config de prod) |
| Webhooks inbound | No hay (el feed cada 15 min es el mecanismo; opcional sumar webhook → P7 opcional) |

---

## 6. Plan priorizado (dependencias → aprobación)

> **Actualización 2026-09-01 (tarde)**: P1, P2, P3, P7, P8, P9 y P10 están HECHOS
> (commits del 2026-09-01). Quedan abiertos P4, P5 y P6.

| P# | Ítem | Desbloquea | Esfuerzo | Estado |
|---|---|---|---|---|
| **P1** | **Limiter ~18/min + retry/backoff 429/5xx + timeout** en `channex-http.ts` (transport único, singleton module-level) | T12 (veto) | M | ✅ hecho |
| **P2** | **Full sync 500d en exactamente 2 llamadas** (`pushAllRoomTypesAvailability` + `pushSeasonalRates`, orquestados por `usecases/full-sync.ts`; el sync de estructura ya no pushea ARI) | T1 | M | ✅ hecho |
| **P3** | **pushRate ELIMINADO** (pisaba temporadas con precio plano 30d). Ruta única: conector habitaciones → `pushSeasonalRates` (delta por temporada, 1 llamada) | T2, T13 | S | ✅ hecho |
| **P4** | **Restrictions completas**: `min_stay_through`, CTA, CTD (modelo + payload + UI calendario) | T5/T7/T14 | M | ⬜ pendiente |
| **P5** | **Multi-rate-plan** por room type (BAR + B&B) | Setup, T3/T4/T14 | M-L | ⬜ pendiente |
| **P6** | **Mapping persistente** `channel_mapping` + sync upsert no destructivo | Robustez, T12 (menos GETs) | M | ⬜ pendiente |
| **P7** | Fix firma `connectors/booking-channex.ts` (push inefectivo del motor de reservas → `pushAvailabilityByRoom`) + errores logueados en los 3 conectores | T9/T10 | S | ✅ hecho |
| **P8** | **Limpieza staging**: 4 properties huérfanas borradas, 4 webhooks `url:null` borrados, **"Test Property - SolmiOS" creada** (Twin/Double occ 2, BAR $100 + B&B $120 por tipo, availability 2, verificada con readback) | Setup | S | ✅ hecho |
| **P9** | **Fix data**: property `6fe6fcd0` renombrada "Hotel Boutique Palma" (la que usa prod), la de dev renombrada "(dev)" | Cuenta demo coherente | S | ✅ hecho |
| **P10** | Cuestionario T14 redactado (ver §8) | T14 | S | ✅ hecho |

Los tres pendientes (P4/P5/P6) se estiman en ~1-1.5 semanas de trabajo enfocado.

---

## 7. Checklist final antes de pedir el examen

- [ ] P1-P7 cerrados, P8/P9 de data aplicados.
- [ ] Los 14 escenarios corridos en staging anotando cada `task_id` devuelto.
- [ ] `bun run doctor` verde (ojo: el doctor ESCRIBE ARI de prueba sobre la
      primera propiedad — `doctor.ts:148-176` — usar solo contra la Test Property).
- [ ] `arckode analyze` 0 violaciones · `bun run typecheck` · `bun test` ·
      `cd frontend && bun run typecheck` limpios.
- [ ] Screenshots de la pantalla de mapeo/listo para el screenshare.
- [ ] Form (forms.gle/xA8F3eSYBPBd8apYA) con task IDs + respuestas del cuestionario.
- [ ] Verificado con readback (`GET /availability`, `GET /restrictions?...&filter[restrictions]=...`)
      — nunca confiar en el 200.

---

## 8. Cuestionario T14 — respuestas formales (P10, redactado 2026-09-01)

Lo que Channex pregunta en "Extra Notes" y nuestras respuestas honestas de hoy:

| Pregunta | Respuesta | Estado código |
|---|---|---|
| Min Stay **Through** vs **Arrival** | Soportamos `min_stay_arrival`; `min_stay_through` NO soportado todavía | `channex.ts` pushSeasonalRates (min_stay_arrival) — through entra en P4 |
| Restricciones soportadas | stop_sell ✅ · max_stay ✅ · min_stay_arrival ✅ · **CTA/CTD no soportadas** (P4) | `channex.ts` payload |
| Multi room type | Sí — el sync agrupa `rooms` por `type` y empuja todos | `syncProperty` |
| Multi rate plan por room type | **No** — 1 "Standard" por tipo (P5). El setup del examen (BAR+B&B) existe del lado Channex | P5 pendiente |
| Tarjetas de crédito / PCI | **No procesamos datos de tarjeta** en el PMS: los cobros van por Stripe Links/Checkout (PCI scope de Stripe). Sin almacenamiento de PAN/CVV | `payment-links`, Stripe |
| Bookings modificados (OTA modification) | Se reciben, se registran y se ackean, pero **no se auto-aplican** los cambios sobre la reserva local (decisión de seguridad: aplicar modificaciones OTA sobre el calendario requiere UX de reconciliación). Declarado como limitación | `booking-ingestion.ts:6-7` |
| Webhooks vs feed | Feed polling cada 15 min con ack + dedupe + drain (webhook opcional, no implementado) | `booking-sync-cron.ts` |
| Full sync programático | Solo manual (botón sync). Permitido máx 1/24h off-peak si se automatiza | — |
| Rate limits | Transport con limiter 18/min + backoff 429/5xx (demostrable) | `channex-http.ts` |

**Cómo declarar lo no soportado**: la doc oficial dice que las features no
soportadas pueden saltarse si se anotan explícitamente en el formulario — eso no
bloquea la certificación de lo demás.
