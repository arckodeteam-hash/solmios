# Certificación PMS de Channex — cada punto que piden, resuelto

> **2026-09-12.** Un punto por fila de lo que exige https://docs.channex.io/api-v.1-documentation/pms-certification-tests,
> con lo que hicimos, la prueba y el texto en inglés para pegar en el formulario (https://forms.gle/xA8F3eSYBPBd8apYA).
> Task ids de la corrida del 2026-09-12 contra producción (`solmios.com` → `staging.channex.io`): **26 checks OK · 0 fallidos**.
> Los links de cada pantalla y el checklist del día de la screenshare están en `CHANNEX-CERTIFICACION-CHECKLIST.md`.

**Identificadores del examen**

| Qué | Valor |
|---|---|
| Provider | SolmiOS |
| Property de Channex | `bddf7d23-83c5-437d-a2ff-c4e85ccaf412` — "Test Property - SolmiOS" (USD) |
| Hotel en el PMS | `a7c8d8e4-90a6-4431-862b-a09dff6bdc43` |
| Canal | SolmiOS Open `ef9481b7-0ebe-4419-9cbc-5deb22abf47b` — activo, 4/4 rate plans mapeados |
| Room types | Twin Room (occ 2, 2 unidades) · Double Room (occ 2, 2 unidades) |
| Rate plans | Twin BAR · Twin Bed & Breakfast · Double BAR · Double Bed & Breakfast |
| Webhook | `https://solmios.com/api/channels/channex/webhook` — `booking_new;booking_modification;booking_cancellation` |

---

## Stage 1 — Pre-flight (responder "yes" con ruta de archivo)

| # | Lo que piden | Resuelto | Dónde |
|---|---|---|---|
| P1 | Mecanismo que detecta cambios de ARI **al ocurrir**, no un polling | ✅ Eventos del framework (sockets) → connectors → outbox por hotel con debounce de 1,5 s | `backend/src/connectors/*-canales.ts` · `backend/src/modules/ari-outbox/usecases/outbox-queue.ts:16` |
| P2 | Cola/outbox que **batchea** respetando **20 ARI/min** | ✅ Outbox persistente, un push por hotel por ráfaga, drain secuencial; transporte con 18/min global + 9/min por property y endpoint | `backend/src/modules/ari-outbox/` · `backend/src/modules/canales/usecases/channex-http.ts:52,55` |
| P3 | Retry/backoff ante **429 y 5xx** | ✅ `Retry-After` manda; si no, 500 ms·2ⁿ hasta 30 s; 429 en ARI pausa esa property 60 s | `channex-http.ts:39` (`RETRYABLE_STATUS`), `backoffMs`, `pauseProperties` |
| P4 | Endpoint de **webhook** para reservas + **ack** | ✅ Receptor registrado en la cuenta con **`send_data: true`** (con `false` Channex no manda `payload.revision_id` — bug #342, corregido y el webhook de la cuenta actualizado el 2026-09-12); ack tras procesar cada revisión; feed de respaldo cada minuto | `backend/src/modules/canales/usecases/channex-webhook.ts:19` · `booking-sync.ts:143-146` |
| P5 | Capa de **mapping** IDs internos ↔ UUIDs de Channex | ✅ Mapping persistido por hotel (property, room types, rate plans) con fallback GET+título | `backend/src/modules/canales/usecases/channex.ts:85-117` |

**Texto para el formulario (EN)**

> P1 — Yes. ARI changes are captured as domain events (rate edited, restriction changed, reservation created/cancelled) in `backend/src/connectors/*-canales.ts` and queued in `backend/src/modules/ari-outbox/` (1.5 s debounce). No polling loop.
> P2 — Yes. Persistent outbox per property, one batched call per burst, sequential drain. Shared HTTP transport enforces 18 ARI/min globally and 9/min per property for each of `POST /availability` and `POST /restrictions` (`backend/src/modules/canales/usecases/channex-http.ts`).
> P3 — Yes. 429/5xx/timeouts retry with `Retry-After` when present, else exponential backoff (0.5 s → 30 s); a 429 on an ARI call pauses that property's endpoint for 60 s.
> P4 — Yes. Webhook receiver `POST /api/channels/channex/webhook` (`backend/src/modules/canales/usecases/channex-webhook.ts`), registered on the account for `booking_new;booking_modification;booking_cancellation`; every processed revision is acknowledged. `GET /booking_revisions/feed` every 15 min as fallback.
> P5 — Yes. Property, room type and rate plan UUIDs are stored per hotel and resolved in `backend/src/modules/canales/usecases/channex.ts`.

---

## Setup — property de staging

| Lo que piden | Resuelto |
|---|---|
| Nombre `Test Property - [Provider]` | ✅ "Test Property - SolmiOS" |
| Moneda USD | ✅ |
| 2 room types (Twin, Double, occ 2) | ✅ creados por el PMS vía API |
| 4 rate plans (Twin/Double × BAR/B&B) | ✅ creados por el PMS vía API |
| Mapping por API (Property / Room Type / Rate Plan) | ✅ la property la creó el PMS; canal activo con 4/4 mapeados (`docs/evidencia/channex-certificacion/02-mapeo-4-de-4.png`) |

---

## Stage 2 — Los 14 tests

| # | Lo que piden | Resuelto | Llamadas | Task ids (2026-09-12) |
|---|---|---|:-:|---|
| 1 | Full sync: 500 días de availability + rates + restrictions, todo el inventario, **en 2 llamadas**, datos variados | ✅ Botón **Sincronizar** → 1 `POST /availability` (500 días, reservas descontadas) + 1 `POST /restrictions` (4 rate plans × temporadas, precios distintos por temporada y plan). El mapeo del canal sobrevive al sync (4 → 4) | 2 | `e8d6398a-2ded-4daf-9620-0d9101825b2b` · `5f7d64da-850c-4237-abba-a1b794a7b02a` |
| 2 | Twin · BAR · 22-nov-2026 · $333 | ✅ Edición en la grilla → push automático; readback `rate: 333.00` | 1 | `0ebf1d92-6266-419f-84c4-cde12b610728` |
| 3 | Twin·BAR·21-nov $333 · Double·BAR·25-nov $444 · Double·B&B·29-nov $456.23 — **1 llamada** | ✅ Tres ediciones, el debounce las junta; los 3 valores en un solo task | 1 | `573b4950-a55d-49c7-b168-317a449239d3` |
| 4 | Twin·BAR·1–10 nov $241 · Double·BAR·10–16 nov $312.66 · Double·B&B·1–20 nov $111 — **1 llamada** | ✅ Rangos con `date_from/date_to`, readback sin huecos | 1 | `94800985-f45b-44f3-a1d7-99b9331939d3` |
| 5 | Min stay: Twin·BAR·23-nov 3 · Double·BAR·25-nov 2 · Double·B&B·15-nov 5 — **1 llamada** | ✅ `min_stay_arrival` (y `min_stay_through` también soportado, ver T14) | 1 | `38b817e9-5a26-4ed8-850c-f4868773f69f` |
| 6 | Stop sell: Twin·BAR·14-nov · Double·BAR·16-nov · Double·B&B·20-nov — **1 llamada** | ✅ `stop_sell: true` en los 3 | 1 | `59925b4d-e00d-4129-bc9b-2ca26276a0d4` |
| 7 | Restricciones combinadas: Twin·BAR·1–10 CTA+max4+min1 · Twin·B&B·12–16 CTD+min6 · Double·BAR·10–16 CTA+min2 · Double·B&B·1–20 min10 — **1 llamada** | ✅ CTA, CTD, `max_stay`, `min_stay_arrival` y `min_stay_through` sobre los 4 rate plans en un task | 1 | `9fa6b63c-e9d6-455e-ad38-408fb831200b` |
| 8 | Medio año: Twin·BAR $432 min 2 · Double·BAR $342 min 3, 1-dic-2026 → 1-may-2027 — **1 llamada** | ✅ Readback a mitad del rango 432/342 | 1 | `a8ee2ae4-068c-43dd-8ba8-876ad590372e` |
| 9 | Disponibilidad por **reserva** en el PMS: Twin·21-nov 8→7 · Double·25-nov 1→0 (1–2 llamadas) | ✅ Cada reserva dispara su push: Twin 2→1, Double 1→0 (escalado a nuestras 2 unidades). En la screenshare se hace con 2 reservas = 2 llamadas; el runner usa 3 para agotar Double | 3 | `52fc0fce-9001-4f61-98be-b15f63774a93` · `7b0c3b09-23d1-4b93-baaf-2325e1c66908` · `08441c42-24c4-467a-8eaa-f961d423dc00` |
| 10 | Disponibilidad por rangos: Twin·10–16 nov =3 · Double·17–24 nov =4 (1–2 llamadas) | ✅ 2 reservas de varias noches = 2 llamadas, rangos comprimidos | 2 | `e0874069-3a50-4c04-8d06-e46dd33ff4ca` · `46e4fd13-0da7-4950-bd63-451104bc7287` |
| 11 | Recibir, **ackear** y (recomendado) webhook; usar `GET /booking_revisions`, no `/bookings`; screenshots + booking id | ✅ Webhook registrado + feed `booking_revisions` cada 15 min + botón "Recibir Reservas"; ack siempre después de procesar; dedupe por `externalLocator`; cancelaciones OTA se aplican a la reserva local. El booking id lo genera Channex en la screenshare | — | — |
| 12 | Confirmar por escrito que se respetan los rate limits | ✅ Texto abajo | — | — |
| 13 | Solo deltas por evento; full sync ≤ 1/24 h en horario valle | ✅ Ningún timer pushea ARI; el full sync es solo el botón manual | — | — |
| 14 | Documentar features soportadas / no soportadas | ✅ Texto abajo | — | — |

### Test 12 — texto para el formulario (EN)

> Single shared HTTP transport for all Channex traffic. Sliding-window limiter: 18 ARI updates/min globally (under your 20/min limit) plus 9/min per property for `POST /availability` and 9/min per property for `POST /restrictions` (under your 10/min per-property limits). Only ARI updates are throttled — content CRUD and GETs are not. On 429 we honour `Retry-After` (else exponential backoff 0.5 s → 30 s) and pause that property's endpoint for 60 s, as your documentation recommends. Changes are batched per property with a 1.5 s debounce and drained sequentially from a persistent outbox, so one burst of edits in the PMS becomes one API call. Full sync is manual only and takes exactly 2 calls (1 availability + 1 restrictions, 500 days). Each request payload stays far below the 10 MB limit.

### Test 13 — texto para el formulario (EN)

> Updates are event-driven deltas: only the rates, restrictions or availability that changed are sent, batched per property. There is no timer-based full sync. Full sync exists only as a manual "Sync" action for onboarding or recovery.

### Test 14 — features (texto para el formulario, EN)

| Lo que piden | Respuesta |
|---|---|
| Minimum stay types | Both **`min_stay_arrival`** and **`min_stay_through`** are supported and pushed separately (verified with different values on T7). In the PMS they are edited in two places: "Mín. al llegar" (arrival, per room) and "Mín. en estadía" (through, per season). |
| Unsupported restriction types | **None.** `stop_sell`, `closed_to_arrival`, `closed_to_departure`, `min_stay_arrival`, `min_stay_through`, `max_stay` are all supported. |
| Multiple room types / rate plans | Yes — multiple room types per property and multiple rate plans per room type (the test property runs 2 × 2). |
| Credit card requirement | No. The PMS does not request, process or store card data; payments go through Stripe (links / checkout). |
| PCI certification / provider | Not applicable — no cardholder data touches the PMS. Payment processing is delegated to Stripe. |
| Not supported (declared) | **OTA booking modifications are received, stored and acknowledged but not auto-applied** to the local reservation (a staff member reconciles). No automatic daily full sync (manual only). |

---

## Stage 3 — Formulario

| Lo que piden | Resuelto |
|---|---|
| Task ids de cada test | ✅ Tabla de arriba (también en `CHANNEX-CERTIFICACION-EVIDENCIA.md`) |
| Notas / features | ✅ Test 14 de arriba |
| Escenarios no aplicables marcados | ✅ Ninguno no aplica |
| Screenshots de mapeo | ✅ `docs/evidencia/channex-certificacion/01-channel-manager-conectado.png`, `02-mapeo-4-de-4.png`, `03-mapeo-4-de-4-scroll.png` |
| **Envío del formulario** | ⏳ **Lo envía una persona** — es lo único que falta de esta etapa |

## Stage 4 — Screenshare

| Lo que piden | Resuelto |
|---|---|
| Ejecutar los tests desde la UI real del PMS mientras miran las llamadas | ✅ Todo se dispara desde `https://solmios.com/panel/...` (grilla de tarifas, editor del canal, reservas, botón Sincronizar). Guion paso a paso con links: `CHANNEX-CERTIFICACION-CHECKLIST.md` §4 y §7 |
| Sin scripts, sin UI "de certificación", sin UUIDs hardcodeados | ✅ El runner e2e solo se usa para generar task ids; pega los mismos endpoints que el panel. Sin UI especial. UUIDs en config por hotel |
| Que no se caiga a mitad de camino | ✅ Suscripción del hotel de examen `active` sin fecha de corte; cola ARI limpia; cuenta sin properties huérfanas (14 → 9); webhook registrado |
| **Agendar y hacer la sesión** | ⏳ **Lo hace una persona** (abrir la sesión de `staging.channex.io` ese día) |

## Stage 5 — Credenciales de producción

| Lo que piden | Resuelto |
|---|---|
| Emitidas por Channex al aprobar Stage 4 | ⏳ Depende de Channex. Al llegar: `CHANNEX_BASE_URL` → `https://api.channex.io/api/v1`, registrar el webhook contra la cuenta nueva, cargar `planExpiresAt` en `/admin/channels` |

---

## Anti-patrones que reprueban — cómo estamos

| Anti-patrón | Nosotros |
|---|---|
| Scripts / Postman posteando valores | ✅ No: el runner pega los endpoints del panel y no se usa en la screenshare |
| UI "de certificación" ad hoc | ✅ No existe; se usan las pantallas normales |
| Full sync por timer | ✅ No hay; solo botón manual |
| Una llamada por fecha/tarifa donde piden 1 batch | ✅ T3–T8 en 1 llamada cada uno (task ids arriba) |
| UUIDs hardcodeados en código de producción | ✅ Todo por config/mapping por hotel |
| Lógica de integración solo en tests | ✅ Vive en `backend/src/modules/canales/` y `ari-outbox/` |

---

## Resumen

| Etapa | Estado |
|---|---|
| Stage 1 pre-flight | ✅ 5/5 |
| Setup | ✅ |
| Stage 2 tests | ✅ 14/14 (11 con task ids, 3 declarativos redactados) |
| Stage 3 formulario | ✅ todo el contenido listo · ⏳ **enviarlo** |
| Stage 4 screenshare | ✅ entorno listo · ⏳ **agendarla y hacerla** |
| Stage 5 credenciales prod | ⏳ Channex |

Del lado nuestro no queda nada por construir ni por configurar. Lo que falta son dos acciones humanas (mandar el formulario, hacer la screenshare) y la respuesta de Channex.
