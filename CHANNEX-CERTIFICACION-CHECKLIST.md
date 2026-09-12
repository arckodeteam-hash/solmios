# Certificación PMS de Channex — checklist operativo con links

> Actualizado **2026-09-12** contra la doc oficial de Channex (leída ese día), el código en `main` (PR #296 mergeado y en prod) y el **estado real de producción** consultado por API ese día (§7).
> Este archivo es el **guion de trabajo**: qué comprobar, dónde tocarlo en el PMS, dónde mirarlo en Channex y con qué evidencia.
> **Cada punto que pide Channex, resuelto y con el texto para el formulario: `CHANNEX-CERTIFICACION-RESPUESTAS.md`.**
> **Guion de la screenshare — qué pantalla abro, qué hago y qué muestro para probar cada test: `CHANNEX-CERTIFICACION-SCREENSHARE.md`.**
> Los otros tres documentos siguen valiendo para lo suyo: `CHANNEX-CERTIFICACION.md` (estado y contexto), `CHANNEX-CERTIFICACION-EVIDENCIA.md` (task ids de la última corrida), `CHANNEX-CERTIFICACION-GAPS.md` **§8** (respuestas del cuestionario — el resto de ese archivo es histórico y contradice al código).

---

## 0. Links de referencia

| Qué | Link |
|---|---|
| Guion oficial de los tests | https://docs.channex.io/api-v.1-documentation/pms-certification-tests |
| Rate limits (la fuente de los números de §5) | https://docs.channex.io/api-v.1-documentation/rate-limits.md |
| Doc ARI (`POST /availability`, `POST /restrictions`) | https://docs.channex.io/api-v.1-documentation/ari |
| Doc de reservas (`booking_revisions`, ack) | https://docs.channex.io/api-v.1-documentation/bookings-collection |
| Doc de webhooks | https://docs.channex.io/api-v.1-documentation/webhook-collection |
| Formulario de certificación (Stage 3) | https://forms.gle/xA8F3eSYBPBd8apYA |
| Consola de Channex staging (sesión la abrís vos a mano — ver §7) | https://staging.channex.io |
| Trámite en GitHub | https://github.com/arckodeteam-hash/solmios/issues/38 (reabierto 2026-09-12, `workflow:en-proceso`) |
| Rate limit por property (Test 12) | https://github.com/arckodeteam-hash/solmios/issues/294 · PR https://github.com/arckodeteam-hash/solmios/pull/296 |
| Runner de evidencia | `backend/scripts/e2e/channex-certification.e2e.ts` |
| Screenshots para el formulario | `docs/evidencia/channex-certificacion/` |

---

## 1. Entorno del examen (producción → staging de Channex)

| Qué | Valor | Dónde verlo |
|---|---|---|
| Panel del hotel de examen | usuario `cert@solmios.com` | https://solmios.com/login |
| Hotel en el PMS | `a7c8d8e4-90a6-4431-862b-a09dff6bdc43` — "Test Property - SolmiOS" | https://solmios.com/admin/hotels |
| Property en Channex | `bddf7d23-83c5-437d-a2ff-c4e85ccaf412` | https://staging.channex.io/properties |
| Canal | **SolmiOS Open** `ef9481b7-0ebe-4419-9cbc-5deb22abf47b`, activo, 4/4 tarifas mapeadas | https://solmios.com/panel/channel-manager |
| Estructura | Twin Room (2 u., occ 2) · Double Room (2 u., occ 2) × BAR $100 · Bed & Breakfast $120 | https://solmios.com/panel/config/habitaciones?tab=tipos |
| Cuenta Channex de la plataforma (API key, webhook, properties huérfanas) | `configuration('channex')` | https://solmios.com/admin/channels |
| Cola de pushes ARI (ritmo, reintentos, fallos) | `ari-outbox` | https://solmios.com/admin/channex-queue |

⚠️ La property vieja `f1f563dd-…` ("(vieja, reemplazada 2026-09-02)") **no se usa**. Si aparece en un readback, estás mirando la property equivocada.

---

## 2. Pre-flight — lo que te preguntan con ruta de archivo (Stage 1)

| # | Pregunta de Channex | Respuesta | Evidencia (`archivo:línea`) |
|---|---|---|---|
| P1 | ¿Detectás cambios ARI por **evento**, no con polling? | Sí. Sockets del framework → connectors → outbox con debounce de 1,5 s | `backend/src/connectors/*-canales.ts` · `backend/src/modules/ari-outbox/usecases/outbox-queue.ts:16` (`DEFAULT_DEBOUNCE_MS = 1500`) |
| P2 | ¿Tenés una cola/outbox que **batchea** respetando **20 ARI/min**? | Sí. Un push por hotel por ráfaga, drain secuencial; transporte con budget global 18/min **y por property 9/min por endpoint** | `outbox-queue.ts` · `backend/src/modules/canales/usecases/channex-http.ts:52` (`DEFAULT_MAX_PER_MINUTE = 18`), `:55` (`MAX_PER_PROPERTY_PER_MINUTE = 9`) — líneas de la rama de #296 |
| P3 | ¿Retry/backoff ante **429 y 5xx**? | Sí. 500 ms·2ⁿ, tope 30 s, `Retry-After` manda; 429 en ARI pausa la property 60 s | `channex-http.ts:39` (`RETRYABLE_STATUS`), `backoffMs`, `pauseProperties` |
| P4 | ¿Endpoint de **webhook** de reservas + flujo de **ack**? | Sí. Receptor `POST /api/channels/channex/webhook`, **registrado en la cuenta** (`booking_new;booking_modification;booking_cancellation`, a nivel cuenta) + feed de respaldo cada 15 min; ack tras procesar | `backend/src/modules/canales/usecases/channex-webhook.ts:19` · `booking-sync.ts:143-146` |
| P5 | ¿Capa de **mapping** IDs internos ↔ UUIDs de Channex? | Sí. Mapping persistido por hotel con fallback GET+título | `backend/src/modules/canales/usecases/channex.ts:85-117` |

---

## 3. Setup del property (lo que Channex exige antes de los tests)

| Requisito | Estado | Comprobar en |
|---|---|---|
| Nombre `Test Property - [Provider]` | ✅ "Test Property - SolmiOS" | https://staging.channex.io/properties |
| Moneda USD | ✅ | ídem → property → Settings |
| 2 room types: Twin Room (occ 2) · Double Room (occ 2) | ✅ | https://solmios.com/panel/config/habitaciones?tab=tipos · readback `GET /room_types?filter[property_id]=bddf7d23-…` |
| 4 rate plans: Twin/Double × BAR · B&B | ✅ | https://solmios.com/panel/config/tarifas · readback `GET /rate_plans?filter[property_id]=bddf7d23-…` |
| Mapeo por API (Property / Room Type / Rate Plan) — creado por el PMS, no a mano | ✅ (la property `bddf7d23` la creó el PMS) | https://solmios.com/panel/channel-manager → tarjeta "Conectado a Channex" |
| Canal activo y **4/4 tarifas mapeadas** | ✅ (verificado 2026-09-04) — **re-verificar antes de la screenshare** | https://solmios.com/panel/channel-manager → canal → "Mapeo con el canal" |

---

## 4. Los 14 tests — qué tocar, dónde mirar, qué esperar

Regla de oro (skill `channex-pms-integration`): **un 200 del push no prueba nada**. Cada test se da por bueno con **readback** en Channex (API o consola) y contando **solo las llamadas salientes** en el sync log.

Readbacks (API key de plataforma en header `user-api-key`; base `https://staging.channex.io/api/v1`):

```
GET /restrictions?filter[property_id]=bddf7d23-83c5-437d-a2ff-c4e85ccaf412&filter[date][gte]=2026-11-01&filter[date][lte]=2026-11-30&filter[restrictions]=rate,min_stay_arrival,min_stay_through,max_stay,stop_sell,closed_to_arrival,closed_to_departure
GET /availability?filter[property_id]=bddf7d23-83c5-437d-a2ff-c4e85ccaf412&filter[date][gte]=2026-11-01&filter[date][lte]=2026-11-30
GET /booking_revisions/feed?limit=50
```

Dónde se ve TODO lo que salió y entró (#347): **https://solmios.com/admin/channex-queue?tab=registro** — cada push con sus task ids, cada espera por límite de peticiones (segundos y motivo), cada 429/5xx con reintento, reintentos agotados ("el push NO salió"), 4xx rechazados y qué hizo el webhook con cada reserva; filtros por hotel/estado/evento. La pestaña **Cola** muestra las ráfagas pendientes/fallidas. Por hotel: https://solmios.com/panel/channel-manager → **Historial de sincronización**.

| # | Test | En el PMS (link + acción) | Valores exactos del guion | Calls | Readback / evidencia | Última corrida |
|---|---|---|---|:-:|---|:-:|
| 1 | **Full sync 500 días** | https://solmios.com/panel/channel-manager → **Sincronizar** | Todo el inventario, tarifas y restricciones, **datos variados** (no uniformes) | **2** | 1 `availability` + 1 `restrictions`; mapeo del canal **sigue 4/4** después | ✅ 2026-09-12 |
| 2 | 1 fecha · 1 tarifa | https://solmios.com/panel/config/tarifas-fecha (grilla) o `channel/:id` → Configurar tarifas | Twin · BAR · **22-nov-2026 · $333** | 1 | `restrictions` 2026-11-22 → `rate: 333.00` en `twin-bar` | ✅ |
| 3 | 1 fecha · varias tarifas | ídem, tres ediciones seguidas (el debounce las junta) | Twin·BAR·21-nov **$333** · Double·BAR·25-nov **$444** · Double·B&B·29-nov **$456.23** | **1** | los tres valores en un solo task id | ✅ |
| 4 | Rangos · varias tarifas | ídem | Twin·BAR·1–10 nov **$241** · Double·BAR·10–16 nov **$312.66** · Double·B&B·1–20 nov **$111** | **1** | rangos completos, sin huecos | ✅ |
| 5 | Min stay | `channel/:id` → "Mín. al llegar" (arrival) / "Mín. en estadía" (through) | Twin·BAR·23-nov **3** · Double·BAR·25-nov **2** · Double·B&B·15-nov **5** | **1** | `min_stay_arrival`/`min_stay_through` según cuál editaste | ✅ |
| 6 | Stop sell | `channel/:id` → "Cerrar ventas" | Twin·BAR·14-nov · Double·BAR·16-nov · Double·B&B·20-nov | **1** | `stop_sell: true` | ✅ |
| 7 | Restricciones combinadas | `channel/:id` → CTA/CTD + max stay + min stay | Twin·BAR·1–10 nov **CTA, max 4, min 1** · Twin·B&B·12–16 nov **CTD, min 6** · Double·BAR·10–16 nov **CTA, min 2** · Double·B&B·1–20 nov **min 10** | **1** | los 4 rate plans en un task id | ✅ (arrival 10 · through 7) |
| 8 | Medio año | ídem, temporada dic-2026 → may-2027 | Twin·BAR **$432, min 2** · Double·BAR **$342, min 3**, 1-dic-2026 → 1-may-2027 | **1** | readback a 2027-04-30 | ✅ |
| 9 | Disponibilidad 1 fecha (**vía reserva**) | https://solmios.com/panel/planning o https://solmios.com/panel/reservas → nueva reserva | Twin·21-nov **8→7** · Double·25-nov **1→0** (ajustar a nuestras 2 unidades: Twin 2→1, Double 1→0) | 1–2 | `availability` baja en la fecha | ✅ (3 reservas = 3 calls; ojo §9) |
| 10 | Disponibilidad rangos | ídem, reservas de varias noches | Twin·10–16 nov **=3** · Double·17–24 nov **=4** (ídem, escalar a 2 unidades) | 1–2 | rango comprimido en una call por reserva | ✅ |
| 11 | **Recepción de reservas** | Channex crea/modifica/cancela desde su cuenta test → https://solmios.com/panel/channel-manager → **Ingesta manual** (`POST /api/channels/bookings/ingest`) | — | — | reserva aparece en https://solmios.com/panel/reservas · **ack** enviado · screenshots + booking id. Usa `GET /booking_revisions`, **no** `/bookings` | ✅ (feed + ack) |
| 12 | **Rate limits** | Confirmación escrita (§5) | — | — | `channex-http.ts` + tests `canales/tests/channex-http.test.ts` (21 pass) | ✅ con #294 |
| 13 | **Update logic** (solo deltas) | Confirmación escrita: sin full sync por timer; el botón Sincronizar es manual | — | — | `rg -n "setInterval|cron" backend/src/connectors/*canales*` → nada que pushee ARI | ✅ |
| 14 | Cuestionario | Transcribir `CHANNEX-CERTIFICACION-GAPS.md` **§8** con las correcciones de §8 de este archivo | — | — | — | redactado |

**Anti-patrones que reprueban** (los mira el revisor en la screenshare): scripts/Postman posteando valores · UI "de certificación" ad hoc · full sync por timer · una call por fecha/tarifa donde piden 1 batch · UUIDs hardcodeados · lógica solo en tests. **Todo se dispara desde el panel real**, el runner e2e es solo para generar task ids.

---

## 5. Rate limits — lo que dice Channex y lo que hacemos (Test 12)

No hay límite **por segundo**. Channex mide **por minuto**:

| Límite documentado | Valor | Nuestro techo | Dónde |
|---|---|---|---|
| ARI total (availability + restrictions) | **20 / min** | **18 / min** (editable en https://solmios.com/admin/channex-queue) | `channex-http.ts:52` |
| `POST /restrictions` por property | **10 / min** | **9 / min** | `channex-http.ts:55` (PR #296) |
| `POST /availability` por property | **10 / min** | **9 / min** | ídem, bucket separado |
| Tamaño máximo del JSON | **10 MB** | full sync de 500 días × 4 rate plans ≪ 10 MB | — |
| Al exceder | `429` · `"code": "http_too_many_requests"` | backoff 500 ms·2ⁿ (tope 30 s), `Retry-After` manda, **+ pausa de 60 s de esa property** en ese endpoint | `channex-http.ts` (`backoffMs`, `pauseProperties`) |
| Recomendación oficial | batchear en **1 call cada 6 s**; ante 429 **pausar la property 1 min** | debounce 1,5 s + drain secuencial + pausa 60 s | `outbox-queue.ts:16`, `channex-http.ts` |

Texto para el formulario (Test 12):

> Single shared HTTP transport for all Channex traffic. Sliding-window limiter: 18 ARI updates/min globally (under the 20/min limit) plus 9/min per property for `POST /availability` and 9/min per property for `POST /restrictions` (under the 10/min per-property limits). Only ARI updates are throttled; content CRUD and GETs are not. On 429 we honour `Retry-After` (else exponential backoff 0.5 s → 30 s) and pause that property's endpoint for 60 s as your documentation recommends. Changes are batched per property with a 1.5 s debounce and drained sequentially from a persistent outbox, so one PMS burst becomes one API call. Full sync is manual only (2 calls: 1 availability + 1 restrictions, 500 days).

---

## 6. Verificación local antes de tocar producción

```bash
cd backend
bun test src/modules/canales src/modules/ari-outbox     # 503 pass (2026-09-12)
bun run typecheck
bun run node_modules/arckode-framework/bin/arckode.js analyze   # ✅ sin violaciones

# Solo lectura contra la cuenta (NO pasar CHANNEX_PROPERTY_ID con el examen en curso: escribe ARI de prueba)
set -a && source .env && set +a && bun run doctor

# Regenerar EVIDENCIA.md con task ids (contra producción, sin tocar bases)
BASE_URL=https://solmios.com \
CERT_HOTEL_ID=a7c8d8e4-90a6-4431-862b-a09dff6bdc43 \
CERT_PROPERTY_ID=bddf7d23-83c5-437d-a2ff-c4e85ccaf412 \
CERT_EMAIL="$CERT_RUNNER_EMAIL" CERT_PASSWORD="$CERT_RUNNER_PASSWORD" CHANNEX_API_KEY="$CHANNEX_STAGING_API_KEY" \
bun run scripts/e2e/channex-certification.e2e.ts
# CERT_RUNNER_EMAIL/PASSWORD (usuario `cert-runner@solmios.com`, hotel_admin del hotel de examen, creado 2026-09-12)
# y CHANNEX_STAGING_API_KEY viven en ~/.solmios-env (chmod 600, fuera del repo). Tarda ~2 min; si el
# bucket de availability está lleno espera hasta 75 s por push — es el rate limit, no un fallo.
# Última corrida 2026-09-12: 26 OK · 0 fallidos.
```

---

## 7. Checklist del día de la screenshare (Stage 4) — en orden

| ✔ | Qué | Dónde | Por qué |
|---|---|---|---|
| ✅ 2026-09-12 | PR #296 mergeado y desplegado (`grep MAX_PER_PROPERTY_PER_MINUTE` en el server = 2, backend `active`) | https://github.com/arckodeteam-hash/solmios/pull/296 | Sin esto el 10+10 por property no está en prod y un 429 puede salir en vivo |
| ✅ 2026-09-12 (`status: active`, `plan-professional`, sin `currentPeriodEnd`) | Suscripción de `cert@solmios.com` **activa** (no `trialing` vencido) | https://solmios.com/admin/subscriptions → buscar el hotel → Reactivar | Trial vencido ⇒ `subscriptions/usecases/access.ts:89` `allowed:false` (trial vencido sin método de pago) ⇒ **se corta la ingesta de reservas ⇒ T11 falla en vivo** |
| ☐ | Sesión de https://staging.channex.io abierta (la abrís vos, no hay creds en el repo) | pestaña Playwright `-s=channex` o navegador | Sin ella no hay readback ni consola para mostrar |
| ✅ 2026-09-12 (`isActive: true`, 4 rate plans mapeados: twin-bar/twin-bb/double-bar/double-bb, `readiness: ready`) | Canal **SolmiOS Open** activo, **4 de 4** mapeadas | https://solmios.com/panel/channel-manager → canal → Mapeo | Un sync viejo pudo dejarlo en 0 con la tarjeta verde |
| ✅ 2026-09-12 (`registered: true`, id `a9aa5db4-…`, 3 eventos de booking, cuenta entera, **`send_data: true`** desde el 2026-09-12 — antes estaba en `false` y Channex mandaba el aviso sin `revision_id` → 400, #342) | **Webhook registrado** en la cuenta (`POST /api/admin/channex-webhook`) | https://solmios.com/admin/channels → tarjeta de cuenta → Webhook | Pre-flight P4 y Test 11 "recomendado"; el cron de 15 min queda de respaldo |
| ✅ 2026-09-12 (`pending 0 · processing 0 · failed 0 · retrying 0 · sent 3`) | Cola ARI vacía, sin fallos pendientes | https://solmios.com/admin/channex-queue | Un push en retry se cuenta como call extra en el test siguiente |
| ✅ 2026-09-12 — borradas las 5 con `DELETE /api/v1/properties/:id` (200 cada una): `647c6642` Hotel Boutique Palma (dev) · `e54c0316` Hotel Centro Historico · `7cf63bb5` Hotel Playa Azul · `20ca765f` Hotel Vista Mar · `f1f563dd` Test Property vieja. La cuenta quedó en **9 properties = 9 hoteles** (`orphans: []`) | 5 properties huérfanas borradas | https://staging.channex.io/properties · https://solmios.com/admin/channels | Confusión en el readback y feo en pantalla |
| ✅ 2026-09-12 (`planExpiresAt: ""`, `planExpired: false`) | `planExpiresAt` **vacío** en la tarjeta de cuenta | https://solmios.com/admin/channels | La cuenta staging **no tiene plan**; cargar una fecha pinta "Plan vencido" en rojo sin fundamento |
| ☐ | Tener a mano el botón **Ingesta manual** | https://solmios.com/panel/channel-manager | El feed corre cada 15 min; esperarlo en vivo es incómodo |
| ☐ | NO correr `bun run doctor` con `CHANNEX_PROPERTY_ID` durante el examen | — | Pisa ARI de esa property con valores de prueba |
| ✅ 2026-09-12 — `docs/evidencia/channex-certificacion/` (`01-channel-manager-conectado.png`, `02-mapeo-4-de-4.png`, `03-mapeo-4-de-4-scroll.png`), tomadas en prod como `cert-runner@solmios.com` | Screenshots de mapeo 4/4 para el formulario | https://solmios.com/panel/channel-manager → canal | Criterio de aceptación de #38 |

---

## 8. Formulario (Stage 3) — qué transcribir y qué corregir de `-GAPS.md` §8

Transcribir **§8 de `CHANNEX-CERTIFICACION-GAPS.md`** con estos ajustes, porque el código cambió después del 2026-09-04:

| Fila de §8 | Decía | Debe decir ahora |
|---|---|---|
| Rate limits | "18/min, backoff 429/5xx, timeout 15 s" | Agregar **9/min por property y endpoint + pausa 60 s ante 429** (PR #296) |
| Webhooks de bookings | "No hay webhook HTTP: feed polling cada 15 min + ack" | **Webhook registrado** (`booking_new/modification/cancellation`) + feed de respaldo cada 15 min. Ya corregido en §8 de `-GAPS.md` |
| Task ids | `-EVIDENCIA.md` del 2026-09-09 | ✅ Regenerados el 2026-09-12 con #296 en prod (26 OK · 0 fallidos) — usar los de `-EVIDENCIA.md` |

Lo que **sí** se declara NO soportado (no bloquea la certificación si se anota): modificaciones OTA que **no se auto-aplican** sobre la reserva local · **tarjetas de crédito** (el PMS no procesa PAN/CVV; cobros por Stripe) · **full sync automático** (solo manual; la doc permite 1/24 h off-peak si se automatiza). Los webhooks **ya no** van en esta lista.

**NO copiar el cuerpo de `-GAPS.md`** fuera de §8: declara "no soportados" CTA/CTD y multi-rate-plan por tipo, y las dos cosas funcionan con readback (multi-rate-plan es requisito del setup).

Test 14 — checklist de features a documentar:
- Tipos de min stay soportados: **arrival y through**, editables en pantallas distintas ("Mín. al llegar" por habitación / "Mín. en estadía" por temporada).
- Restricciones soportadas: `stop_sell`, `max_stay`, `min_stay_arrival`, `min_stay_through`, `closed_to_arrival`, `closed_to_departure`. Ninguna no soportada.
- Multi room type / multi rate plan: sí (4 rate plans mapeados en el examen).
- Tarjeta de crédito: no requerida ni almacenada.
- PCI: no aplica (Stripe).

---

## 9. Inconsistencias encontradas al armar esto (resolver antes de enviar)

| # | Qué | Dónde | Qué hacer |
|---|---|---|---|
| 1 | ~~`-EVIDENCIA.md` del 2026-09-09 decía "25 OK · 1 fallidos" sin decir cuál~~ **Resuelto 2026-09-12**: era **T10** — el runner esperaba 20 s el push de disponibilidad y el transporte lo retuvo 25 s porque la property ya llevaba **9 `POST /availability` en el minuto** (5 de la limpieza de la corrida anterior + 1 del full sync + 3 de T9); es el bucket de #294 evitando el 429 (Channex corta en 10). Las 2 llamadas y el readback estaban bien. El runner ahora espera hasta 75 s (`AVAILABILITY_WAIT_MS`). **Corrida 2026-09-12: 26 OK · 0 fallidos**, task ids nuevos en `-EVIDENCIA.md` | `scripts/e2e/channex-certification.e2e.ts` | — |
| 2 | T9 sale con **3 llamadas** (una por reserva: el runner ocupa las 2 unidades Double para llegar a 0); el guion dice "1–2". En la screenshare hacerlo con **2 reservas** (Twin 1 fecha + Double 1 fecha) = 2 llamadas | `-EVIDENCIA.md` fila T9 | Ensayar T9 con exactamente 2 reservas |
| 3 | ~~`-GAPS.md` §8 decía "no hay webhook HTTP"~~ **Resuelto 2026-09-12**: el webhook está registrado en la cuenta (§7) y §8 quedó corregido | — | — |
| 4 | ~~Issue #38 cerrado sin comentario~~ **Reabierto 2026-09-12** con el estado verificado y `workflow:en-proceso` | https://github.com/arckodeteam-hash/solmios/issues/38 | Cerrarlo cuando Channex emita el certificado |
| 5 | ~~`CHANNEX-CERTIFICACION.md` decía "T12 · 18/min"~~ Actualizado 2026-09-12 (#296 mergeado) | — | — |
| 6 | El guion de Channex pide Twin con **8** unidades y Double con **1** para T9; nuestro examen tiene **2 y 2** | Setup | Escalar los valores (Twin 2→1, Double 1→0) y decirlo en la screenshare, o subir Twin a 8 unidades en https://solmios.com/panel/config/habitaciones |

---

## 10. Después de certificar

1. Mover `CHANNEX_BASE_URL` de `https://staging.channex.io/api/v1` a `https://api.channex.io/api/v1` (`.env` del server) y verificar que los hoteles reales sigan publicando (https://solmios.com/panel/channel-manager de cada uno).
2. Ahí sí cargar `planExpiresAt` en https://solmios.com/admin/channels con el vencimiento del plan pago (Channex no lo expone por API).
3. Registrar el webhook contra la cuenta de producción (el `callback_url` lleva el secreto embebido; el que se registró en staging no sirve).
4. Cerrar #38 con el comentario del certificado.
