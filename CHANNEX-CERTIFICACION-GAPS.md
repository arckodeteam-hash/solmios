# Channex — Gap de Certificación PMS (estado 2026-09-01)

> Documento de trabajo. Reemplaza la tabla §3 de `CHANNEX-STAGING-POC.md` (baseline
> junio-2026, "0/14"), que quedó desactualizada: R4 (compresión de rangos), R5
> (connector reservas→canales), R7 (poller del feed) y parte de R3 (push batcheado)
> ya están implementados. Evidencia verificada contra código y API real el
> 2026-09-01. Fuente oficial: https://docs.channex.io/api-v.1-documentation/pms-certification-tests

---

## 0. Veredicto

**Estado: ~6 tests en verde, 4 parciales, 3 rojos + setup de datos sin armar. NO
aprobables hoy.** Los tres que rechazan la postulación de entrada:

1. **Test 12 (Rate Limits)** — no existe cola, limiter ni backoff. Cada evento
   dispara un fetch inmediato.
2. **Test 1 (Full Sync)** — son N llamadas (1 por room type + 1 por rate plan) con
   horizonte 30/90 días; exige 500 días en exactamente 2 llamadas.
3. **Test 2 (Single Date)** — cambiar el precio base de una habitación re-envía un
   rango fijo de 30 días (viola el principio de deltas que exigen en 12/13).

Más el **setup de certificación** (2 room types + 4 rate plans BAR/B&B), que el
sync actual no puede modelar: crea 1 solo rate plan "Standard" por room type.

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
| Propiedad "Test Property - SOLMI OS" (USD) | ❌ | No existe. En staging hay 10 propiedades, todas ruido de POCs. |
| Room type "Twin Room" (occupancy 2) | ❌ | Nuestro sync agrupa `rooms` por `type` — se pueden crear types twin/double, pero hoy no existe esta property. |
| Room type "Double Room" (occupancy 2) | ❌ | ídem |
| Rate plan "Best Available Rate" $100 por RT | ❌ | `syncProperty` crea **1 solo** RP "Standard" por room type (`channex.ts:176`). No hay modelo multi-rate-plan. |
| Rate plan "Bed & Breakfast" $120 por RT | ❌ | ídem — no existe el concepto de plan con desayuno en el sync |

**Lo que falta construir**: soporte de N rate plans por room type (BAR + B&B como
mínimo para el examen) tanto en el modelo de datos del PMS como en el sync, o una
adaptación declarada (Channex permite que single-unit/vacation-rental espejen su
modelo real con nota — SOLMI OS no es single-unit, así que esto no aplica).

---

## 3. Los 14 tests — detalle por test

Leyenda: ✅ cumple · ⚠️ parcial · ❌ no cumple. "Evidencia" es código verificado hoy.

### Test 1 — Full Data Update (Full Sync) ❌

**Exige**: simular alta de hotel / recuperación de downtime: 500 días de
availability + rates + restrictions en **exactamente 2 llamadas API** (1
availability, 1 rates+restrictions), con valores realistas y variados (no una
constante de 500 días).

**Tenemos**:
- `syncProperty()` (`channex.ts:128-197`): horizonte hoy→+30 días (`channex.ts:160-161`),
  luego 1 `POST /availability` **por room type** (`channex.ts:183-186`) y 1
  `POST /restrictions` **por rate plan** (`channex.ts:189-193`).
- Availability push por eventos usa horizonte 90 días (`AVAILABILITY_HORIZON_DAYS`,
  `daily-availability.ts:25`).
- Compresión de rangos ya existe y está testeada: `compressToRanges()`
  (`daily-availability.ts:110-118`), `groupAssignmentsIntoRanges()`
  (`usecases/push-rates.ts:47-74`).

**Falta**:
1. Horizonte 500 días en el full sync.
2. **Consolidar**: la API ya acepta múltiples room types en un solo
   `POST /availability` (array `values` con `room_type_id` por entry) y múltiples
   rate plans en un solo `POST /restrictions` (array `values` con `rate_plan_id`) —
   confirmado en `references/api.md` del skill y docs oficiales. No es limitación
   de la API: nuestro código elige hacer N llamadas. Hay que juntar todo en 1+1.
