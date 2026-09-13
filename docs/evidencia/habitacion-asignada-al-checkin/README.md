# Evidencia — Habitación asignada al check-in (epic #255, cierre #263)

Recorrido hecho el 2026-09-13 (03:16–03:29 UTC) **en producción** — `https://hotel.zx89.site`,
hotel demo *Hotel Boutique Palma* (`bca45933-075b-4f0b-bed2-322c3cd7a216`, slug
`hotel-boutique-palma`), usuario `hotel@solmios.com` (hotel_admin "Hotel Admin Demo",
`user-hotel-0000-0000-000000000001`) — con Chromium headless (chrome-headless-shell 1243 de
`/opt/playwright`) vía Playwright 1.61, viewport 1280×800, locale es-ES, timezone UTC (el reloj del
sidebar en las capturas es UTC). Sin SSH al servidor: todo lo que no se ve en pantalla se verificó
por la API autenticada del panel (Bearer del usuario demo, `POST /api/auth/login`).

Script reproducible: [`recorrido-prod.mjs`](./recorrido-prod.mjs) (constantes públicas, sin
secretos; se corre por pasos con `--only=N` / `--from=N` y guarda el estado en
`$STATE_FILE` o `$TMPDIR/recorrido-263-state.json`). Paso re-ejecutable sin efectos permanentes:
`--only=8` (crea una reserva temporal sin habitación para leer los reports y la cancela al final).

```
PLAYWRIGHT_BROWSERS_PATH=/opt/playwright node docs/evidencia/habitacion-asignada-al-checkin/recorrido-prod.mjs --only=8
```

Gates 8.1 (typecheck, tests, analyze, build): [`gates.md`](./gates.md).

Fechas del recorrido (UTC): hoy `2026-09-13` · reserva web `2026-09-23 → 2026-09-25` · OTA
`2026-09-18 → 2026-09-20` · estadía `2026-09-13 → 2026-09-14`. Habitaciones del demo
(`GET /api/planning`): suite 101/201/204 · double 102/202/205/208
(208 = `ea644081-739f-4fda-8c2f-60f19ec5210e`) · single 103 (`room-0003-0000-0000-000000000003`,
la única con cerradura TTLock: lock `9a9797c8-282a-4e0b-8ad7-8421d950e75b`, en línea, batería
100 %, `autoCodesEnabled: true`) · triple 203 (ocupada desde antes). `GET /api/ttlock/config` →
`configured: true, connected: true, region: eu`.

