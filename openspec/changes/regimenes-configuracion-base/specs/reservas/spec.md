# Reservas — delta #360 (regímenes desde Configuración base)

## MODIFIED Requirements

### Requirement: Régimen reservable y cobrado por persona y noche desde la web (MR-03, #268)

El hotel mantiene un catálogo ABIERTO de regímenes en `meal_plans` desde **Configuración →
Regímenes** (#360): cada fila tiene `name` (obligatorio, max 80), `description` (max 500,
default `''`), `code` (identificador estable: slug `a-z0-9_` del nombre, max 40, único por
hotel, con sufijo numérico si choca; nunca se edita), `active`, `priceMode`
included|per_person_per_night, `price` (≥ 0) y `sortOrder`. La API admin expone
`GET /api/meal-plans` (ordenado por `sortOrder`, luego `createdAt`), `POST /api/meal-plans`
(201, genera `code`), `PUT /api/meal-plans/:id` (parcial) y `DELETE /api/meal-plans/:id`
(204), con permisos `mealplans` view/edit y ownership por hotel (una fila de otro hotel → 404).
"Solo alojamiento" (`room_only`) YA NO es una base implícita: es una fila normal (`included`,
0) que el hotel edita, desactiva o borra. La primera lectura del admin siembra UNA sola vez
las 4 filas históricas que falten (`room_only` activa; `breakfast`, `half_board`,
`all_inclusive` inactivas, `included`, 0, `sortOrder` 0..3) y marca
`booking_config.mealPlansSeeded = true`; borrarlas después no las re-crea. Filas legacy sin
`name` se leen con el nombre histórico de su código.

`booking_config.showMealPlans` (boolean, default `true`, editable desde Página pública →
Motor de reservas) decide si el motor los ofrece: apagado, `GET /public/hotels/:slug/meal-plans`
y `GET /rates.mealPlans` devuelven `[]` y `POST /booking` / `/booking-group` rechazan cualquier
`mealPlan` con 400 `meal_plan_unavailable` (el catálogo se trata como vacío; `room_only`/vacío
siguen pasando como "sin régimen").

El motor público MUST aceptar `mealPlan` por habitación (`mealPlan` en el body single y en
cada `rooms[i]` del grupo) y resolverlo SIEMPRE contra el catálogo activo del hotel
(`public-meal-plan-lines.ts`): nombre, precio y modo se releen de `meal_plans`, nunca del body.
Cualquier `code` activo del hotel es válido (custom incluidos); `room_only` con fila activa
produce una línea real (`included`, total 0, con su `name`); `mealPlan` vacío — o `room_only`
cuando el hotel NO tiene esa fila — es "sin régimen" (`mealPlan = 'room_only'`,
`mealPlanName = null`, compat con reservas anteriores). Un código inexistente, inactivo, de
otro hotel o con el catálogo oculto MUST rechazar con 400 `meal_plan_unavailable` ANTES de
escribir nada. El importe es `price × persons × nights` con `persons = adultos efectivos +
niños con plaza` (bebés y niños libres no pagan) e `included` → 0. Entra en `subtotal` ANTES
de promo e impuestos, se desglosa en `priceBreakdown.mealPlanTotal` y se resume en `notes`
con el nombre del catálogo ("Régimen: Brunch premium (2 pers × 3 noches = 150.00)"). Cada
fila `reservations` persiste el snapshot congelado `mealPlan` (code), `mealPlanName`,
`mealPlanPriceMode`, `mealPlanUnitPrice`, `mealPlanTotal` y escribe `regime` con el mismo
código para el panel; renombrar, reconfigurar o borrar el régimen después NO altera reservas
existentes, y el email de pago, el recibo y la confirmación pública etiquetan con
`mealPlanName` (fallback: etiqueta histórica del código, y si no, el código).

`GET /public/hotels/:slug/meal-plans` devuelve SOLO los activos, en el orden del hotel, como
`{code, name, description, priceMode, price}`; `GET /rates.mealPlans` lo mismo más
`perNight`/`totalForStay`/`persons`/`nights` resueltos para `guests + children` (en
`chargeCurrency`, sin conversión). El widget y la landing ofrecen el régimen como radio por
habitación con EXACTAMENTE ese catálogo (etiqueta = `name`; sin códigos hardcodeados, sin
anteponer "Solo alojamiento", sin opciones deshabilitadas): la primera opción queda elegida
por defecto; con catálogo vacío el bloque de régimen no se renderiza y la línea va sin
régimen. El carrito, el desglose ("Régimen: … · N pers × M noches") y el paso de pago muestran
el `name` congelado en la línea; el panel lo muestra en el modal, filtra por él en el listado
y lo ve recepción en las llegadas del día.