3. Valores "realistas y variados" — el sync actual repite el precio base plano.

**Esfuerzo**: M (1-3 días). Riesgo: payload grande (500 días × N RT × M RP) —
comprimir bien los rangos; el límite de la API es 10 MB por mensaje.

### Tests 2-4 — Updates de precios (single date / multi rate / multi date) ⚠️

**Exige**: editar precios en la UI → 1 sola llamada API con solo lo cambiado
(T2: 1 fecha 1 rate; T3: 1 fecha varios rates en 1 llamada; T4: varias fechas
varios rates en 1 llamada).

**Tenemos** — dos rutas de push distintas:
- **Ruta grilla de tarifas** (`/tarifas` → `pricing/service.ts:129-133` emite
  `onRatesUpdated` → `connectors/pricing-canales.ts` → `pushSeasonalRates`):
  arma rangos comprimidos de los días editados y hace **1 sola llamada**
  `POST /restrictions` con todos los rate plans (`channex.ts:303`). Tests en
  `push-rates.test.ts` y `obp-push.test.ts`. → **T3 y T4 por esta ruta: ✅**
- **Ruta precio base de habitación** (`PUT /api/habitaciones/:id` con `basePrice`
  → `connectors/habitaciones-canales.ts:12-15` → `pushRate`, `channex.ts:200-215`):
  **re-envía rango fijo hoy→+30d con el precio plano** → **T2: ❌**

**Falta**:
- `pushRate` tiene que mandar el delta mínimo (solo las fechas cuyo precio cambió
  de verdad, en 1 entrada de rango), no 30 días enteros.
- Verificar en vivo que `pushSeasonalRates` ante la edición de UNA celda manda solo
  esa celda y no la temporada entera (los tests de `push-rates.test.ts` cubren la
  agrupación de días pintados, pero hay que confirmarlo contra el escenario exacto
  del examen: "Twin/BAR, 22 Nov 2026 → $333").

**Esfuerzo**: S (medio día) + verificación.

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
  `pushAvailabilityByRoom`, 1 llamada por room type con rangos comprimidos
  (`channex.ts:313-332`). Forma correcta ✅.
- Check-in/checkout también disparan (`reservas/controller.ts:268-269`).

**Falta**:
- **Bug: `connectors/booking-channex.ts:13-17`** (reservas del motor público de
  reservas) llama `pushAvailability({hotelId, roomType, date})` con firma de
  objeto, pero el service expone `pushAvailability(hotelId, roomType)`
  (`service.ts:117`) → **el push del motor de reservas propio es inefectivo**.
  Una reserva hecha desde la web NO baja la dispo OTA hoy.
- Compute de availability: verificar que holds/bloques cuenten como ocupado y
  canceladas excluidas (`daily-availability.ts` lo hace — agregar test explícito
  si no está).

**Esfuerzo**: S (fix de firma + verificación).

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

### Test 12 — Rate Limits ❌ (BLOCKER)

**Exige**: demostrar que hay una cola/limiter que respeta ~20 ARI/minuto con
retry/backoff en 429/5xx. Es pregunta de veto: "¿podés respetar los rate limits?"

**Tenemos**: **nada**. Grep de `429|backoff|retry|rateLimit|throttle|debounce` en
`canales/` y connectors = 0 resultados. Cada evento → fetch inmediato
fire-and-forget; los conectores tragan errores con `.catch(() => {})`;
`syncProperty` hace `Promise.all` paralelo que puede disparar ráfagas.

**Falta**: cola persistente (o al menos in-memory con respaldo) con:
- limiter global ~20 ARI/min,
- coalescing/debounce (1 save = muchos eventos → 1 push),
- retry con backoff exponencial en 429/5xx,
- errores visibles (hoy se pierden en silencio).

**Esfuerzo**: M (1-3 días). Es el ítem 1 del plan — sin esto no tiene sentido
presentar la postulación.

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