| # | Captura | Qué muestra |
|---|---|---|
| 01 | `01-reserva-web.png` | Widget público `/book/hotel-boutique-palma`, paso 5/6 "Revisá y reservá": 2026-09-23 → 2026-09-25 (2 noches), Double · 2 adultos, huésped *Autowork Recorrido 263 web*, 162,71 € (188,80 USD), condiciones aceptadas. Al tocar **Pagar** el widget hizo `POST /api/public/booking` → **201** con `reservation.id = 5f840de0-d528-40fe-a003-ff7703f16a33`, **`roomId: null`**, `roomType: 'double'`, `status: 'pending'` y `checkoutUrl` de Stripe |
| 01b | `01b-stripe-checkout-pendiente.png` | Stripe Checkout (test) al que redirigió el widget tras el 201. **No se pagó**: la reserva queda `pending`, sin habitación, y así se la ve en los pasos siguientes |
| 02a | `02a-listado-sin-asignar.png` | `/panel/reservas` filtrado por "Autowork Recorrido 263": fila con badge ámbar **"Sin asignar · Doble"** (`data-testid="unassigned-badge"`), Pendiente, canal Web, $188.8 |
| 02b | `02b-planning-sin-asignar.png` | `/panel/planning` (vista 7 días, semana 20–26 sep): grupo Double "4 libres · 1 sin asignar", carril **"Sin asignar Double"** con la barra "2P·Autowork Recorrido 2…" en 23–25 |
| 03 | `03-dos-ota-sin-asignar.png` | Planning semana 13–19 sep: dos carriles "Sin asignar" (Double) con las dos OTA del mismo tipo y fechas (`40275486-7d6a-4f7e-b442-daefdc03b43e` y `dad33929-5c47-46fb-ab7f-9038aa7bcecc`, "2P·Guest $240", 18 → 20 sep), encabezado "0 ocupadas · 4 libres · 2 sin asignar". Entraron las dos, sin colisión ni overbooking |
| 03b | `03b-listado-filtro-sin-asignar.png` | Listado con el filtro de estado **"Sin asignar"**: las 2 OTA (Guest, 18 → 20 sep, Confirmada, canal "other") + la web (23 → 25 sep, Pendiente). 3 filas |
| 04a | `04a-planning-drag-preview.png` | Mitad del drag (mousedown/mousemove reales con `page.mouse`): la barra de OTA-A sale del carril y se dibuja sobre la fila 208 con el cartel "Asignar habitación · Hab. 208 · Soltá para asignarla · 2026-09-18 → 2026-09-20" |
| 04 | `04-planning-drag-asignada.png` | Tras soltar: toast **"Habitación 208 asignada"** (`POST /api/reservas/40275486…/assign-room` → 200), barra de OTA-A en la fila 208, el grupo Double pasa de "2 sin asignar" a "1 sin asignar" (OTA-B sigue sin habitación) |
| 05a | `05a-checkin-pide-habitacion.png` | `/panel/reservas/checkin`: la llegada de hoy `c9cfb597-e4ed-4d73-98ee-49b9d85281da` (OTA single, `AW263-1789269796030`) aparece como **"Sin habitación · single"**; el botón Check-in abre el RoomAssignModal en modo check-in ("Check-in: elegí dónde duerme · Tipo vendido: single") con la Hab. 103 "Sugerida · Disponible · Limpia" ya seleccionada y el botón **"Asignar y hacer check-in"** |
| 05b | `05b-checked-in-hab-103.png` | Modal de la reserva tras `POST /checkin {roomId: 103}` → 200: badge **Check-in**, "Tipo: Individual · Habitación: 103 (asignada el 13/09/2026, 03:23 por Hotel Admin Demo)", bloque Cerradura con "Código de acceso `******` activo 2026-09-13 → 2026-09-14" (el PIN se tapó en el DOM antes de capturar) |
| 06 | `06-ttlock-codigo.png` | Mismo modal, tarjeta **"Cerradura"**: En línea · 100 %, Abrir/Cerrar puerta, horario 15:00 → 12:00, código activo (tapado), botones Enviar código por email / Regenerar / Cambiar / Desactivar. El código se generó **al asignar la 103 en el check-in** (fila nueva en `GET /api/ttlock/codes`, ver abajo) |
| 07a | `07a-reasignar-modal.png` | "Cambiar" → RoomAssignModal con "Ver todos los tipos" tildado (`GET /assignable-rooms?allTypes=1`): Hab. 103 "Actual · Ocupada" (Asignar deshabilitado), 101/102/202/204/205/208/203 marcadas "Otro tipo" (8 libres) |
| 07 | `07-reasignada-208.png` | Tras Asignar 208 y aceptar el `confirm()` "La habitación es de otro tipo. ¿Asignar igual?": toast "Habitación 208 asignada", "Tipo: Doble · Habitación: 208 (asignada el 13/09/2026, 03:25 por Hotel Admin Demo)", Cerradura: **"Sin código vigente — el anterior fue desactivado"**, "1 código(s) anterior(es)" (la 208 no tiene cerradura) |
| 08 | `08-reports-ocupacion.png` | `/panel/finanzas/reportes` pestaña Ocupación (Este mes): 9 hab., ocupación media 19 %, 2 ocupadas/día, 7 libres/día (captura de la re-corrida de las 03:41Z, ver Reports), Hab. por tipo suite 3 / double 4 / triple 1 / single 1. Renderiza con reservas sin `roomId` en el rango |
| 08b | `08b-reports-ocupacion-diaria.png` | Tabla "Detalle diario" del mismo reporte (01–21 sep) |

Nota sobre 08/08b: se rehicieron con `--only=8` a las 03:29Z, **después** de la limpieza. Como las
reservas del recorrido ya estaban canceladas/checked-out, el paso 8 crea una reserva confirmada sin
habitación (panel, double 18 → 20, `b2d70362-16af-4f39-af3f-f62506dbd1b6`) sólo para la lectura y la
cancela al final (200). Con ella el 18 sep pasó de 1 a 2 ocupadas: la fila sin `roomId` cuenta.