#### Scenario: Crear un régimen propio y reservarlo desde la web

- GIVEN el hotel crea "Brunch premium" (`per_person_per_night`, 25, activo) desde Configuración → Regímenes
- WHEN el huésped busca 2 adultos × 3 noches y reserva con `mealPlan: 'brunch_premium'`
- THEN el radio mostraba "Brunch premium · 150.00", `mealPlanTotal = 150`, `subtotal = habitación + 150`
- AND `Reservations.mealPlan = 'brunch_premium'`, `mealPlanName = 'Brunch premium'`, `regime = 'brunch_premium'`
- AND la confirmación pública, el email y el recibo dicen "Brunch premium"

#### Scenario: Desayuno por persona y noche con niño con plaza y bebé

- GIVEN breakfast `per_person_per_night` 10 activo, 2 adultos + 1 niño con plaza + 1 bebé, 3 noches
- WHEN se reserva con `mealPlan: 'breakfast'`
- THEN `mealPlanTotal = 90`, impuestos sobre `(subtotal − promo)`, `mealPlanUnitPrice = 10`
- AND `GET /rates?guests=2&children=1` devolvió `mealPlans[breakfast].totalForStay = 90`

#### Scenario: Semilla única de los 4 regímenes históricos

- GIVEN un hotel sin filas en `meal_plans` y `booking_config.mealPlansSeeded` ausente
- WHEN el admin lista `GET /api/meal-plans` por primera vez
- THEN existen `room_only` (activo), `breakfast`, `half_board`, `all_inclusive` (inactivos), `included`, 0
- AND `mealPlansSeeded = true`; si borra `half_board` y vuelve a listar, no reaparece

#### Scenario: "Solo alojamiento" como fila real del catálogo

- GIVEN `room_only` activo con `name: 'Solo alojamiento'`
- WHEN el huésped no cambia el radio y reserva
- THEN el body lleva `mealPlan: 'room_only'`, la reserva guarda `mealPlanName = 'Solo alojamiento'`, `mealPlanTotal = 0`
- AND la confirmación muestra "Solo alojamiento · incluido" sin sumar nada

#### Scenario: Hotel sin regímenes activos

- GIVEN el hotel desactivó o borró todas las filas de `meal_plans`
- WHEN el huésped abre el motor y reserva
- THEN `GET /meal-plans` devuelve `[]`, la tarjeta no muestra bloque de régimen, el body no lleva `mealPlan`
- AND la reserva queda `mealPlan = 'room_only'`, `mealPlanName = null`, `mealPlanTotal = 0`

#### Scenario: Toggle "Mostrar regímenes en el motor de reservas" apagado

- GIVEN regímenes activos y `booking_config.showMealPlans = false`
- WHEN se pide `GET /meal-plans` y `GET /rates`, y se reserva con `mealPlan: 'breakfast'`
- THEN ambos endpoints devuelven `mealPlans` vacío y `POST /booking` responde 400 `meal_plan_unavailable` sin crear nada
- AND una reserva sin `mealPlan` sigue pasando

#### Scenario: Régimen inactivo, inexistente o de otro hotel

- GIVEN `half_board` inactivo (o inexistente) para el hotel
- WHEN se reserva con `mealPlan: 'half_board'`
- THEN 400 `meal_plan_unavailable` y ninguna reserva ni huésped creados

#### Scenario: Snapshot congelado ante cambios del catálogo

- GIVEN una reserva con `mealPlan: 'breakfast'`, `mealPlanName: 'Desayuno incluido'`, `mealPlanTotal: 90`
- WHEN el hotel renombra el régimen a "Desayuno buffet", cambia el precio o lo borra
- THEN la reserva conserva `mealPlanName = 'Desayuno incluido'` y `mealPlanTotal = 90`; una reserva nueva usa el catálogo nuevo

#### Scenario: Grupo con regímenes distintos por línea

- GIVEN 2 líneas, una con breakfast y otra con un régimen custom
- WHEN se reserva el grupo
- THEN cada fila `reservations` lleva su propio `mealPlan`/`mealPlanName`/`mealPlanTotal` y
  `priceBreakdown.mealPlanTotal` es la suma

#### Scenario: Ownership del CRUD admin

- GIVEN un régimen del hotel B
- WHEN el admin del hotel A hace `PUT` o `DELETE /api/meal-plans/:id` con ese id
- THEN 404 y la fila del hotel B queda intacta

<!-- #314 (reagendar una estadía a otra habitación en UNA tx) entró mientras este change seguía
     abierto: el requirement va acá para que el archive no pise `specs/reservas/spec.md`, que ya
     lleva este mismo texto. -->