| Item | Estado |
|---|---|
| API key (vía `.env` local) | ✅ funciona |
| Propiedades | 10 — **todas ruido de POCs** (2x "Hotel Boutique Palma", 2x "Hotel Demo Canales", "Hotel Test", "Hotel Somi" vacía, + hoteles de prueba multi-tenant). Ninguna es la "Test Property" de certificación |
| Feed `booking_revisions` | ✅ drenado (0 pendientes) |
| Webhooks | 4 registrados con `url: null` — basura de experimentos, limpiar |
| Room types | 21 en total; estructura 1 RP "Standard" por tipo en todas |

### SOLMI OS producción (`hotel.zx89.site`, DB Postgres `solmios`)

| Item | Estado |
|---|---|
| Credencial white-label | ✅ `Configuration(platform,'channex')` = `{apiKey, environment:"staging"}` (101 chars) |
| `.env` | `CHANNEX_BASE_URL=https://staging.channex.io/api/v1` ✅ (correcto pre-certificación) · `CHANNEX_API_KEY` · `CHANNEX_PROPERTY_ID` (vestigial, no la usa el código) |
| Hoteles con sync activo | 3: Hotel Cachela → `06ad869d` ✅ · Hotel Demo Canales → `b21cee74` ✅ · **Hotel Boutique Palma → `6fe6fcd0` = "Hotel Test" ❌** |
| ⚠️ Bug de data | **Palma (la cuenta demo `hotel@solmios.com`) apunta a "Hotel Test"**, la propiedad casi vacía — el mismo mismatch que corregimos en dev el 2026-06-22 y que nunca se corrigió en prod. `lastSync = 2026-09-01T15:27` (alguien sincronizó hoy sobre la propiedad equivocada) |

**Fix de data pendiente en prod**: `UPDATE channel_config SET channexpropertyid
= '647c6642-3b28-4ddb-936f-764d1a2ff926' WHERE hotelid =
'bca45933-075b-4f0b-bed2-322c3cd7a216'` — o mejor: re-sync de Palma apuntando a
la propiedad correcta (con las 2 "Hotel Boutique Palma" que hay en staging, hay
que decidir cuál queda y borrar la otra).

---

## 6. Plan priorizado (dependencias → aprobación)

| P# | Ítem | Desbloquea | Esfuerzo |
|---|---|---|---|
| **P1** | **Cola ARI + limiter ~20/min + retry/backoff 429** (cola con coalescing, errores visibles) | T12 (veto) | M |
| **P2** | **Full sync 500d en exactamente 2 llamadas** (consolidar RTs en 1 availability + RPs en 1 restrictions, rangos comprimidos, valores variados) | T1 | M |
| **P3** | **pushRate por delta** (solo fechas/rangos cuyo precio cambió) | T2, T13 | S |
| **P4** | **Restrictions completas**: `min_stay_through`, CTA, CTD (modelo + payload + UI calendario) | T5/T7/T14 | M |
| **P5** | **Multi-rate-plan** por room type (BAR + B&B) | Setup, T3/T4/T14 | M-L |
| **P6** | **Mapping persistente** `channel_mapping` + sync upsert no destructivo | Robustez, T12 (menos GETs) | M |
| **P7** | Fix firma `connectors/booking-channex.ts` + (opcional) webhook inbound para latencia en screenshare | T9/T10, T11 | S(+M) |
| **P8** | **Limpieza staging**: borrar propiedades de ruido + webhooks `url:null` + crear la "Test Property" con Twin/Double y BAR/B&B | Setup | S |
| **P9** | **Fix data prod**: Palma → propiedad correcta | Cuenta demo usable | S |
| **P10** | Redactar respuestas del cuestionario (T14) con lo soportado/no soportado | T14 | S |

Orden sugerido: **P1 → P2 → P3** (los tres vetos) → **P8/P9** (data, barato, se
puede hacer en paralelo) → **P5 → P4** (setup + restrictions) → **P6 → P7** →
**P10**. Estimación total: ~2-3 semanas de trabajo enfocado.

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