## Verificación por API

Todas las lecturas con `Authorization: Bearer` del usuario demo. Detalle = `GET /api/reservations/:id`;
listado = `GET /api/reservas?limit=N` (el `limit` cambia en cada llamada para esquivar la caché de
300 s, ver Hallazgos).

### Reserva web `5f840de0-d528-40fe-a003-ff7703f16a33` (paso 1) — nace sin habitación

| Momento | Fuente | `status` | `roomType` | `roomId` | `roomAssignedAt` / `roomAssignedBy` | otros |
|---|---|---|---|---|---|---|
| `POST /api/public/booking` (03:16:5xZ) | body del 201 (interceptado con `page.route`) | `pending` | `double` | **`null`** | — | `checkoutUrl` Stripe test |
| Creada (03:16:55Z) | detalle | `pending` | `double` | **`null`** | `null` / `null` | `source: web`, `channel: direct`, 2026-09-23 → 2026-09-25, `totalAmount: 188.8`, `paymentState: pending`, `folioId: null`, guest "Autowork Recorrido 263 web" |
| Listado (paso 2) | fila de `GET /api/reservas` | `pending` | `double` | `null` | `null` | badge "Sin asignar · Doble"; planning: 1 `unassigned-lane[data-room-type="double"]`, 1 `unassigned-bar` |

Un primer intento del paso (03:16:27Z) creó además `aa58a2f5-18d5-49b0-a991-936132aba4ee` (misma
reserva; la captura 01 se rehízo para tomar el widget antes de "Pagar"); se canceló a mano a las
03:17Z (`POST /cancel` → 200).

### Dos OTA del mismo tipo y fechas (paso 3) — entran las dos, sin colisión

Receta (está como función en el script): `POST https://secure-staging.channex.io/api/v1/channel_webhooks/open_channel/new_booking`
(header `api-key: open_channel_api_key`, literal público del sandbox; `hotel_code = hotelId`,
`room_type_code: double`, `rate_plan_code: double-bar`, 2 noches a 120.00 USD) y después
`POST /api/channels/bookings/ingest {}`.

| | OTA-A | OTA-B |
|---|---|---|
| Channex | 200, booking `f8e91a0d-…`, `unique_id OPN-AW263-1789269525724` | 200, booking `744704cb-…`, `unique_id OPN-AW263-1789269558374` |
| Ingest | 200 `{feedSize: 1, ingested: 1, acknowledged: 1, skipped: 0, unmapped: 0}` | 200 con `feedSize: 0` — Channex ya la había empujado por webhook (la fila existía a las 03:19:19Z, 1 s después del POST) |
| id | `40275486-7d6a-4f7e-b442-daefdc03b43e` (createdAt 03:18:46Z) | `dad33929-5c47-46fb-ab7f-9038aa7bcecc` |
| `status` / `source` / `channel` | `confirmed` / `ota` / `OpenChannel` | `confirmed` / `ota` / `OpenChannel` |
| fechas | 2026-09-18 → 2026-09-20 | 2026-09-18 → 2026-09-20 |
| `roomType` / `roomId` | `double` / **`null`** | `double` / **`null`** |
| `totalAmount` | 240 | 240 |
| `guestId` | `null` (huésped sólo en `otaNotes`: "Guest: Autowork Recorrido 263 OTA-A <autowork+263@bot.zx89.site> +18095550263 \| revision 05b2bb63-… \| booking f8e91a0d-…") | `null` |
| `externalLocator` | `AW263-1789269525724` | `AW263-1789269558374` |

Ninguna de las dos trae nota "TIPO SIN MAPEAR" (el room type de Channex mapeó a `double`) ni
overbooking: con 4 double y 0 asignadas, el planning las muestra en dos carriles "Sin asignar" (03).

### Drag en el planning (paso 4) — OTA-A `40275486-…` → hab. 208