### Requirement: La reserva vende un tipo; la habitación física se asigna (REQ-HAC-01 mínimo + REQ-HAC-03, #258)

> **Cierre del epic #255 (#263, 2026-09-13).** REQ-HAC-01..07 (#256-#262) están mergeados y en producción: `relax-reservations-roomid.ts` + `backfill-reservation-room-type.ts` corrieron vía `bun run migrate` del auto-deploy (0 reservas del hotel demo con `roomType` vacío; reservas web insertadas con `roomId: null`). Gates y recorrido de punta a punta en prod con capturas: `docs/evidencia/habitacion-asignada-al-checkin/` (`gates.md`, `README.md`). Regla que resume la capability: **`roomType` es lo vendido; `roomId` es dónde duerme y puede ser nulo hasta el check-in**; la disponibilidad se decide SIEMPRE por `availableOfType`, el solape físico solo al asignar, y el código TTLock se genera al asignar (si el hotel quiere el código la víspera: `autoAssignBeforeArrivalHours`). Hallazgos del recorrido que NO cubre esta spec (deuda): la caché de 300 s del listado no se invalida con la ingesta de Channex; reasignar con `allowTypeChange` cambia `roomType`; entidad `room_types` propia, overbooking controlado por tipo y preferencias del huésped siguen pendientes.

**Modelo (HAC-01, lo mínimo que HAC-03 necesita; el resto de #256 —tipo obligatorio y `roomId`
opcional en el alta— es HAC-05).** `reservations.roomType` (string, indexado) es el tipo vendido
(= `rooms.type`); `roomId` es nullable ("dónde duerme"); `roomAssignedAt`/`roomAssignedBy` registran
quién y cuándo asignó. El alta desde el panel exigía `roomId` hasta HAC-05 (hoy opcional, ver
REQ-HAC-05) y rellena `roomType` con el `type` de esa habitación cuando no viene. Migración por script (`ormMigrate` NO relaja `NOT NULL`):
`scripts/relax-reservations-roomid.ts` (PG `ALTER COLUMN roomid DROP NOT NULL`; SQLite recrea la tabla
sin la restricción, copiando por nombre e índices, en transacción) y
`scripts/backfill-reservation-room-type.ts` (`roomType = rooms.type` de la asignada, SQL puro),
ambos idempotentes y llamados desde `migrate-db.ts` tras `addColumnIfMissing` de las tres columnas.

**Un solo camino para asignar (`usecases/assign-room.ts`).** `validateRoomAssignment` MUST: 400 si la
habitación no existe o no es del hotel de la reserva; 409 `room_not_sellable` si `isRoomSellable`
falla (`maintenance`/`out_of_order`); 409 `room_overlap` (con `conflictReservationId`, `locator` =
`externalLocator || id`, o `blockId`) si otra reserva **asignada** no cancelada/no_show solapa las
noches o hay un `RoomBlock` sobre ellas (`assertNoRoomConflict`); 409 `type_mismatch` (`expected`,
`actual`) si `rooms.type` difiere del tipo vendido y no viene `allowTypeChange` — con él se actualiza
`roomType` y se audita `reservation.room_type_changed`. El tipo vendido es `roomType` o, en filas
anteriores al backfill, el de la habitación actual; sin ninguno no hay mismatch y se fija el de la
unidad. Los códigos viajan en `details.reason` del 409.

`assignRoom` MUST rechazar 409 `invalid_status` en `cancelled`/`no_show`/`checked_out`, ser idempotente
si ya tiene esa habitación, escribir `roomId/roomAssignedAt/roomAssignedBy`, auditar
`reservation.room_assigned` `{from, to}` y emitir `onRoomAssigned({reservationId, hotelId, roomId,
previousRoomId})`. Reasignar una `checked_in` MUST mover el folio abierto (`folios.roomId`), poner la
anterior en `cleaning` (el vocabulario real de "dirty", `shared/usecases/room-status.ts`) y la nueva
en `occupied`, **en la misma transacción que la fila de la reserva** (`ReservasQueries.transaction`,
`FolioRoomWriter.updateReservation`): si mover falla, la reserva no queda apuntando a una unidad cuyo
folio sigue en la anterior. `unassignRoom` sólo en `pending`/`confirmed` (409 `invalid_status`),
deja `roomId/roomAssignedAt/roomAssignedBy` en null, conserva `roomType`, audita
`reservation.room_unassigned` y emite `onRoomAssigned` con `roomId: null`.