| Momento | `status` | `roomType` | `roomId` | `roomAssignedAt` | `roomAssignedBy` |
|---|---|---|---|---|---|
| antes | `confirmed` | `double` | `null` | `null` | `null` |
| `POST /api/reservas/40275486…/assign-room` → **200** | `confirmed` | `double` (sin cambio) | `ea644081-739f-4fda-8c2f-60f19ec5210e` (208) | `2026-09-13T03:22:59.758Z` | `user-hotel-0000-0000-000000000001` |

OTA-B `dad33929-…` sigue con `roomId: null` después del drag. El calendario usa
mousedown/mousemove/mouseup (no HTML5 DnD): el drag real funcionó a la primera y no hizo falta el
fallback por modal.

### Check-in con asignación en el mismo paso (paso 5) — `c9cfb597-e4ed-4d73-98ee-49b9d85281da`

Reserva de estadía: OTA simulada single hoy → mañana (80.00 USD) por la misma receta; Channex 200,
ingest 200 "1 reservas creadas, 0 actualizadas, 1 confirmadas a la OTA", locator
`AW263-1789269796030`. La pantalla `/panel/reservas/checkin` toma las llegadas de `GET /api/planning`
(no del listado cacheado) y la vio al instante.

| Momento | `status` | `roomType` | `roomId` | `roomAssignedAt` / `roomAssignedBy` | `checkedInAt` | `folioId` | `guestId` |
|---|---|---|---|---|---|---|---|
| Creada (03:23:16Z) | `confirmed` | `single` | `null` | `null` / `null` | `null` | `null` | `null` |
| `POST /api/reservas/c9cfb597…/checkin {roomId: room-0003-…, allowTypeChange: false}` → **200** `{success: true, data: {folioId, guestId}}` | `checked_in` | `single` | `room-0003-0000-0000-000000000003` (103) | `03:23:21.166Z` / `user-hotel-…0001` | `03:23:23.219Z` | `fb9ffffa-9615-428c-adc4-8b80d8570d37` | creado: "Pasajero AW263-1789269796030" |

Folio `fb9ffffa-…` (`GET /api/folios/:id`): `open`, `roomId` 103, cargo "Habitación 103 —
2026-09-13" 65 + ITBIS = 76.70, balance 76.7. Habitación 103 → `occupied`.

### Código TTLock al asignar (paso 6) — `GET /api/ttlock/codes`

Fila nueva 1 s después del check-in (03:23:23.178Z). PIN y `ttlockKeyboardPwdId` tapados: el script
los enmascara en el estado y en el DOM antes de capturar; no se guardaron ni se imprimieron.

| `id` | `reservationId` | `lockId` | `status` | `codeType` | `startDate` | `endDate` | `ttlockKeyboardPwdId` | `code` |
|---|---|---|---|---|---|---|---|---|
| `92567f8f-03ff-4d4d-a11c-04738a1eb5f9` | `c9cfb597-…` | `9a9797c8-282a-4e0b-8ad7-8421d950e75b` (hab. 103) | `active` | `time` | 2026-09-13 | 2026-09-14 | `***` (real: se generó en la cerradura física) | `******` |

Lo disparó el connector `reservas-ttlock` (`onRoomAssigned`) con la reserva todavía `confirmed`:
el código nace con la asignación, no con el pago ni con la reserva. En el panel no hay pantalla de
listado de códigos (`/panel/cerraduras` redirige a `/panel/integraciones?tab=cerraduras`, config del
proveedor); las capturas 05b y 06 son el bloque "Cerradura" del modal de la reserva.

### Reasignación en estadía (paso 7) — 103 → 208, otro tipo

| Momento | `status` | `roomType` | `roomId` | `roomAssignedAt` / `roomAssignedBy` | folio `fb9ffffa-…` (`GET /api/folios/:id`) | código TTLock `92567f8f-…` |
|---|---|---|---|---|---|---|
| antes | `checked_in` | `single` | 103 | `03:23:21.166Z` / `user-hotel-…0001` | `roomId` 103, `open`, balance 76.7 | `active` |
| `POST /assign-room {roomId: 208, allowTypeChange: true}` → **200** | `checked_in` | **`double`** (cambió al tipo de la unidad) | `ea644081-…` (208) | `03:25:05.145Z` / `user-hotel-…0001` | `roomId` **208**, `open`, balance 76.7, `updatedAt 03:25:05.169Z` (mismo instante) | `expired` (`updatedAt 03:25:07.257Z`); **no** se generó otro: la 208 no tiene cerradura |

El folio sigue a la reserva. El cargo conserva su descripción "Habitación 103 — 2026-09-13" (se
posteó al check-in; no se reescribe). Estados de habitación tras reasignar: 103 → `cleaning`,
208 → `occupied`. La revocación del código anterior aunque la nueva habitación no acepte PIN es lo
esperado (`shared/usecases/lock-code-on-room-move.ts`).

### Reports (paso 8)

Lectura 1 (03:26Z, antes de la limpieza: web `pending` sin hab., OTA-B `confirmed` sin hab., OTA-A
en 208, estadía `checked_in` en 208):

| Endpoint | Resultado |
|---|---|
| `GET /api/reports` | `totalReservations: 65`, `todayCheckins: 1`, `todayCheckouts: 0`, `channelBookings: {direct: 12, OpenChannel: 4}`, `occupancyByType: [suite 3/0, double total 4 · occupied 1 · 25 %, triple 1/0, single 1/0]` — la ocupada es la estadía, contada por `roomType` (= double tras el cambio de tipo); sólo cuenta `confirmed`/`checked_in` de esta noche, por eso la web pendiente y las OTA del 18 no aparecen |
| `GET /api/reports/advanced?type=ocupacion&from=2026-09-12&to=2026-09-27` | `totalRooms: 9`, `avgRealOccupancy: 14`, `byRoomType: {suite 3, double 4, triple 1, single 1}`; daily `2026-09-13: occupied 2 · free 7 · 22 %`, `2026-09-18: occupied 3 · free 6 · 33 %` (OTA-A con hab., OTA-B sin hab. y una pending previa de la 103 del 14 → 19), `2026-09-23: occupied 2 · free 7 · 22 %` (la web sin hab. + otra) |

Lectura 2 (03:29Z, después de la limpieza, con la temporal `b2d70362-…` confirmada sin hab. 18 → 20): `occupancyByType` todo 0 (nadie alojado esta noche),
`todayCheckins: 0`, `channelBookings: {direct: 11, OpenChannel: 2}`; daily `09-13: 2` · `09-18: 2`
(sin la temporal daba 1) · `09-23: 1`. `unassignedLive` = sólo la temporal.

Las capturas 08/08b son de una **re-corrida** del paso 8 a las 03:41Z (`--only=8`, que crea otra temporal
sin hab. 18 → 20 — `469c0325-…`, cancelada al final): por eso muestran ocupación media 19 % y la fila
`13 sept: 3 ocupadas / 33 %`, no los valores de las lecturas 1 y 2. Las 3 filas no canceladas que cubren
esa noche según `GET /api/reservas` a las 03:50Z: `c9cfb597-…` (`checked_out`, la estadía), `b521a741-…`
(`pending`, suite 13 → 16) y `dd119516-…` (`no_show`, suite 11 → 16) — consistente con que la estrategia
`ocupacion` cuenta toda reserva `status !== 'cancelled'`.

Coherencia: las filas sin `roomId` cuentan en la ocupación por día y `occupancyByType` agrupa por
`roomType`, no por la habitación. La estrategia `ocupacion` cuenta toda reserva `status !==
'cancelled'` (incluye `pending` y `no_show`) mientras `occupancyByType` del dashboard sólo
`confirmed`/`checked_in`: es de antes del epic y no se tocó.

## 8.2 Deploy — relax `NOT NULL` + backfill `roomType`

El auto-deploy corre `RUN_MIGRATE=1` (sincroniza el ORM: agrega `roomType`, `roomAssignedAt`,
`roomAssignedBy`) y `bun run migrate` (`backend/migrate-db.ts`), que invoca en ese orden
`backend/scripts/relax-reservations-roomid.ts` (`ALTER TABLE reservations ALTER COLUMN roomid DROP
NOT NULL` en Postgres; idempotente, `changed: false` si ya estaba) y
`backend/scripts/backfill-reservation-room-type.ts` (`UPDATE reservations SET roomType = rooms.type
WHERE roomType IS NULL OR ''`). Los dos loguean su resultado en el migrate
(`reservations.roomId NOT NULL: quitado | ya estaba relajado`, `reservations.roomType: N fila(s)
rellenada(s)`).