**Endpoints** (todos `guard('reservations','edit')` + `moduleGuard`, ownership post-findById con
bypass `super_admin`): `GET /api/reservas/:id/assignable-rooms` devuelve las unidades vendibles del
hotel sin solape esas noches (reservas asignadas + bloqueos; la propia reserva no choca consigo
misma) como `{id, number, floor, status, cleaningStatus: clean|dirty, typeMismatch, suggested}`,
sólo del tipo vendido salvo `?allTypes=1`, ordenadas limpia+available → libre con otro estado →
resto (`suggested` en la primera del primer grupo). `POST /api/reservas/:id/assign-room`
`{roomId, allowTypeChange?}` (`AssignRoomSchema`) y `DELETE /api/reservas/:id/assign-room`. El
controller mapea `ConflictError` a 409 con `details` y hace push de disponibilidad a Channex para la
nueva y la anterior (best-effort).

`PUT /api/reservas/:id` con `roomId` distinto delega en `validateRoomAssignment` (mismos 409; sin
`allowTypeChange` en el body → `type_mismatch`), rechaza 409 `use_unassign_endpoint` si viene vacío,
`use_assign_endpoint` si la reserva está `checked_in` (mover una estadía es `POST /assign-room`) e
`invalid_status` en cerradas; tras persistir audita y emite `onRoomAssigned`. `validate-update.ts`
ya no valida solape por su cuenta: sólo cuando cambian fechas sin cambiar habitación re-chequea la
unidad actual con `assertNoRoomConflict`. `POST /:id/reschedule` con cambio de habitación manda
`allowTypeChange: true` (el quote ya decidió tipo y precio) y, si la reserva está `checked_in`,
pre-valida el rango nuevo y corre `assignRoom` y el update de fechas/total en UNA transacción real
del ORM (#314, `moveStayAndUpdate` con `ReservasQueries.transactionWithRepos`, patrón
checkin/checkout): repos atados al tx, `assignRoom` recibe un `queries.transaction` que no anida
BEGIN, y sockets, auditoría, `ceilingGuard` e invalidación de caché se encolan y salen recién
después del commit. Si el segundo update falla, el rollback deja reserva, folio y estados de
ambas habitaciones como estaban y no se publica ningún efecto.

**Código de puerta al asignar (`connectors/reservas-ttlock.ts`, `payment-requests-ttlock.ts`).**
`onRoomAssigned` genera el código TTLock sólo si la reserva está confirmada/pagada (`confirmed`,
`checked_in`, `depositStatus: paid` o saldo 0 con total > 0): primera asignación →
`generateCodeIfAbsent`; cambio de habitación → `generateCode` (que revoca los anteriores:
**un código vigente por reserva**); `roomId: null` → `expireCodesByReservation`. Al pagarse la seña
sólo se genera si la reserva ya tiene habitación (sin unidad no hay cerradura; 0 códigos). Todo
best-effort: TTLock caído no rompe ni la asignación ni el webhook de Stripe.

#### Scenario: asignar en estadía mueve folio y estados
- **GIVEN** una reserva `checked_in` en la 101 con folio abierto
- **WHEN** `POST /assign-room {roomId: 102}`
- **THEN** 200; `folios.roomId = 102`; la 101 queda `cleaning` y la 102 `occupied`; audit `reservation.room_assigned {from: 101, to: 102}`; `onRoomAssigned` con `previousRoomId: 101` y TTLock reemplaza el código

#### Scenario: reagendar una estadía a otra habitación es atómico (#314)
- **GIVEN** una reserva `checked_in` en la 101 con folio abierto
- **WHEN** `POST /:id/reschedule {roomId: 102, checkOut: +1 noche}` y el update de fechas/total falla tras mover la habitación
- **THEN** el error se propaga y NADA queda a medias: `reservations.roomId = 101`, fechas y total viejos, `folios.roomId = 101`, la 101 sigue `occupied` y la 102 `available`; ni `onRoomAssigned`, ni auditoría, ni `ceilingGuard` se emitieron. En el caso feliz el resultado y los efectos son los mismos de siempre, pero todos salen después del commit

#### Scenario: la ocupada no aparece y el tipo distinto exige el flag
- **GIVEN** la 101 ocupada esas noches por otra reserva y la 201 de tipo `suite` para una reserva `double`
- **WHEN** `GET /assignable-rooms`
- **THEN** no devuelve la 101; sin `?allTypes=1` tampoco la 201; con él la marca `typeMismatch: true`; `POST /assign-room {roomId: 201}` → 409 `type_mismatch` y con `allowTypeChange: true` → 200 con `roomType: suite`

#### Scenario: pago sin habitación no genera código
- **GIVEN** una reserva web pagada sin `roomId`
- **WHEN** llega `onPaymentRequestPaid`
- **THEN** 0 códigos; al asignarle habitación → 1 código activo