Sin SSH al servidor no se pudieron correr las dos consultas del bloque 8.2 de la spec. Para quien
tenga acceso (`psql` sobre la base del hotel; el identificador va en minúsculas porque Postgres
pliega el `CREATE` sin comillas del ORM):

```sql
SELECT count(*) FROM reservations WHERE roomtype IS NULL OR roomtype = '';   -- esperado: 0
\d reservations                                                              -- roomid sin "not null"
```

Equivalente por API, verificado en prod:

| Qué | Cómo | Resultado |
|---|---|---|
| `roomType` rellenado en las filas viejas | `GET /api/reservas?limit=200` del hotel demo, Bearer `hotel@solmios.com`, 2026-09-13T03:02Z (antes del recorrido) | **58 reservas, 0 con `roomType` vacío** |
| ídem, después del recorrido | misma lectura, 03:27Z | **65 filas, 0 sin `roomType`** (suite 28, double 24, single 12, triple 1); `roomId: null` en 5 filas, todas `cancelled` (las del recorrido); 2 filas con `roomAssignedAt` (OTA-A y la estadía) |
| `reservations.roomid` acepta `NULL` | el widget insertó la reserva web `5f840de0-…` con `roomId: null` (paso 1, 201) y Channex ingresó 3 filas con `roomId: null` (pasos 3 y 5) | con la restricción vigente el INSERT habría fallado con `NOT NULL constraint failed` |
| Auto-asignación de pre-llegada | `GET /api/booking-engine/config` | `autoAssignBeforeArrivalHours: 0` (apagada en el demo; ninguna reserva se asignó sola durante el recorrido) |
| TTLock del hotel | `GET /api/ttlock/config`, `GET /api/ttlock/codes` | `configured: true, connected: true`; 14 códigos en total, 3 `active` de reservas de agosto ajenas al recorrido |

## Hallazgos

Lo que **no** salió como dice el issue, o que conviene saber:

1. **La caché del listado de reservas (300 s) no se invalida con la ingesta de Channex.** Una OTA
   nueva tarda hasta 5 min en aparecer en `/panel/reservas` y en `GET /api/reservas` con la misma
   query (`reservas/usecases/cache.ts`, clave por versión + parámetros; el ingest no bumpea la
   versión). El planning (`/api/planning`) y la pantalla Check-in sí la ven al instante. Efecto en
   el recorrido: la búsqueda por `externalLocator` no vio las OTA-A/B en 30 s y el fallback del
   script creó dos duplicados por `POST /api/reservas` (`8044eda7-048a-4c93-ade7-a0ed38e952fe`,
   `d220056e-67dc-4801-90c2-df6a355a9589`, channel `booking`, source `ota`), cancelados a mano a
   las 03:21Z. El script ahora usa un `limit` distinto en cada lectura (la clave de caché lo incluye).
2. **`GET /api/reservas?search=<locator>` devuelve 0 filas en prod** aunque el código filtra por
   `externalLocator $like`. Probado con `AW263`, `AW250` y locators exactos.
3. **La caché del listado de folios no se invalida con assign-room.** `GET /api/folios?reservationId=`
   siguió devolviendo `roomId` 103 después de reasignar la estadía a 208
   (`folios/usecases/cache.ts`); el detalle `GET /api/folios/:id` sí mostró 208 en el mismo segundo.
   El script lee el detalle.
4. **Las reservas que entran por Channex quedan sin `guestId`** (huésped sólo en `otaNotes`): en
   listado y planning salen como "Guest"; el check-in crea la ficha "Pasajero <locator>".
5. **Reasignar con `allowTypeChange` cambia `roomType`** al tipo de la nueva unidad (single →
   double en `c9cfb597-…`). Es el comportamiento del usecase (`validateRoomAssignment`) y el modal
   lo muestra ("Tipo: Doble"), pero afecta a los reports por tipo (`occupancyByType` contó la
   estadía como double).
6. El cargo de habitación del folio conserva la descripción "Habitación 103 — 2026-09-13" tras
   mover la estadía a 208; el `roomId` del folio sí cambió.
7. Planning a 1280 px con la vista por defecto (14 días) scrollea horizontal y esconde la columna
   de habitaciones; el script pasa el select a "7 días" y navega con ▶ hasta la semana del check-in.
8. El drag en el planning no falló en ninguna corrida: no hizo falta el fallback por modal.
9. La OTA-B entró por el webhook de Channex antes de que el script llamara al ingest (`feedSize: 0`
   1 s después del POST): el ingest manual sólo hizo falta para la OTA-A.

## Limpieza (estado final en el hotel demo)

| Reserva | Qué era | Estado final |
|---|---|---|
| `5f840de0-d528-40fe-a003-ff7703f16a33` | web 23 → 25 sep double | `cancelled` (`POST /cancel` 200), `roomId: null` |
| `aa58a2f5-18d5-49b0-a991-936132aba4ee` | web duplicada del primer intento del paso 1 | `cancelled` (a mano, 03:17Z) |
| `40275486-7d6a-4f7e-b442-daefdc03b43e` | OTA-A 18 → 20 sep double, asignada 208 por drag | `cancelled` (200); conserva `roomId` 208 y `roomAssignedAt/By` |
| `dad33929-5c47-46fb-ab7f-9038aa7bcecc` | OTA-B 18 → 20 sep double, sin habitación | `cancelled` (200), `roomId: null` |
| `8044eda7-048a-4c93-ade7-a0ed38e952fe`, `d220056e-67dc-4801-90c2-df6a355a9589` | duplicados del panel (fallback del paso 3) | `cancelled` (a mano, 03:21Z) |
| `c9cfb597-e4ed-4d73-98ee-49b9d85281da` | estadía single hoy, check-in en 103, reasignada a 208 | `checked_out` (`POST /checkout {settle: null, acknowledgeDebt: true}` → 200 `{ok, status: checked_out, settlement: null}`); folio `fb9ffffa-9615-428c-adc4-8b80d8570d37` queda **`open` con deuda 76.70** (no se pagó); código TTLock `92567f8f-…` `expired` |
| `b2d70362-16af-4f39-af3f-f62506dbd1b6` | temporal del paso 8 (lectura 2) | `cancelled` (200) |
| `469c0325-…` | temporal de la re-corrida del paso 8 (03:41Z, capturas 08/08b) | `cancelled` (200) |

- Channex staging: los bookings `f8e91a0d-…`, `744704cb-…` y el de la estadía quedan en el sandbox
  de open_channel, acknowledged por el ingest; no se cancelaron del lado Channex.
- Habitaciones: 103 y 208 en `cleaning` (por el check-out/reasignación; housekeeping las vuelve a
  `available`), 203 `occupied` (ya estaba), el resto `available`.
- Huésped creado por el check-in: "Pasajero AW263-1789269796030" (queda en `/panel/huespedes`).

## Nota para hoteles con TTLock (changelog)

Desde este epic el **código de acceso se genera al asignar la habitación**, no al pagar ni al
reservar (antes la habitación venía fija desde la reserva y el código salía con ella). Una reserva
sin habitación **no tiene código** hasta que se le asigna una: en el planning (drag o modal), en el
paso de check-in (captura 05a → 06, código activo 1 s después de asignar la 103) o por la
auto-asignación de pre-llegada. Al cambiar de habitación el código anterior se revoca y, si la nueva
tiene cerradura, se genera otro (captura 07: la 208 no tiene cerradura, queda "Sin código vigente").

Si el hotel quiere el código la víspera sin que recepción asigne a mano, configurar
**`autoAssignBeforeArrivalHours`** en la configuración del motor de reservas
(`backend/src/modules/bookingengine/usecases/config.ts`; validator
`bookingengine/validators/schema.ts`: entero entre **0 y 168** horas, default **0** = apagado). Lo
consume el cron de pre-llegada (`shared/usecases/prearrival-pass-cron.ts`): entrado ese plazo antes
del check-in, auto-asigna una habitación libre del tipo vendido (`reservas/usecases/auto-assign-room.ts`)
y con eso se dispara el código. En el hotel demo está en `0`, por eso en el recorrido ninguna reserva
se asignó sola.
